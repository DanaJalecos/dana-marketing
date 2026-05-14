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

// PIN Dana — plaquinha em losango com coroa estilizada cortada no centro.
// 2 referencias: PIN isolado (forma+material limpos) + PIN em jaleco bordô ouro (proporção/posição reais).
// Aplicado sempre que tiver jaleco/scrub no prompt (mesma regra que o logo).
const PIN_DANA_URLS = [
  'https://wltmiqbhziefusnzmmkt.supabase.co/storage/v1/object/public/kanban/brandkit-pins/pin-isolado.png',
  'https://wltmiqbhziefusnzmmkt.supabase.co/storage/v1/object/public/kanban/brandkit-pins/pin-jaleco-bordo-ouro.jpg',
]

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

    // ── 7. Enhancer: injeta referencias visuais (produto + logo) ──
    // Pula logo se o prompt EXPLICITAMENTE disser que nao e roupa medica (ex: Diretor Gabriel)
    const incluirLogo = body.incluir_logo !== false && ROUPA_KEYWORDS.test(prompt) && !NAO_ROUPA.test(prompt)
    const parts: any[] = []
    let promptFinal = prompt

    // 7a. PRODUTO REFERENCE (novo): se vier image_produto_url, anexa como referencia visual
    // primaria — Gemini deve usar a roupa exata da imagem (cor, corte, tecido, detalhes)
    let temProdutoRef = false
    if (body.image_produto_url && typeof body.image_produto_url === 'string') {
      const produto = await fetchImagemBase64(body.image_produto_url)
      if (produto) {
        parts.push({ inlineData: { mimeType: produto.mime, data: produto.b64 } })
        temProdutoRef = true
        promptFinal = prompt + `\n\nPRODUCT REFERENCE: The model in this image MUST be wearing the EXACT lab coat / scrub / medical garment shown in the attached product reference image. Match precisely: the color, cut, sleeve length, collar style (V-neck, padre, button-up etc), fabric texture, and any visible details (zippers, pockets, trim). The lab coat in the final image should look like the SAME GARMENT from the product reference — not just similar, but visually identical in cut and color.`
      } else {
        console.warn('[gerar-avatar-ia] produto ref fetch falhou:', body.image_produto_url)
      }
    }

    // 7b. LOGO DANA — DESATIVADO (decisão Juan 14/05):
    // O logo bordado/embroidered no peito esquerdo gerava "Dana Jalecos" cursivo
    // inventado, que poluía a peça. A signature visual da marca é APENAS o pin.
    // Mantemos a variável `temLogoRef = false` pra compatibilidade com o brand block.
    const temLogoRef = false

    // 7c. PIN DANA — plaquinha em losango com coroa estilizada (signature da marca).
    // Aplicado sempre que tem jaleco/scrub. 4 referencias visuais (1 isolada + 3 in-context).
    let temPinRef = false
    let pinsResolvidos: { mime: string, b64: string }[] = []
    if (incluirLogo) {
      for (const url of PIN_DANA_URLS) {
        const p = await fetchImagemBase64(url)
        if (p) pinsResolvidos.push(p)
      }
      if (pinsResolvidos.length > 0) {
        for (const p of pinsResolvidos) {
          parts.push({ inlineData: { mimeType: p.mime, data: p.b64 } })
        }
        temPinRef = true
      }
    }

    // Monta o brand block — APENAS pin (logo bordado foi removido, decisão Juan).
    // Vai ANTES do prompt original pra ganhar prioridade na atenção do Gemini.
    if (temPinRef) {
      // Calcula índices das referências anexadas (1-based)
      let idx = 1
      if (temProdutoRef) idx++
      const pinFirstIdx = idx
      const pinLastIdx = idx + pinsResolvidos.length - 1
      const pinRefDesc = pinsResolvidos.length === 1
        ? `reference image #${pinFirstIdx}`
        : `reference images #${pinFirstIdx}-${pinLastIdx}`

      const brandBlock = `

═══════════════════════════════════════════════════════════════
🚨 CRITICAL DANA JALECOS BRANDING — READ BEFORE GENERATING 🚨
═══════════════════════════════════════════════════════════════

🚫 ABSOLUTE RULE: NO TEXT, NO EMBROIDERY, NO PRINTED LOGO ANYWHERE ON THE GARMENT.
The garment must be COMPLETELY CLEAN of any text, wordmark, monogram, brand name, or embroidered script.

⚠️ IGNORE any text in this prompt that mentions "brand emblem", "brand logo", "embroidered name", "Dana wordmark", "metallic emblem on chest", "cursive script", or similar. The ONLY brand element allowed is the metal pin described below. If the original prompt asks for embroidery or a brand emblem, IGNORE that instruction.

NEGATIVE EXAMPLES (what the final image must NOT contain):
❌ NO "Dana" written in cursive anywhere on the fabric.
❌ NO "Dana Jalecos" wordmark embroidered on the chest.
❌ NO brand name printed, screen-printed, or stitched on any part of the garment.
❌ NO monogram, initials, or text patches.
❌ NO logo on pocket flaps, sleeves, collar, back, or anywhere else.
❌ The garment fabric must be VISUALLY CLEAN — pure color, no graphic elements EXCEPT the single pin.

══ THE ONLY BRAND ELEMENT: METAL PIN BADGE ══
${pinRefDesc.toUpperCase()} SHOW THE PIN. Study them carefully before generating.

WHAT IT IS:
- A real 3D physical METAL PIN BADGE (brooch), pierced through the fabric.
- NOT text. NOT embroidery. NOT a printed graphic. NOT a sticker. NOT a button.
- It is a SOLID METAL PLAQUE with weight, depth, and a metallic reflective surface.

EXACT DESIGN (copy from ${pinRefDesc}):
- Outer shape: DIAMOND / RHOMBUS — a 4-sided square rotated 45° so points face up/down/left/right.
- Center cutout: a stylized CROWN silhouette (3-point classic crown with rounded peaks) is REMOVED from the center of the plaque, creating a window. The fabric color of the garment shows THROUGH this crown-shaped hole.
- Material: polished gold-tone metal (warm yellow/gold finish) for most garments. On white/light fabrics it can also be silver-tone or white enamel with navy crown.
- The metal edge of the diamond has a thin raised border/frame — visible as a darker outline around the diamond shape.
- Size: ~1.5-2cm wide (clearly visible at medium distance, NOT tiny).
- Two visible attachment threads: tiny loops where the pin pierces through the fabric (left and right corners of the diamond).

POSITION — CRITICAL, READ TWICE:
✅ PLACE IT HERE: On the upper RIGHT CHEST area, directly on the FRONT CHEST FABRIC PANEL of the garment. Specifically:
   - Vertically: ~10-15cm below the collar/neckline (chest pocket height).
   - Horizontally: ~6-10cm to the right of the center seam (or zipper) of the garment, on the model's RIGHT chest (viewer's left when model faces camera).
   - Picture a chest pocket area or where a name badge would normally go — that's the spot.

❌ DO NOT PLACE IT HERE:
   - NOT on the shoulder (top of shoulder line).
   - NOT on the sleeve / arm (anywhere below the shoulder seam).
   - NOT on the collar or lapel.
   - NOT centered on the chest (it must be off-center to the right).
   - NOT on the pocket flap below waist height.

SIZE / VISIBILITY:
- Must be clearly recognizable. If the model is shown from waist-up or full-body, the pin should still be sharp and readable as a diamond+crown shape (no blur).
- DO NOT make it microscopic. Slightly larger than expected is better than slightly smaller.

══ FINAL CHECK BEFORE RENDERING ══
1. ✅ Is the garment completely CLEAN of text, wordmarks, embroidered names, or cursive scripts?
   ❌ If there is ANY "Dana", "Jalecos", initials, or text on the fabric → WRONG, remove it.
2. ✅ Is the diamond-shaped metal pin visible on the RIGHT CHEST FABRIC (front panel)?
   ❌ If the pin is on the shoulder, sleeve, collar, or anywhere above the chest line → WRONG, relocate it.
3. ✅ Is the pin clearly a DIAMOND shape (rhombus, points up/down/left/right) with a CROWN cut out in the center?
   ❌ If the pin is round, square (corners up), oval, or has no visible crown cutout → WRONG, redraw it.
4. ✅ Is the pin LARGE ENOUGH to be recognizable (~1.5-2cm wide, not a tiny dot)?

The pin is the ONLY brand element. The fabric must otherwise be completely clean.
═══════════════════════════════════════════════════════════════
`
      // Prepend brand block ao prompt — ganha prioridade de atenção
      promptFinal = brandBlock + '\n\n' + promptFinal
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
