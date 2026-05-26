#!/usr/bin/env python3
"""
Backfill drill em /caixas/{id} pra popular categoria_id + categoria_nome
nas 1.704 linhas existentes de bling_caixas_movimentacoes (Lote 3 fix FAI msg 13).

Estratégia:
- Pega lista de IDs com categoria_id IS NULL (separados por loja)
- Pra cada batch de 5 IDs, chama GET /caixas/{id} em paralelo (threading)
- Upsert via Supabase REST API com categoria_id + categoria_nome (JOIN local)
- Rate limit Bling: 3 req/s por app — 5 paralelo + sleep 1.7s = ~3/s

Uso:
  python backfill_bling_caixas_categoria.py
"""
import json, time, urllib.request, urllib.error, ssl, os, sys
from concurrent.futures import ThreadPoolExecutor, as_completed

# ─── Config ──────────────────────────────────────────────────────────────────
MGMT_TOKEN_PATH = r"C:\Users\Juan - Dana Jalecos\Documents\Sistema Marketing\TOKENS ANALYTICS\Token novo supabase.txt"
PROJECT_REF = "wltmiqbhziefusnzmmkt"
SUPA_URL = f"https://{PROJECT_REF}.supabase.co"
MGMT_URL = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"

LOJAS = [
    ("matriz", 203536978),
    ("bc", 203550865),
]

# ─── Helpers ─────────────────────────────────────────────────────────────────
ctx = ssl.create_default_context()
with open(MGMT_TOKEN_PATH) as f:
    MGMT_TOKEN = f.read().strip()

def mgmt_query(sql):
    req = urllib.request.Request(
        MGMT_URL,
        data=json.dumps({"query": sql}).encode(),
        headers={
            "Authorization": f"Bearer {MGMT_TOKEN}",
            "Content-Type": "application/json",
            "User-Agent": "curl/8.0",
        },
        method="POST"
    )
    return json.loads(urllib.request.urlopen(req, context=ctx, timeout=60).read())

def get_bling_token(empresa):
    rows = mgmt_query(f"SELECT (bling_token_get('{empresa}')).access_token AS t;")
    return rows[0]["t"]

def get_service_role_key():
    # Lê do vault
    rows = mgmt_query("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='supabase_service_role_key' LIMIT 1;")
    if rows and rows[0].get("decrypted_secret"):
        return rows[0]["decrypted_secret"]
    raise RuntimeError("service_role_key não está no vault")

