-- =============================================================================
-- FASE 5: Filtro produtos → clientes (RPC + extensão pg_trgm)
-- =============================================================================

-- 1) Extensão pra ILIKE rápido (idempotente)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2) Índice GIN trigram pra acelerar `ILIKE '%X%'` em descricao
CREATE INDEX IF NOT EXISTS idx_pedidos_itens_descricao_trgm
  ON pedidos_itens USING gin (descricao gin_trgm_ops);

-- 3) RPC: dado um SKU ou nome (parcial), retorna lista de contato_nome que compraram
CREATE OR REPLACE FUNCTION clientes_que_compraram(
  p_query TEXT,
  p_empresa TEXT,
  p_limite INT DEFAULT 5000
)
RETURNS TABLE(contato_nome TEXT, qtd_pedidos INT, total_gasto NUMERIC, ultima_compra DATE)
LANGUAGE sql STABLE AS $$
  SELECT
    p.contato_nome,
    COUNT(DISTINCT p.id)::INT AS qtd_pedidos,
    SUM(pi.valor_total) AS total_gasto,
    MAX(p.data) AS ultima_compra
  FROM pedidos p
  JOIN pedidos_itens pi ON pi.pedido_id = p.id
  WHERE p.empresa = p_empresa
    AND p.contato_nome IS NOT NULL
    AND p.contato_nome <> ''
    AND p.situacao_id != 12
    AND (
      pi.codigo = p_query                              -- SKU exato
      OR pi.descricao ILIKE '%' || p_query || '%'      -- ou descrição parcial
    )
  GROUP BY p.contato_nome
  ORDER BY total_gasto DESC NULLS LAST
  LIMIT p_limite;
$$;

COMMENT ON FUNCTION clientes_que_compraram IS
  'Filtro produto->clientes do C360. Aceita SKU exato ou nome parcial (ILIKE). Usado pelo topbar da lista.';

GRANT EXECUTE ON FUNCTION clientes_que_compraram(TEXT, TEXT, INT) TO authenticated;

-- 4) Verificação
--   SELECT * FROM clientes_que_compraram('Chloe', 'matriz', 10);
--   SELECT * FROM clientes_que_compraram('378-ZI-008-000-F', 'matriz', 10);
