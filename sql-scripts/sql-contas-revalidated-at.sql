-- ════════════════════════════════════════════════════════════════════════════
-- Compact/22A: coluna revalidated_at em contas_pagar/contas_receber
-- Drill batch sistêmico precisa ordenar pelos mais antigos pra distribuir
-- revalidações no tempo (cada conta visitada a cada N horas).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.contas_pagar
  ADD COLUMN IF NOT EXISTS revalidated_at timestamptz;

ALTER TABLE public.contas_receber
  ADD COLUMN IF NOT EXISTS revalidated_at timestamptz;

-- Indices pra otimizar ORDER BY revalidated_at NULLS FIRST LIMIT 500
CREATE INDEX IF NOT EXISTS idx_cp_revalidate
  ON public.contas_pagar (empresa, revalidated_at NULLS FIRST, id);
CREATE INDEX IF NOT EXISTS idx_cr_revalidate
  ON public.contas_receber (empresa, revalidated_at NULLS FIRST, id);

COMMIT;
