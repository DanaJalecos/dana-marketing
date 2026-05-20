// ════════════════════════════════════════════════════════════════════════════
// sync-magazord-notas-fiscais — espelha NF-e do Magazord → Supabase
// Endpoint /v2/faturamento/notaFiscal (liberado em 19/05/2026)
// ~4.8k NF-e no acumulado. Sync incremental por dataAtualizacao (7 dias) +
// suporte a body { dias_atras: 9999 } pra full refresh manual.
// Read-only. DANFE PDF disponivel on-demand via /{id}/danfe/pdf.
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
    const res = await fetch(`${SUPABASE_URL}/rest/v1/magazord_notas_fiscais?on_conflict=id`, {
      method: 'POST',
      headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(slice),
    })
    if (!res.ok) throw new Error(`upsert ${res.status}: ${(await res.text()).slice(0, 400)}`)
    total += slice.length
  }
  return total
}

function mapNF(n: any) {
  return {
    id: n.id,
    tipo: n.tipo ?? null,
    situacao: n.situacao ?? null,
    numero: n.numero ?? null,
    chave: n.chave ?? null,
    serie: n.serie ?? null,
    data_emissao: n.dataEmissao ?? null,
    data_atualizacao: n.dataAtualizacao ?? null,
    raw: n,
    synced_at: new Date().toISOString(),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  try {
    const t0 = Date.now()
    let dias = 7
    try { const b = await req.json(); if (b?.dias_atras) dias = Number(b.dias_atras) } catch {}
    const ini = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10)
    const fim = new Date().toISOString().slice(0, 10)
    // /v2/faturamento/notaFiscal aceita filtros de data; usa dataEmissaoInicio/Fim
    const rows: any[] = []
    let page = 1
    while (true) {
      const q = `dataEmissaoInicio=${ini}&dataEmissaoFim=${fim}&limit=100&page=${page}`
      const data = await mzdGet(`/v2/faturamento/notaFiscal?${q}`)
      const items: any[] = data?.data?.items || []
      if (!items.length) break
      rows.push(...items.map(mapNF))
      const tp = data?.data?.total_pages ?? 1
      if (page >= tp) break
      page += 1
      if (page > 200) break
    }
    const n = await supaUpsert(rows)
    return j({ ok: true, tabela: 'magazord_notas_fiscais', janela_dias: dias, registros: n, duracao_seg: Math.round((Date.now() - t0) / 1000) })
  } catch (e) {
    return j({ ok: false, erro: String((e as Error).message || e) }, 500)
  }
})
