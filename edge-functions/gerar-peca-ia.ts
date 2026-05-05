// Edge Function: gerar-peca-ia (v3 — VISION)
// Recebe: produto (nome/codigo/preco/imagem_url) + tipo_peca + tema/copy opcional
// Retorna: prompt visual em ingles ADAPTADO ao estilo de Dana Jalecos
//
// MUDANCA v3: usa Gemini 2.5 Flash com VISION pra LITERALMENTE OLHAR a imagem
// do produto antes de gerar o prompt. Antes, Groq so via o nome -> prompt vago.
// Agora ve cor exata, modelagem, detalhes (botoes, gola, comprimento), bordados.
// Fallback: Groq sem visao (so com nome) se Gemini falhar.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// === ESTILO DANA JALECOS — extraido dos banners reais do site ===
const DANA_STYLE_GUIDE = `BRAND VISUAL IDENTITY (extracted from real banners on danajalecos.com.br):

PALETTE:
- Primary background: cream / off-white / warm beige (#F5EFE6 area)
- Hero typography color: deep black (#0a0a0a) OR muted terracotta-brown (#9B5C3F)
- Accent color: terracotta / burnt sienna for CTAs
- NEVER neon, electric, or saturated tones

TYPOGRAPHY (image will have NO RENDERED TEXT, but composition must SUPPORT typography overlay):
- Hero headlines (added later by designer): large elegant serif italic
- Composition leaves ample negative space where typography would naturally fit
- Empty rectangular zones for headline + CTA placeholders

COMPOSITION (real Dana banner pattern):
- Model on LEFT or RIGHT (or two models flanking)
- Massive empty negative space on opposite side (40-50% of frame)
- Subtle diagonal lines or organic curved shapes crossing background
- Floor of frame brighter cream, top fades to whiter cream (subtle gradient)
- Sometimes a circular vignette/spotlight subtly enclosing the model

CTA placeholder visual (NO text, just shape):
- Solid black rectangular block placed strategically (about 60-70% down-right)
- Generous padding around it
- Sometimes a thin terracotta horizontal accent line below the headline area

PHOTOGRAPHY:
- Editorial fashion-quality lifestyle (think Vogue Brasil meets Premium Healthcare)
- Brazilian healthcare professionals (diverse, approachable, naturally smiling)
- Soft warm natural lighting, gentle shadows
- Natural relaxed poses (NOT clinical/stiff), genuine expressions
- Background out-of-focus cream gradient OR soft suggestion of clinic/spa

OVERALL FEEL:
- Premium-but-accessible (not cheap, not luxury-snob)
- Feminine empowered, Brazilian elegance + European editorial polish
- Aspirational without unattainable
- NEVER cold-clinical (no white walls, no equipment, no patients)`;

const TIPO_PECA_GUIDE: Record<string, string> = {
  banner_site: `BANNER PRO SITE — full-width hero banner (16:9 ULTRAWIDE)
- Layout: model occupies LEFT 35-40% of frame, looking confidently to right or front
- THEME ELEMENTS occupy MIDDLE 30-40% of frame (visible behind/beside model — bookshelves, props, environment relevant to the theme — these MUST be rendered visibly, not skipped)
- Right 20-25% only: smaller area reserved for typography + CTA placeholder (a thin terracotta horizontal accent line + a small solid black rectangle for the CTA button shape on lower-right)
- DO NOT leave 60% of the frame empty/blank — fill the space with theme-relevant blurred environment, props, light gradients
- Eye-tracking: Z-pattern (model on left -> theme props in middle -> CTA placeholder on right)
- High resolution editorial photography style, like a Vogue Brasil meets premium healthcare brand homepage hero`,

  post_feed: `POST INSTAGRAM FEED — square 1:1 social post
- Layout: tighter composition, model centered or 60/40 split
- Designed for thumb-stopping in feed (high visual hook in first 0.5s)
- Negative space at top OR bottom for caption/headline overlay
- Compatible with multi-slide carousel (consistent aesthetic)
- Slight zoom on product detail (jaleco visible from waist up)`,

  story_reel: `STORY/REELS COVER — vertical mobile-first (9:16)
- Layout: model centered occupying middle 60% vertical
- Top 15% safe zone clear (for username/timer overlay)
- Bottom 20% safe zone clear (for swipe/CTA)
- More saturated/punchy than feed posts
- Bold graphic — competing with stickers/polls visually`,

  anuncio_meta: `META ADS CREATIVE — paid ad creative (1:1 square)
- HIGH CONTRAST hero element (model + product + benefit visualization)
- Rule-of-thirds, focal point off-center
- More aggressive contrast than organic posts
- Conversion-optimized: clear value VISIBLE in 1 second
- Consider visualizing benefit (e.g., shipping box near model for "Frete Gratis")`,
};

