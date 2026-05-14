-- ══════════════════════════════════════════════════════════
-- Diagnóstico avançado de custos — 3 melhorias (Manu 14/05):
--
-- 1. Coluna `origem_match` na view (audit trail do matching)
-- 2. RPC produtos_sem_custo() — lista SKUs sem ficha + filtros
-- 3. RPC produtos_custos_cobertura_modelos() — ficha → qtd SKUs
-- ══════════════════════════════════════════════════════════

-- ─── 1. View v5 com origem_match ───
DROP VIEW IF EXISTS produtos_com_custo CASCADE;
CREATE OR REPLACE VIEW produtos_com_custo AS
WITH
fichas AS (
  SELECT
    pc.codigo_ficha, pc.nome_ficha, pc.tipo, pc.custo_total,
    _custo_tokenizar(pc.nome_ficha) AS todos_tokens,
    _custo_discriminantes(_custo_tokenizar(pc.nome_ficha)) AS tokens_disc,
    (SELECT t FROM unnest(_custo_tokenizar(pc.nome_ficha)) t
     WHERE t IN ('scrub','jaleco','avental','macacao','dolma','touca','gorro','turbante','camiseta','calca','blusa')
     LIMIT 1) AS categoria_detectada
  FROM produtos_custos pc
  WHERE pc.ativo = true AND pc.custo_total > 0
),
produtos AS (
  SELECT
    p.id AS produto_id, p.codigo AS produto_codigo, p.nome AS produto_nome,
    p.preco, p.empresa,
    translate(lower(p.nome),
      'áàâãäéèêëíìîïóòôõöúùûüçñ',
      'aaaaaeeeeiiiiooooouuuucn') AS nome_lower,
    _custo_tokenizar(regexp_replace(p.nome,
      '\s*(Tamanho|Cor|Manga|Modelo|Decote)\s*:[^;]*;?', '', 'gi')) AS tokens_produto
  FROM produtos p
  WHERE p.situacao = 'A' AND p.tipo = 'P'
),
-- PASSE 1: match específico — todos os discriminantes presentes
match_especifico AS (
  SELECT
    p.produto_id, p.produto_codigo, p.produto_nome, p.preco, p.empresa,
    f.codigo_ficha, f.nome_ficha, f.tipo, f.custo_total,
    array_length(f.tokens_disc, 1) AS total_disc,
    (SELECT COUNT(*) FROM unnest(f.tokens_disc) td WHERE td = ANY(p.tokens_produto)) AS score_disc
  FROM produtos p
  CROSS JOIN fichas f
  WHERE f.categoria_detectada IS NOT NULL
    AND p.nome_lower LIKE '%' || f.categoria_detectada || '%'
    AND array_length(f.tokens_disc, 1) >= 1
),
melhor_especifico AS (
  SELECT DISTINCT ON (produto_id)
    produto_id, produto_codigo, produto_nome, preco, empresa,
    codigo_ficha, nome_ficha, tipo, custo_total,
    'especifico_nome' AS origem_match  -- ← NOVO: registra a regra usada
  FROM match_especifico
  WHERE score_disc = total_disc
  ORDER BY produto_id, total_disc DESC, length(nome_ficha) DESC
),
-- PASSE 2: fallback genérico — fichas só com categoria
match_generico AS (
  SELECT DISTINCT ON (p.produto_id)
    p.produto_id, p.produto_codigo, p.produto_nome, p.preco, p.empresa,
    f.codigo_ficha, f.nome_ficha, f.tipo, f.custo_total,
    'generico_categoria' AS origem_match  -- ← NOVO
  FROM produtos p
  CROSS JOIN fichas f
  WHERE f.categoria_detectada IS NOT NULL
    AND p.nome_lower LIKE '%' || f.categoria_detectada || '%'
    AND (f.tokens_disc IS NULL OR array_length(f.tokens_disc, 1) = 0)
    AND p.produto_id NOT IN (SELECT produto_id FROM melhor_especifico)
  ORDER BY p.produto_id, length(f.nome_ficha) ASC
),
combinado AS (
  SELECT * FROM melhor_especifico
  UNION ALL SELECT * FROM match_generico
)
SELECT
  produto_id, produto_codigo, produto_nome, preco, empresa,
  codigo_ficha, nome_ficha, tipo,
  custo_total AS custo_unitario,
  CASE WHEN custo_total IS NULL OR custo_total = 0 OR preco IS NULL OR preco = 0 THEN NULL
       ELSE ROUND(((preco - custo_total) / preco * 100)::numeric, 1) END AS margem_pct,
  origem_match
FROM combinado;

