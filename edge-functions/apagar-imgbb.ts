// ══════════════════════════════════════════════════════════════
// Edge: apagar-imgbb  (best-effort)
//
// ImgBB NÃO tem API oficial de delete. O upload devolve um delete_url
// que é uma página web. Aqui automatizamos pelo servidor: abrimos a
// página, pegamos o auth_token + cookie e mandamos o POST de exclusão
// pro endpoint interno do ImgBB (ibb.co/json). Método não-oficial:
// pode falhar/quebrar se o ImgBB mudar — por isso é best-effort e
// nunca trava o fluxo de apagar a anotação.
//
// Body: { delete_url: "https://ibb.co/<ID>/<HASH>" }
// Auth: somente cargo 'admin'
// ══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, apikey, Content-Type, X-Client-Info',
}
function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

function pegarToken(html: string): string | null {
  const pats = [
    /auth_token"\s*:\s*"([a-f0-9]+)"/i,
    /auth_token\s*=\s*"([a-f0-9]+)"/i,
    /name="auth_token"\s+value="([a-f0-9]+)"/i,
    /PF\.obj\.config\.auth_token\s*=\s*"([a-f0-9]+)"/i,
  ]
  for (const p of pats) { const m = html.match(p); if (m) return m[1] }
  return null
}

async function tentarApagar(deleteUrl: string): Promise<{ ok: boolean; motivo?: string }> {
  // delete_url = https://ibb.co/<ID>/<HASH>
  const m = deleteUrl.match(/ibb\.co\/([^/]+)\/([a-f0-9]+)/i)
  if (!m) return { ok: false, motivo: 'delete_url fora do formato esperado' }
  const id = m[1], hash = m[2]
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

  const pg = await fetch(deleteUrl, { headers: { 'User-Agent': UA } })
  if (!pg.ok) return { ok: false, motivo: `página ${pg.status}` }
  const cookie = (pg.headers.get('set-cookie') || '').split(',').map(s => s.split(';')[0].trim()).filter(Boolean).join('; ')
  const html = await pg.text()
  const token = pegarToken(html)
  if (!token) return { ok: false, motivo: 'auth_token não encontrado (ImgBB pode ter mudado)' }

  const form = new URLSearchParams()
  form.set('action', 'delete')
  form.set('from', 'resource')
  form.set('deleting[id]', id)
  form.set('deleting[hash]', hash)
  form.set('auth_token', token)

  const del = await fetch('https://ibb.co/json', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': deleteUrl,
      ...(cookie ? { 'Cookie': cookie } : {}),
    },
    body: form.toString(),
  })
  const jr = await del.json().catch(() => ({} as any))
  if (del.ok && (jr?.success || jr?.status_code === 200)) return { ok: true }
  return { ok: false, motivo: `ibb.co/json ${del.status}: ${JSON.stringify(jr).slice(0, 160)}` }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  try {
    const body = await req.json().catch(() => ({})) as any
    const deleteUrl = String(body.delete_url || '')
    if (!deleteUrl) return json({ error: 'delete_url obrigatório' }, 400)

    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '')
    if (!token || token === SUPABASE_ANON_KEY) return json({ error: 'auth obrigatória' }, 401)
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: u } = await userClient.auth.getUser()
    const uid = u?.user?.id
    if (!uid) return json({ error: 'JWT inválido' }, 401)
    const { data: prof } = await admin.from('profiles').select('cargo').eq('id', uid).maybeSingle()
    if ((prof?.cargo || '') !== 'admin') return json({ error: 'sem_permissao' }, 403)

    let r: { ok: boolean; motivo?: string }
    try { r = await tentarApagar(deleteUrl) }
    catch (e) { r = { ok: false, motivo: String((e as Error).message || e) } }
    // best-effort: nunca devolve erro HTTP — só informa se conseguiu
    return json({ imgbb_apagado: r.ok, motivo: r.motivo || null })
  } catch (e) {
    return json({ imgbb_apagado: false, motivo: String((e as Error).message || e) })
  }
})
