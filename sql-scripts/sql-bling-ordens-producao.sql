-- ════════════════════════════════════════════════════════════════════════════
-- BLING LOTE 3 — bling_ordens_producao (opcional — roadmap futuro)
-- GET /ordens-producao — capacidade de produção, gargalos
-- Volume baixo. Cron 6h.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.bling_ordens_producao (
  id_bling          bigint        PRIMARY KEY,
  loja_id           int           NOT NULL,
  numero            text          NOT NULL,
  data_abertura     date          NOT NULL,
  data_conclusao    date,
  situacao_id       int,
  situacao_nome     text,
  produto_id        bigint,
  produto_nome      text,
  qtd_planejada     numeric(14,3),
  qtd_produzida     numeric(14,3),
  observacoes       text,
  raw               jsonb         NOT NULL,
  synced_at         timestamptz   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bop_loja_data       ON public.bling_ordens_producao (loja_id, data_abertura DESC);
CREATE INDEX IF NOT EXISTS idx_bop_produto         ON public.bling_ordens_producao (produto_id);
CREATE INDEX IF NOT EXISTS idx_bop_situacao        ON public.bling_ordens_producao (situacao_id);
CREATE INDEX IF NOT EXISTS idx_bop_abertas         ON public.bling_ordens_producao (loja_id, data_abertura DESC) WHERE data_conclusao IS NULL;

ALTER TABLE public.bling_ordens_producao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bop_service_all ON public.bling_ordens_producao;
CREATE POLICY bop_service_all ON public.bling_ordens_producao
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bop_auth_sel ON public.bling_ordens_producao;
CREATE POLICY bop_auth_sel ON public.bling_ordens_producao
  FOR SELECT TO authenticated USING (true);

COMMIT;
