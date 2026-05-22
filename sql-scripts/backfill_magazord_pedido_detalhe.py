#!/usr/bin/env python3
"""
Backfill magazord_pedido_detalhe pra pedidos Jan-Abr 2026 que ainda nao tem detalhe.
Bate em GET /v2/site/pedido/{codigo} (Magazord) e UPSERT em magazord_pedido_detalhe via PostgREST.
~928 pedidos. Estimativa: 8-12 min sequencial; 2-3 min com 8 threads paralelas.
"""
import base64, json, sys, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

# Credenciais — carregadas de arquivos / env vars (NUNCA commitar inline)
# Magazord:  TOKENS ANALYTICS/Token Magazord.txt  (Token na linha 3, Senha na linha 5)
# Supabase:  TOKENS ANALYTICS/Token novo supabase.txt  (sbp_… mgmt token)
# Supabase anon key: copiar de index.html (linha SUPABASE_ANON_KEY)
import os, re
from pathlib import Path

TOK_DIR = Path(os.environ.get("DMS_TOKENS_DIR",
    r"C:\Users\Juan - Dana Jalecos\Documents\Sistema Marketing\TOKENS ANALYTICS"))

def _read_magazord():
    txt = (TOK_DIR / "Token Magazord.txt").read_text(encoding="utf-8")
    tok = re.search(r"Usu[aá]rio:\s*(\S+)", txt).group(1).strip()
    sen = re.search(r"Senha:\s*(\S+)",   txt).group(1).strip()
    return tok, sen

def _read_sb_token():
    return (TOK_DIR / "Token novo supabase.txt").read_text(encoding="utf-8").strip().splitlines()[0]

def _read_anon():
    # busca no index.html do worktree corrente
    here = Path(__file__).resolve().parent.parent
    idx = (here / "index.html").read_text(encoding="utf-8")
    m = re.search(r"SUPABASE_ANON_KEY\s*=\s*['\"]([^'\"]+)['\"]", idx)
    return m.group(1) if m else ""

MZD_TOK, MZD_SEN = _read_magazord()
MZD_URL  = "https://danajalecos.painel.magazord.com.br/api"
MZD_AUTH = "Basic " + base64.b64encode(f"{MZD_TOK}:{MZD_SEN}".encode()).decode()

SB_URL   = "https://wltmiqbhziefusnzmmkt.supabase.co"
SB_MGMT  = "https://api.supabase.com/v1/projects/wltmiqbhziefusnzmmkt/database/query"
SB_TOKEN = _read_sb_token()
SB_ANON  = _read_anon()
assert MZD_TOK and MZD_SEN and SB_TOKEN.startswith("sbp_") and SB_ANON, "Credenciais não carregaram — confere TOKENS_DIR"

# Util ----------------------------------------------------------------------
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

# Lista de codigos pendentes -------------------------------------------------
def get_pending_codes():
    q = """SELECT p.codigo FROM magazord_pedidos p
           LEFT JOIN magazord_pedido_detalhe d ON d.codigo = p.codigo
           WHERE p.data_hora >= '2026-01-01' AND p.data_hora < '2026-05-01'
             AND d.id IS NULL
           ORDER BY p.data_hora DESC;"""
    status, body = http(SB_MGMT, 'POST',
        {'Authorization': f'Bearer {SB_TOKEN}', 'Content-Type': 'application/json',
         'User-Agent': 'dms-backfill-script'},
        {'query': q}, timeout=60)
    if status not in (200, 201):
        print(f'[fatal] mgmt query {status}: {body[:300]}'); sys.exit(1)
    return [r['codigo'] for r in json.loads(body)]

# Fetch + map ---------------------------------------------------------------
def fetch_detail(codigo, max_retries=4):
    for attempt in range(max_retries):
        status, body = http(f'{MZD_URL}/v2/site/pedido/{codigo}', 'GET',
            {'Authorization': MZD_AUTH, 'Accept': 'application/json'}, timeout=30)
        if status == 200:
            try:
                return json.loads(body).get('data')
            except Exception:
                return None
        if status == 429:  # rate limit: backoff
            wait = 1.5 * (attempt + 1)
            time.sleep(wait)
            continue
        return None  # 404, 5xx, etc — give up
    return None

