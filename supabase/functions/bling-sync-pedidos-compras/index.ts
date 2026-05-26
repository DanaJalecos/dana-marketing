// ════════════════════════════════════════════════════════════════════════════
// bling-sync-pedidos-compras — Lote 2 Dia 3
// PRIORIDADE ALTA pelo Finance AI — investiga campo notaFiscal.id pra vincular
// pedido de compra → bling_nfe_entrada.
//
// Confirmado via API: pedido.itens[*].notaFiscal.id existe.
// Quando != 0, vincula com NF de entrada importada/gerada.
// ════════════════════════════════════════════════════════════════════════════

import { getAdminClient, getValidToken, Empresa } from '../_shared/bling-oauth.ts';
import { blingGet, sleep } from '../_shared/bling-client.ts';

const LOJAS: { empresa: Empresa; loja_id: number }[] = [
  { empresa: 'matriz', loja_id: 203536978 },
  { empresa: 'bc',     loja_id: 203550865 },
];

interface BlingPcLista {
  id: number; numero: number | string; data: string; dataPrevista?: string;
  totalProdutos?: number; total?: number;
  fornecedor?: { id?: number };
  situacao?: { id?: number; valor?: number };
}

interface BlingPcDetalhe extends BlingPcLista {
  ordemCompra?: string;
  observacoes?: string;
  observacoesInternas?: string;
  fornecedor?: { id?: number; nome?: string; numeroDocumento?: string };
  itens?: Array<{
    notaFiscal?: { id?: number; quantidade?: number };
    [k: string]: unknown;
  }>;
}

