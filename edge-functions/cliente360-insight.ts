// ══════════════════════════════════════════════════════════
// Edge Function: cliente360-insight
// Gera insight personalizado de um cliente via Groq/Gemini
//
// Uso:
//   POST /functions/v1/cliente360-insight
//   Body: { contato_nome: string, empresa: 'matriz'|'bc' }
//   Headers: Authorization: Bearer <jwt_do_usuario>
// ══════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY')!
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!

const GROQ_MODEL = 'llama-3.3-70b-versatile'
const GEMINI_MODEL = 'gemini-2.5-flash'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (o: any, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

const CARGOS_AUTORIZADOS = new Set(['admin', 'gerente_comercial', 'gerente_marketing', 'vendedor'])
const CARGOS_ILIMITADOS = new Set(['admin'])
const CARGOS_GERENTE    = new Set(['gerente_comercial', 'gerente_marketing'])

const LOJA_NOMES: Record<string, string> = {
  '0': 'Site', 'null': 'Site',
  '203536978': 'Loja/WhatsApp Piçarras',
  '203550865': 'Loja Física BC',
  '205337834': 'Mercado Livre',
  '205430008': 'TikTok Shop',
  '205522474': 'Shopee',
}
const lojaNome = (id: any) => (id === null || id === 0) ? 'Site' : (LOJA_NOMES[String(id)] || 'Magalu')

function fmtBRL(n: any) {
  return (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const SYSTEM_PROMPT = `Você é um consultor de CRM da Dana Jalecos (empresa brasileira de jalecos/scrubs/uniformes de saúde).

Sua tarefa: gerar uma análise prática e objetiva sobre um cliente específico baseado nos dados fornecidos. Vai aparecer num painel CRM que gestores usam pra decidir ações de relacionamento.

REGRAS:
1. Seja DIRETO e PRÁTICO. Nada de blá-blá genérico. Use os dados concretos.
2. Foque em AÇÕES executáveis, não em descrições vazias.
3. Responda em português brasileiro, tom consultivo e objetivo.
4. Cada seção é UM parágrafo corrido (NÃO use listas nem bullets).
5. Cada parágrafo tem 2-4 linhas (não escreva paredes de texto).
6. NÃO invente dados. Se algum dado não estiver disponível, trabalhe com o que tem.
7. Se o cliente for "Consumidor Final" ou razão social genérica, note isso na análise.
8. Use **negrito** em dados-chave (números, nomes de canais, categorias). Não use headers Markdown.

FORMATO OBRIGATÓRIO (exatamente 3 seções, nesse formato, com os rótulos em CAIXA ALTA seguidos de dois-pontos):

ANÁLISE DO COMPORTAMENTO ATUAL:
(parágrafo único descrevendo o perfil de compra: frequência, ticket, canal preferido, categorias, tempo ativo, segmento RFM)

RISCO OU OPORTUNIDADE PRINCIPAL:
(parágrafo único sobre O principal risco OU oportunidade — escolha o mais relevante e seja específico com números e datas)

AÇÃO COMERCIAL RECOMENDADA:
(parágrafo único com 1-2 ações concretas: o que oferecer, quando contatar, qual canal usar, com que tom)`

async function callGroq(messages: any[]) {
  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: GROQ_MODEL, messages, temperature: 0.5, max_tokens: 900 }),
  })
  if (!resp.ok) throw new Error(`Groq ${resp.status}: ${(await resp.text()).slice(0, 300)}`)
  const j = await resp.json()
  return j?.choices?.[0]?.message?.content || ''
}

