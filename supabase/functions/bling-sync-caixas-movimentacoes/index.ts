// ════════════════════════════════════════════════════════════════════════════
// bling-sync-caixas-movimentacoes — Lote 3 Tabela 4 (v2 com drill)
// Lançamentos caixa/banco do Bling.
// v2: LIST não traz categoria → drill em /caixas/{id} pra cada movimento NOVO
//     ou com categoria_id IS NULL (catch-up).
// Cron 1h. FAI cruza com OFX bancário pra divergências + DRE por categoria.
// ════════════════════════════════════════════════════════════════════════════

import { getAdminClient, getValidToken, Empresa } from '../_shared/bling-oauth.ts';
import { blingGet, sleep } from '../_shared/bling-client.ts';

const LOJAS: { empresa: Empresa; loja_id: number }[] = [
  { empresa: 'matriz', loja_id: 203536978 },
  { empresa: 'bc',     loja_id: 203550865 },
];

interface BlingCaixaList {
  id: number | string;
  data: string;
  descricao?: string;
  valor?: number;
  debCred?: 'D' | 'C';
  situacao?: string;
  origem?: { id?: number; tipo?: string };
  contato?: { id?: number; nome?: string };
  contaFinanceira?: { id?: number; descricao?: string };
}

interface BlingCaixaDetalhe extends BlingCaixaList {
  saldo?: string;
  categoria?: { id?: number };
  competencia?: string;            // data fiscal "DD/MM/YYYY"
  observacoes?: string;
  transferencia?: string;
  tipoLancamento?: string;
}

// Normaliza data "DD/MM/YYYY" pra "YYYY-MM-DD"
function normData(d?: string): string | null {
  if (!d) return null;
  if (d.includes('/')) {
    const [dd, mm, yy] = d.split('/');
    return `${yy}-${mm}-${dd}`;
  }
  return d.split('T')[0];
}

// Map de fallback (LIST sem drill — categoria fica null)
function mapMovList(d: BlingCaixaList, loja_id: number) {
  return {
    id_bling: typeof d.id === 'string' ? Number(d.id) : d.id,
    loja_id,
    data: normData(d.data) || new Date().toISOString().split('T')[0],
    descricao: d.descricao || null,
    categoria_id: null,
    categoria_nome: null,
    conta_financeira_id: d.contaFinanceira?.id ?? 0,
    conta_financeira_nome: d.contaFinanceira?.descricao ?? null,
    valor: typeof d.valor === 'number' ? Math.abs(d.valor) * (d.debCred === 'D' ? -1 : 1) : 0,
    situacao: d.situacao || 'R',
    situacao_conciliacao: null,
    origem_id: d.origem?.id ?? null,
    origem_tipo: d.origem?.tipo || null,
    documento: null,
    raw: d,
    synced_at: new Date().toISOString(),
  };
}

