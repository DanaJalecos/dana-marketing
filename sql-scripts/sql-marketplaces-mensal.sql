-- ══════════════════════════════════════════════════════════════
-- RPC marketplaces_mensal — fonte do card "Marketplaces"
--
-- Mercado Livre  → dados REAIS da API do ML (analytics_ml_pedidos,
--                   status='paid', por data de PAGAMENTO date_closed).
--                   Bate com o painel do seller. ML = conta matriz.
-- Shopee/TikTok  → Bling (não têm API sincronizada): situacao 9
-- Site/Loja      → Bling: situacao 9 (Atendido) · total_produtos
--
-- O dashboard global NÃO usa esta RPC (regra própria, intacto).
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
  WITH bling AS (
    SELECT
      empresa,
      EXTRACT(year  FROM data)::int AS ano,
      EXTRACT(month FROM data)::int AS mes,
      COUNT(*) FILTER (WHERE loja_id=205522474)::int                                       AS pedidos_shopee,
      COALESCE(SUM(COALESCE(total_produtos,total,0)) FILTER (WHERE loja_id=205522474),0)   AS receita_shopee,
      COUNT(*) FILTER (WHERE loja_id=205430008)::int                                       AS pedidos_tiktok,
      COALESCE(SUM(COALESCE(total_produtos,total,0)) FILTER (WHERE loja_id=205430008),0)   AS receita_tiktok,
      COUNT(*) FILTER (WHERE loja_id=0 OR loja_id IS NULL)::int                            AS pedidos_site,
      COALESCE(SUM(COALESCE(total_produtos,total,0)) FILTER (WHERE loja_id=0 OR loja_id IS NULL),0) AS receita_site,
      COUNT(*) FILTER (WHERE loja_id IN (203536978,203550865))::int                        AS pedidos_loja,
      COALESCE(SUM(COALESCE(total_produtos,total,0)) FILTER (WHERE loja_id IN (203536978,203550865)),0) AS receita_loja
    FROM pedidos
    WHERE situacao_id = 9                       -- só "Atendido" (concluído)
    GROUP BY empresa, ano, mes
  ),
  ml AS (   -- dados reais do Mercado Livre (conta = matriz)
    SELECT
      'matriz'::text AS empresa,
      EXTRACT(year  FROM date_closed)::int AS ano,
      EXTRACT(month FROM date_closed)::int AS mes,
      COUNT(DISTINCT order_id)::int        AS pedidos_ml,
      COALESCE(SUM(total_amount),0)        AS receita_ml
    FROM analytics_ml_pedidos
    WHERE status = 'paid'
    GROUP BY 1,2,3
  ),
  keys AS (
    SELECT empresa,ano,mes FROM bling
    UNION
    SELECT empresa,ano,mes FROM ml
  ),
  per AS (
    SELECT
      k.empresa, k.ano, k.mes,
      COALESCE(m.pedidos_ml,0)     AS pedidos_ml,
      COALESCE(m.receita_ml,0)     AS receita_ml,
      COALESCE(b.pedidos_shopee,0) AS pedidos_shopee,
      COALESCE(b.receita_shopee,0) AS receita_shopee,
      COALESCE(b.pedidos_tiktok,0) AS pedidos_tiktok,
      COALESCE(b.receita_tiktok,0) AS receita_tiktok,
      COALESCE(b.pedidos_site,0)   AS pedidos_site,
      COALESCE(b.receita_site,0)   AS receita_site,
      COALESCE(b.pedidos_loja,0)   AS pedidos_loja,
      COALESCE(b.receita_loja,0)   AS receita_loja
    FROM keys k
    LEFT JOIN bling b ON b.empresa=k.empresa AND b.ano=k.ano AND b.mes=k.mes
    LEFT JOIN ml    m ON m.empresa=k.empresa AND m.ano=k.ano AND m.mes=k.mes
  )
  SELECT * FROM per
  UNION ALL
  SELECT 'todas', ano, mes,
    SUM(pedidos_ml)::int, SUM(receita_ml),
    SUM(pedidos_shopee)::int, SUM(receita_shopee),
    SUM(pedidos_tiktok)::int, SUM(receita_tiktok),
    SUM(pedidos_site)::int, SUM(receita_site),
    SUM(pedidos_loja)::int, SUM(receita_loja)
  FROM per GROUP BY ano, mes;
$$;
GRANT EXECUTE ON FUNCTION marketplaces_mensal() TO authenticated;

-- Diagnóstico: ML maio/2026 deve dar ~99 ped / R$30.599 (real ML)
SELECT empresa, ano, mes, pedidos_ml, receita_ml
FROM marketplaces_mensal()
WHERE ano=2026 AND mes=5 AND empresa IN ('matriz','bc','todas')
ORDER BY empresa;
