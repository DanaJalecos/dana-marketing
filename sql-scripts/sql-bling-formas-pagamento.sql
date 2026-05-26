-- ════════════════════════════════════════════════════════════════════════════
-- BLING LOTE 3 — bling_formas_pagamento (taxas)
-- GET /formas-pagamentos — cadastro de formas de recebimento Bling
-- Pra que serve: FAI compara taxa esperada vs realizada (PIX, cartão N×, etc)
-- Volume: ~10 registros. Cron 1×/dia.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.bling_formas_pagamento (
  id_bling          bigint        PRIMARY KEY,
  loja_id           int           NOT NULL,
  descricao         text          NOT NULL,
  tipo_pagamento    int,                                   -- enum Bling: 1 dinheiro, 3 cartão crédito, etc
  taxa_aliquota     numeric(6,3),                          -- % taxa
  taxa_valor        numeric(14,2),                         -- valor fixo
  prazo_dias        int,                                   -- prazo recebimento
  situacao          int,                                   -- 0 Inativo · 1 Ativo
  raw               jsonb         NOT NULL,
  synced_at         timestamptz   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bfp_loja           ON public.bling_formas_pagamento (loja_id);
CREATE INDEX IF NOT EXISTS idx_bfp_tipo           ON public.bling_formas_pagamento (tipo_pagamento);
CREATE INDEX IF NOT EXISTS idx_bfp_ativos         ON public.bling_formas_pagamento (loja_id) WHERE situacao = 1;

ALTER TABLE public.bling_formas_pagamento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bfp_service_all ON public.bling_formas_pagamento;
CREATE POLICY bfp_service_all ON public.bling_formas_pagamento
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bfp_auth_sel ON public.bling_formas_pagamento;
CREATE POLICY bfp_auth_sel ON public.bling_formas_pagamento
  FOR SELECT TO authenticated USING (true);

COMMIT;
