-- ══════════════════════════════════════════════════════════
-- DMS · Produtos Custos (sync do Tecidos Projeto)
-- (pedido da Manu — 14/05/2026)
--
-- "na parte de descontos, sobe a planilha de custo e pede para ela
--  consultar a planilha de custo e ver quanto vai interferir na nossa
--  margem de lucro a campanha de desconto"
--
-- A planilha de custo já está populada no sistema irmão Tecidos Projeto
-- (jkvoqqqiwtpsruwoioxl.ficha_produtos.custo_total). Vamos sincronizar
-- aqui (wltmiqbhziefusnzmmkt) 1x/dia via edge function pra deixar o
-- DMS independente e rápido.
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS produtos_custos (
  id                    bigserial PRIMARY KEY,
  codigo_ficha          text NOT NULL UNIQUE,    -- ex: '080-SCRUB LOREN' (vem do Tecidos)
  nome_ficha            text NOT NULL,           -- ex: 'SCRUB LOREN'
  tipo                  text,                    -- 'Jaleco', 'Scrub', 'Avental', etc
  custo_total           numeric NOT NULL DEFAULT 0,
  preco_venda_estimado  numeric,                 -- pra calcular margem default
  total_itens           int,                     -- # itens da BOM (informativo)
  sincronizado_em       timestamptz DEFAULT now(),
  ativo                 boolean DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_produtos_custos_nome ON produtos_custos (lower(nome_ficha));
CREATE INDEX IF NOT EXISTS idx_produtos_custos_tipo ON produtos_custos (tipo);

-- RLS: leitura pra todo mundo logado (vendedoras precisam pra ver margem)
-- escrita só via service_role (edge function)
ALTER TABLE produtos_custos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS produtos_custos_select ON produtos_custos;
CREATE POLICY produtos_custos_select ON produtos_custos FOR SELECT USING (true);

-- View helper: faz matching com produtos.nome do Bling (limpa "Tamanho:M" "Cor:Preto" etc)
-- pra cada SKU do DMS, tenta achar o custo da linha correspondente.
CREATE OR REPLACE VIEW produtos_com_custo AS
WITH limpos AS (
  SELECT
    p.id AS produto_id,
    p.codigo AS produto_codigo,
    p.nome AS produto_nome,
    p.preco,
    p.empresa,
    -- "Jaleco Manuela Verde Tamanho:G;Cor:Verde" -> "jaleco manuela verde"
    lower(trim(regexp_replace(p.nome, '\s*(Tamanho|Cor|Manga|Modelo|Decote)\s*:[^;]*;?', '', 'gi'))) AS nome_limpo
  FROM produtos p
  WHERE p.situacao = 'A' AND p.tipo = 'P'
),
matches AS (
  SELECT
    l.produto_id, l.produto_codigo, l.produto_nome, l.preco, l.empresa, l.nome_limpo,
    -- pega o match mais "específico": maior similaridade
    (SELECT pc.codigo_ficha FROM produtos_custos pc
      WHERE l.nome_limpo LIKE '%' || lower(pc.nome_ficha) || '%'
         OR lower(pc.nome_ficha) LIKE '%' || l.nome_limpo || '%'
      ORDER BY length(pc.nome_ficha) DESC
      LIMIT 1) AS codigo_ficha
  FROM limpos l
)
SELECT
  m.produto_id, m.produto_codigo, m.produto_nome, m.preco, m.empresa,
  pc.codigo_ficha, pc.nome_ficha, pc.tipo,
  pc.custo_total AS custo_unitario,
  CASE
    WHEN pc.custo_total IS NULL OR pc.custo_total = 0 THEN NULL
    WHEN m.preco IS NULL OR m.preco = 0 THEN NULL
    ELSE ROUND(((m.preco - pc.custo_total) / m.preco * 100)::numeric, 1)
  END AS margem_pct
FROM matches m
LEFT JOIN produtos_custos pc ON pc.codigo_ficha = m.codigo_ficha;

-- RPC pro frontend: dado um array de codigos de produto, retorna custo + margem
DROP FUNCTION IF EXISTS produtos_custos_lookup(text[]);
CREATE OR REPLACE FUNCTION produtos_custos_lookup(p_codigos text[])
RETURNS TABLE (
  produto_codigo text,
  produto_nome text,
  preco numeric,
  custo_unitario numeric,
  margem_pct numeric,
  codigo_ficha text,
  nome_ficha text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    pcv.produto_codigo, pcv.produto_nome, pcv.preco,
    pcv.custo_unitario, pcv.margem_pct, pcv.codigo_ficha, pcv.nome_ficha
  FROM produtos_com_custo pcv
  WHERE pcv.produto_codigo = ANY(p_codigos);
$$;

-- Diagnóstico
SELECT 'tabela_criada' AS m, COUNT(*) FROM produtos_custos;
