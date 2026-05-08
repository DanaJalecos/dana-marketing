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

// System prompt — formato JSON ESTRUTURADO + anti-alucinação rígida
const SYSTEM_PROMPT = `Você é um analista comercial sênior da Dana Jalecos (jalecos, scrubs e uniformes profissionais de saúde).

Sua tarefa: qualificar um LEAD em 6 pilares clássicos de vendas e sugerir a próxima ação. Use APENAS os dados do contexto JSON.

REGRAS CRÍTICAS:
1. Use SOMENTE informações presentes no JSON. Se um pilar não tem dado, escreva "—" ou marque incerteza explícita ("provavelmente", "indício de").
2. NÃO invente nomes, valores, datas, segmentos ou conversas que não estejam no contexto.
3. Português brasileiro, direto, sem floreio. Tom consultivo de quem fala com vendedora experiente.
4. Cite NÚMEROS quando o contexto tiver (ex: "3 pageviews", "última visita há 4 dias", "1 pedido anterior R$ 280").
5. Pra "Objeções", liste 1-3 itens curtos (max 30 chars cada). Se não houver indício, responda ["—"].
6. Pra "Ação recomendada", seja PRÁTICO e EXECUTÁVEL hoje (ex: "Mandar foto do tecido em zoom + cupom FRETE10").

FORMATO DE SAÍDA — DEVOLVA APENAS JSON VÁLIDO (sem markdown, sem prefixo):

{
  "dor": "string curta — qual problema o lead tenta resolver",
  "perfil": "string curta — quem é (B2B/B2C, profissão, tamanho, nicho)",
  "budget": "NIVEL · faixa estimada · ex: 'Médio · R$ 200-400/peça' ou '— · sem indício'",
  "urgencia": "NIVEL · descrição · ex: 'Alta · provável fechamento em 7 dias' ou 'Baixa · sem prazo definido'",
  "timing": "ETAPA · descrição · ex: 'Consideração · comparando 2 fornecedores' ou 'Pesquisa · só conheceu a marca agora'",
  "objecoes": ["array", "de", "strings"],
  "lead_score": 0-100,
  "acao_recomendada": "string com a próxima ação concreta da vendedora"
}

REGRAS PRO LEAD_SCORE (0-100):
- 80-100: lead quente, decisão eminente, dados ricos confirmando intenção
- 60-79: lead morno, demonstrou interesse claro, faltam detalhes pra fechar
- 40-59: lead frio com sinais positivos, precisa nutrir
- 20-39: lead muito frio, info insuficiente
- 0-19: praticamente sem qualificação possível, dados quase nulos

NIVEIS aceitos: 'Alta' | 'Média' | 'Baixa' (urgência), 'Premium' | 'Alto' | 'Médio' | 'Baixo' (budget), 'Pesquisa' | 'Consideração' | 'Decisão' (timing).`

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
  if (sinais.tem_segmento) conf += 5
  if (sinais.tem_cidade) conf += 5
  if (sinais.tem_whatsapp) conf += 3
  if (sinais.tem_mensagem_ia) conf += 5
  if (sinais.tem_observacao) conf += 5
  if (sinais.status_avancado) conf += 10  // se status != 'novo' (vendedora já contatou)
  if (sinais.qtd_eventos_tracker > 0) conf += Math.min(15, sinais.qtd_eventos_tracker * 2)
  if (sinais.qtd_pedidos_anteriores > 0) conf += 12
  if (sinais.tem_motivo_perda) conf += 5  // motivo de perda já registrado é sinal forte
  return Math.min(95, conf)  // teto 95% — nunca prometer 100% certeza
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

    // Body
    const body = await req.json().catch(() => ({}))
    const prospectId: string = body.prospect_id
    if (!prospectId) return json({ error: 'prospect_id obrigatório' }, 400)

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

    // Busca prospect (com permissão por RLS — service role pula RLS, então valida cargo na hora)
    const { data: prospect, error: prospErr } = await admin
      .from('prospects')
      .select('*')
      .eq('id', prospectId)
      .single()
    if (prospErr || !prospect) return json({ error: 'Lead não encontrado' }, 404)

    // Vendedora só pode qualificar próprio lead
    if (cargo === 'vendedor' && prospect.criado_por !== user.id) {
      return json({ error: 'Você só pode qualificar leads que VOCÊ criou' }, 403)
    }

    // ── Coleta de SINAIS pra montar contexto ──
    const contextoLead: any = {
      nome: (prospect.nome || '').slice(0, 200),
      cidade: prospect.cidade || null,
      estado: prospect.estado || null,
      segmento: prospect.segmento || null,
      whatsapp_cadastrado: !!prospect.whatsapp,
      status_atual: prospect.status || 'novo',
      criado_em: prospect.created_at,
      mensagem_ia_gerada: (prospect.ia_mensagem || '').slice(0, 800) || null,
      motivo_perda: prospect.motivo_perda || null,
      motivo_perda_detalhe: (prospect.motivo_perda_detalhe || '').slice(0, 200) || null,
    }

    // Histórico de status
    const { data: hist } = await admin.from('prospects_historico')
      .select('acao, status_anterior, status_novo, created_at')
      .eq('prospect_id', prospectId).order('created_at', { ascending: false }).limit(10)
    contextoLead.historico_acoes = (hist || []).map((h: any) => ({
      acao: h.acao, de: h.status_anterior, para: h.status_novo,
      quando: h.created_at?.slice(0, 10),
    }))

    // Eventos do tracker (se Lead Tracker estiver ativo + lead virou contato_nome)
    let qtdEventosTracker = 0
    if (prospect.nome) {
      const { count } = await admin.from('analytics_lead_events')
        .select('*', { count: 'exact', head: true })
        .eq('contato_nome', prospect.nome)
      qtdEventosTracker = Number(count) || 0
      if (qtdEventosTracker > 0) {
        const { data: jornada } = await admin.from('analytics_jornada_cliente')
          .select('pageviews, paginas_unicas, dias_visitando, primeiro_toque, canais, campanhas, devices')
          .eq('contato_nome', prospect.nome).maybeSingle()
        contextoLead.comportamento_site = jornada || null
      }
    }

    // Pedidos anteriores (caso lead já tenha comprado e virou cliente)
    let qtdPedidos = 0
    if (prospect.nome) {
      const { count } = await admin.from('pedidos')
        .select('*', { count: 'exact', head: true })
        .ilike('contato_nome', prospect.nome)
      qtdPedidos = Number(count) || 0
    }
    if (qtdPedidos > 0) contextoLead.pedidos_anteriores_count = qtdPedidos

    // Sinais pra calcular confiança
    const sinais = {
      tem_segmento: !!prospect.segmento,
      tem_cidade: !!prospect.cidade,
      tem_whatsapp: !!prospect.whatsapp,
      tem_mensagem_ia: !!prospect.ia_mensagem,
      tem_observacao: false,  // prospects não tem campo observacao genérico
      status_avancado: prospect.status && prospect.status !== 'novo',
      qtd_eventos_tracker: qtdEventosTracker,
      qtd_pedidos_anteriores: qtdPedidos,
      tem_motivo_perda: !!prospect.motivo_perda,
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
    const leadScore = Math.max(0, Math.min(100, parseInt(obj.lead_score) || 50))

    // Custo estimado
    const custoEstimado = result.provider === 'gemini' ? 0.02 : 0  // Groq free

    // Insert no banco (service role)
    const { data: inserted, error: insErr } = await admin
      .from('lead_qualificacao')
      .insert({
        prospect_id: prospectId,
        contato_nome: prospect.nome,
        empresa: null,  // prospects não tem empresa setada
        dor: String(obj.dor || '—').slice(0, 400),
        perfil: String(obj.perfil || '—').slice(0, 300),
        budget: String(obj.budget || '—').slice(0, 200),
        urgencia: String(obj.urgencia || '—').slice(0, 200),
        timing: String(obj.timing || '—').slice(0, 200),
        objecoes: objecoesArr,
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
