// ════════════════════════════════════════════════════════════════════════════
// sync-magazord-avaliacoes — espelha avaliações do site Magazord → Supabase
// ════════════════════════════════════════════════════════════════════════════
// Cron diário. Endpoint POST /v3/avaliacoes/query (liberado em 19/05/2026).
// ~346 avaliações em 2026-05; paginado, full refresh por id. Read-only.
// ════════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MZD_TOKEN = Deno.env.get('MAGAZORD_API_TOKEN')!
const MZD_SENHA = Deno.env.get('MAGAZORD_API_SENHA')!
const MZD_URL = (Deno.env.get('MAGAZORD_API_URL') || 'https://danajalecos.painel.magazord.com.br/api').replace(/\/$/, '')
const MZD_AUTH = 'Basic ' + btoa(`${MZD_TOKEN}:${MZD_SENHA}`)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, apikey, Content-Type',
}
const j = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } })

async function mzdPost(path: string, body: any) {
  const r = await fetch(`${MZD_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: MZD_AUTH, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`Magazord ${r.status} ${path}: ${(await r.text()).slice(0, 300)}`)
  return r.json()
}

async function supaUpsert(rows: any[]) {
  if (!rows.length) return 0
  let total = 0
  for (let i = 0; i < rows.length; i += 500) {
    const slice = rows.slice(i, i + 500)
    const res = await fetch(`${SUPABASE_URL}/rest/v1/magazord_avaliacoes?on_conflict=id`, {
      method: 'POST',
      headers: {
        apikey: SR,
        Authorization: `Bearer ${SR}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(slice),
    })
    if (!res.ok) throw new Error(`upsert ${res.status}: ${(await res.text()).slice(0, 400)}`)
    total += slice.length
  }
  return total
}

function mapAval(a: any) {
  return {
    id: a.id,
    data_hora: a.dataHora ?? null,
    nota: a.nota ?? null,
    mensagem: a.mensagem ?? null,
    situacao: a.situacao ?? null,
    codigo_pedido: a.codigoPedido ?? null,
    id_produto: a.idProduto ?? null,
    nome_pessoa: a.nomePessoa ?? null,
    loja: a.loja ?? null,
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
      const data = await mzdPost(`/v3/avaliacoes/query?limit=100&page=${page}`, {})
      const items: any[] = data?.items || []
      if (!items.length) break
      rows.push(...items.map(mapAval))
      const totalPages = data?.totalPages ?? 1
      if (page >= totalPages) break
      page += 1
      if (page > 200) break // safety
    }
    const n = await supaUpsert(rows)
    return j({ ok: true, tabela: 'magazord_avaliacoes', registros: n, duracao_seg: Math.round((Date.now() - t0) / 1000) })
  } catch (e) {
    return j({ ok: false, erro: String((e as Error).message || e) }, 500)
  }
})
