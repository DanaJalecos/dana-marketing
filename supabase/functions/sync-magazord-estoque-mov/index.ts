// sync-magazord-estoque-mov — movimentacoes de estoque /v1/listMovimentacaoEstoque
// Sync incremental: para quando achar movimentacao_id ja gravado, exceto se
// body.dias_atras=9999 (backfill manual full). Read-only.
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

async function maxMovimentacao(): Promise<number> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/magazord_estoque_movimentacoes?select=movimentacao&order=movimentacao.desc&limit=1`, {
    headers: { apikey: SR, Authorization: `Bearer ${SR}` },
  })
  const arr = (await res.json()) as any[]
  return arr?.[0]?.movimentacao ?? 0
}

async function supaUpsert(rows: any[]) {
  if (!rows.length) return 0
  let total = 0
  for (let i = 0; i < rows.length; i += 500) {
    const slice = rows.slice(i, i + 500)
    const res = await fetch(`${SUPABASE_URL}/rest/v1/magazord_estoque_movimentacoes?on_conflict=movimentacao`, {
      method: 'POST',
      headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(slice),
    })
    if (!res.ok) throw new Error(`upsert ${res.status}: ${(await res.text()).slice(0, 400)}`)
    total += slice.length
  }
  return total
}

function mapMov(m: any) {
  return {
    movimentacao: m.movimentacao,
    deposito: m.deposito ?? null,
    produto: m.produto ?? null,
    valor_movimentacao: m.valorMovimentacao ?? null,
    data_hora_movimentacao: m.dataHoraMovimentacao ?? null,
    data_hora_inclusao: m.dataHoraInclusao ?? null,
    tipo_operacao: m.tipoOperacao ?? null,
    tipo: m.tipo ?? null,
    quantidade: m.quantidade ?? null,
    origem: m.origem ?? null,
    pedido_id: m.pedidoId ?? null,
    pedido_codigo: m.pedidoCodigo ?? null,
    nota_fiscal_id: m.notaFiscalId ?? null,
    nota_fiscal_numero: m.notaFiscalNumero ?? null,
    observacao: m.observacao ?? null,
    numero_serie: m.numero_serie ?? null,
    raw: m,
    synced_at: new Date().toISOString(),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  try {
    const t0 = Date.now()
    // ⚠️ /v1/listMovimentacaoEstoque IGNORA `page` (sempre devolve a primeira).
    // Paginacao real é via `offset`. Default incremental: ultimas 300 movim.
    let recentN = 300
    let full = false
    try {
      const b = await req.json()
      if (b?.recent_n) recentN = Number(b.recent_n)
      if (b?.dias_atras && Number(b.dias_atras) > 100) full = true
    } catch {}
    const cursor = full ? 0 : await maxMovimentacao()
    // pega total
    const first = await mzdGet(`/v1/listMovimentacaoEstoque?limit=100&offset=0`)
    const totalApi: number = first?.total ?? 0
    // incremental: pega so o final do array (novos)
    const startOffset = full ? 0 : Math.max(0, totalApi - recentN)
    const rows: any[] = []
    for (let off = startOffset; off < totalApi; off += 100) {
      const data = off === 0 ? first : await mzdGet(`/v1/listMovimentacaoEstoque?limit=100&offset=${off}`)
      const items: any[] = data?.data || []
      if (!items.length) break
      for (const it of items) {
        if (!full && it.movimentacao <= cursor) continue
        rows.push(mapMov(it))
      }
    }
    const n = await supaUpsert(rows)
    return j({
      ok: true, tabela: 'magazord_estoque_movimentacoes',
      modo: full ? 'full' : `incremental_apos_${cursor}`,
      offset_inicial: startOffset, registros: n,
      duracao_seg: Math.round((Date.now() - t0) / 1000),
    })
  } catch (e) {
    return j({ ok: false, erro: String((e as Error).message || e) }, 500)
  }
})
