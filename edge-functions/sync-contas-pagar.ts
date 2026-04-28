// ══════════════════════════════════════════════════════════
// Edge Function: sync-contas-pagar
// Sincroniza UMA situação por chamada (usar ?situacao=1|2|3)
// Sem param: situação 1 (em aberto)
// Duração esperada: ~20-40s por situação
// ══════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BLING_CLIENT_ID = 'bd02a35efc5c5b4eb2846d77fdc4d6f063b11d19'
const BLING_CLIENT_SECRET = 'b2844954fea8b4d935c7aadc1f7f7d99c064792b2c9c2eecc2ab2eb0bb6e'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

async function blingFetch(path: string, token: string): Promise<any> {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`https://api.bling.com.br/Api/v3/${path}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      if (res.status === 429) { await new Promise(r => setTimeout(r, 5000)); continue }
      const text = await res.text()
      if (text.startsWith('<')) { await new Promise(r => setTimeout(r, 3000)); continue }
      return JSON.parse(text)
    } catch { await new Promise(r => setTimeout(r, 2000)) }
  }
  return { data: [] }
}

async function getToken(): Promise<string> {
  const { data: row } = await supabase.from('bling_tokens').select('*').eq('id', 1).single()
  if (!row) throw new Error('No token')
  try {
    const test = await blingFetch('contas/pagar?pagina=1&limite=1', row.access_token)
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
  }).eq('id', 1)
  return data.access_token
}

Deno.serve(async (req) => {
  const inicio = Date.now()
  const url = new URL(req.url)
  const situacao = parseInt(url.searchParams.get('situacao') || '1')

  try {
    const token = await getToken()
    let total = 0
    let pageStart = 1
    const pageBatch = 3

    while (pageStart <= 20) {
      const pages = Array.from({length: pageBatch}, (_, i) => pageStart + i)
      const results = await Promise.all(
        pages.map(p => blingFetch(`contas/pagar?pagina=${p}&limite=100&situacao=${situacao}`, token))
      )

      const todasLinhas: any[] = []
      for (const r of results) {
        if (r.data?.length) {
          todasLinhas.push(...r.data.map((c: any) => ({
            id: c.id, situacao: c.situacao, vencimento: c.vencimento,
            valor: c.valor || 0, contato_id: c.contato?.id || 0,
          })))
        }
      }

      if (todasLinhas.length > 0) {
        await supabase.from('contas_pagar').upsert(todasLinhas, { onConflict: 'id' })
        total += todasLinhas.length
      }

      if (!results[results.length - 1].data?.length) break
      pageStart += pageBatch
    }

    const duracao = Math.round((Date.now() - inicio) / 1000)
    await supabase.from('sync_log').insert({
      tabela: 'contas_pagar', registros: total, status: 'ok',
      detalhes: 'sit=' + situacao + ', ' + duracao + 's'
    })
    return new Response(JSON.stringify({ ok: true, tabela: 'contas_pagar', situacao, registros: total, duracao_seg: duracao }), { headers: { 'Content-Type': 'application/json' }})
  } catch (e: any) {
    await supabase.from('sync_log').insert({
      tabela: 'contas_pagar', registros: 0, status: 'error',
      erro: e.message, detalhes: 'sit=' + situacao
    })
    return new Response(JSON.stringify({ error: e.message, situacao }), { status: 500, headers: { 'Content-Type': 'application/json' }})
  }
})
