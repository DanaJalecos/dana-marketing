// ══════════════════════════════════════════════════════════════════════════
// Edge Function: cliente360-insight (versão SEM @supabase/supabase-js)
// Reescrita com fetch direto pra REST API + Auth pra ser resiliente a
// problemas de cache CDN do Deno. Mesmo pattern do sync-magazord.
//
// Uso:
//   POST /functions/v1/cliente360-insight
//   Body: { contato_nome: string, empresa: 'matriz'|'bc' }
//   Headers: Authorization: Bearer <jwt_do_usuario>
// ══════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY')!
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!

const GROQ_MODEL = 'llama-3.3-70b-versatile'
const GEMINI_MODEL = 'gemini-2.5-pro'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const CARGOS_AUTORIZADOS = new Set(['admin', 'gerente_comercial', 'gerente_marketing', 'vendedor', 'vendedora'])
const CARGOS_ILIMITADOS = new Set(['admin'])
const CARGOS_GERENTE = new Set(['gerente_comercial', 'gerente_marketing'])

const LOJA_NOMES: Record<string, string> = {
  '0': 'Site', 'null': 'Site',
  '203536978': 'Loja/WhatsApp Piçarras',
  '203550865': 'Loja Física BC',
  '205337834': 'Mercado Livre',
  '205430008': 'TikTok Shop',
  '205522474': 'Shopee',
}
const lojaNome = (id: unknown) =>
  (id === null || id === 0 || id === undefined) ? 'Site' : (LOJA_NOMES[String(id)] || 'Magalu')

function fmtBRL(n: unknown) {
  return (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// ── Helpers fetch direto pra Supabase (sem @supabase/supabase-js) ────────
async function supaGet(path: string): Promise<any[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SR, Authorization: `Bearer ${SR}` },
  })
  if (!r.ok) throw new Error(`supaGet ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`)
  return r.json()
}

async function supaSingle(path: string): Promise<any | null> {
  const rows = await supaGet(path)
  return rows && rows.length > 0 ? rows[0] : null
}

async function supaRpc(fn: string, args?: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {}),
  })
  if (!r.ok) throw new Error(`supaRpc ${fn}: ${r.status} ${(await r.text()).slice(0, 200)}`)
  return r.json()
}

async function supaInsert(table: string, row: Record<string, unknown>): Promise<void> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: SR, Authorization: `Bearer ${SR}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
  })
  if (!r.ok) {
    const t = await r.text()
    console.warn(`[insight] insert ${table} falhou: ${r.status} ${t.slice(0, 200)}`)
  }
}

async function supaUpdate(table: string, where: string, patch: Record<string, unknown>): Promise<void> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${where}`, {
    method: 'PATCH',
    headers: {
      apikey: SR, Authorization: `Bearer ${SR}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(patch),
  })
  if (!r.ok) {
    const t = await r.text()
    console.warn(`[insight] update ${table}: ${r.status} ${t.slice(0, 200)}`)
  }
}

// Valida JWT do user e retorna { id, email } ou null
async function getUserFromJwt(jwt: string): Promise<{ id: string; email?: string } | null> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}` },
  })
  if (!r.ok) return null
  const u = await r.json()
  return u && u.id ? { id: u.id, email: u.email } : null
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

CANAL PREFERIDO — USE LITERALMENTE O QUE ESTIVER NO CONTEXTO:
Os dados fornecem o campo "Canal preferido". Use EXATAMENTE esse texto. Exemplos:
- Se contexto diz "Loja/WhatsApp Piçarras" → escreva "Loja/WhatsApp Piçarras". NÃO escreva "Site".
- Se contexto diz "Mercado Livre" → escreva "Mercado Livre". NÃO escreva "marketplace" genérico.
NUNCA infira canal preferido a partir de outras frases — só do campo explícito.

REGRAS DE AÇÃO COMERCIAL POR SEGMENTO (CRÍTICO — siga rigorosamente):
- **VIP**: NUNCA ofereça desconto monetário. VIPs já compram bastante e oferecer desconto desvaloriza a relação. Sugira BRINDE PERSONALIZADO (broche bordado com nome, bolsa porta-jaleco, chaveiro com a marca, caneta) ou CONDIÇÃO ESPECIAL (frete grátis, brinde na próxima compra, kit exclusivo de lançamento, acesso antecipado a coleções novas).
- **Frequente**: pode oferecer desconto pequeno (5-8%) OU brinde, depende do contexto. Use desconto se o objetivo for fechar venda agora; brinde se for fidelizar.
- **Ocasional**: desconto promocional médio (10-15%) pra incentivar nova compra.
- **Em Risco**: desconto agressivo (15-20%) + contato direto pelo WhatsApp pra reativar.
- **Inativo**: desconto forte (20-25%) + benefício adicional (frete grátis, brinde) + ligação/WhatsApp pessoal.

