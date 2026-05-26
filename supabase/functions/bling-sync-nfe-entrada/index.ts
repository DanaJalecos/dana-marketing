// ════════════════════════════════════════════════════════════════════════════
// bling-sync-nfe-entrada — Lote 1 Dia 4 (primeira tabela do plano FAI)
// Sincroniza GET /nfe?tipo=0 (NFs de entrada/compras) pra matriz + bc.
// Sync incremental por dataAlteracao. Body opcional: { dias_atras: N } pra
// forçar janela maior ou { full: true } pra bootstrap inteiro (use Python local
// pra bootstraps grandes — edge timeout 150s).
// ════════════════════════════════════════════════════════════════════════════

import { getAdminClient, getValidToken, Empresa } from '../_shared/bling-oauth.ts';
import { blingGet, sleep } from '../_shared/bling-client.ts';

const LOJAS: { empresa: Empresa; loja_id: number }[] = [
  { empresa: 'matriz', loja_id: 203536978 },
  { empresa: 'bc',     loja_id: 203550865 },
];

interface BlingNFeLista {
  id: number; numero: string; serie?: string; chaveAcesso?: string;
  situacao: number; tipo: number; dataEmissao?: string;
  contato?: { id?: number; nome?: string; numeroDocumento?: string };
}

interface BlingNFeDetalhe {
  id: number; numero: string; serie?: string; chaveAcesso?: string;
  situacao: number; tipo: number; dataEmissao?: string; dataOperacao?: string;
  valorNota?: number; valorFrete?: number;
  contato?: { id?: number; nome?: string; numeroDocumento?: string };
  naturezaOperacao?: { descricao?: string };
  linkDanfe?: string; linkPDF?: string; xml?: string;
  observacoes?: string;
  itens?: Array<{ cfop?: string }>;
}

