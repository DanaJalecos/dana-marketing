-- ═══════════════════════════════════════════════════════════════════════════
-- Cron diário: sync-ml-ads (Product Ads campaigns + métricas + diário)
-- ═══════════════════════════════════════════════════════════════════════════
-- Roda 09:25 UTC = 06:25 BRT, depois do sync-pedidos (03:07) e sync-analytics
-- (06:07) e sync-ml-analytics (00:17/06:17/12:17/18:17), e antes do
-- cron-analytics-insight-diario (06:30 BRT). Pega últimos 90d a cada run.
--
-- Custo: zero (mesmo plano Supabase, ML API é gratuita pra sellers ativos).
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  PERFORM cron.unschedule('cron-sync-ml-ads-diario');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'cron-sync-ml-ads-diario',
  '25 9 * * *',
  $$
  SELECT net.http_post(
    url := 'https://wltmiqbhziefusnzmmkt.supabase.co/functions/v1/sync-ml-ads',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndsdG1pcWJoemllZnVzbnptbWt0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4NzUxMzEsImV4cCI6MjA5MjQ1MTEzMX0.GfdryMC-RTnp2h-6RSHf1WBVYCCTfGtqHAXtilYHzTY'
    ),
    body := '{"dias_atras":90}'::jsonb
  );
  $$
);

-- Confirma criação
SELECT jobid, schedule, jobname, active
FROM cron.job
WHERE jobname = 'cron-sync-ml-ads-diario';

-- Pra desativar:
--   SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'cron-sync-ml-ads-diario'), active := false);
-- ═══════════════════════════════════════════════════════════════════════════
