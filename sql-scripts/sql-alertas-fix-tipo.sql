-- ══════════════════════════════════════════════════════════
-- FIX: coluna 'tipo' (NOT NULL) faltando nos INSERT da função
-- gerar_alertas_prazos(). Rodar uma vez pra atualizar a função.
-- ══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION gerar_alertas_prazos() RETURNS void AS $$
DECLARE
  r RECORD;
  v_destinatario_id UUID;
  v_nivel TEXT;
  v_titulo TEXT;
  v_mensagem TEXT;
BEGIN
  FOR r IN
    SELECT t.id, t.titulo, t.prazo, t.responsavel
    FROM tarefas t
    WHERE t.prazo IS NOT NULL
      AND t.prazo::date IN (current_date, current_date + 1)
      AND COALESCE(t.concluido, false) = false
      AND t.responsavel IS NOT NULL
      AND TRIM(t.responsavel) <> ''
  LOOP
    SELECT p.id INTO v_destinatario_id
    FROM profiles p
    WHERE LOWER(TRIM(p.nome)) = LOWER(TRIM(r.responsavel))
    LIMIT 1;

    IF v_destinatario_id IS NULL THEN CONTINUE; END IF;

    IF EXISTS (
      SELECT 1 FROM alertas
      WHERE destinatario_id = v_destinatario_id
        AND dados->>'tarefa_id' = r.id::text
        AND dados->>'tipo' = 'tarefa_prazo'
        AND created_at >= current_date
    ) THEN CONTINUE; END IF;

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

SELECT 'Função gerar_alertas_prazos atualizada com tipo=tarefa_prazo' AS status;
