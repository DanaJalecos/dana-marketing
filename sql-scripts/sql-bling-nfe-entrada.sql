-- ════════════════════════════════════════════════════════════════════════════
-- BLING SYNC v3 — NFe DE ENTRADA (LOTE 1 / DIA 4, primeira tabela real do plano)
-- Schema espelho de GET /nfe?tipo=0&dataAlteracaoInicial=...
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.bling_nfe_entrada (
  id_bling           bigint        PRIMARY KEY,
  loja_id            int           NOT NULL,
  numero             text          NOT NULL,
  serie              text,
  chave_acesso       text          UNIQUE,
  situacao           int           NOT NULL,
  -- 1 Pendente | 2 Cancelada | 3 Aguardando recibo | 4 Rejeitada | 5 Autorizada
  -- 6 Emitida DANFE | 7 Registrada | 8 Aguardando emissão | 9 Denegada
  data_emissao       timestamptz   NOT NULL,
  data_entrada       timestamptz,
  valor_total        numeric(14,2),
  valor_produtos     numeric(14,2),
  valor_frete        numeric(14,2),
  valor_desconto     numeric(14,2),
  valor_outras_desp  numeric(14,2),
  fornecedor_cnpj    text,
  fornecedor_nome    text,
  fornecedor_id      bigint,                   -- FK soft pra contatos.id
  natureza_operacao  text,
  cfop               text,
  observacoes        text,
  xml_url            text,                     -- URL XML (acesso Bearer)
  pdf_url            text,                     -- linkPDF / linkDanfe
  raw                jsonb         NOT NULL,
  synced_at          timestamptz   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bne_loja_data
  ON public.bling_nfe_entrada (loja_id, data_emissao DESC);
CREATE INDEX IF NOT EXISTS idx_bne_fornecedor
  ON public.bling_nfe_entrada (fornecedor_cnpj);
CREATE INDEX IF NOT EXISTS idx_bne_situacao
  ON public.bling_nfe_entrada (situacao);
CREATE INDEX IF NOT EXISTS idx_bne_synced
  ON public.bling_nfe_entrada (synced_at DESC);

-- RLS
ALTER TABLE public.bling_nfe_entrada ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bne_service_all ON public.bling_nfe_entrada;
CREATE POLICY bne_service_all ON public.bling_nfe_entrada
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bne_auth_sel ON public.bling_nfe_entrada;
CREATE POLICY bne_auth_sel ON public.bling_nfe_entrada
  FOR SELECT TO authenticated USING (true);

COMMIT;
