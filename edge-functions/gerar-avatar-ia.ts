// ============================================================
// gerar-avatar-ia — gera imagem via Gemini 2.5 Flash Image (paid)
// Custo ~R$ 0,20/imagem. Admin ilimitado. Outros 5/dia.
// Kill-switch global se gasto mensal > limite.
// ============================================================
// MUDANCA 28/04/2026: prompt limit subido de 2000 -> 5000 chars
// (Estudio IA gera prompts ricos de ~2500 chars com Gemini Vision)
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const GEMINI_IMAGE_KEY = Deno.env.get('GEMINI_IMAGE_API_KEY')!
const IMGBB_API_KEY = Deno.env.get('IMGBB_API_KEY')!

const MODEL = 'gemini-2.5-flash-image'

// Logo Dana "Principal Horizontal" (midia kit) pra usar como referencia em image-to-image
const LOGO_DANA_URL = 'https://comlppiwzniskjbeneos.supabase.co/storage/v1/object/public/kanban/brandkit-logo-1776433663865-vn4wml.png'

// Palavras-chave que indicam que o prompt eh sobre roupa Dana (jaleco/scrub/uniforme)
const ROUPA_KEYWORDS = /\b(lab\s*coat|jaleco|scrub|uniform|medical\s*coat|labcoat|doctor|dentist|nurse|healthcare\s+professional|medical\s+professional|white\s+coat)\b/i
// Frases que indicam EXPLICITAMENTE que NAO e roupa medica (sobrescreve a detecao acima)
const NAO_ROUPA = /\bNO\s+(medical\s+)?(lab\s*coat|scrubs|stethoscope|healthcare\s+uniform)\b|\bNOT\s+a\s+(doctor|nurse|healthcare)\b/i

