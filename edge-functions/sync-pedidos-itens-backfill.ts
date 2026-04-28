// ══════════════════════════════════════════════════════════
// Edge Function: sync-pedidos-itens-backfill
// Puxa os ITENS de pedidos de 2026 (desde 01/01/2026) que ainda não têm itens.
// Processa em LOTES pra poder ser chamada múltiplas vezes até cobrir tudo.
//
// Uso:
//   POST /functions/v1/sync-pedidos-itens-backfill
//   Body opcional (JSON): { "limite": 300, "inicio": "2026-01-01" }
//
// Defaults: inicio = 2026-01-01, limite = 300 pedidos por execução
// Chama-se manualmente várias vezes (via UI ou cron temporário) até cobertura = 100%
// ══════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BLING_CLIENT_ID = 'bd02a35efc5c5b4eb2846d77fdc4d6f063b11d19'
const BLING_CLIENT_SECRET = 'b2844954fea8b4d935c7aadc1f7f7d99c064792b2c9c2eecc2ab2eb0bb6e'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const DEFAULT_INICIO = '2026-01-01'
const DEFAULT_LIMITE = 50     // 150 ainda estourava CPU time (abortava ~75 pedidos); 50 cabe com folga
const MAX_LIMITE = 100

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
    // Parse body (opcional)
    let body: { limite?: number; inicio?: string } = {}
    try { if (req.method === 'POST') body = await req.json() } catch {}
    const inicio = body.inicio || DEFAULT_INICIO
    const limite = Math.min(MAX_LIMITE, body.limite || DEFAULT_LIMITE)

    console.log(`BACKFILL · janela: ${inicio} → hoje · limite ${limite}`)
    const token = await getToken()

    // Buscar TODOS os pedidos de 2026 em chunks (Supabase limita em 1000 por query)
    const todosPedidos: { id: string }[] = []
    let from = 0
    while (from < 20000) {
      const { data, error } = await supabase
        .from('pedidos')
        .select('id')
        .gte('data', inicio)
        .gt('total_produtos', 0)
        .order('data', { ascending: false })
        .range(from, from + 999)
      if (error) { console.error('Pedidos query:', error.message); break }
      if (!data || !data.length) break
      todosPedidos.push(...data)
      if (data.length < 1000) break
      from += 1000
    }

    if (todosPedidos.length === 0) {
      return jsonResponse({ ok: true, message: 'Nenhum pedido no período', cobertura_pct: 100 })
    }

    // Verificar quais já têm itens — chunks de 100
    const pedidoIds = todosPedidos.map(p => p.id)
    const jaTemItens = new Set<string | number>()
    for (let i = 0; i < pedidoIds.length; i += 100) {
      const chunk = pedidoIds.slice(i, i + 100)
      const { data } = await supabase
        .from('pedidos_itens')
        .select('pedido_id')
        .in('pedido_id', chunk)
      ;(data || []).forEach(e => jaTemItens.add(e.pedido_id))
    }

    const faltantesTotais = pedidoIds.filter(id => !jaTemItens.has(id))
    // Processa só até o limite por execução — mais antigos primeiro pra cobrir a base toda
    const paraProcessar = faltantesTotais.slice(-limite)

    const totalBase = todosPedidos.length
    const jaCobertos = jaTemItens.size
    const coberturaAntes = totalBase > 0 ? (jaCobertos / totalBase * 100) : 0

    console.log(`Base 2026: ${totalBase} pedidos · já cobertos: ${jaCobertos} (${coberturaAntes.toFixed(1)}%) · vai processar: ${paraProcessar.length}`)

    if (paraProcessar.length === 0) {
      await supabase.from('sync_log').insert({
        tabela: 'pedidos_itens',
        tipo: 'backfill',
        registros: 0,
        status: 'ok',
        detalhes: `Backfill completo · ${totalBase} pedidos · ${jaCobertos} cobertos (100%) · janela ${inicio}+`,
      })
      return jsonResponse({ ok: true, completo: true, total: totalBase, cobertura_pct: 100 })
    }

    let totalItens = 0
    let totalVendedores = 0
    let erros = 0

    // Buscar itens em batches de 5 (rate limit Bling)
    for (let i = 0; i < paraProcessar.length; i += 5) {
      const batch = paraProcessar.slice(i, i + 5)
      const results = await Promise.all(
        batch.map(async (pedidoId) => {
          try {
            const resp = await blingFetch(`pedidos/vendas/${pedidoId}`, token)
            const pedido = resp?.data
            if (!pedido) return null
            // Extrai vendedor (aproveita a mesma request detalhada)
            const vendedor_id = pedido.vendedor?.id || null
            const vendedor_nome = pedido.vendedor?.nome || null
            let itens: any[]
            if (!pedido.itens || pedido.itens.length === 0) {
              itens = [{
                pedido_id: pedidoId,
                produto_id: 'sem_itens_0',
                codigo: '',
                descricao: '(sem itens)',
                quantidade: 0,
                valor_unitario: 0,
                valor_total: 0,
                unidade: 'UN'
              }]
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
        const upsertResult = await supabase.from('pedidos_itens').upsert(todosItens, {
          onConflict: 'pedido_id,produto_id',
        })
        if (upsertResult?.error) console.error('Upsert itens error:', upsertResult.error.message)
        else totalItens += todosItens.length
      }

      // Atualizar vendedor nos pedidos
      for (const r of results) {
        if (!r || !r.vendedor_id) continue
        const { error } = await supabase.from('pedidos')
          .update({ vendedor_id: r.vendedor_id, vendedor_nome: r.vendedor_nome })
          .eq('id', r.pedido_id)
        if (error) console.warn('Update vendedor error:', error.message)
        else totalVendedores++
      }

      // Rate limit Bling (3 req/s) — 1s entre batches de 5
      if (i + 5 < paraProcessar.length) await new Promise(r => setTimeout(r, 1000))
    }

    const faltaAinda = faltantesTotais.length - paraProcessar.length
    const coberturaFinal = totalBase > 0 ? ((jaCobertos + paraProcessar.length) / totalBase * 100) : 100

    await supabase.from('sync_log').insert({
      tabela: 'pedidos_itens',
      tipo: 'backfill',
      registros: totalItens,
      status: erros > 0 ? 'parcial' : 'ok',
      detalhes: `Backfill ${inicio}+ · ${paraProcessar.length} pedidos · ${totalItens} itens · ${totalVendedores} vendedores · restam ${faltaAinda} · cobertura ${coberturaFinal.toFixed(1)}%`,
    })

    return jsonResponse({
      ok: true,
      completo: faltaAinda === 0,
      janela_inicio: inicio,
      total_base: totalBase,
      ja_cobertos_antes: jaCobertos,
      processados_agora: paraProcessar.length,
      itens_sincronizados: totalItens,
      erros,
      falta_ainda: faltaAinda,
      cobertura_pct_antes: +coberturaAntes.toFixed(1),
      cobertura_pct_agora: +coberturaFinal.toFixed(1),
    })
  } catch (e: any) {
    console.error('Backfill error:', e)
    return jsonResponse({ ok: false, error: e.message }, 500)
  }
})

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}
