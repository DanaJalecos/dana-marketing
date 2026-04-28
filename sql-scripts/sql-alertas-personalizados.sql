-- ══════════════════════════════════════════════════════════
-- Notificações inteligentes — Fase 1
-- 1) Adiciona destinatário + link de referência em alertas
-- 2) Função que gera alertas de prazo em tarefas
-- 3) Cron diário 9h pra rodar essa função
-- ══════════════════════════════════════════════════════════

-- ── 1. ALTER TABLE alertas ──
ALTER TABLE alertas
  ADD COLUMN IF NOT EXISTS destinatario_id UUID,
  ADD COLUMN IF NOT EXISTS destinatario_nome TEXT,
  ADD COLUMN IF NOT EXISTS link_ref TEXT,
  ADD COLUMN IF NOT EXISTS link_label TEXT;

CREATE INDEX IF NOT EXISTS idx_alertas_destinatario
  ON alertas(destinatario_id) WHERE destinatario_id IS NOT NULL;

-- ── 2. Função que gera alertas de prazo em tarefas do Kanban ──
CREATE OR REPLACE FUNCTION gerar_alertas_prazos() RETURNS void AS $$
DECLARE
  r RECORD;
  v_destinatario_id UUID;
  v_nivel TEXT;
  v_titulo TEXT;
  v_mensagem TEXT;
BEGIN
  -- Tarefas com prazo hoje ou amanhã, com responsavel, não concluídas
  FOR r IN
    SELECT t.id, t.titulo, t.prazo, t.responsavel
    FROM tarefas t
    WHERE t.prazo IS NOT NULL
      AND t.prazo::date IN (current_date, current_date + 1)
      AND COALESCE(t.concluido, false) = false
      AND t.responsavel IS NOT NULL
      AND TRIM(t.responsavel) <> ''
  LOOP
    -- Resolver responsavel (string) pra profile_id via match por nome
    SELECT p.id INTO v_destinatario_id
    FROM profiles p
    WHERE LOWER(TRIM(p.nome)) = LOWER(TRIM(r.responsavel))
    LIMIT 1;

    IF v_destinatario_id IS NULL THEN CONTINUE; END IF;

    -- Evitar spam: só 1 alerta por dia por tarefa
    IF EXISTS (
      SELECT 1 FROM alertas
      WHERE destinatario_id = v_destinatario_id
        AND dados->>'tarefa_id' = r.id::text
        AND dados->>'tipo' = 'tarefa_prazo'
        AND created_at >= current_date
    ) THEN CONTINUE; END IF;

    -- Montar título/mensagem conforme proximidade
    IF r.prazo::date = current_date THEN
      v_nivel := 'urgent';
      v_titulo := '🚨 Prazo HOJE: ' || r.titulo;
      v_mensagem := 'A tarefa "' || r.titulo || '" vence hoje. Conclua pra não atrasar.';
    ELSE
      v_nivel := 'warn';
      v_titulo := '⏰ Prazo amanhã: ' || r.titulo;
      v_mensagem := 'A tarefa "' || r.titulo || '" vence amanhã. Prepare-se.';
    END IF;

    INSERT INTO alertas(tipo, titulo, mensagem, nivel, lido, destinatario_id, destinatario_nome, link_ref, link_label, dados)
    VALUES (
      'tarefa_prazo', v_titulo, v_mensagem, v_nivel, false,
      v_destinatario_id, r.responsavel,
      'tarefas-e-kanban', 'Ir para o Kanban',
      jsonb_build_object('tarefa_id', r.id, 'tipo', 'tarefa_prazo', 'prazo', r.prazo)
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ── 3. Cron diário às 9h da manhã ──
DO $$
BEGIN
  -- Remover job antigo se existir (idempotente)
  PERFORM cron.unschedule('gerar-alertas-prazos-diario')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gerar-alertas-prazos-diario');
END $$;

SELECT cron.schedule(
  'gerar-alertas-prazos-diario',
  '0 9 * * *',
  $$SELECT gerar_alertas_prazos();$$
);

-- ── 4. Verificação ──
SELECT 'Migration aplicada com sucesso' AS status;

-- Se quiser testar agora (rodar função imediatamente):
-- SELECT gerar_alertas_prazos();
