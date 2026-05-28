// ════════════════════════════════════════════════════════════════════════════
// _shared/contas-drill.ts
// Drill em /contas/pagar/{id} ou /contas/receber/{id} pra popular
// forma_pagamento_id, conta_financeira_id, categoria_id.
// LIST do Bling não traz esses campos — só vem no drill por ID.
// Pedido FAI 28/05.
// ════════════════════════════════════════════════════════════════════════════

import { blingGet, sleep } from './bling-client.ts';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

interface BlingContaDetalhe {
  id: number;
  formaPagamento?: { id?: number };
  portador?: { id?: number };          // = conta financeira
  categoria?: { id?: number };
}

/**
 * Drilla N IDs em /contas/{tipo}/{id} e atualiza forma_pagamento_id,
 * conta_financeira_id, categoria_id na tabela alvo.
 *
 * Respeita rate-limit Bling: 3 paralelos + sleep 350ms = ~3 req/s.
 * Para no deadline (default 130s = edge timeout 150s - margem).
 *
 * Returns: { drilled: nº de drills OK, deadline_hit: boolean }
 */
export async function drillContas(args: {
  sb: SupabaseClient;
  token: string;
  tipo: 'pagar' | 'receber';     // contas a pagar ou receber
  tabela: 'contas_pagar' | 'contas_receber';
  ids: number[];
  deadline_ms: number;
  empresa?: string;              // só pra log
}): Promise<{ drilled: number; deadline_hit: boolean; api_calls: number }> {
  const { sb, token, tipo, tabela, ids, deadline_ms } = args;
  let drilled = 0;
  let api_calls = 0;
  let deadline_hit = false;

  for (let i = 0; i < ids.length; i += 3) {
    if (Date.now() > deadline_ms) {
      deadline_hit = true;
      break;
    }
    const batch = ids.slice(i, i + 3);
    const results = await Promise.all(
      batch.map(id => blingGet<{ data?: BlingContaDetalhe }>(token, `/contas/${tipo}/${id}`, {}))
    );
    api_calls += batch.length;

    // Update um por um (cada conta tem campos próprios)
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (!r.ok) continue;
      const d = r.data?.data;
      if (!d) continue;
      const update = {
        forma_pagamento_id:  d.formaPagamento?.id ?? null,
        conta_financeira_id: d.portador?.id       ?? null,
        categoria_id:        d.categoria?.id      ?? null,
      };
      // Só atualiza se tiver pelo menos um campo válido (evita zerar)
      if (update.forma_pagamento_id === null && update.conta_financeira_id === null && update.categoria_id === null) {
        continue;
      }
      const { error } = await sb.from(tabela).update(update).eq('id', batch[j]);
      if (!error) drilled++;
    }
    await sleep(350);
  }
  return { drilled, deadline_hit, api_calls };
}
