-- ══════════════════════════════════════════════════════════
-- CAMADA 1 · ALERTAS POR AUDIÊNCIA (baseado em cargo)
--
-- Adiciona coluna `audiencia` na tabela alertas e atualiza a
-- função gerar_alertas() pra classificar corretamente.
--
-- Audiências:
--   'dados_empresa' → só admin + gerente_marketing/comercial/financeiro
--   'workflow'      → todos com acesso à seção (criativos, tarefas)
--   'pessoal'       → só o destinatario_id específico
--
-- Rodar no Supabase SQL Editor.
-- ══════════════════════════════════════════════════════════

-- ── PASSO 1 · ADICIONAR COLUNA ──
ALTER TABLE alertas
  ADD COLUMN IF NOT EXISTS audiencia TEXT DEFAULT 'pessoal'
  CHECK (audiencia IN ('dados_empresa','workflow','pessoal'));

-- ── PASSO 2 · CLASSIFICAR ALERTAS EXISTENTES ──
-- Dados da empresa (só admins/gerentes veem)
UPDATE alertas SET audiencia = 'dados_empresa'
 WHERE tipo IN ('estoque_baixo','vendas_queda','pagamento_atrasado',
                'cliente_inativo','meta_atingida','canal_anomalia');

-- Workflow (criativos, tarefas) — reconhece por dados.criativo_id ou tarefa_id
UPDATE alertas SET audiencia = 'workflow'
 WHERE audiencia = 'pessoal'
   AND (dados ? 'criativo_id' OR dados ? 'tarefa_id' OR
        tipo LIKE 'criativo_%' OR tipo LIKE 'tarefa_%' OR tipo LIKE 'prazo_%');

-- Os restantes ficam 'pessoal' (alertas direcionados com destinatario_id)

-- ── PASSO 3 · ATUALIZAR gerar_alertas() PRA SETAR AUDIENCIA ──
CREATE OR REPLACE FUNCTION gerar_alertas()
RETURNS void AS $$
DECLARE
  qtd_inativos int;
  qtd_atrasados int;
  valor_atrasados numeric;
BEGIN
  -- Vendas em queda
  WITH recent AS (
    SELECT COUNT(*) AS n FROM pedidos
    WHERE data >= CURRENT_DATE - INTERVAL '7 days' AND situacao_id != 12
  ),
  previous AS (
    SELECT COUNT(*) AS n FROM pedidos
    WHERE data >= CURRENT_DATE - INTERVAL '14 days' AND data < CURRENT_DATE - INTERVAL '7 days' AND situacao_id != 12
  )
  INSERT INTO alertas (tipo, nivel, titulo, mensagem, dados, audiencia)
  SELECT 'vendas_queda', 'warn',
    'Vendas em queda — últimos 7 dias',
    'Pedidos: ' || r.n || ' vs ' || p.n || ' semana anterior',
    jsonb_build_object('atual', r.n, 'anterior', p.n),
    'dados_empresa'
  FROM recent r, previous p
  WHERE r.n < p.n * 0.85
  AND NOT EXISTS (
    SELECT 1 FROM alertas WHERE tipo = 'vendas_queda' AND created_at > NOW() - INTERVAL '7 days'
  );

  -- Clientes inativos
  SELECT COUNT(DISTINCT contato_nome) INTO qtd_inativos FROM cliente_scoring
  WHERE segmento IN ('Em Risco','Inativo');

  IF qtd_inativos > 0 THEN
    INSERT INTO alertas (tipo, nivel, titulo, mensagem, dados, audiencia)
    SELECT 'cliente_inativo', 'info',
      qtd_inativos || ' clientes em risco ou inativos',
      'Considere uma campanha de reativação',
      jsonb_build_object('qtd', qtd_inativos),
      'dados_empresa'
    WHERE NOT EXISTS (SELECT 1 FROM alertas WHERE tipo = 'cliente_inativo' AND created_at > NOW() - INTERVAL '7 days');
  END IF;

  -- Pagamentos atrasados
  SELECT COUNT(*), COALESCE(SUM(valor), 0) INTO qtd_atrasados, valor_atrasados
  FROM contas_receber WHERE situacao = 3;

  IF qtd_atrasados > 0 THEN
    INSERT INTO alertas (tipo, nivel, titulo, mensagem, dados, audiencia)
    SELECT 'pagamento_atrasado', 'urgent',
      qtd_atrasados || ' contas a receber atrasadas',
      'Total atrasado: R$ ' || ROUND(valor_atrasados)::text,
      jsonb_build_object('qtd', qtd_atrasados, 'valor', valor_atrasados),
      'dados_empresa'
    WHERE NOT EXISTS (SELECT 1 FROM alertas WHERE tipo = 'pagamento_atrasado' AND titulo LIKE '%receber%' AND created_at > NOW() - INTERVAL '7 days');
  END IF;

  -- Estoque baixo
  INSERT INTO alertas (tipo, nivel, titulo, mensagem, dados, audiencia)
  SELECT 'estoque_baixo', 'warn',
    nome || ' com estoque baixo (' || estoque_virtual::int || ' un.)',
    'Produto: ' || codigo || ' — considere reabastecer',
    jsonb_build_object('produto_id', id, 'estoque', estoque_virtual),
    'dados_empresa'
  FROM produtos
  WHERE situacao = 'A' AND tipo = 'P' AND estoque_virtual > 0 AND estoque_virtual < 5
  AND NOT EXISTS (
    SELECT 1 FROM alertas WHERE tipo = 'estoque_baixo' AND (dados->>'produto_id')::bigint = produtos.id AND created_at > NOW() - INTERVAL '7 days'
  )
  LIMIT 5;

  -- Meta ticket atingida
  PERFORM 1 FROM pedidos
  WHERE data >= DATE_TRUNC('month', CURRENT_DATE) AND situacao_id != 12
  HAVING AVG(total) >= 500;
  IF FOUND THEN
    INSERT INTO alertas (tipo, nivel, titulo, mensagem, audiencia)
    SELECT 'meta_atingida', 'ok',
      'Ticket médio acima de R$500 este mês!',
      'Média: R$' || ROUND((SELECT AVG(total) FROM pedidos WHERE data >= DATE_TRUNC('month', CURRENT_DATE) AND situacao_id != 12))::text,
      'dados_empresa'
    WHERE NOT EXISTS (SELECT 1 FROM alertas WHERE tipo = 'meta_atingida' AND created_at > NOW() - INTERVAL '7 days');
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ── PASSO 4 · VER RESULTADO ──
SELECT audiencia, COUNT(*) AS total,
  COUNT(*) FILTER (WHERE lido = false) AS nao_lidas
FROM alertas
GROUP BY audiencia
ORDER BY audiencia;
