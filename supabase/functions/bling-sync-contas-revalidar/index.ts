// ════════════════════════════════════════════════════════════════════════════
// bling-sync-contas-revalidar — Pedido FAI msg 22 (parte A)
// Sync update sistêmico via drill por ID em batch. Resolve staleness de contas
// que MUDAM no Bling (1→2 paga, 1→3 cancelada, vencimento alterado, etc).
//
// Bling /contas/{receber,pagar} ignora dataAlteracaoInicial (testado), então
// usamos drill por ID ordenado por revalidated_at NULLS FIRST (revalida tudo
// eventualmente em ~26h dado batch 500/hora).
//
// Body: { tipo: 'receber' | 'pagar', empresa: 'matriz' | 'bc', limit?: number }
// ════════════════════════════════════════════════════════════════════════════

import { getAdminClient, getValidToken, Empresa } from '../_shared/bling-oauth.ts';
import { blingGet, sleep } from '../_shared/bling-client.ts';

interface BlingContaDetalhe {
  id: number;
  situacao?: number;
  vencimento?: string;
  valor?: number;
  formaPagamento?: { id?: number };
  portador?: { id?: number };
  categoria?: { id?: number };
  contato?: { id?: number; nome?: string; tipoPessoa?: string };
  origem?: { tipo?: string; numero?: string };
  contaContabil?: string;
  dataEmissao?: string;
}

Deno.serve(async (req) => {
  const t0 = Date.now();

  let tipo: 'receber' | 'pagar' = 'receber';
  let empresa: Empresa = 'matriz';
  let limit = 500;
  try {
    const body = await req.json();
    if (body?.tipo === 'pagar' || body?.tipo === 'receber') tipo = body.tipo;
    if (body?.empresa === 'bc' || body?.empresa === 'matriz') empresa = body.empresa;
    if (body?.limit) limit = Math.min(Number(body.limit), 1000);
  } catch { /* sem body usa defaults */ }

  const tabela = tipo === 'receber' ? 'contas_receber' : 'contas_pagar';
  const loja_id = empresa === 'matriz' ? 203536978 : 203550865;
  const sb = getAdminClient();

  const { data: logRow } = await sb.from('bling_sync_log').insert({
    tabela: `${tabela}_revalidate`, loja_id, iniciado_em: new Date().toISOString(),
    status: 'rodando', api_calls: 0,
  }).select('id').single();
  const logId = logRow?.id ?? null;

  let totalDrilled = 0, totalUpdated = 0, total404 = 0, totalErrors = 0, apiCalls = 0;

  try {
    const token = await getValidToken(sb, empresa);

    // 1. Pega N IDs ordenados por revalidated_at NULLS FIRST (mais antigos primeiro)
    const { data: ids } = await sb.from(tabela)
      .select('id')
      .eq('empresa', empresa)
      .order('revalidated_at', { ascending: true, nullsFirst: true })
      .order('id', { ascending: true })
      .limit(limit);
    const idsLista = (ids ?? []).map(r => Number(r.id));

    // 2. Drill em batches de 3 paralelos + sleep 350ms
    const deadline = t0 + 130_000;
    const nowISO = new Date().toISOString();

    for (let i = 0; i < idsLista.length; i += 3) {
      if (Date.now() > deadline) break;
      const batch = idsLista.slice(i, i + 3);
      const results = await Promise.all(
        batch.map(id => blingGet<{ data?: BlingContaDetalhe }>(token, `/contas/${tipo}/${id}`, {}))
      );
      apiCalls += batch.length;

      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        const id = batch[j];
        totalDrilled++;

        if (r.status === 404) {
          // Conta sumiu do Bling — marca como cancelada
          const { error } = await sb.from(tabela)
            .update({ situacao: 3, revalidated_at: nowISO })
            .eq('id', id);
          if (!error) total404++;
          continue;
        }
        if (!r.ok) {
          // Marca revalidated_at mesmo em erro pra não ficar revisitando
          // o mesmo id quebrado eternamente (rate-limit pode dar erro)
          await sb.from(tabela).update({ revalidated_at: nowISO }).eq('id', id);
          totalErrors++;
          continue;
        }

        const d = r.data?.data;
        if (!d) {
          totalErrors++;
          continue;
        }

        // Update todos os campos relevantes
        const update: Record<string, unknown> = {
          situacao: d.situacao ?? null,
          vencimento: d.vencimento ?? null,
          valor: d.valor ?? 0,
          forma_pagamento_id: d.formaPagamento?.id ?? null,
          conta_financeira_id: d.portador?.id ?? null,
          categoria_id: d.categoria?.id ?? null,
          revalidated_at: nowISO,
        };
        if (tipo === 'receber') {
          update.contato_nome = d.contato?.nome ?? null;
          update.contato_tipo = d.contato?.tipoPessoa ?? null;
          update.origem_tipo = d.origem?.tipo ?? null;
          update.origem_numero = d.origem?.numero ?? null;
          update.conta_contabil = d.contaContabil ?? null;
          update.data_emissao = d.dataEmissao ?? null;
        } else {
          update.contato_id = d.contato?.id ?? 0;
        }

        const { error } = await sb.from(tabela).update(update).eq('id', id);
        if (!error) totalUpdated++;
        else totalErrors++;
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
      erro_msg: `tipo=${tipo} empresa=${empresa} drilled=${totalDrilled} updated=${totalUpdated} 404=${total404} err=${totalErrors}`,
      api_calls: apiCalls,
    }).eq('id', logId);

    return new Response(JSON.stringify({
      ok: true, tipo, empresa,
      drilled: totalDrilled, updated: totalUpdated, marked_cancelled: total404, errors: totalErrors,
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
