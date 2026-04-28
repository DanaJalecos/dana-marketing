// ══════════════════════════════════════════════════════════
// Edge Function: sync-pedidos-itens
// Puxa os ITENS de cada pedido RECENTE do Bling (últimos 60 dias)
// Para histórico mais antigo, usar sync-pedidos-itens-backfill
// Deployar no Supabase como: sync-pedidos-itens
// Chamar: manualmente ou via cron (a cada 30min — job sync-pedidos-itens-30min)
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
  if (!row) throw new Error('No token found in bling_tokens table')

  // Testar token atual
  try {
    const test = await blingFetch('pedidos/vendas?pagina=1&limite=1', row.access_token)
    if (test && !test.error && test.data) return row.access_token
  } catch {}

  // Renovar
  console.log('Renovando token...')
  const res = await fetch('https://api.bling.com.br/Api/v3/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + btoa(`${BLING_CLIENT_ID}:${BLING_CLIENT_SECRET}`),
    },
    body: `grant_type=refresh_token&refresh_token=${row.refresh_token}`,
  })
  const data = await res.json()
  if (!data.access_token) throw new Error('Token renewal failed: ' + JSON.stringify(data))

  await supabase.from('bling_tokens').update({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    updated_at: new Date().toISOString(),
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
    console.log('STEP 1: Getting token...')
    const token = await getToken()
    console.log('STEP 2: Token OK')

    // Pegar os pedidos dos últimos 60 dias
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 60)
    const cutoffStr = cutoff.toISOString().split('T')[0]
    console.log('STEP 3: Querying pedidos since', cutoffStr)

    const pedidosResult = await supabase
      .from('pedidos')
      .select('id')
      .gte('data', cutoffStr)
      .gt('total_produtos', 0)
      .order('data', { ascending: false })
      .limit(500)

    const pedidos = pedidosResult?.data
    const pedidosError = pedidosResult?.error
    if (pedidosError) console.error('Pedidos query error:', pedidosError.message)

    if (!pedidos || pedidos.length === 0) {
      return jsonResponse({ ok: true, message: 'Nenhum pedido recente para sincronizar', itens_sincronizados: 0, debug: pedidosError?.message || 'no pedidos' })
    }
    console.log('STEP 4: Found', pedidos.length, 'pedidos')

    // Verificar quais já têm itens — em chunks de 100 pra cobrir TODOS
    // (antes só olhava os primeiros 100, causando retrabalho nos demais)
    const pedidoIds = pedidos.map(p => p.id)
    const jaTemItens = new Set<string | number>()
    for (let i = 0; i < pedidoIds.length; i += 100) {
      const chunk = pedidoIds.slice(i, i + 100)
      const { data: existentes, error } = await supabase
        .from('pedidos_itens')
        .select('pedido_id')
        .in('pedido_id', chunk)
      if (error) console.warn('Exist check error:', error.message)
      ;(existentes || []).forEach(e => jaTemItens.add(e.pedido_id))
    }
    const faltam = pedidoIds.filter(id => !jaTemItens.has(id))

    console.log(`STEP 5: Pedidos: ${pedidos.length}, já sincronizados: ${jaTemItens.size}, faltam: ${faltam.length}`)

    let totalItens = 0
    let totalVendedores = 0
    let erros = 0

    // Buscar itens de cada pedido (em lotes de 5 para não estourar rate limit)
    for (let i = 0; i < faltam.length; i += 5) {
      const batch = faltam.slice(i, i + 5)

      // Estrutura: [{ pedido_id, itens, vendedor_id, vendedor_nome }]
      const results = await Promise.all(
        batch.map(async (pedidoId) => {
          try {
            const resp = await blingFetch(`pedidos/vendas/${pedidoId}`, token)
            const pedido = resp.data
            if (!pedido) return null
            // Extrai vendedor (aproveita a mesma request detalhada)
            const vendedor_id = pedido.vendedor?.id || null
            const vendedor_nome = pedido.vendedor?.nome || null
            let itens: any[]
            if (!pedido.itens || pedido.itens.length === 0) {
              itens = [{ pedido_id: pedidoId, produto_id: 'sem_itens_0', codigo: '', descricao: '(sem itens)', quantidade: 0, valor_unitario: 0, valor_total: 0, unidade: 'UN' }]
            } else {
              itens = pedido.itens.map((item: any, idx: number) => ({
                pedido_id: pedidoId,
                produto_id: String(item.produto?.id || item.id || '0') + '_' + idx,
                codigo: item.codigo || item.produto?.codigo || '',
                descricao: item.descricao || item.produto?.descricao || '',
                quantidade: item.quantidade || 0,
                valor_unitario: item.valor || item.valorUnidade || 0,
                valor_total: (item.quantidade || 0) * (item.valor || item.valorUnidade || 0),
                unidade: item.unidade || 'UN',
              }))
            }
            return { pedido_id: pedidoId, itens, vendedor_id, vendedor_nome }
          } catch (e) {
            console.warn(`Erro pedido ${pedidoId}:`, e)
            erros++
            return null
          }
        })
      )

      // Flatten e inserir itens
      const todosItens = results.flatMap(r => r?.itens || []).filter(i => i.pedido_id)
      if (todosItens.length > 0) {
        const { error } = await supabase.from('pedidos_itens').upsert(todosItens, {
          onConflict: 'pedido_id,produto_id',
        })
        if (error) console.error('Upsert itens error:', error.message)
        else totalItens += todosItens.length
      }

      // Atualiza vendedor nos pedidos (1 UPDATE por pedido, filtra só os que têm vendedor)
      for (const r of results) {
        if (!r || !r.vendedor_id) continue
        const { error } = await supabase.from('pedidos')
          .update({ vendedor_id: r.vendedor_id, vendedor_nome: r.vendedor_nome })
          .eq('id', r.pedido_id)
        if (error) console.warn('Update vendedor error:', error.message)
        else totalVendedores++
      }

      // Rate limit: esperar 1s entre lotes
      if (i + 5 < faltam.length) await new Promise(r => setTimeout(r, 1000))
    }

    // Registrar sync (grava tabela='pedidos_itens' pra aparecer em filtros por tabela)
    await supabase.from('sync_log').insert({
      tabela: 'pedidos_itens',
      tipo: 'itens',
      registros: totalItens,
      status: erros > 0 ? 'parcial' : 'ok',
      detalhes: `${faltam.length} pedidos processados, ${totalItens} itens, ${totalVendedores} vendedores atualizados, ${erros} erros (cutoff ${cutoffStr})`,
    })

    return jsonResponse({
      ok: true,
      pedidos_processados: faltam.length,
      itens_sincronizados: totalItens,
      erros,
      ja_sincronizados: jaTemItens.size,
    })

  } catch (e: any) {
    console.error('Sync itens error:', e)
    return jsonResponse({ ok: false, error: e.message }, 500)
  }
})

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}
