-- ══════════════════════════════════════════════════════════
-- GESTÃO DE ESTOQUE · Ciclo 91 (pedido da Manu — Entrega 1)
--
-- Adições vs Ciclo 88:
--   1. View `produtos_velocidade_multi_janelas` — vendas em 4
--      janelas (30d, 90d, 180d, 365d) pra mostrar TENDÊNCIA
--      de declínio/aceleração no card do produto.
--   2. RPC `listar_estoque_parados_v2` — aceita filtros opcionais:
--      `qty_min`, `qty_max` (filtro por unidades em estoque)
--      `valor_min` (filtro por R$ empatado)
--   3. View `produtos_parados_150d_v2` — estende a 150d com
--      JOIN da velocidade pra a RPC já entregar tudo.
--
-- Tudo aditivo. Não substitui nada de Ciclo 88 (compat reverso).
-- ══════════════════════════════════════════════════════════

-- ─── 1. View velocidade multi-janelas ───
-- 4 janelas: 30d, 90d, 180d, 365d. Servem pra mostrar tendência:
--   "vendia 5/m há 1y → 2/m há 6m → 0.3/m há 3m → 0/m há 1m"
CREATE OR REPLACE VIEW produtos_velocidade_multi_janelas AS
SELECT
  p.id AS produto_id,
  p.empresa,
  p.codigo,
  p.nome,
  p.estoque_virtual,
  p.preco,
  COALESCE(v30.qtd, 0)  AS qtd_30d,
  COALESCE(v90.qtd, 0)  AS qtd_90d,
  COALESCE(v180.qtd, 0) AS qtd_180d,
  COALESCE(v365.qtd, 0) AS qtd_365d,
  -- médias mensais aproximadas (qtd / meses na janela)
  ROUND(COALESCE(v30.qtd, 0)::numeric  / 1.0,  2) AS media_mes_30d,
  ROUND(COALESCE(v90.qtd, 0)::numeric  / 3.0,  2) AS media_mes_90d,
  ROUND(COALESCE(v180.qtd, 0)::numeric / 6.0,  2) AS media_mes_180d,
  ROUND(COALESCE(v365.qtd, 0)::numeric / 12.0, 2) AS media_mes_365d
FROM produtos p
LEFT JOIN LATERAL (
  SELECT SUM(pi.quantidade)::numeric AS qtd
  FROM pedidos_itens pi
  JOIN pedidos pe ON pe.id = pi.pedido_id
  WHERE pi.codigo = p.codigo AND pe.empresa = p.empresa
    AND pe.data >= NOW() - INTERVAL '30 days'
    AND pe.situacao_id != 12
) v30 ON true
LEFT JOIN LATERAL (
  SELECT SUM(pi.quantidade)::numeric AS qtd
  FROM pedidos_itens pi
  JOIN pedidos pe ON pe.id = pi.pedido_id
  WHERE pi.codigo = p.codigo AND pe.empresa = p.empresa
    AND pe.data >= NOW() - INTERVAL '90 days'
    AND pe.situacao_id != 12
) v90 ON true
LEFT JOIN LATERAL (
  SELECT SUM(pi.quantidade)::numeric AS qtd
  FROM pedidos_itens pi
  JOIN pedidos pe ON pe.id = pi.pedido_id
  WHERE pi.codigo = p.codigo AND pe.empresa = p.empresa
    AND pe.data >= NOW() - INTERVAL '180 days'
    AND pe.situacao_id != 12
) v180 ON true
LEFT JOIN LATERAL (
  SELECT SUM(pi.quantidade)::numeric AS qtd
  FROM pedidos_itens pi
  JOIN pedidos pe ON pe.id = pi.pedido_id
  WHERE pi.codigo = p.codigo AND pe.empresa = p.empresa
    AND pe.data >= NOW() - INTERVAL '365 days'
    AND pe.situacao_id != 12
) v365 ON true
WHERE p.situacao = 'A' AND p.tipo = 'P';

