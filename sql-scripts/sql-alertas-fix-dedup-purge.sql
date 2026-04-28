-- ══════════════════════════════════════════════════════════
-- FIX ALERTAS · dedupe longo + purge de antigos
--
-- Problema: a funcao gerar_alertas() recriava alertas dos mesmos
-- produtos a cada 24h. Combinado com .limit(50) no frontend, os
-- alertas que o user marcava como lidos sumiam da lista e novos
-- (do mesmo produto) ficavam acumulando.
--
-- Fix:
-- 1. Dedupe 24h → 7 dias
-- 2. Purge de alertas LIDOS com mais de 30 dias
-- 3. Limpeza imediata de duplicatas historicas
-- ══════════════════════════════════════════════════════════

-- ── PASSO 1 · ATUALIZAR gerar_alertas() COM DEDUPE DE 7 DIAS ──
CREATE OR REPLACE FUNCTION gerar_alertas()
RETURNS void AS $$
DECLARE
  qtd_inativos int;
  qtd_atrasados int;
  valor_atrasados numeric;
BEGIN
  -- Vendas em queda (ultimos 7 dias vs 7 dias anteriores)
  -- DEDUPE: 7 dias (antes era 24h)
  WITH recent AS (
    SELECT COUNT(*) AS n FROM pedidos
    WHERE data >= CURRENT_DATE - INTERVAL '7 days' AND situacao_id != 12
  ),
  previous AS (
    SELECT COUNT(*) AS n FROM pedidos
    WHERE data >= CURRENT_DATE - INTERVAL '14 days' AND data < CURRENT_DATE - INTERVAL '7 days' AND situacao_id != 12
  )
  INSERT INTO alertas (tipo, nivel, titulo, mensagem, dados)
  SELECT 'vendas_queda', 'warn',
    'Vendas em queda — últimos 7 dias',
    'Pedidos: ' || r.n || ' vs ' || p.n || ' semana anterior',
    jsonb_build_object('atual', r.n, 'anterior', p.n)
  FROM recent r, previous p
  WHERE r.n < p.n * 0.85
  AND NOT EXISTS (
    SELECT 1 FROM alertas WHERE tipo = 'vendas_queda' AND created_at > NOW() - INTERVAL '7 days'
  );

  -- Clientes inativos (sem compra por 90+ dias)
  SELECT COUNT(DISTINCT contato_nome) INTO qtd_inativos FROM cliente_scoring
  WHERE segmento = 'Em Risco' OR segmento = 'Inativo';

  IF qtd_inativos > 0 THEN
    INSERT INTO alertas (tipo, nivel, titulo, mensagem, dados)
    SELECT 'cliente_inativo', 'info',
      qtd_inativos || ' clientes em risco ou inativos',
      'Considere uma campanha de reativação',
      jsonb_build_object('qtd', qtd_inativos)
    WHERE NOT EXISTS (SELECT 1 FROM alertas WHERE tipo = 'cliente_inativo' AND created_at > NOW() - INTERVAL '7 days');
  END IF;

  -- Pagamentos atrasados
  SELECT COUNT(*), COALESCE(SUM(valor), 0) INTO qtd_atrasados, valor_atrasados
  FROM contas_receber WHERE situacao = 3;

  IF qtd_atrasados > 0 THEN
    INSERT INTO alertas (tipo, nivel, titulo, mensagem, dados)
    SELECT 'pagamento_atrasado', 'urgent',
      qtd_atrasados || ' contas a receber atrasadas',
      'Total atrasado: R$ ' || ROUND(valor_atrasados)::text,
      jsonb_build_object('qtd', qtd_atrasados, 'valor', valor_atrasados)
    WHERE NOT EXISTS (SELECT 1 FROM alertas WHERE tipo = 'pagamento_atrasado' AND titulo LIKE '%receber%' AND created_at > NOW() - INTERVAL '7 days');
  END IF;

  -- Estoque baixo (<5 unidades) — DEDUPE 7 DIAS
  INSERT INTO alertas (tipo, nivel, titulo, mensagem, dados)
  SELECT 'estoque_baixo', 'warn',
    nome || ' com estoque baixo (' || estoque_virtual::int || ' un.)',
    'Produto: ' || codigo || ' — considere reabastecer',
    jsonb_build_object('produto_id', id, 'estoque', estoque_virtual)
  FROM produtos
  WHERE situacao = 'A' AND tipo = 'P' AND estoque_virtual > 0 AND estoque_virtual < 5
  AND NOT EXISTS (
    SELECT 1 FROM alertas WHERE tipo = 'estoque_baixo' AND (dados->>'produto_id')::bigint = produtos.id AND created_at > NOW() - INTERVAL '7 days'
  )
  LIMIT 5;

  -- Meta ticket medio atingida
  PERFORM 1 FROM pedidos
  WHERE data >= DATE_TRUNC('month', CURRENT_DATE) AND situacao_id != 12
  HAVING AVG(total) >= 500;
  IF FOUND THEN
    INSERT INTO alertas (tipo, nivel, titulo, mensagem)
    SELECT 'meta_atingida', 'ok',
      'Ticket médio acima de R$500 este mês!',
      'Média: R$' || ROUND((SELECT AVG(total) FROM pedidos WHERE data >= DATE_TRUNC('month', CURRENT_DATE) AND situacao_id != 12))::text
    WHERE NOT EXISTS (SELECT 1 FROM alertas WHERE tipo = 'meta_atingida' AND created_at > NOW() - INTERVAL '7 days');
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ── PASSO 2 · DELETAR DUPLICATAS HISTÓRICAS DE ESTOQUE ──
-- Mantém só o alerta MAIS RECENTE por produto_id, remove os antigos
-- que foram recriados a cada 24h no passado.
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY tipo, (dados->>'produto_id')
      ORDER BY created_at DESC
    ) AS rn
  FROM alertas
  WHERE tipo = 'estoque_baixo'
    AND dados->>'produto_id' IS NOT NULL
)
DELETE FROM alertas
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ── PASSO 3 · PURGE DE ALERTAS LIDOS ANTIGOS (>30 dias) ──
DELETE FROM alertas
WHERE lido = true
  AND created_at < NOW() - INTERVAL '30 days';

-- ── PASSO 4 · VER RESULTADO ──
SELECT
  COUNT(*) FILTER (WHERE lido = false) AS nao_lidas,
  COUNT(*) FILTER (WHERE lido = true)  AS lidas,
  COUNT(*)                             AS total,
  MIN(created_at)                      AS alerta_mais_antigo,
  MAX(created_at)                      AS alerta_mais_recente
FROM alertas;

-- ── OPCIONAL · marcar TUDO como lido agora (limpeza inicial) ──
-- Descomente se quiser zerar tudo e começar do zero:
/*
UPDATE alertas SET lido = true WHERE lido = false;
*/