function mapEntrada(d: BlingNFeDetalhe, loja_id: number) {
  // CFOP: pega o primeiro item (maioria das NFs entrada tem CFOP único)
  const cfop = d.itens?.[0]?.cfop || null;
  return {
    id_bling: d.id,
    loja_id,
    numero: d.numero,
    serie: d.serie || null,
    chave_acesso: d.chaveAcesso || null,
    situacao: d.situacao,
    data_emissao: d.dataEmissao || null,
    data_entrada: d.dataOperacao || null,
    valor_total: d.valorNota || null,
    valor_frete: d.valorFrete || null,
    fornecedor_cnpj: d.contato?.numeroDocumento || null,
    fornecedor_nome: d.contato?.nome || null,
    fornecedor_id: d.contato?.id || null,
    natureza_operacao: d.naturezaOperacao?.descricao || null,
    cfop,
    observacoes: d.observacoes || null,
    xml_url: d.xml || null,
    pdf_url: d.linkPDF || d.linkDanfe || null,
    raw: d,
    synced_at: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  const t0 = Date.now();
  const sb = getAdminClient();

  // Parâmetros do body (opcionais)
  let dias_atras = 2;  // default incremental: 2 dias
  let full = false;
  try {
    const b = await req.json();
    if (b?.dias_atras) dias_atras = Math.min(Number(b.dias_atras), 365);
    if (b?.full) full = true;
  } catch { /* sem body, usa defaults */ }

  const resultados: Record<string, unknown>[] = [];

  for (const { empresa, loja_id } of LOJAS) {
    const { data: logRow } = await sb.from('bling_sync_log').insert({
      tabela: 'bling_nfe_entrada', loja_id, iniciado_em: new Date().toISOString(),
      status: 'rodando', api_calls: 0,
    }).select('id').single();
    const logId = logRow?.id ?? null;

    let totalUpserted = 0, apiCalls = 0;

    try {
      const token = await getValidToken(sb, empresa);

      // Calcula janela: full → 2025-01-01, senão últimas N horas a partir do max(synced_at)
      let desde: Date;
      if (full) {
        desde = new Date('2025-01-01T00:00:00Z');
      } else {
        const { data: maxRow } = await sb.from('bling_nfe_entrada')
          .select('synced_at').eq('loja_id', loja_id)
          .order('synced_at', { ascending: false }).limit(1).single();
        if (maxRow?.synced_at) {
          // 1h margem
          desde = new Date(new Date(maxRow.synced_at).getTime() - 60 * 60 * 1000);
        } else {
          desde = new Date(Date.now() - dias_atras * 86400000);
        }
      }
      const ate = new Date();
      const desdeStr = desde.toISOString().replace('T', ' ').slice(0, 19);
      const ateStr = ate.toISOString().replace('T', ' ').slice(0, 19);

      // Pagina lista — Bling /nfe retorna campos mínimos. Pra ter detalhes (cfop, valorNota,
      // links), precisa chamar /nfe/{id} pra cada item. Faremos batch.
      let pagina = 1;
      const idsParaDrill: number[] = [];

      while (true) {
        const r = await blingGet<{ data?: BlingNFeLista[] }>(
          token, '/nfe',
          { tipo: 0, pagina, limite: 100, dataAlteracaoInicial: desdeStr, dataAlteracaoFinal: ateStr }
        );
        apiCalls++;
        if (!r.ok) throw new Error(`bling /nfe?tipo=0 status=${r.status}: ${r.errorBody}`);
        const items = r.data?.data ?? [];
        if (!items.length) break;
        idsParaDrill.push(...items.map(i => i.id));
        if (items.length < 100) break;
        pagina++;
        await sleep(400);
      }

      // DEDUPE: skip IDs que já estão no banco (sync incremental fica rápido).
      // Só roda drill em NFs novas ou que mudaram (status mudou via cron seguinte).
      const idsNovos: number[] = [];
      if (idsParaDrill.length > 0 && !full) {
        for (let k = 0; k < idsParaDrill.length; k += 500) {
          const chunk = idsParaDrill.slice(k, k + 500);
          const { data: existentes } = await sb.from('bling_nfe_entrada')
            .select('id_bling').in('id_bling', chunk);
          const existentesSet = new Set((existentes ?? []).map(e => Number(e.id_bling)));
          idsNovos.push(...chunk.filter(id => !existentesSet.has(id)));
        }
      } else {
        idsNovos.push(...idsParaDrill);
      }

      // Drill em cada id novo. 5 em paralelo, sleep 250ms entre lotes.
      // Safety cap: edge timeout 150s → para após 130s pra fechar log.
      const drillDeadline = t0 + 130_000;
      for (let i = 0; i < idsNovos.length; i += 5) {
        if (Date.now() > drillDeadline) {
          // marca como parcial e sai pra deixar próxima execução continuar
          break;
        }
        const idsBatch = idsNovos.slice(i, i + 5);
        const results = await Promise.all(
          idsBatch.map(id => blingGet<{ data?: BlingNFeDetalhe }>(token, `/nfe/${id}`, {}))
        );
        apiCalls += idsBatch.length;

        const rows = [];
        for (const r of results) {
          if (!r.ok) continue;  // skip individual failures
          const d = r.data?.data;
          if (d) rows.push(mapEntrada(d, loja_id));
        }

        if (rows.length) {
          const { error } = await sb.from('bling_nfe_entrada').upsert(rows, { onConflict: 'id_bling' });
          if (error) throw new Error(`upsert bling_nfe_entrada: ${error.message}`);
          totalUpserted += rows.length;
        }

        await sleep(250);
      }

      const dur = Date.now() - t0;
      const ranOut = Date.now() > drillDeadline;
      if (logId) await sb.from('bling_sync_log').update({
        finalizado_em: new Date().toISOString(),
        duracao_ms: dur,
        desde: desde.toISOString(),
        ate: ate.toISOString(),
        qtd_lidos: idsParaDrill.length,
        qtd_atualizados: totalUpserted,
        status: ranOut ? 'parcial' : 'ok',
        erro_tipo: ranOut ? 'timeout' : null,
        erro_msg: ranOut ? `parou no item ${totalUpserted}/${idsNovos.length} (deadline 130s)` : null,
        api_calls: apiCalls,
      }).eq('id', logId);

      resultados.push({ empresa, loja_id, lidos: idsParaDrill.length, upserted: totalUpserted, dur_ms: dur, status: 'ok' });

    } catch (e) {
      const msg = String((e as Error).message || e).slice(0, 500);
      const isAuth = msg.includes('401') || msg.includes('invalid_grant');
      const isRate = msg.includes('429') || msg.includes('rate_limit');
      if (logId) await sb.from('bling_sync_log').update({
        finalizado_em: new Date().toISOString(),
        duracao_ms: Date.now() - t0,
        qtd_atualizados: totalUpserted,
        status: isRate ? 'rate_limited' : 'erro',
        erro_tipo: isAuth ? 'auth' : isRate ? 'rate_limit' : 'http_5xx',
        erro_msg: msg,
        api_calls: apiCalls,
      }).eq('id', logId);
      resultados.push({ empresa, loja_id, status: 'erro', erro: msg });
    }

    await sleep(1000); // gentle entre lojas
  }

  const hasError = resultados.some(r => r.status === 'erro');
  return new Response(JSON.stringify({ ok: !hasError, resultados, modo: full ? 'full' : `incremental_${dias_atras}d` }),
    { status: hasError ? 207 : 200, headers: { 'Content-Type': 'application/json' } });
});
