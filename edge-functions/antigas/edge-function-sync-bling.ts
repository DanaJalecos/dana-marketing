// ══════════════════════════════════════════════════════════
// Edge Function: sync-bling (ATUALIZADA)
// Deployar no Supabase: Edge Functions > sync-bling > Editar
// Agora puxa: pedidos (7 dias), contatos, contas (todas situações), produtos
// ══════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BLING_CLIENT_ID = 'bd02a35efc5c5b4eb2846d77fdc4d6f063b11d19'
const BLING_CLIENT_SECRET = 'b2844954fea8b4d935c7aadc1f7f7d99c064792b2c9c2eecc2ab2eb0bb6e'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

async function blingFetch(path: string, token: string): Promise<any> {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`https://api.bling.com.br/Api/v3/${path}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      if (res.status === 429) { await new Promise(r => setTimeout(r, 10000)); continue }
      const text = await res.text()
      if (text.startsWith('<')) { await new Promise(r => setTimeout(r, 10000)); continue }
      return JSON.parse(text)
    } catch { await new Promise(r => setTimeout(r, 5000)) }
  }
  return { data: [] }
}

async function getToken(): Promise<string> {
  const { data: row } = await supabase.from('bling_tokens').select('*').eq('id', 1).single()
  if (!row) throw new Error('No token found')
  const test = await blingFetch('pedidos/vendas?pagina=1&limite=1', row.access_token)
  if (!test.error) return row.access_token

  console.log('Renovando token...')
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

async function upsert(table: string, rows: any[]) {
  if (!rows.length) return
  const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id' })
  if (error) console.error(`Upsert ${table}:`, error.message)
}

// ── PEDIDOS (últimos 7 dias — incremental) ──
async function syncPedidos(token: string) {
  const hoje = new Date()
  const inicio = new Date(hoje); inicio.setDate(inicio.getDate() - 7)
  let total = 0
  for (let page = 1; page <= 10; page++) {
    const data = await blingFetch(
      `pedidos/vendas?pagina=${page}&limite=100&dataInicial=${inicio.toISOString().split('T')[0]}&dataFinal=${hoje.toISOString().split('T')[0]}`, token)
    if (!data.data?.length) break
    await upsert('pedidos', data.data.map((p: any) => ({
      id: p.id, numero: p.numero, numero_loja: p.numeroLoja || '',
      data: p.data, data_saida: p.dataSaida && p.dataSaida !== '0000-00-00' ? p.dataSaida : null,
      total_produtos: p.totalProdutos || 0, total: p.total || 0,
      contato_nome: p.contato?.nome || '', contato_tipo: p.contato?.tipoPessoa || '',
      situacao_id: p.situacao?.id || 0, loja_id: p.loja?.id || 0,
    })))
    total += data.data.length; await new Promise(r => setTimeout(r, 500))
  }
  console.log(`Pedidos: ${total}`)
  return total
}

// ── CONTAS A RECEBER (TODAS as situações: aberto + recebido + atrasado) ──
async function syncContasReceber(token: string) {
  let total = 0
  for (const sit of [1, 2, 3]) {
    for (let page = 1; page <= 20; page++) {
      const data = await blingFetch(`contas/receber?pagina=${page}&limite=100&situacao=${sit}`, token)
      if (!data.data?.length) break
      await upsert('contas_receber', data.data.map((c: any) => ({
        id: c.id, situacao: c.situacao, vencimento: c.vencimento, valor: c.valor || 0,
        data_emissao: c.dataEmissao && c.dataEmissao !== '0000-00-00' ? c.dataEmissao : null,
        contato_nome: c.contato?.nome || '', contato_tipo: c.contato?.tipo || '',
        origem_tipo: c.origem?.tipoOrigem || '', origem_numero: c.origem?.numero || '',
        conta_contabil: c.contaContabil?.descricao || '',
      })))
      total += data.data.length; await new Promise(r => setTimeout(r, 500))
    }
  }
  console.log(`Contas receber: ${total}`)
  return total
}

// ── CONTAS A PAGAR (TODAS as situações) ──
async function syncContasPagar(token: string) {
  let total = 0
  for (const sit of [1, 2, 3]) {
    for (let page = 1; page <= 20; page++) {
      const data = await blingFetch(`contas/pagar?pagina=${page}&limite=100&situacao=${sit}`, token)
      if (!data.data?.length) break
      await upsert('contas_pagar', data.data.map((c: any) => ({
        id: c.id, situacao: c.situacao, vencimento: c.vencimento,
        valor: c.valor || 0, contato_id: c.contato?.id || 0,
      })))
      total += data.data.length; await new Promise(r => setTimeout(r, 500))
    }
  }
  console.log(`Contas pagar: ${total}`)
  return total
}

// ── PRODUTOS (ativos) ──
async function syncProdutos(token: string) {
  let total = 0
  for (let page = 1; page <= 50; page++) {
    const data = await blingFetch(`produtos?pagina=${page}&limite=100&tipo=P&situacao=A`, token)
    if (!data.data?.length) break
    await upsert('produtos', data.data.map((p: any) => ({
      id: p.id, nome: p.nome, codigo: p.codigo || '', preco: p.preco || 0,
      preco_custo: p.precoCusto || 0, estoque_virtual: p.estoque?.saldoVirtualTotal || 0,
      tipo: p.tipo, situacao: p.situacao, formato: p.formato, imagem_url: p.imagemURL || '',
    })))
    total += data.data.length; await new Promise(r => setTimeout(r, 500))
  }
  console.log(`Produtos: ${total}`)
  return total
}

// ── CONTATOS (últimos 500 — incremental, pega novos) ──
async function syncContatos(token: string) {
  let total = 0
  for (let page = 1; page <= 5; page++) {
    const data = await blingFetch(`contatos?pagina=${page}&limite=100`, token)
    if (!data.data?.length) break
    await upsert('contatos', data.data.map((c: any) => ({
      id: c.id, nome: c.nome || '', codigo: c.codigo || '',
      situacao: c.situacao || '', tipo_pessoa: c.tipoPessoa || c.tipo || '',
      numero_documento: c.numeroDocumento || '',
      telefone: c.telefone || '', celular: c.celular || '',
    })))
    total += data.data.length; await new Promise(r => setTimeout(r, 500))
  }
  console.log(`Contatos (incremental): ${total}`)
  return total
}

// ── MAIN ──
Deno.serve(async () => {
  try {
    const token = await getToken()
    console.log(`Token OK`)

    const pedidos = await syncPedidos(token)
    const cr = await syncContasReceber(token)
    const cp = await syncContasPagar(token)
    const produtos = await syncProdutos(token)
    const contatos = await syncContatos(token)

    const totalRegs = pedidos + cr + cp + produtos + contatos

    await supabase.from('sync_log').insert({
      tabela: 'all', registros: totalRegs, status: 'ok', created_at: new Date().toISOString(),
    })

    return new Response(JSON.stringify({
      ok: true,
      time: new Date().toISOString(),
      pedidos, contas_receber: cr, contas_pagar: cp, produtos, contatos,
      total: totalRegs,
    }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    console.error('Sync error:', e.message)
    await supabase.from('sync_log').insert({
      tabela: 'all', registros: 0, status: 'error', erro: e.message, created_at: new Date().toISOString(),
    })
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})
