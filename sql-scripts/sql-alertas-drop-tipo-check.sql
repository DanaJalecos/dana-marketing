-- ══════════════════════════════════════════════════════════
-- FIX: remover CHECK constraint restritivo em alertas.tipo
-- Erro: 'new row violates check constraint "alertas_tipo_check"'
-- Motivo: constraint antiga só aceitava tipos como 'queda_receita',
-- 'pagamento_atrasado', etc. Agora queremos tipos dinâmicos pra
-- notificações personalizadas (criativo_aprovado, tarefa_prazo, etc).
-- ══════════════════════════════════════════════════════════

-- 1. Ver qual é o constraint atual (pra registro)
SELECT pg_get_constraintdef(c.oid) AS constraint_atual
FROM pg_constraint c
WHERE c.conname = 'alertas_tipo_check';

-- 2. Remover o constraint restritivo
ALTER TABLE alertas DROP CONSTRAINT IF EXISTS alertas_tipo_check;

-- 3. Manter NOT NULL (tipo é obrigatório, só o valor é livre)
-- (já está NOT NULL, não precisa fazer nada)

SELECT 'Constraint alertas_tipo_check removido — tipos agora são livres' AS status;
