-- ══════════════════════════════════════════════════════════
-- FIX CRON · sync-pedidos-itens + novo cron de backfill (2026 only)
--
-- Rodar no Supabase SQL Editor (precisa de service_role ou postgres).
-- Cada bloco é idempotente — pode rodar várias vezes sem quebrar.
-- ══════════════════════════════════════════════════════════

-- ── PASSO 1 · DIAGNÓSTICO ──
-- Confere todos os cron jobs existentes e status (ativo/inativo)
SELECT jobid, schedule, active, command, jobname
FROM cron.job
ORDER BY jobname;

-- ── PASSO 2 · REATIVAR O CRON DE ITENS (se estiver desativado) ──
-- Se o job existe mas está inativo, reativa. Se não existe, pula pro PASSO 3.
UPDATE cron.job
   SET active = true
 WHERE jobname = 'sync-pedidos-itens-30min'
   AND active = false;

-- ── PASSO 3 · RECRIAR O CRON CASO TENHA SIDO DELETADO ──
-- Se o SELECT do PASSO 1 não mostrou 'sync-pedidos-itens-30min', descomenta e roda:
/*
SELECT cron.schedule(
  'sync-pedidos-itens-30min',
  '10,40 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://comlppiwzniskjbeneos.supabase.co/functions/v1/sync-pedidos-itens',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    )
  );
  $$
);
*/

-- ── PASSO 4 · AGENDAR BACKFILL TEMPORÁRIO ──
-- Roda a cada 15 min, processando 300 pedidos antigos de 2026 por vez.
-- Com ~2.500 pedidos de 2026 e 300/execução, leva ~2-3 horas pra cobrir tudo.
-- IMPORTANTE: depois de cobertura 100%, DESATIVAR este job (PASSO 6) senão ele
-- vai ficar fazendo no-op toda execução.
SELECT cron.schedule(
  'sync-pedidos-itens-backfill-15min',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://comlppiwzniskjbeneos.supabase.co/functions/v1/sync-pedidos-itens-backfill',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{"inicio":"2026-01-01","limite":300}'::jsonb
  );
  $$
);

-- ── PASSO 5 · MONITORAR PROGRESSO DO BACKFILL ──
-- Olha os últimos registros do sync_log pra ver cobertura
SELECT created_at, status, registros, detalhes
FROM sync_log
WHERE tipo IN ('itens','backfill')
ORDER BY created_at DESC
LIMIT 15;

-- ── PASSO 6 · DESATIVAR BACKFILL QUANDO TERMINAR ──
-- Quando o detalhes do último log disser "Backfill completo" ou "cobertura 100%":
/*
SELECT cron.unschedule('sync-pedidos-itens-backfill-15min');
*/

-- ── CHECAGEM FINAL · contagem e cobertura ──
SELECT
  (SELECT count(*) FROM pedidos WHERE data >= '2026-01-01') AS pedidos_2026,
  (SELECT count(DISTINCT pedido_id) FROM pedidos_itens) AS pedidos_com_itens,
  round(
    (SELECT count(DISTINCT pedido_id)::numeric FROM pedidos_itens
      WHERE pedido_id IN (SELECT id FROM pedidos WHERE data >= '2026-01-01'))
    / nullif((SELECT count(*) FROM pedidos WHERE data >= '2026-01-01'), 0) * 100, 1
  ) AS cobertura_2026_pct,
  (SELECT count(*) FROM pedidos_itens) AS total_itens_registros;
