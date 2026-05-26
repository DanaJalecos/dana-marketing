-- ════════════════════════════════════════════════════════════════════════════
-- BLING LOTE 3 — bling_caixas_movimentacoes (lançamentos caixa/banco)
-- GET /caixas — lançamentos do livro caixa Bling (R/P)
-- Pra que serve: FAI cruza com OFX bancário pra detectar divergência
-- Volume: ~100/dia. Cron 1h.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.bling_caixas_movimentacoes (
  id_bling                bigint        PRIMARY KEY,
  loja_id                 int           NOT NULL,
  data                    date          NOT NULL,
  descricao               text,
  categoria_id            bigint,                                -- FK soft bling_categorias
  categoria_nome          text,                                  -- denormalizado
  conta_financeira_id     bigint        NOT NULL,
  conta_financeira_nome   text,
  valor                   numeric(14,2) NOT NULL,
  situacao                text          NOT NULL,                -- 'R' (realizado) · 'P' (previsto)
  situacao_conciliacao    int,                                   -- 1 Conciliado · 2 Não conciliado · 3 Divergência
  origem_id               bigint,                                -- vínculo com fonte (conta_pagar, conta_receber, manual)
  origem_tipo             text,                                  -- 'conta_pagar', 'conta_receber', 'transferencia', 'manual'
  documento               text,                                  -- referência externa (NF, boleto)
  raw                     jsonb         NOT NULL,
  synced_at               timestamptz   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bcm_loja_data          ON public.bling_caixas_movimentacoes (loja_id, data DESC);
CREATE INDEX IF NOT EXISTS idx_bcm_conta_data         ON public.bling_caixas_movimentacoes (conta_financeira_id, data DESC);
CREATE INDEX IF NOT EXISTS idx_bcm_nao_conciliado     ON public.bling_caixas_movimentacoes (situacao_conciliacao) WHERE situacao_conciliacao = 2;
CREATE INDEX IF NOT EXISTS idx_bcm_realizado          ON public.bling_caixas_movimentacoes (data DESC) WHERE situacao = 'R';
CREATE INDEX IF NOT EXISTS idx_bcm_categoria          ON public.bling_caixas_movimentacoes (categoria_id);
CREATE INDEX IF NOT EXISTS idx_bcm_origem             ON public.bling_caixas_movimentacoes (origem_tipo, origem_id);

ALTER TABLE public.bling_caixas_movimentacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bcm_service_all ON public.bling_caixas_movimentacoes;
CREATE POLICY bcm_service_all ON public.bling_caixas_movimentacoes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bcm_auth_sel ON public.bling_caixas_movimentacoes;
CREATE POLICY bcm_auth_sel ON public.bling_caixas_movimentacoes
  FOR SELECT TO authenticated USING (true);

COMMIT;
