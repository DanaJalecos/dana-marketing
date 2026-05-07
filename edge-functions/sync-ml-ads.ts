// ════════════════════════════════════════════════════════════════════
// sync-ml-ads — Mercado Ads (Product Ads) campaigns + métricas + diário
// ════════════════════════════════════════════════════════════════════
// Cron diário (06:25 BRT) + invocação manual.
// Body: { dias_atras?: number (default 90) }
//
// Reusa o pattern de auth do sync-ml-analytics (getValidToken refresca
// access_token via OAuth quando faltam <5min pra expirar).
//
// 1) Resolve advertiser_id via /advertising/advertisers?product_id=PADS
// 2) GET /campaigns/search com aggregation=campaign pros 3 períodos (7d/30d/90d)
//    → upsert em analytics_ml_ads_campanhas + analytics_ml_ads_metricas
// 3) GET /campaigns/search com aggregation=daily 90d
//    → upsert em analytics_ml_ads_diario
// ════════════════════════════════════════════════════════════════════

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
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

// ── Supabase REST helpers ───────────────────────────
async function supaSelect(path: string): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SR, Authorization: `Bearer ${SR}` },
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
        apikey: SR,
        Authorization: `Bearer ${SR}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(slice),
    })
    if (!res.ok)
      throw new Error(`upsert ${table} ${res.status}: ${(await res.text()).slice(0, 300)}`)
    total += slice.length
  }
  return total
}

// ── ML OAuth (mesmo pattern de sync-ml-analytics) ──────────
async function getValidToken(): Promise<string> {
  let conn: any = null
  try {
    const rows = await supaSelect(
      `analytics_ml_connections?ml_user_id=eq.${ML_USER_ID}&select=*&limit=1`
    )
    conn = rows[0] || null
  } catch (e) {
    console.warn('[ml-ads] read connections falhou:', e)
  }
  if (conn?.access_token && conn.expires_at) {
    const expMs = new Date(conn.expires_at).getTime()
    if (Date.now() < expMs - 5 * 60 * 1000) return conn.access_token
  }
  const refreshToken = conn?.refresh_token || ML_REFRESH_FALLBACK
  if (!refreshToken) throw new Error('Sem refresh_token (banco vazio + secret vazio)')
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: ML_CLIENT_ID,
    client_secret: ML_CLIENT_SECRET,
    refresh_token: refreshToken,
  })
  const res = await fetch(`${ML_API}/oauth/token`, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`OAuth ${res.status}: ${txt.slice(0, 300)}`)
  }
  const data = await res.json()
  const expiresAt = new Date(Date.now() + (data.expires_in || 21600) * 1000).toISOString()
  await supaUpsert(
    'analytics_ml_connections',
    [
      {
        ml_user_id: ML_USER_ID,
        ml_nickname: 'DANA_JALECOS',
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: expiresAt,
        scopes: data.scope || null,
        updated_at: new Date().toISOString(),
      },
    ],
    'ml_user_id'
  )
  return data.access_token
}

// ── ML Ads API helpers ─────────────────────────────
async function mlAdsGet(path: string, token: string): Promise<any> {
  const url = path.startsWith('http') ? path : `${ML_API}${path}`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'api-version': '2',
      Accept: 'application/json',
    },
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`ml-ads ${res.status} ${path}: ${txt.slice(0, 300)}`)
  }
  return res.json()
}

async function getAdvertiserId(token: string): Promise<number> {
  // /advertising/advertisers usa api-version: 1, não 2
  const res = await fetch(`${ML_API}/advertising/advertisers?product_id=PADS`, {
    headers: { Authorization: `Bearer ${token}`, 'api-version': '1' },
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`advertisers ${res.status}: ${txt.slice(0, 300)}`)
  }
  const data = await res.json()
  const adv = (data.advertisers || []).find((a: any) => a.site_id === 'MLB')
  if (!adv) throw new Error('Nenhum advertiser MLB encontrado (conta nunca usou Mercado Ads?)')
  return adv.advertiser_id
}

const METRICS = [
  'clicks',
  'prints',
  'cost',
  'acos',
  'total_amount',
  'direct_amount',
  'indirect_amount',
  'roas',
  'cpc',
  'ctr',
  'cvr',
  'direct_units_quantity',
  'indirect_units_quantity',
  'units_quantity',
].join(',')

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10)
}
function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

// Pega métrica do shape correto (3 lugares possíveis no JSON do ML)
function pickMetricsField(row: any, field: string): number {
  const m = row.metrics_summary ?? row.metrics ?? row
  const v = m[field]
  return typeof v === 'number' ? v : 0
}

// ── Sync principal ───────────────────────────────
async function sync(opts: { diasAtras: number }) {
  const advertiser_id = await getAdvertiserId(await getValidToken())
  const token = await getValidToken()  // refresca uma vez antes da batch (~5 calls)

  const today = new Date()
  const periodos = [
    { p: '7d',  diasAtras: 7  },
    { p: '30d', diasAtras: 30 },
    { p: '90d', diasAtras: 90 },
  ]

  const campanhasMap: Record<string, any> = {}
  const metricasRows: any[] = []

  // 3 chamadas: 1 por período (aggregation=campaign)
  for (const { p, diasAtras } of periodos) {
    const dateFrom = isoDate(daysAgo(diasAtras))
    const dateTo = isoDate(today)
    const url =
      `/marketplace/advertising/MLB/advertisers/${advertiser_id}/product_ads/campaigns/search` +
      `?metrics=${METRICS}&aggregation_type=campaign&date_from=${dateFrom}&date_to=${dateTo}&limit=100`
    const data = await mlAdsGet(url, token)
    const results = data.results || data.campaigns || []
    for (const c of results) {
      // Cache config da campanha (1 row por id)
      if (!campanhasMap[c.id]) {
        campanhasMap[c.id] = {
          campaign_id: c.id,
          advertiser_id,
          name: (c.name || '').trim(),
          status: c.status || null,
          strategy: c.strategy || null,
          channel: c.channel || null,
          budget: c.budget ?? null,
          acos_target: c.acos_target ?? null,
          acos_top_search_target: c.acos_top_search_target ?? null,
          roas_target: c.roas_target ?? null,
          automatic_budget: c.automatic_budget ?? null,
          date_created: c.date_created || null,
          last_updated: c.last_updated || null,
          raw: c,
          synced_at: new Date().toISOString(),
        }
      }
      // 1 row de métricas por (campaign_id, periodo)
      metricasRows.push({
        campaign_id: c.id,
        periodo: p,
        date_from: dateFrom,
        date_to: dateTo,
        clicks: pickMetricsField(c, 'clicks'),
        prints: pickMetricsField(c, 'prints'),
        cost: pickMetricsField(c, 'cost'),
        cpc: pickMetricsField(c, 'cpc'),
        ctr: pickMetricsField(c, 'ctr'),
        cvr: pickMetricsField(c, 'cvr'),
        acos: pickMetricsField(c, 'acos'),
        roas: pickMetricsField(c, 'roas'),
        total_amount: pickMetricsField(c, 'total_amount'),
        direct_amount: pickMetricsField(c, 'direct_amount'),
        indirect_amount: pickMetricsField(c, 'indirect_amount'),
        direct_units_quantity: pickMetricsField(c, 'direct_units_quantity'),
        indirect_units_quantity: pickMetricsField(c, 'indirect_units_quantity'),
        units_quantity: pickMetricsField(c, 'units_quantity'),
        synced_at: new Date().toISOString(),
      })
    }
  }

  // 4ª chamada: aggregation=daily, último período (90d)
  const dateFromDaily = isoDate(daysAgo(opts.diasAtras))
  const dateToDaily = isoDate(today)
  const urlDaily =
    `/marketplace/advertising/MLB/advertisers/${advertiser_id}/product_ads/campaigns/search` +
    `?metrics=${METRICS}&aggregation_type=daily&date_from=${dateFromDaily}&date_to=${dateToDaily}&limit=100`
  const dataDaily = await mlAdsGet(urlDaily, token)
  const diasResults = dataDaily.results || []
  const diariosRows = diasResults.map((row: any) => {
    const data = row.date || row.aggregation_value || row.period
    return {
      data,
      advertiser_id,
      clicks: pickMetricsField(row, 'clicks'),
      prints: pickMetricsField(row, 'prints'),
      cost: pickMetricsField(row, 'cost'),
      cpc: pickMetricsField(row, 'cpc'),
      ctr: pickMetricsField(row, 'ctr'),
      cvr: pickMetricsField(row, 'cvr'),
      acos: pickMetricsField(row, 'acos'),
      roas: pickMetricsField(row, 'roas'),
      total_amount: pickMetricsField(row, 'total_amount'),
      direct_amount: pickMetricsField(row, 'direct_amount'),
      indirect_amount: pickMetricsField(row, 'indirect_amount'),
      units_quantity: pickMetricsField(row, 'units_quantity'),
      synced_at: new Date().toISOString(),
    }
  })

  // Upserts
  const campRows = Object.values(campanhasMap)
  const nCamp = await supaUpsert('analytics_ml_ads_campanhas', campRows, 'campaign_id')
  const nMetr = await supaUpsert('analytics_ml_ads_metricas', metricasRows, 'campaign_id,periodo')
  const nDia = await supaUpsert('analytics_ml_ads_diario', diariosRows, 'data,advertiser_id')

  return {
    advertiser_id,
    campanhas: nCamp,
    metricas: nMetr,
    dias: nDia,
    periodos: periodos.map(p => p.p),
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    const diasAtras = Math.max(1, Math.min(90, parseInt(body.dias_atras) || 90))
    const out = await sync({ diasAtras })
    return json({ ok: true, ...out })
  } catch (e) {
    console.error('[ml-ads sync] erro:', e)
    return json({ ok: false, error: (e as Error).message || String(e) }, 500)
  }
})