function mapPc(d: BlingPcDetalhe, loja_id: number) {
  // Extrai IDs de NFs vinculadas (não-zero, distintas)
  const nfIds = new Set<number>();
  for (const item of (d.itens ?? [])) {
    const nfId = item.notaFiscal?.id;
    if (typeof nfId === 'number' && nfId > 0) nfIds.add(nfId);
  }
  return {
    id_bling: d.id,
    loja_id,
    numero: String(d.numero ?? ''),
    data: d.data,
    data_prevista: d.dataPrevista || null,
    fornecedor_id: d.fornecedor?.id || null,
    fornecedor_cnpj: d.fornecedor?.numeroDocumento || null,
    fornecedor_nome: d.fornecedor?.nome || null,
    valor_total: d.total || null,
    valor_produtos: d.totalProdutos || null,
    situacao_id: d.situacao?.id ?? null,
    situacao_valor: d.situacao?.valor ?? null,
    ordem_compra: d.ordemCompra || null,
    observacoes: d.observacoes || null,
    observacoes_internas: d.observacoesInternas || null,
    nf_entrada_ids: Array.from(nfIds),
    raw: d,
    synced_at: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  const t0 = Date.now();
  const sb = getAdminClient();

  let dias_atras = 30;
  let full = false;
  try {
    const b = await req.json();
    if (b?.dias_atras) dias_atras = Math.min(Number(b.dias_atras), 365);
    if (b?.full) full = true;
  } catch { /* sem body */ }

  const resultados: Record<string, unknown>[] = [];

  for (const { empresa, loja_id } of LOJAS) {
    const { data: log } = await sb.from('bling_sync_log').insert({
      tabela: 'bling_pedidos_compras', loja_id, iniciado_em: new Date().toISOString(),
      status: 'rodando', api_calls: 0,
    }).select('id').single();
    const logId = log?.id ?? null;

    let totalUpserted = 0, apiCalls = 0;

    try {
      const token = await getValidToken(sb, empresa);

      let desde: Date;
      if (full) {
        desde = new Date('2025-01-01T00:00:00Z');
      } else {
        const { data: maxRow } = await sb.from('bling_pedidos_compras')
          .select('synced_at').eq('loja_id', loja_id)
          .order('synced_at', { ascending: false }).limit(1).single();
        if (maxRow?.synced_at) {
          desde = new Date(new Date(maxRow.synced_at).getTime() - 60 * 60 * 1000);
        } else {
          desde = new Date(Date.now() - dias_atras * 86400000);
        }
      }
      const ate = new Date();
      const desdeStr = desde.toISOString().split('T')[0];
      const ateStr = ate.toISOString().split('T')[0];

      // 1. Lista paginada (só ids + campos mínimos)
      let pagina = 1;
      const ids: number[] = [];
      while (true) {
        const r = await blingGet<{ data?: BlingPcLista[] }>(
          token, '/pedidos/compras',
          { pagina, limite: 100, dataInicial: desdeStr, dataFinal: ateStr }
        );
        apiCalls++;
        if (!r.ok) throw new Error(`bling /pedidos/compras status=${r.status}: ${r.errorBody}`);
        const items = r.data?.data ?? [];
        if (!items.length) break;
        ids.push(...items.map(i => i.id));
        if (items.length < 100) break;
        pagina++;
        await sleep(400);
      }

      // 2. Dedupe contra banco (incremental)
      const idsNovos: number[] = [];
      if (ids.length > 0 && !full) {
        for (let k = 0; k < ids.length; k += 500) {
          const chunk = ids.slice(k, k + 500);
          const { data: existentes } = await sb.from('bling_pedidos_compras')
            .select('id_bling').in('id_bling', chunk);
          const set = new Set((existentes ?? []).map(e => Number(e.id_bling)));
          idsNovos.push(...chunk.filter(id => !set.has(id)));
        }
      } else {
        idsNovos.push(...ids);
      }

      // 3. Drill por id (deadline 130s)
      const drillDeadline = t0 + 130_000;
      for (let i = 0; i < idsNovos.length; i += 3) {
        if (Date.now() > drillDeadline) break;
        const batch = idsNovos.slice(i, i + 3);
        const results = await Promise.all(
          batch.map(id => blingGet<{ data?: BlingPcDetalhe }>(token, `/pedidos/compras/${id}`, {}))
        );
        apiCalls += batch.length;

        const rows = [];
        for (const r of results) {
          if (!r.ok) continue;
          const d = r.data?.data;
          if (d) rows.push(mapPc(d, loja_id));
        }

        if (rows.length) {
          const { error } = await sb.from('bling_pedidos_compras').upsert(rows, { onConflict: 'id_bling' });
          if (error) throw new Error(`upsert: ${error.message}`);
          totalUpserted += rows.length;
        }
        await sleep(350);
      }

      const dur = Date.now() - t0;
      const ranOut = Date.now() > drillDeadline;
      if (logId) await sb.from('bling_sync_log').update({
        finalizado_em: new Date().toISOString(),
        duracao_ms: dur,
        desde: desde.toISOString(),
        ate: ate.toISOString(),
        qtd_lidos: ids.length,
        qtd_atualizados: totalUpserted,
        status: ranOut ? 'parcial' : 'ok',
        erro_tipo: ranOut ? 'timeout' : null,
        erro_msg: ranOut ? `parou em ${totalUpserted}/${idsNovos.length}` : null,
        api_calls: apiCalls,
      }).eq('id', logId);
      resultados.push({ empresa, loja_id, lidos: ids.length, novos: idsNovos.length, upserted: totalUpserted, dur_ms: dur, status: ranOut ? 'parcial' : 'ok' });

    } catch (e) {
      const msg = String((e as Error).message || e).slice(0, 500);
      const isAuth = msg.includes('401') || msg.includes('invalid_grant');
      const isRate = msg.includes('429') || msg.includes('rate_limit');
      if (logId) await sb.from('bling_sync_log').update({
        finalizado_em: new Date().toISOString(), duracao_ms: Date.now() - t0,
        qtd_atualizados: totalUpserted,
        status: isRate ? 'rate_limited' : 'erro',
        erro_tipo: isAuth ? 'auth' : isRate ? 'rate_limit' : 'http_5xx',
        erro_msg: msg, api_calls: apiCalls,
      }).eq('id', logId);
      resultados.push({ empresa, loja_id, status: 'erro', erro: msg });
    }
    await sleep(1000);
  }

  const hasError = resultados.some(r => r.status === 'erro');
  return new Response(JSON.stringify({ ok: !hasError, resultados, modo: full ? 'full' : `incremental_${dias_atras}d` }),
    { status: hasError ? 207 : 200, headers: { 'Content-Type': 'application/json' } });
});
