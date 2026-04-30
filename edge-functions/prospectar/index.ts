// Edge Function: prospectar
// Busca leads reais (Google Search grounding via Gemini) e gera msg de prospecção.
//
// Input:  { segmento, cidade, estado, qtd_max, contexto_dana?, segmentos_existentes? }
// Output: { leads: [{nome, segmento, cidade, estado, endereco, telefone, whatsapp, website,
//                    instagram, ia_insight, ia_mensagem}], total: N, provider }
//
// Frontend faz dedup (verifica leads ja existentes em prospects table) e insere os novos.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Input {
  segmento: string;
  cidade?: string;
  estado?: string;
  qtd_max?: number;
  contexto_dana?: string; // opcional: contexto da empresa pra IA personalizar
  ja_prospectados?: string[]; // nomes ja existentes (pra IA evitar)
}

const SYSTEM_PROMPT = `Voce e um assistente de prospec\u00e7\u00e3o B2B da DANA JALECOS EXCLUSIVOS, marca premium de jalecos e scrubs medicos brasileira (vende para profissionais de saude e estabelecimentos como clinicas, hospitais, clinicas veterinarias, cl\u00ednicas est\u00e9ticas, escolas tecnicas de saude).

TAREFA:
1. Buscar leads B2B REAIS no Google que se encaixem no segmento + cidade/estado pedidos.
2. Para cada lead, extrair dados publicos: nome do estabelecimento, endereco, telefone, site, instagram, whatsapp (assumir telefone movel BR como WhatsApp).
3. Gerar UMA mensagem de prospec\u00e7\u00e3o **mediana** (nem muito formal nem muito casual) que serve pra mandar via WhatsApp, email ou Instagram DM. Tom: profissional brasileiro empoderado, premium mas acess\u00edvel. NAO usar linguagem comercial agressiva. NAO falar em desconto.
4. Gerar tambem um **insight** curto: por que esse lead faz sentido pra Dana abordar (1 frase).

REGRAS CRITICAS:
- APENAS leads VERIFICADOS na busca real do Google. NAO invente dados.
- Se nao encontrar telefone/instagram/site para um lead, deixe campo como null. NAO chute.
- Mensagem DEVE mencionar o nome do estabelecimento e algo especifico (segmento) pra parecer pessoal, NAO generica.
- Mensagem max 350 caracteres. Termina com pergunta aberta convidando resposta.
- Mensagem deve dar a entender que conhece o lead (sem ser stalker), mostrando algum elemento real (ex: "vi que voces atendem [especialidade]").

FORMATO DE OUTPUT: JSON puro, schema:
{
  "leads": [
    {
      "nome": "Nome do estabelecimento exato como aparece no Google",
      "segmento": "Segmento espec\u00edfico (ex: 'Cl\u00ednica veterin\u00e1ria')",
      "cidade": "Cidade",
      "estado": "Sigla UF",
      "endereco": "Endere\u00e7o completo se disponivel ou null",
      "telefone": "Telefone formatado (47)99999-9999 ou null",
      "whatsapp": "WhatsApp formatado ou null (assumir = telefone se for celular BR)",
      "website": "URL do site ou null",
      "instagram": "@handle do Instagram ou null",
      "ia_insight": "1 frase curta de por que esse lead faz sentido (max 150 chars)",
      "ia_mensagem": "Mensagem mediana de prospec\u00e7\u00e3o (max 350 chars)"
    }
  ]
}

Responda com JSON puro, NADA mais. Sem markdown, sem explica\u00e7\u00e3o.`;

// Valida JWT do usuario e retorna cargo + nome do profile (null se invalido/erro)
async function getUserRole(authHeader: string): Promise<{ id: string; cargo: string; nome: string | null } | null> {
  if (!authHeader) return null;
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return null;
  try {
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(padded + '='.repeat((4 - padded.length % 4) % 4)));
    const userId = payload?.sub;
    if (!userId) return null;
    const r = await fetch(`${url}/rest/v1/profiles?id=eq.${userId}&select=cargo,nome`, {
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
    });
    if (!r.ok) return null;
    const data = await r.json();
    const cargo = data?.[0]?.cargo;
    if (!cargo) return null;
    return { id: userId, cargo, nome: data?.[0]?.nome || null };
  } catch (e) {
    console.warn('[prospectar] getUserRole erro:', e);
    return null;
  }
}

