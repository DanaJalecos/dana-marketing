-- ════════════════════════════════════════════════════════════════════════════
-- BLING LOTE 3 — Crons pg_cron (8 tabelas)
-- Padrão: cada um em minuto diferente pra não competir
-- Helper: public._call_edge(function_name, body_jsonb)
-- ════════════════════════════════════════════════════════════════════════════

-- Cadastros (raramente mudam — 1×/dia, 3-5h da manhã pra evitar pico)
SELECT cron.schedule(
  'bling-sync-naturezas-operacao-24h',
  '5 3 * * *',
  $$SELECT public._call_edge('bling-sync-naturezas-operacao', '{}'::jsonb);$$
);
SELECT cron.schedule(
  'bling-sync-contas-financeiras-24h',
  '15 3 * * *',
  $$SELECT public._call_edge('bling-sync-contas-financeiras', '{}'::jsonb);$$
);
SELECT cron.schedule(
  'bling-sync-categorias-24h',
  '25 3 * * *',
  $$SELECT public._call_edge('bling-sync-categorias', '{}'::jsonb);$$
);
SELECT cron.schedule(
  'bling-sync-formas-pagamento-24h',
  '35 3 * * *',
  $$SELECT public._call_edge('bling-sync-formas-pagamento', '{}'::jsonb);$$
);

-- Transacionais (frequência diferenciada por importância)
SELECT cron.schedule(
  'bling-sync-notificacoes-30min',
  '20,50 * * * *',
  $$SELECT public._call_edge('bling-sync-notificacoes', '{}'::jsonb);$$
);
SELECT cron.schedule(
  'bling-sync-caixas-movimentacoes-1h',
  '40 * * * *',
  $$SELECT public._call_edge('bling-sync-caixas-movimentacoes', '{"dias_atras": 7}'::jsonb);$$
);
SELECT cron.schedule(
  'bling-sync-borderos-6h',
  '50 */6 * * *',
  $$SELECT public._call_edge('bling-sync-borderos', '{}'::jsonb);$$
);
SELECT cron.schedule(
  'bling-sync-ordens-producao-6h',
  '55 */6 * * *',
  $$SELECT public._call_edge('bling-sync-ordens-producao', '{"dias_atras": 30}'::jsonb);$$
);
