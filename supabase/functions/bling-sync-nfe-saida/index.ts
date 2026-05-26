// ════════════════════════════════════════════════════════════════════════════
// bling-sync-nfe-saida — Lote 2 Dia 1 (a mais aguardada — destrava DIFAL)
// Sincroniza GET /nfe?tipo=1 (NFs emitidas pela Dana) pra matriz + bc.
// Padrão: lista incremental por dataEmissao (janela max 80d) + drill /nfe/{id}.
// Body: { dias_atras: N } ou { full: true }.
// ════════════════════════════════════════════════════════════════════════════

import { getAdminClient, getValidToken, Empresa } from '../_shared/bling-oauth.ts';
import { blingGet, sleep } from '../_shared/bling-client.ts';

const LOJAS: { empresa: Empresa; loja_id: number }[] = [
  { empresa: 'matriz', loja_id: 203536978 },
  { empresa: 'bc',     loja_id: 203550865 },
];

interface BlingNFeLista { id: number; }
interface BlingNFeSaidaDetalhe {
  id: number; numero: string; serie?: string | number; chaveAcesso?: string;
  situacao: number; tipo: number; dataEmissao?: string; dataOperacao?: string;
  valorNota?: number; valorFrete?: number;
  optanteSimplesNacional?: boolean;
  contato?: {
    id?: number; nome?: string; numeroDocumento?: string; ie?: string;
    endereco?: { uf?: string; estado?: string };
  };
  vendedor?: { id?: number };
  loja?: { id?: number };
  intermediador?: { cnpj?: string; nomeUsuario?: string };
  naturezaOperacao?: { id?: number };
  numeroPedidoLoja?: string;
  linkDanfe?: string; linkPDF?: string; xml?: string;
  itens?: Array<{ cfop?: string }>;
}

