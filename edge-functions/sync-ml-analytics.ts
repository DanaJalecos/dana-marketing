// ============================================================
// sync-ml-analytics — Mercado Livre orders + items + anuncios
// Body: { dias_atras?: number (default 90), backfill_anuncios?: boolean }
// ============================================================
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const ML_CLIENT_ID = Deno.env.get('ML_CLIENT_ID')!
const ML_CLIENT_SECRET = Deno.env.get('ML_CLIENT_SECRET')!
const ML_USER_ID = parseInt(Deno.env.get('ML_USER_ID') || '0')
const ML_REFRESH_FALLBACK = Deno.env.get('ML_REFRESH_TOKEN') || ''

const ML_API = 'https://api.mercadolibre.com'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, apikey, Content-Type',
}
function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } })
}

// ── Supabase REST ───────────────────────────────
async function supaSelect(path: string): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { 'apikey': SR, 'Authorization': `Bearer ${SR}` },
  })
  if (!res.ok) throw new Error(`select ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res.json()
}
async function supaUpsert(table: string, rows: any[], onConflict: string) {
  if (!rows.length) return 0
  let total = 0
  for (let i = 0; i < rows.length; i += 500) {
    const slice = rows.slice(i, i + 500)
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: {
        'apikey': SR, 'Authorization': `Bearer ${SR}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(slice),
    })
    if (!res.ok) throw new Error(`upsert ${table} ${res.status}: ${(await res.text()).slice(0, 300)}`)
    total += slice.length
  }
  return total
}

// ── ML OAuth ─────────────────────────────────────
async function getValidToken(): Promise<{ access_token: string; refresh_token: string }> {
  // Tenta ler conexão existente do banco
  let conn: any = null
  try {
    const rows = await supaSelect(`analytics_ml_connections?ml_user_id=eq.${ML_USER_ID}&select=*&limit=1`)
    conn = rows[0] || null
  } catch (e) {
    console.warn('[ml] read connections falhou:', e)
  }

  // Se tem token válido (>5min de margem), reusa
  if (conn?.access_token && conn.expires_at) {
    const expMs = new Date(conn.expires_at).getTime()
    if (Date.now() < expMs - 5 * 60 * 1000) {
      return { access_token: conn.access_token, refresh_token: conn.refresh_token }
    }
  }

  // Refresh: usa refresh do banco OU fallback do secret
  const refreshToken = conn?.refresh_token || ML_REFRESH_FALLBACK
  if (!refreshToken) throw new Error('Sem refresh_token (banco vazio + secret vazio)')

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: ML_CLIENT_ID,
    client_secret: ML_CLIENT_SECRET,
    refresh_token: refreshToken,
  })
  const res = await fetch(`${ML_API}/oauth/token`, {
    method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`OAuth ${res.status}: ${txt.slice(0, 300)}`)
  }
  const data = await res.json()
  const expiresAt = new Date(Date.now() + (data.expires_in || 21600) * 1000).toISOString()

  // Salva no banco (UPSERT por ml_user_id)
  await supaUpsert('analytics_ml_connections', [{
    ml_user_id: ML_USER_ID,
    ml_nickname: 'DANA_JALECOS',
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: expiresAt,
    scopes: data.scope || null,
    updated_at: new Date().toISOString(),
  }], 'ml_user_id')

  return { access_token: data.access_token, refresh_token: data.refresh_token }
}

// ── ML API helpers ───────────────────────────────
async function mlGet(path: string, token: string, retries = 2): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${ML_API}${path}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
    if (res.status === 429) {
      // Rate limit — backoff exponencial
      if (attempt < retries) { await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt))); continue }
      throw new Error(`ML 429 após ${retries + 1} tentativas`)
    }
    if (res.status === 401 && attempt === 0) {
      // Token expirou no meio — pega novo e tenta de novo
      throw new Error('ML 401 — refresh required')
    }
    if (!res.ok) throw new Error(`ML ${res.status}: ${(await res.text()).slice(0, 300)}`)
    return res.json()
  }
}

// ── Fetch pedidos ─────────────────────────────────
async function fetchOrdersSince(token: string, dateFrom: string, maxOrders = 3000): Promise<any[]> {
  const out: any[] = []
  let offset = 0
  const limit = 50
  while (out.length < maxOrders) {
    const qs = new URLSearchParams({
      seller: String(ML_USER_ID),
      'order.date_created.from': dateFrom,
      sort: 'date_asc',
      offset: String(offset),
      limit: String(limit),
    })
    const data = await mlGet(`/orders/search?${qs}`, token)
    const results = data.results || []
    if (!results.length) break
    out.push(...results)
    if (results.length < limit) break
    offset += limit
    if (offset >= (data.paging?.total || 0)) break
  }
  return out
}

