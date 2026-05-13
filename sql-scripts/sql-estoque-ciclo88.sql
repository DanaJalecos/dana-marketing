-- ══════════════════════════════════════════════════════════
-- GESTÃO DE ESTOQUE · Ciclo 88 (atualização pedida pela Manu)
--
-- Mudanças vs Ciclo 86:
--   1. View `produtos_velocidade_90d` (subst à 30d) — média de venda
--      dos últimos 3 meses pra programação de produção mais estável
--   2. View `produtos_parados_150d` — produtos com estoque > 0 e
--      ZERO vendas nos últimos 5 meses (candidatos a campanha de
--      desconto pra liquidar)
--   3. RPC atualizadas pra usar a janela de 90d como base do cálculo
--      de "quantidade sugerida pra produção"
-- ══════════════════════════════════════════════════════════

-- ─── 1. View principal: velocidade de venda 90 dias ───
-- Substitui produtos_velocidade_30d. Fórmula:
--   vendas_dia = qtd_vendida_90d / 90
--   media_mes = qtd_vendida_90d / 3
--   qtd_sugerida = max(media_mes * 2 - estoque_atual, 0)
--     (programa produção pra cobrir ~2 meses, descontando estoque já existente)
CREATE OR REPLACE VIEW produtos_velocidade_90d AS
SELECT
  p.id AS produto_id,
  p.empresa,
  p.codigo,
  p.nome,
  p.estoque_virtual,
  p.preco,
  COALESCE(v.qtd_vendida_90d, 0) AS qtd_vendida_90d,
  ROUND(COALESCE(v.qtd_vendida_90d, 0) / 90.0, 2) AS vendas_dia,
  ROUND(COALESCE(v.qtd_vendida_90d, 0) / 3.0, 1) AS media_mes,
  CASE
    WHEN COALESCE(v.qtd_vendida_90d, 0) = 0 THEN NULL
    ELSE CEIL(p.estoque_virtual::numeric / (v.qtd_vendida_90d::numeric / 90.0))::int
  END AS dias_de_estoque,
  CASE
    WHEN COALESCE(v.qtd_vendida_90d, 0) = 0 THEN 0  -- sem giro → não sugere produzir
    ELSE GREATEST(
      CEIL((v.qtd_vendida_90d::numeric / 3.0) * 2)::int - p.estoque_virtual,
      0
    )
  END AS qtd_sugerida_producao
FROM produtos p
LEFT JOIN LATERAL (
  SELECT SUM(pi.quantidade)::numeric AS qtd_vendida_90d
  FROM pedidos_itens pi
  JOIN pedidos pe ON pe.id = pi.pedido_id
  WHERE pi.codigo = p.codigo
    AND pe.empresa = p.empresa
    AND pe.data >= NOW() - INTERVAL '90 days'
    AND pe.situacao_id != 12
) v ON true
WHERE p.situacao = 'A' AND p.tipo = 'P';

-- ─── 2. View parados: estoque > 0 sem vendas 150 dias ───
-- 5 meses sem girar = candidato pra liquidação/desconto
CREATE OR REPLACE VIEW produtos_parados_150d AS
SELECT
  p.id AS produto_id,
  p.empresa,
  p.codigo,
  p.nome,
  p.estoque_virtual,
  p.preco,
  p.estoque_virtual * p.preco AS valor_parado,
  (
    SELECT MAX(pe.data)
    FROM pedidos_itens pi
    JOIN pedidos pe ON pe.id = pi.pedido_id
    WHERE pi.codigo = p.codigo
      AND pe.empresa = p.empresa
      AND pe.situacao_id != 12
  ) AS ultima_venda
FROM produtos p
WHERE p.situacao = 'A' AND p.tipo = 'P'
  AND p.estoque_virtual > 0
  AND NOT EXISTS (
    SELECT 1 FROM pedidos_itens pi
    JOIN pedidos pe ON pe.id = pi.pedido_id
    WHERE pi.codigo = p.codigo
      AND pe.empresa = p.empresa
      AND pe.data >= NOW() - INTERVAL '150 days'
      AND pe.situacao_id != 12
  );

