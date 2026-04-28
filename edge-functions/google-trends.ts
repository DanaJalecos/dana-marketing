// ══════════════════════════════════════════════════════════
// Edge Function: google-trends
// Busca dados de tendência do Google Trends — deployar no Supabase
// Nome: google-trends
// ══════════════════════════════════════════════════════════

Deno.serve(async (req) => {
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
    const geo = url.searchParams.get('geo') || 'BR'
    const hl = url.searchParams.get('hl') || 'pt-BR'

    if (!q) {
      return new Response(JSON.stringify({ error: 'Parâmetro q obrigatório' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    // 1. Buscar related queries do Google Trends
    // O Google Trends usa uma API interna que retorna JSON com prefixo ")]}'"
    const trendsUrl = `https://trends.google.com/trends/api/widgetdata/relatedsearches?hl=${hl}&tz=180&req=${encodeURIComponent(JSON.stringify({
      restriction: {
        geo: { country: geo },
        time: 'today 12-m',
        originalTimeRangeForExploreUrl: 'today 12-m',
      },
      keywordType: 'QUERY',
      metric: ['TOP', 'RISING'],
      trendinessSettings: { compareTime: '2024-04-15 2025-04-15' },
      requestOptions: { property: '', backend: 'IZG', category: 0 },
      language: hl.split('-')[0],
      userCountryCode: geo,
    }))}&token=ignored`

    // Fallback: usar o endpoint de autocomplete com trending
    const suggestUrl = `https://trends.google.com/trends/api/autocomplete/${encodeURIComponent(q)}?hl=${hl}&tz=180&geo=${geo}`

    let trendingData: any = null

    // Tentar autocomplete de trends (mais simples e confiável)
    try {
      const acRes = await fetch(suggestUrl)
      const acText = await acRes.text()
      // Remove prefixo ")]}'" do Google
      const cleanText = acText.replace(/^\)\]\}\'/, '').trim()
      if (cleanText) {
        trendingData = JSON.parse(cleanText)
      }
    } catch {}

    // 2. Buscar interesse ao longo do tempo para o termo principal
    const interestUrl = `https://trends.google.com/trends/api/explore?hl=${hl}&tz=180&req=${encodeURIComponent(JSON.stringify({
      comparisonItem: [{ keyword: q, geo, time: 'today 3-m' }],
      category: 0,
      property: '',
    }))}`

    let interestData: any = null
    try {
      const intRes = await fetch(interestUrl)
      const intText = await intRes.text()
      const cleanInt = intText.replace(/^\)\]\}\'/, '').trim()
      if (cleanInt) {
        interestData = JSON.parse(cleanInt)
      }
    } catch {}

    // 3. Buscar daily trends do Brasil
    const dailyUrl = `https://trends.google.com/trends/api/dailytrends?hl=${hl}&tz=180&geo=${geo}&ns=15`
    let dailyTrends: string[] = []
    try {
      const dailyRes = await fetch(dailyUrl)
      const dailyText = await dailyRes.text()
      const cleanDaily = dailyText.replace(/^\)\]\}\'/, '').trim()
      if (cleanDaily) {
        const dailyJson = JSON.parse(cleanDaily)
        const searches = dailyJson?.default?.trendingSearchesDays?.[0]?.trendingSearches || []
        dailyTrends = searches.map((s: any) => ({
          title: s.title?.query || '',
          traffic: s.formattedTraffic || '',
          related: (s.relatedQueries || []).map((r: any) => r.query),
        })).slice(0, 10)
      }
    } catch {}

    return new Response(JSON.stringify({
      keyword: q,
      autocomplete: trendingData,
      interest: interestData,
      dailyTrends,
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=1800',
      },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
})
