// ════════════════════════════════════════════════════════════════════════════
// sync-contas-pagar (MATRIZ, loja_id=203536978)
// Refatorado Lote 1 Dia 4 — Vault wrapper + bling_sync_log.
// Aceita ?situacao=1|2|3 (1=aberto, 2=pago, 3=atrasado). Default 1.
// ════════════════════════════════════════════════════════════════════════════

import { getAdminClient, getValidToken } from '../_shared/bling-oauth.ts';
import { blingGet, sleep } from '../_shared/bling-client.ts';
import { drillContas } from '../_shared/contas-drill.ts';

const EMPRESA = 'matriz' as const;
const LOJA_ID = 203536978;

interface BlingContaPagar {
  id: number; situacao?: number; vencimento?: string; valor?: number;
  contato?: { id?: number };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const situacao = parseInt(url.searchParams.get('situacao') || '1');

  const t0 = Date.now();
  const sb = getAdminClient();

  const { data: logRow } = await sb.from('bling_sync_log').insert({
    tabela: 'contas_pagar', loja_id: LOJA_ID, iniciado_em: new Date().toISOString(),
    status: 'rodando', api_calls: 0,
  }).select('id').single();
  const logId = logRow?.id ?? null;

  let totalUpserted = 0;
  let apiCalls = 0;

  try {
    const token = await getValidToken(sb, EMPRESA);
    let pageStart = 1;
    const pageBatch = 3;

    while (pageStart <= 20) {
      const pages = Array.from({ length: pageBatch }, (_, i) => pageStart + i);
      const results = await Promise.all(
        pages.map(p => blingGet<{ data?: BlingContaPagar[] }>(
          token, '/contas/pagar', { pagina: p, limite: 100, situacao }
        ))
      );
      apiCalls += pages.length;

      const todasLinhas: Array<{
        id: number; situacao?: number; vencimento?: string; valor: number; contato_id: number;
      }> = [];
      for (const r of results) {
        if (!r.ok) throw new Error(`bling /contas/pagar status=${r.status}: ${r.errorBody}`);
        const items = r.data?.data ?? [];
        if (items.length) {
          todasLinhas.push(...items.map(c => ({
            id: c.id, situacao: c.situacao, vencimento: c.vencimento,
            valor: c.valor || 0, contato_id: c.contato?.id || 0,
          })));
        }
      }

      if (todasLinhas.length > 0) {
        const { error } = await sb.from('contas_pagar').upsert(todasLinhas, { onConflict: 'id' });
        if (error) throw new Error(`upsert contas_pagar: ${error.message}`);
        totalUpserted += todasLinhas.length;
      }

      // Última página retornou vazio? para
      if (!(results[results.length - 1].data?.data?.length)) break;
      pageStart += pageBatch;
    }

    // Drill /contas/pagar/{id} pra preencher forma_pagamento_id, conta_financeira_id, categoria_id
    // (LIST nao traz). Pega IDs novos/sem drill da empresa.
    const drillDeadline = t0 + 130_000;
    let drillResult = { drilled: 0, deadline_hit: false, api_calls: 0 };
    if (Date.now() < drillDeadline) {
      const { data: pendentes } = await sb.from('contas_pagar')
        .select('id').eq('empresa', EMPRESA).is('forma_pagamento_id', null)
        .in('situacao', [1, 3, 5]).limit(200);
      const ids = (pendentes ?? []).map(r => Number(r.id));
      if (ids.length > 0) {
        drillResult = await drillContas({
          sb, token, tipo: 'pagar', tabela: 'contas_pagar',
          ids, deadline_ms: drillDeadline, empresa: EMPRESA,
        });
        apiCalls += drillResult.api_calls;
      }
    }

    const duracao = Date.now() - t0;
    const duracaoSeg = Math.round(duracao / 1000);

    await sb.from('sync_log').insert({
      tabela: 'contas_pagar', registros: totalUpserted, status: 'ok',
      detalhes: 'sit=' + situacao + ', drill=' + drillResult.drilled + ', ' + duracaoSeg + 's',
    });
    if (logId) {
      await sb.from('bling_sync_log').update({
        finalizado_em: new Date().toISOString(), duracao_ms: duracao,
        qtd_lidos: totalUpserted, qtd_atualizados: totalUpserted,
        status: 'ok', api_calls: apiCalls,
        erro_msg: 'situacao=' + situacao,  // metadata informativa
      }).eq('id', logId);
    }
    return new Response(JSON.stringify({
      ok: true, tabela: 'contas_pagar', empresa: EMPRESA, situacao,
      registros: totalUpserted, duracao_seg: duracaoSeg,
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (e) {
    const msg = String((e as Error).message || e).slice(0, 500);
    const isAuth = msg.includes('401') || msg.includes('invalid_grant');
    const isRate = msg.includes('429') || msg.includes('rate_limit');
    await sb.from('sync_log').insert({
      tabela: 'contas_pagar', registros: totalUpserted, status: 'error',
      erro: msg, detalhes: 'sit=' + situacao,
    });
    if (logId) {
      await sb.from('bling_sync_log').update({
        finalizado_em: new Date().toISOString(), duracao_ms: Date.now() - t0,
        qtd_lidos: totalUpserted, status: isRate ? 'rate_limited' : 'erro',
        erro_tipo: isAuth ? 'auth' : isRate ? 'rate_limit' : 'http_5xx',
        erro_msg: msg, api_calls: apiCalls,
      }).eq('id', logId);
    }
    return new Response(JSON.stringify({ error: msg, situacao }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
