-- ═══════════════════════════════════════════════════════════════════════════
-- CRONS: Aniversariantes da Carteira
--
--   1. sync_aniv_burst_fase1   — a cada 3min (12 execs) → 3.600 carteira em 36min
--   2. sync_aniv_diario        — diário 03:00 BRT (06:00 UTC) → modo 'ativos'
--   3. alertar_aniversariantes_dia — 08:00 BRT (11:00 UTC) → sino
--   4. email_aniversariantes_dia   — 08:01 BRT (11:01 UTC) → email condicional
--
-- IMPORTANTE: depois de 24h do burst, RODAR Bloco "Desligar burst"
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Cleanup idempotente ───
DO $$
DECLARE jid INT;
BEGIN
  FOR jid IN
    SELECT jobid FROM cron.job
    WHERE jobname IN (
      'sync_aniv_burst_fase1',
      'sync_aniv_diario',
      'alertar_aniversariantes_dia',
      'email_aniversariantes_dia'
    )
  LOOP
    PERFORM cron.unschedule(jid);
  END LOOP;
END $$;


-- ─── 1) BURST FASE 1 — sync 3.600 contatos da carteira em 36min ───
-- Roda a cada 3min. Cada exec processa ~300 contatos (350ms × 300 = 105s).
-- Depois de ~12 execs (36min), a fila de 'carteira' esvazia → vira no-op.
SELECT cron.schedule(
  'sync_aniv_burst_fase1',
  '*/3 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://wltmiqbhziefusnzmmkt.supabase.co/functions/v1/sync-contatos-detalhes',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndsdG1pcWJoemllZnVzbnptbWt0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4NzUxMzEsImV4cCI6MjA5MjQ1MTEzMX0.GfdryMC-RTnp2h-6RSHf1WBVYCCTfGtqHAXtilYHzTY", "x-system-cron": "true"}'::jsonb,
    body := '{"modo":"carteira","limite":300}'::jsonb,
    timeout_milliseconds := 160000
  );
  $$
);


-- ─── 2) DIÁRIO — sync incremental modo 'ativos' (Fase 2) ───
-- Roda 03:00 BRT (06:00 UTC) com modo 'ativos' (~2.400 contatos com pedido 12m sem vendedor).
-- Processa 500/dia → cobre tudo em ~5 dias, depois vira no-op até aparecerem novos.
SELECT cron.schedule(
  'sync_aniv_diario',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://wltmiqbhziefusnzmmkt.supabase.co/functions/v1/sync-contatos-detalhes',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndsdG1pcWJoemllZnVzbnptbWt0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4NzUxMzEsImV4cCI6MjA5MjQ1MTEzMX0.GfdryMC-RTnp2h-6RSHf1WBVYCCTfGtqHAXtilYHzTY", "x-system-cron": "true"}'::jsonb,
    body := '{"modo":"ativos","limite":500}'::jsonb,
    timeout_milliseconds := 160000
  );
  $$
);


-- ─── 3) ALERTAR ANIVERSARIANTES DO DIA (sino, 08:00 BRT) ───
-- Insere alerta tipo 'aniversario_cliente' pra cada vendedora cujo cliente faz aniv hoje.
-- link_ref = 'aniversariantes' → handler em index.html abre Meus Clientes + expande widget.
SELECT cron.schedule(
  'alertar_aniversariantes_dia',
  '0 11 * * *',
  $$
  INSERT INTO alertas (tipo, audiencia, destinatario_id, destinatario_nome, nivel,
                       titulo, mensagem, link_ref, link_label, dados, lido, created_at)
  SELECT
    'aniversario_cliente',
    'pessoal',
    csv.vendedor_profile_id,
    p.nome,
    'info',
    '🎂 ' || c.nome || ' faz aniversário hoje',
    'Cliente da sua carteira aniversariando — que tal mandar o cupom de 10% off?',
    'aniversariantes',
    'Abrir Meus Clientes',
    jsonb_build_object(
      'contato_id', c.id,
      'contato_nome', c.nome,
      'data_nasc', c.data_nascimento,
      'empresa', c.empresa
    ),
    false,
    now()
  FROM contatos c
  JOIN cliente_scoring_vendedor csv ON csv.contato_id = c.id
  LEFT JOIN profiles p ON p.id = csv.vendedor_profile_id
  WHERE c.data_nascimento IS NOT NULL
    AND EXTRACT(MONTH FROM c.data_nascimento) = EXTRACT(MONTH FROM CURRENT_DATE)
    AND EXTRACT(DAY FROM c.data_nascimento) = EXTRACT(DAY FROM CURRENT_DATE)
    AND csv.vendedor_profile_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM alertas a
      WHERE a.tipo = 'aniversario_cliente'
        AND a.destinatario_id = csv.vendedor_profile_id
        AND (a.dados->>'contato_id')::bigint = c.id
        AND a.created_at >= CURRENT_DATE
    );
  $$
);


-- ─── 4) EMAIL DIÁRIO (condicional ao DNS Resend) ───
-- Chama edge send-email-aniversariantes que respeita flag email_config.resend_dns_configurado
SELECT cron.schedule(
  'email_aniversariantes_dia',
  '1 11 * * *',
  $$
  SELECT net.http_post(
    url := 'https://wltmiqbhziefusnzmmkt.supabase.co/functions/v1/send-email-aniversariantes',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndsdG1pcWJoemllZnVzbnptbWt0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4NzUxMzEsImV4cCI6MjA5MjQ1MTEzMX0.GfdryMC-RTnp2h-6RSHf1WBVYCCTfGtqHAXtilYHzTY", "x-system-cron": "true"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);


-- ─── VALIDAÇÃO ───
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname IN (
  'sync_aniv_burst_fase1',
  'sync_aniv_diario',
  'alertar_aniversariantes_dia',
  'email_aniversariantes_dia'
)
ORDER BY jobname;


-- ════════════════════════════════════════════════════════════════════════
-- DEPOIS DE 24h DO BURST — desligar (a fila já tá vazia, fica inútil)
-- ════════════════════════════════════════════════════════════════════════
-- DO $$
-- DECLARE jid INT;
-- BEGIN
--   SELECT jobid INTO jid FROM cron.job WHERE jobname = 'sync_aniv_burst_fase1' LIMIT 1;
--   IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
-- END $$;


-- ════════════════════════════════════════════════════════════════════════
-- FLAG resend_dns_configurado (criar se não existir)
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS email_config (
  id INT PRIMARY KEY DEFAULT 1,
  resend_dns_configurado BOOLEAN NOT NULL DEFAULT false,
  remetente_default TEXT DEFAULT 'comercial@danajalecos.com.br',
  bcc_default TEXT DEFAULT NULL,
  atualizado_em TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT email_config_single_row CHECK (id = 1)
);

INSERT INTO email_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Quando Juan configurar o DNS do Resend:
--   UPDATE email_config SET resend_dns_configurado = true, atualizado_em = now() WHERE id = 1;
