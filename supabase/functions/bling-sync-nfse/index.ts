// ════════════════════════════════════════════════════════════════════════════
// bling-sync-nfse — Lote 2 Dia 2
// Sincroniza GET /nfse (NFs de serviço pra Marina conferir costureiras).
// Volume baixo (~50/mês), cron 4h é suficiente.
//
// IMPORTANTE: não vi payload real ainda (rate limit do Bling durante bootstrap
// nfe-saida). Mapping segue o pedido original Finance AI §5.3.
// Se algum campo divergir → vai no raw, ajusta depois.
// ════════════════════════════════════════════════════════════════════════════

import { getAdminClient, getValidToken, Empresa } from '../_shared/bling-oauth.ts';
import { blingGet, sleep } from '../_shared/bling-client.ts';

const LOJAS: { empresa: Empresa; loja_id: number }[] = [
  { empresa: 'matriz', loja_id: 203536978 },
  { empresa: 'bc',     loja_id: 203550865 },
];

// Schema mais defensivo — tudo opcional, deixa o raw guardar o real
interface BlingNFSeItem {
  id: number;
  numero?: string;
  numeroRps?: string;
  serieRps?: string;
  situacao: number;
  dataEmissao?: string;
  codigoServico?: string;
  discriminacao?: string;
  valorServicos?: number; valor?: number; valorTotal?: number;
  valorIss?: number;
  aliquotaIss?: number; aliquota?: number;
  baseCalculo?: number;
  retencaoIss?: boolean;
  tomador?: { id?: number; nome?: string; numeroDocumento?: string; cpfCnpj?: string };
  prestador?: { numeroDocumento?: string; cnpj?: string };
  observacoes?: string;
}

function mapNfse(d: BlingNFSeItem, loja_id: number) {
  return {
    id_bling: d.id,
    loja_id,
    numero: d.numero || null,
    numero_rps: d.numeroRps || null,
    serie_rps: d.serieRps || null,
    situacao: d.situacao,
    data_emissao: d.dataEmissao || null,
    codigo_servico: d.codigoServico || null,
    discriminacao: d.discriminacao || null,
    valor_total: d.valorServicos ?? d.valorTotal ?? d.valor ?? null,
    valor_iss: d.valorIss ?? null,
    aliquota_iss: d.aliquotaIss ?? d.aliquota ?? null,
    base_calculo: d.baseCalculo ?? null,
    retencao_iss: d.retencaoIss ?? null,
    tomador_cpf_cnpj: d.tomador?.numeroDocumento ?? d.tomador?.cpfCnpj ?? null,
    tomador_nome: d.tomador?.nome ?? null,
    tomador_id: d.tomador?.id ?? null,
    prestador_cnpj: d.prestador?.numeroDocumento ?? d.prestador?.cnpj ?? null,
    observacoes: d.observacoes ?? null,
    raw: d,
    synced_at: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  const t0 = Date.now();
  const sb = getAdminClient();

  let dias_atras = 90; // NFSe é mensal, janela maior default
  let full = false;
  try {
    const b = await req.json();
    if (b?.dias_atras) dias_atras = Math.min(Number(b.dias_atras), 365);
    if (b?.full) full = true;
  } catch { /* sem body */ }

  const resultados: Record<string, unknown>[] = [];

  for (const { empresa, loja_id } of LOJAS) {
    const { data: logRow } = await sb.from('bling_sync_log').insert({
      tabela: 'bling_nfse', loja_id, iniciado_em: new Date().toISOString(),
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
        const { data: maxRow } = await sb.from('bling_nfse')
          .select('synced_at').eq('loja_id', loja_id)
          .order('synced_at', { ascending: false }).limit(1).single();
        if (maxRow?.synced_at) {
          desde = new Date(new Date(maxRow.synced_at).getTime() - 60 * 60 * 1000);
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

      // NFSe geralmente retorna detalhes já na lista (volume baixo). Sem drill.
      let pagina = 1;
      while (true) {
        const r = await blingGet<{ data?: BlingNFSeItem[] }>(
          token, '/nfse',
          { pagina, limite: 100, dataEmissaoInicial: desdeStr, dataEmissaoFinal: ateStr }
        );
        apiCalls++;
        if (!r.ok) throw new Error(`bling /nfse status=${r.status}: ${r.errorBody}`);
        const items = r.data?.data ?? [];
        if (!items.length) break;

        const rows = items.map(i => mapNfse(i, loja_id));
        const { error } = await sb.from('bling_nfse').upsert(rows, { onConflict: 'id_bling' });
        if (error) throw new Error(`upsert bling_nfse: ${error.message}`);
        totalUpserted += rows.length;

        if (items.length < 100) break;
        pagina++;
        await sleep(400);
      }

      const dur = Date.now() - t0;
      if (logId) await sb.from('bling_sync_log').update({
        finalizado_em: new Date().toISOString(),
        duracao_ms: dur,
        desde: desde.toISOString(),
        ate: ate.toISOString(),
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
    await sleep(1500);
  }

  const hasError = resultados.some(r => r.status === 'erro');
  return new Response(JSON.stringify({ ok: !hasError, resultados, modo: full ? 'full' : `incremental_${dias_atras}d` }),
    { status: hasError ? 207 : 200, headers: { 'Content-Type': 'application/json' } });
});
