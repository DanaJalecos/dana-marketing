// ════════════════════════════════════════════════════════════════════════════
// bling-token-refresh — Refresh proativo de tokens Bling Matriz + BC
// Cron 5h (Bling expira em 6h → 1h margem). Atualiza Vault via bling_token_upsert.
// Loga em bling_sync_log com tabela='oauth_refresh'.
// ════════════════════════════════════════════════════════════════════════════

import { getAdminClient, readTokens, refreshToken, Empresa } from '../_shared/bling-oauth.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, apikey, Content-Type, x-cron-secret',
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

const LOJAS: { empresa: Empresa; loja_id: number }[] = [
  { empresa: 'matriz', loja_id: 203536978 },
  { empresa: 'bc',     loja_id: 203550865 },
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const sb = getAdminClient();
  const resultados: Record<string, unknown>[] = [];

  for (const { empresa, loja_id } of LOJAS) {
    // 1. Abre log
    const t0 = Date.now();
    const { data: logRow, error: logErr } = await sb
      .from('bling_sync_log')
      .insert({
        tabela: 'oauth_refresh',
        loja_id,
        iniciado_em: new Date().toISOString(),
        status: 'rodando',
        api_calls: 0,
      })
      .select('id')
      .single();

    if (logErr) {
      resultados.push({ empresa, status: 'erro', erro: `log_open: ${logErr.message}` });
      continue;
    }
    const logId = logRow.id;

    // 2. Refresh
    try {
      const tokens = await readTokens(sb, empresa);
      const refreshed = await refreshToken(sb, empresa, tokens.refresh_token);

      await sb.from('bling_sync_log').update({
        finalizado_em: new Date().toISOString(),
        duracao_ms: Date.now() - t0,
        status: 'ok',
        qtd_atualizados: 1, // 1 par de tokens atualizado
        api_calls: 1,       // 1 chamada Bling (POST /oauth/token)
      }).eq('id', logId);

      resultados.push({
        empresa,
        loja_id,
        status: 'ok',
        expires_at: refreshed.expires_at,
        duracao_ms: Date.now() - t0,
      });
    } catch (e) {
      const msg = String((e as Error).message || e).slice(0, 500);
      const isAuth = msg.includes('400') || msg.includes('401') || msg.includes('invalid_grant');
      await sb.from('bling_sync_log').update({
        finalizado_em: new Date().toISOString(),
        duracao_ms: Date.now() - t0,
        status: 'erro',
        erro_tipo: isAuth ? 'auth' : 'http_5xx',
        erro_msg: msg,
        api_calls: 1,
      }).eq('id', logId);

      resultados.push({ empresa, loja_id, status: 'erro', erro: msg });
    }
  }

  const hasError = resultados.some(r => r.status === 'erro');
  return json({ ok: !hasError, resultados }, hasError ? 207 : 200);
});
