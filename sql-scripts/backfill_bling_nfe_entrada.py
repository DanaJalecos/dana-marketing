#!/usr/bin/env python3
"""
Bootstrap bling_nfe_entrada — matriz + bc, 2025-01-01 → hoje.
Estratégia:
  1. Lista GET /nfe?tipo=0 paginada (dataEmissao desejada, mas filtro Bling é dataAlteracao;
     então pega ALTERAÇÕES desde 2025-01-01 — vai pegar quase tudo do período).
  2. Pra cada id novo (não no banco), drill GET /nfe/{id} pra ter detalhes.
  3. UPSERT em batches de 100.
Lê tokens cifrados do Vault via Mgmt API + chama Bling direto.
"""
import base64, json, os, re, sys, time, urllib.request, urllib.error
from pathlib import Path

SB_URL  = "https://wltmiqbhziefusnzmmkt.supabase.co"
SB_MGMT = "https://api.supabase.com/v1/projects/wltmiqbhziefusnzmmkt/database/query"

TOK_DIR = Path(os.environ.get("DMS_TOKENS_DIR",
    r"C:\Users\Juan - Dana Jalecos\Documents\Sistema Marketing\TOKENS ANALYTICS"))
SB_TOKEN = (TOK_DIR / "Token novo supabase.txt").read_text(encoding="utf-8").strip().splitlines()[0]

def http(url, method='GET', headers=None, body=None, timeout=30):
    h = headers or {}
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode('utf-8')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8') if e.fp else ''
    except Exception as e:
        return 0, str(e)

def mgmt(sql):
    status, body = http(SB_MGMT, 'POST',
        {'Authorization': f'Bearer {SB_TOKEN}', 'Content-Type': 'application/json',
         'User-Agent': 'dms-backfill-nfe'}, {'query': sql}, timeout=60)
    if status not in (200, 201): raise Exception(f'mgmt {status}: {body[:400]}')
    return json.loads(body) if body else []

def get_token(empresa):
    rows = mgmt(f"SELECT access_token FROM public.bling_token_get('{empresa}');")
    return rows[0]['access_token']

def get_anon():
    idx = (Path(__file__).resolve().parent.parent / "index.html").read_text(encoding="utf-8")
    m = re.search(r"SUPABASE_ANON_KEY\s*=\s*['\"]([^'\"]+)['\"]", idx)
    return m.group(1)

# ANON pra ler bling_nfe_entrada (read em massa)
SB_ANON = get_anon()
# Service role pra escrever (vamos pegar do api-keys)
status, body = http(
    "https://api.supabase.com/v1/projects/wltmiqbhziefusnzmmkt/api-keys",
    'GET',
    {'Authorization': f'Bearer {SB_TOKEN}', 'User-Agent': 'dms-backfill-nfe'})
if status != 200:
    print(f'[fatal] mgmt api-keys {status}: {body[:300]}'); sys.exit(1)
SB_SRV = next(k['api_key'] for k in json.loads(body) if k.get('name') == 'service_role')

def bling_get(token, path, params=None, max_retries_429=5):
    qs = ''
    if params:
        qs = '?' + '&'.join(f'{k}={v}' for k, v in params.items() if v not in (None, ''))
    url = f'https://api.bling.com.br/Api/v3{path}{qs}'
    for attempt in range(max_retries_429):
        status, body = http(url, 'GET', {'Authorization': f'Bearer {token}', 'Accept': 'application/json'})
        if status == 200:
            try: return json.loads(body).get('data')
            except: return None
        if status == 429:
            time.sleep(1.5 * (attempt + 1))
            continue
        return None
    return None

def upsert(rows):
    if not rows: return 0
    req = urllib.request.Request(
        f'{SB_URL}/rest/v1/bling_nfe_entrada?on_conflict=id_bling',
        data=json.dumps(rows).encode(), method='POST',
        headers={
            'apikey': SB_SRV, 'Authorization': f'Bearer {SB_SRV}',
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=minimal'
        })
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return len(rows) if r.status in (200, 201, 204) else 0
    except urllib.error.HTTPError as e:
        print(f'[upsert err {e.code}] {e.read().decode()[:300]}')
        return 0

