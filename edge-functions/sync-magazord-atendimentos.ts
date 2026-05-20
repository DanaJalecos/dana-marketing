// sync-magazord-atendimentos — espelha SAC do Magazord
// Endpoint /v2/site/atendimento. Full refresh paginado (546 itens). Read-only.
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
    const res = await fetch(`${SUPABASE_URL}/rest/v1/magazord_atendimentos?on_conflict=id`, {
      method: 'POST',
      headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(slice),
    })
    if (!res.ok) throw new Error(`upsert ${res.status}: ${(await res.text()).slice(0, 400)}`)
    total += slice.length
  }
  return total
}

function mapAt(a: any) {
  return {
    id: a.id,
    tipo: a.tipo ?? null,
    assunto: a.assunto ?? null,
    data: a.data ?? null,
    situacao: a.situacao ?? null,
    nome_cliente: a.nomeCliente ?? null,
    email_cliente: a.emailCliente ?? null,
    telefone_cliente: a.telefoneCliente ?? null,
    estado_cidade_cliente: a.estadoCidadeCliente ?? null,
    cidade_cliente: a.cidadeCliente ?? null,
    numero_pedido: a.numeroPedido ?? null,
    raw: a,
    synced_at: new Date().toISOString(),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  try {
    const t0 = Date.now()
    const rows: any[] = []
    let page = 1
    while (true) {
      const data = await mzdGet(`/v2/site/atendimento?limit=100&page=${page}&orderDirection=desc`)
      const items: any[] = data?.data?.items || []
      if (!items.length) break
      rows.push(...items.map(mapAt))
      const tp = data?.data?.total_pages ?? 1
      if (page >= tp) break
      page += 1
      if (page > 200) break
    }
    const n = await supaUpsert(rows)
    return j({ ok: true, tabela: 'magazord_atendimentos', registros: n, duracao_seg: Math.round((Date.now() - t0) / 1000) })
  } catch (e) {
    return j({ ok: false, erro: String((e as Error).message || e) }, 500)
  }
})
