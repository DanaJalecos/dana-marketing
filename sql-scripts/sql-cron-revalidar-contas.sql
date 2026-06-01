-- ════════════════════════════════════════════════════════════════════════════
-- Compact/22A: Crons revalidação contas via drill batch
-- 3 crons (pagar/bc não, fonte vazia). Cada cron drilla ~200/exec.
-- Em paralelo cobrem ~600/hora -> 26k contas em ~44h
-- ════════════════════════════════════════════════════════════════════════════

SELECT cron.schedule(
  'bling-revalidar-cr-matriz-30min',
  '*/30 * * * *',
  $$SELECT public._call_edge('bling-sync-contas-revalidar', '{"tipo":"receber","empresa":"matriz","limit":200}'::jsonb);$$
);
SELECT cron.schedule(
  'bling-revalidar-cr-bc-30min',
  '5,35 * * * *',
  $$SELECT public._call_edge('bling-sync-contas-revalidar', '{"tipo":"receber","empresa":"bc","limit":200}'::jsonb);$$
);
SELECT cron.schedule(
  'bling-revalidar-cp-matriz-30min',
  '10,40 * * * *',
  $$SELECT public._call_edge('bling-sync-contas-revalidar', '{"tipo":"pagar","empresa":"matriz","limit":200}'::jsonb);$$
);
