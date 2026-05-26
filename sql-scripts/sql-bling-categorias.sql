-- ════════════════════════════════════════════════════════════════════════════
-- BLING LOTE 3 — bling_categorias (DRE)
-- GET /categorias/receitas-despesas — plano de contas Bling
-- Pra que serve: FAI gera DRE automático por categoria
-- Volume: ~50 registros. Cron 1×/dia.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.bling_categorias (
  id_bling          bigint        PRIMARY KEY,
  loja_id           int           NOT NULL,
  nome              text          NOT NULL,
  tipo              text,                                  -- 'receita', 'despesa'
  categoria_pai_id  bigint,                                -- hierarquia
  situacao          int,                                   -- 0 Inativo · 1 Ativo
  raw               jsonb         NOT NULL,
  synced_at         timestamptz   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bcat_loja          ON public.bling_categorias (loja_id);
CREATE INDEX IF NOT EXISTS idx_bcat_tipo          ON public.bling_categorias (tipo);
CREATE INDEX IF NOT EXISTS idx_bcat_pai           ON public.bling_categorias (categoria_pai_id);
CREATE INDEX IF NOT EXISTS idx_bcat_ativos        ON public.bling_categorias (loja_id) WHERE situacao = 1;

ALTER TABLE public.bling_categorias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bcat_service_all ON public.bling_categorias;
CREATE POLICY bcat_service_all ON public.bling_categorias
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bcat_auth_sel ON public.bling_categorias;
CREATE POLICY bcat_auth_sel ON public.bling_categorias
  FOR SELECT TO authenticated USING (true);

COMMIT;
