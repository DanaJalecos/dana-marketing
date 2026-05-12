// ══════════════════════════════════════════════════════════
// Edge Function: send-email
// Envia email transacional via Resend (resend.com).
// Eventos suportados:
//   - criativo_aprovado / criativo_reprovado → notifica designer
//   - tarefa_atribuida → notifica responsavel
// Beatriz Magnus (gerente_comercial) entra em CC automaticamente
// em todos os eventos relevantes.
//
// Body esperado:
// {
//   evento:     'criativo_aprovado' | 'criativo_reprovado' | 'tarefa_atribuida',
//   para_id:    UUID do destinatario principal (profile.id)
//                — ou para_email diretamente
//   para_email: opcional, sobrescreve para_id
//   recurso_id: id do criativo/tarefa (pra dedupe + deep-link)
//   dados:      jsonb com { titulo, link, comentario?, aprovador?, prazo?, etc }
// }
//
// Variáveis de ambiente:
//   - RESEND_API_KEY (Supabase Secret)
//   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injetadas)
// ══════════════════════════════════════════════════════════

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!

const REMETENTE = 'DMS Dana <onboarding@resend.dev>'  // troca pra noreply@danajalecos.com.br quando DNS estiver configurado
const BEATRIZ_EMAIL = 'comercial@danajalecos.com.br'  // CC fixo (Beatriz Magnus, gerente comercial)
const SITE_URL = 'https://dms.danajalecos.com.br'      // ou o domínio Vercel atual — usado em links deep

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, apikey, Content-Type',
}

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// ─── Helpers REST p/ Supabase (sem SDK, mais leve) ───
async function sbGet(path: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  })
  return r.ok ? r.json() : null
}

async function sbInsert(table: string, row: any) {
  return fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  })
}

