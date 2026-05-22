-- ════════════════════════════════════════════════════════════════════════════
-- SECURITY HARDENING FASE 2 — VIEWS — 2026-05-22 (tarde)
-- Reteste Manus AI revelou: views continuavam vazando dado pra anon mesmo
-- depois do RLS das tabelas-base ter sido fechado.
--
-- Causa: views por default no Postgres rodam com privilegios do owner
-- (security_definer). RLS so se aplica a tabelas, nao a views, a menos que
-- a view seja criada com security_invoker = true (PG 15+).
--
-- Estrategia: REVOKE SELECT em todas as views pra anon (e public role),
-- e GRANT SELECT so pra authenticated + service_role.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

REVOKE SELECT ON public.analytics_jornada_cliente         FROM anon, public;
REVOKE SELECT ON public.analytics_ml_ads_resumo           FROM anon, public;
REVOKE SELECT ON public.bling_vendedor_counts             FROM anon, public;
REVOKE SELECT ON public.cliente_ciclo_compra              FROM anon, public;
REVOKE SELECT ON public.cliente_eventos_timeline          FROM anon, public;
REVOKE SELECT ON public.cliente_inadimplencia             FROM anon, public;
REVOKE SELECT ON public.cliente_scoring                   FROM anon, public;
REVOKE SELECT ON public.cliente_scoring_full              FROM anon, public;
REVOKE SELECT ON public.cliente_scoring_resumo            FROM anon, public;
REVOKE SELECT ON public.cliente_scoring_vendedor          FROM anon, public;
REVOKE SELECT ON public.dashboard_contas                  FROM anon, public;
REVOKE SELECT ON public.dashboard_mensal                  FROM anon, public;
REVOKE SELECT ON public.dashboard_resumo                  FROM anon, public;
REVOKE SELECT ON public.faturamento_real_mensal           FROM anon, public;
REVOKE SELECT ON public.funil_vendas                      FROM anon, public;
REVOKE SELECT ON public.influenciador_vendas              FROM anon, public;
REVOKE SELECT ON public.lead_qualificacao_atual           FROM anon, public;
REVOKE SELECT ON public.magazord_pedido_completo          FROM anon, public;
REVOKE SELECT ON public.magazord_pedido_itens             FROM anon, public;
REVOKE SELECT ON public.meus_clientes_totais              FROM anon, public;
REVOKE SELECT ON public.motivos_perda_unificado           FROM anon, public;
REVOKE SELECT ON public.pedidos_total_inconsistente       FROM anon, public;
REVOKE SELECT ON public.produtos_com_custo                FROM anon, public;
REVOKE SELECT ON public.produtos_parados_150d             FROM anon, public;
REVOKE SELECT ON public.produtos_velocidade_30d           FROM anon, public;
REVOKE SELECT ON public.produtos_velocidade_90d           FROM anon, public;
REVOKE SELECT ON public.produtos_velocidade_multi_janelas FROM anon, public;
REVOKE SELECT ON public.prospects_status_publico          FROM anon, public;
REVOKE SELECT ON public.receita_historica                 FROM anon, public;
REVOKE SELECT ON public.top_produtos                      FROM anon, public;
REVOKE SELECT ON public.top_produtos_marketplaces         FROM anon, public;
REVOKE SELECT ON public.top_produtos_marketplaces_mes     FROM anon, public;
REVOKE SELECT ON public.top_produtos_mes                  FROM anon, public;
REVOKE SELECT ON public.trend_periodo_view                FROM anon, public;
REVOKE SELECT ON public.velocidade_90d_view               FROM anon, public;
REVOKE SELECT ON public.vendas_dia_semana_view            FROM anon, public;
REVOKE SELECT ON public.vendas_por_utm                    FROM anon, public;
REVOKE SELECT ON public.vendedor_performance              FROM anon, public;
REVOKE SELECT ON public.vendedor_ranking_desempenho       FROM anon, public;
REVOKE SELECT ON public.vendedor_ranking_mensal           FROM anon, public;

-- Garantir authenticated continua lendo (idempotente)
GRANT SELECT ON public.analytics_jornada_cliente         TO authenticated;
GRANT SELECT ON public.analytics_ml_ads_resumo           TO authenticated;
GRANT SELECT ON public.bling_vendedor_counts             TO authenticated;
GRANT SELECT ON public.cliente_ciclo_compra              TO authenticated;
GRANT SELECT ON public.cliente_eventos_timeline          TO authenticated;
GRANT SELECT ON public.cliente_inadimplencia             TO authenticated;
GRANT SELECT ON public.cliente_scoring                   TO authenticated;
GRANT SELECT ON public.cliente_scoring_full              TO authenticated;
GRANT SELECT ON public.cliente_scoring_resumo            TO authenticated;
GRANT SELECT ON public.cliente_scoring_vendedor          TO authenticated;
GRANT SELECT ON public.dashboard_contas                  TO authenticated;
GRANT SELECT ON public.dashboard_mensal                  TO authenticated;
GRANT SELECT ON public.dashboard_resumo                  TO authenticated;
GRANT SELECT ON public.faturamento_real_mensal           TO authenticated;
GRANT SELECT ON public.funil_vendas                      TO authenticated;
GRANT SELECT ON public.influenciador_vendas              TO authenticated;
GRANT SELECT ON public.lead_qualificacao_atual           TO authenticated;
GRANT SELECT ON public.magazord_pedido_completo          TO authenticated;
GRANT SELECT ON public.magazord_pedido_itens             TO authenticated;
GRANT SELECT ON public.meus_clientes_totais              TO authenticated;
GRANT SELECT ON public.motivos_perda_unificado           TO authenticated;
GRANT SELECT ON public.pedidos_total_inconsistente       TO authenticated;
GRANT SELECT ON public.produtos_com_custo                TO authenticated;
GRANT SELECT ON public.produtos_parados_150d             TO authenticated;
GRANT SELECT ON public.produtos_velocidade_30d           TO authenticated;
GRANT SELECT ON public.produtos_velocidade_90d           TO authenticated;
GRANT SELECT ON public.produtos_velocidade_multi_janelas TO authenticated;
GRANT SELECT ON public.prospects_status_publico          TO authenticated;
GRANT SELECT ON public.receita_historica                 TO authenticated;
GRANT SELECT ON public.top_produtos                      TO authenticated;
GRANT SELECT ON public.top_produtos_marketplaces         TO authenticated;
GRANT SELECT ON public.top_produtos_marketplaces_mes     TO authenticated;
GRANT SELECT ON public.top_produtos_mes                  TO authenticated;
GRANT SELECT ON public.trend_periodo_view                TO authenticated;
GRANT SELECT ON public.velocidade_90d_view               TO authenticated;
GRANT SELECT ON public.vendas_dia_semana_view            TO authenticated;
GRANT SELECT ON public.vendas_por_utm                    TO authenticated;
GRANT SELECT ON public.vendedor_performance              TO authenticated;
GRANT SELECT ON public.vendedor_ranking_desempenho       TO authenticated;
GRANT SELECT ON public.vendedor_ranking_mensal           TO authenticated;

-- Default privileges pra novas views futuras: nada pra anon
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE SELECT ON TABLES FROM anon, PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO authenticated;

COMMIT;