def supa_upsert(rows, sr_key):
    """Bulk upsert via PostgREST."""
    if not rows:
        return 0
    req = urllib.request.Request(
        f"{SUPA_URL}/rest/v1/bling_caixas_movimentacoes?on_conflict=id_bling",
        data=json.dumps(rows).encode(),
        headers={
            "apikey": sr_key,
            "Authorization": f"Bearer {sr_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        method="POST"
    )
    try:
        urllib.request.urlopen(req, context=ctx, timeout=30)
        return len(rows)
    except urllib.error.HTTPError as e:
        print(f"  [upsert err {e.code}]", e.read().decode()[:200])
        return 0

def bling_get_caixa(caixa_id, bling_token):
    """GET /caixas/{id} retornando dict da resposta (com category)."""
    req = urllib.request.Request(
        f"https://api.bling.com.br/Api/v3/caixas/{caixa_id}",
        headers={
            "Authorization": f"Bearer {bling_token}",
            "Content-Type": "application/json",
        },
        method="GET"
    )
    try:
        resp = urllib.request.urlopen(req, context=ctx, timeout=30)
        return json.loads(resp.read())["data"]
    except urllib.error.HTTPError as e:
        if e.code == 429:
            time.sleep(5)
            return None  # retry depois
        print(f"  [bling err {e.code}] id={caixa_id}: {e.read().decode()[:100]}")
        return None
    except Exception as e:
        print(f"  [bling err] id={caixa_id}: {e}")
        return None

def norm_data(d):
    if not d: return None
    if "/" in d:
        dd, mm, yy = d.split("/")
        return f"{yy}-{mm}-{dd}"
    return d.split("T")[0]

def map_mov(d, loja_id, cat_nome_map):
    cat_id = (d.get("categoria") or {}).get("id")
    cat_nome = cat_nome_map.get(cat_id) if cat_id else None
    valor_raw = d.get("valor") or 0
    deb = d.get("debCred") == "D"
    valor = -abs(valor_raw) if deb else abs(valor_raw)
    cf = d.get("contaFinanceira") or {}
    origem = d.get("origem") or {}
    return {
        "id_bling": int(d["id"]),
        "loja_id": loja_id,
        "data": norm_data(d.get("data")) or "2025-01-01",
        "descricao": d.get("descricao"),
        "categoria_id": cat_id,
        "categoria_nome": cat_nome,
        "conta_financeira_id": cf.get("id") or 0,
        "conta_financeira_nome": cf.get("descricao"),
        "valor": valor,
        "situacao": d.get("situacao") or "R",
        "situacao_conciliacao": None,
        "origem_id": origem.get("id"),
        "origem_tipo": origem.get("tipo"),
        "documento": None,
        "raw": d,
        "synced_at": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
    }

# ─── Main ────────────────────────────────────────────────────────────────────
def backfill_loja(empresa, loja_id, sr_key):
    print(f"\n[{empresa}] === loja_id={loja_id} ===")

    # IDs sem categoria
    rows = mgmt_query(f"SELECT id_bling FROM bling_caixas_movimentacoes WHERE loja_id={loja_id} AND categoria_id IS NULL ORDER BY id_bling;")
    ids = [int(r["id_bling"]) for r in rows]
    print(f"[{empresa}] {len(ids)} IDs sem categoria_id pra drillar")

    if not ids:
        print(f"[{empresa}] nada a fazer")
        return

    # Cache de nomes
    cat_rows = mgmt_query(f"SELECT id_bling, nome FROM bling_categorias WHERE loja_id={loja_id};")
    cat_nome_map = {int(r["id_bling"]): r["nome"] for r in cat_rows}
    print(f"[{empresa}] {len(cat_nome_map)} categorias no cache")

    token = get_bling_token(empresa)
    print(f"[{empresa}] token Bling OK ({token[:20]}...)")

    upserted, errs, t0 = 0, 0, time.time()
    BATCH = 5
    for i in range(0, len(ids), BATCH):
        batch = ids[i:i+BATCH]
        with ThreadPoolExecutor(max_workers=BATCH) as ex:
            futures = {ex.submit(bling_get_caixa, cid, token): cid for cid in batch}
            payloads = [f.result() for f in as_completed(futures)]

        rows_to_upsert = []
        for p in payloads:
            if p is None:
                errs += 1
                continue
            try:
                rows_to_upsert.append(map_mov(p, loja_id, cat_nome_map))
            except Exception as e:
                print(f"  [map err] {e}")
                errs += 1

        if rows_to_upsert:
            n = supa_upsert(rows_to_upsert, sr_key)
            upserted += n

        if (i // BATCH) % 20 == 0:
            elapsed = time.time() - t0
            rate = (i + BATCH) / elapsed if elapsed > 0 else 0
            eta = (len(ids) - i - BATCH) / rate / 60 if rate > 0 else 999
            print(f"  [{empresa}] [{i+BATCH}/{len(ids)}] upsert={upserted} err={errs} | {elapsed:.0f}s | {rate:.1f}/s | ETA {eta:.0f}min")

        # rate limit: 5 paralelos + sleep 1.7s = ~3/s sustained
        time.sleep(1.7)

    print(f"[{empresa}] DONE em {(time.time()-t0)/60:.1f}min: upsert={upserted} err={errs}")

def main():
    sr_key = get_service_role_key()
    print(f"service_role_key OK ({sr_key[:30]}...)")
    for empresa, loja_id in LOJAS:
        backfill_loja(empresa, loja_id, sr_key)
    print("\n[ALL DONE]")

if __name__ == "__main__":
    main()
