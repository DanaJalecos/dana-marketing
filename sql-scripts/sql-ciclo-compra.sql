-- =============================================================================
-- FASE 4: Ciclo de compra + benchmark por segmento
-- =============================================================================

-- 1) View: ciclo médio do cliente
--    Ciclo = (última - primeira) / (qtd_pedidos - 1)
--    Só calcula se tiver 2+ pedidos válidos (não cancelados)
CREATE OR REPLACE VIEW cliente_ciclo_compra AS
WITH compras AS (
  SELECT
    contato_nome,
    empresa,
    COUNT(DISTINCT id)::INT AS pedidos_validos,
    MIN(data) AS primeira_compra,
    MAX(data) AS ultima_compra
  FROM pedidos
  WHERE situacao_id != 12
    AND contato_nome IS NOT NULL
    AND contato_nome <> ''
    AND data IS NOT NULL
  GROUP BY contato_nome, empresa
)
SELECT
  contato_nome,
  empresa,
  pedidos_validos,
  primeira_compra,
  ultima_compra,
  CASE
    WHEN pedidos_validos > 1
    THEN ROUND((ultima_compra - primeira_compra)::NUMERIC / NULLIF(pedidos_validos - 1, 0))::INT
    ELSE NULL
  END AS ciclo_compra_dias
FROM compras;

COMMENT ON VIEW cliente_ciclo_compra IS
  'Ciclo médio de compra por cliente. NULL pra quem tem 1 pedido só.';

GRANT SELECT ON cliente_ciclo_compra TO authenticated;

-- 2) RPC: benchmark de ciclo por segmento (média + mediana)
CREATE OR REPLACE FUNCTION benchmark_ciclo_por_segmento(p_empresa TEXT)
RETURNS TABLE(segmento TEXT, ciclo_medio NUMERIC, ciclo_mediano NUMERIC, n_clientes INT)
LANGUAGE sql STABLE AS $$
  SELECT
    cs.segmento,
    ROUND(AVG(cc.ciclo_compra_dias), 1) AS ciclo_medio,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cc.ciclo_compra_dias) AS ciclo_mediano,
    COUNT(*)::INT AS n_clientes
  FROM cliente_scoring_full cs
  JOIN cliente_ciclo_compra cc
    ON cc.contato_nome = cs.contato_nome
   AND cc.empresa = cs.empresa
  WHERE cs.empresa = p_empresa
    AND cc.ciclo_compra_dias IS NOT NULL
  GROUP BY cs.segmento;
$$;

COMMENT ON FUNCTION benchmark_ciclo_por_segmento IS
  'Benchmark de ciclo de compra por segmento da empresa. Usado pra orientar vendedora a reduzir intervalo.';

GRANT EXECUTE ON FUNCTION benchmark_ciclo_por_segmento(TEXT) TO authenticated;

-- 3) Verificação
--   SELECT contato_nome, empresa, pedidos_validos, ciclo_compra_dias
--   FROM cliente_ciclo_compra WHERE ciclo_compra_dias IS NOT NULL
--   ORDER BY ciclo_compra_dias LIMIT 10;
--
--   SELECT * FROM benchmark_ciclo_por_segmento('matriz');