// Map enriquecido (com drill /caixas/{id} + JOIN bling_categorias pra nome)
function mapMovDetalhe(d: BlingCaixaDetalhe, loja_id: number, catNome: string | null) {
  return {
    id_bling: typeof d.id === 'string' ? Number(d.id) : d.id,
    loja_id,
    data: normData(d.data) || new Date().toISOString().split('T')[0],
    descricao: d.descricao || null,
    categoria_id: d.categoria?.id ?? null,
    categoria_nome: catNome,
    conta_financeira_id: d.contaFinanceira?.id ?? 0,
    conta_financeira_nome: d.contaFinanceira?.descricao ?? null,
    valor: typeof d.valor === 'number' ? Math.abs(d.valor) * (d.debCred === 'D' ? -1 : 1) : 0,
    situacao: d.situacao || 'R',
    situacao_conciliacao: null,
    origem_id: d.origem?.id ?? null,
    origem_tipo: d.origem?.tipo || null,
    documento: null,
    raw: d,
    synced_at: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  const t0 = Date.now();
  const sb = getAdminClient();

  let dias_atras = 7;
  let dias_atras_explicit = false;  // FAI msg 15 fix: respeitar param mesmo se ja tem dados
  let full = false;
  let drillExisting = false;  // se true, drilla TUDO (não só novos) — pra catch-up
  try {
    const b = await req.json();
    if (b?.dias_atras) { dias_atras = Math.min(Number(b.dias_atras), 365); dias_atras_explicit = true; }
    if (b?.full) full = true;
    if (b?.drillExisting) drillExisting = true;
  } catch { /* sem body */ }

  const resultados: Record<string, unknown>[] = [];

  for (const { empresa, loja_id } of LOJAS) {
    const { data: logRow } = await sb.from('bling_sync_log').insert({
      tabela: 'bling_caixas_movimentacoes', loja_id, iniciado_em: new Date().toISOString(),
      status: 'rodando', api_calls: 0,
    }).select('id').single();
    const logId = logRow?.id ?? null;

    let totalUpserted = 0, totalDrilled = 0, apiCalls = 0;

    try {
      const token = await getValidToken(sb, empresa);

      // Cache de nomes de categoria pra essa loja (1 query, ~70 linhas)
      const { data: catsRaw } = await sb.from('bling_categorias')
        .select('id_bling, nome')
        .eq('loja_id', loja_id);
      const catNomeMap = new Map<number, string>();
      for (const c of (catsRaw ?? [])) catNomeMap.set(Number(c.id_bling), String(c.nome));

      let desde: Date;
      if (full) {
        desde = new Date('2025-01-01T00:00:00Z');
      } else if (dias_atras_explicit) {
        // FAI msg 15 fix: respeita dias_atras mesmo se tabela ja tem dados
        desde = new Date(Date.now() - dias_atras * 86400000);
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

      // 1) LIST paginada — pega IDs + campos básicos
      let pagina = 1;
      const items: BlingCaixaList[] = [];
      const deadline = t0 + 130_000;
      while (Date.now() < deadline) {
        const r = await blingGet<{ data?: BlingCaixaList[] }>(
          token, '/caixas',
          { pagina, limite: 100, dataInicial: desdeStr, dataFinal: ateStr }
        );
        apiCalls++;
        if (!r.ok) {
          if (r.status === 404) break;
          throw new Error(`bling /caixas status=${r.status}: ${r.errorBody}`);
        }
        const page = r.data?.data ?? [];
        if (!page.length) break;
        items.push(...page);
        if (page.length < 100) break;
        pagina++;
        await sleep(400);
      }

      // 2) Decide quais precisam drill (categoria_id NULL ou drillExisting)
      const allIds = items.map(i => typeof i.id === 'string' ? Number(i.id) : i.id);
      let idsParaDrill: number[] = [];
      if (drillExisting) {
        idsParaDrill = allIds;
      } else {
        // Drill apenas em IDs NOVOS ou com categoria_id NULL
        const idsSet = new Set<number>();
        for (let k = 0; k < allIds.length; k += 500) {
          const chunk = allIds.slice(k, k + 500);
          const { data: existentes } = await sb.from('bling_caixas_movimentacoes')
            .select('id_bling, categoria_id').in('id_bling', chunk);
          const existMap = new Map<number, number | null>();
          for (const e of (existentes ?? [])) existMap.set(Number(e.id_bling), e.categoria_id as number | null);
          for (const id of chunk) {
            const cat = existMap.get(id);
            if (cat === undefined) idsSet.add(id);              // novo
            else if (cat === null) idsSet.add(id);              // existe mas sem categoria
          }
        }
        idsParaDrill = [...idsSet];
      }

      // 3) Upsert dos itens SEM drill (mantém campos básicos atualizados)
      const idsSemDrill = allIds.filter(id => !idsParaDrill.includes(id));
      if (idsSemDrill.length) {
        const rowsBasic = items
          .filter(i => idsSemDrill.includes(typeof i.id === 'string' ? Number(i.id) : i.id))
          .map(i => {
            const m = mapMovList(i, loja_id);
            // remove categoria_* pra não sobrescrever drill anterior
            return { ...m, categoria_id: undefined, categoria_nome: undefined } as Record<string, unknown>;
          });
        // upsert mas sem coluna categoria
        const rowsOk = rowsBasic.map(r => {
          const { categoria_id: _ci, categoria_nome: _cn, ...rest } = r as Record<string, unknown>;
          return rest;
        });
        if (rowsOk.length) {
          const { error } = await sb.from('bling_caixas_movimentacoes').upsert(rowsOk, { onConflict: 'id_bling' });
          if (error) throw new Error(`upsert basic: ${error.message}`);
          totalUpserted += rowsOk.length;
        }
      }

      // 4) Drill em batches de 3 (rate-limit Bling ~3/s)
      for (let i = 0; i < idsParaDrill.length; i += 3) {
        if (Date.now() > deadline) break;
        const batch = idsParaDrill.slice(i, i + 3);
        const results = await Promise.all(
          batch.map(id => blingGet<{ data?: BlingCaixaDetalhe }>(token, `/caixas/${id}`, {}))
        );
        apiCalls += batch.length;

        const rows = [];
        for (const r of results) {
          if (!r.ok) continue;
          const d = r.data?.data;
          if (d) {
            const catId = d.categoria?.id ?? null;
            const catNome = catId !== null ? (catNomeMap.get(catId) ?? null) : null;
            rows.push(mapMovDetalhe(d, loja_id, catNome));
          }
        }
        if (rows.length) {
          const { error } = await sb.from('bling_caixas_movimentacoes').upsert(rows, { onConflict: 'id_bling' });
          if (error) throw new Error(`upsert drill: ${error.message}`);
          totalDrilled += rows.length;
        }
        await sleep(350);
      }

      totalUpserted += totalDrilled;

      const dur = Date.now() - t0;
      const ranOut = Date.now() > deadline;
      if (logId) await sb.from('bling_sync_log').update({
        finalizado_em: new Date().toISOString(),
        duracao_ms: dur,
        desde: desde.toISOString(),
        ate: ate.toISOString(),
        qtd_lidos: allIds.length,
        qtd_atualizados: totalUpserted,
        status: ranOut ? 'parcial' : 'ok',
        erro_tipo: ranOut ? 'timeout' : null,
        erro_msg: ranOut ? `parou drill ${totalDrilled}/${idsParaDrill.length}` : null,
        api_calls: apiCalls,
      }).eq('id', logId);
      resultados.push({ empresa, loja_id, lidos: allIds.length, drilled: totalDrilled, upserted: totalUpserted, dur_ms: dur, status: ranOut ? 'parcial' : 'ok' });

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
