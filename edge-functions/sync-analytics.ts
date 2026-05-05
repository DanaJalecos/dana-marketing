// ============================================================
// sync-analytics — sync de Google Analytics 4 + Google Ads
// Body: { provider?: 'all'|'ga4'|'ads', dias_atras?: number }
// ============================================================
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CLIENT_ID = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')!
const CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET')!

const GA4_REFRESH = Deno.env.get('GA4_REFRESH_TOKEN')!
const GA4_PROPERTY = Deno.env.get('GA4_PROPERTY_ID')!

const GADS_REFRESH = Deno.env.get('GADS_REFRESH_TOKEN')!
const GADS_DEV_TOKEN = Deno.env.get('GADS_DEVELOPER_TOKEN')!
const GADS_CUSTOMER = Deno.env.get('GADS_CUSTOMER_ID')!

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, apikey, Content-Type',
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

// ─── OAuth ───────────────────────────────────────────────
async function getAccessToken(refreshToken: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    refresh_token: refreshToken, grant_type: 'refresh_token',
  })
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  if (!res.ok) throw new Error(`OAuth ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  return data.access_token
}

// ─── Supabase REST helpers ───────────────────────────────
async function upsert(table: string, rows: any[], onConflict: string) {
  if (!rows.length) return 0
  // Em batches de 500 pra evitar payload muito grande
  let total = 0
  for (let i = 0; i < rows.length; i += 500) {
    const slice = rows.slice(i, i + 500)
    const url = `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`
    const res = await fetch(url, {
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

async function logSync(provider: string, status: string, rowsSynced: number, durMs: number, erro?: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/analytics_sync_meta?on_conflict=provider`, {
    method: 'POST',
    headers: {
      'apikey': SR, 'Authorization': `Bearer ${SR}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({
      provider,
      last_sync_at: new Date().toISOString(),
      last_sync_status: status,
      last_erro_msg: erro || null,
      rows_synced: rowsSynced,
      duracao_ms: durMs,
    }),
  })
}

// ─── GA4 helpers ────────────────────────────────────────
function ga4Date(d: string): string {
  // GA4 retorna data como YYYYMMDD; convertemos pra YYYY-MM-DD
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
}

async function ga4Query(token: string, body: any): Promise<any> {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY}:runReport`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`GA4 ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

async function syncGA4(diasAtras: number): Promise<{ rows: number }> {
  const token = await getAccessToken(GA4_REFRESH)
  const startDate = `${diasAtras}daysAgo`
  const endDate = 'today'

  let rows = 0

  // 1) Métricas diárias agregadas
  {
    const data = await ga4Query(token, {
      dateRanges: [{ startDate, endDate }],
      metrics: [
        { name: 'sessions' }, { name: 'totalUsers' }, { name: 'newUsers' },
        { name: 'screenPageViews' }, { name: 'bounceRate' },
        { name: 'averageSessionDuration' }, { name: 'conversions' },
        { name: 'totalRevenue' },
      ],
      dimensions: [{ name: 'date' }],
    })
    const out = (data.rows || []).map((r: any) => ({
      data: ga4Date(r.dimensionValues[0].value),
      sessions: parseInt(r.metricValues[0].value || '0'),
      users: parseInt(r.metricValues[1].value || '0'),
      new_users: parseInt(r.metricValues[2].value || '0'),
      page_views: parseInt(r.metricValues[3].value || '0'),
      bounce_rate: parseFloat(r.metricValues[4].value || '0'),
      avg_session_duration: parseFloat(r.metricValues[5].value || '0'),
      conversions: Math.round(parseFloat(r.metricValues[6].value || '0')),
      total_revenue: parseFloat(r.metricValues[7].value || '0'),
      updated_at: new Date().toISOString(),
    }))
    rows += await upsert('analytics_ga4_dia', out, 'data')
  }

  // 2) Por canal default
  {
    const data = await ga4Query(token, {
      dateRanges: [{ startDate, endDate }],
      metrics: [
        { name: 'sessions' }, { name: 'totalUsers' },
        { name: 'conversions' }, { name: 'totalRevenue' },
      ],
      dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }],
    })
    const out = (data.rows || []).map((r: any) => ({
      data: ga4Date(r.dimensionValues[0].value),
      canal: r.dimensionValues[1].value || 'Unassigned',
      sessions: parseInt(r.metricValues[0].value || '0'),
      users: parseInt(r.metricValues[1].value || '0'),
      conversions: Math.round(parseFloat(r.metricValues[2].value || '0')),
      total_revenue: parseFloat(r.metricValues[3].value || '0'),
    }))
    rows += await upsert('analytics_ga4_canais', out, 'data,canal')
  }

  // 3) Top páginas
  {
    const data = await ga4Query(token, {
      dateRanges: [{ startDate, endDate }],
      metrics: [
        { name: 'screenPageViews' }, { name: 'totalUsers' },
        { name: 'userEngagementDuration' },
      ],
      dimensions: [{ name: 'date' }, { name: 'pagePath' }, { name: 'pageTitle' }],
      limit: 1000,
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    })
    const out = (data.rows || []).map((r: any) => ({
      data: ga4Date(r.dimensionValues[0].value),
      page_path: (r.dimensionValues[1].value || '/').slice(0, 300),
      page_title: (r.dimensionValues[2].value || '').slice(0, 300),
      page_views: parseInt(r.metricValues[0].value || '0'),
      users: parseInt(r.metricValues[1].value || '0'),
      avg_engagement_time: parseFloat(r.metricValues[2].value || '0'),
    }))
    rows += await upsert('analytics_ga4_paginas', out, 'data,page_path')
  }

  // 4) Dispositivos
  {
    const data = await ga4Query(token, {
      dateRanges: [{ startDate, endDate }],
      metrics: [
        { name: 'sessions' }, { name: 'totalUsers' }, { name: 'conversions' },
      ],
      dimensions: [{ name: 'date' }, { name: 'deviceCategory' }],
    })
    const out = (data.rows || []).map((r: any) => ({
      data: ga4Date(r.dimensionValues[0].value),
      device_category: r.dimensionValues[1].value || 'unknown',
      sessions: parseInt(r.metricValues[0].value || '0'),
      users: parseInt(r.metricValues[1].value || '0'),
      conversions: Math.round(parseFloat(r.metricValues[2].value || '0')),
    }))
    rows += await upsert('analytics_ga4_dispositivos', out, 'data,device_category')
  }

  // 5) Top países/cidades
  {
    const data = await ga4Query(token, {
      dateRanges: [{ startDate, endDate }],
      metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
      dimensions: [{ name: 'date' }, { name: 'country' }, { name: 'city' }],
      limit: 500,
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    })
    const out = (data.rows || []).map((r: any) => ({
      data: ga4Date(r.dimensionValues[0].value),
      country: (r.dimensionValues[1].value || 'Unknown').slice(0, 100),
      city: (r.dimensionValues[2].value || '').slice(0, 100),
      sessions: parseInt(r.metricValues[0].value || '0'),
      users: parseInt(r.metricValues[1].value || '0'),
    }))
    rows += await upsert('analytics_ga4_paises', out, 'data,country,city')
  }

  return { rows }
}

// ─── Google Ads ─────────────────────────────────────────
async function adsQuery(token: string, gaql: string): Promise<any[]> {
  const url = `https://googleads.googleapis.com/v20/customers/${GADS_CUSTOMER}/googleAds:searchStream`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'developer-token': GADS_DEV_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: gaql }),
  })
  if (!res.ok) throw new Error(`Ads ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  // searchStream retorna array de batches
  const out: any[] = []
  if (Array.isArray(data)) {
    for (const b of data) (b.results || []).forEach((r: any) => out.push(r))
  } else if (data.results) {
    out.push(...data.results)
  }
  return out
}

async function syncAds(diasAtras: number): Promise<{ rows: number }> {
  const token = await getAccessToken(GADS_REFRESH)
  let rows = 0

  // Helper: range explícito (Ads só aceita LAST_7/14/30 nos enums; usar BETWEEN pra range custom)
  const today = new Date()
  const past = new Date(today)
  past.setDate(past.getDate() - diasAtras)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const dateRange = `BETWEEN '${fmt(past)}' AND '${fmt(today)}'`

  // 1) Daily aggregated (toda conta)
  {
    const gaql = `SELECT segments.date,
                    metrics.cost_micros, metrics.clicks, metrics.impressions,
                    metrics.conversions, metrics.conversions_value,
                    metrics.ctr, metrics.average_cpc
                  FROM customer
                  WHERE segments.date ${dateRange}`
    const results = await adsQuery(token, gaql)
    const out = results.map((r: any) => {
      const m = r.metrics || {}
      const cost = (parseInt(m.costMicros || '0')) / 1_000_000
      const conv = parseFloat(m.conversions || '0')
      const conv_value = parseFloat(m.conversionsValue || '0')
      const clicks = parseInt(m.clicks || '0')
      return {
        data: r.segments.date,
        cost,
        clicks,
        impressions: parseInt(m.impressions || '0'),
        conversions: conv,
        conversions_value: conv_value,
        ctr: parseFloat(m.ctr || '0'),
        cpc: clicks > 0 ? cost / clicks : 0,
        cpa: conv > 0 ? cost / conv : 0,
        roas: cost > 0 ? conv_value / cost : 0,
        updated_at: new Date().toISOString(),
      }
    })
    rows += await upsert('analytics_ads_dia', out, 'data')
  }

  // 2) Por campanha
  {
    const gaql = `SELECT segments.date,
                    campaign.id, campaign.name, campaign.status,
                    campaign.advertising_channel_type,
                    metrics.cost_micros, metrics.clicks, metrics.impressions,
                    metrics.conversions, metrics.conversions_value,
                    metrics.ctr, metrics.average_cpc
                  FROM campaign
                  WHERE segments.date ${dateRange}`
    const results = await adsQuery(token, gaql)
    const out = results.map((r: any) => {
      const m = r.metrics || {}
      const c = r.campaign || {}
      const clicks = parseInt(m.clicks || '0')
      const cost = parseInt(m.costMicros || '0') / 1_000_000
      return {
        data: r.segments.date,
        campaign_id: String(c.id),
        campaign_name: (c.name || '').slice(0, 200),
        status: c.status,
        channel_type: c.advertisingChannelType,
        cost,
        clicks,
        impressions: parseInt(m.impressions || '0'),
        conversions: parseFloat(m.conversions || '0'),
        conversions_value: parseFloat(m.conversionsValue || '0'),
        ctr: parseFloat(m.ctr || '0'),
        cpc: clicks > 0 ? cost / clicks : 0,
      }
    })
    rows += await upsert('analytics_ads_campanhas', out, 'data,campaign_id')
  }

  return { rows }
}

// ─── Handler ────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const body = await req.json().catch(() => ({}))
  const provider = body.provider || 'all'
  const diasAtras = Math.min(Math.max(body.dias_atras || 30, 1), 365)

  const result: any = {}

  if (provider === 'all' || provider === 'ga4') {
    const t0 = Date.now()
    try {
      const r = await syncGA4(diasAtras)
      const dur = Date.now() - t0
      await logSync('ga4', 'ok', r.rows, dur)
      result.ga4 = { ok: true, rows: r.rows, duracao_ms: dur }
    } catch (e: any) {
      const dur = Date.now() - t0
      await logSync('ga4', 'erro', 0, dur, String(e.message || e))
      result.ga4 = { ok: false, error: String(e.message || e) }
    }
  }

  if (provider === 'all' || provider === 'ads') {
    const t0 = Date.now()
    try {
      const r = await syncAds(diasAtras)
      const dur = Date.now() - t0
      await logSync('ads', 'ok', r.rows, dur)
      result.ads = { ok: true, rows: r.rows, duracao_ms: dur }
    } catch (e: any) {
      const dur = Date.now() - t0
      await logSync('ads', 'erro', 0, dur, String(e.message || e))
      result.ads = { ok: false, error: String(e.message || e) }
    }
  }

  return json(result)
})
