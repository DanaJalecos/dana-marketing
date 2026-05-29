#!/usr/bin/env python3
"""
Backfill contas forma_pagamento_id - VERSAO RAPIDA
- Roda 3 threads em paralelo (1 por combinacao empresa/tipo)
- Cada thread: 5 paralelos + sleep 0.7s = ~7 req/s burst, ~3 req/s sustained
- Threads matriz/receber e matriz/pagar dividem rate-limit Bling matriz (3/s)
- Thread bc/receber tem rate-limit BC isolado (mais 3/s)
ETA esperado: ~1h pra todos os ~23k.
"""
import json, time, urllib.request, urllib.error, ssl, threading
from concurrent.futures import ThreadPoolExecutor, as_completed

MGMT_TOKEN_PATH = r"C:\Users\Juan - Dana Jalecos\Documents\Sistema Marketing\TOKENS ANALYTICS\Token novo supabase.txt"
PROJECT_REF = "wltmiqbhziefusnzmmkt"
SUPA_URL = f"https://{PROJECT_REF}.supabase.co"
MGMT_URL = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"

ctx = ssl.create_default_context()
with open(MGMT_TOKEN_PATH) as f:
    MGMT_TOKEN = f.read().strip()

mgmt_lock = threading.Lock()

def mgmt_query(sql):
    with mgmt_lock:
        req = urllib.request.Request(
            MGMT_URL, data=json.dumps({"query": sql}).encode(),
            headers={"Authorization": f"Bearer {MGMT_TOKEN}", "Content-Type": "application/json", "User-Agent": "curl/8.0"},
            method="POST"
        )
        return json.loads(urllib.request.urlopen(req, context=ctx, timeout=60).read())

def get_bling_token(empresa):
    return mgmt_query(f"SELECT (bling_token_get('{empresa}')).access_token AS t;")[0]["t"]

def get_service_role_key():
    rows = mgmt_query("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='supabase_service_role_key' LIMIT 1;")
    return rows[0]["decrypted_secret"]

def supa_update(tabela, id_, payload, sr_key):
    req = urllib.request.Request(
        f"{SUPA_URL}/rest/v1/{tabela}?id=eq.{id_}",
        data=json.dumps(payload).encode(),
        headers={
            "apikey": sr_key, "Authorization": f"Bearer {sr_key}",
            "Content-Type": "application/json", "Prefer": "return=minimal",
        },
        method="PATCH"
    )
    try:
        urllib.request.urlopen(req, context=ctx, timeout=30)
        return True
    except urllib.error.HTTPError:
        return False

def bling_get_conta(tipo, conta_id, bling_token, retry=0):
    req = urllib.request.Request(
        f"https://api.bling.com.br/Api/v3/contas/{tipo}/{conta_id}",
        headers={"Authorization": f"Bearer {bling_token}", "Content-Type": "application/json"},
        method="GET"
    )
    try:
        resp = urllib.request.urlopen(req, context=ctx, timeout=30)
        return json.loads(resp.read())["data"]
    except urllib.error.HTTPError as e:
        if e.code == 429 and retry < 3:
            time.sleep(2 * (2 ** retry))
            return bling_get_conta(tipo, conta_id, bling_token, retry + 1)
        if e.code == 404:
            return "deleted"
        return None

def backfill_thread(empresa, tipo, tabela, sr_key, label):
    # IDs prioritizados (abertos primeiro)
    rows = mgmt_query(
        f"SELECT id FROM {tabela} WHERE empresa='{empresa}' "
        f"AND forma_pagamento_id IS NULL "
        f"ORDER BY (CASE WHEN situacao IN (1,3,5) THEN 0 "
        f"               WHEN situacao=2 AND vencimento >= CURRENT_DATE - 60 THEN 1 "
        f"               ELSE 2 END), vencimento DESC NULLS LAST;"
    )
    ids = [int(r["id"]) for r in rows]
    print(f"[{label}] {len(ids)} pra drillar")
    if not ids: return

    token = get_bling_token(empresa)
    up, err, deleted, t0 = 0, 0, 0, time.time()
    BATCH = 5
    for i in range(0, len(ids), BATCH):
        batch = ids[i:i+BATCH]
        with ThreadPoolExecutor(max_workers=BATCH) as ex:
            futures = {ex.submit(bling_get_conta, tipo, cid, token): cid for cid in batch}
            results = [(futures[f], f.result()) for f in as_completed(futures)]

        for cid, payload in results:
            if payload is None: err += 1; continue
            if payload == "deleted": deleted += 1; continue
            update = {
                "forma_pagamento_id": (payload.get("formaPagamento") or {}).get("id"),
                "conta_financeira_id": (payload.get("portador") or {}).get("id"),
                "categoria_id": (payload.get("categoria") or {}).get("id"),
            }
            update = {k: v for k, v in update.items() if v is not None}
            if not update: err += 1; continue
            if supa_update(tabela, cid, update, sr_key):
                up += 1
            else:
                err += 1

        if (i // BATCH) % 100 == 0:
            elapsed = time.time() - t0
            rate = (i + BATCH) / elapsed if elapsed > 0 else 0
            eta = (len(ids) - i - BATCH) / rate / 60 if rate > 0 else 999
            print(f"  [{label}] [{i+BATCH}/{len(ids)}] up={up} err={err} del={deleted} | {elapsed:.0f}s | {rate:.1f}/s | ETA {eta:.0f}min")

        # rate burst control: 5 paralelos / 0.7s = ~7 req/s burst, mas Bling cuida do limite
        time.sleep(0.7)
    print(f"[{label}] DONE {(time.time()-t0)/60:.1f}min: up={up} err={err} del={deleted}")

def main():
    sr_key = get_service_role_key()
    print(f"service_role OK, kicking 3 threads paralelas...")

    threads = [
        threading.Thread(target=backfill_thread, args=('matriz', 'receber', 'contas_receber', sr_key, 'matriz/cr')),
        threading.Thread(target=backfill_thread, args=('bc',     'receber', 'contas_receber', sr_key, 'bc/cr')),
        threading.Thread(target=backfill_thread, args=('matriz', 'pagar',   'contas_pagar',   sr_key, 'matriz/cp')),
    ]
    for t in threads: t.start()
    for t in threads: t.join()
    print("\n[ALL DONE]")

if __name__ == "__main__":
    main()
