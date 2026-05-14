// ══════════════════════════════════════════════════════════════════════════
// Edge Function: sugerir-campanha-estoque
// (Entrega 3 do plano da Manu — Section 90 da doc)
//
// Recebe um agrupamento de produtos parados (uma "linha") e retorna uma
// proposta de campanha estruturada (tipo de oferta + copy Instagram +
// copy WhatsApp + canal recomendado + período sugerido) usando IA.
//
// Cascade: Groq Llama 3.3 70B (free) → Gemini 2.5 Flash (fallback).
// Saída obrigatoriamente JSON parseável (response_format=json_object no Groq).
//
// Uso:
//   POST /functions/v1/sugerir-campanha-estoque
//   Headers: Authorization: Bearer <jwt>
//   Body: {
//     linha_nome: string,
//     itens: [{
//       codigo, nome, estoque_virtual, preco, empresa,
//       ultima_venda, dias_sem_vender, valor_parado,
//       qtd_30d, qtd_90d, qtd_180d, qtd_365d
//     }],
//     totais: { unidades, valor_parado, variacoes }
//   }
//
// Resposta:
//   {
//     ok: true,
//     proposta: {
//       tipo_oferta: 'desconto'|'compre_ganhe'|'kit'|'frete_gratis'|'outro',
//       percent: number,
//       nome_campanha: string,
//       argumento: string,
//       copy_instagram: string,
//       copy_whatsapp: string,
//       canal_recomendado: string,
//       periodo_dias: number,
//       reasoning: string
//     },
//     modelo: string,
//     provider: 'groq'|'gemini',
//     gerado_em: ISO
//   }
// ══════════════════════════════════════════════════════════════════════════

import { createClient } from 'npm:@supabase/supabase-js@2'

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

// Permissão: mesmos cargos da view de Estoque (admin + gerente_financeiro)
// + gerente_marketing pq esse vai usar pra montar campanha
const CARGOS_AUTORIZADOS = new Set(['admin', 'gerente_financeiro', 'gerente_marketing', 'gerente_comercial'])

const MAX_CONTEXTO_BYTES = 8 * 1024  // anti-bloat

// System prompt — força JSON estruturado, conhece a Dana Jalecos, foco em ação
const SYSTEM_PROMPT = `Você é um especialista em campanhas de liquidação de estoque da Dana Jalecos (uniformes de saúde — jalecos, scrubs, blusas).

CONTEXTO DA MARCA:
- Público B2B (clínicas, consultórios) e B2C (médicos, dentistas, esteticistas, enfermeiras)
- Canais ativos: Instagram (forte engajamento visual), WhatsApp (atendimento personalizado), Mercado Livre (volume), Site B2B
- Estoque parado >5 meses = capital empatado que precisa girar
- Linhas comuns: Heloisa, Manuela, Clara, Isabel, Chloe, Samuel, Benício, Scrubs Tradicional/Comfy/Glamour

SUA TAREFA: dada uma "linha" de produtos parados, recomendar UMA campanha de liquidação. Saída deve ser JSON válido (NADA fora do JSON, sem markdown, sem \`\`\`json).

REGRAS RÍGIDAS:
1. Olhe a tendência de vendas (qtd_30d, qtd_90d, qtd_180d, qtd_365d). Se vendia bem antes e parou → declínio recente, desconto direto resolve. Se nunca vendeu → produto pode ter problema de demanda, kit ou brinde melhor.
2. Considere preço médio:
   - Preço < R$ 50 → vira brinde em compre-e-ganhe (gera percepção de valor sem queimar margem)
   - Preço R$ 50-150 → desconto -30 a -40%
   - Preço > R$ 150 → desconto + frete grátis, ou kit (junta com SKU de menor preço)
3. Considere quantidade total:
   - Estoque < 5 un total → vira brinde ou prêmio de promoção (não dá pra campanha grande)
   - Estoque 5-20 → desconto direto
   - Estoque > 20 → desconto pesado (-40 a -50%) com prazo curto pra criar urgência
4. Canal recomendado deve fazer sentido pro tipo de produto e oferta:
   - Brinde / compre-e-ganhe → Instagram (visual + engajamento)
   - Desconto pesado → WhatsApp (base ativa) + Instagram (atingir novos)
   - Kit → Mercado Livre (compradores caçando preço) ou Site
5. Mês atual influencia (sazonalidade): final/início de ano = campanhas de virada; meio do ano = "Dia do Profissional X" (médico, dentista, esteticista — datas comemorativas)
6. NÃO invente nomes de produtos, vendedoras ou números fora do contexto.
7. Copy Instagram: 1-2 frases punchy + emojis discretos + CTA. Max 220 caracteres.
8. Copy WhatsApp: tom direto, 2-3 frases, sem emojis em excesso, foca em benefício. Max 320 caracteres.

FORMATO JSON OBRIGATÓRIO:
{
  "tipo_oferta": "desconto" | "compre_ganhe" | "kit" | "frete_gratis" | "outro",
  "percent": <número 0-60, 0 quando tipo é compre_ganhe ou outro>,
  "nome_campanha": "<2-5 palavras, com gancho. Ex: 'Última semana: linha Heloisa -40%'>",
  "argumento": "<2-3 frases pra equipe entender o porquê dessa oferta — cita estoque, tempo parado e valor empatado>",
  "copy_instagram": "<texto do post pronto pra usar>",
  "copy_whatsapp": "<mensagem pronta pra disparar pra base>",
  "canal_recomendado": "Instagram" | "WhatsApp" | "Mercado Livre" | "Site" | "E-mail",
  "periodo_dias": <número 5-30, prazo da campanha>,
  "reasoning": "<1 frase resumindo a lógica por trás da escolha>"
}`

