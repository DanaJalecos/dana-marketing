-- ============================================================
-- VIEW agregada pra KPIs e ranking do Meus Clientes
-- (evita bater no limite 1000 do PostgREST)
-- ============================================================

CREATE OR REPLACE VIEW vendedor_performance AS
SELECT
  empresa,
  vendedor_profile_id,
  vendedor_nome,
  vendedor_fonte,
  count(*) AS clientes,
  count(*) FILTER (WHERE segmento = 'VIP') AS vips,
  count(*) FILTER (WHERE (dias_sem_compra <= 180) AND segmento NOT IN ('Inativo','Perdido','Sem histórico')) AS ativos,
  count(*) FILTER (WHERE segmento = 'Em Risco') AS em_risco,
  count(*) FILTER (WHERE segmento = 'Inativo' OR dias_sem_compra > 365) AS inativos,
  COALESCE(sum(total_gasto), 0) AS faturamento,
  COALESCE(sum(total_pedidos), 0) AS pedidos_total,
  CASE WHEN sum(total_pedidos) > 0 THEN sum(total_gasto) / sum(total_pedidos) ELSE 0 END AS ticket_medio
FROM cliente_scoring_vendedor
GROUP BY empresa, vendedor_profile_id, vendedor_nome, vendedor_fonte;

-- Totais por empresa (um unico row por empresa)
CREATE OR REPLACE VIEW meus_clientes_totais AS
SELECT
  empresa,
  count(*) AS total_clientes,
  count(*) FILTER (WHERE vendedor_profile_id IS NOT NULL) AS com_vendedor,
  count(*) FILTER (WHERE vendedor_profile_id IS NULL) AS sem_vendedor,
  count(DISTINCT vendedor_profile_id) FILTER (WHERE vendedor_profile_id IS NOT NULL) AS vendedores_ativos,
  COALESCE(sum(total_gasto), 0) AS faturamento_total
FROM cliente_scoring_vendedor
GROUP BY empresa;
