// ════════════════════════════════════════════════════════════════════════════
// bling-sync-contas-financeiras — Lote 3 Tabela 5
// Cadastro paginado de contas correntes / caixas. Volume ~10. Cron 1×/dia.
// Endpoint: GET /contas-contabeis
// ════════════════════════════════════════════════════════════════════════════

import { getAdminClient, getValidToken, Empresa } from '../_shared/bling-oauth.ts';
import { blingGet, sleep } from '../_shared/bling-client.ts';

const LOJAS: { empresa: Empresa; loja_id: number }[] = [
  { empresa: 'matriz', loja_id: 203536978 },
  { empresa: 'bc',     loja_id: 203550865 },
];

interface BlingContaFinanceira {
  id: number;
  descricao?: string;
  nome?: string;
  tipo?: string;
  situacao?: number;
  banco?: { id?: number; nome?: string };
  agencia?: string;
  numero?: string;
  digito?: string;
  saldoInicial?: number;
}

function mapConta(d: BlingContaFinanceira, loja_id: number) {
  return {
    id_bling: d.id,
    loja_id,
    nome: d.descricao || d.nome || `Conta ${d.id}`,
    tipo: d.tipo || null,
    banco_id: d.banco?.id ?? null,
    banco_nome: d.banco?.nome ?? null,
    agencia: d.agencia || null,
    conta: d.numero || null,
    digito: d.digito || null,
    saldo_inicial: d.saldoInicial ?? null,
    situacao: d.situacao ?? null,
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
      tabela: 'bling_contas_financeiras', loja_id, iniciado_em: new Date().toISOString(),
      status: 'rodando', api_calls: 0,
    }).select('id').single();
    const logId = logRow?.id ?? null;

    let totalUpserted = 0, apiCalls = 0;

    try {
      const token = await getValidToken(sb, empresa);

      let pagina = 1;
      while (true) {
        const r = await blingGet<{ data?: BlingContaFinanceira[] }>(
          token, '/contas-contabeis', { pagina, limite: 100 }
        );
        apiCalls++;
        if (!r.ok) throw new Error(`bling /contas-contabeis status=${r.status}: ${r.errorBody}`);
        const items = r.data?.data ?? [];
        if (!items.length) break;

        const rows = items.map(i => mapConta(i, loja_id));
        const { error } = await sb.from('bling_contas_financeiras').upsert(rows, { onConflict: 'id_bling' });
        if (error) throw new Error(`upsert: ${error.message}`);
        totalUpserted += rows.length;

        if (items.length < 100) break;
        pagina++;
        await sleep(400);
      }

      const dur = Date.now() - t0;
      if (logId) await sb.from('bling_sync_log').update({
        finalizado_em: new Date().toISOString(),
        duracao_ms: dur,
        qtd_lidos: totalUpserted,
        qtd_atualizados: totalUpserted,
        status: 'ok',
        api_calls: apiCalls,
      }).eq('id', logId);
      resultados.push({ empresa, loja_id, upserted: totalUpserted, dur_ms: dur, status: 'ok' });

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
