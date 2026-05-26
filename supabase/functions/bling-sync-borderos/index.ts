// ════════════════════════════════════════════════════════════════════════════
// bling-sync-borderos — Lote 3 Tabela 2
// Bling NÃO tem listagem de borderos (apenas GET /borderos/{id} por ID).
// Estratégia: descobrir IDs únicos varrendo contas_pagar.raw que tem bordero
// vinculado, drillar cada um, upsert. Cron 6h.
// ════════════════════════════════════════════════════════════════════════════

import { getAdminClient, getValidToken, Empresa } from '../_shared/bling-oauth.ts';
import { blingGet, sleep } from '../_shared/bling-client.ts';

const LOJAS: { empresa: Empresa; loja_id: number }[] = [
  { empresa: 'matriz', loja_id: 203536978 },
  { empresa: 'bc',     loja_id: 203550865 },
];

interface BlingBordero {
  id: number;
  numero: string;
  data: string;
  dataPagamento?: string;
  valorTotal?: number;
  banco?: { id?: number; nome?: string };
  conta?: { id?: number };
  situacao?: number;
  contas?: Array<{ id?: number }>;
}

function mapBordero(d: BlingBordero, loja_id: number) {
  const contasIds = (d.contas ?? []).map(c => c.id).filter((id): id is number => typeof id === 'number');
  return {
    id_bling: d.id,
    loja_id,
    numero: d.numero,
    data: d.data,
    data_pagamento: d.dataPagamento || null,
    valor_total: d.valorTotal ?? null,
    banco_id: d.banco?.id ?? null,
    banco_nome: d.banco?.nome ?? null,
    conta_id: d.conta?.id ?? null,
    situacao: d.situacao ?? null,
    contas_pagar_ids: contasIds,
    raw: d,
    synced_at: new Date().toISOString(),
  };
}

Deno.serve(async (_req) => {
  const t0 = Date.now();
  const sb = getAdminClient();
  const resultados: Record<string, unknown>[] = [];

  for (const { empresa, loja_id } of LOJAS) {
    const { data: logRow } = await sb.from('bling_sync_log').insert({
      tabela: 'bling_borderos', loja_id, iniciado_em: new Date().toISOString(),
      status: 'rodando', api_calls: 0,
    }).select('id').single();
    const logId = logRow?.id ?? null;

    let totalUpserted = 0, apiCalls = 0;

    try {
      const token = await getValidToken(sb, empresa);

      // 1. Descobrir IDs de bordero olhando contas_pagar.raw (últimos 90d)
      const desde = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
      const { data: contasRaw } = await sb.from('contas_pagar')
        .select('raw')
        .eq('loja_id', loja_id)
        .gte('vencimento', desde)
        .limit(5000);

      const idsSet = new Set<number>();
      for (const row of (contasRaw ?? [])) {
        const bid = (row as { raw?: { borderoId?: number; bordero?: { id?: number } } }).raw;
        const id1 = bid?.borderoId;
        const id2 = bid?.bordero?.id;
        if (typeof id1 === 'number' && id1 > 0) idsSet.add(id1);
        if (typeof id2 === 'number' && id2 > 0) idsSet.add(id2);
      }

      // 2. Filtra IDs já existentes (incremental)
      const todosIds = Array.from(idsSet);
      const idsNovos: number[] = [];
      if (todosIds.length > 0) {
        for (let k = 0; k < todosIds.length; k += 500) {
          const chunk = todosIds.slice(k, k + 500);
          const { data: existentes } = await sb.from('bling_borderos')
            .select('id_bling').in('id_bling', chunk);
          const existSet = new Set((existentes ?? []).map(e => Number(e.id_bling)));
          idsNovos.push(...chunk.filter(id => !existSet.has(id)));
        }
      }

      // 3. Drill em cada ID novo (5 paralelos)
      const deadline = t0 + 130_000;
      for (let i = 0; i < idsNovos.length; i += 5) {
        if (Date.now() > deadline) break;
        const batch = idsNovos.slice(i, i + 5);
        const results = await Promise.all(
          batch.map(id => blingGet<{ data?: BlingBordero }>(token, `/borderos/${id}`, {}))
        );
        apiCalls += batch.length;

        const rows = [];
        for (const r of results) {
          if (!r.ok) continue;
          const d = r.data?.data;
          if (d) rows.push(mapBordero(d, loja_id));
        }
        if (rows.length) {
          const { error } = await sb.from('bling_borderos').upsert(rows, { onConflict: 'id_bling' });
          if (error) throw new Error(`upsert: ${error.message}`);
          totalUpserted += rows.length;
        }
        await sleep(350);
      }

      const dur = Date.now() - t0;
      const ranOut = Date.now() > deadline;
      if (logId) await sb.from('bling_sync_log').update({
        finalizado_em: new Date().toISOString(),
        duracao_ms: dur,
        qtd_lidos: todosIds.length,
        qtd_atualizados: totalUpserted,
        status: ranOut ? 'parcial' : 'ok',
        erro_tipo: ranOut ? 'timeout' : null,
        erro_msg: ranOut ? `parou em ${totalUpserted}/${idsNovos.length} (deadline 130s)` : null,
        api_calls: apiCalls,
      }).eq('id', logId);
      resultados.push({ empresa, loja_id, descobertos: todosIds.length, novos: idsNovos.length, upserted: totalUpserted, dur_ms: dur, status: ranOut ? 'parcial' : 'ok' });

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
  return new Response(JSON.stringify({ ok: !hasError, resultados }),
    { status: hasError ? 207 : 200, headers: { 'Content-Type': 'application/json' } });
});
