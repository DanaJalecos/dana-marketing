// ════════════════════════════════════════════════════════════════════════════
// bling-sync-notificacoes — Lote 3 Tabela 3
// Alertas Bling (NF rejeitada, certificado vencendo, etc). Volume ~5/dia.
// Cron 30min. Endpoint: GET /notificacoes (paginado, IDs em ULID/text)
// ════════════════════════════════════════════════════════════════════════════

import { getAdminClient, getValidToken, Empresa } from '../_shared/bling-oauth.ts';
import { blingGet, sleep } from '../_shared/bling-client.ts';

const LOJAS: { empresa: Empresa; loja_id: number }[] = [
  { empresa: 'matriz', loja_id: 203536978 },
  { empresa: 'bc',     loja_id: 203550865 },
];

interface BlingNotif {
  id: string | number;
  tipo?: string;
  titulo?: string;
  mensagem?: string;
  prioridade?: string;
  lida?: boolean;
  data?: string;
  dataCriacao?: string;
  url?: string;
  link?: string;
}

function mapNotif(d: BlingNotif, loja_id: number) {
  return {
    id_bling: String(d.id),
    loja_id,
    tipo: d.tipo || null,
    titulo: d.titulo || null,
    mensagem: d.mensagem || null,
    prioridade: d.prioridade || null,
    lida: d.lida ?? false,
    data: d.data || d.dataCriacao || null,
    url: d.url || d.link || null,
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
      tabela: 'bling_notificacoes', loja_id, iniciado_em: new Date().toISOString(),
      status: 'rodando', api_calls: 0,
    }).select('id').single();
    const logId = logRow?.id ?? null;

    let totalUpserted = 0, apiCalls = 0;

    try {
      const token = await getValidToken(sb, empresa);

      let pagina = 1;
      const deadline = t0 + 130_000;
      while (Date.now() < deadline) {
        const r = await blingGet<{ data?: BlingNotif[] }>(
          token, '/notificacoes', { pagina, limite: 100 }
        );
        apiCalls++;
        if (!r.ok) {
          // Se endpoint não existe (404), trata como sem dados
          if (r.status === 404) break;
          throw new Error(`bling /notificacoes status=${r.status}: ${r.errorBody}`);
        }
        const items = r.data?.data ?? [];
        if (!items.length) break;

        const rows = items.map(i => mapNotif(i, loja_id));
        const { error } = await sb.from('bling_notificacoes').upsert(rows, { onConflict: 'id_bling' });
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
