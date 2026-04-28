-- ══════════════════════════════════════════════════════════
-- Tabela: pedidos_itens + View: top_produtos
-- Rodar no Supabase SQL Editor
-- ══════════════════════════════════════════════════════════

-- 1. Tabela para itens de pedidos (linha a linha)
CREATE TABLE IF NOT EXISTS pedidos_itens (
  id bigint PRIMARY KEY DEFAULT gen_random_uuid()::text::bigint,
  pedido_id bigint REFERENCES pedidos(id) ON DELETE CASCADE,
  produto_id bigint,
  codigo text,          -- SKU do produto
  descricao text,       -- Nome do produto
  quantidade numeric(12,2) DEFAULT 0,
  valor_unitario numeric(12,2) DEFAULT 0,
  valor_total numeric(12,2) DEFAULT 0,
  unidade text DEFAULT 'UN',
  created_at timestamptz DEFAULT now(),
  UNIQUE(pedido_id, produto_id)
);

-- Index para buscas rápidas
CREATE INDEX IF NOT EXISTS idx_pedidos_itens_pedido ON pedidos_itens(pedido_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_itens_produto ON pedidos_itens(produto_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_itens_descricao ON pedidos_itens(descricao);

-- 2. View: Top produtos vendidos (agrupado por descrição)
CREATE OR REPLACE VIEW top_produtos AS
SELECT
  pi.descricao,
  pi.codigo,
  COUNT(DISTINCT pi.pedido_id) AS total_pedidos,
  SUM(pi.quantidade) AS total_quantidade,
  SUM(pi.valor_total) AS total_receita,
  ROUND(AVG(pi.valor_unitario), 2) AS preco_medio,
  MAX(p.data) AS ultima_venda
FROM pedidos_itens pi
JOIN pedidos p ON p.id = pi.pedido_id
WHERE pi.descricao IS NOT NULL AND pi.descricao != ''
GROUP BY pi.descricao, pi.codigo
ORDER BY total_quantidade DESC;

-- 3. View: Top produtos por mês
CREATE OR REPLACE VIEW top_produtos_mes AS
SELECT
  EXTRACT(YEAR FROM p.data)::int AS ano,
  EXTRACT(MONTH FROM p.data)::int AS mes,
  pi.descricao,
  pi.codigo,
  COUNT(DISTINCT pi.pedido_id) AS total_pedidos,
  SUM(pi.quantidade) AS total_quantidade,
  SUM(pi.valor_total) AS total_receita,
  ROUND(AVG(pi.valor_unitario), 2) AS preco_medio
FROM pedidos_itens pi
JOIN pedidos p ON p.id = pi.pedido_id
WHERE pi.descricao IS NOT NULL AND pi.descricao != ''
GROUP BY ano, mes, pi.descricao, pi.codigo
ORDER BY ano DESC, mes DESC, total_quantidade DESC;

-- 4. RLS (permitir leitura)
ALTER TABLE pedidos_itens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pedidos_itens_read" ON pedidos_itens;
CREATE POLICY "pedidos_itens_read" ON pedidos_itens FOR SELECT USING (true);
DROP POLICY IF EXISTS "pedidos_itens_write" ON pedidos_itens;
CREATE POLICY "pedidos_itens_write" ON pedidos_itens FOR ALL USING (true);

-- 5. Habilitar Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE pedidos_itens;
