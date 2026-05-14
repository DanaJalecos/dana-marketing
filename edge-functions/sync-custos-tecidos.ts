// ══════════════════════════════════════════════════════════════════════════
// Edge Function: sync-custos-tecidos
// (Pedido Manu — 14/05/2026)
//
// Busca ficha_produtos do sistema Tecidos Projeto (Supabase separado)
// e sincroniza com produtos_custos do DMS. Roda diariamente via pg_cron
// + pode ser chamada manualmente por admin.
//
// Não modifica o Tecidos — só lê. Faz UPSERT no DMS.
//
// Uso:
//   POST /functions/v1/sync-custos-tecidos
//   Headers: Authorization: Bearer <jwt> OU x-system-cron: true
//   Body: {} (opcional)
//
// Resposta:
//   { ok, total_lidos, atualizados, novos, removidos, modificados, gerado_em }
// ══════════════════════════════════════════════════════════════════════════

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// Service key do projeto Tecidos (jkvoqqqiwtpsruwoioxl)
const TECIDOS_SERVICE_KEY = Deno.env.get('TECIDOS_SERVICE_KEY')!
const TECIDOS_URL = Deno.env.get('TECIDOS_URL') || 'https://jkvoqqqiwtpsruwoioxl.supabase.co'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-system-cron',
}
const json = (o: any, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  try {
    // ─── Auth: admin OU system cron ───
    const isSystemCron = req.headers.get('x-system-cron') === 'true'
    let userCargo = 'sistema'

    if (!isSystemCron) {
      const authHeader = req.headers.get('Authorization') || ''
      const jwt = authHeader.replace(/^Bearer /, '')
      if (!jwt) return json({ error: 'Autenticação obrigatória' }, 401)

      const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } },
      })
      const { data: userData, error: userErr } = await userClient.auth.getUser(jwt)
      if (userErr || !userData.user) return json({ error: 'JWT inválido' }, 401)

      const { data: profile } = await admin.from('profiles')
        .select('cargo').eq('id', userData.user.id).single()
      userCargo = profile?.cargo || 'vendedor'
      if (!['admin', 'gerente_financeiro', 'gerente_marketing'].includes(userCargo)) {
        return json({ error: 'Sem permissão. Sync de custos é restrito a admin/gerentes.' }, 403)
      }
    }

    // ─── Busca ficha_produtos do Tecidos via REST ───
    console.log('[sync-custos] buscando ficha_produtos do Tecidos...')
    const tecResp = await fetch(
      `${TECIDOS_URL}/rest/v1/ficha_produtos?select=codigo,nome,tipo,custo_total,preco_venda_estimado,total_itens,ativo&ativo=eq.true&limit=1000`,
      {
        headers: {
          'apikey': TECIDOS_SERVICE_KEY,
          'Authorization': `Bearer ${TECIDOS_SERVICE_KEY}`,
        }
      }
    )
    if (!tecResp.ok) {
      const errTxt = await tecResp.text()
      throw new Error(`Tecidos API ${tecResp.status}: ${errTxt.slice(0, 300)}`)
    }
    const fichas: any[] = await tecResp.json()
    console.log(`[sync-custos] ${fichas.length} fichas lidas do Tecidos`)

    if (!fichas.length) {
      return json({ ok: true, total_lidos: 0, atualizados: 0, novos: 0, mensagem: 'Nenhuma ficha no Tecidos' })
    }

    // ─── UPSERT no DMS ───
    // Limpa nome — remove código prefixo + uppercase pra fazer matching melhor
    // ex: "080-SCRUB LOREN" -> nome_ficha "SCRUB LOREN"
    const limparNome = (codigo: string, nome: string) => {
      let limpo = String(nome || codigo).trim()
      // Remove prefixo "080-" / "080 -" / "430-"
      limpo = limpo.replace(/^\d{2,4}\s*[-—]\s*/, '')
      // Remove dupla numeração "522/648 - MACACAO MANGA CURTA"
      limpo = limpo.replace(/^\d{2,4}\/\d{2,4}\s*[-—]\s*/, '')
      return limpo.trim()
    }

    const payload = fichas.map(f => ({
      codigo_ficha: String(f.codigo).trim(),
      nome_ficha: limparNome(f.codigo, f.nome),
      tipo: f.tipo || null,
      custo_total: Number(f.custo_total) || 0,
      preco_venda_estimado: f.preco_venda_estimado != null ? Number(f.preco_venda_estimado) : null,
      total_itens: f.total_itens != null ? Number(f.total_itens) : null,
      sincronizado_em: new Date().toISOString(),
      ativo: !!f.ativo,
    }))

    // Conta o que existe antes
    const { count: countAntes } = await admin.from('produtos_custos').select('*', { count: 'exact', head: true })

    const { error: upsertErr } = await admin
      .from('produtos_custos')
      .upsert(payload, { onConflict: 'codigo_ficha' })

    if (upsertErr) throw upsertErr

    const { count: countDepois } = await admin.from('produtos_custos').select('*', { count: 'exact', head: true })

    // Desativa fichas que sumiram do Tecidos (preservativo — quase nunca rola)
    const codigos = payload.map(p => p.codigo_ficha)
    const { count: desativados } = await admin
      .from('produtos_custos')
      .update({ ativo: false })
      .not('codigo_ficha', 'in', `(${codigos.map(c => `"${c}"`).join(',')})`)
      .eq('ativo', true)
      .select('*', { count: 'exact', head: true })

    return json({
      ok: true,
      total_lidos: fichas.length,
      atualizados: payload.length,
      antes: countAntes || 0,
      depois: countDepois || 0,
      novos: Math.max(0, (countDepois || 0) - (countAntes || 0)),
      desativados: desativados || 0,
      executado_por: isSystemCron ? 'cron' : userCargo,
      gerado_em: new Date().toISOString(),
    })
  } catch (e) {
    console.error('[sync-custos-tecidos] erro:', e)
    return json({ error: (e as Error).message || 'erro interno' }, 500)
  }
})
