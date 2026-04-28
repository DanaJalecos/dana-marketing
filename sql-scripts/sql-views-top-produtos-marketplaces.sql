-- ══════════════════════════════════════════════════════════
-- VIEWS · Top produtos somente dos MARKETPLACES
--
-- Problema: top_produtos_mes e top_produtos existentes agregam
-- TODAS as vendas (site, loja fisica, ML, Shopee, TikTok, Magalu).
-- Quando exibido na seção Marketplaces, confunde o usuário porque
-- parece ser só marketplace.
--
-- Solução: criar views filtradas usando o mesmo mapeamento de
-- loja_id do frontend:
--   0 ou NULL     → Site (excluir)
--   203536978     → Loja/WhatsApp (excluir)
--   205337834     → Mercado Livre (incluir)
--   205430008     → TikTok (incluir)
--   205522474     → Shopee (incluir)
--   outros        → Magalu / outros marketplaces (incluir)
--
-- Filtro: loja_id IS NOT NULL AND loja_id != 0 AND loja_id != 203536978
-- ══════════════════════════════════════════════════════════

-- View: top produtos marketplaces (all time)
CREATE OR REPLACE VIEW top_produtos_marketplaces AS
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
  AND p.loja_id IS NOT NULL
  AND p.loja_id != 0
  AND p.loja_id != 203536978
GROUP BY pi.descricao, pi.codigo
ORDER BY total_quantidade DESC;

-- View: top produtos marketplaces por mês
CREATE OR REPLACE VIEW top_produtos_marketplaces_mes AS
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
  AND p.loja_id IS NOT NULL
  AND p.loja_id != 0
  AND p.loja_id != 203536978
GROUP BY ano, mes, pi.descricao, pi.codigo
ORDER BY ano DESC, mes DESC, total_quantidade DESC;

-- ── TESTE ──
-- Mostra top 10 produtos dos marketplaces
SELECT descricao, total_quantidade, total_receita
FROM top_produtos_marketplaces
LIMIT 10;
