// sync-magazord-pedido-payments — payments por pedido recente
// Itera pedidos dos ultimos N dias (default 2) e busca /v2/site/pedido/{cod}/payments.
// Read-only. Tolerante a 404 por pedido.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MZD_TOKEN = Deno.env.get('MAGAZORD_API_TOKEN')!
const MZD_SENHA = Deno.env.get('MAGAZORD_API_SENHA')!
const MZD_URL = (Deno.env.get('MAGAZORD_API_URL') || 'https://danajalecos.painel.magazord.com.br/api').replace(/\/$/, '')
const MZD_AUTH = 'Basic ' + btoa(`${MZD_TOKEN}:${MZD_SENHA}`)
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, apikey, Content-Type' }
const j = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } })

async function pedidoCodes(diasAtras: number): Promise<string[]> {
  const since = new Date(Date.now() - diasAtras * 86400000).toISOString()
  const res = await fetch(`${SUPABASE_URL}/rest/v1/magazord_pedidos?select=codigo&data_hora=gte.${since}&order=data_hora.desc&limit=5000`, {
    headers: { apikey: SR, Authorization: `Bearer ${SR}` },
  })
  const arr = (await res.json()) as any[]
  return arr.map(r => r.codigo).filter(Boolean)
}

async function mzdGet(path: string): Promise<any | null> {
  try {
    const r = await fetch(`${MZD_URL}${path}`, { headers: { Authorization: MZD_AUTH, Accept: 'application/json' } })
    if (!r.ok) return null
    return r.json()
  } catch { return null }
}

async function upsert(rows: any[]) {
  if (!rows.length) return 0
  let total = 0
  for (let i = 0; i < rows.length; i += 500) {
    const slice = rows.slice(i, i + 500)
    const res = await fetch(`${SUPABASE_URL}/rest/v1/magazord_pedido_payments?on_conflict=id`, {
      method: 'POST',
      headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(slice),
    })
    if (!res.ok) throw new Error(`upsert ${res.status}: ${(await res.text()).slice(0, 400)}`)
    total += slice.length
  }
  return total
}

function mapPay(cod: string, p: any) {
  return {
    id: p.id, pedido_codigo: cod,
    id_forma_pagamento: p.idFormaPagamento ?? null, forma_pagamento: p.formaPagamento ?? null,
    condicao_pagamento: p.condicaoPagamento ?? null, entrega: p.entrega ?? null,
    forma_recebimento: p.formaRecebimento ?? null,
    id_gateway: p.idGateway ?? null, gateway: p.gateway ?? null,
    valor: p.valor ?? null, valor_transacao: p.valorTransacao ?? null,
    gateway_configuracao: p.gatewayConfiguracao ?? null,
    cartao: p.cartao ?? null, boleto: p.boleto ?? null, pix: p.pix ?? null, cupom: p.cupom ?? null,
    raw: p, synced_at: new Date().toISOString(),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  try {
    const t0 = Date.now()
    let dias = 2
    try { const b = await req.json(); if (b?.dias_atras) dias = Number(b.dias_atras) } catch {}
    const codes = await pedidoCodes(dias)
    const rows: any[] = []
    let errs = 0
    for (const cod of codes) {
      const d = await mzdGet(`/v2/site/pedido/${cod}/payments`)
      if (!d) { errs++; continue }
      const items: any[] = d?.data?.items || []
      for (const p of items) rows.push(mapPay(cod, p))
    }
    const n = await upsert(rows)
    return j({ ok: true, tabela: 'magazord_pedido_payments', pedidos: codes.length, payments: n, erros: errs, duracao_seg: Math.round((Date.now() - t0) / 1000) })
  } catch (e) {
    return j({ ok: false, erro: String((e as Error).message || e) }, 500)
  }
})