-- Atualiza a RPC pra retornar origem_match também
DROP FUNCTION IF EXISTS produtos_custos_lookup(text[]);
CREATE OR REPLACE FUNCTION produtos_custos_lookup(p_codigos text[])
RETURNS TABLE (
  produto_codigo text, produto_nome text, preco numeric,
  custo_unitario numeric, margem_pct numeric,
  codigo_ficha text, nome_ficha text, origem_match text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pcv.produto_codigo, pcv.produto_nome, pcv.preco,
         pcv.custo_unitario, pcv.margem_pct,
         pcv.codigo_ficha, pcv.nome_ficha, pcv.origem_match
  FROM produtos_com_custo pcv
  WHERE pcv.produto_codigo = ANY(p_codigos);
$$;

-- ─── 2. RPC produtos_sem_custo(empresa, limit) ───
-- Lista TODOS os produtos ativos que não tem ficha técnica matched.
-- Filtros: empresa, busca por nome, categoria deduzida do nome
DROP FUNCTION IF EXISTS produtos_sem_custo(text, int);
CREATE OR REPLACE FUNCTION produtos_sem_custo(
  empresa_filter text DEFAULT 'todas',
  p_limit int DEFAULT 1000
)
RETURNS TABLE (
  produto_id bigint,
  produto_codigo text,
  produto_nome text,
  preco numeric,
  empresa text,
  estoque_virtual int,
  categoria_provavel text  -- inferida do nome (jaleco/scrub/etc) ou "(outros)"
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    p.id AS produto_id,
    p.codigo AS produto_codigo,
    p.nome AS produto_nome,
    p.preco,
    p.empresa,
    p.estoque_virtual::int,
    COALESCE(
      (SELECT t FROM unnest(_custo_tokenizar(p.nome)) t
       WHERE t IN ('scrub','jaleco','avental','macacao','dolma','touca','gorro','turbante',
                   'camiseta','calca','blusa','tenis','mascara','vestido','crachá','crachá')
       LIMIT 1),
      '(outros)'
    ) AS categoria_provavel
  FROM produtos p
  LEFT JOIN produtos_com_custo pcv ON pcv.produto_codigo = p.codigo
  WHERE p.situacao = 'A' AND p.tipo = 'P'
    AND pcv.produto_codigo IS NULL
    AND (empresa_filter = 'todas' OR p.empresa = empresa_filter)
  ORDER BY p.nome
  LIMIT p_limit;
$$;

-- ─── 3. RPC produtos_custos_cobertura_modelos(empresa) ───
-- Mostra quantos SKUs do Bling cada ficha técnica cobre.
-- Útil pra Manu ver: "TURBANTE puxa peso (138 SKUs)" vs "JALECO XYZ só cobre 4 SKUs"
DROP FUNCTION IF EXISTS produtos_custos_cobertura_modelos(text);
CREATE OR REPLACE FUNCTION produtos_custos_cobertura_modelos(
  empresa_filter text DEFAULT 'todas'
)
RETURNS TABLE (
  codigo_ficha text,
  nome_ficha text,
  tipo text,
  custo_total numeric,
  qtd_skus_bling bigint,
  origem_match text  -- mistura especifico_nome + generico_categoria
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    pc.codigo_ficha,
    pc.nome_ficha,
    pc.tipo,
    pc.custo_total,
    COUNT(pcv.produto_id) AS qtd_skus_bling,
    -- Se TODAS as ligações são genéricas, mostra "generico"; se mistura, "misto"
    CASE
      WHEN COUNT(*) FILTER (WHERE pcv.origem_match = 'especifico_nome') = 0
           AND COUNT(*) FILTER (WHERE pcv.origem_match = 'generico_categoria') > 0
        THEN 'generico_categoria'
      WHEN COUNT(*) FILTER (WHERE pcv.origem_match = 'generico_categoria') = 0
           AND COUNT(*) FILTER (WHERE pcv.origem_match = 'especifico_nome') > 0
        THEN 'especifico_nome'
      WHEN COUNT(*) > 0
        THEN 'misto'
      ELSE 'sem_match'
    END AS origem_match
  FROM produtos_custos pc
  LEFT JOIN produtos_com_custo pcv
    ON pcv.codigo_ficha = pc.codigo_ficha
    AND (empresa_filter = 'todas' OR pcv.empresa = empresa_filter)
  WHERE pc.ativo = true AND pc.custo_total > 0
  GROUP BY pc.codigo_ficha, pc.nome_ficha, pc.tipo, pc.custo_total
  ORDER BY qtd_skus_bling DESC NULLS LAST, pc.nome_ficha;
$$;

-- ─── Diagnóstico imediato ───
SELECT
  (SELECT COUNT(*) FROM produtos_com_custo WHERE origem_match='especifico_nome') AS match_especifico,
  (SELECT COUNT(*) FROM produtos_com_custo WHERE origem_match='generico_categoria') AS match_generico,
  (SELECT COUNT(*) FROM produtos_sem_custo('todas', 9999)) AS sem_custo;