async function callGroq(messages: any[]) {
  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      temperature: 0.5,
      max_tokens: 900,
      response_format: { type: 'json_object' },
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
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: 900,
          responseMimeType: 'application/json',
        },
      }),
    }
  )
  if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${(await resp.text()).slice(0, 300)}`)
  const j = await resp.json()
  return j?.candidates?.[0]?.content?.parts?.[0]?.text || ''
}

async function gerar(contextoStr: string): Promise<{ raw: string, modelo: string, provider: string }> {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: contextoStr },
  ]
  try {
    const text = await callGroq(messages)
    if (text) return { raw: text, modelo: GROQ_MODEL, provider: 'groq' }
  } catch (e) {
    console.warn('[sugerir-campanha-estoque] Groq falhou:', (e as Error).message)
  }
  const text = await callGemini(SYSTEM_PROMPT + '\n\n---\n\n' + contextoStr)
  return { raw: text, modelo: GEMINI_MODEL, provider: 'gemini' }
}

// Sanitiza valores numéricos / strings pra evitar bloat
function sanitizar(obj: any, depth = 0): any {
  if (depth > 6) return null
  if (obj == null) return obj
  if (typeof obj === 'string') return obj.length > 120 ? obj.slice(0, 117) + '...' : obj
  if (typeof obj === 'number') return Math.round(obj * 100) / 100
  if (typeof obj === 'boolean') return obj
  if (Array.isArray(obj)) return obj.slice(0, 30).map(v => sanitizar(v, depth + 1))
  if (typeof obj === 'object') {
    const out: any = {}
    for (const k of Object.keys(obj).slice(0, 30)) {
      out[k] = sanitizar(obj[k], depth + 1)
    }
    return out
  }
  return null
}

// Garante que o JSON retornado tem os campos esperados (defensivo)
function normalizarProposta(parsed: any): any {
  const tipos = ['desconto', 'compre_ganhe', 'kit', 'frete_gratis', 'outro']
  const canais = ['Instagram', 'WhatsApp', 'Mercado Livre', 'Site', 'E-mail']
  return {
    tipo_oferta: tipos.includes(parsed?.tipo_oferta) ? parsed.tipo_oferta : 'desconto',
    percent: Math.max(0, Math.min(60, Number(parsed?.percent) || 30)),
    nome_campanha: String(parsed?.nome_campanha || 'Campanha de liquidação').slice(0, 100),
    argumento: String(parsed?.argumento || '').slice(0, 600),
    copy_instagram: String(parsed?.copy_instagram || '').slice(0, 400),
    copy_whatsapp: String(parsed?.copy_whatsapp || '').slice(0, 500),
    canal_recomendado: canais.includes(parsed?.canal_recomendado) ? parsed.canal_recomendado : 'Instagram',
    periodo_dias: Math.max(3, Math.min(60, Number(parsed?.periodo_dias) || 14)),
    reasoning: String(parsed?.reasoning || '').slice(0, 300),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  try {
    // ─── 1. Auth ───
    const authHeader = req.headers.get('Authorization') || ''
    const jwt = authHeader.replace(/^Bearer /, '')
    if (!jwt) return json({ error: 'Autenticação obrigatória' }, 401)

    const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await userClient.auth.getUser(jwt)
    if (userErr || !userData.user) return json({ error: 'JWT inválido' }, 401)

    const { data: profile } = await admin.from('profiles').select('cargo, nome').eq('id', userData.user.id).single()
    const cargo = profile?.cargo || 'vendedor'

    if (!CARGOS_AUTORIZADOS.has(cargo)) {
      return json({
        error: 'Sem permissão. Sugestão de campanha por IA é restrita a admin, gerentes financeiro/marketing/comercial.'
      }, 403)
    }

    // ─── 2. Body ───
    const body = await req.json().catch(() => ({}))
    const linhaNome = String(body.linha_nome || 'Linha sem nome').slice(0, 80)
    const itensRaw = Array.isArray(body.itens) ? body.itens.slice(0, 25) : []
    if (!itensRaw.length) return json({ error: 'itens vazio' }, 400)

    const itens = sanitizar(itensRaw)
    const totais = sanitizar(body.totais || {})

    // Mês atual em pt-BR (pra sazonalidade)
    const mesAtual = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

    const contextoStr = JSON.stringify({
      linha: linhaNome,
      mes_atual: mesAtual,
      totais,
      itens,
    })

    if (contextoStr.length > MAX_CONTEXTO_BYTES) {
      return json({
        error: `Contexto muito grande (${contextoStr.length} bytes, max ${MAX_CONTEXTO_BYTES}).`
      }, 400)
    }

    // ─── 3. Gera via LLM ───
    const promptUser = `LINHA: ${linhaNome}
