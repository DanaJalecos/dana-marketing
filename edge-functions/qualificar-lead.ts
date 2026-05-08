// ══════════════════════════════════════════════════════════════════════════
// Edge Function: qualificar-lead
// Qualifica um lead em 6 pilares (Dor / Perfil / Budget / Urgencia / Timing / Objecao)
// + lead score 0-100 + acao recomendada + confianca CALCULADA pelo backend.
//
// Reusa pattern do cliente360-insight (cascade Groq → Gemini, kill-switch).
//
// IMPORTANTE: confianca NAO eh inventada pela IA — backend calcula
// deterministicamente baseado em quantos sinais foram disponibilizados pra
// IA analisar. Vendedora ve confianca real e julga.
//
// Quotas: vendedora 3/dia · gerente 10/dia · admin ilimitado
//
// Uso:
//   POST /functions/v1/qualificar-lead
//   Body: { prospect_id: 'uuid' }
// ══════════════════════════════════════════════════════════════════════════

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

const QUOTAS = {
  vendedor: 3,
  gerente_comercial: 10,
  gerente_marketing: 10,
  trafego_pago: 10,
  producao_conteudo: 5,
}

// System prompt — formato JSON ESTRUTURADO + hipóteses inferenciais marcadas
const SYSTEM_PROMPT = `Você é um analista comercial sênior da Dana Jalecos (jalecos, scrubs e uniformes profissionais de saúde) com 10+ anos de experiência no segmento. Conhece os padrões típicos de cada tipo de cliente.

Sua tarefa: qualificar um LEAD em 6 pilares clássicos de vendas e sugerir a próxima ação. Use os dados do contexto JSON COMO BASE PRIMÁRIA, mas você está autorizado a INFERIR HIPÓTESES TÍPICAS por segmento quando o contexto for limitado — desde que MARQUE EXPLICITAMENTE como hipótese.

REGRAS CRÍTICAS:
1. Dados PRIMÁRIOS: nomes, valores, datas, conversas REAIS — use SOMENTE se estão no JSON. NÃO invente esses.
2. INFERÊNCIAS por segmento: se o contexto traz segmento ou nicho conhecido (ex: "clínica de harmonização", "consultório odontológico", "estudante medicina"), VOCÊ PODE preencher Dor/Budget/Objeções com hipóteses TÍPICAS daquele segmento, marcando com "Provável:", "Típico em [segmento]:", ou "Hipótese a validar:".
3. NUNCA deixe um pilar como "—" se o contexto traz segmento/perfil identificável — sempre dê pelo menos 1 hipótese marcada.
4. Português brasileiro, direto, tom consultivo.
5. Pra "Objeções", liste 1-3 itens curtos (max 40 chars). Se for hipótese, prefixe com "Possível: ".
6. Pra "Ação recomendada", seja PRÁTICO e EXECUTÁVEL hoje. Cite produto Dana específico se possível (ex: "scrub Lorenzo", "jaleco gola padre Manuela").
7. Use a "conversa_extra" se ela vier no contexto — é OURO, vendedora colou diálogo real.

CONHECIMENTO DE SEGMENTOS (use pra inferir hipóteses):
- Clínicas de estética/harmonização → DOR típica: padronização visual + identidade premium · BUDGET típico: Médio-Alto (R$ 300-600/peça) · OBJEÇÕES: prazo, MOQ, política de troca
- Consultórios odontológicos → DOR: durabilidade contra produtos químicos + conforto longas jornadas · BUDGET: Médio (R$ 200-400) · OBJEÇÕES: tecido tecnológico, manga ergonômica
- Estudantes medicina/enfermagem → DOR: jaleco aprovado pelo curso, primeiro uniforme · BUDGET: Baixo (R$ 100-200) · OBJEÇÕES: parcelamento, pegar pra formatura no prazo
- Hospitais/grandes redes → DOR: licitação, padronização em escala · BUDGET: Alto (volume) · OBJEÇÕES: NF, prazo de pagamento, termo de aceite
- Salões/spas/clínicas estéticas pequenas → DOR: visual instagramável + diferenciar do concorrente · BUDGET: Médio · OBJEÇÕES: cores customizadas, bordado nome

FORMATO DE SAÍDA — DEVOLVA APENAS JSON VÁLIDO (sem markdown, sem prefixo):

{
  "dor": "string — pode ser inferida do segmento, marque 'Provável:' ou 'Típico:' se for hipótese",
  "perfil": "string curta — quem é (B2B/B2C, profissão, tamanho, nicho)",
  "budget": "NIVEL · faixa estimada · ex: 'Médio · R$ 200-400/peça (típico do segmento)'",
  "urgencia": "NIVEL · descrição. Se sem prazo no contexto, escreva 'Baixa · sem prazo informado — confirmar com lead'",
  "timing": "ETAPA · descrição",
  "objecoes": ["lista de 1-3 objeções, hipóteses marcadas com 'Possível:'"],
  "lead_score": 0-100,
  "acao_recomendada": "próxima ação concreta da vendedora — mencione produto Dana se couber",
  "descobrir": ["lista de 2-4 perguntas que a vendedora deveria fazer pro lead pra preencher pilares vazios ou validar hipóteses"]
}

REGRAS PRO LEAD_SCORE (BASELINE MAIS AGRESSIVO):
- 85-100: dados ricos confirmando alta intenção (conversa explícita + segmento + status avançado)
- 65-84: bom perfil identificado + status indica engajamento + 1+ sinal forte
- 45-64: BASELINE pra lead com perfil/segmento conhecido + status pelo menos 'novo' (NÃO ir abaixo disso se segmento bate com Dana)
- 25-44: lead com info ESPARSA — só nome e cidade, sem segmento útil
- 0-24: praticamente nada (lead órfão, sem nem segmento)

IMPORTANTE: mesmo lead 'novo' B2B com segmento bem definido alinhado à Dana DEVE pontuar 45-60 (não 20). Subir o baseline.

NIVEIS aceitos: 'Alta' | 'Média' | 'Baixa' (urgência), 'Premium' | 'Alto' | 'Médio' | 'Baixo' (budget), 'Pesquisa' | 'Consideração' | 'Decisão' (timing).

PRA "DESCOBRIR" (perguntas pra vendedora fazer):
- Sempre 2-4 perguntas práticas
- Foco em pilares marcados como hipótese ou vazios
- Linguagem natural pra fluir no WhatsApp ("Quantas pessoas da equipe usam jaleco?", "Qual a urgência? Tem evento marcado?", "Já pesquisou outras opções?")`