-- ─── 3. RPC listar_estoque_baixo (atualizada pra usar 90d) ───
DROP FUNCTION IF EXISTS listar_estoque_baixo(text);
CREATE OR REPLACE FUNCTION listar_estoque_baixo(empresa_filter text DEFAULT 'todas')
RETURNS TABLE (
  alerta_id bigint,
  produto_id bigint,
  codigo text,
  nome text,
  estoque_virtual int,
  preco numeric,
  empresa text,
  nivel text,
  created_at timestamptz,
  ignorado_ate date,
  qtd_vendida_90d numeric,
  vendas_dia numeric,
  media_mes numeric,
  dias_de_estoque int,
  qtd_sugerida_producao int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    a.id AS alerta_id,
    p.id AS produto_id,
    p.codigo,
    p.nome,
    p.estoque_virtual,
    p.preco,
    p.empresa,
    a.nivel,
    a.created_at,
    a.ignorado_ate,
    v.qtd_vendida_90d,
    v.vendas_dia,
    v.media_mes,
    v.dias_de_estoque,
    v.qtd_sugerida_producao
  FROM alertas a
  JOIN produtos p ON p.id = (a.dados->>'produto_id')::bigint
  LEFT JOIN produtos_velocidade_90d v ON v.produto_id = p.id
  WHERE a.tipo = 'estoque_baixo'
    AND a.resolvido_em IS NULL
    AND (a.ignorado_ate IS NULL OR a.ignorado_ate < CURRENT_DATE)
    AND (empresa_filter = 'todas' OR p.empresa = empresa_filter)
  ORDER BY p.estoque_virtual ASC, a.created_at DESC;
$$;

-- ─── 4. RPC listar_parados (nova) ───
CREATE OR REPLACE FUNCTION listar_estoque_parados(empresa_filter text DEFAULT 'todas')
RETURNS TABLE (
  produto_id bigint,
  codigo text,
  nome text,
  estoque_virtual int,
  preco numeric,
  empresa text,
  valor_parado numeric,
  ultima_venda timestamptz,
  dias_sem_vender int
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
      ELSE EXTRACT(EPOCH FROM (NOW() - pp.ultima_venda))::int / 86400
    END AS dias_sem_vender
  FROM produtos_parados_150d pp
  WHERE (empresa_filter = 'todas' OR pp.empresa = empresa_filter)
  ORDER BY pp.valor_parado DESC NULLS LAST
  LIMIT 500;
$$;

-- ─── 5. KPIs atualizados (inclui parados) ───
CREATE OR REPLACE FUNCTION estoque_kpis(empresa_filter text DEFAULT 'todas')
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT json_build_object(
    'criticos', (
      SELECT COUNT(*) FROM alertas a
      JOIN produtos p ON p.id = (a.dados->>'produto_id')::bigint
      WHERE a.tipo = 'estoque_baixo' AND a.resolvido_em IS NULL
        AND (a.ignorado_ate IS NULL OR a.ignorado_ate < CURRENT_DATE)
        AND p.estoque_virtual < 3
        AND (empresa_filter = 'todas' OR p.empresa = empresa_filter)
    ),
    'baixos', (
      SELECT COUNT(*) FROM alertas a
      JOIN produtos p ON p.id = (a.dados->>'produto_id')::bigint
      WHERE a.tipo = 'estoque_baixo' AND a.resolvido_em IS NULL
        AND (a.ignorado_ate IS NULL OR a.ignorado_ate < CURRENT_DATE)
        AND p.estoque_virtual BETWEEN 3 AND 5
        AND (empresa_filter = 'todas' OR p.empresa = empresa_filter)
    ),
    'parados', (
      SELECT COUNT(*) FROM produtos_parados_150d pp
      WHERE (empresa_filter = 'todas' OR pp.empresa = empresa_filter)
    ),
    'valor_parado', (
      SELECT COALESCE(SUM(pp.valor_parado), 0) FROM produtos_parados_150d pp
      WHERE (empresa_filter = 'todas' OR pp.empresa = empresa_filter)
    ),
    'resolvidos_semana', (
      SELECT COUNT(*) FROM alertas a
      JOIN produtos p ON p.id = (a.dados->>'produto_id')::bigint
      WHERE a.tipo = 'estoque_baixo'
        AND a.resolvido_em >= NOW() - INTERVAL '7 days'
        AND (empresa_filter = 'todas' OR p.empresa = empresa_filter)
    )
  );
$$;

-- Diagnóstico final
SELECT
  (SELECT COUNT(*) FROM produtos_velocidade_90d WHERE qtd_vendida_90d > 0) AS produtos_com_giro_90d,
  (SELECT COUNT(*) FROM produtos_parados_150d) AS produtos_parados_150d,
  (SELECT COUNT(*) FROM produtos_parados_150d WHERE empresa = 'matriz') AS parados_matriz,
  (SELECT ROUND(COALESCE(SUM(valor_parado),0)::numeric, 2) FROM produtos_parados_150d) AS valor_parado_total;