function buildUserPrompt(input: Input): string {
  const parts = [
    `SEGMENTO: ${input.segmento}`,
  ];
  if (input.cidade) parts.push(`CIDADE: ${input.cidade}`);
  if (input.estado) parts.push(`ESTADO: ${input.estado}`);
  parts.push(`QUANTIDADE MAXIMA: ${input.qtd_max}`);
  if (input.ja_prospectados?.length) {
    // Aumentei o cap pra 80 (era 30) pra IA ter contexto melhor da blacklist.
    // Reforcei a instrucao porque a IA estava repetindo nomes obvios da regiao.
    const lista = input.ja_prospectados.slice(0, 80);
    parts.push(`# BLACKLIST — empresas que JA estao na nossa base e voce NAO PODE retornar (${lista.length} empresas):`);
    parts.push(lista.map((n, i) => `${i + 1}. ${n}`).join('\n'));
    parts.push('');
    parts.push('REGRA OBRIGATORIA: ignore qualquer empresa da BLACKLIST acima. Procure ativamente leads NOVOS, mesmo que sejam menores ou menos famosos. Se voce so conseguir encontrar empresas da BLACKLIST, retorne lista vazia em vez de repetir.');
  }
  if (input.contexto_dana) parts.push(`CONTEXTO ADICIONAL DANA: ${input.contexto_dana}`);
  parts.push('');
  parts.push('Busque os leads no Google e retorne o JSON estruturado.');
  return parts.join('\n');
}

