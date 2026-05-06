-- ═══════════════════════════════════════════════════════════════════════════
-- Cron jobs para auto-sync de Analytics (ciclo 60.x — após ciclo 59)
-- ═══════════════════════════════════════════════════════════════════════════
-- Aplicado em produção via Management API em 06/05/2026.
--
-- Antes desta mudança: as edge functions sync-analytics e sync-ml-analytics
-- só rodavam quando o usuário clicava "🔄 Atualizar agora" na seção Analytics.
-- Resultado: dados ficavam estáticos no banco se ninguém clicasse.
--
-- Agora rodam automaticamente:
--   - sync-analytics-diario (jobid 25): 03:07 BRT (GA4 fecha o dia anterior ~02h)
--   - sync-ml-analytics-6h (jobid 26): 4x/dia às :17 das horas 0/6/12/18 UTC
--                                       (= 21h/03h/09h/15h BRT)
--
-- Minutos :07 e :17 escolhidos pra não coincidir com nenhum sync Bling
-- existente (que estão concentrados em :00/:05/:10/:15/:20/:25/:30/:35/:40/:45/:50/:55).
--
-- Idempotente via cron.unschedule + cron.schedule. Pode rodar múltiplas vezes.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Limpa schedules antigos (se existirem)
DO $$
BEGIN
  PERFORM cron.unschedule('sync-analytics-diario');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('sync-ml-analytics-6h');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 2) GA4 + Google Ads — diário 03:07 BRT (06:07 UTC)
SELECT cron.schedule(
  'sync-analytics-diario',
  '7 6 * * *',
  $$SELECT net.http_post(
    url := 'https://wltmiqbhziefusnzmmkt.supabase.co/functions/v1/sync-analytics',
    headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndsdG1pcWJoemllZnVzbnptbWt0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4NzUxMzEsImV4cCI6MjA5MjQ1MTEzMX0.GfdryMC-RTnp2h-6RSHf1WBVYCCTfGtqHAXtilYHzTY"}'::jsonb,
    body := '{"provider":"all","dias_atras":30}'::jsonb
  );$$
);

-- 3) Mercado Livre — 4x/dia às minuto :17 das horas pares (0/6/12/18 UTC = 21/03/09/15 BRT)
SELECT cron.schedule(
  'sync-ml-analytics-6h',
  '17 0,6,12,18 * * *',
  $$SELECT net.http_post(
    url := 'https://wltmiqbhziefusnzmmkt.supabase.co/functions/v1/sync-ml-analytics',
    headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndsdG1pcWJoemllZnVzbnptbWt0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4NzUxMzEsImV4cCI6MjA5MjQ1MTEzMX0.GfdryMC-RTnp2h-6RSHf1WBVYCCTfGtqHAXtilYHzTY"}'::jsonb,
    body := '{"dias_atras":7}'::jsonb
  );$$
);

-- 4) Confirmar
SELECT jobid, schedule, jobname, active
FROM cron.job
WHERE jobname IN ('sync-analytics-diario','sync-ml-analytics-6h')
ORDER BY jobid;

-- ═══════════════════════════════════════════════════════════════════════════
-- Pra desativar (manter o registro mas pausar):
--   SELECT cron.alter_job(25, active := false);  -- sync-analytics-diario
--   SELECT cron.alter_job(26, active := false);  -- sync-ml-analytics-6h
-- ═══════════════════════════════════════════════════════════════════════════
