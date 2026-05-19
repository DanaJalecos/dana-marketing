// ══════════════════════════════════════════════════════════════
// Edge: upload-imgbb
//
// Sobe uma imagem (base64) pro ImgBB e devolve a URL pública.
// Mantém a IMGBB_API_KEY server-side (não expõe no front).
// Usado pelo chat de Anotações dos ADMs (Sistema → Anotações).
//
// Body: { image_base64: "<base64 sem prefixo data:>", nome?: string }
// Auth: somente cargo 'admin'
// ══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const IMGBB_API_KEY = Deno.env.get('IMGBB_API_KEY')!

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, apikey, Content-Type, X-Client-Info',
}
function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  try {
    const body = await req.json().catch(() => ({})) as any
    let b64 = String(body.image_base64 || '')
    if (!b64) return json({ error: 'image_base64 obrigatório' }, 400)
    // tira prefixo data:...;base64, se vier
    const comma = b64.indexOf('base64,')
    if (comma !== -1) b64 = b64.slice(comma + 7)

    // Auth do caller — só admin
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

    // Upload pro ImgBB
    const form = new FormData()
    form.append('image', b64)
    form.append('name', String(body.nome || `anotacao-${Date.now()}`))
    const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
      method: 'POST', body: form,
    })
    const jr = await res.json().catch(() => ({}))
    if (!res.ok || !jr?.data?.url) {
      return json({ error: 'falha no ImgBB', detalhe: jr?.error?.message || res.status }, 502)
    }
    return json({ url: jr.data.url, thumb: jr.data?.thumb?.url || jr.data.url, delete_url: jr.data?.delete_url || null })
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500)
  }
})
