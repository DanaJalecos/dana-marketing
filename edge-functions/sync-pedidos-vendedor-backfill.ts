// ══════════════════════════════════════════════════════════
// Edge Function: sync-pedidos-vendedor-backfill
// Puxa o VENDEDOR de cada pedido (onde vendedor_id IS NULL)
// via GET /pedidos/vendas/{id} e atualiza a tabela pedidos.
//
// Processa em LOTES pra poder ser chamada várias vezes.
// Uso:
//   POST /functions/v1/sync-pedidos-vendedor-backfill
//   Body opcional: { "inicio": "2025-01-01", "limite": 100 }
// ══════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BLING_CLIENT_ID = 'bd02a35efc5c5b4eb2846d77fdc4d6f063b11d19'
const BLING_CLIENT_SECRET = 'b2844954fea8b4d935c7aadc1f7f7d99c064792b2c9c2eecc2ab2eb0bb6e'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const DEFAULT_INICIO = '2026-01-01'
const DEFAULT_LIMITE = 100
const MAX_LIMITE = 150

async function blingFetch(path: string, token: string): Promise<any> {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`https://api.bling.com.br/Api/v3/${path}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      if (res.status === 429) { await new Promise(r => setTimeout(r, 12000)); continue }
      if (res.status === 404) return { data: null }
      const text = await res.text()
      if (text.startsWith('<')) { await new Promise(r => setTimeout(r, 8000)); continue }
      return JSON.parse(text)
    } catch { await new Promise(r => setTimeout(r, 5000)) }
  }
  return { data: null }
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, apikey, Content-Type' },
    })
  }
  try {
    let body: { limite?: number; inicio?: string } = {}
    try { if (req.method === 'POST') body = await req.json() } catch {}
    const inicio = body.inicio || DEFAULT_INICIO
    const limite = Math.min(MAX_LIMITE, body.limite || DEFAULT_LIMITE)

    console.log(`BACKFILL VENDEDOR · janela: ${inicio}+ · limite ${limite}`)
    const token = await getToken()

    // Pedidos no período sem vendedor_id preenchido
    const { data: pedidos, error: qErr } = await supabase.from('pedidos')
      .select('id')
      .gte('data', inicio)
      .is('vendedor_id', null)
      .order('data', { ascending: false })
      .limit(limite)

    if (qErr) throw qErr
    if (!pedidos || pedidos.length === 0) {
      await supabase.from('sync_log').insert({
        tabela: 'pedidos', tipo: 'vendedor_backfill',
        registros: 0, status: 'ok',
        detalhes: `Backfill vendedor completo · nenhum pedido sem vendedor em ${inicio}+`,
      })
      return jsonResponse({ ok: true, completo: true, processados: 0 })
    }

    console.log(`Vai processar: ${pedidos.length} pedidos sem vendedor`)

    let atualizados = 0
    let semVendedor = 0
    let erros = 0

    // Batches de 5 com 1s entre eles (rate limit Bling)
    for (let i = 0; i < pedidos.length; i += 5) {
      const batch = pedidos.slice(i, i + 5)
      await Promise.all(batch.map(async (p) => {
        try {
          const resp = await blingFetch(`pedidos/vendas/${p.id}`, token)
          const pedido = resp?.data
          if (!pedido) { erros++; return }
          const vendedor_id = pedido.vendedor?.id || null
          const vendedor_nome = pedido.vendedor?.nome || null
          if (!vendedor_id) {
            // Marcar como 0 pra não re-tentar sempre (sentinel)
            await supabase.from('pedidos').update({ vendedor_id: 0, vendedor_nome: '(sem vendedor)' }).eq('id', p.id)
            semVendedor++
            return
          }
          const { error } = await supabase.from('pedidos')
            .update({ vendedor_id, vendedor_nome })
            .eq('id', p.id)
          if (error) { console.warn('Update:', error.message); erros++ }
          else atualizados++
        } catch (e) { console.warn(`Erro pedido ${p.id}:`, e); erros++ }
      }))
      if (i + 5 < pedidos.length) await new Promise(r => setTimeout(r, 1000))
    }

    // Contar quantos ainda faltam
    const { count: faltaAinda } = await supabase.from('pedidos')
      .select('id', { count: 'exact', head: true })
      .gte('data', inicio)
      .is('vendedor_id', null)

    await supabase.from('sync_log').insert({
      tabela: 'pedidos', tipo: 'vendedor_backfill',
      registros: atualizados,
      status: erros > 0 ? 'parcial' : 'ok',
      detalhes: `Backfill vendedor ${inicio}+ · processados ${pedidos.length} · atualizados ${atualizados} · sem-vendedor ${semVendedor} · restam ${faltaAinda || 0}`,
    })

    return jsonResponse({
      ok: true,
      completo: (faltaAinda || 0) === 0,
      processados: pedidos.length,
      atualizados,
      sem_vendedor: semVendedor,
      erros,
      falta_ainda: faltaAinda || 0,
    })
  } catch (e: any) {
    console.error('Vendedor backfill error:', e)
    return jsonResponse({ ok: false, error: e.message }, 500)
  }
})

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}
