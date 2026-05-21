// ════════════════════════════════════════════════════════════════════════════
// sync-magazord-pedido-detalhe — detalhe completo dos pedidos do site
// Endpoint /v2/site/pedido/{codigo} (84 campos, inclui UTM/tracking).
// Itera pedidos novos no magazord_pedidos (ultimas N horas, default 48h) e
// faz drill on-demand pra capturar campos que a listagem nao traz.
// 🔒 READ-ONLY. Body { dias_atras: N } pra ampliar janela; { full: true } p/ tudo.
// ════════════════════════════════════════════════════════════════════════════
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MZD_TOKEN = Deno.env.get('MAGAZORD_API_TOKEN')!
const MZD_SENHA = Deno.env.get('MAGAZORD_API_SENHA')!
const MZD_URL = (Deno.env.get('MAGAZORD_API_URL') || 'https://danajalecos.painel.magazord.com.br/api').replace(/\/$/, '')
const MZD_AUTH = 'Basic ' + btoa(`${MZD_TOKEN}:${MZD_SENHA}`)
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, apikey, Content-Type' }
const j = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } })

async function pedidoCodes(diasAtras: number, full: boolean): Promise<string[]> {
  const url = full
    ? `${SUPABASE_URL}/rest/v1/magazord_pedidos?select=codigo&order=data_hora.desc&limit=10000`
    : `${SUPABASE_URL}/rest/v1/magazord_pedidos?select=codigo&data_hora=gte.${new Date(Date.now() - diasAtras * 86400000).toISOString()}&order=data_hora.desc&limit=5000`
  const res = await fetch(url, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } })
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
  for (let i = 0; i < rows.length; i += 200) {
    const slice = rows.slice(i, i + 200)
    const res = await fetch(`${SUPABASE_URL}/rest/v1/magazord_pedido_detalhe?on_conflict=id`, {
      method: 'POST',
      headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(slice),
    })
    if (!res.ok) throw new Error(`upsert ${res.status}: ${(await res.text()).slice(0, 400)}`)
    total += slice.length
  }
  return total
}

function mapDetail(d: any) {
  const params = d.pedidoTrackingParams && typeof d.pedidoTrackingParams === 'object' ? d.pedidoTrackingParams : {}
  return {
    id: d.id,
    codigo: d.codigo,
    data_hora: d.dataHora || null,
    origem: d.origem ?? null,
    utm_source: params.utm_source ?? null,
    utm_medium: params.utm_medium ?? null,
    utm_campaign: params.utm_campaign ?? null,
    utm_content: params.utm_content ?? null,
    utm_term: params.utm_term ?? null,
    tracking_source: d.pedidoTrackingSource ?? null,
    tracking_user_agent: d.pedidoTrackingUserAgent ?? null,
    tracking_country_code: d.pedidoTrackingCountryCode ?? null,
    tracking_conversion: d.pedidoTrackingConversion ?? null,
    cupom_id: d.cupomId ?? null,
    cupom_codigo: d.cupomCodigo ?? null,
    cupom_valor_desconto: d.cupomValorDesconto ?? null,
    cupom_tipo_desconto: d.cupomTipoDesconto ?? null,
    pessoa_email: d.pessoaEmail ?? null,
    pessoa_tipo: d.pessoaTipo ?? null,
    pessoa_data_nascimento: d.pessoaDataNascimento ?? null,
    pessoa_sexo: d.pessoaSexo ?? null,
    logradouro: d.logradouro ?? null,
    numero: d.numero != null ? String(d.numero) : null,
    bairro: d.bairro ?? null,
    cidade_nome: d.cidadeNome ?? null,
    estado_sigla: d.estadoSigla ?? null,
    cep: d.cep ?? null,
    valor_total: d.valorTotal ?? null,
    valor_personalizacao: d.valorPersonalizacao ?? null,
    credito_utilizado: d.creditoUtilizado ?? null,
    cashback_utilizado: d.cashbackUtilizado ?? null,
    pedido_situacao_tipo: d.pedidoSituacaoTipo != null ? String(d.pedidoSituacaoTipo) : null,
    pedido_situacao_descricao: d.pedidoSituacaoDescricao ?? null,
    raw: d,
    synced_at: new Date().toISOString(),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  try {
    const t0 = Date.now()
    let dias = 2
    let full = false
    try { const b = await req.json(); if (b?.dias_atras) dias = Number(b.dias_atras); if (b?.full) full = true } catch {}
    const codes = await pedidoCodes(dias, full)
    const rows: any[] = []
    let errs = 0
    for (const cod of codes) {
      const d = await mzdGet(`/v2/site/pedido/${cod}`)
      if (!d?.data) { errs++; continue }
      rows.push(mapDetail(d.data))
    }
    const n = await upsert(rows)
    return j({
      ok: true, tabela: 'magazord_pedido_detalhe',
      modo: full ? 'full' : `incremental_${dias}d`,
      pedidos_avaliados: codes.length, upserted: n, erros: errs,
      duracao_seg: Math.round((Date.now() - t0) / 1000),
    })
  } catch (e) {
    return j({ ok: false, erro: String((e as Error).message || e) }, 500)
  }
})
