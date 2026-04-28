-- ══════════════════════════════════════════════════════════
-- Migration: adicionar coluna aprovacao_comentario em criativos
-- Permite deixar observação opcional ao aprovar arte
-- ══════════════════════════════════════════════════════════

ALTER TABLE criativos ADD COLUMN IF NOT EXISTS aprovacao_comentario TEXT;

SELECT 'aprovacao_comentario adicionada com sucesso' AS status;
