// ════════════════════════════════════════════════════════════════════════════
// sync-contas-receber-bc (BC, loja_id=203550865).
// ════════════════════════════════════════════════════════════════════════════

import { getAdminClient, getValidToken } from '../_shared/bling-oauth.ts';
import { blingGet } from '../_shared/bling-client.ts';
import { drillContas } from '../_shared/contas-drill.ts';

const EMPRESA = 'bc' as const;
const LOJA_ID = 203550865;

interface BlingContaReceber {
  id: number; situacao?: number; vencimento?: string; valor?: number;
  dataEmissao?: string;
  contato?: { nome?: string; tipoPessoa?: string };
  origem?: { tipo?: string; numero?: string };
  contaContabil?: string;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const situacao = parseInt(url.searchParams.get('situacao') || '1');
  const t0 = Date.now();
  const sb = getAdminClient();
  const { data: logRow } = await sb.from('bling_sync_log').insert({
    tabela: 'contas_receber', loja_id: LOJA_ID, iniciado_em: new Date().toISOString(),
    status: 'rodando', api_calls: 0,
  }).select('id').single();
  const logId = logRow?.id ?? null;

  let totalLidos = 0, totalInseridos = 0, totalAtualizados = 0, apiCalls = 0;
  try {
    const token = await getValidToken(sb, EMPRESA);
    let pageStart = 1;
    // FIX msg 19: cap antigo 21 paginas. Subiu pra 300 + deadline.
    const listDeadline = t0 + 110_000;
    while (pageStart <= 300 && Date.now() < listDeadline) {
      const pages = [pageStart, pageStart + 1, pageStart + 2];
      const results = await Promise.all(pages.map(p => blingGet<{ data?: BlingContaReceber[] }>(
        token, '/contas/receber', { pagina: p, limite: 100, situacao })));
      apiCalls += pages.length;
      const todasLinhas = [];
      for (const r of results) {
        if (!r.ok) throw new Error(`bling /contas/receber status=${r.status}: ${r.errorBody}`);
        for (const c of (r.data?.data ?? [])) {
          todasLinhas.push({
            id: c.id, situacao: c.situacao, vencimento: c.vencimento,
            valor: c.valor || 0, data_emissao: c.dataEmissao,
            contato_nome: c.contato?.nome || '', contato_tipo: c.contato?.tipoPessoa || '',
            origem_tipo: c.origem?.tipo || '', origem_numero: c.origem?.numero || '',
            conta_contabil: c.contaContabil || '', empresa: EMPRESA,
          });
        }
      }
      if (todasLinhas.length) {
        totalLidos += todasLinhas.length;
        const ids = todasLinhas.map(c => c.id);
        const { data: existentes } = await sb.from('contas_receber').select('id').in('id', ids);
        const existSet = new Set((existentes ?? []).map(e => Number(e.id)));
        const novosCount = todasLinhas.filter(c => !existSet.has(Number(c.id))).length;
        totalInseridos += novosCount;
        totalAtualizados += todasLinhas.length - novosCount;
        const { error } = await sb.from('contas_receber').upsert(todasLinhas, { onConflict: 'id' });
        if (error) throw new Error(`upsert: ${error.message}`);
      }
      if (!(results[results.length - 1].data?.data?.length)) break;
      pageStart += 3;
    }
    const totalUpserted = totalLidos;
    // Drill /contas/receber/{id} pra preencher forma_pagamento_id/conta_financeira_id/categoria_id
    const drillDeadline = t0 + 130_000;
    let drillResult = { drilled: 0, deadline_hit: false, api_calls: 0 };
    if (Date.now() < drillDeadline) {
      const { data: pendentes } = await sb.from('contas_receber')
        .select('id').eq('empresa', EMPRESA).is('forma_pagamento_id', null)
        .in('situacao', [1, 3, 5]).limit(200);
      const ids = (pendentes ?? []).map(r => Number(r.id));
      if (ids.length > 0) {
        drillResult = await drillContas({
          sb, token, tipo: 'receber', tabela: 'contas_receber',
          ids, deadline_ms: drillDeadline, empresa: EMPRESA,
        });
        apiCalls += drillResult.api_calls;
      }
    }

    const dur = Date.now() - t0;
    await sb.from('sync_log').insert({
      tabela: 'contas_receber', tipo: 'sync_bc', registros: totalUpserted, status: 'ok',
      detalhes: 'sit=' + situacao + ', drill=' + drillResult.drilled + ', ' + Math.round(dur / 1000) + 's',
    });
    if (logId) await sb.from('bling_sync_log').update({
      finalizado_em: new Date().toISOString(), duracao_ms: dur,
      qtd_lidos: totalLidos, qtd_inseridos: totalInseridos, qtd_atualizados: totalAtualizados,
      status: 'ok', api_calls: apiCalls,
      erro_msg: 'situacao=' + situacao,
    }).eq('id', logId);
    return new Response(JSON.stringify({ ok: true, empresa: EMPRESA, situacao, registros: totalUpserted, duracao_seg: Math.round(dur / 1000) }),
      { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    const msg = String((e as Error).message || e).slice(0, 500);
    const isAuth = msg.includes('401') || msg.includes('invalid_grant');
    const isRate = msg.includes('429') || msg.includes('rate_limit');
    await sb.from('sync_log').insert({ tabela: 'contas_receber', tipo: 'sync_bc', registros: totalUpserted, status: 'error', erro: msg, detalhes: 'sit=' + situacao });
    if (logId) await sb.from('bling_sync_log').update({
      finalizado_em: new Date().toISOString(), duracao_ms: Date.now() - t0,
      qtd_lidos: totalUpserted, status: isRate ? 'rate_limited' : 'erro',
      erro_tipo: isAuth ? 'auth' : isRate ? 'rate_limit' : 'http_5xx',
      erro_msg: msg, api_calls: apiCalls,
    }).eq('id', logId);
    return new Response(JSON.stringify({ error: msg, situacao }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