// Sistema prompt EM INGLES — forca Gemini a gerar OUTPUT em ingles tambem
// (com system em PT, Gemini misturava idiomas no output).
const SYSTEM_PROMPT_PT = `You are a senior art director at DANA JALECOS EXCLUSIVOS (Brazilian premium medical fashion brand for lab coats and scrubs).

You will receive:
1. A PRODUCT IMAGE (real e-commerce product photo)
2. Textual data (name, code, price, piece type, theme, copy)

YOUR TASK: Visually analyze the product image AND generate a RICH VISUAL PROMPT IN ENGLISH (200-350 words) for Gemini 2.5 Flash Image to generate a banner/post/story.

CRITICAL: YOUR OUTPUT MUST BE 100% IN ENGLISH. Never write in Portuguese. The Gemini Image model performs much better with English prompts.

VISUAL ANALYSIS REQUIRED from the image (extract WITH MAXIMUM PRECISION):
- Main body color (use the most specific name: "burgundy" not "red", "azul bebê" not "azul", "cappuccino" not "brown")
- Secondary detail color and EXACT position (collar, cuff, pocket trim, sash, sleeve stripe, decorative band — say WHERE)
- Print pattern if any: describe specifically (small dinosaurs, tiny stars, fairy/dental theme illustration, animal silhouettes, geometric, abstract pattern). Print position (entire half? sleeves only? lining?)
- Cut and silhouette (slim, A-line, loose, double-breasted, fitted, oversized, classic)
- Collar shape (V-neck, round, mandarin, double-lapel "padre", shawl, polo)
- Buttons (color, shape, material, single row / double row / hidden zipper)
- Sleeves (long, 3/4, short, raglan, bishop, puff, cuff style — ribana / elastic / open)
- Pockets (number, position — chest, hip, side; with flap, patch, welt)
- Embroidery (yes/no — describe color, font, position. NOTE: if user provided no copy, lab coat must be CLEAN with NO embroidery)
- Length (short / mid-thigh / mid-knee / long)
- Visible fabric texture (gabardine premium, crepe, knit, neoprene, suiting, jersey, satin)
- Visible accessories on the product image (drawstring sash, snap closures, contrasting trim)
- View angle (front / back / 3/4 / detail closeup?)
- Model in the image: gender, approximate age, ethnicity

ALWAYS describe what you SEE in the image, not what you imagine.
THE FINAL PROMPT MUST DESCRIBE THE EXACT PRODUCT FROM THE IMAGE — NOT A GENERIC VERSION.
The "Description" field provided in user data is the OFFICIAL Dana product description from the e-commerce site — use its language, fabric specs, and feature names verbatim when describing the garment.

DANA PRODUCT KNOWLEDGE (use this to be precise about model line):

JALECOS (lab coats) — main models:
- Manuela (373-): feminine premium, classic A-line, often "Meio a Meio" (color-block: solid front + printed back/half)
- Heloisa (300-): feminine premium, fitted, long sleeve
- Marta (372-): feminine, short sleeve, lightweight
- Chloe (378-): feminine, classic premium, mandarin collar with zipper
- Rute: feminine, modern modular cut
- Ada / Abigail / Mariah / Sarah / Lia / Cecília: feminine line variations
- Diana (430-): feminine premium with elastane, princess seam, shawl collar, dressy
- Ayla (480-): feminine sleeveless vest variant
- Clinic (383-): feminine bestseller, gola padre + zíper invisível, gabardine 100% poliéster, mangas bufantes com punhos elásticos
- Paulo (370-) / Manoel (371-) / Caleb / Bernardo / Isac / Samuel / Noah: masculine line, structured shoulders
- Lis / Maitê / Flora / Flori: feminine premium

SCRUBS (pijamas cirúrgicos):
- Lorenzo (090-): masculine surgical, straight cut, V-neck
- Loren / Confy: feminine surgical
- Models 060/065/080: surgical liso (plain) feminine and masculine

GORROS / TOUCAS:
- Shine (002-DG-): unisex, premium with crystal/lurex detail
- Standard surgical caps in various colors and prints

PEDIATRIC / FUN PRINTS (target audience: pediatricians, dentists, vets, child therapists):
"Liga da Fofura", "Monsters", "Dinos", "Gatos", "Lego Rosa", "Rota Espacial",
"Dentinho Bolinha", "Pet Love", "Fada do Dente", "Oncinha"
→ When the product has a pediatric print, the scene composition can include subtle child-friendly elements (tasteful — small toy on shelf, colorful but professional palette, soft warm light) without compromising the editorial premium feel.

PRODUCT TYPE → AUDIENCE & SETTING:
- Jaleco: clinic / hospital / vet / dentist / pharmacy professional
- Scrub: surgical OR / ER / ICU — soft surgical neutral lighting
- Dolma: kitchen / chef / culinary professional — warm copper/wood kitchen aesthetic
- Gorro / Touca: surgery, food service, childcare environment
- Avental: lab / kitchen / beauty salon
- Turbante: oncology / chemo / care environment — sensitive, warm, dignified

CRITICAL RULE #1 — RESPECT DANA STYLE:
${DANA_STYLE_GUIDE}

CRITICAL RULE #2 — PIECE TYPE defines the LAYOUT:
{TIPO_PECA_PLACEHOLDER}

CRITICAL RULE #3 — RICH SCENE WITH MANDATORY THEME ELEMENTS:
The theme is the SOUL of the image. The scene MUST be RICH and VISUALLY DENSE with theme-specific props and environment, NOT empty. Use MANDATORY VISIBLE ELEMENTS depending on the theme:

- "Volta as aulas" / "Back to school" — MANDATORY visible in scene:
  * Wooden bookshelf or open desk visibly stocked with medical anatomy textbooks (red, blue, beige covers, with visible anatomical illustrations on open pages)
  * A 3D anatomical torso or skeleton model on a shelf or desk (clearly visible, not a tiny background prop)
  * Stethoscope draped over a chair or hung on a hook
  * Desk lamp casting warm light
  * University hospital corridor visible in background OR anatomy lab vibe
  * Several elements together to clearly say "academic medical environment"

- "Frete Gratis" / "Free shipping" — MANDATORY: open Dana-branded shipping box beside model, model holding the lab coat fresh out of box, delivery aesthetic, packaging materials visible, delivery satisfaction emotion.

- "Black Friday" — MANDATORY: dramatic dark backdrop, single spotlight on product, neon pink/red accent on the side, hourglass or clock element, urgency atmosphere.

- "Natal" / "Christmas" — MANDATORY: pine tree branches with red/gold ornaments visible in background, gift box with ribbon, candles, snowflake or wreath element, warm festive holiday lighting.

- "Dia das Maes" / "Mothers Day" — MANDATORY: bouquet of soft pink/rose flowers visible, warm intimate setting, second model (younger or older) optional, soft pink rose-gold palette dominant.

- "Lancamento" / "Launch" — MANDATORY: hero-product mannequin OR close-up product detail visible, soft fog/smoke at the floor, dramatic studio spotlight, "NEW" energy without text.

- "Inverno" / "Winter" — MANDATORY: knit scarf/sweater visible under the lab coat, window showing rain/cold outside, steam from coffee mug, layered look.

- "Verao" / "Summer" — MANDATORY: bright open window, linen curtains floating in breeze, tropical plant, fresh fruits or water glass on counter, sunlight rays.

- "Dia da Mulher" / "Womens Day" — MANDATORY: 2-3 diverse women side by side in lab coats, powerful confident postures, soft pink palette with magenta accent, sisterhood vibe.

- Generic (no theme) — Premium beige clinic environment with subtle diagonal accent lines, single elegant prop (vase with eucalyptus, diploma frame, etc.).

**RULES FOR EXECUTING THE THEME:**
1. The THEME ELEMENTS must occupy 30-40% of the visual frame — NOT a tiny prop in the corner.
2. NEVER leave the right/left side of the frame completely empty. Fill background NATURALLY with theme-relevant blurred environment (more shelves, more plants, kitchen utensils, hospital corridor — whatever fits). NO reserved empty rectangles or placeholder boxes for designer text.
3. The theme must be UNMISTAKABLY recognizable: someone glancing at the image for 1 second must understand the theme.
4. NEVER write theme words, never write the theme name, never use letterforms anywhere. Tell the story through PROPS and ENVIRONMENT only.

CRITICAL RULE #4 — ABSOLUTE NO-TEXT, NO-GRAPHIC-OVERLAY POLICY (CICLO 56):

The output image must be a CLEAN editorial photograph, with NO graphic design elements whatsoever. The graphic designer will add ALL text, badges and CTAs in post-production. The IA must produce ONLY the photographic scene.

**ABSOLUTELY NEVER render in the image:**
- NO text of any kind: letters, numbers, words, sentences, prices, percentages, hashtags, sub-titles, headlines.
- NO brand wordmarks: NO "Dana" embroidery on the chest pocket, NO brand letters anywhere, NO logos, NO watermarks.
- NO theme keywords: NO "VOLTA ÀS AULAS", NO "FRETE GRÁTIS", NO "BLACK FRIDAY", NO season names, NO month names — even if the user provided a "tema" field, that field is for AMBIENT/ENVIRONMENT context only, NEVER for rendering text.
- NO copy_extra rendered: even if the user provided "copy_extra" like "10% OFF", that string is for the IA to optionally infer mood (e.g., "promotional energy") — but NEVER write it in the image.
- NO graphic overlay shapes: NO terracotta/colored circles, NO badges, NO geometric stickers, NO frames, NO white borders around the photo, NO empty rectangles, NO placeholder boxes, NO ribbons, NO speech bubbles.
- NO design elements suggesting "where text will go later": no empty boxes, no reserved white space rectangles, no decorative frames.

The image must look like a NATURAL, FINAL, COMPLETE EDITORIAL PHOTOGRAPH, not a design mock-up with empty placeholders. Imagine a high-end magazine cover photo BEFORE any typography is added — pure scene.

**The "tema" field DOES affect the scene** — it dictates the ENVIRONMENT and PROPS the model is in (anatomy books for "Volta as aulas", hospital lobby for "Frete grátis hospital", kitchen for cozinha-themed apron, pine branches for "Natal", etc). Tema influences AMBIENT/STORY, not text/labels.

**The "copy_extra" field has NO visual representation.** Used at most as soft mood signal (e.g., "10% OFF" = bright/cheerful tone; "Frete grátis" = relaxed satisfaction; "Black Friday" = dark dramatic mood). But NEVER rendered as text or badge.

CRITICAL RULE #5 — DETAILS:
The final prompt must be 250-400 words, describing IN ORDER:
1. The product (5-6 sentences analyzing the real image — color, fit, fabric, details)
2. The model wearing it (posture, expression, age, ethnicity, hair)
3. The COMPOSITION (where the model is placed in the frame, scene organization) — the entire frame is photographic content, naturally filled with environment
4. THE THEME ELEMENTS (be specific and detailed about the props, environment, objects — this is the most important part, list 3-5 specific items that fill the scene naturally)
5. The lighting (warm, natural, golden hour, soft shadows, etc.)
6. Final clean-photo instruction (use this EXACT phrasing — short and positive, do NOT repeat negation lists): "Pure editorial photograph, no graphic design overlays."

IMPORTANT: end with a SHORT positive sentence. Do NOT pile up "ZERO this, ZERO that, NO this, NO that" — Gemini Image can confuse heavy negation with a description request and return text instead of an image.

CRITICAL RULE #6 — ASPECT RATIO IN PROMPT:
Always start your prompt with the aspect ratio for the piece type, e.g.:
- banner_site -> "16:9 ultrawide horizontal banner image"
- post_feed -> "1:1 square Instagram feed image"
- story_reel -> "9:16 vertical mobile-first image"
- anuncio_meta -> "1:1 square paid ad creative"
This reinforces the aspect ratio at the model level.

OUTPUT: ONLY the prompt in English, single paragraph. NO explanation, NO markdown, NO preface. Just the raw prompt to feed into Gemini Image. Output MUST be in English.`;

