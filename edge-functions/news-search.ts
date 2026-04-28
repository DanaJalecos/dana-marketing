// ══════════════════════════════════════════════════════════
// Edge Function: news-search (v10 — Google News RSS, sem limites, sem API key)
// ══════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, apikey, Content-Type' },
    })
  }

  try {
    const queries = [
      'jaleco OR vestuario OR textil OR varejo moda',
      'confeccao OR enfermagem OR uniforme OR moda',
      'varejo roupa OR industria textil OR vestuario',
      'jaleco OR uniforme OR textil OR moda Brasil',
      'enfermagem OR confeccao OR vestuario OR roupa',
      'saude profissional OR hospital uniforme',
      'moda sustentavel OR textil inovacao',
      'ecommerce moda OR varejo digital roupa',
    ]

    const query = queries[Math.floor(Math.random() * queries.length)]
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`
    const rssRes = await fetch(rssUrl, { signal: AbortSignal.timeout(8000) })
    const xml = await rssRes.text()

    const allNews: any[] = []
    const itemRegex = /<item>([\s\S]*?)<\/item>/g
    let match
    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1]
      const title = clean(extract(block, 'title'))
      const source = clean(extractSrc(block))
      const pubDate = extract(block, 'pubDate')

      let link = ''
      const linkM = block.match(/<link[^>]*>(https?:\/\/[^<\s]+)/s)
        || block.match(/<link\/>\s*(https?:\/\/\S+)/s)
      if (linkM) link = linkM[1].trim()

      if (title && title.length > 15 && source) {
        let cat = 'mercado'
        const t = title.toLowerCase()
        if (/moda|roupa|estilo|design|feminino|masculino|tendência|cor /.test(t)) cat = 'moda'
        else if (/saúde|saude|hospital|enferm|médic|medic|clínic|odonto|paciente/.test(t)) cat = 'saude'
        else if (/tendên|sustentab|inovaç|tecnolog|futuro|digital/.test(t)) cat = 'tendencia'
        else if (/marketing|influenc|instagram|tiktok|rede social|conteúdo/.test(t)) cat = 'social'

        allNews.push({ title, url: link, source, cat, time: pubDate ? ago(new Date(pubDate)) : 'Recente', impact: Math.random() > 0.4 ? 'alto' : 'medio' })
      }
    }

    // Remover duplicatas e embaralhar
    const seen = new Set()
    const unique = allNews.filter(n => {
      const k = n.title.substring(0, 35).toLowerCase()
      if (seen.has(k)) return false
      seen.add(k)
      return true
    }).sort(() => Math.random() - 0.5).slice(0, 10)

    return new Response(JSON.stringify({ news: unique, total: unique.length }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message, news: [] }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
})

function extract(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))
  return m ? m[1].trim() : ''
}
function extractSrc(xml: string): string {
  const m = xml.match(/<source[^>]*>([\s\S]*?)<\/source>/)
  return m ? m[1].trim() : ''
}
function clean(t: string): string {
  return t.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<[^>]+>/g, '').trim()
}
function ago(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000)
  if (s < 3600) return Math.floor(s / 60) + ' min'
  if (s < 86400) return Math.floor(s / 3600) + 'h atrás'
  if (s < 604800) return Math.floor(s / 86400) + 'd atrás'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}
