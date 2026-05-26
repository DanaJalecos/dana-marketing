// ════════════════════════════════════════════════════════════════════════════
// bling-sync-ordens-producao — Lote 3 Tabela 8 (opcional)
// Ordens de produção Bling. Volume baixo. Cron 6h. Roadmap futuro.
// Endpoint: GET /ordens-producao (paginado)
// ════════════════════════════════════════════════════════════════════════════

import { getAdminClient, getValidToken, Empresa } from '../_shared/bling-oauth.ts';
import { blingGet, sleep } from '../_shared/bling-client.ts';

const LOJAS: { empresa: Empresa; loja_id: number }[] = [
  { empresa: 'matriz', loja_id: 203536978 },
  { empresa: 'bc',     loja_id: 203550865 },
];

interface BlingOP {
  id: number;
  numero?: string;
  data?: string;
  dataAbertura?: string;
  dataConclusao?: string;
  situacao?: { id?: number; nome?: string };
  produto?: { id?: number; nome?: string };
  quantidadePlanejada?: number;
  quantidadeProduzida?: number;
  observacoes?: string;
}

function mapOp(d: BlingOP, loja_id: number) {
  return {
    id_bling: d.id,
    loja_id,
    numero: d.numero || String(d.id),
    data_abertura: d.dataAbertura || d.data || new Date().toISOString().split('T')[0],
    data_conclusao: d.dataConclusao || null,
    situacao_id: d.situacao?.id ?? null,
    situacao_nome: d.situacao?.nome || null,
    produto_id: d.produto?.id ?? null,
    produto_nome: d.produto?.nome || null,
    qtd_planejada: d.quantidadePlanejada ?? null,
    qtd_produzida: d.quantidadeProduzida ?? null,
    observacoes: d.observacoes || null,
    raw: d,
    synced_at: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  const t0 = Date.now();
  const sb = getAdminClient();

  let dias_atras = 30;
  try {
    const b = await req.json();
    if (b?.dias_atras) dias_atras = Math.min(Number(b.dias_atras), 365);
  } catch { /* sem body */ }

  const resultados: Record<string, unknown>[] = [];

  for (const { empresa, loja_id } of LOJAS) {
    const { data: logRow } = await sb.from('bling_sync_log').insert({
      tabela: 'bling_ordens_producao', loja_id, iniciado_em: new Date().toISOString(),
      status: 'rodando', api_calls: 0,
    }).select('id').single();
    const logId = logRow?.id ?? null;

    let totalUpserted = 0, apiCalls = 0;

    try {
      const token = await getValidToken(sb, empresa);

      const desde = new Date(Date.now() - dias_atras * 86400000).toISOString().split('T')[0];
      const ate = new Date().toISOString().split('T')[0];

      let pagina = 1;
      const deadline = t0 + 130_000;
      while (Date.now() < deadline) {
        const r = await blingGet<{ data?: BlingOP[] }>(
          token, '/ordens-producao',
          { pagina, limite: 100, dataInicial: desde, dataFinal: ate }
        );
        apiCalls++;
        if (!r.ok) {
          if (r.status === 404) break;
          throw new Error(`bling /ordens-producao status=${r.status}: ${r.errorBody}`);
        }
        const items = r.data?.data ?? [];
        if (!items.length) break;

        const rows = items.map(i => mapOp(i, loja_id));
        const { error } = await sb.from('bling_ordens_producao').upsert(rows, { onConflict: 'id_bling' });
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
