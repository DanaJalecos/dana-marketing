-- =============================================================================
-- FASE 7: Esteira de produtos / mix vendidos juntos (collaborative filtering simples)
-- =============================================================================
-- Pré-computa pares (A, B) com co-ocorrência em mesmo pedido_id.
-- Cron semanal pra recalcular (processamento pesado O(n²) em pedidos_itens).
-- =============================================================================

-- 1) Tabela cache
CREATE TABLE IF NOT EXISTS produtos_mix (
  codigo_a TEXT NOT NULL,
  codigo_b TEXT NOT NULL,
  descricao_a TEXT,
  descricao_b TEXT,
  sku_ref_a TEXT,                       -- match opcional com catálogo curado
  sku_ref_b TEXT,
  co_ocorrencias INT NOT NULL,          -- pedidos com A E B juntos
  total_a INT NOT NULL,                 -- pedidos com A
  total_b INT NOT NULL,                 -- pedidos com B
  lift NUMERIC,                         -- (co/N) / ((tA/N)*(tB/N))
  confidence_a_to_b NUMERIC,            -- co / total_a
  atualizado_em TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (codigo_a, codigo_b)
);

CREATE INDEX IF NOT EXISTS idx_produtos_mix_codigo_a
  ON produtos_mix(codigo_a, co_ocorrencias DESC);
CREATE INDEX IF NOT EXISTS idx_produtos_mix_codigo_b
  ON produtos_mix(codigo_b, co_ocorrencias DESC);

GRANT SELECT ON produtos_mix TO authenticated;

-- 2) RPC que repopula a tabela
CREATE OR REPLACE FUNCTION refresh_produtos_mix(p_min_co INT DEFAULT 5)
RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
  v_total_pedidos INT;
  v_inseridos INT;
BEGIN
  SELECT COUNT(DISTINCT p.id) INTO v_total_pedidos
  FROM pedidos p WHERE p.situacao_id != 12;

  IF v_total_pedidos IS NULL OR v_total_pedidos = 0 THEN RETURN 0; END IF;

  TRUNCATE produtos_mix;

  WITH itens_norm AS (
    -- Normaliza: usa codigo se existir, senão truncate descrição
    SELECT pi.pedido_id,
           COALESCE(NULLIF(TRIM(pi.codigo), ''), LOWER(LEFT(pi.descricao, 60))) AS codigo,
           pi.descricao
    FROM pedidos_itens pi
    JOIN pedidos p ON p.id = pi.pedido_id AND p.situacao_id != 12
    WHERE pi.descricao IS NOT NULL AND pi.descricao <> ''
  ),
  pares AS (
    SELECT
      LEAST(a.codigo, b.codigo) AS codigo_a,
      GREATEST(a.codigo, b.codigo) AS codigo_b,
      MIN(CASE WHEN a.codigo < b.codigo THEN a.descricao ELSE b.descricao END) AS descricao_a,
      MIN(CASE WHEN a.codigo > b.codigo THEN a.descricao ELSE b.descricao END) AS descricao_b,
      COUNT(DISTINCT a.pedido_id) AS co
    FROM itens_norm a
    JOIN itens_norm b ON a.pedido_id = b.pedido_id AND a.codigo < b.codigo
    GROUP BY 1, 2
    HAVING COUNT(DISTINCT a.pedido_id) >= p_min_co
  ),
  totais AS (
    SELECT codigo, COUNT(DISTINCT pedido_id)::INT AS total
    FROM itens_norm GROUP BY codigo
  )
  INSERT INTO produtos_mix (
    codigo_a, codigo_b, descricao_a, descricao_b,
    sku_ref_a, sku_ref_b,
    co_ocorrencias, total_a, total_b, lift, confidence_a_to_b
  )
  SELECT
    pa.codigo_a, pa.codigo_b, pa.descricao_a, pa.descricao_b,
    pcs_a.sku_ref, pcs_b.sku_ref,
    pa.co, ta.total, tb.total,
    ROUND(((pa.co::NUMERIC / v_total_pedidos) /
          NULLIF((ta.total::NUMERIC / v_total_pedidos) * (tb.total::NUMERIC / v_total_pedidos), 0)
         )::NUMERIC, 3),
    ROUND((pa.co::NUMERIC / NULLIF(ta.total, 0))::NUMERIC, 3)
  FROM pares pa
  JOIN totais ta ON ta.codigo = pa.codigo_a
  JOIN totais tb ON tb.codigo = pa.codigo_b
  LEFT JOIN produto_catalogo_site pcs_a
    ON pcs_a.sku_ref = pa.codigo_a
    OR LOWER(pa.descricao_a) LIKE '%' || LOWER(pcs_a.nome) || '%'
  LEFT JOIN produto_catalogo_site pcs_b
    ON pcs_b.sku_ref = pa.codigo_b
    OR LOWER(pa.descricao_b) LIKE '%' || LOWER(pcs_b.nome) || '%'
  WHERE ta.total >= p_min_co AND tb.total >= p_min_co
  ON CONFLICT (codigo_a, codigo_b) DO NOTHING;

  GET DIAGNOSTICS v_inseridos = ROW_COUNT;
  RETURN v_inseridos;
