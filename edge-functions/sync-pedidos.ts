// ══════════════════════════════════════════════════════════
// Edge Function: sync-pedidos
// Sincroniza apenas PEDIDOS (últimos 7 dias)
// Duração esperada: ~15-25s
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
      if (res.status === 429) { await new Promise(r => setTimeout(r, 8000)); continue }
      const text = await res.text()
      if (text.startsWith('<')) { await new Promise(r => setTimeout(r, 5000)); continue }
      return JSON.parse(text)
    } catch { await new Promise(r => setTimeout(r, 3000)) }
  }
  return { data: [] }
}

async function getToken(): Promise<string> {
  const { data: row } = await supabase.from('bling_tokens').select('*').eq('id', 1).single()
  if (!row) throw new Error('No token')
  try {
    const test = await blingFetch('pedidos/vendas?pagina=1&limite=1', row.access_token)
    if (test && !test.error && test.data) return row.access_token
  } catch {}
  const res = await fetch('https://api.bling.com.br/Api/v3/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + btoa(`${BLING_CLIENT_ID}:${BLING_CLIENT_SECRET}`),
    },
    body: `grant_type=refresh_token&refresh_token=${row.refresh_token}`,
  })
  const data = await res.json()
  if (!data.access_token) throw new Error('Token renewal failed')
  await supabase.from('bling_tokens').update({
    access_token: data.access_token, refresh_token: data.refresh_token, updated_at: new Date().toISOString(),
  }).eq('id', 1)
  return data.access_token
}

Deno.serve(async () => {
  const inicio = Date.now()
  try {
    const token = await getToken()
    const hoje = new Date()
    const dataInicio = new Date(hoje); dataInicio.setDate(dataInicio.getDate() - 7)
    let total = 0

    for (let page = 1; page <= 10; page++) {
      const data = await blingFetch(
        `pedidos/vendas?pagina=${page}&limite=100&dataInicial=${dataInicio.toISOString().split('T')[0]}&dataFinal=${hoje.toISOString().split('T')[0]}`, token)
      if (!data.data?.length) break
      const rows = data.data.map((p: any) => ({
        id: p.id, numero: p.numero, numero_loja: p.numeroLoja || '',
        data: p.data, data_saida: p.dataSaida && p.dataSaida !== '0000-00-00' ? p.dataSaida : null,
        total_produtos: p.totalProdutos || 0, total: p.total || 0,
        contato_nome: p.contato?.nome || '', contato_tipo: p.contato?.tipoPessoa || '',
        situacao_id: p.situacao?.id || 0, loja_id: p.loja?.id || 0,
      }))
      await supabase.from('pedidos').upsert(rows, { onConflict: 'id' })
      total += rows.length
      await new Promise(r => setTimeout(r, 300))
    }

    const duracao = Math.round((Date.now() - inicio) / 1000)
    await supabase.from('sync_log').insert({ tabela: 'pedidos', registros: total, status: 'ok', detalhes: duracao + 's' })
    return new Response(JSON.stringify({ ok: true, tabela: 'pedidos', registros: total, duracao_seg: duracao }), { headers: { 'Content-Type': 'application/json' }})
  } catch (e: any) {
    await supabase.from('sync_log').insert({ tabela: 'pedidos', registros: 0, status: 'error', erro: e.message })
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' }})
  }
})