PRODUTOS SUGERIDOS (use o catálogo curado do site quando disponível):
O contexto traz "Produtos sugeridos pra próxima oferta" — top 3 do catálogo curado de danajalecos.com.br que clientes parecidos compraram E ESTE cliente ainda NÃO comprou.
- Quando existe lista (não-vazia), cite o PRIMEIRO produto LITERALMENTE na seção AÇÃO ("ofereça o jaleco Manu") e na MENSAGEM WHATSAPP.
- Se cliente é VIP, ofereça como BRINDE personalizado (ex: "preparamos um brinde exclusivo: jaleco Manu") em vez de venda direta.
- Não invente produtos que não estão na lista. Se a lista está vazia, fala em termos genéricos da categoria preferida do cliente.

REGRA DE CICLO DE COMPRA (orientação pra reduzir intervalo):
Se o contexto traz "Ciclo de compra" com "desvio +N%" onde N > 30%:
- O cliente está demorando MAIS que o normal pra recomprar (no segmento dele).
- Na seção AÇÃO, sugira uma OFERTA URGENTE com prazo curto ("essa semana", "até sexta") OU um MOTIVADOR (lançamento de coleção, frete grátis, novidade da Dana) que dê motivo pra antecipar a próxima compra.
- Na MENSAGEM WHATSAPP, crie senso de urgência sutil sem ser invasivo. Ex: "preparamos algo especial pra essa semana e queríamos que você fosse uma das primeiras a ver".
- Se desvio for -30% ou menos (cliente compra MAIS rápido que a média), elogie a frequência e foque em fidelizar (não em forçar mais venda).
Essa regra é COMPATÍVEL com as regras de segmento — se VIP demorando, ainda assim BRINDE (não desconto), mas com senso de urgência.
Inadimplência sempre tem prioridade sobre ciclo (regra abaixo).

REGRA DE INADIMPLÊNCIA (PRIORIDADE MÁXIMA — sobrepõe TODAS as outras):
Se o contexto traz "Inadimplência: ⚠ DEVENDO..." (cliente em atraso):
- NÃO ofereça novos descontos, produtos, brindes ou novidades. ZERO oferta nova.
- A AÇÃO deve ser EXCLUSIVAMENTE lembrar do pagamento atrasado, de forma cordial mas firme.
- A MENSAGEM WHATSAPP deve mencionar o valor pendente e perguntar se o cliente quer parcelar/regularizar.
- Tom: respeitoso, sem julgar — "Notamos uma conta em aberto..." / "Quer combinar uma forma de quitar?"
- ZERO senso de urgência comercial — só cobrança humanizada.
- ZERO emoji exceto talvez 1 (😊 ou 🙂).
- NUNCA termine sugerindo nova compra. Só após resolver a pendência.
Essa regra vale pra QUALQUER segmento (até VIP). Pagamento atrasado tem prioridade sobre relacionamento.

FORMATO OBRIGATÓRIO (exatamente 4 seções, nesse formato, com os rótulos em CAIXA ALTA seguidos de dois-pontos):

ANÁLISE DO COMPORTAMENTO ATUAL:
(parágrafo único descrevendo o perfil de compra: frequência, ticket, canal preferido [LITERAL do contexto], categorias, tempo ativo, segmento RFM)

RISCO OU OPORTUNIDADE PRINCIPAL:
(parágrafo único sobre O principal risco OU oportunidade — escolha o mais relevante e seja específico com números e datas)

AÇÃO COMERCIAL RECOMENDADA:
(parágrafo único com 1-2 ações concretas que SEGUEM A REGRA DE AÇÃO POR SEGMENTO acima: o que oferecer [brinde vs desconto conforme segmento], quando contatar, qual canal usar [literal do contexto], com que tom)

MENSAGEM WHATSAPP PRONTA:
(texto curto e direto pra vendedora COPIAR e enviar via WhatsApp ao cliente — 2 a 4 linhas no máximo)

