// ════════════════════════════════════════════════════════════════════════════
// bling-sync-situacoes — Pedido FAI msg 24 (parte 2)
// Sincroniza catálogo de situações dos módulos Bling (Vendas, Compras, OP).
// Necessário pra mostrar nome real ("Costura" em vez de "Situação #35734")
// e classificar terminal vs pipeline sem hardcode.
//
// Nota: token BC pode retornar 403 (insufficient_scope) — tratamos graceful.
// ════════════════════════════════════════════════════════════════════════════

import { getAdminClient, getValidToken, Empresa } from '../_shared/bling-oauth.ts';
import { blingGet, sleep } from '../_shared/bling-client.ts';

const LOJAS: { empresa: Empresa; loja_id: number }[] = [
  { empresa: 'matriz', loja_id: 203536978 },
  { empresa: 'bc',     loja_id: 203550865 },
];

interface BlingModulo { id: number; nome: string; descricao?: string }
interface BlingSituacao { id: number; nome: string; cor?: string; idHerdado?: number }

function mapSit(d: BlingSituacao, empresa: Empresa, loja_id: number, modulo: BlingModulo) {
  return {
    id_bling: d.id,
    loja_id,
    empresa,
    modulo_id: modulo.id,
    modulo_nome: modulo.nome,
    nome: d.nome,
    cor: d.cor ?? null,
    id_herdado: d.idHerdado ?? 0,
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
      tabela: 'bling_situacoes', loja_id, iniciado_em: new Date().toISOString(),
      status: 'rodando', api_calls: 0,
    }).select('id').single();
    const logId = logRow?.id ?? null;

    let totalUpserted = 0, apiCalls = 0;
    const errosScope: string[] = [];

    try {
      const token = await getValidToken(sb, empresa);

      // 1. Lista módulos
      const mods = await blingGet<{ data?: BlingModulo[] }>(token, '/situacoes/modulos', {});
      apiCalls++;
      if (!mods.ok) {
        if (mods.status === 403) {
          errosScope.push(`/situacoes/modulos: 403 insufficient_scope`);
        } else {
          throw new Error(`bling /situacoes/modulos: ${mods.status} ${mods.errorBody}`);
        }
      }
      const modulos = (mods.data?.data ?? []);

      // 2. Pra cada módulo, drilla situações
      for (const m of modulos) {
        await sleep(350);
        const r = await blingGet<{ data?: BlingSituacao[] }>(token, `/situacoes/modulos/${m.id}`, {});
        apiCalls++;
        if (!r.ok) {
          if (r.status === 403) {
            errosScope.push(`modulo ${m.id} (${m.nome}): 403`);
            continue;
          }
          throw new Error(`bling /situacoes/modulos/${m.id}: ${r.status} ${r.errorBody}`);
        }
        const sits = r.data?.data ?? [];
        if (!sits.length) continue;
        const rows = sits.map(s => mapSit(s, empresa, loja_id, m));
        const { error } = await sb.from('bling_situacoes')
          .upsert(rows, { onConflict: 'id_bling,modulo_id,empresa' });
        if (error) throw new Error(`upsert: ${error.message}`);
        totalUpserted += rows.length;
      }

      const dur = Date.now() - t0;
      if (logId) await sb.from('bling_sync_log').update({
        finalizado_em: new Date().toISOString(),
        duracao_ms: dur,
        qtd_lidos: totalUpserted,
        qtd_atualizados: totalUpserted,
        status: 'ok',
        api_calls: apiCalls,
        erro_msg: errosScope.length ? errosScope.join('; ') : null,
      }).eq('id', logId);
      resultados.push({ empresa, loja_id, upserted: totalUpserted, scope_errors: errosScope, dur_ms: dur });

    } catch (e) {
      const msg = String((e as Error).message || e).slice(0, 500);
      if (logId) await sb.from('bling_sync_log').update({
        finalizado_em: new Date().toISOString(), duracao_ms: Date.now() - t0,
        qtd_atualizados: totalUpserted,
        status: 'erro', erro_tipo: 'http_5xx', erro_msg: msg, api_calls: apiCalls,
      }).eq('id', logId);
      resultados.push({ empresa, loja_id, status: 'erro', erro: msg });
    }
    await sleep(500);
  }

  return new Response(JSON.stringify({ ok: true, resultados }),
    { headers: { 'Content-Type': 'application/json' } });
});
