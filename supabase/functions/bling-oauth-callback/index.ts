// ════════════════════════════════════════════════════════════════════════════
// bling-oauth-callback — Recebe redirect do Bling com ?code=<x>&state=<MATRIZ|BC>
// Troca code → access_token + refresh_token, salva no Vault via wrapper.
//
// Uso: Juan abre URL de autorização:
//   https://www.bling.com.br/Api/v3/oauth/authorize?
//     response_type=code
//     &client_id=<CLIENT_ID>
//     &state=MATRIZ
//     &redirect_uri=https://wltmiqbhziefusnzmmkt.supabase.co/functions/v1/bling-oauth-callback
//
// Bling autoriza → redireciona → essa edge captura code+state, troca por token,
// salva no Vault, retorna HTML "✓ Autorizado".
//
// 🔒 Preventiva. Necessária só se algum dia o refresh_token expirar (30d sem
// uso) ou Bling revogar acesso. Hoje os tokens estão vivos.
// ════════════════════════════════════════════════════════════════════════════

import { getAdminClient, readClientCreds, Empresa } from '../_shared/bling-oauth.ts';

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8' };

const pageOk = (empresa: string) => `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Bling autorizado</title>
<style>body{font:16px/1.5 system-ui;max-width:480px;margin:80px auto;padding:24px;text-align:center;color:#0a0a0a}
.box{background:#dcfce7;border:1px solid #16a34a;border-radius:12px;padding:24px}
h1{margin:0 0 8px;font-size:20px}small{color:#52525b}</style></head><body>
<div class="box"><h1>✓ Autorizado</h1>
<p>Conta <b>${empresa}</b> conectada ao DMS.</p>
<small>Pode fechar essa aba.</small></div></body></html>`;

const pageErr = (msg: string) => `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Erro</title>
<style>body{font:16px/1.5 system-ui;max-width:480px;margin:80px auto;padding:24px;text-align:center;color:#0a0a0a}
.box{background:#fee2e2;border:1px solid #dc2626;border-radius:12px;padding:24px}
h1{margin:0 0 8px;font-size:20px}code{display:block;background:#0a0a0a;color:#fff;padding:12px;margin:12px 0;border-radius:8px;font-size:13px;word-break:break-all}</style></head><body>
<div class="box"><h1>Erro na autorização</h1>
<code>${msg}</code>
<p>Verifica logs do DMS ou fala com o Juan.</p></div></body></html>`;

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const code = u.searchParams.get('code');
  const state = (u.searchParams.get('state') || '').toLowerCase();
  const error = u.searchParams.get('error');

  if (error) {
    return new Response(pageErr(`Bling retornou erro: ${error}`), { status: 400, headers: HTML_HEADERS });
  }

  if (!code || !state) {
    return new Response(pageErr(`Faltam parâmetros: code=${!!code}, state=${state}`), { status: 400, headers: HTML_HEADERS });
  }

  if (state !== 'matriz' && state !== 'bc') {
    return new Response(pageErr(`State inválido: ${state}. Aceito: MATRIZ ou BC.`), { status: 400, headers: HTML_HEADERS });
  }

  const empresa = state as Empresa;
  const sb = getAdminClient();

  try {
    // 1. Pega client creds do Vault
    const creds = await readClientCreds(sb, empresa);
    const basic = btoa(`${creds.client_id}:${creds.client_secret}`);

    // 2. Monta redirect_uri exatamente igual ao que Bling registrou no app
    const redirectUri = `${u.origin}/functions/v1/bling-oauth-callback`;

    // 3. Troca code por tokens
    const r = await fetch('https://api.bling.com.br/Api/v3/oauth/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': '1.0',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!r.ok) {
      const body = await r.text();
      return new Response(pageErr(`Bling /oauth/token ${r.status}: ${body.slice(0, 200)}`), { status: 502, headers: HTML_HEADERS });
    }

    const tok = await r.json();
    const access = tok.access_token as string;
    const refresh = tok.refresh_token as string;
    const expires_in = Number(tok.expires_in) || 21600;
    const expires_at = new Date(Date.now() + expires_in * 1000).toISOString();

    // 4. Salva via wrapper (Vault + tabela legacy)
    const { error: upErr } = await sb.rpc('bling_token_upsert', {
      p_empresa: empresa,
      p_access: access,
      p_refresh: refresh,
      p_expires_at: expires_at,
    });

    if (upErr) {
      return new Response(pageErr(`Erro ao salvar tokens: ${upErr.message}`), { status: 500, headers: HTML_HEADERS });
    }

    // 5. Loga
    const loja_id = empresa === 'matriz' ? 203536978 : 203550865;
    await sb.from('bling_sync_log').insert({
      tabela: 'oauth_callback',
      loja_id,
      iniciado_em: new Date().toISOString(),
      finalizado_em: new Date().toISOString(),
      status: 'ok',
      qtd_atualizados: 1,
      api_calls: 1,
    });

    return new Response(pageOk(empresa === 'matriz' ? 'Matriz' : 'Balneário Camboriú'), { status: 200, headers: HTML_HEADERS });

  } catch (e) {
    return new Response(pageErr(String((e as Error).message || e).slice(0, 300)), { status: 500, headers: HTML_HEADERS });
  }
});
