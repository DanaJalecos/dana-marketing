// ══════════════════════════════════════════════════════════════
// Edge Function: send-email-aniversariantes
//
// Roda 1x/dia (cron 08:01 BRT). Agrupa aniversariantes do dia por
// vendedora e envia 1 email consolidado pra cada via Resend.
// CC fixo: Beatriz Magnus.
//
// CONDICIONAL ao flag `email_config.resend_dns_configurado=true`.
// Quando Juan configurar DNS do Resend → `UPDATE email_config SET ...`
// e os emails começam a sair na próxima execução.
// ══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''

const REMETENTE_FALLBACK = 'DMS Dana <onboarding@resend.dev>'
const REMETENTE_OFICIAL = 'DMS Dana <comercial@danajalecos.com.br>'
const BEATRIZ_EMAIL = 'comercial@danajalecos.com.br'
const SITE_URL = 'https://dms.danajalecos.com.br'

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const escapeHtml = (s: string) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const MESES_PT = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro']

function templateEmail(vendedorNome: string, aniversariantes: Array<{ nome: string, contato_id: number, data_nasc: string }>): { assunto: string, html: string } {
  const hoje = new Date()
  const diaStr = `${hoje.getDate()} de ${MESES_PT[hoje.getMonth()]}`
  const qtd = aniversariantes.length
  const assunto = qtd === 1
    ? `🎂 ${aniversariantes[0].nome} faz aniversário hoje!`
    : `🎂 ${qtd} clientes da sua carteira fazem aniversário hoje`

  const linhas = aniversariantes.map(a => {
    const link = `${SITE_URL}/cliente360/clientes?contato=${a.contato_id}`
    return `
      <tr><td style="padding:12px 0;border-bottom:1px solid #f0f0f0">
        <div style="font-size:14.5px;color:#0a0a0a;font-weight:600">🎂 ${escapeHtml(a.nome)}</div>
        <div style="font-size:11.5px;color:#888;margin-top:2px">${escapeHtml(a.data_nasc)}</div>
        <a href="${escapeHtml(link)}" style="display:inline-block;margin-top:6px;font-size:12.5px;color:#7c3aed;text-decoration:none;font-weight:600">→ Gerar cupom e abrir cliente</a>
      </td></tr>`
  }).join('')

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="padding:30px 16px">
    <tr><td align="center">
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06)">
        <tr><td style="background:linear-gradient(135deg,#fb923c,#f97316);padding:24px;text-align:left">
          <div style="font-size:13px;color:rgba(255,255,255,0.85);letter-spacing:0.5px;text-transform:uppercase;font-weight:600">DANA JALECOS · ${escapeHtml(diaStr)}</div>
          <div style="font-size:22px;color:#fff;font-weight:800;margin-top:6px">🎂 Aniversariantes de hoje</div>
        </td></tr>
        <tr><td style="padding:22px 26px">
          <p style="margin:0 0 16px 0;font-size:14.5px;color:#333">Olá <strong>${escapeHtml(vendedorNome)}</strong>! 👋</p>
          <p style="margin:0 0 16px 0;font-size:14px;color:#444;line-height:1.55">
            ${qtd === 1
              ? 'Você tem <strong>1 cliente</strong> aniversariante hoje. Que tal mandar uma mensagem carinhosa com o cupom de 10% off?'
              : `Você tem <strong>${qtd} clientes</strong> aniversariantes hoje. Que tal mandar uma mensagem carinhosa com o cupom de 10% off pra cada um?`
            }
          </p>
          <table cellpadding="0" cellspacing="0" border="0" width="100%">${linhas}</table>
          <div style="margin-top:24px;padding:14px 16px;background:#fefce8;border-left:3px solid #facc15;border-radius:6px;font-size:12.5px;color:#713f12;line-height:1.55">
            💡 <strong>Dica:</strong> abra cada cliente no C360, gere o cupom (3 cliques) e use o botão "Abrir WhatsApp" — a mensagem já vai pronta com nome, código e validade.
          </div>
          <table cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0 0">
            <tr><td style="background:#0a0a0a;border-radius:8px">
              <a href="${escapeHtml(SITE_URL)}/cliente360/clientes" style="display:inline-block;padding:12px 22px;color:#fff;text-decoration:none;font-weight:600;font-size:13.5px">Abrir Meus Clientes 🎁</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:14px 26px;background:#fafafa;border-top:1px solid #eee;font-size:11px;color:#888;line-height:1.5">
          Email automático do DMS · Cupons de aniversário · Dana Jalecos
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`

  return { assunto, html }
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 })
    }
    if (!RESEND_API_KEY) {
      console.warn('[send-email-aniv] RESEND_API_KEY ausente — pulando')
      return Response.json({ ok: false, skipped: 'no_resend_key' })
    }

    // 1. Flag de DNS configurado?
    const { data: cfg } = await admin
      .from('email_config')
      .select('resend_dns_configurado, remetente_default, bcc_default')
      .eq('id', 1)
      .maybeSingle()
    const dnsOk = !!cfg?.resend_dns_configurado

    if (!dnsOk) {
      console.log('[send-email-aniv] DNS não configurado — pulando envio')
      await admin.from('sync_log').insert({
        tabela: 'email-aniversariantes', registros: 0, status: 'ok',
        detalhes: 'pulado · resend_dns_configurado=false'
      })
      return Response.json({ ok: true, skipped: 'dns_not_configured' })
    }

    const remetente = cfg?.remetente_default ? `DMS Dana <${cfg.remetente_default}>` : REMETENTE_OFICIAL

    // 2. Aniversariantes de HOJE agrupados por vendedora
    // Usa RPC aniversariantes_do_mes(NULL, NULL) e filtra dias_ate=0 client-side
    const { data: aniv, error } = await admin.rpc('aniversariantes_do_mes', {
      p_vendedor_id: null, p_mes: null,
    })
    if (error) throw error

    const hoje = (aniv || []).filter((a: any) => a.dias_ate_aniversario === 0 && a.vendedor_profile_id)
    if (hoje.length === 0) {
      await admin.from('sync_log').insert({
        tabela: 'email-aniversariantes', registros: 0, status: 'ok',
        detalhes: 'nenhum aniversariante hoje'
      })
      return Response.json({ ok: true, qtd: 0 })
    }

    // 3. Agrupa por vendedor_profile_id
    const porVendedor: Record<string, { vendedor_nome: string, aniversariantes: any[] }> = {}
    for (const a of hoje) {
      const vid = a.vendedor_profile_id
      if (!porVendedor[vid]) {
        porVendedor[vid] = { vendedor_nome: a.vendedor_nome || 'Vendedora', aniversariantes: [] }
      }
      porVendedor[vid].aniversariantes.push({
        nome: a.contato_nome,
        contato_id: a.contato_id,
        data_nasc: a.data_nascimento,
      })
    }

    // 4. Resolve email de cada vendedora + envia
    let enviados = 0, falhou = 0
    for (const [vendedorId, grupo] of Object.entries(porVendedor)) {
      try {
        // Email vem de auth.users
        const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${vendedorId}`, {
          headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }
        })
        if (!userRes.ok) { falhou++; continue }
        const u = await userRes.json()
        const email = u?.email
        if (!email) { falhou++; continue }

        const { assunto, html } = templateEmail(grupo.vendedor_nome, grupo.aniversariantes)
        const ccList = email.toLowerCase() === BEATRIZ_EMAIL.toLowerCase() ? [] : [BEATRIZ_EMAIL]

        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: remetente, to: [email], cc: ccList, subject: assunto, html })
        })
        const respBody = await r.json().catch(() => ({}))
        const ok = r.ok && respBody?.id

        await admin.from('email_log').insert({
          evento: 'aniversariantes_dia',
          destinatario: email,
          cc: ccList,
          assunto,
          status: ok ? 'enviado' : 'falhou',
          resend_id: respBody?.id || null,
          erro: ok ? null : (respBody?.message || JSON.stringify(respBody).slice(0,500)),
          payload: { qtd: grupo.aniversariantes.length, aniversariantes: grupo.aniversariantes }
        })
        if (ok) enviados++; else falhou++
      } catch (e: any) {
        console.error('[send-email-aniv] erro vendedor=', vendedorId, e)
        falhou++
      }
    }

    await admin.from('sync_log').insert({
      tabela: 'email-aniversariantes',
      registros: enviados,
      status: falhou > 0 ? 'parcial' : 'ok',
      detalhes: `enviados=${enviados} · falhou=${falhou} · vendedores=${Object.keys(porVendedor).length}`
    })

    return Response.json({ ok: true, enviados, falhou, vendedores: Object.keys(porVendedor).length })
  } catch (e: any) {
    console.error('[send-email-aniv]', e)
    await admin.from('sync_log').insert({
      tabela: 'email-aniversariantes', registros: 0, status: 'error',
      erro: e.message || String(e)
    })
    return new Response(JSON.stringify({ error: e.message || String(e) }), { status: 500 })
  }
})
