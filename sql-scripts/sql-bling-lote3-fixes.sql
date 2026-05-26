-- ════════════════════════════════════════════════════════════════════════════
-- BLING LOTE 3 — Fixes prévios + ajustes pedidos Finance AI
-- 1. tem_nf em bling_pedidos_compras → COALESCE pra array vazio (não null)
-- 2. tipo_operacao em bling_nfe_entrada → generated column indexável (pedido FAI)
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 1: tem_nf em bling_pedidos_compras
-- Problema: array_length([], 1) retorna NULL em vez de 0
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.bling_pedidos_compras
  DROP COLUMN IF EXISTS tem_nf;

ALTER TABLE public.bling_pedidos_compras
  ADD COLUMN tem_nf boolean GENERATED ALWAYS AS (
    COALESCE(array_length(nf_entrada_ids, 1), 0) > 0
  ) STORED;

-- Recriar índice
DROP INDEX IF EXISTS public.idx_bpc_tem_nf;
CREATE INDEX idx_bpc_tem_nf
  ON public.bling_pedidos_compras (tem_nf) WHERE tem_nf = false;

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 2: tipo_operacao em bling_nfe_entrada (pedido FAI — facilita filtros)
-- Classifica por CFOP do primeiro item:
--   compra_mercadoria     → 5101/5102/5151 (entrada SC), 6102/6105/6151 (outro UF)
--   compra_uso_consumo    → 5556/2556/1556
--   devolucao_cliente     → 1201/2201/1915/2915/1902/2902
--   aluguel_locacao       → 2914
--   outros                → demais (frete, transferência, etc)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.bling_nfe_entrada
  ADD COLUMN tipo_operacao text GENERATED ALWAYS AS (
    CASE
      WHEN cfop ~ '^[56](101|102|151)$' THEN 'compra_mercadoria'
      WHEN cfop ~ '^[1256]556$'         THEN 'compra_uso_consumo'
      WHEN cfop ~ '^[12](201|902|915)$' THEN 'devolucao_cliente'
      WHEN cfop = '2914'                THEN 'aluguel_locacao'
      ELSE 'outros'
    END
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_bne_tipo_operacao
  ON public.bling_nfe_entrada (tipo_operacao);

COMMIT;

-- Validação: distribuição esperada (FAI rodou esses números 26/05/2026)
-- compra_mercadoria     ≈ 491 (R$ 2.4M)
-- outros                ≈ 200 (R$ 3.2M de aluguel/locação)
-- devolucao_cliente     ≈ 434 (R$ 227k)
-- compra_uso_consumo    ≈ 161 (R$ 198k)