async function callGemini(prompt: string) {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.5, maxOutputTokens: 900 },
      }),
    }
  )
  if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${(await resp.text()).slice(0, 300)}`)
  const j = await resp.json()
  return j?.candidates?.[0]?.content?.parts?.[0]?.text || ''
}

async function gerarInsight(contexto: string): Promise<{ text: string, modelo: string }> {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: contexto },
  ]
  // Tenta Groq primeiro
  try {
    const text = await callGroq(messages)
    if (text) return { text, modelo: GROQ_MODEL }
  } catch (e) {
    console.warn('[insight] Groq falhou:', (e as Error).message)
  }
  // Fallback Gemini (combina system + user em 1 prompt)
  const text = await callGemini(SYSTEM_PROMPT + '\n\n---\n\n' + contexto)
  return { text, modelo: GEMINI_MODEL }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  try {
    // 1. Auth
    const authHeader = req.headers.get('Authorization') || ''
    const jwt = authHeader.replace(/^Bearer /, '')
    if (!jwt) return json({ error: 'Autenticação obrigatória' }, 401)

    const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await userClient.auth.getUser(jwt)
    if (userErr || !userData.user) return json({ error: 'JWT inválido' }, 401)

    // 2. Permissão (admin, gerentes ou vendedor com quota)
    const { data: profile } = await admin.from('profiles').select('cargo, nome').eq('id', userData.user.id).single()
    const cargo = profile?.cargo || 'vendedor'
    if (!CARGOS_AUTORIZADOS.has(cargo)) {
      return json({ error: 'Sem permissão. Insights IA disponível para admin, gerentes e vendedores.' }, 403)
    }

    // 2.1. Config + kill-switch + quota
    const { data: cfg } = await admin.from('cliente_insights_config').select('*').eq('id', 1).single()
    const config = cfg || {
      ativo: true, limite_diario_vendedor: 5, limite_diario_gerente: 20,
      limite_mensal_reais: 30, custo_por_insight_reais: 0.02, pausado_por_limite: false
    }
    if (!config.ativo) {
      return json({ error: 'Geração de insights está desativada pelo admin.' }, 403)
    }
    if (config.pausado_por_limite) {
      return json({ error: 'Geração de insights pausada — limite mensal atingido. Fale com o admin.' }, 403)
    }

    // Kill-switch automático: gasto do mês >= limite
    const { data: gastoMes } = await admin.rpc('cliente_insights_gasto_mes')
    const gasto = Number(gastoMes) || 0
    if (gasto >= Number(config.limite_mensal_reais)) {
      // Auto-pausa
      await admin.from('cliente_insights_config').update({ pausado_por_limite: true }).eq('id', 1)
      return json({ error: `Limite mensal de R$ ${config.limite_mensal_reais} atingido. Geração pausada.` }, 403)
    }

    // Quota diária (admin ilimitado)
    let limiteDiario = 0
    if (CARGOS_ILIMITADOS.has(cargo)) {
      limiteDiario = -1 // ilimitado
    } else if (CARGOS_GERENTE.has(cargo)) {
      limiteDiario = Number(config.limite_diario_gerente) || 20
    } else {
      // vendedor
      limiteDiario = Number(config.limite_diario_vendedor) || 5
    }

    if (limiteDiario !== -1) {
      const { data: countHoje } = await admin.rpc('cliente_insights_count_hoje', { uid: userData.user.id })
      const usados = Number(countHoje) || 0
      if (usados >= limiteDiario) {
        return json({
          error: `Quota diária atingida (${usados}/${limiteDiario}). Tente novamente amanhã.`,
          quota: { usados, limite: limiteDiario, restante: 0 }
        }, 429)
      }
    }

    // 3. Body
    const body = await req.json()
    const contato_nome = String(body.contato_nome || '').trim()
    const empresa = body.empresa === 'bc' ? 'bc' : 'matriz'
    if (!contato_nome) return json({ error: 'contato_nome obrigatório' }, 400)

    // 3.1 Escopo vendedor: só pode gerar insight de cliente DA CARTEIRA dele
    if (cargo === 'vendedor') {
      const { data: meusClientes } = await admin
        .from('cliente_scoring_vendedor')
        .select('contato_nome')
        .eq('vendedor_profile_id', userData.user.id)
        .eq('empresa', empresa)
        .eq('contato_nome', contato_nome)
        .maybeSingle()
      if (!meusClientes) {
        return json({
          error: 'Este cliente não está na sua carteira. Você só pode gerar insights dos seus clientes.'
        }, 403)
      }
    }

    // 4. Busca dados agregados (cliente_scoring_full)
    const { data: cs } = await admin
      .from('cliente_scoring_full')
      .select('*')
      .eq('empresa', empresa)
      .eq('contato_nome', contato_nome)
      .maybeSingle()
    if (!cs) return json({ error: 'Cliente não encontrado' }, 404)

    // 5. Busca últimos 30 pedidos com itens
    const { data: pedidos } = await admin
      .from('pedidos')
      .select('id, numero, data, total, total_produtos, situacao_id, loja_id, vendedor_nome')
      .eq('empresa', empresa)
      .eq('contato_nome', contato_nome)
      .order('data', { ascending: false })
      .limit(30)
    const pids = (pedidos || []).map((p: any) => p.id)
    const { data: itens } = pids.length
      ? await admin.from('pedidos_itens').select('pedido_id, descricao, quantidade, valor_total').in('pedido_id', pids)
      : { data: [] }
    const itensPorPedido: Record<string, any[]> = {}
    for (const it of itens || []) {
      (itensPorPedido[it.pedido_id] = itensPorPedido[it.pedido_id] || []).push(it)
    }

    // 6. Agregados
    const canalCount: Record<string, number> = {}
    const catCount: Record<string, number> = {}
    for (const p of pedidos || []) {
      canalCount[lojaNome(p.loja_id)] = (canalCount[lojaNome(p.loja_id)] || 0) + 1
      for (const i of itensPorPedido[p.id] || []) {
        const d = String(i.descricao || '').toLowerCase()
        let cat = 'Outros'
        if (d.includes('jaleco')) cat = 'Jalecos'
        else if (d.includes('scrub')) cat = 'Scrubs'
        else if (d.includes('kit')) cat = 'Kits'
        else if (d.includes('conjunto')) cat = 'Conjuntos'
        else if (d.includes('calca') || d.includes('calça')) cat = 'Calças'
        else if (d.includes('camisa') || d.includes('blusa')) cat = 'Camisas'
        else if (d.includes('avental')) cat = 'Aventais'
        else if (d.includes('gorro') || d.includes('touca')) cat = 'Acessórios'
        catCount[cat] = (catCount[cat] || 0) + (Number(i.quantidade) || 1)
      }
    }
    const topCanal = Object.entries(canalCount).sort((a, b) => b[1] - a[1]).slice(0, 3)
    const topCat = Object.entries(catCount).sort((a, b) => b[1] - a[1]).slice(0, 3)

    // 7. Últimas compras resumidas
    const ultimasCompras = (pedidos || []).slice(0, 5).map((p: any) => {
      const dataStr = p.data ? new Date(p.data).toLocaleDateString('pt-BR') : '—'
      const valor = Number(p.total) || Number(p.total_produtos) || 0
      const qtdItens = (itensPorPedido[p.id] || []).length
      return `- ${dataStr} · ${lojaNome(p.loja_id)} · ${fmtBRL(valor)} · ${qtdItens} item(ns)`
    }).join('\n')

    const empresaLabel = empresa === 'matriz' ? 'Matriz (Piçarras)' : 'Balneário Camboriú (BC)'
    const tipoPessoa = cs.tipo_pessoa === 'J' ? 'Pessoa Jurídica' : cs.tipo_pessoa === 'F' ? 'Pessoa Física' : 'N/D'
    const fone = cs.celular || cs.telefone || '—'
    const hoje = new Date().toLocaleDateString('pt-BR')

    // 8. Monta contexto pro LLM
    const contexto = `DADOS DO CLIENTE (${hoje}, empresa ${empresaLabel}):

