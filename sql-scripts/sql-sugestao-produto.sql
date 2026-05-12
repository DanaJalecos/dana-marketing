-- =============================================================================
-- FASE 6: Sugestão próximo produto (RPC pra cliente baseado em segmento + cat)
-- =============================================================================

CREATE OR REPLACE FUNCTION sugerir_produto_proximo(
  p_contato_nome TEXT,
  p_empresa TEXT,
  p_limite INT DEFAULT 3
)
RETURNS TABLE(
  sku_ref TEXT,
  nome TEXT,
  imagem_principal TEXT,
  preco NUMERIC,
  categoria TEXT,
  quantos_compraram INT,
  score NUMERIC
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_segmento TEXT;
  v_categoria TEXT;
BEGIN
  -- Identifica segmento do cliente
  SELECT cs.segmento INTO v_segmento
  FROM cliente_scoring_full cs
  WHERE cs.contato_nome = p_contato_nome AND cs.empresa = p_empresa
  LIMIT 1;

  IF v_segmento IS NULL THEN
    RETURN;  -- cliente sem score = sem sugestão
  END IF;

  -- Identifica categoria preferida (heurística via descrição)
  WITH descricoes AS (
    SELECT LOWER(STRING_AGG(pi.descricao, ' ')) AS agg
    FROM pedidos p JOIN pedidos_itens pi ON pi.pedido_id = p.id
    WHERE p.contato_nome = p_contato_nome AND p.empresa = p_empresa
      AND p.situacao_id != 12
    LIMIT 100
  )
  SELECT CASE
    WHEN agg LIKE '%jaleco%' THEN 'jaleco'
    WHEN agg LIKE '%scrub%'  THEN 'scrub'
    WHEN agg LIKE '%gorro%'  THEN 'gorro'
    WHEN agg LIKE '%avental%' THEN 'avental'
    WHEN agg LIKE '%conjunto%' THEN 'conjunto'
    ELSE NULL
  END INTO v_categoria FROM descricoes;

  -- Produtos do mesmo segmento que ESTE cliente ainda NÃO comprou
  RETURN QUERY
  WITH ja_comprados AS (
    SELECT DISTINCT LOWER(TRIM(pi.descricao)) AS desc_norm
    FROM pedidos p JOIN pedidos_itens pi ON pi.pedido_id = p.id
    WHERE p.contato_nome = p_contato_nome
      AND p.empresa = p_empresa
      AND p.situacao_id != 12
  ),
  candidatos AS (
    SELECT
      pcs.sku_ref,
      pcs.nome,
      pcs.imagem_principal,
      pcs.preco,
      pcs.categoria,
      COUNT(DISTINCT p.contato_nome)::INT AS quantos_compraram
    FROM cliente_scoring_full cs
    JOIN pedidos p
      ON p.contato_nome = cs.contato_nome AND p.empresa = cs.empresa
    JOIN pedidos_itens pi ON pi.pedido_id = p.id
    JOIN produto_catalogo_site pcs
      ON (pi.codigo = pcs.sku_ref OR LOWER(pi.descricao) LIKE '%' || LOWER(pcs.nome) || '%')
    WHERE cs.empresa = p_empresa
      AND cs.segmento = v_segmento
      AND cs.contato_nome != p_contato_nome
      AND p.situacao_id != 12
      AND p.data > NOW() - INTERVAL '180 days'
      AND (v_categoria IS NULL OR LOWER(pcs.categoria) LIKE '%' || v_categoria || '%')
      AND LOWER(TRIM(pcs.nome)) NOT IN (SELECT desc_norm FROM ja_comprados)
    GROUP BY pcs.sku_ref, pcs.nome, pcs.imagem_principal, pcs.preco, pcs.categoria
  )
  SELECT
    c.sku_ref, c.nome, c.imagem_principal, c.preco, c.categoria,
    c.quantos_compraram, c.quantos_compraram::NUMERIC AS score
  FROM candidatos c
  ORDER BY c.quantos_compraram DESC
  LIMIT p_limite;
END $$;

COMMENT ON FUNCTION sugerir_produto_proximo IS
  'Sugere top N produtos do catálogo curado que clientes do mesmo segmento + categoria compraram E este cliente ainda não comprou.';

GRANT EXECUTE ON FUNCTION sugerir_produto_proximo(TEXT, TEXT, INT) TO authenticated;

-- Verificação:
-- SELECT * FROM sugerir_produto_proximo('DHOM INDUSTRIA E COMERCIO EIRELI', 'matriz', 3);
