-- ════════════════════════════════════════════════════════════════════════════
-- BLING LOTE 3 — bling_contas_financeiras (cadastro banco/caixa)
-- GET /contas-contabeis — cadastro de contas correntes no Bling
-- Pra que serve: FAI cruza com finance.bancos_contas (cadastro manual)
-- Volume: ~10 registros. Cron 1×/dia.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.bling_contas_financeiras (
  id_bling          bigint        PRIMARY KEY,
  loja_id           int           NOT NULL,
  nome              text          NOT NULL,
  tipo              text,                                  -- 'caixa', 'banco', 'cartao_credito'
  banco_id          bigint,
  banco_nome        text,
  agencia           text,
  conta             text,
  digito            text,
  saldo_inicial     numeric(14,2),
  situacao          int,                                   -- 0 Inativo · 1 Ativo
  raw               jsonb         NOT NULL,
  synced_at         timestamptz   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bcf_loja          ON public.bling_contas_financeiras (loja_id);
CREATE INDEX IF NOT EXISTS idx_bcf_tipo          ON public.bling_contas_financeiras (tipo);
CREATE INDEX IF NOT EXISTS idx_bcf_ativos        ON public.bling_contas_financeiras (loja_id) WHERE situacao = 1;

ALTER TABLE public.bling_contas_financeiras ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bcf_service_all ON public.bling_contas_financeiras;
CREATE POLICY bcf_service_all ON public.bling_contas_financeiras
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bcf_auth_sel ON public.bling_contas_financeiras;
CREATE POLICY bcf_auth_sel ON public.bling_contas_financeiras
  FOR SELECT TO authenticated USING (true);

COMMIT;