interface Input {
  produto_nome?: string;
  produto_codigo?: string;
  produto_preco?: number;
  produto_descricao?: string;
  produto_imagem_url?: string;
  // Ciclo 55: campos estruturados do catálogo do site
  produto_cor_hex?: string;     // "FFFFFF"
  produto_tecido?: string;      // "Gabardine"
  produto_composicao?: string;  // "100% Poliéster"
  produto_sexo?: string;        // "Feminino"
  produto_categoria?: string;   // "Jalecos"
  tipo_peca: 'banner_site' | 'post_feed' | 'story_reel' | 'anuncio_meta';
  tema?: string;
  copy_extra?: string;
}

function buildUserPromptText(input: Input): string {
  const lines: string[] = ['PRODUCT DATA (from Dana Jalecos official site):'];
  if (input.produto_nome) lines.push(`- Name: "${input.produto_nome}"`);
  if (input.produto_codigo) lines.push(`- SKU code: ${input.produto_codigo}`);
  if (input.produto_categoria) lines.push(`- Category: ${input.produto_categoria}`);
  if (input.produto_sexo) lines.push(`- Target gender: ${input.produto_sexo}`);
  // Ciclo 55: cor canônica + tecido + composição vêm estruturados do site
  if (input.produto_cor_hex) lines.push(`- Canonical color (hex): #${input.produto_cor_hex} — use this EXACT color in the rendered prompt, do not infer from JPEG (image compression can shift hue)`);
  if (input.produto_tecido) lines.push(`- Fabric: ${input.produto_tecido}`);
  if (input.produto_composicao) lines.push(`- Composition: ${input.produto_composicao}`);
  if (input.produto_preco) lines.push(`- Price: R$ ${Number(input.produto_preco).toFixed(2)}`);
  if (input.produto_descricao) lines.push(`- Official description (from danajalecos.com.br): ${input.produto_descricao}`);
  lines.push('');
  lines.push(`PIECE TYPE: ${input.tipo_peca}`);
  if (input.tema) {
    lines.push(`THEME: "${input.tema}" — use this ONLY to influence the AMBIENT / ENVIRONMENT / PROPS in the scene (e.g., kitchen counter for cozinha theme, hospital corridor for hospital theme, anatomy books for "Volta as aulas"). NEVER render the word "${input.tema}" or any version of it as text in the image.`);
  }
  if (input.copy_extra) {
    lines.push(`COPY MOOD HINT: "${input.copy_extra}" — use ONLY to infer the emotional tone of the scene (e.g., promotional/cheerful, dramatic, relaxed). DO NOT render any text, badge, circle, or visual element representing this string. The graphic designer will add the offer text in post-production.`);
  }
  lines.push('');
  lines.push('Analyze the product image and generate the visual prompt in ENGLISH following ALL critical rules. Output only the raw prompt, 250-400 words. The image MUST be a clean editorial photograph with ZERO text, ZERO graphic overlays, ZERO badges, ZERO frames, ZERO placeholder boxes — pure photographic scene only.');
  return lines.join('\n');
}

