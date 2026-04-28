-- ══════════════════════════════════════════════════════════
-- Criativos Fase 2: To-Do Design + Publicados
-- 1) Torna arquivo_url nullable (demandas to-do não têm arquivo ainda)
-- 2) Adiciona colunas: solicitado_por, prioridade, prazo_entrega
-- ══════════════════════════════════════════════════════════

-- 1. arquivo_url nullable (demandas sem arte ainda)
ALTER TABLE criativos ALTER COLUMN arquivo_url DROP NOT NULL;

-- 2. Novas colunas pra demandas
ALTER TABLE criativos
  ADD COLUMN IF NOT EXISTS solicitado_por UUID,
  ADD COLUMN IF NOT EXISTS solicitado_por_nome TEXT,
  ADD COLUMN IF NOT EXISTS prioridade TEXT CHECK (prioridade IN ('alta','media','baixa')),
  ADD COLUMN IF NOT EXISTS prazo_entrega DATE;

-- Index pro To-Do (ordenação por prazo/prioridade)
CREATE INDEX IF NOT EXISTS idx_criativos_todo_prazo
  ON criativos(prazo_entrega)
  WHERE status = 'todo';

SELECT 'Migration Fase 2 dos criativos aplicada' AS status;
