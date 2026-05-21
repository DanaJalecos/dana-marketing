// ════════════════════════════════════════════════════════════════════════════
// sync-magazord-pedidos — sync RAPIDO de pedidos do site Magazord
// Versao incremental dedicada (substitui frequencia da sync-magazord pra pedidos).
// - Usa orderDirection=desc + corte por dataHora → pega so os recentes.
// - Default: ultimas 72h. Body { dias_atras: N } sobrescreve.
// - Mapping IDENTICO ao syncPedidos da sync-magazord.ts (mesma tabela).
// - Cron sugerido: a cada 30 min (igual sync-pedidos do Bling).
// 🔒 SOMENTE LEITURA na Magazord.
// ════════════════════════════════════════════════════════════════════════════
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MZD_TOKEN = Deno.env.get('MAGAZORD_API_TOKEN')!
const MZD_SENHA = Deno.env.get('MAGAZORD_API_SENHA')!
const MZD_URL = (Deno.env.get('MAGAZORD_API_URL') || 'https://danajalecos.painel.magazord.com.br/api').replace(/\/$/, '')
const MZD_AUTH = 'Basic ' + btoa(`${MZD_TOKEN}:${MZD_SENHA}`)
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, apikey, Content-Type' }
const j = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } })

async function mzdGet(path: string) {
  const r = await fetch(`${MZD_URL}${path}`, { headers: { Authorization: MZD_AUTH, Accept: 'application/json' } })
  if (!r.ok) throw new Error(`Magazord ${r.status} ${path}: ${(await r.text()).slice(0, 300)}`)
  return r.json()
}
async function supaUpsert(rows: any[]) {
  if (!rows.length) return 0
  let total = 0
  for (let i = 0; i < rows.length; i += 500) {
    const slice = rows.slice(i, i + 500)
    const res = await fetch(`${SUPABASE_URL}/rest/v1/magazord_pedidos?on_conflict=id`, {
      method: 'POST',
      headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(slice),
    })
    if (!res.ok) throw new Error(`upsert ${res.status}: ${(await res.text()).slice(0, 400)}`)
    total += slice.length
  }
  return total
}
function mapPedido(p: any) {
  return {
    id: p.id,
    codigo: p.codigo ?? null,
    codigo_marketplace: p.codigoMarketplace ?? null,
    data_hora: p.dataHora ?? null,
    valor_produto: p.valorProduto ?? 0,
    valor_frete: p.valorFrete ?? 0,
    valor_desconto: p.valorDesconto ?? 0,
    valor_acrescimo: p.valorAcrescimo ?? 0,
    valor_total: p.valorTotal ?? 0,
    cupom_id: p.cupomId ?? null,
    pessoa_id: p.pessoaId ?? null,
    pessoa_nome: p.pessoaNome ?? null,
    pessoa_cpf_cnpj: p.pessoaCpfCnpj ?? null,
    pessoa_contato: p.pessoaContato ?? null,
    forma_pagamento_id: p.formaPagamentoId ?? null,
    forma_pagamento_nome: p.formaPagamentoNome ?? null,
    forma_recebimento_id: p.formaRecebimentoId ?? null,
    forma_recebimento_nome: p.formaRecebimentoNome ?? null,
    condicao_pagamento_id: p.condicaoPagamentoId ?? null,
    condicao_pagamento_nome: p.condicaoPagamentoNome ?? null,
    pedido_situacao: p.pedidoSituacao ?? null,
    pedido_situacao_descricao: p.pedidoSituacaoDescricao ?? null,
    pedido_situacao_tipo: p.pedidoSituacaoTipo ?? null,
    loja_id: p.lojaId ?? null,
    loja_marketplace_id: p.lojaDoMarketplaceId ?? null,
    loja_marketplace_nome: p.lojaDoMarketplaceNome ?? null,
    raw: p,
    synced_at: new Date().toISOString(),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  try {
    const t0 = Date.now()
    let dias = 3
    try { const b = await req.json(); if (b?.dias_atras) dias = Number(b.dias_atras) } catch {}
    const cutoff = new Date(Date.now() - dias * 86400000)
    const rows: any[] = []
    let lidos = 0
    let page = 1
    let stop = false
    while (!stop) {
      const data = await mzdGet(`/v2/site/pedido?limit=100&page=${page}&orderDirection=desc`)
      const items: any[] = data?.data?.items || []
      if (!items.length) break
      for (const p of items) {
        lidos++
        const dh = p.dataHora ? new Date(p.dataHora) : null
        if (dh && dh < cutoff) { stop = true; break } // ordenado desc → tudo daqui pra frente é antigo
        rows.push(mapPedido(p))
      }
      if (stop) break
      if (items.length < 100) break
      page++
      if (page > 200) break // safety
    }
    const n = await supaUpsert(rows)
    return j({
      ok: true, tabela: 'magazord_pedidos', modo: 'incremental_desc',
      janela_dias: dias, lidos, upserted: n, paginas_lidas: page,
      duracao_seg: Math.round((Date.now() - t0) / 1000),
    })
  } catch (e) {
    return j({ ok: false, erro: String((e as Error).message || e) }, 500)
  }
})