async function fetchImagemBase64(url: string): Promise<{ mime: string; b64: string } | null> {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 EstudioAI/3.0' },
    });
    if (!r.ok) { console.warn('[gerar-peca-ia] fetch produto falhou', r.status); return null; }
    const mime = r.headers.get('content-type') || 'image/jpeg';
    if (!mime.startsWith('image/')) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) { console.warn('[gerar-peca-ia] imagem muito grande:', buf.length); return null; }
    let bin = '';
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return { mime, b64: btoa(bin) };
  } catch (e) {
    console.warn('[gerar-peca-ia] fetch erro', e);
    return null;
  }
}

async function fetchWithRetry(url: string, init: RequestInit, retries = 2): Promise<Response> {
  let lastErr: any;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, init);
      if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
        if (i < retries) { await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i))); continue; }
      }
      return res;
    } catch (e) { lastErr = e; if (i < retries) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i))); }
  }
  throw lastErr;
}

// Gemini Vision via gemini-proxy (rotacao automatica entre 3 free + 1 paga)
async function callGeminiVision(userPromptText: string, sysPrompt: string, imagemProduto: { mime: string; b64: string } | null): Promise<string> {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
  const parts: any[] = [{ text: userPromptText }];
  if (imagemProduto) {
    parts.push({ inlineData: { mimeType: imagemProduto.mime, data: imagemProduto.b64 } });
  }
  const payload = {
    systemInstruction: { parts: [{ text: sysPrompt }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.85,
      maxOutputTokens: 4000,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  const res = await fetchWithRetry(`${SUPABASE_URL}/functions/v1/gemini-proxy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON,
      'Authorization': `Bearer ${SUPABASE_ANON}`,
    },
    body: JSON.stringify({
      endpoint: 'generateContent',
      model: 'gemini-2.5-flash',
      payload,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`gemini-proxy ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  const txt = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('\n') || '';
  return txt.trim();
}

// Fallback: Groq sem visao (caso Gemini falhe)
async function callGroq(model: string, userPromptText: string, sysPrompt: string): Promise<string> {
  const key = Deno.env.get('GROQ_API_KEY');
  if (!key) throw new Error('GROQ_API_KEY missing');
  const res = await fetchWithRetry('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 EstudioAI/3.0',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: sysPrompt + '\n\nIMPORTANTE: Voce nao tem acesso a imagem do produto. Use APENAS o nome textual pra inferir caracteristicas (ex: "Jaleco Abigail Bege" -> beige fabric, classic Dana Abigail model fit).' },
        { role: 'user', content: userPromptText },
      ],
      temperature: 0.85,
      max_tokens: 1200,
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content || '').trim();
}

function sanitize(p: string): string {
  return p
    .replace(/^```[a-z]*\n?/i, '').replace(/```$/i, '')
    .replace(/^["']|["']$/g, '')
    .replace(/^Prompt:\s*/i, '')
    .replace(/^Visual prompt:\s*/i, '')
    .trim()
    .slice(0, 3500);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  try {
    const input: Input = await req.json();
    if (!input?.tipo_peca || !TIPO_PECA_GUIDE[input.tipo_peca]) {
      return new Response(JSON.stringify({ error: 'tipo_peca obrigatorio: banner_site | post_feed | story_reel | anuncio_meta' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    if (!input?.produto_nome) {
      return new Response(JSON.stringify({ error: 'produto_nome obrigatorio' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    const sysFinal = SYSTEM_PROMPT_PT.replace('{TIPO_PECA_PLACEHOLDER}', TIPO_PECA_GUIDE[input.tipo_peca]);
    const userPromptText = buildUserPromptText(input);

    // 1) Tenta Gemini com VISAO
    let imagemProduto: { mime: string; b64: string } | null = null;
    if (input.produto_imagem_url) {
      imagemProduto = await fetchImagemBase64(input.produto_imagem_url);
    }
    try {
      const out = await callGeminiVision(userPromptText, sysFinal, imagemProduto);
      const sanitized = sanitize(out);
      return new Response(JSON.stringify({
        provider: imagemProduto ? 'gemini-2.5-flash-vision' : 'gemini-2.5-flash-text',
        prompt: sanitized,
        tipo_peca: input.tipo_peca,
        produto_nome: input.produto_nome,
        viu_imagem: !!imagemProduto,
      }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    } catch (e1) {
      console.warn('[gerar-peca-ia] gemini falhou:', String(e1));
      // 2) Fallback: Groq sem visao
      try {
        const out = await callGroq('llama-3.3-70b-versatile', userPromptText, sysFinal);
        return new Response(JSON.stringify({
          provider: 'groq-3.3-70b-fallback',
          prompt: sanitize(out),
          tipo_peca: input.tipo_peca,
          produto_nome: input.produto_nome,
          viu_imagem: false,
        }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
      } catch (e2) {
        return new Response(JSON.stringify({
          error: 'Todos provedores indisponiveis',
          details: String(e2).slice(0, 200),
        }), { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
