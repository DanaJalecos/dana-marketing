-- ══════════════════════════════════════════════════════════════
-- RPC marketplaces_mensal — fonte dedicada do card "Marketplaces"
--
-- Regra (decisão Juan): só pedidos CONCLUÍDOS (situacao_id = 9 =
-- "Atendido") e valor SÓ DOS PRODUTOS (total_produtos, sem frete).
-- Exclui cancelado (12) e em aberto (6) — diferente do dashboard
-- global, que tem regra própria e NÃO é alterado aqui.
--
-- Retorna 1 linha por empresa/ano/mês + linhas 'todas' (soma).
-- ══════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS marketplaces_mensal();
CREATE OR REPLACE FUNCTION marketplaces_mensal()
RETURNS TABLE (
  empresa TEXT, ano INT, mes INT,
  pedidos_ml INT,     receita_ml NUMERIC,
  pedidos_shopee INT, receita_shopee NUMERIC,
  pedidos_tiktok INT, receita_tiktok NUMERIC,
  pedidos_site INT,   receita_site NUMERIC,
  pedidos_loja INT,   receita_loja NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH base AS (
    SELECT
      empresa,
      EXTRACT(year  FROM data)::int AS ano,
      EXTRACT(month FROM data)::int AS mes,
      loja_id,
      COALESCE(total_produtos, total, 0) AS valor
    FROM pedidos
    WHERE situacao_id = 9                       -- só "Atendido" (concluído)
  ),
  agg AS (
    SELECT empresa, ano, mes,
      COUNT(*) FILTER (WHERE loja_id=205337834)::int                       AS pedidos_ml,
      COALESCE(SUM(valor) FILTER (WHERE loja_id=205337834),0)              AS receita_ml,
      COUNT(*) FILTER (WHERE loja_id=205522474)::int                       AS pedidos_shopee,
      COALESCE(SUM(valor) FILTER (WHERE loja_id=205522474),0)              AS receita_shopee,
      COUNT(*) FILTER (WHERE loja_id=205430008)::int                       AS pedidos_tiktok,
      COALESCE(SUM(valor) FILTER (WHERE loja_id=205430008),0)              AS receita_tiktok,
      COUNT(*) FILTER (WHERE loja_id=0 OR loja_id IS NULL)::int            AS pedidos_site,
      COALESCE(SUM(valor) FILTER (WHERE loja_id=0 OR loja_id IS NULL),0)   AS receita_site,
      COUNT(*) FILTER (WHERE loja_id IN (203536978,203550865))::int        AS pedidos_loja,
      COALESCE(SUM(valor) FILTER (WHERE loja_id IN (203536978,203550865)),0) AS receita_loja
    FROM base GROUP BY empresa, ano, mes
  )
  SELECT * FROM agg
  UNION ALL
  SELECT 'todas', ano, mes,
    SUM(pedidos_ml)::int, SUM(receita_ml),
    SUM(pedidos_shopee)::int, SUM(receita_shopee),
    SUM(pedidos_tiktok)::int, SUM(receita_tiktok),
    SUM(pedidos_site)::int, SUM(receita_site),
    SUM(pedidos_loja)::int, SUM(receita_loja)
  FROM agg GROUP BY ano, mes;
$$;
GRANT EXECUTE ON FUNCTION marketplaces_mensal() TO authenticated;

-- Diagnóstico: ML maio/2026 deve dar ~82 ped / R$33.730 (matriz)
SELECT empresa, ano, mes, pedidos_ml, receita_ml
FROM marketplaces_mensal()
WHERE ano=2026 AND mes=5 AND empresa IN ('matriz','todas')
ORDER BY empresa;