MÊS ATUAL: ${mesAtual}

DADOS:
${JSON.stringify({ totais, itens }, null, 2)}

Gere a proposta de campanha em JSON conforme o formato do system prompt.`

    const { raw, modelo, provider } = await gerar(promptUser)

    // ─── 4. Parse JSON ───
    let parsed: any
    try {
      parsed = JSON.parse(raw)
    } catch {
      // Tenta extrair JSON entre {} caso o modelo tenha adicionado texto extra
      const match = raw.match(/\{[\s\S]*\}/)
      if (match) {
        try { parsed = JSON.parse(match[0]) } catch { /* ignore */ }
      }
    }
    if (!parsed) {
      console.warn('[sugerir-campanha-estoque] modelo retornou JSON inválido:', raw.slice(0, 300))
      return json({ error: 'IA retornou formato inválido. Tente novamente.' }, 502)
    }

    const proposta = normalizarProposta(parsed)

    // ─── 5. Log (fire-and-forget) ───
    admin.from('propostas_campanha_ia').insert({
      linha_nome: linhaNome,
      proposta_json: proposta,
      modelo,
      provider,
      contexto_resumo: { totais, n_itens: itens.length },
      user_id: userData.user.id,
      user_nome: profile?.nome || userData.user.email || 'usuário',
    }).then(({ error }) => { if (error) console.warn('[sugerir-campanha-estoque] save log:', error.message) })

    return json({
      ok: true,
      proposta,
      modelo,
      provider,
      gerado_em: new Date().toISOString(),
    })
  } catch (e) {
    console.error('[sugerir-campanha-estoque] erro:', e)
    return json({ error: (e as Error).message || 'erro interno' }, 500)
  }
})
