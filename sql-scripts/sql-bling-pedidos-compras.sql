-- ════════════════════════════════════════════════════════════════════════════
-- BLING SYNC v3 — PEDIDOS DE COMPRAS (LOTE 2 / DIA 3)
-- Schema espelho de GET /pedidos/compras + drill /pedidos/compras/{id}
-- PRIORIDADE ALTA pelo Finance AI: investigar campo notaFiscal.id pra vincular
-- pedido de compra → bling_nfe_entrada.
--
-- ✅ Confirmado via API: pedido.itens[*].notaFiscal.id existe.
-- Quando != 0, vincula com a NF de entrada que foi gerada/importada.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.bling_pedidos_compras (
  id_bling           bigint        PRIMARY KEY,
  loja_id            int           NOT NULL,
  numero             text          NOT NULL,
  data               date          NOT NULL,
  data_prevista      date,
  fornecedor_id      bigint,
  fornecedor_cnpj    text,                          -- preenchido se drill trouxer
  fornecedor_nome    text,
  valor_total        numeric(14,2),
  valor_produtos     numeric(14,2),
  situacao_id        int,
  situacao_valor     int,                           -- estado financeiro
  ordem_compra       text,
  observacoes        text,
  observacoes_internas text,
  -- ⭐ Vínculo com bling_nfe_entrada via itens[*].notaFiscal.id
  nf_entrada_ids     bigint[]      DEFAULT ARRAY[]::bigint[],
  tem_nf             boolean       GENERATED ALWAYS AS (
    array_length(nf_entrada_ids, 1) > 0
  ) STORED,
  raw                jsonb         NOT NULL,
  synced_at          timestamptz   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bpc_loja_data
  ON public.bling_pedidos_compras (loja_id, data DESC);
CREATE INDEX IF NOT EXISTS idx_bpc_fornecedor
  ON public.bling_pedidos_compras (fornecedor_id);
CREATE INDEX IF NOT EXISTS idx_bpc_situacao
  ON public.bling_pedidos_compras (situacao_id);
CREATE INDEX IF NOT EXISTS idx_bpc_tem_nf
  ON public.bling_pedidos_compras (tem_nf) WHERE tem_nf = false;
CREATE INDEX IF NOT EXISTS idx_bpc_nfs
  ON public.bling_pedidos_compras USING gin (nf_entrada_ids);

-- RLS
ALTER TABLE public.bling_pedidos_compras ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bpc_service_all ON public.bling_pedidos_compras;
CREATE POLICY bpc_service_all ON public.bling_pedidos_compras
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bpc_auth_sel ON public.bling_pedidos_compras;
CREATE POLICY bpc_auth_sel ON public.bling_pedidos_compras
  FOR SELECT TO authenticated USING (true);

COMMIT;
