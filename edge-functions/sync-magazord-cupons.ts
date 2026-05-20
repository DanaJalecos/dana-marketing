// ════════════════════════════════════════════════════════════════════════════
// sync-magazord-cupons — espelha cupons de desconto do Magazord → Supabase
// ════════════════════════════════════════════════════════════════════════════
// Cron diário. Endpoint /v2/site/cupomDesconto (liberado em 19/05/2026).
// Pequeno volume (~140), faz full-refresh por id. Read-only.
//
// 🔒 SOMENTE LEITURA na Magazord. Nunca POST/PUT/PATCH/DELETE (regra 73.7).
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
    const res = await fetch(`${SUPABASE_URL}/rest/v1/magazord_cupons?on_conflict=id`, {
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

function mapCupom(c: any) {
  return {
    id: c.id,
    codigo: c.codigo,
    ativo: c.ativo ?? null,
    descricao: c.descricao ?? null,
    observacao_cliente: c.observacaoCliente ?? null,
    tipo_desconto: c.tipoDesconto ?? null,
    tipo_limite: c.tipoLimite ?? null,
    valor_desconto: c.valorDesconto != null ? Number(c.valorDesconto) : null,
    valido_ate: c.validoAte ?? null,
    loja: c.loja ?? null,
    aplica_descontos_fp: c.aplicaDescontosFp ?? null,
    raw: c,
    synced_at: new Date().toISOString(),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  try {
    const t0 = Date.now()
    // Lista paginada (a API responde até 100 por página por padrão; pedimos 200 e iteramos por segurança)
    const rows: any[] = []
    let page = 1
    while (true) {
      const data = await mzdGet(`/v2/site/cupomDesconto?limit=100&page=${page}`)
      const items: any[] = data?.data?.items || []
      if (!items.length) break
      rows.push(...items.map(mapCupom))
      const totalPages = data?.data?.total_pages ?? 1
      if (page >= totalPages) break
      page += 1
      if (page > 50) break // safety
    }
    const n = await supaUpsert(rows)
    return j({ ok: true, tabela: 'magazord_cupons', registros: n, duracao_seg: Math.round((Date.now() - t0) / 1000) })
  } catch (e) {
    return j({ ok: false, erro: String((e as Error).message || e) }, 500)
  }
})
