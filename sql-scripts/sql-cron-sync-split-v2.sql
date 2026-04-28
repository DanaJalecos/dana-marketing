-- ══════════════════════════════════════════════════════════
-- Cron jobs V2 — contas divididas por situação
-- Cada situação é uma chamada separada (mais rápido, sem timeout)
-- ══════════════════════════════════════════════════════════

-- 1. Desligar os crons antigos (uma chamada por tabela)
SELECT cron.unschedule('sync-contas-receber-1h');
SELECT cron.unschedule('sync-contas-pagar-1h');

-- 2. CONTAS A RECEBER — 3 crons (1 por situação) espaçados 5min

-- Situação 1 = em aberto (mais importante, roda a cada hora)
SELECT cron.schedule(
  'sync-cr-aberto-1h', '5 * * * *',
  $$SELECT net.http_post(
    url := 'https://comlppiwzniskjbeneos.supabase.co/functions/v1/sync-contas-receber?situacao=1',
    headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvbWxwcGl3em5pc2tqYmVuZW9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwODg2MjYsImV4cCI6MjA5MTY2NDYyNn0.jQOYaPklzSxQxTUd7rzktljHpW7ivbxbtilsUUi-TBE"}'::jsonb,
    body := '{}'::jsonb
  );$$
);

-- Situação 2 = recebido (1x por dia às 4h UTC / 1h Brasília)
SELECT cron.schedule(
  'sync-cr-recebido-dia', '0 4 * * *',
  $$SELECT net.http_post(
    url := 'https://comlppiwzniskjbeneos.supabase.co/functions/v1/sync-contas-receber?situacao=2',
    headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvbWxwcGl3em5pc2tqYmVuZW9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwODg2MjYsImV4cCI6MjA5MTY2NDYyNn0.jQOYaPklzSxQxTUd7rzktljHpW7ivbxbtilsUUi-TBE"}'::jsonb,
    body := '{}'::jsonb
  );$$
);

-- Situação 3 = atrasado (a cada 2h)
SELECT cron.schedule(
  'sync-cr-atrasado-2h', '10 */2 * * *',
  $$SELECT net.http_post(
    url := 'https://comlppiwzniskjbeneos.supabase.co/functions/v1/sync-contas-receber?situacao=3',
    headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvbWxwcGl3em5pc2tqYmVuZW9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwODg2MjYsImV4cCI6MjA5MTY2NDYyNn0.jQOYaPklzSxQxTUd7rzktljHpW7ivbxbtilsUUi-TBE"}'::jsonb,
    body := '{}'::jsonb
  );$$
);

-- 3. CONTAS A PAGAR — 3 crons

-- Situação 1 = em aberto
SELECT cron.schedule(
  'sync-cp-aberto-1h', '15 * * * *',
  $$SELECT net.http_post(
    url := 'https://comlppiwzniskjbeneos.supabase.co/functions/v1/sync-contas-pagar?situacao=1',
    headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvbWxwcGl3em5pc2tqYmVuZW9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwODg2MjYsImV4cCI6MjA5MTY2NDYyNn0.jQOYaPklzSxQxTUd7rzktljHpW7ivbxbtilsUUi-TBE"}'::jsonb,
    body := '{}'::jsonb
  );$$
);

-- Situação 2 = pago (1x por dia)
SELECT cron.schedule(
  'sync-cp-pago-dia', '0 5 * * *',
  $$SELECT net.http_post(
    url := 'https://comlppiwzniskjbeneos.supabase.co/functions/v1/sync-contas-pagar?situacao=2',
    headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvbWxwcGl3em5pc2tqYmVuZW9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwODg2MjYsImV4cCI6MjA5MTY2NDYyNn0.jQOYaPklzSxQxTUd7rzktljHpW7ivbxbtilsUUi-TBE"}'::jsonb,
    body := '{}'::jsonb
  );$$
);

-- Situação 3 = atrasado (a cada 2h)
SELECT cron.schedule(
  'sync-cp-atrasado-2h', '35 */2 * * *',
  $$SELECT net.http_post(
    url := 'https://comlppiwzniskjbeneos.supabase.co/functions/v1/sync-contas-pagar?situacao=3',
    headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvbWxwcGl3em5pc2tqYmVuZW9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwODg2MjYsImV4cCI6MjA5MTY2NDYyNn0.jQOYaPklzSxQxTUd7rzktljHpW7ivbxbtilsUUi-TBE"}'::jsonb,
    body := '{}'::jsonb
  );$$
);

-- 4. Ver todos os crons ativos
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname LIKE 'sync-%' ORDER BY jobname;
