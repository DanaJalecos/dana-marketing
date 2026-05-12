-- ══════════════════════════════════════════════════════════
-- EMAIL LOG · Auditoria + dedupe de emails enviados (Ciclo 87)
--
-- Tabela usada pela Edge Function `send-email` pra:
--   1. Auditar tudo que sai (evento, destinatário, status, resposta Resend)
--   2. Dedupe — evita enviar 2 emails idênticos em sequência
--      (ex: alguém clica "aprovar" e depois clica de novo sem perceber)
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS email_log (
  id           bigserial PRIMARY KEY,
  evento       text NOT NULL,         -- 'criativo_aprovado' | 'criativo_reprovado' | 'tarefa_atribuida' | etc
  destinatario text NOT NULL,         -- email principal (TO)
  cc           text[] DEFAULT '{}',   -- emails em copia
  assunto      text NOT NULL,
  recurso_id   text,                  -- id do criativo/tarefa/etc pra dedupe
  status       text NOT NULL DEFAULT 'enviado',  -- 'enviado' | 'falhou' | 'pulado'
  resend_id    text,                  -- id retornado pelo Resend (pra rastrear no painel deles)
  erro         text,                  -- mensagem de erro se status='falhou'
  payload      jsonb,                 -- payload completo enviado pro Resend
  created_at   timestamptz DEFAULT NOW()
);

-- Índice pra dedupe rápido
CREATE INDEX IF NOT EXISTS idx_email_log_dedupe
  ON email_log (evento, recurso_id, destinatario, created_at);

-- RLS: só admin lê (auditoria sensível)
ALTER TABLE email_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_log_select_admin ON email_log;
CREATE POLICY email_log_select_admin ON email_log
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.cargo = 'admin'
    )
  );

-- INSERT: só service_role (Edge Function) — bloqueia INSERT direto do frontend
DROP POLICY IF EXISTS email_log_insert_service ON email_log;
CREATE POLICY email_log_insert_service ON email_log
  FOR INSERT
  WITH CHECK (false);  -- frontend não insere; Edge Function usa service_role que bypassa RLS

SELECT 'email_log criada' AS status, COUNT(*) AS rows FROM email_log;