async function callGroq(messages: any[]) {
  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL, messages, temperature: 0.3, max_tokens: 800,
      response_format: { type: 'json_object' },  // força JSON
    }),
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
        generationConfig: { temperature: 0.3, maxOutputTokens: 800, responseMimeType: 'application/json' },
      }),
    }
  )
  if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${(await resp.text()).slice(0, 300)}`)
  const j = await resp.json()
  return j?.candidates?.[0]?.content?.parts?.[0]?.text || ''
}

async function gerar(contexto: string): Promise<{ obj: any, modelo: string, provider: string }> {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: contexto },
  ]
  // Groq primeiro
  try {
    const text = await callGroq(messages)
    if (text) {
      const obj = JSON.parse(text)
      return { obj, modelo: GROQ_MODEL, provider: 'groq' }
    }
  } catch (e) {
    console.warn('[qualif] Groq falhou:', (e as Error).message)
  }
  // Fallback Gemini
  const text = await callGemini(SYSTEM_PROMPT + '\n\n---\nContexto do lead:\n' + contexto)
  const obj = JSON.parse(text)
  return { obj, modelo: GEMINI_MODEL, provider: 'gemini' }
}

// Calcula confiança DETERMINISTICAMENTE pelo backend (não pela IA)
function calcularConfianca(sinais: any): number {
  let conf = 30  // base
  if (sinais.tem_segmento) conf += 8
  if (sinais.tem_cidade) conf += 5
  if (sinais.tem_whatsapp) conf += 3
  if (sinais.tem_mensagem_ia) conf += 5
  if (sinais.tem_observacao) conf += 5
  if (sinais.tem_conversa_real) conf += 25  // conversa real WhatsApp colada = OURO
  if (sinais.tem_rfm) conf += 10            // cliente Bling com histórico = sinal forte
  if (sinais.tem_notas) conf += 8           // notas dos vendedores = contexto rico
  if (sinais.status_avancado) conf += 10
  if (sinais.qtd_eventos_tracker > 0) conf += Math.min(15, sinais.qtd_eventos_tracker * 2)
  if (sinais.qtd_pedidos_anteriores > 0) conf += 12
  if (sinais.tem_motivo_perda) conf += 5
  return Math.min(95, conf)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  try {
    // Auth
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'Sem token JWT' }, 401)

    const { data: userData, error: userErr } = await admin.auth.getUser(token)
    if (userErr || !userData?.user) return json({ error: 'Token inválido' }, 401)
    const user = userData.user

    const { data: profile } = await admin.from('profiles').select('cargo, nome').eq('id', user.id).single()
    if (!profile) return json({ error: 'Profile não encontrado' }, 403)
    const cargo: string = profile.cargo || 'vendedor'
    const userNome: string = profile.nome || user.email || 'Anônimo'

    // Permissão: 5 cargos do Analytics IA + vendedor (com quota baixa)
    const cargosOK = new Set([
      'admin', 'gerente_marketing', 'gerente_comercial', 'trafego_pago', 'producao_conteudo', 'vendedor',
    ])
    if (!cargosOK.has(cargo)) return json({ error: 'Cargo não autorizado' }, 403)

    // Body — aceita prospect_id (Prospecção) OU contato_nome (Cliente 360 Bling)
    const body = await req.json().catch(() => ({}))
    const prospectId: string = body.prospect_id || ''
    const contatoNomeIn: string = String(body.contato_nome || '').trim()
    const empresaIn: string = String(body.empresa || '').trim()  // 'matriz' | 'bc'
    if (!prospectId && !contatoNomeIn) {
      return json({ error: 'prospect_id ou contato_nome obrigatório' }, 400)
    }
    // OPCIONAL: conversa que a vendedora colou do WhatsApp (ouro pro contexto)
    const conversaExtra: string = String(body.conversa_extra || '').trim().slice(0, 4000)
    const fonteOrigem = prospectId ? 'prospect' : 'cliente_bling'

    // Quota — admin ilimitado
    if (cargo !== 'admin') {
      const limite = QUOTAS[cargo as keyof typeof QUOTAS] ?? 0
      const { data: usados } = await admin.rpc('lead_qualificacao_count_hoje', { uid: user.id })
      const usadosN = Number(usados) || 0
      if (usadosN >= limite) {
        return json({
          error: 'quota_excedida',
          mensagem: `Limite diário de ${limite} qualificações atingido. Tenta amanhã ou peça pro admin aumentar.`,
          quota: { usados: usadosN, limite, restante: 0, cargo },
        }, 429)
      }
    }

    // Kill-switch global (compartilhado com cliente_insights_config)
    const { data: cfg } = await admin.from('cliente_insights_config').select('*').eq('id', 1).single()
    if (cfg && cfg.pausado_por_limite) {
      return json({ error: 'Limite mensal de R$ 30 atingido. Aguardar virada de mês.' }, 429)
    }
    if (cfg && cfg.pausado_manual) {
      return json({ error: 'Insights pausados manualmente pelo admin.' }, 429)
    }

    // ── Busca dados do lead ──
    // Caso 1: prospect_id veio → busca em prospects (Prospecção/outbound)
    // Caso 2: contato_nome veio → busca em pedidos+cliente_metadata (Cliente 360)
    let prospect: any = null
    let contatoNome: string = ''

    if (prospectId) {
      const { data, error } = await admin.from('prospects').select('*').eq('id', prospectId).single()
      if (error || !data) return json({ error: 'Lead não encontrado em prospects' }, 404)
      prospect = data
      contatoNome = data.nome
      if (cargo === 'vendedor' && prospect.criado_por !== user.id) {
        return json({ error: 'Você só pode qualificar leads que VOCÊ criou' }, 403)
      }
    } else {
      contatoNome = contatoNomeIn
    }

    // ── Coleta de SINAIS pra montar contexto ──
    const contextoLead: any = {
      origem: fonteOrigem,
      nome: contatoNome.slice(0, 200),
      cidade: prospect?.cidade || null,
      estado: prospect?.estado || null,
      segmento: prospect?.segmento || null,
      whatsapp_cadastrado: !!(prospect?.whatsapp),
      status_atual: prospect?.status || (fonteOrigem === 'cliente_bling' ? 'cliente_existente' : 'novo'),
      criado_em: prospect?.created_at || null,
      mensagem_ia_gerada: prospect?.ia_mensagem ? (prospect.ia_mensagem || '').slice(0, 800) : null,
      motivo_perda: prospect?.motivo_perda || null,
      motivo_perda_detalhe: (prospect?.motivo_perda_detalhe || '').slice(0, 200) || null,
    }

    // Cliente Bling: enriquece com RFM + metadata + notas
    let qtdPedidosBling = 0
    if (fonteOrigem === 'cliente_bling' && contatoNome) {
      const empresaFiltro = empresaIn || 'matriz'
      // RFM scoring
      const { data: rfm } = await admin.from('cliente_scoring_full')
        .select('score_rfm, segmento_rfm, score_recompra, total_pedidos, total_gasto, ticket_medio, ultima_compra, categoria_preferida, canal_preferido_label, recencia_dias')
        .eq('contato_nome', contatoNome).eq('empresa', empresaFiltro).maybeSingle()
      if (rfm) {
        contextoLead.rfm_scoring = rfm
        qtdPedidosBling = Number(rfm.total_pedidos) || 0
      }
      // Acompanhamento comercial — busca metadata via contato_id de qualquer pedido com mesmo nome
      const { data: pedSample } = await admin.from('pedidos')
        .select('contato_id').ilike('contato_nome', contatoNome).eq('empresa', empresaFiltro).limit(1)
      const cid = pedSample?.[0]?.contato_id
      if (cid) {
        const { data: meta } = await admin.from('cliente_metadata')
          .select('status_relacionamento, observacao_rapida, motivo_perda, motivo_perda_detalhe')
          .eq('contato_id', cid).eq('empresa', empresaFiltro).maybeSingle()
        if (meta) contextoLead.acompanhamento_comercial = meta
      }
      // Notas dos vendedores
      const { data: notas } = await admin.from('cliente_notas')
        .select('texto, user_nome, created_at')
        .eq('contato_nome', contatoNome).eq('empresa', empresaFiltro)
        .order('created_at', { ascending: false }).limit(5)
      if (notas?.length) {
        contextoLead.notas_recentes = notas.map((n: any) => ({
          quando: n.created_at?.slice(0, 10), por: n.user_nome, texto: (n.texto || '').slice(0, 250),
        }))
      }
    }

    // Histórico de status (só pra prospects)
    if (prospectId) {
      const { data: hist } = await admin.from('prospects_historico')
        .select('acao, status_anterior, status_novo, created_at')
        .eq('prospect_id', prospectId).order('created_at', { ascending: false }).limit(10)
      contextoLead.historico_acoes = (hist || []).map((h: any) => ({
        acao: h.acao, de: h.status_anterior, para: h.status_novo,
        quando: h.created_at?.slice(0, 10),
      }))
    }

    // Eventos do tracker (Lead Tracker)
    let qtdEventosTracker = 0
    if (contatoNome) {
      const { count } = await admin.from('analytics_lead_events')
        .select('*', { count: 'exact', head: true })
        .eq('contato_nome', contatoNome)
      qtdEventosTracker = Number(count) || 0
      if (qtdEventosTracker > 0) {
        const { data: jornada } = await admin.from('analytics_jornada_cliente')
          .select('pageviews, paginas_unicas, dias_visitando, primeiro_toque, canais, campanhas, devices')
          .eq('contato_nome', contatoNome).maybeSingle()
        contextoLead.comportamento_site = jornada || null
      }
    }

    // Pedidos anteriores — pra prospect verifica se virou cliente; pra cliente Bling já temos qtdPedidosBling
    let qtdPedidos = qtdPedidosBling
    if (prospectId && contatoNome) {
      const { count } = await admin.from('pedidos')
        .select('*', { count: 'exact', head: true })
        .ilike('contato_nome', contatoNome)
      qtdPedidos = Number(count) || 0
    }
    if (qtdPedidos > 0) contextoLead.pedidos_anteriores_count = qtdPedidos

    // Conversa colada pela vendedora — vai pro contexto se veio
    if (conversaExtra) {
      contextoLead.conversa_real_whatsapp = conversaExtra
    }

    // Sinais pra calcular confiança
    const sinais = {
      tem_segmento: !!(prospect?.segmento),
      tem_cidade: !!(prospect?.cidade),
      tem_whatsapp: !!(prospect?.whatsapp),
      tem_mensagem_ia: !!(prospect?.ia_mensagem),
      tem_observacao: !!(contextoLead.acompanhamento_comercial?.observacao_rapida),
      tem_conversa_real: !!conversaExtra,
      tem_rfm: !!contextoLead.rfm_scoring,
      tem_notas: !!(contextoLead.notas_recentes?.length),
      status_avancado: !!(prospect?.status && prospect.status !== 'novo') || fonteOrigem === 'cliente_bling',
      qtd_eventos_tracker: qtdEventosTracker,
      qtd_pedidos_anteriores: qtdPedidos,
      tem_motivo_perda: !!(prospect?.motivo_perda || contextoLead.acompanhamento_comercial?.motivo_perda),
    }

    const confiancaPct = calcularConfianca(sinais)

    // Limite contexto a 8KB (anti prompt-injection)
    let contextoStr = JSON.stringify(contextoLead, null, 2)
    if (contextoStr.length > 8000) contextoStr = contextoStr.slice(0, 8000)

    // ── Chama IA ──
    let result: { obj: any, modelo: string, provider: string }
    try {
      result = await gerar(contextoStr)
    } catch (e) {
      return json({
        error: 'IA falhou em ambos os providers',
        detail: (e as Error).message,
      }, 502)
    }

    // Normaliza objeto
    const obj = result.obj || {}
    const objecoesArr = Array.isArray(obj.objecoes) ? obj.objecoes.slice(0, 5).map((o: any) => String(o).slice(0, 80)) : ['—']
    const descobrirArr = Array.isArray(obj.descobrir) ? obj.descobrir.slice(0, 6).map((o: any) => String(o).slice(0, 200)) : []
    const leadScore = Math.max(0, Math.min(100, parseInt(obj.lead_score) || 50))

    // Custo estimado
    const custoEstimado = result.provider === 'gemini' ? 0.02 : 0  // Groq free

    // Insert no banco (service role)
    const { data: inserted, error: insErr } = await admin
      .from('lead_qualificacao')
      .insert({
        prospect_id: prospectId || null,
        contato_nome: contatoNome,
        empresa: empresaIn || null,
        dor: String(obj.dor || '—').slice(0, 400),
        perfil: String(obj.perfil || '—').slice(0, 300),
        budget: String(obj.budget || '—').slice(0, 200),
        urgencia: String(obj.urgencia || '—').slice(0, 200),
        timing: String(obj.timing || '—').slice(0, 200),
        objecoes: objecoesArr,
        descobrir: descobrirArr,
        conversa_extra: conversaExtra || null,
        lead_score: leadScore,
        acao_recomendada: String(obj.acao_recomendada || '—').slice(0, 600),
        confianca_pct: confiancaPct,
        fontes_analisadas: sinais,
        contexto_resumido_json: contextoLead,
        modelo: result.modelo,
        modelo_provider: result.provider,
        custo_estimado: custoEstimado,
        user_id: user.id,
        user_nome: userNome,
        cargo_autor: cargo,
      })
      .select('id, created_at')
      .single()

    if (insErr) {
      return json({ error: 'Erro ao salvar qualificação', detail: insErr.message }, 500)
    }

    // Resposta
    return json({
      ok: true,
      qualificacao: {
        id: inserted!.id,
        dor: obj.dor || '—',
        perfil: obj.perfil || '—',
        budget: obj.budget || '—',
        urgencia: obj.urgencia || '—',
        timing: obj.timing || '—',
        objecoes: objecoesArr,
        descobrir: descobrirArr,
        lead_score: leadScore,
        acao_recomendada: obj.acao_recomendada || '—',
        confianca_pct: confiancaPct,
        fontes_analisadas: sinais,
        modelo: result.modelo,
        provider: result.provider,
        custo_estimado: custoEstimado,
        gerado_em: inserted!.created_at,
        gerado_por: userNome,
      },
    })
  } catch (e) {
    console.error('[qualificar-lead] erro:', e)
    return json({ error: (e as Error).message || String(e) }, 500)
  }
})
