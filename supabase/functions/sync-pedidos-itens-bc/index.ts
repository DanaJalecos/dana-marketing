// ════════════════════════════════════════════════════════════════════════════
// sync-pedidos-itens-bc (BC, loja_id=203550865)
// Puxa itens dos pedidos recentes (últimos 60d) que ainda não têm itens.
// Para histórico mais antigo, usar sync-pedidos-itens-backfill.
// ════════════════════════════════════════════════════════════════════════════

import { getAdminClient, getValidToken } from '../_shared/bling-oauth.ts';
import { blingGet, sleep } from '../_shared/bling-client.ts';

const EMPRESA = 'bc' as const;
const LOJA_ID = 203550865;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, apikey, Content-Type',
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

interface BlingPedidoDetalhe {
  id: number;
  itens?: Array<{
    produto?: { id?: number | string; codigo?: string; descricao?: string };
    id?: number | string; codigo?: string; descricao?: string;
    quantidade?: number; valor?: number; valorUnidade?: number; unidade?: string;
  }>;
  vendedor?: { id?: number; nome?: string };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const t0 = Date.now();
  const sb = getAdminClient();
  const { data: logRow } = await sb.from('bling_sync_log').insert({
    tabela: 'pedidos_itens', loja_id: LOJA_ID, iniciado_em: new Date().toISOString(),
    status: 'rodando', api_calls: 0,
  }).select('id').single();
  const logId = logRow?.id ?? null;

  let totalItens = 0, totalVendedores = 0, erros = 0, apiCalls = 0;

  try {
    const token = await getValidToken(sb, EMPRESA);

    // Cutoff: últimos 60 dias
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 60);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    // 1. Pedidos recentes do banco (limitando 500)
    const { data: pedidos, error: pedErr } = await sb.from('pedidos')
      .select('id').gte('data', cutoffStr).gt('total_produtos', 0)
      .order('data', { ascending: false }).limit(500);
    if (pedErr) throw new Error(`query pedidos: ${pedErr.message}`);
    if (!pedidos || pedidos.length === 0) {
      if (logId) await sb.from('bling_sync_log').update({
        finalizado_em: new Date().toISOString(), duracao_ms: Date.now() - t0,
        status: 'ok', api_calls: 0,
      }).eq('id', logId);
      return json({ ok: true, message: 'Nenhum pedido recente', itens_sincronizados: 0 });
    }

    // 2. Quais já têm itens?
    const pedidoIds = pedidos.map(p => p.id);
    const jaTemItens = new Set<number>();
    for (let i = 0; i < pedidoIds.length; i += 100) {
      const chunk = pedidoIds.slice(i, i + 100);
      const { data: existentes } = await sb.from('pedidos_itens')
        .select('pedido_id').in('pedido_id', chunk);
      (existentes || []).forEach(e => jaTemItens.add(e.pedido_id));
    }
    const faltam = pedidoIds.filter(id => !jaTemItens.has(id));

    // 3. Bate na API pra pegar itens + vendedor de cada
    for (let i = 0; i < faltam.length; i += 5) {
      const batch = faltam.slice(i, i + 5);
      const results = await Promise.all(
        batch.map(async (pedidoId) => {
          const r = await blingGet<{ data?: BlingPedidoDetalhe }>(
            token, `/pedidos/vendas/${pedidoId}`, {});
          apiCalls++;
          if (!r.ok) {
            // 404 = pedido removido no Bling; pula sem contar como erro
            if (r.status === 404) return null;
            erros++;
            return null;
          }
          const pedido = r.data?.data;
          if (!pedido) return null;
          const vendedor_id = pedido.vendedor?.id || null;
          const vendedor_nome = pedido.vendedor?.nome || null;
          let itens: Array<Record<string, unknown>>;
          if (!pedido.itens || pedido.itens.length === 0) {
            itens = [{
              pedido_id: pedidoId, produto_id: 'sem_itens_0', codigo: '',
              descricao: '(sem itens)', quantidade: 0,
              valor_unitario: 0, valor_total: 0, unidade: 'UN', empresa: EMPRESA,
            }];
          } else {
            itens = pedido.itens.map((item, idx) => ({
              pedido_id: pedidoId,
              produto_id: String(item.produto?.id || item.id || '0') + '_' + idx,
              codigo: item.codigo || item.produto?.codigo || '',
              descricao: item.descricao || item.produto?.descricao || '',
              quantidade: item.quantidade || 0,
              valor_unitario: item.valor || item.valorUnidade || 0,
              valor_total: (item.quantidade || 0) * (item.valor || item.valorUnidade || 0),
              unidade: item.unidade || 'UN', empresa: EMPRESA,
            }));
          }
          return { pedido_id: pedidoId, itens, vendedor_id, vendedor_nome };
        })
      );

      const todosItens = results.flatMap(r => r?.itens || []).filter(i => i.pedido_id);
      if (todosItens.length > 0) {
        const { error } = await sb.from('pedidos_itens').upsert(todosItens, { onConflict: 'pedido_id,produto_id' });
        if (error) console.error('upsert itens:', error.message);
        else totalItens += todosItens.length;
      }

      // Atualiza vendedor nos pedidos
      for (const r of results) {
        if (!r || !r.vendedor_id) continue;
        const { error } = await sb.from('pedidos')
          .update({ vendedor_id: r.vendedor_id, vendedor_nome: r.vendedor_nome })
          .eq('id', r.pedido_id);
        if (!error) totalVendedores++;
      }

      if (i + 5 < faltam.length) await sleep(1000);
    }

    const dur = Date.now() - t0;
    const status = erros > 0 ? 'parcial' : 'ok';
    await sb.from('sync_log').insert({
      tabela: 'pedidos_itens', tipo: 'itens', registros: totalItens,
      status: erros > 0 ? 'parcial' : 'ok',
      detalhes: `${faltam.length} pedidos, ${totalItens} itens, ${totalVendedores} vendedores, ${erros} erros (cutoff ${cutoffStr})`,
    });
    if (logId) await sb.from('bling_sync_log').update({
      finalizado_em: new Date().toISOString(), duracao_ms: dur,
      qtd_lidos: faltam.length, qtd_inseridos: totalItens, qtd_erros: erros,
      status, api_calls: apiCalls,
    }).eq('id', logId);

    return json({ ok: true, empresa: EMPRESA, pedidos_processados: faltam.length, itens_sincronizados: totalItens, erros, ja_sincronizados: jaTemItens.size });

  } catch (e) {
    const msg = String((e as Error).message || e).slice(0, 500);
    const isAuth = msg.includes('401') || msg.includes('invalid_grant');
    const isRate = msg.includes('429') || msg.includes('rate_limit');
    if (logId) await sb.from('bling_sync_log').update({
      finalizado_em: new Date().toISOString(), duracao_ms: Date.now() - t0,
      qtd_inseridos: totalItens, qtd_erros: erros + 1,
      status: isRate ? 'rate_limited' : 'erro',
      erro_tipo: isAuth ? 'auth' : isRate ? 'rate_limit' : 'http_5xx',
      erro_msg: msg, api_calls: apiCalls,
    }).eq('id', logId);
    return json({ ok: false, error: msg }, 500);
  }
});