def map_entrada(d, loja_id):
    cfop = None
    if isinstance(d.get('itens'), list) and d['itens']:
        cfop = d['itens'][0].get('cfop')
    return {
        'id_bling': d['id'],
        'loja_id': loja_id,
        'numero': d.get('numero', ''),
        'serie': d.get('serie'),
        'chave_acesso': d.get('chaveAcesso'),
        'situacao': d.get('situacao'),
        'data_emissao': d.get('dataEmissao'),
        'data_entrada': d.get('dataOperacao'),
        'valor_total': d.get('valorNota'),
        'valor_frete': d.get('valorFrete'),
        'fornecedor_cnpj': (d.get('contato') or {}).get('numeroDocumento'),
        'fornecedor_nome': (d.get('contato') or {}).get('nome'),
        'fornecedor_id': (d.get('contato') or {}).get('id'),
        'natureza_operacao': (d.get('naturezaOperacao') or {}).get('descricao'),
        'cfop': cfop,
        'observacoes': d.get('observacoes'),
        'xml_url': d.get('xml'),
        'pdf_url': d.get('linkPDF') or d.get('linkDanfe'),
        'raw': d,
        'synced_at': time.strftime('%Y-%m-%dT%H:%M:%S+00:00', time.gmtime()),
    }

def process_loja(empresa, loja_id, desde_iso='2025-01-01'):
    """Bootstrap usando janelas de 80 dias (Bling limita ~90d em /nfe)."""
    print(f'\n[{empresa}] loja_id={loja_id}, desde={desde_iso}')
    token = get_token(empresa)

    # Constrói janelas de 80 dias entre desde e hoje
    from datetime import date, timedelta
    desde_dt = date.fromisoformat(desde_iso)
    hoje = date.today()
    janelas = []
    cur = desde_dt
    while cur <= hoje:
        nxt = min(cur + timedelta(days=80), hoje)
        janelas.append((cur.isoformat(), nxt.isoformat()))
        cur = nxt + timedelta(days=1)

    ids = []
    for (di, df) in janelas:
        pagina = 1
        achados = 0
        while True:
            d = bling_get(token, '/nfe', {
                'tipo': 0, 'pagina': pagina, 'limite': 100,
                'dataEmissaoInicial': di, 'dataEmissaoFinal': df
            })
            if not d: break
            ids.extend([item['id'] for item in d])
            achados += len(d)
            if len(d) < 100: break
            pagina += 1
            time.sleep(0.4)
        print(f'  [{empresa}] janela {di} -> {df}: {achados} NFs')
    print(f'  [{empresa}] TOTAL listagem: {len(ids)} NFs')

    # 2. Quais já existem?
    if ids:
        existentes_set = set()
        for k in range(0, len(ids), 500):
            chunk = ids[k:k+500]
            r = mgmt(f"SELECT id_bling FROM bling_nfe_entrada WHERE id_bling IN ({','.join(map(str, chunk))});")
            existentes_set.update(int(row['id_bling']) for row in r)
        novos = [i for i in ids if i not in existentes_set]
    else:
        novos = []
    print(f'  [{empresa}] {len(novos)} novos pra puxar detalhe (já tem {len(ids) - len(novos)})')

    # 3. Drill por id, em batches
    rows, ok, err, t0 = [], 0, 0, time.time()
    for i, nfe_id in enumerate(novos, 1):
        d = bling_get(token, f'/nfe/{nfe_id}')
        if not d:
            err += 1
            continue
        rows.append(map_entrada(d, loja_id))
        ok += 1
        if len(rows) >= 100:
            n = upsert(rows)
            elapsed = time.time() - t0
            print(f'    [{empresa}] [{i}/{len(novos)}] upsert {n} | err {err} | {elapsed:.0f}s')
            rows.clear()
        time.sleep(0.3)
    if rows:
        n = upsert(rows)
        print(f'    [{empresa}] [final] upsert {n} | err {err}')
    print(f'  [{empresa}] DONE em {time.time()-t0:.0f}s: ok {ok}, err {err}')

def main():
    process_loja('matriz', 203536978)
    process_loja('bc', 203550865)
    print('\n[ALL DONE]')

if __name__ == '__main__':
    main()
