-- ════════════════════════════════════════════════════════════════════════════
-- Compact/24: Crons revalidação pedidos + sync catálogo situacoes
-- ════════════════════════════════════════════════════════════════════════════

-- Catálogo: 1×/dia 03:50am (depois dos crons cadastros lote 3 fechar)
SELECT cron.schedule(
  'bling-sync-situacoes-24h',
  '50 3 * * *',
  $$SELECT public._call_edge('bling-sync-situacoes', '{}'::jsonb);$$
);

-- Pedidos revalidar matriz: cada 30min (~1.387 candidatos / 200 por exec ~7 ciclos pra cobrir tudo)
SELECT cron.schedule(
  'bling-revalidar-pedidos-matriz-30min',
  '15,45 * * * *',
  $$SELECT public._call_edge('bling-sync-pedidos-revalidar', '{"empresa":"matriz","limit":500}'::jsonb);$$
);

-- Pedidos revalidar BC: cada 30min (volume menor)
SELECT cron.schedule(
  'bling-revalidar-pedidos-bc-30min',
  '20,50 * * * *',
  $$SELECT public._call_edge('bling-sync-pedidos-revalidar', '{"empresa":"bc","limit":500}'::jsonb);$$
);
