// ─── BC (auto-gerado) ───
// ══════════════════════════════════════════════════════════
// Edge Function: sync-contatos
// Sincroniza contatos (últimos 500 — incremental)
// Duração esperada: ~15-20s
// ══════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BLING_CLIENT_ID = '0401d014dd4186dee8968f6a96e16b06501c7184'
const BLING_CLIENT_SECRET = 'b4d47645a9cce7e476eef7cdd70473db4e58f929df586bc5049c5cc3b27d'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

async function blingFetch(path: string, token: string): Promise<any> {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`https://api.bling.com.br/Api/v3/${path}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      if (res.status === 429) { await new Promise(r => setTimeout(r, 8000)); continue }
      const text = await res.text()
      if (text.startsWith('<')) { await new Promise(r => setTimeout(r, 5000)); continue }
      return JSON.parse(text)
    } catch { await new Promise(r => setTimeout(r, 3000)) }
  }
  return { data: [] }
}

async function getToken(): Promise<string> {
  const { data: row } = await supabase.from('bling_tokens').select('*').eq('id', 2).single()
  if (!row) throw new Error('No token')
  try {
    const test = await blingFetch('contatos?pagina=1&limite=1', row.access_token)
    if (test && !test.error && test.data) return row.access_token
  } catch {}
  const res = await fetch('https://api.bling.com.br/Api/v3/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + btoa(`${BLING_CLIENT_ID}:${BLING_CLIENT_SECRET}`) },
    body: `grant_type=refresh_token&refresh_token=${row.refresh_token}`,
  })
  const data = await res.json()
  if (!data.access_token) throw new Error('Token renewal failed')
  await supabase.from('bling_tokens').update({
    access_token: data.access_token, refresh_token: data.refresh_token, updated_at: new Date().toISOString(),
  }).eq('id', 2)
  return data.access_token
}

Deno.serve(async () => {
  const inicio = Date.now()
  try {
    const token = await getToken()
    let total = 0

    for (let page = 1; page <= 10; page++) {
      const data = await blingFetch(`contatos?pagina=${page}&limite=100`, token)
      if (!data.data?.length) break
      const rows = data.data.map((c: any) => ({
        id: c.id, nome: c.nome || '', codigo: c.codigo || '',
        situacao: c.situacao || '', tipo_pessoa: c.tipoPessoa || c.tipo || '',
        numero_documento: c.numeroDocumento || '',
        telefone: c.telefone || '', celular: c.celular || '',
      }))
      await supabase.from('contatos').upsert((rows).map((__r:any) => ({...__r, empresa: 'bc'})), { onConflict: 'id' })
      total += rows.length
      await new Promise(r => setTimeout(r, 300))
    }

    const duracao = Math.round((Date.now() - inicio) / 1000)
    await supabase.from('sync_log').insert({ tabela: 'contatos', tipo: 'sync_bc', registros: total, status: 'ok', detalhes: duracao + 's' })
    return new Response(JSON.stringify({ ok: true, tabela: 'contatos', registros: total, duracao_seg: duracao }), { headers: { 'Content-Type': 'application/json' }})
  } catch (e: any) {
    await supabase.from('sync_log').insert({ tabela: 'contatos', tipo: 'sync_bc', registros: 0, status: 'error', erro: e.message })
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' }})
  }
})
