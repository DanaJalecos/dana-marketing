// ════════════════════════════════════════════════════════════════════════════
// Edge Function: sync-pedidos-bc (BC, loja_id=203550865)
// Clone do sync-pedidos pra empresa BC. Atualizado Lote 1 Dia 4 (wrapper Vault).
// ════════════════════════════════════════════════════════════════════════════

import { getAdminClient, getValidToken } from '../_shared/bling-oauth.ts';
import { blingGet, sleep } from '../_shared/bling-client.ts';

const EMPRESA = 'bc' as const;
const LOJA_ID = 203550865;

interface BlingPedido {
  id: number;
  numero: string;
  numeroLoja?: string;
  data: string;
  dataSaida?: string;
  totalProdutos?: number;
  total?: number;
  contato?: { nome?: string; tipoPessoa?: string };
  situacao?: { id?: number };
  loja?: { id?: number };
}

Deno.serve(async () => {
  const t0 = Date.now();
  const sb = getAdminClient();

  const { data: logRow } = await sb.from('bling_sync_log').insert({
    tabela: 'pedidos', loja_id: LOJA_ID, iniciado_em: new Date().toISOString(),
    status: 'rodando', api_calls: 0,
  }).select('id').single();
  const logId = logRow?.id ?? null;

  let totalUpserted = 0;
  let apiCalls = 0;
  let pagesFetched = 0;

  try {
    const token = await getValidToken(sb, EMPRESA);
    const hoje = new Date();
    const dataInicio = new Date(hoje);
    dataInicio.setDate(dataInicio.getDate() - 7);
    const di = dataInicio.toISOString().split('T')[0];
    const df = hoje.toISOString().split('T')[0];

    for (let page = 1; page <= 10; page++) {
      const r = await blingGet<{ data?: BlingPedido[] }>(
        token, '/pedidos/vendas',
        { pagina: page, limite: 100, dataInicial: di, dataFinal: df }
      );
      apiCalls++;
      if (!r.ok) throw new Error(`bling /pedidos/vendas pagina=${page} status=${r.status}: ${r.errorBody}`);
      const items = r.data?.data ?? [];
      if (!items.length) break;

      const rows = items.map(p => ({
        id: p.id, numero: p.numero, numero_loja: p.numeroLoja || '',
        data: p.data, data_saida: p.dataSaida && p.dataSaida !== '0000-00-00' ? p.dataSaida : null,
        total_produtos: p.totalProdutos || 0, total: p.total || 0,
        contato_nome: p.contato?.nome || '', contato_tipo: p.contato?.tipoPessoa || '',
        situacao_id: p.situacao?.id || 0, loja_id: p.loja?.id || 0,
        empresa: EMPRESA,
      }));

      const { error: upErr } = await sb.from('pedidos').upsert(rows, { onConflict: 'id' });
      if (upErr) throw new Error(`upsert pedidos: ${upErr.message}`);
      totalUpserted += rows.length;
      pagesFetched = page;
      await sleep(300);
    }

    const duracao = Date.now() - t0;
    const duracaoSeg = Math.round(duracao / 1000);
    await sb.from('sync_log').insert({
      tabela: 'pedidos', tipo: 'sync_bc', registros: totalUpserted, status: 'ok', detalhes: duracaoSeg + 's',
    });
    if (logId) {
      await sb.from('bling_sync_log').update({
        finalizado_em: new Date().toISOString(), duracao_ms: duracao,
        qtd_lidos: totalUpserted, qtd_atualizados: totalUpserted, status: 'ok', api_calls: apiCalls,
      }).eq('id', logId);
    }
    return new Response(JSON.stringify({
      ok: true, tabela: 'pedidos', empresa: EMPRESA, registros: totalUpserted,
      paginas: pagesFetched, duracao_seg: duracaoSeg,
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (e) {
    const msg = String((e as Error).message || e).slice(0, 500);
    const isAuth = msg.includes('401') || msg.includes('invalid_grant') || msg.includes('Token renewal');
    const isRate = msg.includes('429') || msg.includes('rate_limit');
    await sb.from('sync_log').insert({ tabela: 'pedidos', tipo: 'sync_bc', registros: totalUpserted, status: 'error', erro: msg });
    if (logId) {
      await sb.from('bling_sync_log').update({
        finalizado_em: new Date().toISOString(), duracao_ms: Date.now() - t0,
        qtd_lidos: totalUpserted, status: isRate ? 'rate_limited' : 'erro',
        erro_tipo: isAuth ? 'auth' : isRate ? 'rate_limit' : 'http_5xx',
        erro_msg: msg, api_calls: apiCalls,
      }).eq('id', logId);
    }
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
