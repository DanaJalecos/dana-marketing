#!/usr/bin/env python3
"""
Backfill forma_pagamento_id + conta_financeira_id + categoria_id
em contas_pagar e contas_receber (matriz + bc).
Pedido FAI 28/05.

LIST /contas/{tipo} nao traz esses campos. Drill /contas/{tipo}/{id} traz.
- Rate-limit: 3 paralelos + sleep 1.5s = ~2 req/s sustained
- Limite Bling: 3 req/s -> seguro
"""
import json, time, urllib.request, urllib.error, ssl
from concurrent.futures import ThreadPoolExecutor, as_completed

MGMT_TOKEN_PATH = r"C:\Users\Juan - Dana Jalecos\Documents\Sistema Marketing\TOKENS ANALYTICS\Token novo supabase.txt"
PROJECT_REF = "wltmiqbhziefusnzmmkt"
SUPA_URL = f"https://{PROJECT_REF}.supabase.co"
MGMT_URL = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"

ctx = ssl.create_default_context()
with open(MGMT_TOKEN_PATH) as f:
    MGMT_TOKEN = f.read().strip()

def mgmt_query(sql):
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
    except urllib.error.HTTPError as e:
        print(f"  [supa err {e.code}] id={id_}: {e.read().decode()[:100]}")
        return False

def bling_get_conta(tipo, conta_id, bling_token, retry=0):
    """tipo: 'pagar' | 'receber'"""
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
            time.sleep(4 * (2 ** retry))
            return bling_get_conta(tipo, conta_id, bling_token, retry + 1)
        if e.code == 429:
            return None
        if e.code == 404:
            return "deleted"
        print(f"  [bling err {e.code}] {tipo}/{conta_id}")
        return None

def backfill(empresa, tipo, tabela, sr_key, prioridade='abertos'):
    """prioridade: 'abertos' | 'pagos_60d' | 'pagos_resto'"""
    print(f"\n[{empresa}/{tipo}/{prioridade}] === ===")
    if prioridade == 'abertos':
        where = "situacao IN (1, 3, 5)"
        order = "vencimento DESC"
    elif prioridade == 'pagos_60d':
        where = "situacao = 2 AND vencimento >= CURRENT_DATE - 60"
        order = "vencimento DESC"
    else:
        where = "situacao NOT IN (1, 3, 5) AND (situacao <> 2 OR vencimento < CURRENT_DATE - 60)"
        order = "vencimento DESC"
    rows = mgmt_query(
        f"SELECT id FROM {tabela} WHERE empresa='{empresa}' "
        f"AND forma_pagamento_id IS NULL AND {where} "
        f"ORDER BY {order};"
    )
    ids = [int(r["id"]) for r in rows]
    print(f"[{empresa}/{tipo}/{prioridade}] {len(ids)} pra drillar")
    if not ids: return

    token = get_bling_token(empresa)
    print(f"[{empresa}/{tipo}] token OK ({token[:20]}...)")

    up, err, deleted, t0 = 0, 0, 0, time.time()
    BATCH = 3
    for i in range(0, len(ids), BATCH):
        batch = ids[i:i+BATCH]
        with ThreadPoolExecutor(max_workers=BATCH) as ex:
            futures = {ex.submit(bling_get_conta, tipo, cid, token): cid for cid in batch}
            results = []
            for f in as_completed(futures):
                results.append((futures[f], f.result()))

        for cid, payload in results:
            if payload is None: err += 1; continue
            if payload == "deleted": deleted += 1; continue
            update = {
                "forma_pagamento_id": (payload.get("formaPagamento") or {}).get("id"),
                "conta_financeira_id": (payload.get("portador") or {}).get("id"),
                "categoria_id": (payload.get("categoria") or {}).get("id"),
            }
            # Limpa nulls (PATCH parcial)
            update = {k: v for k, v in update.items() if v is not None}
            if not update: err += 1; continue
            if supa_update(tabela, cid, update, sr_key):
                up += 1
            else:
                err += 1

        if (i // BATCH) % 50 == 0:
            elapsed = time.time() - t0
            rate = (i + BATCH) / elapsed if elapsed > 0 else 0
            eta = (len(ids) - i - BATCH) / rate / 60 if rate > 0 else 999
            print(f"  [{empresa}/{tipo}] [{i+BATCH}/{len(ids)}] up={up} err={err} del={deleted} | {elapsed:.0f}s | {rate:.1f}/s | ETA {eta:.0f}min")

        time.sleep(1.5)
    print(f"[{empresa}/{tipo}] DONE {(time.time()-t0)/60:.1f}min: up={up} err={err} del={deleted}")

def main():
    sr_key = get_service_role_key()
    print(f"service_role OK ({sr_key[:30]}...)")
    # FAI msg 20: priorizar abertos -> pagos 60d -> resto
    combinacoes = [
        ('matriz', 'receber', 'contas_receber'),
        ('bc',     'receber', 'contas_receber'),
        ('matriz', 'pagar',   'contas_pagar'),
    ]
    for prio in ['abertos', 'pagos_60d', 'pagos_resto']:
        print(f"\n{'='*60}\nPRIORIDADE: {prio}\n{'='*60}")
        for (empresa, tipo, tabela) in combinacoes:
            backfill(empresa, tipo, tabela, sr_key, prioridade=prio)
    print("\n[ALL DONE]")

if __name__ == "__main__":
    main()
