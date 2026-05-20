// sync-magazord-contas-receber — titulos a receber do Magazord
// Endpoint /v2/faturamento/contaReceber. 12k+ titulos. Read-only.
// Paginacao por `page=N` (v2 respeita). Filtros de data sao ignorados pela API.
// Schema peculiar: items[i]['0'] = objeto principal; datas vem como { date, timezone_type, timezone }.
// Incremental por MAX(id) — backfill manual via body { dias_atras: 9999 } (full=true).
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
async function maxId(): Promise<number> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/magazord_contas_receber?select=id&order=id.desc&limit=1`, {
    headers: { apikey: SR, Authorization: `Bearer ${SR}` },
  })
  const arr = (await res.json()) as any[]
  return arr?.[0]?.id ?? 0
}
async function supaUpsert(rows: any[]) {
  if (!rows.length) return 0
  let total = 0
  for (let i = 0; i < rows.length; i += 200) {
    const slice = rows.slice(i, i + 200)
    const res = await fetch(`${SUPABASE_URL}/rest/v1/magazord_contas_receber?on_conflict=id`, {
      method: 'POST',
      headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(slice),
    })
    if (!res.ok) throw new Error(`upsert ${res.status}: ${(await res.text()).slice(0, 400)}`)
    total += slice.length
  }
  return total
}
// helper: extrai 'date' do wrapper Magazord; aceita string direta tambem; null-safe
function gd(x: any): string | null {
  if (x == null) return null
  if (typeof x === 'object' && 'date' in x) return x.date as string
  return x as string
}
function gdDateOnly(x: any): string | null {
  const s = gd(x)
  if (!s) return null
  return (s.split(' ')[0]) || null
}
function map(item: any) {
  const a = item['0'] || {}
  const um = a.ultimoMovimento || {}
  const p = a.pessoa || {}
  const tipo = a.tipo || {}
  const sit = a.situacao || {}
  const fp = a.formaPagamento || {}
  const ped = (a.origem || {}).pedido || {}
  return {
    id: a.id,
    numero: a.numero ?? null,
    parcela: item.parcela ?? null,
    data_abertura: gd(a.dataAbertura),
    data_vencimento: gdDateOnly(a.dataVencimento),
    data_geracao: gdDateOnly(a.dataGeracao),
    data_liberacao: gdDateOnly(item.dataLiberacao), // bugfix: API devolve wrapper aqui tambem
    data_ultimo_movimento: gd(um.data),
    valor_original: a.valorOriginal ?? null,
    valor_liquidado: a.valorLiquidado ?? null,
    valor_saldo: item.saldo ?? null,
    situacao_id: sit.id ?? null,
    situacao_descricao: sit.descricao ?? null,
    tipo_id: tipo.id ?? null,
    tipo_sigla: tipo.sigla ?? null,
    forma_pagamento_id: fp.id ?? null,
    forma_pagamento_nome: fp.nome ?? null,
    pessoa_id: p.id ?? null,
    pessoa_nome: p.nome ?? null,
    pessoa_cpf_cnpj: p.cpfCnpj ?? null,
    pedido_id: ped.id ?? null,
    pedido_codigo: ped.codigo ?? null,
    telefone: item.telefone ?? null,
    raw: item,
    synced_at: new Date().toISOString(),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  try {
    const t0 = Date.now()
    let pagesRecent = 5 // default: incremental ~500 ultimos titulos
    let full = false
    try {
      const b = await req.json()
      if (b?.pages_recent) pagesRecent = Number(b.pages_recent)
      if (b?.dias_atras && Number(b.dias_atras) > 100) full = true
    } catch {}
    const cursor = full ? 0 : await maxId()
    // primeira pagina pra pegar total
    const first = await mzdGet(`/v2/faturamento/contaReceber?limit=100&page=1`)
    const totalApi: number = first?.data?.total ?? 0
    const totalPages = Math.max(1, Math.ceil(totalApi / 100))
    const startPage = full ? 1 : Math.max(1, totalPages - pagesRecent + 1)
    const rows: any[] = []
    for (let page = startPage; page <= totalPages; page++) {
      const data = page === 1 ? first : await mzdGet(`/v2/faturamento/contaReceber?limit=100&page=${page}`)
      const items: any[] = data?.data?.items || []
      for (const it of items) {
        const id = it?.['0']?.id
        if (!id) continue
        if (!full && id <= cursor) continue
        rows.push(map(it))
      }
    }
    const n = await supaUpsert(rows)
    return j({
      ok: true, tabela: 'magazord_contas_receber',
      modo: full ? 'full' : `incremental_apos_${cursor}`,
      paginas: `${startPage}..${totalPages}`, registros: n,
      duracao_seg: Math.round((Date.now() - t0) / 1000),
    })
  } catch (e) {
    return j({ ok: false, erro: String((e as Error).message || e) }, 500)
  }
})
