// ══════════════════════════════════════════════════════════════
// Edge: gerar-credito-influenciador
//
// Resgate da comissão acumulada do influenciador → gera um código
// de crédito (CRED-{slug}-{seq}) que o admin cadastra no Bling 1×.
// Espelha o padrão de gerar-cupom-aniversario.ts.
//
// Body: { influenciador_id: "<uuid>", valor?: number }
//   - valor opcional; default = saldo_disponivel inteiro do painel
// Auth: admin/gerente OU o próprio influenciador (profile_id == uid)
// ══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, apikey, Content-Type, X-Client-Info',
}
function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}
function slug(nome: string): string {
  return (nome || 'INF').trim().split(/\s+/)[0]
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'INF'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  try {
    const body = await req.json().catch(() => ({})) as any
    const influId = String(body.influenciador_id || '')
    if (!influId) return json({ error: 'influenciador_id obrigatório' }, 400)

    // Auth do caller
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '')
    if (!token || token === SUPABASE_ANON_KEY) return json({ error: 'auth obrigatória' }, 401)
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    })
    const { data: u } = await userClient.auth.getUser()
    const uid = u?.user?.id
    if (!uid) return json({ error: 'JWT inválido' }, 401)
    const { data: prof } = await admin.from('profiles').select('cargo').eq('id', uid).maybeSingle()
    const ehAdmin = ['admin', 'gerente_comercial', 'gerente_marketing'].includes(prof?.cargo || '')

    // Busca influenciador + checa permissão (admin OU dono)
    const { data: influ } = await admin
      .from('influenciadores')
      .select('id, nome, profile_id')
      .eq('id', influId)
      .maybeSingle()
    if (!influ) return json({ error: 'influenciador_nao_encontrado' }, 404)
    if (!ehAdmin && influ.profile_id !== uid) return json({ error: 'sem_permissao' }, 403)

    // Painel → saldo disponível
    const { data: pnl, error: ep } = await admin.rpc('influenciador_painel', { p_id: influId })
    if (ep) throw ep
    const painel = Array.isArray(pnl) ? pnl[0] : pnl
    const saldo = Number(painel?.saldo_disponivel || 0)

    let valor = Number(body.valor)
    if (!valor || valor <= 0) valor = Math.floor(saldo)        // default: saldo inteiro
    if (valor <= 0) return json({ error: 'sem_saldo', saldo }, 400)
    if (valor > saldo + 0.01) return json({ error: 'valor_acima_do_saldo', saldo }, 400)

    // Código único CRED-{slug}-{seq}
    const base = `CRED-${slug(influ.nome)}`
    let codigo = ''
    for (let i = 0; i < 6; i++) {
      const cand = `${base}-${String(Date.now()).slice(-5)}${i || ''}`
      const { data: ex } = await admin.from('influenciador_creditos').select('id').eq('codigo', cand).maybeSingle()
      if (!ex) { codigo = cand; break }
    }
    if (!codigo) codigo = `${base}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`

    const { data: novo, error: ei } = await admin
      .from('influenciador_creditos')
      .insert({ influenciador_id: influId, codigo, valor, status: 'gerado', gerado_por: uid })
      .select()
      .single()
    if (ei) throw ei

    return json({
      ok: true,
      credito: novo,
      mensagem: `Crédito de R$ ${valor.toFixed(2)} gerado. Código: ${codigo}. ` +
                `Cadastre esse cupom no Bling/Magazord (valor fixo R$ ${valor.toFixed(2)}) e marque como "cadastrado no Bling".`,
    })
  } catch (e: any) {
    console.error('[gerar-credito-influenciador]', e)
    return json({ error: e.message || String(e) }, 500)
  }
})
