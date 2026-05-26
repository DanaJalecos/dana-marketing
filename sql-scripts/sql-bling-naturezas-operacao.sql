-- ════════════════════════════════════════════════════════════════════════════
-- BLING SYNC v3 — NATUREZAS DE OPERAÇÃO (LOTE 3 / Tabela 1)
-- Schema espelho de GET /naturezas-operacoes (cadastro paginado).
-- Cruza com bling_nfe_entrada/saida.natureza_operacao (campo texto livre)
-- pra dar enrich indexado pelo Finance AI.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.bling_naturezas_operacao (
  id_bling        bigint        PRIMARY KEY,
  loja_id         int           NOT NULL,
  descricao       text          NOT NULL,
  tipo            int,                                  -- 0 Entrada | 1 Saída
  situacao        int,                                  -- 0 Inativo | 1 Ativo
  cfop            text,                                 -- CFOP default da natureza (quando aplicável)
  finalidade      int,                                  -- 1 Normal | 2 Compl. | 3 Ajuste | 4 Devolução
  serie           text,
  modelo          text,                                 -- 55 NFe | 65 NFCe | 57 CTe
  observacoes     text,
  raw             jsonb         NOT NULL,
  synced_at       timestamptz   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bno_loja
  ON public.bling_naturezas_operacao (loja_id);
CREATE INDEX IF NOT EXISTS idx_bno_descricao_lower
  ON public.bling_naturezas_operacao (lower(descricao));
CREATE INDEX IF NOT EXISTS idx_bno_situacao
  ON public.bling_naturezas_operacao (situacao) WHERE situacao = 1;
CREATE INDEX IF NOT EXISTS idx_bno_tipo
  ON public.bling_naturezas_operacao (tipo);

-- RLS
ALTER TABLE public.bling_naturezas_operacao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bno_service_all ON public.bling_naturezas_operacao;
CREATE POLICY bno_service_all ON public.bling_naturezas_operacao
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bno_auth_sel ON public.bling_naturezas_operacao;
CREATE POLICY bno_auth_sel ON public.bling_naturezas_operacao
  FOR SELECT TO authenticated USING (true);

COMMIT;