async function callGeminiWithSearch(userPrompt: string): Promise<{ data: any; tokensIn: number; tokensOut: number; provider: string }> {
  // Prospectar usa GEMINI_API_KEY_PAID (paga, tier 1 - quota maior pro Google Search
  // grounding que consome mais). Fallback pra free GEMINI_API_KEY se a paga falhar.
  const key = Deno.env.get('GEMINI_API_KEY_PAID') || Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY_PAID missing');
  const provider = Deno.env.get('GEMINI_API_KEY_PAID') ? 'gemini-2.5-flash-paid' : 'gemini-2.5-flash-free';

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 6000 },
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gemini ${res.status}: ${txt.slice(0, 300)}`);
  }
  const respData = await res.json();
  const text = respData?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('\n') || '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Gemini retornou sem JSON: ' + text.slice(0, 300));
  // Pega tokens do usageMetadata
  const tokensIn = respData?.usageMetadata?.promptTokenCount || 0;
  const tokensOut = respData?.usageMetadata?.candidatesTokenCount || 0;
  return { data: JSON.parse(m[0]), tokensIn, tokensOut, provider };
}

// Calcula custo estimado em R$ baseado em tokens + Google Search (1 query = ~$0.035 / R$0,18)
// Pricing Gemini 2.5 Flash (paid): input $0.075/1M, output $0.30/1M
function estimarCustoReais(tokensIn: number, tokensOut: number): number {
  const USD_BRL = 5.0; // taxa conservadora
  const custoTokens = ((tokensIn / 1_000_000) * 0.075 + (tokensOut / 1_000_000) * 0.30) * USD_BRL;
  const custoSearch = 0.18; // 1 query Google Search ~ R$ 0,18
  return Math.max(0.05, custoTokens + custoSearch); // min R$ 0,05
}

async function logProspeccao(input: {
  user_id: string;
  user_nome: string | null;
  user_cargo: string;
  segmento: string;
  cidade: string | null;
  estado: string | null;
  qtd_leads: number;
  custo_estimado_reais: number;
  status: 'ok' | 'erro';
  erro: string | null;
  provider: string | null;
  tokens_input: number;
  tokens_output: number;
}): Promise<void> {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return;
  try {
    await fetch(`${url}/rest/v1/ia_prospeccao_log`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(input),
    });
  } catch (e) {
    console.warn('[prospectar] log falhou:', e);
  }
}

function sanitize(out: any): any {
  const trim = (s: any, max = 350) => (typeof s === 'string' ? s.trim().slice(0, max) : null);
  const trimNull = (s: any, max = 350) => {
    const v = trim(s, max);
    return v && v.toLowerCase() !== 'null' && v !== '' ? v : null;
  };
  const leads = Array.isArray(out?.leads) ? out.leads : [];
  return {
    leads: leads.map((l: any) => ({
      nome: trim(l?.nome, 200) || 'Lead sem nome',
      segmento: trim(l?.segmento, 100),
      cidade: trim(l?.cidade, 100),
      estado: trim(l?.estado, 5),
      endereco: trimNull(l?.endereco, 250),
      telefone: trimNull(l?.telefone, 30),
      whatsapp: trimNull(l?.whatsapp, 30),
      website: trimNull(l?.website, 250),
      instagram: trimNull(l?.instagram, 100),
      ia_insight: trim(l?.ia_insight, 200),
      ia_mensagem: trim(l?.ia_mensagem, 400),
    })).filter((l: any) => l.nome && l.nome !== 'Lead sem nome'),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  try {
    const input: Input = await req.json();
    if (!input?.segmento) {
      return new Response(JSON.stringify({ error: 'segmento obrigatorio' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Valida cargo do usuario pra aplicar limite (admin = 30, demais = 10)
    const auth = req.headers.get('Authorization') || '';
    const userInfo = await getUserRole(auth);
    if (!userInfo) {
      return new Response(JSON.stringify({ error: 'Nao autenticado ou perfil nao encontrado' }), {
        status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    const isAdmin = userInfo.cargo === 'admin';
    const isGerente = ['gerente_comercial', 'gerente_marketing', 'gerente_financeiro'].includes(userInfo.cargo);
    // Limite de qtd_max por cargo: admin 30, gerente 10, demais (vendedor) 5
    const limiteMax = isAdmin ? 30 : (isGerente ? 10 : 5);
    input.qtd_max = Math.min(input.qtd_max || 5, limiteMax);

    // ═══ QUOTA: limite diario por cargo + kill-switch + limite mensal de gasto ═══
    // Espelha o mesmo padrao usado em cliente360-insight.
    if (!isAdmin) {
      const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
      const SR_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supaHeaders = { 'apikey': SR_KEY, 'Authorization': `Bearer ${SR_KEY}`, 'Content-Type': 'application/json' };

      // 1. Config + kill-switches
      const cfgResp = await fetch(`${SUPA_URL}/rest/v1/prospeccao_config?id=eq.1&select=*`, { headers: supaHeaders });
      const cfgArr = cfgResp.ok ? await cfgResp.json() : [];
      const cfg = cfgArr[0] || { limite_diario_vendedor: 5, limite_diario_gerente: 10, limite_mensal_reais: 100, pausado_manual: false, pausado_por_limite: false };
      if (cfg.pausado_manual) {
        return new Response(JSON.stringify({ error: 'Prospeccao IA pausada manualmente pelo admin.' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
      if (cfg.pausado_por_limite) {
        return new Response(JSON.stringify({ error: 'Prospeccao IA pausada — limite mensal atingido.' }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }

      // 2. Limite mensal de gasto (auto-pausa)
      const gastoResp = await fetch(`${SUPA_URL}/rest/v1/rpc/prospeccao_gasto_mes`, {
        method: 'POST', headers: supaHeaders, body: '{}',
      });
      const gasto = gastoResp.ok ? Number(await gastoResp.json()) : 0;
      if (gasto >= Number(cfg.limite_mensal_reais)) {
        await fetch(`${SUPA_URL}/rest/v1/prospeccao_config?id=eq.1`, {
          method: 'PATCH', headers: { ...supaHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ pausado_por_limite: true }),
        });
        return new Response(JSON.stringify({ error: `Limite mensal de R$ ${cfg.limite_mensal_reais} atingido. Geracao pausada.` }),
          { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }

      // 3. Limite diario por cargo
      const isGerente = ['gerente_comercial', 'gerente_marketing', 'gerente_financeiro'].includes(userInfo.cargo);
      const limiteDiario = isGerente ? Number(cfg.limite_diario_gerente) : Number(cfg.limite_diario_vendedor);
      const cntResp = await fetch(`${SUPA_URL}/rest/v1/rpc/prospeccao_count_hoje`, {
        method: 'POST', headers: supaHeaders, body: JSON.stringify({ uid: userInfo.id }),
      });
      const usados = cntResp.ok ? Number(await cntResp.json()) : 0;
      if (usados >= limiteDiario) {
        return new Response(JSON.stringify({
          error: `Limite diario de ${limiteDiario} buscas atingido. Tenta amanha.`,
          quota: { usados, limite: limiteDiario, restante: 0 },
        }), { status: 429, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
    }

    const userPrompt = buildUserPrompt(input);

    try {
      const { data: out, tokensIn, tokensOut, provider } = await callGeminiWithSearch(userPrompt);
      const v = sanitize(out);
      const custoEstimado = estimarCustoReais(tokensIn, tokensOut);
      // Log da chamada bem-sucedida — AWAIT pra garantir que o INSERT no log
      // termine ANTES do response. Sem await, o isolate Deno e destruido apos
      // return e o fetch interno do logProspeccao e cancelado (bug observado:
      // tabela ia_prospeccao_log estava vazia mesmo com chamadas funcionando).
      await logProspeccao({
        user_id: userInfo.id,
        user_nome: userInfo.nome,
        user_cargo: userInfo.cargo,
        segmento: input.segmento,
        cidade: input.cidade || null,
        estado: input.estado || null,
        qtd_leads: v.leads.length,
        custo_estimado_reais: custoEstimado,
        status: 'ok',
        erro: null,
        provider,
        tokens_input: tokensIn,
        tokens_output: tokensOut,
      });
      // Quota info pra UI mostrar contador (admin = ilimitado)
      let quotaInfo: any = null;
      if (!isAdmin) {
        try {
          const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
          const SR_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          const isGerente = ['gerente_comercial', 'gerente_marketing', 'gerente_financeiro'].includes(userInfo.cargo);
          const cfgResp = await fetch(`${SUPA_URL}/rest/v1/prospeccao_config?id=eq.1&select=limite_diario_vendedor,limite_diario_gerente`, {
            headers: { 'apikey': SR_KEY, 'Authorization': `Bearer ${SR_KEY}` },
          });
          const cfg = cfgResp.ok ? (await cfgResp.json())[0] : null;
          const limiteDiario = isGerente ? Number(cfg?.limite_diario_gerente || 10) : Number(cfg?.limite_diario_vendedor || 5);
          const cntResp = await fetch(`${SUPA_URL}/rest/v1/rpc/prospeccao_count_hoje`, {
            method: 'POST',
            headers: { 'apikey': SR_KEY, 'Authorization': `Bearer ${SR_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: userInfo.id }),
          });
          const u = cntResp.ok ? Number(await cntResp.json()) : 0;
          quotaInfo = { usados: u, limite: limiteDiario, restante: Math.max(0, limiteDiario - u) };
        } catch {}
      }
      return new Response(JSON.stringify({
        provider,
        total: v.leads.length,
        limite_max: limiteMax,
        cargo: userInfo.cargo,
        custo_estimado_reais: custoEstimado,
        quota: quotaInfo,
        ...v,
      }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    } catch (e) {
      console.error('[prospectar] gemini falhou:', e);
      // Log da falha tambem (custo 0) — AWAIT mesmo motivo acima
      await logProspeccao({
        user_id: userInfo.id,
        user_nome: userInfo.nome,
        user_cargo: userInfo.cargo,
        segmento: input.segmento,
        cidade: input.cidade || null,
        estado: input.estado || null,
        qtd_leads: 0,
        custo_estimado_reais: 0,
        status: 'erro',
        erro: String(e?.message || e).slice(0, 500),
        provider: null,
        tokens_input: 0,
        tokens_output: 0,
      });
      return new Response(JSON.stringify({
        error: 'Falha na busca: ' + String(e?.message || e).slice(0, 250),
      }), { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
  } catch (e) {
    console.error('[prospectar] erro geral:', e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
