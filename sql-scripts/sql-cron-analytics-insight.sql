-- ═══════════════════════════════════════════════════════════════════════════
-- Cron diário pra auto-gerar insight de Analytics — Fase 4 do ciclo Analytics IA
-- ═══════════════════════════════════════════════════════════════════════════
-- Aplicado em produção via Management API em 06/05/2026.
--
-- Comportamento:
--   - Roda 09:30 UTC (06:30 BRT), DEPOIS do sync-analytics-diario (06:07 BRT)
--   - Chama edge function analytics-insight com header X-System-Cron: true
--   - Edge function detecta o header e:
--     * pula validação de auth (não precisa de JWT)
--     * pula validação de quota (mas mantém kill-switch mensal R$30)
--     * registra com cargo_autor='sistema', user_id=NULL
--   - Período fixo: últimos 7 dias (snapshot semanal)
--   - Custo: ~R$ 0,60/mês se Gemini, R$0 se Groq (free tier disponível)
--
-- ⚠️ A edge function NÃO tem acesso ao contexto coletado pelo frontend (que
-- vive em window._anLastContexto). Pra cron rodar, ela precisaria buscar os
-- dados sozinha do banco. Como simplificação, cron envia contexto MÍNIMO
-- (só tem o resumo dos KPIs gerais que sao agregados via SQL inline). Isso
-- gera insight com menos detalhe que o on-demand, mas não é zero.
--
-- Idempotente: cron.unschedule + cron.schedule.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  PERFORM cron.unschedule('cron-analytics-insight-diario');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'cron-analytics-insight-diario',
  '30 9 * * *',
  $$
  SELECT net.http_post(
    url := 'https://wltmiqbhziefusnzmmkt.supabase.co/functions/v1/analytics-insight',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-System-Cron', 'true',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndsdG1pcWJoemllZnVzbnptbWt0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4NzUxMzEsImV4cCI6MjA5MjQ1MTEzMX0.GfdryMC-RTnp2h-6RSHf1WBVYCCTfGtqHAXtilYHzTY'
    ),
    body := jsonb_build_object(
      'escopo', 'sistema',
      'periodo_dias', 7,
      'data_ini', (CURRENT_DATE - INTERVAL '7 days')::text,
      'data_fim', CURRENT_DATE::text,
      'contexto', (
        SELECT jsonb_build_object(
          'periodo_dias', 7,
          'data_ini', (CURRENT_DATE - INTERVAL '7 days')::text,
          'data_fim', CURRENT_DATE::text,
          'ga4', jsonb_build_object(
            'sessoes', jsonb_build_object('atual', COALESCE(SUM(sessions),0), 'periodo', 'ultimos_7d'),
            'usuarios', jsonb_build_object('atual', COALESCE(SUM(users),0)),
            'conversoes', jsonb_build_object('atual', COALESCE(SUM(conversions),0))
          )
        )
        FROM analytics_ga4_dia
        WHERE data >= CURRENT_DATE - INTERVAL '7 days'
      )
    )
  );
  $$
);

-- Confirma criação
SELECT jobid, schedule, jobname, active
FROM cron.job
WHERE jobname = 'cron-analytics-insight-diario';

-- Pra desativar:
--   SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'cron-analytics-insight-diario'), active := false);
-- ═══════════════════════════════════════════════════════════════════════════