Nome: ${cs.contato_nome}
Tipo: ${tipoPessoa}
Telefone: ${fone}
Segmento: ${cs.segmento} (score ${cs.score}/100)

Métricas agregadas:
- Total de pedidos: ${cs.total_pedidos}
- Total gasto: ${fmtBRL(cs.total_gasto)}
- Ticket médio: ${fmtBRL(cs.ticket_medio)}
- Última compra: ${cs.ultima_compra || '—'} (${cs.dias_sem_compra} dias atrás)
- Meses ativos: ${cs.meses_ativos}

Canais de compra (frequência):
${topCanal.length ? topCanal.map(([k, v]) => `- ${k}: ${v} pedido(s)`).join('\n') : '- (sem dados)'}

Categorias preferidas (por quantidade de itens):
${topCat.length ? topCat.map(([k, v]) => `- ${k}: ${v} peça(s)`).join('\n') : '- (sem dados)'}

Últimas 5 compras:
${ultimasCompras || '- (sem compras registradas)'}

---

Gere o insight seguindo EXATAMENTE o formato obrigatório do system prompt.`

    // 9. Gera via LLM
    const { text, modelo } = await gerarInsight(contexto)

    // Custo estimado (Groq = free, Gemini 2.5 Flash ~$0.02 BRL equiv)
    const custoEstimado = modelo.toLowerCase().includes('gemini')
      ? Number(config.custo_por_insight_reais) || 0.02
      : 0  // Groq = zero custo
    const provider = modelo.toLowerCase().includes('gemini') ? 'gemini'
                   : modelo.toLowerCase().includes('groq') || modelo.toLowerCase().includes('llama') ? 'groq'
                   : 'desconhecido'

    // 10. Salva no cliente_insights (cache + quota)
    await admin.from('cliente_insights').insert({
      empresa,
      contato_nome,
      insight: text,
      modelo,
      modelo_provider: provider,
      user_id: userData.user.id,
      user_nome: profile?.nome || userData.user.email,
      cargo_autor: cargo,
      custo_estimado: custoEstimado,
    }).then(({ error }) => { if (error) console.warn('[insight] save erro:', error.message) })

    // Quota info pra UI mostrar "3/5"
    let quotaInfo: any = null
    if (limiteDiario !== -1) {
      const { data: novoCount } = await admin.rpc('cliente_insights_count_hoje', { uid: userData.user.id })
      quotaInfo = {
        usados: Number(novoCount) || 0,
        limite: limiteDiario,
        restante: Math.max(0, limiteDiario - (Number(novoCount) || 0)),
      }
    }

    return json({ ok: true, insight: text, modelo, provider, custo_estimado: custoEstimado, quota: quotaInfo, gerado_em: new Date().toISOString() })
  } catch (e) {
    console.error('[insight] erro:', e)
    return json({ error: (e as Error).message || 'erro interno' }, 500)
  }
})
