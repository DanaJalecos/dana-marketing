-- ════════════════════════════════════════════════════════════════════════════
-- BLING SYNC v3 — NFSe (LOTE 2 / DIA 2)
-- Schema espelho de GET /nfse (NFs de Serviço — Marina confere costureiras)
-- Volume baixo (~50/mês), sync diário/horário leve.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.bling_nfse (
  id_bling           bigint        PRIMARY KEY,
  loja_id            int           NOT NULL,
  numero             text,                          -- pode vir vazio se ainda pendente
  numero_rps         text,                          -- número Recibo Provisório Serviço
  serie_rps          text,
  situacao           int           NOT NULL,
  -- 0 Pendente | 1 Emitida | 2 Disponível p/ consulta | 3 Cancelada | 4 Rejeitada
  data_emissao       timestamptz,
  codigo_servico     text,
  discriminacao      text,                          -- descrição peça/qtd
  valor_total        numeric(14,2),
  valor_iss          numeric(14,2),
  aliquota_iss       numeric(5,2),
  base_calculo       numeric(14,2),
  retencao_iss       boolean,
  -- Tomador (costureira/prestadora do serviço pra Dana)
  tomador_cpf_cnpj   text,
  tomador_nome       text,
  tomador_id         bigint,                        -- FK soft pra contatos
  -- Prestador (Dana)
  prestador_cnpj     text,
  observacoes        text,
  raw                jsonb         NOT NULL,
  synced_at          timestamptz   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bnfse_loja_data
  ON public.bling_nfse (loja_id, data_emissao DESC);
CREATE INDEX IF NOT EXISTS idx_bnfse_tomador
  ON public.bling_nfse (tomador_cpf_cnpj);
CREATE INDEX IF NOT EXISTS idx_bnfse_situacao
  ON public.bling_nfse (situacao);
CREATE INDEX IF NOT EXISTS idx_bnfse_synced
  ON public.bling_nfse (synced_at DESC);

-- RLS
ALTER TABLE public.bling_nfse ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bnfse_service_all ON public.bling_nfse;
CREATE POLICY bnfse_service_all ON public.bling_nfse
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bnfse_auth_sel ON public.bling_nfse;
CREATE POLICY bnfse_auth_sel ON public.bling_nfse
  FOR SELECT TO authenticated USING (true);

COMMIT;
