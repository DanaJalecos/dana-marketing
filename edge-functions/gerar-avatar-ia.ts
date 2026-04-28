// ============================================================
// gerar-avatar-ia — gera imagem via Gemini 2.5 Flash Image (paid)
// Custo ~R$ 0,20/imagem. Admin ilimitado. Outros 5/dia.
// Kill-switch global se gasto mensal > limite.
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

async function fetchImagemBase64(url: string): Promise<{ mime: string, b64: string } | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) { console.warn('[logo] fetch falhou', r.status); return null }
    const mime = r.headers.get('content-type') || 'image/png'
    const buf = new Uint8Array(await r.arrayBuffer())
    // Encode base64
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
    headers: { 'Content-Type': 'application/json', ...CORS }
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
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: uerr } = await userClient.auth.getUser(jwt)
    if (uerr || !user) return json({ error: 'JWT inválido' }, 401)
    const userId = user.id

    const { data: profile } = await admin.from('profiles').select('nome, cargo').eq('id', userId).single()
    const ehAdmin = profile?.cargo === 'admin'
    const userNome = profile?.nome || user.email
    const userCargo = profile?.cargo || 'desconhecido'

    // ── 2. Permissão por cargo ──
    const { data: perm } = await admin.from('cargo_permissoes')
      .select('permitido').eq('cargo', userCargo).eq('secao', 'avatares_ia_gerar').maybeSingle()
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
      // Marca pausado se ainda não foi
      if (!cfg.pausado_por_limite) {
        await admin.from('avatares_ia_config').update({ pausado_por_limite: true, pausado_em: new Date().toISOString() }).eq('id', 1)
      }
      // Registra tentativa bloqueada
      await admin.from('avatares_ia_log').insert({
        user_id: userId, user_nome: userNome, user_cargo: userCargo,
        contexto: 'bloqueado', contexto_ref_id: null,
        prompt: '(kill-switch)', url: null,
        status: 'bloqueado_killswitch',
        erro_msg: `Limite mensal atingido: R$ ${gastoMes.toFixed(2)}`,
      })
      return json({
        error: `Limite mensal de R$ ${Number(cfg.limite_mensal_reais).toFixed(2)} atingido (gasto atual: R$ ${gastoMes.toFixed(2)}). Fale com o admin pra liberar.`
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
    if (prompt.length > 2000) {
      return json({ error: 'Prompt muito longo (máx 2000 caracteres)' }, 400)
    }

    // ── 6. Quota diária ──
    if (!ehAdmin) {
      const { data: countData } = await admin.rpc('avatares_ia_count_hoje', { p_user_id: userId })
      const usadas = Number(countData || 0)
      const limite = Number(cfg.limite_diario_usuario || 5)
      if (usadas >= limite) {
        await admin.from('avatares_ia_log').insert({
          user_id: userId, user_nome: userNome, user_cargo: userCargo,
          contexto, contexto_ref_id: contextoRefId, prompt, url: null,
          status: 'bloqueado_quota',
          erro_msg: `Quota diária atingida (${usadas}/${limite})`,
        })
        return json({
          error: `Você atingiu seu limite diário (${limite} imagens). Volta amanhã!`,
          usadas, limite
        }, 429)
      }
    }

    // ── 7. Enhancer: injeta logo Dana quando for roupa/uniforme ──
    // Pula se o prompt EXPLICITAMENTE disser que nao e roupa medica (ex: Diretor Gabriel)
    const incluirLogo = body.incluir_logo !== false && ROUPA_KEYWORDS.test(prompt) && !NAO_ROUPA.test(prompt)
    const parts: any[] = []
    let promptFinal = prompt

    if (incluirLogo) {
      const logo = await fetchImagemBase64(LOGO_DANA_URL)
      if (logo) {
        parts.push({ inlineData: { mimeType: logo.mime, data: logo.b64 } })
        promptFinal = prompt + `\n\nBRAND REQUIREMENT: The lab coat / medical uniform / scrub must have the Dana Jalecos brand logo (shown in the attached reference image) embroidered or printed subtly on the chest pocket area. Keep the logo recognizable but integrated tastefully into the garment — tonal embroidery (cream/beige on white fabric) preferred, or small discrete placement. Use the exact logo shape and proportions from the reference.`
      } else {
        // Fallback se nao conseguir baixar a logo: ainda instrui no texto
        promptFinal = prompt + `\n\nBRAND REQUIREMENT: Include a small, elegant embroidered brand wordmark "Dana" on the chest pocket of the lab coat / uniform.`
      }
    }

    parts.push({ text: promptFinal })

    // Aspect ratio: default 1:1, ou '9:16' pra personas (corpo todo vertical), '16:9' pra mockups de campanha
    const aspectRatio = body.aspect_ratio || (contexto === 'persona' ? '9:16' : contexto === 'campanha_interna' ? '16:9' : '1:1')

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_IMAGE_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            responseModalities: ['IMAGE'],
            imageConfig: { aspectRatio }
          }
        })
      }
    )

    if (!geminiRes.ok) {
      const erro = await geminiRes.text()
      console.error('[gerar-avatar-ia] Gemini erro:', geminiRes.status, erro)
      await admin.from('avatares_ia_log').insert({
        user_id: userId, user_nome: userNome, user_cargo: userCargo,
        contexto, contexto_ref_id: contextoRefId, prompt, url: null,
        status: 'erro', erro_msg: `Gemini ${geminiRes.status}: ${erro.slice(0, 200)}`,
      })
      return json({ error: 'Falha ao gerar imagem', detalhe: erro.slice(0, 300) }, 500)
    }

    const geminiData = await geminiRes.json()
    // Localiza a parte inlineData com o PNG
    const partsRet = geminiData?.candidates?.[0]?.content?.parts || []
    const imgPart = partsRet.find((p: any) => p.inlineData?.data)
    if (!imgPart) {
      console.error('[gerar-avatar-ia] sem imagem no retorno', JSON.stringify(geminiData).slice(0, 500))
      await admin.from('avatares_ia_log').insert({
        user_id: userId, user_nome: userNome, user_cargo: userCargo,
        contexto, contexto_ref_id: contextoRefId, prompt, url: null,
        status: 'erro', erro_msg: 'Sem inlineData no retorno do Gemini',
      })
      return json({ error: 'Gemini não retornou imagem. Reformule o prompt.' }, 500)
    }

    const base64: string = imgPart.inlineData.data
    const mime: string = imgPart.inlineData.mimeType || 'image/png'

    // ── 8. Upload pra ImgBB (externo, gratis, link permanente) ──
    const tamanhoBytes = Math.floor((base64.length * 3) / 4) // aproximado
    const imgbbForm = new FormData()
    imgbbForm.append('image', base64)
    imgbbForm.append('name', `${contexto}-${contextoRefId || 'geral'}-${Date.now()}`)

    let url: string | null = null
    try {
      const imgbbRes = await fetch(
        `https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`,
        { method: 'POST', body: imgbbForm }
      )
      const imgbbJson = await imgbbRes.json()
      if (!imgbbRes.ok || !imgbbJson?.data?.url) {
        console.error('[gerar-avatar-ia] ImgBB falhou:', imgbbRes.status, imgbbJson)
        await admin.from('avatares_ia_log').insert({
          user_id: userId, user_nome: userNome, user_cargo: userCargo,
          contexto, contexto_ref_id: contextoRefId, prompt, url: null,
          status: 'erro', erro_msg: `ImgBB ${imgbbRes.status}: ${(imgbbJson?.error?.message || JSON.stringify(imgbbJson)).slice(0, 200)}`,
        })
        return json({ error: 'Falha ao hospedar imagem', detalhe: imgbbJson?.error?.message || 'ImgBB upload falhou' }, 500)
      }
      url = imgbbJson.data.url
    } catch (e: any) {
      console.error('[gerar-avatar-ia] ImgBB erro:', e)
      await admin.from('avatares_ia_log').insert({
        user_id: userId, user_nome: userNome, user_cargo: userCargo,
        contexto, contexto_ref_id: contextoRefId, prompt, url: null,
        status: 'erro', erro_msg: `ImgBB network: ${String(e.message || e).slice(0, 200)}`,
      })
      return json({ error: 'Falha ao hospedar imagem', detalhe: String(e.message || e) }, 500)
    }

    // ── 9. Log de sucesso ──
    await admin.from('avatares_ia_log').insert({
      user_id: userId, user_nome: userNome, user_cargo: userCargo,
      contexto, contexto_ref_id: contextoRefId, prompt, url,
      tamanho_bytes: tamanhoBytes,
      modelo: MODEL,
      custo_estimado_reais: Number(cfg.custo_por_imagem_reais || 0.20),
      status: 'ok',
    })

    // Retorno
    const usadasHojeRes = !ehAdmin ? await admin.rpc('avatares_ia_count_hoje', { p_user_id: userId }) : null
    return json({
      url,
      mime,
      tamanho_bytes: tamanhoBytes,
      custo_estimado: Number(cfg.custo_por_imagem_reais || 0.20),
      gasto_mes_atual: gastoMes + Number(cfg.custo_por_imagem_reais || 0.20),
      quota_hoje: ehAdmin ? null : { usadas: Number(usadasHojeRes?.data || 0), limite: Number(cfg.limite_diario_usuario || 5) },
    })

  } catch (e: any) {
    console.error('[gerar-avatar-ia] fatal:', e)
    return json({ error: 'Erro interno', detalhe: String(e.message || e) }, 500)
  }
})