END $$;

COMMENT ON FUNCTION refresh_produtos_mix IS
  'Recalcula matriz de co-ocorrência produtos. Pesado (O(n²) em pedidos_itens). Cron semanal recomendado.';

GRANT EXECUTE ON FUNCTION refresh_produtos_mix(INT) TO authenticated;

-- 3) RPC pra consumo da UI: dado cliente, retorna mix recomendado dos produtos dele
CREATE OR REPLACE FUNCTION mix_para_cliente(
  p_contato_nome TEXT,
  p_empresa TEXT,
  p_limite_por_produto INT DEFAULT 5
)
RETURNS TABLE(
  produto_origem TEXT, produto_origem_desc TEXT,
  produto_sugerido_codigo TEXT, produto_sugerido_desc TEXT,
  sku_ref_sugerido TEXT, imagem_sugerida TEXT, nome_curado TEXT,
  co_ocorrencias INT, confidence NUMERIC, lift NUMERIC
)
LANGUAGE sql STABLE AS $$
  WITH meus_produtos AS (
    SELECT DISTINCT
      COALESCE(NULLIF(TRIM(pi.codigo), ''), LOWER(LEFT(pi.descricao, 60))) AS codigo,
      pi.descricao
    FROM pedidos p JOIN pedidos_itens pi ON pi.pedido_id = p.id
    WHERE p.contato_nome = p_contato_nome
      AND p.empresa = p_empresa
      AND p.situacao_id != 12
    LIMIT 20
  ),
  mix AS (
    SELECT
      mp.codigo AS origem,
      mp.descricao AS origem_desc,
      CASE WHEN pm.codigo_a = mp.codigo THEN pm.codigo_b ELSE pm.codigo_a END AS sugerido,
      CASE WHEN pm.codigo_a = mp.codigo THEN pm.descricao_b ELSE pm.descricao_a END AS sugerido_desc,
      CASE WHEN pm.codigo_a = mp.codigo THEN pm.sku_ref_b ELSE pm.sku_ref_a END AS sku_ref,
      pm.co_ocorrencias, pm.confidence_a_to_b, pm.lift,
      ROW_NUMBER() OVER (PARTITION BY mp.codigo ORDER BY pm.co_ocorrencias DESC) AS rank
    FROM meus_produtos mp
    JOIN produtos_mix pm ON pm.codigo_a = mp.codigo OR pm.codigo_b = mp.codigo
    WHERE NOT EXISTS (
      SELECT 1 FROM meus_produtos mp2
      WHERE mp2.codigo = CASE WHEN pm.codigo_a = mp.codigo THEN pm.codigo_b ELSE pm.codigo_a END
    )
  )
  SELECT
    mix.origem, mix.origem_desc, mix.sugerido, mix.sugerido_desc,
    mix.sku_ref, pcs.imagem_principal, pcs.nome,
    mix.co_ocorrencias, mix.confidence_a_to_b, mix.lift
  FROM mix
  LEFT JOIN produto_catalogo_site pcs ON pcs.sku_ref = mix.sku_ref
  WHERE mix.rank <= p_limite_por_produto
  ORDER BY mix.origem, mix.co_ocorrencias DESC;
$$;

GRANT EXECUTE ON FUNCTION mix_para_cliente TO authenticated;

-- 4) Cron semanal: domingo 04:30 UTC (idempotente)
DO $$ BEGIN
  PERFORM cron.unschedule('cron-produtos-mix-semanal');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule('cron-produtos-mix-semanal', '30 4 * * 0',
  $cron$SELECT refresh_produtos_mix(5);$cron$
);

-- Verificação:
--   SELECT refresh_produtos_mix(5);  -- manual primeira vez (3-5min)
--   SELECT COUNT(*) FROM produtos_mix;
--   SELECT * FROM mix_para_cliente('DHOM INDUSTRIA E COMERCIO EIRELI', 'matriz', 3) LIMIT 20;
