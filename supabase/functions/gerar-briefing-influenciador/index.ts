// ══════════════════════════════════════════════════════════════
// Edge: gerar-briefing-influenciador  (Influencer OS · Fase 2 · Onda 2)
//
// Gera um briefing de conteúdo sob medida pra um creator usando os
// dados de CRM dele (nicho, público, tipo de conteúdo, nível...).
// Motor: Groq (Llama 3.3 70B) primário · Gemini 2.5 Flash fallback.
//
// Body: { influenciador_id: "<uuid>", objetivo?: string, formato?: string }
// Auth: admin / gerente_comercial / gerente_marketing
// ══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY')!
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!

const GROQ_MODEL = 'llama-3.3-70b-versatile'
const GEMINI_MODEL = 'gemini-2.5-flash'

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, apikey, Content-Type, X-Client-Info',
}
function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

async function chamarGroq(system: string, user: string): Promise<string> {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.7,
      max_tokens: 1400,
    }),
  })
  if (!r.ok) throw new Error(`Groq ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const d = await r.json()
  const txt = d.choices?.[0]?.message?.content?.trim()
  if (!txt) throw new Error('Groq: resposta vazia')
  return txt
}

async function chamarGemini(system: string, user: string): Promise<string> {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 1400 },
    }),
  })
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const d = await r.json()
  const txt = d.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('').trim()
  if (!txt) throw new Error('Gemini: resposta vazia')
  return txt
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  try {
    const body = await req.json().catch(() => ({})) as any
    const influId = String(body.influenciador_id || '')
    if (!influId) return json({ error: 'influenciador_id obrigatório' }, 400)

    // Auth do caller (admin/gerente)
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '')
    if (!token || token === SUPABASE_ANON_KEY) return json({ error: 'auth obrigatória' }, 401)
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: u } = await userClient.auth.getUser()
    const uid = u?.user?.id
    if (!uid) return json({ error: 'JWT inválido' }, 401)
    const { data: prof } = await admin.from('profiles').select('cargo').eq('id', uid).maybeSingle()
    if (!['admin', 'gerente_comercial', 'gerente_marketing'].includes(prof?.cargo || '')) {
      return json({ error: 'sem_permissao' }, 403)
    }

    // Dados do creator
    const { data: inf } = await admin
      .from('influenciadores')
      .select('nome, instagram, cidade, regiao, profissao, nicho, seguidores, segmento, tipo_conteudo, publico_predominante, nivel, media_views, engajamento_pct')
      .eq('id', influId)
      .maybeSingle()
    if (!inf) return json({ error: 'influenciador_nao_encontrado' }, 404)

    const objetivo = String(body.objetivo || '').trim() || 'gerar desejo pelos jalecos/scrubs Dana e converter via cupom do creator'
    const formato = String(body.formato || '').trim() || inf.tipo_conteudo || 'Reels'

    const system = `Você é estrategista de marketing de influência da Dana Jalecos — marca premium de jalecos e scrubs para a área da saúde (médicos, dentistas, enfermeiros, vets, biomédicos, estética). Tom da marca: sofisticado, acolhedor, editorial, nada infantil. Diferenciais: caimento impecável, tecido premium, design autoral, pin dourado exclusivo da marca. Você cria briefings de conteúdo prontos pra entregar ao creator: objetivos, diretrizes e roteiro acionáveis. Escreva em português do Brasil, direto e prático. Use markdown enxuto (títulos com ###, listas). NÃO invente métricas nem promessas que a marca não fez.`

    const user = `Crie um BRIEFING DE CONTEÚDO completo e personalizado para o creator abaixo.

CREATOR
- Nome: ${inf.nome}
- Instagram: ${inf.instagram || '—'}
- Profissão/área: ${inf.profissao || '—'}
- Nicho: ${inf.nicho || '—'}
- Público predominante: ${inf.publico_predominante || '—'}
- Cidade/região: ${[inf.cidade, inf.regiao].filter(Boolean).join(' / ') || '—'}
- Seguidores: ${inf.seguidores || '—'} · Engajamento: ${inf.engajamento_pct ? inf.engajamento_pct + '%' : '—'}
- Tipo de conteúdo que ele faz: ${inf.tipo_conteudo || '—'}
- Nível na parceria Dana: ${inf.nivel || 'nano'}

CAMPANHA
- Objetivo: ${objetivo}
- Formato pedido: ${formato}

Estruture EXATAMENTE com estas seções (markdown):
### 🎯 Objetivo
### 💡 Conceito / ângulo (1 ideia forte, alinhada ao nicho do creator)
### 🎬 Roteiro sugerido (passo a passo do ${formato}: gancho nos 3s, desenvolvimento, CTA)
### 🗣️ Pontos-chave de fala (3 a 5 bullets — o que destacar da Dana)
### #️⃣ Sugestão de legenda + hashtags
### ✅ Pode / ❌ Não pode (diretrizes da marca)
### 📅 Entregáveis e dica de melhor horário

Seja específico ao universo dele (ex.: rotina na clínica/plantão/consultório). Máximo ~450 palavras.`

    let briefing: string
    try {
      briefing = await chamarGroq(system, user)
    } catch (e1) {
      console.warn('[briefing] Groq falhou, fallback Gemini:', String(e1).slice(0, 120))
      briefing = await chamarGemini(system, user)
    }

    return json({ ok: true, briefing, creator: inf.nome })
  } catch (e: any) {
    console.error('[gerar-briefing-influenciador]', e)
    return json({ error: e.message || String(e) }, 500)
  }
})
