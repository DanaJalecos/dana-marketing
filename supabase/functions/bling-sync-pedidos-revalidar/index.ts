// ════════════════════════════════════════════════════════════════════════════
// bling-sync-pedidos-revalidar — Pedido FAI msg 24 (parte 1)
// Drill batch por ID pra atualizar situacao_id (e outros campos) de pedidos
// não-terminais. Resolve staleness do sync incremental que só visita janela
// recente (~241 matriz / 90 BC).
//
// Bling /pedidos/vendas IGNORA dataAlteracaoInicial (testado msg 24).
// Adotamos A2 (drill batch). ~1.387 pedidos não-terminais matriz vão ser
// revalidados em ~2-3 ciclos de 30min (com limit=500 por execução).
//
// Body: { empresa: 'matriz' | 'bc', limit?: number }
// ════════════════════════════════════════════════════════════════════════════

import { getAdminClient, getValidToken, Empresa } from '../_shared/bling-oauth.ts';
import { blingGet, sleep } from '../_shared/bling-client.ts';

// Situacoes terminais: hardcoded como fallback. Edge tenta primeiro ler
// de bling_situacoes (terminal=true) — se a tabela estiver populada, usa
// dinâmico; senão usa hardcoded.
const TERMINAL_FALLBACK = [9, 12];

interface BlingPedidoDetalhe {
  id: number;
  numero?: number;
  data?: string;
  dataSaida?: string;
  total?: number;
  totalProdutos?: number;
  situacao?: { id?: number };
  contato?: { nome?: string };
  loja?: { id?: number };
  vendedor?: { id?: number };
}

Deno.serve(async (req) => {
  const t0 = Date.now();

  let empresa: Empresa = 'matriz';
  let limit = 500;
  let dias = 180;
  try {
    const b = await req.json();
    if (b?.empresa === 'bc' || b?.empresa === 'matriz') empresa = b.empresa;
    if (b?.limit) limit = Math.min(Number(b.limit), 1000);
    if (b?.dias) dias = Math.min(Number(b.dias), 730);
  } catch { /* sem body */ }

  const loja_id = empresa === 'matriz' ? 203536978 : 203550865;
  const sb = getAdminClient();

  const { data: logRow } = await sb.from('bling_sync_log').insert({
    tabela: 'pedidos_revalidate', loja_id, iniciado_em: new Date().toISOString(),
    status: 'rodando', api_calls: 0,
  }).select('id').single();
  const logId = logRow?.id ?? null;

  let totalDrilled = 0, totalUpdated = 0, totalChanged = 0, total404 = 0, totalErrors = 0, apiCalls = 0;

  try {
    const token = await getValidToken(sb, empresa);

    // 1. Determinar IDs terminais via bling_situacoes (se populada) ou fallback
    const { data: sitTerm } = await sb.from('bling_situacoes')
      .select('id_bling').eq('empresa', empresa).eq('terminal', true);
    const terminalIds = (sitTerm && sitTerm.length > 0)
      ? sitTerm.map(s => Number(s.id_bling))
      : TERMINAL_FALLBACK;

    // 2. Pega N IDs não-terminais ordenados por revalidated_at NULLS FIRST
    const dataMin = new Date(Date.now() - dias * 86400000).toISOString().split('T')[0];
    const { data: ids } = await sb.from('pedidos')
      .select('id, situacao_id')
      .eq('empresa', empresa)
      .gte('data', dataMin)
      .not('situacao_id', 'in', `(${terminalIds.join(',')})`)
      .order('revalidated_at', { ascending: true, nullsFirst: true })
      .order('id', { ascending: true })
      .limit(limit);
    const idsLista = (ids ?? []).map(r => Number(r.id));
    const sitAntesMap = new Map((ids ?? []).map(r => [Number(r.id), Number(r.situacao_id)]));

    // 3. Drill em batches de 3 paralelos + sleep 350ms (rate ~1.5/s sustained)
    const deadline = t0 + 130_000;
    const nowISO = new Date().toISOString();

    for (let i = 0; i < idsLista.length; i += 3) {
      if (Date.now() > deadline) break;
      const batch = idsLista.slice(i, i + 3);
      const results = await Promise.all(
        batch.map(id => blingGet<{ data?: BlingPedidoDetalhe }>(token, `/pedidos/vendas/${id}`, {}))
      );
      apiCalls += batch.length;

      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        const id = batch[j];
        totalDrilled++;

        if (r.status === 404) {
          // Pedido sumiu do Bling - marca como cancelado
          await sb.from('pedidos')
            .update({ situacao_id: 12, revalidated_at: nowISO })
            .eq('id', id);
          total404++;
          continue;
        }
        if (!r.ok) {
          // Marca revalidated_at em erro mesmo (não revisita id quebrado)
          await sb.from('pedidos').update({ revalidated_at: nowISO }).eq('id', id);
          totalErrors++;
          continue;
        }

        const d = r.data?.data;
        if (!d) { totalErrors++; continue; }

        const sitAntes = sitAntesMap.get(id) ?? null;
        const sitNova = d.situacao?.id ?? null;
        const mudou = sitAntes !== sitNova;

        const update: Record<string, unknown> = {
          situacao_id: sitNova,
          data_saida: d.dataSaida ?? null,
          total: d.total ?? null,
          total_produtos: d.totalProdutos ?? null,
          revalidated_at: nowISO,
        };

        const { error } = await sb.from('pedidos').update(update).eq('id', id);
        if (error) { totalErrors++; continue; }
        totalUpdated++;
        if (mudou) totalChanged++;
      }
      await sleep(350);
    }

    const dur = Date.now() - t0;
    const ranOut = Date.now() > deadline;
    if (logId) await sb.from('bling_sync_log').update({
      finalizado_em: new Date().toISOString(),
      duracao_ms: dur,
      qtd_lidos: totalDrilled,
      qtd_atualizados: totalUpdated,
      status: ranOut ? 'parcial' : 'ok',
      erro_tipo: ranOut ? 'timeout' : null,
      erro_msg: `empresa=${empresa} drilled=${totalDrilled} updated=${totalUpdated} mudou=${totalChanged} 404=${total404} err=${totalErrors} terminal_ids=[${terminalIds.join(',')}]`,
      api_calls: apiCalls,
    }).eq('id', logId);

    return new Response(JSON.stringify({
      ok: true, empresa,
      drilled: totalDrilled, updated: totalUpdated, status_mudou: totalChanged,
      marked_cancelled: total404, errors: totalErrors, terminal_ids: terminalIds,
      dur_ms: dur, status: ranOut ? 'parcial' : 'ok',
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (e) {
    const msg = String((e as Error).message || e).slice(0, 500);
    const isAuth = msg.includes('401') || msg.includes('invalid_grant');
    const isRate = msg.includes('429') || msg.includes('rate_limit');
    if (logId) await sb.from('bling_sync_log').update({
      finalizado_em: new Date().toISOString(), duracao_ms: Date.now() - t0,
      qtd_lidos: totalDrilled, qtd_atualizados: totalUpdated,
      status: isRate ? 'rate_limited' : 'erro',
      erro_tipo: isAuth ? 'auth' : isRate ? 'rate_limit' : 'http_5xx',
      erro_msg: msg, api_calls: apiCalls,
    }).eq('id', logId);
    return new Response(JSON.stringify({ ok: false, error: msg, dur_ms: Date.now() - t0 }),
      { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
