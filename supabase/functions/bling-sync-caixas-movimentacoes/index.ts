// ════════════════════════════════════════════════════════════════════════════
// bling-sync-caixas-movimentacoes — Lote 3 Tabela 4
// Lançamentos caixa/banco do Bling. Volume ~100/dia. Cron 1h.
// Endpoint: GET /caixas (paginado, filtro data)
// FAI cruza com OFX bancário pra detectar divergências.
// ════════════════════════════════════════════════════════════════════════════

import { getAdminClient, getValidToken, Empresa } from '../_shared/bling-oauth.ts';
import { blingGet, sleep } from '../_shared/bling-client.ts';

const LOJAS: { empresa: Empresa; loja_id: number }[] = [
  { empresa: 'matriz', loja_id: 203536978 },
  { empresa: 'bc',     loja_id: 203550865 },
];

interface BlingCaixaMov {
  id: number;
  data: string;
  descricao?: string;
  historico?: string;
  valor?: number;
  situacao?: string;
  categoria?: { id?: number; descricao?: string; nome?: string };
  contaContabil?: { id?: number; descricao?: string; nome?: string };
  conta?: { id?: number; nome?: string };
  conciliado?: boolean;
  situacaoConciliacao?: number;
  origem?: { id?: number; tipo?: string };
  documento?: string;
}

function mapMov(d: BlingCaixaMov, loja_id: number) {
  const cat = d.categoria;
  const cc  = d.contaContabil || d.conta;
  return {
    id_bling: d.id,
    loja_id,
    data: d.data,
    descricao: d.descricao || d.historico || null,
    categoria_id: cat?.id ?? null,
    categoria_nome: cat?.descricao || cat?.nome || null,
    conta_financeira_id: cc?.id ?? 0,
    conta_financeira_nome: cc?.descricao || cc?.nome || null,
    valor: d.valor ?? 0,
    situacao: d.situacao || (d.conciliado ? 'R' : 'P'),
    situacao_conciliacao: d.situacaoConciliacao ?? (d.conciliado ? 1 : 2),
    origem_id: d.origem?.id ?? null,
    origem_tipo: d.origem?.tipo || null,
    documento: d.documento || null,
    raw: d,
    synced_at: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  const t0 = Date.now();
  const sb = getAdminClient();

  let dias_atras = 7; // padrão: 1 semana
  let full = false;
  try {
    const b = await req.json();
    if (b?.dias_atras) dias_atras = Math.min(Number(b.dias_atras), 365);
    if (b?.full) full = true;
  } catch { /* sem body */ }

  const resultados: Record<string, unknown>[] = [];

  for (const { empresa, loja_id } of LOJAS) {
    const { data: logRow } = await sb.from('bling_sync_log').insert({
      tabela: 'bling_caixas_movimentacoes', loja_id, iniciado_em: new Date().toISOString(),
      status: 'rodando', api_calls: 0,
    }).select('id').single();
    const logId = logRow?.id ?? null;

    let totalUpserted = 0, apiCalls = 0;

    try {
      const token = await getValidToken(sb, empresa);

      let desde: Date;
      if (full) {
        desde = new Date('2025-01-01T00:00:00Z');
      } else {
        const { data: maxRow } = await sb.from('bling_caixas_movimentacoes')
          .select('synced_at').eq('loja_id', loja_id)
          .order('synced_at', { ascending: false }).limit(1).single();
        if (maxRow?.synced_at) {
          desde = new Date(new Date(maxRow.synced_at).getTime() - 24 * 60 * 60 * 1000);
        } else {
          desde = new Date(Date.now() - dias_atras * 86400000);
        }
      }
      const ate = new Date();
      const MAX_JANELA_MS = 80 * 86400 * 1000;
      if (ate.getTime() - desde.getTime() > MAX_JANELA_MS) {
        desde = new Date(ate.getTime() - MAX_JANELA_MS);
      }
      const desdeStr = desde.toISOString().split('T')[0];
      const ateStr = ate.toISOString().split('T')[0];

      let pagina = 1;
      const deadline = t0 + 130_000;
      while (Date.now() < deadline) {
        const r = await blingGet<{ data?: BlingCaixaMov[] }>(
          token, '/caixas',
          { pagina, limite: 100, dataInicial: desdeStr, dataFinal: ateStr }
        );
        apiCalls++;
        if (!r.ok) {
          if (r.status === 404) break;
          throw new Error(`bling /caixas status=${r.status}: ${r.errorBody}`);
        }
        const items = r.data?.data ?? [];
        if (!items.length) break;

        const rows = items.map(i => mapMov(i, loja_id));
        const { error } = await sb.from('bling_caixas_movimentacoes').upsert(rows, { onConflict: 'id_bling' });
        if (error) throw new Error(`upsert: ${error.message}`);
        totalUpserted += rows.length;

        if (items.length < 100) break;
        pagina++;
        await sleep(400);
      }

      const dur = Date.now() - t0;
      const ranOut = Date.now() > deadline;
      if (logId) await sb.from('bling_sync_log').update({
        finalizado_em: new Date().toISOString(),
        duracao_ms: dur,
        desde: desde.toISOString(),
        ate: ate.toISOString(),
        qtd_lidos: totalUpserted,
        qtd_atualizados: totalUpserted,
        status: ranOut ? 'parcial' : 'ok',
        erro_tipo: ranOut ? 'timeout' : null,
        erro_msg: ranOut ? `parou em ${totalUpserted} (deadline 130s)` : null,
        api_calls: apiCalls,
      }).eq('id', logId);
      resultados.push({ empresa, loja_id, upserted: totalUpserted, dur_ms: dur, status: ranOut ? 'parcial' : 'ok' });

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