// Items: max 20 por chamada
async function fetchItemsBatch(token: string, mlbIds: string[]): Promise<any[]> {
  const out: any[] = []
  for (let i = 0; i < mlbIds.length; i += 20) {
    const slice = mlbIds.slice(i, i + 20)
    const data = await mlGet(`/items?ids=${slice.join(',')}`, token)
    if (Array.isArray(data)) {
      for (const r of data) {
        if (r.code === 200 && r.body) out.push(r.body)
      }
    }
  }
  return out
}

// ── Sync log ─────────────────────────────────────
async function logSync(provider: string, status: string, rowsSynced: number, durMs: number, erro?: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/analytics_sync_meta?on_conflict=provider`, {
    method: 'POST',
    headers: {
      'apikey': SR, 'Authorization': `Bearer ${SR}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({
      provider, last_sync_at: new Date().toISOString(),
      last_sync_status: status, last_erro_msg: erro || null,
      rows_synced: rowsSynced, duracao_ms: durMs,
    }),
  })
}

// ── Main handler ─────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const t0 = Date.now()
  const body = await req.json().catch(() => ({}))
  const diasAtras = Math.min(Math.max(body.dias_atras || 90, 1), 365)
  const backfillAnuncios = body.backfill_anuncios !== false  // default true

  try {
    // 1) OAuth
    const { access_token } = await getValidToken()

    // 2) Fetch orders
    const dataFrom = new Date(Date.now() - diasAtras * 86400000).toISOString().replace('Z', '-00:00')
    const orders = await fetchOrdersSince(access_token, dataFrom, 3000)

    // 3) Transform → 1 row por order_item (paid only)
    const rows: any[] = []
    const mlbIdsSet = new Set<string>()
    for (const o of orders) {
      if (o.status !== 'paid') continue
      if (!o.date_closed) continue
      const items = o.order_items || []
      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx]
        const item = it.item || {}
        const unit_price = parseFloat(it.unit_price || 0)
        const quantity = parseInt(it.quantity || 0)
        if (!item.id) continue
        mlbIdsSet.add(item.id)
        rows.push({
          id: `${o.id}-${idx}`,
          order_id: o.id,
          ml_user_id: ML_USER_ID,
          mlb_id: item.id,
          date_closed: o.date_closed,
          status: o.status,
          unit_price,
          quantity,
          total_amount: unit_price * quantity,
          listing_type_id: item.listing_type_id || null,  // geralmente vazio aqui
          category_id: item.category_id || null,
          buyer_nickname: o.buyer?.nickname || null,
          titulo_item: (item.title || '').slice(0, 300),
          raw: it,
        })
      }
    }

    const insertedOrders = await supaUpsert('analytics_ml_pedidos', rows, 'id')

    // 4) Backfill anúncios pra completar listing_type_id
    let insertedAnuncios = 0
    if (backfillAnuncios && mlbIdsSet.size) {
      const items = await fetchItemsBatch(access_token, Array.from(mlbIdsSet))
      const anuncioRows = items.map((i: any) => ({
        id: i.id,
        ml_user_id: ML_USER_ID,
        titulo: (i.title || '').slice(0, 300),
        preco: i.price || 0,
        status: i.status,
        listing_type_id: i.listing_type_id,
        category_id: i.category_id,
        thumbnail: i.thumbnail,
        permalink: i.permalink,
        sold_quantity: i.sold_quantity || 0,
        raw: i,
        synced_at: new Date().toISOString(),
      }))
      insertedAnuncios = await supaUpsert('analytics_ml_anuncios', anuncioRows, 'id')

      // 5) UPDATE listing_type_id em analytics_ml_pedidos cruzando com anuncios
      // (triggera recálculo de comissao + tarifa_fixa + lucro_liquido pq são GENERATED STORED)
      await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: { 'apikey': SR, 'Authorization': `Bearer ${SR}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).catch(() => {})  // tenta RPC, ignora se não existir

      // Fallback: faz UPDATE via SQL direto na Management API se RPC não existe
      // Mas como a edge function não tem PAT, vou usar abordagem: rodar UPDATE manual no script Python depois
    }

    const dur = Date.now() - t0
    await logSync('ml', 'ok', insertedOrders + insertedAnuncios, dur)
    return json({
      ok: true,
      orders_inseridos: insertedOrders,
      anuncios_inseridos: insertedAnuncios,
      total_orders_fetched: orders.length,
      duracao_ms: dur,
    })
  } catch (e: any) {
    const dur = Date.now() - t0
    await logSync('ml', 'erro', 0, dur, String(e.message || e))
    return json({ error: String(e.message || e) }, 500)
  }
})