async function fetchImagemBase64(url: string): Promise<{ mime: string; b64: string } | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) { console.warn('[logo] fetch falhou', r.status); return null }
    const mime = r.headers.get('content-type') || 'image/png'
    const buf = new Uint8Array(await r.arrayBuffer())
    let bin = ''
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i])
    return { mime, b64: btoa(bin) }
  } catch (e) {
    console.warn('[logo] fetch erro', e)
    return null
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, apikey, Content-Type',
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  try {
    // ── 1. Auth ──
    const authHeader = req.headers.get('Authorization') || ''
    const jwt = authHeader.replace(/^Bearer /, '')
    if (!jwt) return json({ error: 'Autenticação obrigatória' }, 401)

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: uerr } = await userClient.auth.getUser(jwt)
    if (uerr || !user) return json({ error: 'JWT inválido' }, 401)
    const userId = user.id

    const { data: profile } = await admin.from('profiles').select('nome, cargo').eq('id', userId).single()
    const ehAdmin = profile?.cargo === 'admin'
    const userNome = profile?.nome || user.email
    const userCargo = profile?.cargo || 'desconhecido'

    // ── 2. Permissão por cargo ──
    const { data: perm } = await admin.from('cargo_permissoes').select('permitido').eq('cargo', userCargo).eq('secao', 'avatares_ia_gerar').maybeSingle()
    if (!ehAdmin && !perm?.permitido) {
      return json({ error: 'Seu cargo não tem permissão para gerar avatares IA.' }, 403)
    }

    // ── 3. Config global ──
    const { data: cfg } = await admin.from('avatares_ia_config').select('*').eq('id', 1).single()
    if (!cfg?.ativo) {
      return json({ error: 'Geração de avatares IA desativada. Fale com o admin.' }, 503)
    }

    // ── 4. Kill-switch mensal ──
    const { data: gastoMesData } = await admin.rpc('avatares_ia_gasto_mes')
    const gastoMes = Number(gastoMesData || 0)
    if (gastoMes >= Number(cfg.limite_mensal_reais || 50)) {
      if (!cfg.pausado_por_limite) {
        await admin.from('avatares_ia_config').update({
          pausado_por_limite: true,
          pausado_em: new Date().toISOString(),
        }).eq('id', 1)
      }
      await admin.from('avatares_ia_log').insert({
        user_id: userId, user_nome: userNome, user_cargo: userCargo,
        contexto: 'bloqueado', contexto_ref_id: null,
        prompt: '(kill-switch)', url: null,
        status: 'bloqueado_killswitch',
        erro_msg: `Limite mensal atingido: R$ ${gastoMes.toFixed(2)}`,
      })
      return json({
        error: `Limite mensal de R$ ${Number(cfg.limite_mensal_reais).toFixed(2)} atingido (gasto atual: R$ ${gastoMes.toFixed(2)}). Fale com o admin pra liberar.`,
      }, 429)
    }

    // ── 5. Body ──
    const body = await req.json().catch(() => ({}))
    const prompt: string = (body.prompt || '').trim()
    const contexto: string = body.contexto || 'outro'
    const contextoRefId: string | null = body.contexto_ref_id || null
    if (!prompt || prompt.length < 20) {
      return json({ error: 'Prompt obrigatório (mínimo 20 caracteres)' }, 400)
    }
    // Limite subido pra 5000 chars (era 2000) — Estudio IA gera prompts ricos com Gemini Vision
    if (prompt.length > 5000) {
      return json({ error: 'Prompt muito longo (máx 5000 caracteres)' }, 400)
    }

    // ── 6. Quota diária ──
    if (!ehAdmin) {
      const { data: countData } = await admin.rpc('avatares_ia_count_hoje', { p_user_id: userId })
      const usadas = Number(countData || 0)
      const limite = Number(cfg.limite_diario_usuario || 5)
      if (usadas >= limite) {
        await admin.from('avatares_ia_log').insert({
          user_id: userId, user_nome: userNome, user_cargo: userCargo,
          contexto, contexto_ref_id: contextoRefId,
          prompt, url: null,
          status: 'bloqueado_quota',
          erro_msg: `Quota diária atingida (${usadas}/${limite})`,
        })
        return json({
          error: `Você atingiu seu limite diário (${limite} imagens). Volta amanhã!`,
          usadas, limite,
        }, 429)
      }
    }

    // ── 7. Enhancer ──
    // Ordem dos parts importa pra Gemini Image:
    //   1) IMAGEM DO PRODUTO REAL (referencia visual exata) — se fornecida
    //   2) LOGO DANA (referencia da marca pra bordado) — quando for roupa
    //   3) TEXTO DO PROMPT (descricao da cena) — sempre
    const imageProdutoUrl: string = body.image_produto_url || ''
    const incluirLogo = body.incluir_logo !== false && ROUPA_KEYWORDS.test(prompt) && !NAO_ROUPA.test(prompt)
    const parts: any[] = []
    let promptFinal = prompt

    // 7a. Imagem do produto (referencia visual exata — game-changer)
    let temImagemProduto = false
    if (imageProdutoUrl) {
      const imgProduto = await fetchImagemBase64(imageProdutoUrl)
      if (imgProduto) {
        parts.push({ inlineData: { mimeType: imgProduto.mime, data: imgProduto.b64 } })
        temImagemProduto = true
        console.log('[gerar-avatar-ia] imagem do produto injetada:', imageProdutoUrl.slice(0, 80))
      } else {
        console.warn('[gerar-avatar-ia] fetch da imagem do produto falhou:', imageProdutoUrl.slice(0, 80))
      }
    }

    // 7b. Logo Dana (bordado na peca)
    if (incluirLogo) {
      const logo = await fetchImagemBase64(LOGO_DANA_URL)
      if (logo) {
        parts.push({ inlineData: { mimeType: logo.mime, data: logo.b64 } })
        if (temImagemProduto) {
          promptFinal = `CRITICAL: The FIRST image is the EXACT product the model in the scene must wear. Match the color, cut, collar shape, embroidery position, sleeves, length, fabric texture, and ALL details PRECISELY — do not invent variations or substitutions. The garment in your generated image must be VISUALLY IDENTICAL to the FIRST reference image. The SECOND image is the Dana Jalecos brand logo for tonal embroidery on chest pocket area.\n\n${prompt}\n\nBRAND REQUIREMENT: The lab coat / uniform must have the Dana Jalecos brand logo (shown in the SECOND attached reference image) embroidered subtly on the chest pocket — tonal embroidery (cream/beige on white fabric) preferred. Keep logo recognizable but tasteful.`
        } else {
          promptFinal = prompt + `\n\nBRAND REQUIREMENT: The lab coat / medical uniform / scrub must have the Dana Jalecos brand logo (shown in the attached reference image) embroidered or printed subtly on the chest pocket area. Keep the logo recognizable but integrated tastefully into the garment — tonal embroidery (cream/beige on white fabric) preferred, or small discrete placement. Use the exact logo shape and proportions from the reference.`
        }
      } else if (temImagemProduto) {
        promptFinal = `CRITICAL: The FIRST image is the EXACT product the model in the scene must wear. Match the color, cut, collar shape, embroidery position, sleeves, length, fabric texture, and ALL details PRECISELY — do not invent variations. The garment must be VISUALLY IDENTICAL to the reference image.\n\n${prompt}\n\nBRAND REQUIREMENT: Include a small, elegant embroidered "Dana" wordmark on the chest pocket of the lab coat.`
      } else {
        promptFinal = prompt + `\n\nBRAND REQUIREMENT: Include a small, elegant embroidered brand wordmark "Dana" on the chest pocket of the lab coat / uniform.`
      }
    } else if (temImagemProduto) {
      // Tem imagem do produto mas sem logo (ex: scrub de cozinha, sem branding Dana)
      promptFinal = `CRITICAL: The FIRST image is the EXACT product the model in the scene must wear. Match the color, cut, collar shape, embroidery position, sleeves, length, fabric texture, and ALL details PRECISELY — do not invent variations. The garment must be VISUALLY IDENTICAL to the reference image.\n\n${prompt}`
    }

    parts.push({ text: promptFinal })

    // Aspect ratio: default 1:1, ou '9:16' pra personas (corpo todo vertical), '16:9' pra mockups de campanha
    const aspectRatio = body.aspect_ratio || (contexto === 'persona' ? '9:16' : contexto === 'campanha_interna' ? '16:9' : '1:1')

    // Função pra chamar Gemini com possibilidade de retry
    async function callGemini(partsToSend: any[]): Promise<{ ok: true; base64: string; mime: string } | { ok: false; status: number; body: string; type: 'http' | 'no_image' }> {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_IMAGE_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: partsToSend }],
            generationConfig: {
              responseModalities: ['IMAGE'],
              imageConfig: { aspectRatio },
            },
          }),
        }
      )
      if (!res.ok) {
        return { ok: false, status: res.status, body: (await res.text()).slice(0, 300), type: 'http' }
      }
      const data = await res.json()
      const ret = data?.candidates?.[0]?.content?.parts || []
      const img = ret.find((p: any) => p.inlineData?.data)
      if (!img) {
        return { ok: false, status: 200, body: JSON.stringify(data).slice(0, 500), type: 'no_image' }
      }
      return { ok: true, base64: img.inlineData.data, mime: img.inlineData.mimeType || 'image/png' }
    }

    // 1ª tentativa
    let result = await callGemini(parts)

    // Se falhou por "sem imagem" (não HTTP error), retry com prompt simplificado
    // Isso ajuda quando Gemini se confunde com prompts longos/com muita negação e devolve texto.
    if (!result.ok && result.type === 'no_image') {
      console.warn('[gerar-avatar-ia] retry: Gemini não devolveu imagem, simplificando prompt...')
      // Pega só a 1ª frase + instrução curta de "gerar imagem"
      const firstSentence = (promptFinal || '').split('.')[0].slice(0, 800)
      const simplifiedPrompt = `Generate a clean editorial photograph (no text, no graphics overlays, just photographic scene). ${firstSentence}.`
      const partsRetry = [...parts.slice(0, -1), { text: simplifiedPrompt }]
      result = await callGemini(partsRetry)
    }

    if (!result.ok) {
      console.error(`[gerar-avatar-ia] Gemini ${result.type} erro:`, result.status, result.body)
      await admin.from('avatares_ia_log').insert({
        user_id: userId, user_nome: userNome, user_cargo: userCargo,
        contexto, contexto_ref_id: contextoRefId, prompt, url: null,
        status: 'erro',
        erro_msg: result.type === 'http' ? `Gemini ${result.status}: ${result.body}` : `Sem inlineData no retorno (mesmo após retry)`,
      })
      return json(
        result.type === 'http'
          ? { error: 'Falha ao gerar imagem', detalhe: result.body }
          : { error: 'Gemini não retornou imagem mesmo após retry. Tenta gerar de novo ou ajusta o tema.' },
        500
      )
    }

    const base64 = result.base64
    const mime = result.mime

    // ── 8. Upload pra ImgBB (externo, gratis, link permanente) ──
    const tamanhoBytes = Math.floor(base64.length * 3 / 4)
    const imgbbForm = new FormData()
    imgbbForm.append('image', base64)
    imgbbForm.append('name', `${contexto}-${contextoRefId || 'geral'}-${Date.now()}`)

    let url: string | null = null
    try {
      const imgbbRes = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
        method: 'POST',
        body: imgbbForm,
      })
      const imgbbJson = await imgbbRes.json()
      if (!imgbbRes.ok || !imgbbJson?.data?.url) {
        console.error('[gerar-avatar-ia] ImgBB falhou:', imgbbRes.status, imgbbJson)
        await admin.from('avatares_ia_log').insert({
          user_id: userId, user_nome: userNome, user_cargo: userCargo,
          contexto, contexto_ref_id: contextoRefId, prompt, url: null,
          status: 'erro',
          erro_msg: `ImgBB ${imgbbRes.status}: ${(imgbbJson?.error?.message || JSON.stringify(imgbbJson)).slice(0, 200)}`,
        })
        return json({ error: 'Falha ao hospedar imagem', detalhe: imgbbJson?.error?.message || 'ImgBB upload falhou' }, 500)
      }
      url = imgbbJson.data.url
    } catch (e: any) {
      console.error('[gerar-avatar-ia] ImgBB erro:', e)
      await admin.from('avatares_ia_log').insert({
        user_id: userId, user_nome: userNome, user_cargo: userCargo,
        contexto, contexto_ref_id: contextoRefId, prompt, url: null,
        status: 'erro',
        erro_msg: `ImgBB network: ${String(e.message || e).slice(0, 200)}`,
      })
      return json({ error: 'Falha ao hospedar imagem', detalhe: String(e.message || e) }, 500)
    }

    // ── 9. Log de sucesso ──
    await admin.from('avatares_ia_log').insert({
      user_id: userId, user_nome: userNome, user_cargo: userCargo,
      contexto, contexto_ref_id: contextoRefId,
      prompt, url,
      tamanho_bytes: tamanhoBytes,
      modelo: MODEL,
      custo_estimado_reais: Number(cfg.custo_por_imagem_reais || 0.20),
      status: 'ok',
    })

    const usadasHojeRes = !ehAdmin ? await admin.rpc('avatares_ia_count_hoje', { p_user_id: userId }) : null
    return json({
      url, mime,
      tamanho_bytes: tamanhoBytes,
      custo_estimado: Number(cfg.custo_por_imagem_reais || 0.20),
      gasto_mes_atual: gastoMes + Number(cfg.custo_por_imagem_reais || 0.20),
      quota_hoje: ehAdmin ? null : {
        usadas: Number(usadasHojeRes?.data || 0),
        limite: Number(cfg.limite_diario_usuario || 5),
      },
    })
  } catch (e: any) {
    console.error('[gerar-avatar-ia] fatal:', e)
    return json({ error: 'Erro interno', detalhe: String(e.message || e) }, 500)
  }
})
