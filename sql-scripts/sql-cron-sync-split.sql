-- ══════════════════════════════════════════════════════════
-- Cron jobs para as 5 funções de sync separadas
-- Substitui o cron antigo "sync-bling-30min" (muito pesado, dava timeout)
-- ══════════════════════════════════════════════════════════

-- 1. Desligar o cron antigo (mantém os novos de pedidos-itens)
SELECT cron.unschedule('sync-bling-30min');

-- 2. Configurar os 5 novos cron jobs
-- Cada um em horário diferente para não rodarem ao mesmo tempo

-- ── PEDIDOS — a cada 30min no minuto 00 (é o mais importante)
SELECT cron.schedule(
  'sync-pedidos-30min',
  '0,30 * * * *',
  $$SELECT net.http_post(
    url := 'https://comlppiwzniskjbeneos.supabase.co/functions/v1/sync-pedidos',
    headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvbWxwcGl3em5pc2tqYmVuZW9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwODg2MjYsImV4cCI6MjA5MTY2NDYyNn0.jQOYaPklzSxQxTUd7rzktljHpW7ivbxbtilsUUi-TBE"}'::jsonb,
    body := '{}'::jsonb
  );$$
);

-- ── CONTAS A RECEBER — a cada hora no minuto 05
SELECT cron.schedule(
  'sync-contas-receber-1h',
  '5 * * * *',
  $$SELECT net.http_post(
    url := 'https://comlppiwzniskjbeneos.supabase.co/functions/v1/sync-contas-receber',
    headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvbWxwcGl3em5pc2tqYmVuZW9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwODg2MjYsImV4cCI6MjA5MTY2NDYyNn0.jQOYaPklzSxQxTUd7rzktljHpW7ivbxbtilsUUi-TBE"}'::jsonb,
    body := '{}'::jsonb
  );$$
);

-- ── CONTAS A PAGAR — a cada hora no minuto 15
SELECT cron.schedule(
  'sync-contas-pagar-1h',
  '15 * * * *',
  $$SELECT net.http_post(
    url := 'https://comlppiwzniskjbeneos.supabase.co/functions/v1/sync-contas-pagar',
    headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvbWxwcGl3em5pc2tqYmVuZW9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwODg2MjYsImV4cCI6MjA5MTY2NDYyNn0.jQOYaPklzSxQxTUd7rzktljHpW7ivbxbtilsUUi-TBE"}'::jsonb,
    body := '{}'::jsonb
  );$$
);

-- ── PRODUTOS — a cada 2h no minuto 20 (não muda tanto)
SELECT cron.schedule(
  'sync-produtos-2h',
  '20 */2 * * *',
  $$SELECT net.http_post(
    url := 'https://comlppiwzniskjbeneos.supabase.co/functions/v1/sync-produtos',
    headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvbWxwcGl3em5pc2tqYmVuZW9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwODg2MjYsImV4cCI6MjA5MTY2NDYyNn0.jQOYaPklzSxQxTUd7rzktljHpW7ivbxbtilsUUi-TBE"}'::jsonb,
    body := '{}'::jsonb
  );$$
);

-- ── CONTATOS — a cada 2h no minuto 25
SELECT cron.schedule(
  'sync-contatos-2h',
  '25 */2 * * *',
  $$SELECT net.http_post(
    url := 'https://comlppiwzniskjbeneos.supabase.co/functions/v1/sync-contatos',
    headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvbWxwcGl3em5pc2tqYmVuZW9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwODg2MjYsImV4cCI6MjA5MTY2NDYyNn0.jQOYaPklzSxQxTUd7rzktljHpW7ivbxbtilsUUi-TBE"}'::jsonb,
    body := '{}'::jsonb
  );$$
);

-- 3. Verificar que tudo foi criado
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname LIKE 'sync-%' ORDER BY jobname;
