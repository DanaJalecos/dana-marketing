-- ════════════════════════════════════════════════════════════════════════════
-- BLING LOTE 3 — bling_borderos (remessas bancárias)
-- GET /borderos/{id} — não tem listagem; lazy enrich via contas_pagar.raw
-- Pra que serve: Renato lota remessa pra pagar lote de contas; FAI cruza com OFX
-- Volume: ~5/dia. Cron 6h (descoberta via diff em contas_pagar)
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.bling_borderos (
  id_bling           bigint        PRIMARY KEY,
  loja_id            int           NOT NULL,
  numero             text          NOT NULL,
  data               date          NOT NULL,
  data_pagamento     date,
  valor_total        numeric(14,2),
  banco_id           bigint,
  banco_nome         text,
  conta_id           bigint,
  situacao           int,                                       -- 1 Aberta · 2 Conciliada · 3 Cancelada
  contas_pagar_ids   bigint[]      DEFAULT ARRAY[]::bigint[],   -- IDs das contas no bordero
  tem_conta          boolean       GENERATED ALWAYS AS (
    COALESCE(array_length(contas_pagar_ids, 1), 0) > 0
  ) STORED,
  raw                jsonb         NOT NULL,
  synced_at          timestamptz   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bbo_loja_data        ON public.bling_borderos (loja_id, data DESC);
CREATE INDEX IF NOT EXISTS idx_bbo_pagamento        ON public.bling_borderos (data_pagamento);
CREATE INDEX IF NOT EXISTS idx_bbo_banco            ON public.bling_borderos (banco_id);
CREATE INDEX IF NOT EXISTS idx_bbo_contas_pagar     ON public.bling_borderos USING gin (contas_pagar_ids);
CREATE INDEX IF NOT EXISTS idx_bbo_situacao         ON public.bling_borderos (situacao);

ALTER TABLE public.bling_borderos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bbo_service_all ON public.bling_borderos;
CREATE POLICY bbo_service_all ON public.bling_borderos
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bbo_auth_sel ON public.bling_borderos;
CREATE POLICY bbo_auth_sel ON public.bling_borderos
  FOR SELECT TO authenticated USING (true);

COMMIT;
