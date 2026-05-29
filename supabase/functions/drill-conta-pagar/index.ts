// ════════════════════════════════════════════════════════════════════════════
// drill-conta-pagar — Pedido FAI msg 21 (parte B)
// Refresh manual de 1 conta a pagar pelo id.
// Body: { id: <number>, empresa?: 'matriz' | 'bc' }
// ════════════════════════════════════════════════════════════════════════════

import { getAdminClient, getValidToken, Empresa } from '../_shared/bling-oauth.ts';
import { blingGet } from '../_shared/bling-client.ts';

interface BlingContaPagarDetalhe {
  id: number;
  situacao?: number;
  vencimento?: string;
  valor?: number;
  dataEmissao?: string;
  contato?: { id?: number };
  formaPagamento?: { id?: number };
  portador?: { id?: number };
  categoria?: { id?: number };
}

function detectMudancas(before: Record<string, unknown> | null, after: Record<string, unknown>): string[] {
  if (!before) return ['novo (não estava no banco)'];
  const out: string[] = [];
  const cols = ['situacao', 'vencimento', 'valor', 'forma_pagamento_id', 'conta_financeira_id', 'categoria_id'];
  for (const c of cols) {
    const b = before[c];
    const a = after[c];
    const bn = b == null ? null : (typeof b === 'object' ? b : String(b));
    const an = a == null ? null : (typeof a === 'object' ? a : String(a));
    if (String(bn) !== String(an)) out.push(`${c} ${bn ?? 'null'}→${an ?? 'null'}`);
  }
  return out;
}

Deno.serve(async (req) => {
  const t0 = Date.now();

  let id: number;
  let empresaHint: Empresa | undefined;
  try {
    const body = await req.json();
    id = Number(body?.id);
    if (!id) throw new Error('id obrigatório');
    if (body?.empresa === 'matriz' || body?.empresa === 'bc') empresaHint = body.empresa;
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: `body inválido: ${(e as Error).message}` }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const sb = getAdminClient();

  const { data: existing } = await sb.from('contas_pagar')
    .select('id, situacao, vencimento, valor, forma_pagamento_id, conta_financeira_id, categoria_id, empresa')
    .eq('id', id).maybeSingle();

  const empresa: Empresa = (existing?.empresa as Empresa | undefined) || empresaHint || 'matriz';

  try {
    const token = await getValidToken(sb, empresa);
    const r = await blingGet<{ data?: BlingContaPagarDetalhe }>(token, `/contas/pagar/${id}`, {});

    if (r.status === 404) {
      if (existing) {
        await sb.from('contas_pagar').update({ situacao: 3 }).eq('id', id);
      }
      return new Response(JSON.stringify({
        ok: true, removed: true, empresa, msg: 'conta não existe mais no Bling, marcada situacao=3',
        dur_ms: Date.now() - t0,
      }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (!r.ok) {
      return new Response(JSON.stringify({
        ok: false, error: `bling status=${r.status}: ${r.errorBody}`, dur_ms: Date.now() - t0,
      }), { status: r.status === 401 ? 401 : 502, headers: { 'Content-Type': 'application/json' } });
    }

    const d = r.data?.data;
    if (!d) {
      return new Response(JSON.stringify({ ok: false, error: 'bling retornou sem data', dur_ms: Date.now() - t0 }),
        { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    const update = {
      situacao: d.situacao ?? null,
      vencimento: d.vencimento ?? null,
      valor: d.valor ?? 0,
      contato_id: d.contato?.id ?? 0,
      forma_pagamento_id: d.formaPagamento?.id ?? null,
      conta_financeira_id: d.portador?.id ?? null,
      categoria_id: d.categoria?.id ?? null,
      empresa,
    };

    const mudancas = detectMudancas(existing as Record<string, unknown> | null, update as Record<string, unknown>);

    if (existing) {
      const { error } = await sb.from('contas_pagar').update(update).eq('id', id);
      if (error) throw new Error(`update: ${error.message}`);
    } else {
      const { error } = await sb.from('contas_pagar').upsert({ id, ...update }, { onConflict: 'id' });
      if (error) throw new Error(`upsert: ${error.message}`);
    }

    return new Response(JSON.stringify({
      ok: true, empresa, updated: update, mudancas,
      dur_ms: Date.now() - t0,
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (e) {
    const msg = String((e as Error).message || e).slice(0, 500);
    return new Response(JSON.stringify({ ok: false, error: msg, dur_ms: Date.now() - t0 }),
      { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
