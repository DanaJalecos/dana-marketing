// ════════════════════════════════════════════════════════════════════════════
// sync-contatos (MATRIZ, loja_id=203536978).
// ════════════════════════════════════════════════════════════════════════════

import { getAdminClient, getValidToken } from '../_shared/bling-oauth.ts';
import { blingGet, sleep } from '../_shared/bling-client.ts';

const EMPRESA = 'matriz' as const;
const LOJA_ID = 203536978;

interface BlingContato {
  id: number; nome?: string; codigo?: string; situacao?: string;
  tipoPessoa?: string; tipo?: string; numeroDocumento?: string;
  telefone?: string; celular?: string;
}

Deno.serve(async () => {
  const t0 = Date.now();
  const sb = getAdminClient();
  const { data: logRow } = await sb.from('bling_sync_log').insert({
    tabela: 'contatos', loja_id: LOJA_ID, iniciado_em: new Date().toISOString(),
    status: 'rodando', api_calls: 0,
  }).select('id').single();
  const logId = logRow?.id ?? null;

  let totalUpserted = 0, apiCalls = 0;
  try {
    const token = await getValidToken(sb, EMPRESA);
    for (let page = 1; page <= 10; page++) {
      const r = await blingGet<{ data?: BlingContato[] }>(
        token, '/contatos', { pagina: page, limite: 100 });
      apiCalls++;
      if (!r.ok) throw new Error(`bling /contatos status=${r.status}: ${r.errorBody}`);
      const items = r.data?.data ?? [];
      if (!items.length) break;
      const rows = items.map(c => ({
        id: c.id, nome: c.nome || '', codigo: c.codigo || '',
        situacao: c.situacao || '', tipo_pessoa: c.tipoPessoa || c.tipo || '',
        numero_documento: c.numeroDocumento || '',
        telefone: c.telefone || '', celular: c.celular || '',
      }));
      const { error } = await sb.from('contatos').upsert(rows, { onConflict: 'id' });
      if (error) throw new Error(`upsert: ${error.message}`);
      totalUpserted += rows.length;
      await sleep(300);
    }
    const dur = Date.now() - t0;
    await sb.from('sync_log').insert({ tabela: 'contatos', registros: totalUpserted, status: 'ok', detalhes: Math.round(dur / 1000) + 's' });
    if (logId) await sb.from('bling_sync_log').update({
      finalizado_em: new Date().toISOString(), duracao_ms: dur,
      qtd_lidos: totalUpserted, qtd_atualizados: totalUpserted, status: 'ok', api_calls: apiCalls,
    }).eq('id', logId);
    return new Response(JSON.stringify({ ok: true, empresa: EMPRESA, registros: totalUpserted, duracao_seg: Math.round(dur / 1000) }),
      { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    const msg = String((e as Error).message || e).slice(0, 500);
    const isAuth = msg.includes('401') || msg.includes('invalid_grant');
    const isRate = msg.includes('429') || msg.includes('rate_limit');
    await sb.from('sync_log').insert({ tabela: 'contatos', registros: totalUpserted, status: 'error', erro: msg });
    if (logId) await sb.from('bling_sync_log').update({
      finalizado_em: new Date().toISOString(), duracao_ms: Date.now() - t0,
      qtd_lidos: totalUpserted, status: isRate ? 'rate_limited' : 'erro',
      erro_tipo: isAuth ? 'auth' : isRate ? 'rate_limit' : 'http_5xx',
      erro_msg: msg, api_calls: apiCalls,
    }).eq('id', logId);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
