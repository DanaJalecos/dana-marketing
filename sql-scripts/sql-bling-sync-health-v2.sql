-- ════════════════════════════════════════════════════════════════════════════
-- bling_sync_health v2 — limiar 'atrasado' DINÂMICO por frequência cron
-- Pedido FAI: o cacador estava alertando "parado ha 3.5h" em syncs de 6h,
-- onde isso é normal. Agora cada tabela tem freq esperada e tolerância 2x.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP VIEW IF EXISTS public.bling_sync_health;
CREATE VIEW public.bling_sync_health AS
WITH freq_map(tabela, freq_min) AS (VALUES
  ('bling_nfe_entrada'::text,         60),    -- cron 1h
  ('bling_nfe_saida',                 60),    -- cron 1h
  ('bling_nfse',                      240),   -- cron 4h
  ('bling_pedidos_compras',           360),   -- cron 6h
  ('bling_naturezas_operacao',        1440),  -- cron 24h
  ('bling_contas_financeiras',        1440),
  ('bling_categorias',                1440),
  ('bling_formas_pagamento',          1440),
  ('bling_notificacoes',              30),    -- cron 30min
  ('bling_caixas_movimentacoes',      60),    -- cron 1h
  ('bling_borderos',                  360),   -- cron 6h
  ('bling_ordens_producao',           360),   -- cron 6h
  -- legados (cron 5-15min na maioria)
  ('pedidos',                         15),
  ('pedidos_itens',                   15),
  ('contas_pagar',                    15),
  ('contas_receber',                  15),
  ('contatos',                        30),
  ('produtos',                        30),
  ('oauth_refresh',                   300)    -- 5h
),
latest AS (
  SELECT DISTINCT ON (bling_sync_log.tabela, bling_sync_log.loja_id)
    bling_sync_log.tabela,
    bling_sync_log.loja_id,
    bling_sync_log.status,
    bling_sync_log.iniciado_em,
    bling_sync_log.finalizado_em,
    bling_sync_log.duracao_ms,
    bling_sync_log.qtd_lidos,
    bling_sync_log.qtd_inseridos,
    bling_sync_log.qtd_atualizados,
    bling_sync_log.qtd_erros,
    bling_sync_log.erro_tipo,
    bling_sync_log.erro_msg,
    bling_sync_log.api_calls
  FROM bling_sync_log
  ORDER BY bling_sync_log.tabela, bling_sync_log.loja_id, bling_sync_log.iniciado_em DESC
)
SELECT
  l.tabela,
  l.loja_id,
  l.status AS ultimo_status,
  l.iniciado_em AS ultima_execucao,
  l.finalizado_em,
  l.duracao_ms,
  ROUND(EXTRACT(EPOCH FROM now() - l.iniciado_em) / 60.0, 1) AS minutos_desde_ultima,
  COALESCE(fm.freq_min, 60) AS freq_esperada_min,        -- default 60 se nao mapeado
  l.qtd_lidos, l.qtd_inseridos, l.qtd_atualizados, l.qtd_erros,
  l.erro_tipo, l.erro_msg, l.api_calls,
  CASE
    WHEN l.status = 'erro' THEN 'erro'
    WHEN l.status = 'rate_limited' THEN 'rate_limited'
    -- Atrasado = 2x a frequência esperada (default 60 → 120min)
    WHEN (EXTRACT(EPOCH FROM now() - l.iniciado_em) / 60.0) > (COALESCE(fm.freq_min, 60) * 2)::numeric
      THEN 'atrasado'
    WHEN l.qtd_erros > 0 THEN 'parcial'
    WHEN l.status = 'rodando' AND (EXTRACT(EPOCH FROM now() - l.iniciado_em) / 60.0) > 30::numeric
      THEN 'travado'
    ELSE 'ok'
  END AS saude
FROM latest l
LEFT JOIN freq_map fm ON fm.tabela = l.tabela;

-- Reaplica RLS/grants (a view nao herda do drop)
GRANT SELECT ON public.bling_sync_health TO authenticated;
GRANT SELECT ON public.bling_sync_health TO service_role;
REVOKE ALL ON public.bling_sync_health FROM anon;

COMMIT;