COMMENT ON VIEW produtos_velocidade_multi_janelas IS
  'Vendas em 4 janelas (30/90/180/365d) por produto. Usado no card da Gestão de Estoque pra mostrar tendência.';

-- ─── 2. RPC listar_estoque_parados_v2 ───
-- Aceita filtros opcionais. Retorna histórico completo de vendas
-- nas 4 janelas pra cada produto parado.
CREATE OR REPLACE FUNCTION listar_estoque_parados_v2(
  empresa_filter text DEFAULT 'todas',
  qty_min int DEFAULT NULL,
  qty_max int DEFAULT NULL,
  valor_min numeric DEFAULT NULL
)
RETURNS TABLE (
  produto_id bigint,
  codigo text,
  nome text,
  estoque_virtual int,
  preco numeric,
  empresa text,
  valor_parado numeric,
  ultima_venda timestamptz,
  dias_sem_vender int,
  qtd_30d numeric,
  qtd_90d numeric,
  qtd_180d numeric,
  qtd_365d numeric,
  media_mes_30d numeric,
  media_mes_90d numeric,
  media_mes_180d numeric,
  media_mes_365d numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    pp.produto_id,
    pp.codigo,
    pp.nome,
    pp.estoque_virtual,
    pp.preco,
    pp.empresa,
    pp.valor_parado,
    pp.ultima_venda,
    CASE
      WHEN pp.ultima_venda IS NULL THEN NULL
      ELSE (EXTRACT(EPOCH FROM (NOW() - pp.ultima_venda))::bigint / 86400)::int
    END AS dias_sem_vender,
    COALESCE(mj.qtd_30d, 0)       AS qtd_30d,
    COALESCE(mj.qtd_90d, 0)       AS qtd_90d,
    COALESCE(mj.qtd_180d, 0)      AS qtd_180d,
    COALESCE(mj.qtd_365d, 0)      AS qtd_365d,
    COALESCE(mj.media_mes_30d, 0) AS media_mes_30d,
    COALESCE(mj.media_mes_90d, 0) AS media_mes_90d,
    COALESCE(mj.media_mes_180d, 0) AS media_mes_180d,
    COALESCE(mj.media_mes_365d, 0) AS media_mes_365d
  FROM produtos_parados_150d pp
  LEFT JOIN produtos_velocidade_multi_janelas mj ON mj.produto_id = pp.produto_id
  WHERE (empresa_filter = 'todas' OR pp.empresa = empresa_filter)
    AND (qty_min IS NULL OR pp.estoque_virtual >= qty_min)
    AND (qty_max IS NULL OR pp.estoque_virtual <= qty_max)
    AND (valor_min IS NULL OR pp.valor_parado >= valor_min)
  ORDER BY pp.valor_parado DESC NULLS LAST
  LIMIT 500;
$$;

COMMENT ON FUNCTION listar_estoque_parados_v2(text,int,int,numeric) IS
  'Listagem de produtos parados (>150d sem giro) com histórico 4-janelas e filtros opcionais (qty_min, qty_max, valor_min).';

-- ─── 3. Diagnóstico final ───
SELECT
  'multi_janelas_total' AS metric,
  COUNT(*)::text AS valor
FROM produtos_velocidade_multi_janelas
UNION ALL
SELECT 'produtos_com_giro_30d', COUNT(*)::text
FROM produtos_velocidade_multi_janelas WHERE qtd_30d > 0
UNION ALL
SELECT 'produtos_com_giro_365d', COUNT(*)::text
FROM produtos_velocidade_multi_janelas WHERE qtd_365d > 0
UNION ALL
SELECT 'parados_v2_default', COUNT(*)::text
FROM listar_estoque_parados_v2('todas')
UNION ALL
SELECT 'parados_v2_acima_10un', COUNT(*)::text
FROM listar_estoque_parados_v2('todas', 10, NULL, NULL)
UNION ALL
SELECT 'parados_v2_valor_acima_500', COUNT(*)::text
FROM listar_estoque_parados_v2('todas', NULL, NULL, 500);