def map_detail(d):
    params = d.get('pedidoTrackingParams') or {}
    return {
        'id': d.get('id'),
        'codigo': d.get('codigo'),
        'data_hora': d.get('dataHora') or None,
        'origem': d.get('origem'),
        'utm_source': params.get('utm_source'),
        'utm_medium': params.get('utm_medium'),
        'utm_campaign': params.get('utm_campaign'),
        'utm_content': params.get('utm_content'),
        'utm_term': params.get('utm_term'),
        'tracking_source': d.get('pedidoTrackingSource'),
        'tracking_user_agent': d.get('pedidoTrackingUserAgent'),
        'tracking_country_code': d.get('pedidoTrackingCountryCode'),
        'tracking_conversion': d.get('pedidoTrackingConversion'),
        'cupom_id': d.get('cupomId'),
        'cupom_codigo': d.get('cupomCodigo'),
        'cupom_valor_desconto': d.get('cupomValorDesconto'),
        'cupom_tipo_desconto': d.get('cupomTipoDesconto'),
        'pessoa_email': d.get('pessoaEmail'),
        'pessoa_tipo': d.get('pessoaTipo'),
        'pessoa_data_nascimento': d.get('pessoaDataNascimento'),
        'pessoa_sexo': d.get('pessoaSexo'),
        'logradouro': d.get('logradouro'),
        'numero': str(d['numero']) if d.get('numero') is not None else None,
        'bairro': d.get('bairro'),
        'cidade_nome': d.get('cidadeNome'),
        'estado_sigla': d.get('estadoSigla'),
        'cep': d.get('cep'),
        'valor_total': d.get('valorTotal'),
        'valor_personalizacao': d.get('valorPersonalizacao'),
        'credito_utilizado': d.get('creditoUtilizado'),
        'cashback_utilizado': d.get('cashbackUtilizado'),
        'pedido_situacao_tipo': str(d['pedidoSituacaoTipo']) if d.get('pedidoSituacaoTipo') is not None else None,
        'pedido_situacao_descricao': d.get('pedidoSituacaoDescricao'),
        'raw': d,
        'synced_at': time.strftime('%Y-%m-%dT%H:%M:%S+00:00', time.gmtime()),
    }

# Upsert batch --------------------------------------------------------------
def upsert(rows):
    if not rows: return 0
    body = json.dumps(rows).encode()
    req = urllib.request.Request(
        f'{SB_URL}/rest/v1/magazord_pedido_detalhe?on_conflict=id',
        data=body, method='POST',
        headers={
            'apikey': SB_ANON,
            'Authorization': f'Bearer {SB_ANON}',
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=minimal'
        })
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return len(rows) if r.status in (200, 201, 204) else 0
    except urllib.error.HTTPError as e:
        print(f'[upsert err {e.code}] {e.read().decode()[:300]}'); return 0

# Worker --------------------------------------------------------------------
def worker(codigo):
    d = fetch_detail(codigo)
    if not d: return ('skip', codigo)
    return ('ok', map_detail(d))

# Main ----------------------------------------------------------------------
def main():
    codes = get_pending_codes()
    print(f'[start] {len(codes)} pedidos pendentes (Jan-Abr 2026)', flush=True)
    rows, skipped, t0 = [], 0, time.time()
    for i, c in enumerate(codes, 1):
        kind, payload = worker(c)
        if kind == 'ok':
            rows.append(payload)
        else:
            skipped += 1
        # flush em batches de 50
        if len(rows) >= 50:
            n = upsert(rows)
            elapsed = time.time() - t0
            print(f'  [{i}/{len(codes)}] upsert {n} | skip {skipped} | {elapsed:.0f}s', flush=True)
            rows.clear()
        # gentle pacing pra nao re-trigger rate limit
        time.sleep(0.18)
    if rows:
        n = upsert(rows)
        print(f'  [final] upsert {n} | skip {skipped}', flush=True)
    print(f'[done] {time.time()-t0:.0f}s | skipped {skipped}', flush=True)

if __name__ == '__main__':
    main()
