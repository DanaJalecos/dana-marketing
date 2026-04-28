// ══════════════════════════════════════════════════════════
// Edge Function: google-suggest
// Proxy CORS para Google Suggest — deployar no Supabase
// Nome: google-suggest
// ══════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  // CORS headers
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, apikey, Content-Type',
      },
    })
  }

  try {
    const url = new URL(req.url)
    const q = url.searchParams.get('q') || ''
    const hl = url.searchParams.get('hl') || 'pt-BR'

    if (!q) {
      return new Response(JSON.stringify({ error: 'Parâmetro q obrigatório' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    const googleUrl = `https://suggestqueries.google.com/complete/search?client=firefox&hl=${encodeURIComponent(hl)}&q=${encodeURIComponent(q)}`
    // Accept-Charset pode influenciar o encoding retornado pelo Google
    const res = await fetch(googleUrl, {
      headers: {
        'Accept-Charset': 'utf-8',
        'User-Agent': 'Mozilla/5.0 (compatible; DanaSuggest/1.0)',
      },
    })

    // Ler como bytes e decodificar com deteccao de encoding
    const bytes = await res.arrayBuffer()

    // 1) Tenta usar o charset do Content-Type se explicito
    const ct = res.headers.get('content-type') || ''
    const m = ct.match(/charset=([^;\s]+)/i)
    let charset = (m ? m[1].trim().toLowerCase() : 'utf-8')

    // 2) Decoda; se sobrar replacement char (U+FFFD), Google mandou em outro
    //    encoding que o decoder UTF-8 nao conseguiu mapear — tenta Latin-1
    let text = new TextDecoder(charset, { fatal: false }).decode(bytes)
    if (text.includes('\uFFFD')) {
      // Latin-1 eh super-conjunto dos primeiros 256 code points, sempre decoda
      const alt = new TextDecoder('iso-8859-1').decode(bytes)
      if (!alt.includes('\uFFFD')) text = alt
    }

    const data = JSON.parse(text)

    // data[0] = query original, data[1] = array de sugestões
    const suggestions = Array.isArray(data) && data[1] ? data[1] : []

    return new Response(JSON.stringify(suggestions), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
})
