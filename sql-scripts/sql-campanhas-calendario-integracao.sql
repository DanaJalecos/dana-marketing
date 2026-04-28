-- ══════════════════════════════════════════════════════════
-- INTEGRAÇÃO: Cliente 360 Campanhas ↔ Calendário DMS
-- 1) Adiciona novo tipo 'campanha_c360' na tabela calendario
-- 2) Adiciona FK cliente_campanhas.calendario_evento_id → calendario.id
-- ══════════════════════════════════════════════════════════

-- 1) Recria CHECK constraint pra incluir 'campanha_c360'
ALTER TABLE calendario DROP CONSTRAINT IF EXISTS calendario_tipo_check;
ALTER TABLE calendario ADD CONSTRAINT calendario_tipo_check
  CHECK (tipo = ANY (ARRAY['campanha','promocao','lancamento','evento','deadline','feriado','campanha_c360']));

-- 2) Adiciona FK opcional em cliente_campanhas
ALTER TABLE cliente_campanhas
  ADD COLUMN IF NOT EXISTS calendario_evento_id UUID
  REFERENCES calendario(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_campanhas_cal_evt ON cliente_campanhas(calendario_evento_id);

-- Verificação
SELECT 'Migracao calendario <-> campanhas concluida' AS status,
       (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          WHERE t.relname = 'calendario' AND c.conname = 'calendario_tipo_check') AS novo_check,
       (SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name='cliente_campanhas' AND column_name='calendario_evento_id') AS nova_fk;