function mapSaida(d: BlingNFeSaidaDetalhe, loja_id: number) {
  // CFOP: pega o primeiro item (maioria das NFs tem CFOP único pro pedido)
  const cfop = d.itens?.[0]?.cfop ?? null;
  // Consumidor final: CFOP que termina em 2 (5102, 6102, 5202, 6202, etc) é varejo/CF
  // Regra simplificada: 5102/6102/5108/6108/5405/6405 = consumidor final
  const cfopNum = cfop ? parseInt(cfop) : 0;
  const consumidorFinal = [5102, 6102, 5108, 6108, 5405, 6405].includes(cfopNum) || null;
  // UF do cliente — tenta tanto endereco.uf quanto endereco.estado
  const clienteUf = d.contato?.endereco?.uf || d.contato?.endereco?.estado || null;

  return {
    id_bling: d.id,
    loja_id,
    numero: d.numero,
    serie: d.serie != null ? String(d.serie) : null,
    chave_acesso: d.chaveAcesso || null,
    situacao: d.situacao,
    data_emissao: d.dataEmissao || null,
    data_operacao: d.dataOperacao && d.dataOperacao !== '0000-00-00 00:00:00' ? d.dataOperacao : null,
    tipo: d.tipo,
    valor_total: d.valorNota || null,
    valor_frete: d.valorFrete || null,
    cliente_id: d.contato?.id || null,
    cliente_nome: d.contato?.nome || null,
    cliente_cpf_cnpj: d.contato?.numeroDocumento || null,
    cliente_uf: clienteUf,
    cliente_ie: d.contato?.ie || null,
    vendedor_id: d.vendedor?.id || null,
    intermediador_cnpj: d.intermediador?.cnpj || null,
    intermediador_nome: d.intermediador?.nomeUsuario || null,
    natureza_operacao_id: d.naturezaOperacao?.id || null,
    numero_pedido_loja: d.numeroPedidoLoja || null,
    optante_simples: d.optanteSimplesNacional ?? null,
    cfop,
    consumidor_final: consumidorFinal,
    xml_url: d.xml || null,
    pdf_url: d.linkPDF || d.linkDanfe || null,
    raw: d,
    synced_at: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  const t0 = Date.now();
  const sb = getAdminClient();

  let dias_atras = 2;
  let full = false;
  try {
    const b = await req.json();
    if (b?.dias_atras) dias_atras = Math.min(Number(b.dias_atras), 365);
    if (b?.full) full = true;
  } catch { /* sem body */ }

  const resultados: Record<string, unknown>[] = [];

  for (const { empresa, loja_id } of LOJAS) {
    const { data: logRow } = await sb.from('bling_sync_log').insert({
      tabela: 'bling_nfe_saida', loja_id, iniciado_em: new Date().toISOString(),
      status: 'rodando', api_calls: 0,
    }).select('id').single();
    const logId = logRow?.id ?? null;

    let totalUpserted = 0, apiCalls = 0;

    try {
      const token = await getValidToken(sb, empresa);

      // Janela: full → 2025-01-01, senão últimos N dias OR baseado em max(synced_at)
      let desde: Date;
      if (full) {
        desde = new Date('2025-01-01T00:00:00Z');
      } else {
        const { data: maxRow } = await sb.from('bling_nfe_saida')
          .select('synced_at').eq('loja_id', loja_id)
          .order('synced_at', { ascending: false }).limit(1).single();
        if (maxRow?.synced_at) {
          desde = new Date(new Date(maxRow.synced_at).getTime() - 60 * 60 * 1000);
        } else {
          desde = new Date(Date.now() - dias_atras * 86400000);
        }
      }
      const ate = new Date();
      // Bling /nfe limita janela a ~90d
      const MAX_JANELA_MS = 80 * 86400 * 1000;
      if (ate.getTime() - desde.getTime() > MAX_JANELA_MS) {
        desde = new Date(ate.getTime() - MAX_JANELA_MS);
      }
      const desdeStr = desde.toISOString().split('T')[0];
      const ateStr = ate.toISOString().split('T')[0];

      // 1. Lista paginada (só ids)
      let pagina = 1;
      const idsParaDrill: number[] = [];
      while (true) {
        const r = await blingGet<{ data?: BlingNFeLista[] }>(
          token, '/nfe',
          { tipo: 1, pagina, limite: 100, dataEmissaoInicial: desdeStr, dataEmissaoFinal: ateStr }
        );
        apiCalls++;
        if (!r.ok) throw new Error(`bling /nfe?tipo=1 status=${r.status}: ${r.errorBody}`);
        const items = r.data?.data ?? [];
        if (!items.length) break;
        idsParaDrill.push(...items.map(i => i.id));
        if (items.length < 100) break;
        pagina++;
        await sleep(400);
      }

      // 2. Dedupe: skip IDs já no banco (sync incremental fica rápido)
      const idsNovos: number[] = [];
      if (idsParaDrill.length > 0 && !full) {
        for (let k = 0; k < idsParaDrill.length; k += 500) {
          const chunk = idsParaDrill.slice(k, k + 500);
          const { data: existentes } = await sb.from('bling_nfe_saida')
            .select('id_bling').in('id_bling', chunk);
          const existentesSet = new Set((existentes ?? []).map(e => Number(e.id_bling)));
          idsNovos.push(...chunk.filter(id => !existentesSet.has(id)));
        }
      } else {
        idsNovos.push(...idsParaDrill);
      }

      // 3. Drill por id. Deadline 130s pra fechar log antes do edge timeout 150s.
      const drillDeadline = t0 + 130_000;
      for (let i = 0; i < idsNovos.length; i += 5) {
        if (Date.now() > drillDeadline) break;
        const idsBatch = idsNovos.slice(i, i + 5);
        const results = await Promise.all(
          idsBatch.map(id => blingGet<{ data?: BlingNFeSaidaDetalhe }>(token, `/nfe/${id}`, {}))
        );
        apiCalls += idsBatch.length;

        const rows = [];
        for (const r of results) {
          if (!r.ok) continue;
          const d = r.data?.data;
          if (d) rows.push(mapSaida(d, loja_id));
        }

        if (rows.length) {
          const { error } = await sb.from('bling_nfe_saida').upsert(rows, { onConflict: 'id_bling' });
          if (error) throw new Error(`upsert bling_nfe_saida: ${error.message}`);
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
      resultados.push({ empresa, loja_id, lidos: idsParaDrill.length, novos: idsNovos.length, upserted: totalUpserted, dur_ms: dur, status: ranOut ? 'parcial' : 'ok' });

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
