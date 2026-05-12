-- =============================================================================
-- FIX FASE 6 v3: Sugestão próximo produto usando produtos Bling
-- =============================================================================
-- Trocou produto_catalogo_site (251 curados) por produtos (Bling, 2237 matriz)
-- Match via codigo (SKU). Fallback nome+descricao quando código não bate.
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
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_segmento TEXT;
BEGIN
  -- 1) Segmento do cliente
  SELECT cs.segmento INTO v_segmento
  FROM cliente_scoring_full cs
  WHERE cs.contato_nome = p_contato_nome AND cs.empresa = p_empresa
  LIMIT 1;

  IF v_segmento IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH ja AS (
    -- Códigos + descrições já compradas (normalizadas)
    SELECT DISTINCT
      NULLIF(TRIM(pi.codigo), '') AS cod,
      LOWER(TRIM(pi.descricao)) AS desc_norm
    FROM pedidos p
    JOIN pedidos_itens pi ON pi.pedido_id = p.id
    WHERE p.contato_nome = p_contato_nome
      AND p.empresa = p_empresa
      AND p.situacao_id != 12
  ),
  clientes_seg AS (
    SELECT cs.contato_nome
    FROM cliente_scoring_full cs
    WHERE cs.empresa = p_empresa
      AND cs.segmento = v_segmento
      AND cs.contato_nome != p_contato_nome
    ORDER BY cs.total_gasto DESC NULLS LAST
    LIMIT 300
  ),
  top_pares AS (
    SELECT
      NULLIF(TRIM(pi.codigo), '') AS cod,
      LOWER(TRIM(pi.descricao)) AS desc_norm,
      MIN(pi.descricao) AS desc_orig,
      COUNT(DISTINCT p.contato_nome)::INT AS quantos
    FROM clientes_seg cs
    JOIN pedidos p ON p.contato_nome = cs.contato_nome AND p.empresa = p_empresa
    JOIN pedidos_itens pi ON pi.pedido_id = p.id
    WHERE p.situacao_id != 12
      AND p.data > (CURRENT_DATE - INTERVAL '180 days')
      AND pi.descricao IS NOT NULL
      AND TRIM(pi.descricao) <> ''
      AND LOWER(TRIM(pi.descricao)) NOT IN ('(sem itens)', 'sem itens', 'avulso', 'avulsa')
      AND LOWER(pi.descricao) NOT LIKE '%servi%bordado%'
      AND LOWER(pi.descricao) NOT LIKE '%aplica%bordado%'
      AND LOWER(pi.descricao) NOT LIKE '%personaliza%bordado%'
      AND LOWER(pi.descricao) NOT LIKE '%frete%'
    GROUP BY NULLIF(TRIM(pi.codigo), ''), LOWER(TRIM(pi.descricao))
    HAVING COUNT(DISTINCT p.contato_nome) >= 2
    ORDER BY COUNT(DISTINCT p.contato_nome) DESC
    LIMIT 50
  ),
  -- Filtra: cliente ainda NÃO comprou (match por codigo OU descrição)
  candidatos AS (
    SELECT tp.cod, tp.desc_norm, tp.desc_orig, tp.quantos
    FROM top_pares tp
    WHERE NOT EXISTS (
      SELECT 1 FROM ja
      WHERE (ja.cod IS NOT NULL AND ja.cod = tp.cod)
         OR (ja.desc_norm = tp.desc_norm)
    )
  )
  -- Join com produtos Bling pra pegar imagem + preço quando disponível
  SELECT
    COALESCE(pr.codigo, c.cod, '')::TEXT AS sku_ref,
    COALESCE(pr.nome, c.desc_orig, '')::TEXT AS nome,
    pr.imagem_url::TEXT AS imagem_principal,
    pr.preco AS preco,
    -- Categoria inferida da descrição
    CASE
      WHEN c.desc_norm LIKE '%jaleco%' THEN 'Jalecos'
      WHEN c.desc_norm LIKE '%scrub%' THEN 'Scrubs'
      WHEN c.desc_norm LIKE '%conjunto%' THEN 'Conjuntos'
      WHEN c.desc_norm LIKE '%gorro%' OR c.desc_norm LIKE '%touca%' THEN 'Acessórios'
      WHEN c.desc_norm LIKE '%calca%' OR c.desc_norm LIKE '%calça%' THEN 'Calças'
      WHEN c.desc_norm LIKE '%camisa%' OR c.desc_norm LIKE '%blusa%' THEN 'Camisas'
      WHEN c.desc_norm LIKE '%avental%' THEN 'Aventais'
      WHEN c.desc_norm LIKE '%kit%' THEN 'Kits'
      ELSE 'Outros'
    END AS categoria,
    c.quantos AS quantos_compraram,
    c.quantos::NUMERIC AS score
  FROM candidatos c
  LEFT JOIN produtos pr
    ON pr.empresa = p_empresa
   AND (pr.codigo = c.cod OR LOWER(TRIM(pr.nome)) = c.desc_norm)
  ORDER BY c.quantos DESC
  LIMIT p_limite;
END $$;

GRANT EXECUTE ON FUNCTION sugerir_produto_proximo(TEXT, TEXT, INT) TO authenticated;