// ─── Templates HTML por evento ───
const escapeHtml = (s: string) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function templateBase(titulo: string, badge: string, badgeCor: string, corpo: string, ctaTexto: string, ctaUrl: string) {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>${escapeHtml(titulo)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f3f4f6;padding:30px 16px">
    <tr><td align="center">
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#fff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.04);overflow:hidden">
        <tr><td style="background:#0a0a0a;padding:20px 24px;text-align:left">
          <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:18px;color:#fff;letter-spacing:0.5px">DANA JALECOS</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.6);margin-top:2px">Marketing System</div>
        </td></tr>
        <tr><td style="padding:24px 28px">
          <div style="display:inline-block;padding:4px 10px;background:${badgeCor};color:#fff;border-radius:4px;font-size:10.5px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:14px">${escapeHtml(badge)}</div>
          <h1 style="margin:0 0 12px 0;font-size:20px;color:#0a0a0a;font-weight:700">${escapeHtml(titulo)}</h1>
          ${corpo}
          ${ctaUrl ? `
          <table cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px 0">
            <tr><td style="background:#0a0a0a;border-radius:8px">
              <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:12px 22px;color:#fff;text-decoration:none;font-weight:600;font-size:13.5px">${escapeHtml(ctaTexto)}</a>
            </td></tr>
          </table>` : ''}
        </td></tr>
        <tr><td style="padding:16px 28px;background:#fafafa;border-top:1px solid #eee">
          <div style="font-size:11px;color:#888;line-height:1.5">
            Você está recebendo este email porque está cadastrado no Dana Marketing System.<br>
            Para gerenciar suas notificações, acesse o sistema.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

function renderTemplate(evento: string, dados: any): { assunto: string; html: string } {
  const t = dados?.titulo || '(sem título)'
  const link = dados?.link || SITE_URL
  if (evento === 'criativo_aprovado') {
    const corpo = `
      <p style="margin:0 0 10px 0;font-size:14px;color:#333;line-height:1.55">Olá! Sua arte <strong>${escapeHtml(t)}</strong> acabou de ser <strong style="color:#10b981">aprovada</strong>.</p>
      ${dados?.comentario ? `<div style="margin:14px 0;padding:12px 14px;background:#ecfdf5;border-left:3px solid #10b981;border-radius:6px;font-size:13px;color:#065f46"><strong>Comentário:</strong><br>${escapeHtml(dados.comentario)}</div>` : ''}
      ${dados?.aprovador ? `<p style="margin:8px 0;font-size:12px;color:#666">Aprovado por <strong>${escapeHtml(dados.aprovador)}</strong></p>` : ''}
    `
    return { assunto: `✅ Arte aprovada: ${t}`, html: templateBase('Arte aprovada', '✅ Aprovado', '#10b981', corpo, 'Ver criativo no sistema', link) }
  }
  if (evento === 'criativo_reprovado') {
    const corpo = `
      <p style="margin:0 0 10px 0;font-size:14px;color:#333;line-height:1.55">Sua arte <strong>${escapeHtml(t)}</strong> precisa de ajustes antes de ser aprovada.</p>
      ${dados?.feedback ? `<div style="margin:14px 0;padding:12px 14px;background:#fef2f2;border-left:3px solid #ef4444;border-radius:6px;font-size:13px;color:#7f1d1d"><strong>Feedback:</strong><br>${escapeHtml(dados.feedback)}</div>` : ''}
      ${dados?.aprovador ? `<p style="margin:8px 0;font-size:12px;color:#666">Avaliada por <strong>${escapeHtml(dados.aprovador)}</strong></p>` : ''}
    `
    return { assunto: `❌ Arte reprovada: ${t}`, html: templateBase('Ajustes necessários', '❌ Reprovada', '#ef4444', corpo, 'Ver feedback no sistema', link) }
  }
  if (evento === 'tarefa_atribuida') {
    const prazo = dados?.prazo ? `<p style="margin:8px 0;font-size:13px;color:#333">📅 <strong>Prazo:</strong> ${escapeHtml(dados.prazo)}</p>` : ''
    const prio = dados?.prioridade ? `<p style="margin:8px 0;font-size:13px;color:#333">🎯 <strong>Prioridade:</strong> ${escapeHtml(dados.prioridade)}</p>` : ''
    const corpo = `
      <p style="margin:0 0 10px 0;font-size:14px;color:#333;line-height:1.55">Você foi atribuído a uma nova tarefa: <strong>${escapeHtml(t)}</strong></p>
      ${prazo}${prio}
      ${dados?.descricao ? `<div style="margin:14px 0;padding:12px 14px;background:#f5f5f5;border-radius:6px;font-size:13px;color:#333"><strong>Descrição:</strong><br>${escapeHtml(dados.descricao).slice(0, 400)}</div>` : ''}
      ${dados?.atribuido_por ? `<p style="margin:8px 0;font-size:12px;color:#666">Atribuída por <strong>${escapeHtml(dados.atribuido_por)}</strong></p>` : ''}
    `
    return { assunto: `📋 Nova tarefa: ${t}`, html: templateBase('Nova tarefa atribuída', '📋 Tarefa', '#3b82f6', corpo, 'Abrir no Kanban', link) }
  }
  // fallback genérico
  return {
    assunto: `🔔 ${t}`,
    html: templateBase(t, '🔔 Notificação', '#6b7280', `<p style="font-size:14px;color:#333">${escapeHtml(dados?.mensagem || 'Você tem uma nova notificação no Dana Marketing System.')}</p>`, 'Abrir sistema', link),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)

  try {
    if (!RESEND_API_KEY) return json({ ok: false, error: 'RESEND_API_KEY missing' }, 500)

    const body = await req.json()
    const { evento, para_id, para_email, recurso_id, dados } = body || {}
    if (!evento) return json({ ok: false, error: 'evento obrigatório' }, 400)

    // Resolve email do destinatário
    let destEmail = para_email
    if (!destEmail && para_id) {
      // Pega da auth.users (não direto via profiles, profiles não tem email)
      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${para_id}`, {
        headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
      })
      if (userRes.ok) {
        const u = await userRes.json()
        destEmail = u?.email
      }
    }
    if (!destEmail) return json({ ok: false, error: 'destinatário sem email' }, 400)

    // Dedupe: já mandou esse evento+recurso pra esse destinatário nos últimos 2 min?
    if (recurso_id) {
      const recentes = await sbGet(`email_log?evento=eq.${encodeURIComponent(evento)}&recurso_id=eq.${encodeURIComponent(recurso_id)}&destinatario=eq.${encodeURIComponent(destEmail)}&created_at=gt.${new Date(Date.now() - 2 * 60 * 1000).toISOString()}&select=id`)
      if (recentes && Array.isArray(recentes) && recentes.length > 0) {
        await sbInsert('email_log', { evento, destinatario: destEmail, cc: [BEATRIZ_EMAIL], assunto: '(dup)', recurso_id, status: 'pulado', payload: { motivo: 'dedupe_2min' } })
        return json({ ok: true, status: 'pulado_dedupe' })
      }
    }

    const { assunto, html } = renderTemplate(evento, dados || {})
    const ccList = destEmail.toLowerCase() === BEATRIZ_EMAIL.toLowerCase() ? [] : [BEATRIZ_EMAIL]

    // Envia via Resend
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: REMETENTE,
        to: [destEmail],
        cc: ccList,
        subject: assunto,
        html,
      }),
    })

    const resendBody = await resendRes.json().catch(() => ({}))
    const sucesso = resendRes.ok && resendBody?.id

    await sbInsert('email_log', {
      evento,
      destinatario: destEmail,
      cc: ccList,
      assunto,
      recurso_id: recurso_id || null,
      status: sucesso ? 'enviado' : 'falhou',
      resend_id: resendBody?.id || null,
      erro: sucesso ? null : (resendBody?.message || JSON.stringify(resendBody).slice(0, 500)),
      payload: { dados, from: REMETENTE, to: destEmail, cc: ccList },
    })

    if (!sucesso) return json({ ok: false, error: resendBody?.message || 'Resend error', resend: resendBody }, 502)

    return json({ ok: true, resend_id: resendBody.id, to: destEmail, cc: ccList })
  } catch (e: any) {
    console.error('send-email error:', e)
    return json({ ok: false, error: e?.message || String(e) }, 500)
  }
})
