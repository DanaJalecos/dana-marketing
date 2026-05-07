// ══════════════════════════════════════════════════════════════════════
// dms-tracker-ingest — Feature #3 do roadmap pós-Analytics IA
// ══════════════════════════════════════════════════════════════════════
// Edge function PÚBLICA (deploy com --no-verify-jwt) que recebe eventos do
// dms-tracker.js (rodando no site Magazord da Dana). Sem JWT — confiamos na
// origem por CORS + rate limit por IP.
//
// Resolução de identidade: quando o tracker manda evento purchase|form_submit
// com email_hash ou contato_nome, fazemos UPDATE retroativo em TODOS os
// eventos do mesmo cookie_id (amarra anônimos passados ao cliente conhecido).
//
// Rate limit: 60 req/min por cookie_id, 600 req/min por IP. In-memory (zera
// quando edge reinicia — OK pra tracking, não é fim do mundo).
//
// LGPD: anonimiza IP /24 antes de gravar. Cookie é first-party, sem PII direta.
// ══════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Whitelist de tipos válidos (evita poluição da tabela)
const TIPOS_VALIDOS = new Set([
  'pageview', 'click', 'form_view', 'form_submit',
  'add_cart', 'checkout_start', 'purchase'
])

// Rate limit in-memory (per-edge instance)
const rateMap = new Map<string, { count: number; resetAt: number }>()
const RATE_WINDOW_MS = 60_000
const RATE_LIMIT_COOKIE = 60
const RATE_LIMIT_IP = 600

function rateLimit(key: string, limit: number): boolean {
  const now = Date.now()
  const entry = rateMap.get(key)
  if (!entry || entry.resetAt < now) {
    rateMap.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return true
  }
  if (entry.count >= limit) return false
  entry.count += 1
  return true
}

// Mascara último octeto IPv4 (LGPD-friendly)
function anonIp(ip: string | null): string | null {
  if (!ip) return null
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})/)
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0`
  // IPv6: zera últimos 80 bits (mantém /48)
  if (ip.includes(':')) {
    const parts = ip.split(':')
    return parts.slice(0, 3).join(':') + '::0'
  }
  return null
}

function pickPath(url: string | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.pathname.slice(0, 250)
  } catch {
    return null
  }
}

function isUuid(s: unknown): boolean {
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

function clamp(s: unknown, max: number): string | null {
  if (typeof s !== 'string') return null
  const t = s.trim()
  if (!t) return null
  return t.slice(0, max)
}

// CORS dinâmico: echo do Origin (não wildcard) + Allow-Credentials true.
// sendBeacon manda cookies por padrão; wildcard + credentials = bloqueio CORS.
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || ''
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Tracker-Version',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req)
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Use POST' }), {
      status: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // Identifica IP
  const ipHeader = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || ''
  const ip = ipHeader.split(',')[0].trim() || null
  const ipKey = ip || 'unknown'

  // Rate limit por IP (antes de parsear body)
  if (!rateLimit(`ip:${ipKey}`, RATE_LIMIT_IP)) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded (IP)' }), {
      status: 429,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // Valida campos mínimos
  const cookieId = body.cookie_id
  const eventoTipo = body.evento_tipo
  if (!isUuid(cookieId)) {
    return new Response(JSON.stringify({ error: 'cookie_id must be UUID' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
  if (typeof eventoTipo !== 'string' || !TIPOS_VALIDOS.has(eventoTipo)) {
    return new Response(JSON.stringify({ error: 'Invalid evento_tipo' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // Rate limit por cookie
  if (!rateLimit(`ck:${cookieId}`, RATE_LIMIT_COOKIE)) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded (cookie)' }), {
      status: 429,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // Sanitiza tudo
  const url = clamp(body.url, 2000)
  const url_path = pickPath(url ?? undefined) ?? clamp(body.url_path, 250)
  const referrer = clamp(body.referrer, 2000)
  const utm_source = clamp(body.utm_source, 100)
  const utm_medium = clamp(body.utm_medium, 100)
  const utm_campaign = clamp(body.utm_campaign, 200)
  const utm_content = clamp(body.utm_content, 200)
  const utm_term = clamp(body.utm_term, 200)
  const device = clamp(body.device, 20)
  const browser = clamp(body.browser, 50)
  const os = clamp(body.os, 50)
  const user_agent = clamp(req.headers.get('user-agent'), 500)
  const ip_anon = anonIp(ip)
  const empresa = clamp(body.empresa, 20)
  const contato_nome = clamp(body.contato_nome, 200)
  const email_hash = clamp(body.email_hash, 64)  // SHA256 hex = 64 chars
  let metadata: unknown = body.metadata
  try {
    if (metadata && typeof metadata === 'object') {
      const s = JSON.stringify(metadata)
      if (s.length > 4000) metadata = null  // bota um teto
    } else {
      metadata = null
    }
  } catch { metadata = null }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // INSERT do evento
  const insertPayload = {
    cookie_id: cookieId, contato_nome, email_hash, empresa,
    evento_tipo: eventoTipo, url, url_path, referrer,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    device, browser, os, user_agent, ip_anon, metadata,
  }
  const { data: inserted, error: insErr } = await sb
    .from('analytics_lead_events')
    .insert(insertPayload)
    .select('id')
    .single()

  if (insErr) {
    return new Response(JSON.stringify({ error: 'DB insert failed', detail: insErr.message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // Upsert identity (cookie ↔ pessoa)
  // Se evento traz contato_nome ou email_hash → resolveu; UPDATE retroativo em TODOS os eventos do cookie
  const isResolutionEvent = !!(contato_nome || email_hash)
  if (isResolutionEvent) {
    await sb.from('analytics_lead_identity').upsert({
      cookie_id: cookieId,
      contato_nome,
      email_hash,
      empresa,
      ultimo_evento: new Date().toISOString(),
      resolvido_em: new Date().toISOString(),
    }, { onConflict: 'cookie_id' })

    // UPDATE retroativo: amarra anônimos passados ao contato
    const updPayload: Record<string, string | null> = {}
    if (contato_nome) updPayload.contato_nome = contato_nome
    if (email_hash)   updPayload.email_hash   = email_hash
    if (empresa)      updPayload.empresa      = empresa
    if (Object.keys(updPayload).length) {
      await sb.from('analytics_lead_events')
        .update(updPayload)
        .eq('cookie_id', cookieId)
        .is('contato_nome', null)
    }
  } else {
    // Só atualiza ultimo_evento e contadores
    await sb.from('analytics_lead_identity').upsert({
      cookie_id: cookieId,
      ultimo_evento: new Date().toISOString(),
      primeiro_referrer: referrer,
      primeiro_utm_source: utm_source,
      primeiro_utm_campaign: utm_campaign,
    }, { onConflict: 'cookie_id', ignoreDuplicates: false })
  }

  return new Response(JSON.stringify({ ok: true, id: inserted?.id, resolved: isResolutionEvent }), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
})