REGRAS DA MENSAGEM WHATSAPP (CRÍTICO):
- Tom: cordial mas direto, em primeira pessoa do plural ("queremos te oferecer", "preparamos pra você")
- DEVE refletir a AÇÃO COMERCIAL RECOMENDADA da seção anterior — siga as REGRAS POR SEGMENTO rigorosamente:
  · Se cliente VIP: NUNCA mencione desconto. Ofereça BRINDE (broche bordado, kit exclusivo, frete grátis, acesso antecipado a coleção nova). Use frases como "preparamos um brinde exclusivo" ou "selecionamos uma cortesia".
  · Se Frequente: pode mencionar desconto pequeno (5-8%) OU brinde, alinhado com a ação.
  · Se Ocasional / Em Risco / Inativo: pode mencionar desconto (no patamar % das regras acima).
- Cite o nome do cliente literalmente no começo ("Olá, [nome]!")
- Se o contexto traz **categoria preferida** (Jalecos/Scrubs/etc), mencione ela na oferta
- Finalize SEMPRE com algo tipo "— Equipe Dana Jalecos" ou "Abraços, Dana Jalecos"
- NUNCA mencione concorrentes nem prazos vagos. Sem hashtags. Sem emojis em excesso (max 1-2).
- NUNCA invente promoções específicas com datas — fale em termos gerais ("essa semana", "preparamos pra você")`

async function callGroq(messages: any[]) {
  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
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

async function gerarInsight(contexto: string): Promise<{ text: string; modelo: string }> {
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: contexto }]
  try {
    const text = await callGroq(messages)
    if (text) return { text, modelo: GROQ_MODEL }
  } catch (e) {
    console.warn('[insight] Groq falhou:', (e as Error).message)
  }
  const text = await callGemini(SYSTEM_PROMPT + '\n\n---\n\n' + contexto)
  return { text, modelo: GEMINI_MODEL }
}

function enc(v: string): string {
  return encodeURIComponent(v)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  try {
    // 1. Auth
    const authHeader = req.headers.get('Authorization') || ''
    const jwt = authHeader.replace(/^Bearer /, '')
    if (!jwt) return json({ error: 'Autenticação obrigatória' }, 401)

    const user = await getUserFromJwt(jwt)
    if (!user) return json({ error: 'JWT inválido' }, 401)

    // 2. Permissão
    const profileRows = await supaGet(`profiles?id=eq.${user.id}&select=cargo,nome&limit=1`)
    const profile = profileRows[0] || null
    const cargo = profile?.cargo || 'vendedor'
    if (!CARGOS_AUTORIZADOS.has(cargo)) {
      return json({ error: 'Sem permissão. Insights IA disponível para admin, gerentes e vendedores.' }, 403)
    }

    // 2.1 Config + kill-switch + quota
    const config = await supaSingle('cliente_insights_config?id=eq.1&select=*&limit=1') || {
      ativo: true, limite_diario_vendedor: 10, limite_diario_gerente: 20,
      limite_mensal_reais: 30, custo_por_insight_reais: 0.10, pausado_por_limite: false,
    }
    if (!config.ativo) {
      return json({ error: 'Geração de insights está desativada pelo admin.' }, 403)
    }
    if (config.pausado_por_limite) {
      return json({ error: 'Geração de insights pausada — limite mensal atingido. Fale com o admin.' }, 403)
    }

    // Kill-switch automático
    const gastoMes = await supaRpc('cliente_insights_gasto_mes')
    const gasto = Number(gastoMes) || 0
    if (gasto >= Number(config.limite_mensal_reais)) {
      await supaUpdate('cliente_insights_config', 'id=eq.1', { pausado_por_limite: true })
      return json({ error: `Limite mensal de R$ ${config.limite_mensal_reais} atingido. Geração pausada.` }, 403)
    }

    // Quota diária
    let limiteDiario = 0
    if (CARGOS_ILIMITADOS.has(cargo)) {
      limiteDiario = -1
    } else if (CARGOS_GERENTE.has(cargo)) {
      limiteDiario = Number(config.limite_diario_gerente) || 20
    } else {
      limiteDiario = Number(config.limite_diario_vendedor) || 10
    }
    if (limiteDiario !== -1) {
      const countHoje = await supaRpc('cliente_insights_count_hoje', { uid: user.id })
      const usados = Number(countHoje) || 0
      if (usados >= limiteDiario) {
        return json({
          error: `Quota diária atingida (${usados}/${limiteDiario}). Tente novamente amanhã.`,
          quota: { usados, limite: limiteDiario, restante: 0 },
        }, 429)
      }
    }

    // 3. Body
    const body = await req.json()
    const contato_nome = String(body.contato_nome || '').trim()
    const empresa = body.empresa === 'bc' ? 'bc' : 'matriz'
    if (!contato_nome) return json({ error: 'contato_nome obrigatório' }, 400)

    // 3.1 Escopo vendedor (só carteira própria)
    if (cargo === 'vendedor' || cargo === 'vendedora') {
      const meus = await supaSingle(
        `cliente_scoring_vendedor?vendedor_profile_id=eq.${user.id}&empresa=eq.${empresa}&contato_nome=eq.${enc(contato_nome)}&select=contato_nome&limit=1`
      )
      if (!meus) {
        return json({
          error: 'Este cliente não está na sua carteira. Você só pode gerar insights dos seus clientes.',
        }, 403)
      }
    }

    // 4. cliente_scoring_full
    const cs = await supaSingle(
      `cliente_scoring_full?empresa=eq.${empresa}&contato_nome=eq.${enc(contato_nome)}&select=*&limit=1`
    )
    if (!cs) return json({ error: 'Cliente não encontrado' }, 404)

    // 5. Últimos 100 pedidos
    const pedidos = await supaGet(
      `pedidos?empresa=eq.${empresa}&contato_nome=eq.${enc(contato_nome)}&select=id,numero,data,total,total_produtos,situacao_id,loja_id,vendedor_nome&order=data.desc&limit=100`
    )
    const pids = (pedidos || []).map((p: any) => p.id)
    let itens: any[] = []
    if (pids.length) {
      itens = await supaGet(
        `pedidos_itens?pedido_id=in.(${pids.join(',')})&select=pedido_id,descricao,quantidade,valor_total`
      )
    }
    const itensPorPedido: Record<string, any[]> = {}
    for (const it of itens) {
      (itensPorPedido[it.pedido_id] = itensPorPedido[it.pedido_id] || []).push(it)
    }

    // 6. Agregados
    const canalCount: Record<string, number> = {}
    const catCount: Record<string, number> = {}
    for (const p of pedidos) {
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

    // 7. Últimas 5 compras
    const ultimasCompras = (pedidos || []).slice(0, 5).map((p: any) => {
      const dataStr = p.data ? new Date(p.data).toLocaleDateString('pt-BR') : '—'
      const valor = Number(p.total) || Number(p.total_produtos) || 0
      const qtdItens = (itensPorPedido[p.id] || []).length
      return `- ${dataStr} · ${lojaNome(p.loja_id)} · ${fmtBRL(valor)} · ${qtdItens} item(ns)`
    }).join('\n')

    // 7b. FASE 2: inadimplência do cliente (view cliente_inadimplencia)
    let inadInfo: any = null
    try {
      inadInfo = await supaSingle(
        `cliente_inadimplencia?empresa=eq.${empresa}&contato_nome=eq.${enc(contato_nome)}&select=total_atrasado,max_dias_atraso,qtd_contas_atrasadas,pedidos_origem&limit=1`
      )
    } catch (_e) { /* sem inadimplência se view não existe ou erro silencioso */ }

    // 7d. FASE 6: sugestão próximo produto (RPC sugerir_produto_proximo)
    let sugestoes: any[] = []
    try {
      sugestoes = await supaRpc('sugerir_produto_proximo', {
        p_contato_nome: contato_nome, p_empresa: empresa, p_limite: 3
      })
      if (!Array.isArray(sugestoes)) sugestoes = []
    } catch (_e) { sugestoes = [] }

    // 7c. FASE 4: ciclo de compra + benchmark do segmento
    let cicloInfo: any = null
    let benchSeg: any = null
    let cicloDesvio: number | null = null
    try {
      cicloInfo = await supaSingle(
        `cliente_ciclo_compra?empresa=eq.${empresa}&contato_nome=eq.${enc(contato_nome)}&select=ciclo_compra_dias,pedidos_validos&limit=1`
      )
      if (cicloInfo?.ciclo_compra_dias) {
        const bench = await supaRpc('benchmark_ciclo_por_segmento', { p_empresa: empresa })
        benchSeg = (bench || []).find((b: any) => b.segmento === cs.segmento) || null
        if (benchSeg?.ciclo_mediano) {
          cicloDesvio = Math.round(
            ((cicloInfo.ciclo_compra_dias - Number(benchSeg.ciclo_mediano)) / Number(benchSeg.ciclo_mediano)) * 100
          )
        }
      }
    } catch (_e) { /* silencioso */ }

    const empresaLabel = empresa === 'matriz' ? 'Matriz (Piçarras)' : 'Balneário Camboriú (BC)'
    const tipoPessoa = cs.tipo_pessoa === 'J' ? 'Pessoa Jurídica' : cs.tipo_pessoa === 'F' ? 'Pessoa Física' : 'N/D'
    const fone = cs.celular || cs.telefone || '—'
    const hoje = new Date().toLocaleDateString('pt-BR')

    // 8. Contexto
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

Canal preferido: ${topCanal[0]?.[0] || '—'}
Canais de compra (frequência, últimos 100 pedidos):
${topCanal.length ? topCanal.map(([k, v]) => `- ${k}: ${v} pedido(s)`).join('\n') : '- (sem dados)'}

Categorias preferidas (por quantidade de itens):
${topCat.length ? topCat.map(([k, v]) => `- ${k}: ${v} peça(s)`).join('\n') : '- (sem dados)'}

Últimas 5 compras:
${ultimasCompras || '- (sem compras registradas)'}

Inadimplência (contas em atraso):
${inadInfo && Number(inadInfo.total_atrasado) > 0
  ? `⚠ DEVENDO: ${fmtBRL(inadInfo.total_atrasado)} (${inadInfo.qtd_contas_atrasadas} conta(s), ${inadInfo.max_dias_atraso}d de atraso${inadInfo.pedidos_origem ? ', pedidos '+inadInfo.pedidos_origem : ''})`
  : '- (em dia)'}

Ciclo de compra (intervalo médio entre pedidos):
${cicloInfo?.ciclo_compra_dias
  ? `${cicloInfo.ciclo_compra_dias} dias (cliente)${benchSeg?.ciclo_mediano ? ` · ${Math.round(Number(benchSeg.ciclo_mediano))} dias (mediana do segmento ${cs.segmento})` : ''}${cicloDesvio !== null ? ` · desvio ${cicloDesvio > 0 ? '+' : ''}${cicloDesvio}%${cicloDesvio > 30 ? ' ⚠ DEMORANDO MAIS QUE O NORMAL' : ''}` : ''}`
  : '- (cliente com 1 pedido só ou sem histórico)'}

Produtos sugeridos pra próxima oferta (top do segmento ${cs.segmento} que cliente NÃO comprou):
${sugestoes.length
  ? sugestoes.map((s: any) => `- ${s.nome} (${s.categoria}, ${s.quantos_compraram} clientes parecidos compraram)`).join('\n')
  : '- (sem dados suficientes do segmento — use sua experiência)'}

---

Gere o insight seguindo EXATAMENTE o formato obrigatório do system prompt.`

    // 9. LLM
    const { text, modelo } = await gerarInsight(contexto)

    const custoEstimado = modelo.toLowerCase().includes('gemini')
      ? Number(config.custo_por_insight_reais) || 0.10
      : 0
    const provider = modelo.toLowerCase().includes('gemini') ? 'gemini'
                   : modelo.toLowerCase().includes('groq') || modelo.toLowerCase().includes('llama') ? 'groq'
                   : 'desconhecido'

    // 10. Salva
    await supaInsert('cliente_insights', {
      empresa,
      contato_nome,
      insight: text,
      modelo,
      modelo_provider: provider,
      user_id: user.id,
      user_nome: profile?.nome || user.email,
      cargo_autor: cargo,
      custo_estimado: custoEstimado,
    })

    // Quota info pra UI
    let quotaInfo: any = null
    if (limiteDiario !== -1) {
      const novoCount = await supaRpc('cliente_insights_count_hoje', { uid: user.id })
      quotaInfo = {
        usados: Number(novoCount) || 0,
        limite: limiteDiario,
        restante: Math.max(0, limiteDiario - (Number(novoCount) || 0)),
      }
    }

    return json({
      ok: true, insight: text, modelo, provider,
      custo_estimado: custoEstimado, quota: quotaInfo,
      gerado_em: new Date().toISOString(),
    })
  } catch (e) {
    console.error('[insight] erro:', e)
    return json({ error: (e as Error).message || 'erro interno' }, 500)
  }
})
