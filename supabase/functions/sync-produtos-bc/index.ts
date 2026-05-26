// ════════════════════════════════════════════════════════════════════════════
// sync-produtos-bc (BC, loja_id=203550865).
// ════════════════════════════════════════════════════════════════════════════

import { getAdminClient, getValidToken } from '../_shared/bling-oauth.ts';
import { blingGet } from '../_shared/bling-client.ts';

const EMPRESA = 'bc' as const;
const LOJA_ID = 203550865;

interface BlingProduto {
  id: number; nome?: string; codigo?: string; preco?: number; precoCusto?: number;
  estoque?: { saldoVirtualTotal?: number };
  tipo?: string; situacao?: string; formato?: string; imagemURL?: string;
}

Deno.serve(async () => {
  const t0 = Date.now();
  const sb = getAdminClient();
  const { data: logRow } = await sb.from('bling_sync_log').insert({
    tabela: 'produtos', loja_id: LOJA_ID, iniciado_em: new Date().toISOString(),
    status: 'rodando', api_calls: 0,
  }).select('id').single();
  const logId = logRow?.id ?? null;

  let totalUpserted = 0, apiCalls = 0;
  try {
    const token = await getValidToken(sb, EMPRESA);
    let pageStart = 1;
    while (pageStart <= 50) {
      const pages = [pageStart, pageStart + 1, pageStart + 2, pageStart + 3, pageStart + 4];
      const results = await Promise.all(pages.map(p => blingGet<{ data?: BlingProduto[] }>(
        token, '/produtos', { pagina: p, limite: 100, tipo: 'P', situacao: 'A' })));
      apiCalls += pages.length;
      const todasLinhas = [];
      for (const r of results) {
        if (!r.ok) throw new Error(`bling /produtos status=${r.status}: ${r.errorBody}`);
        for (const p of (r.data?.data ?? [])) {
          todasLinhas.push({
            id: p.id, nome: p.nome, codigo: p.codigo || '', preco: p.preco || 0,
            preco_custo: p.precoCusto || 0,
            estoque_virtual: p.estoque?.saldoVirtualTotal || 0,
            tipo: p.tipo, situacao: p.situacao, formato: p.formato, imagem_url: p.imagemURL || '',
            empresa: EMPRESA,
          });
        }
      }
      if (todasLinhas.length) {
        const { error } = await sb.from('produtos').upsert(todasLinhas, { onConflict: 'id' });
        if (error) throw new Error(`upsert: ${error.message}`);
        totalUpserted += todasLinhas.length;
      }
      if (!(results[results.length - 1].data?.data?.length)) break;
      pageStart += 5;
    }
    const dur = Date.now() - t0;
    await sb.from('sync_log').insert({ tabela: 'produtos', tipo: 'sync_bc', registros: totalUpserted, status: 'ok', detalhes: Math.round(dur / 1000) + 's' });
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
    await sb.from('sync_log').insert({ tabela: 'produtos', tipo: 'sync_bc', registros: totalUpserted, status: 'error', erro: msg });
    if (logId) await sb.from('bling_sync_log').update({
      finalizado_em: new Date().toISOString(), duracao_ms: Date.now() - t0,
      qtd_lidos: totalUpserted, status: isRate ? 'rate_limited' : 'erro',
      erro_tipo: isAuth ? 'auth' : isRate ? 'rate_limit' : 'http_5xx',
      erro_msg: msg, api_calls: apiCalls,
    }).eq('id', logId);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
