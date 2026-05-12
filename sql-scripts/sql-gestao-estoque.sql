-- ══════════════════════════════════════════════════════════
-- GESTÃO INTELIGENTE DE ESTOQUE · Ciclo 86 (12/05/2026)
--
-- Move alertas de estoque baixo do sininho para uma seção
-- dedicada em VENDAS. Adiciona:
--   1. Campos de resolução em `alertas` (resolvido_em/_por,
--      acao_tomada, ignorado_ate)
--   2. Audiência nova `estoque_silencioso` (não aparece no sino)
--   3. View `produtos_velocidade_30d` (giro 30d + qtd sugerida)
--   4. RPC `listar_estoque_baixo(empresa_filter)` que retorna
--      alertas ativos + dados de velocidade
--   5. RPC `resolver_alerta_estoque(id, acao, ignorar_dias)`
--   6. Atualiza `gerar_alertas()` pra:
--      - inserir estoque com audiência `estoque_silencioso`
--      - dedup considera só alertas NÃO resolvidos
--   7. UPDATE histórico marcando alertas de estoque existentes
--      como `estoque_silencioso` (some do sino imediatamente)
--
-- Rodar no Supabase SQL Editor. Idempotente.
-- ══════════════════════════════════════════════════════════

-- ── PASSO 1 · ESTENDE TABELA alertas ──
ALTER TABLE alertas
  ADD COLUMN IF NOT EXISTS resolvido_em timestamptz,
  ADD COLUMN IF NOT EXISTS resolvido_por uuid,
  ADD COLUMN IF NOT EXISTS acao_tomada text,
  ADD COLUMN IF NOT EXISTS ignorado_ate date;

-- CHECK pra acao_tomada (drop+recreate idempotente)
ALTER TABLE alertas DROP CONSTRAINT IF EXISTS alertas_acao_tomada_check;
ALTER TABLE alertas ADD CONSTRAINT alertas_acao_tomada_check
  CHECK (acao_tomada IS NULL OR acao_tomada IN ('reabastecido','ignorado','tarefa_criada'));

-- Substitui CHECK da audiência pra incluir 'estoque_silencioso'
ALTER TABLE alertas DROP CONSTRAINT IF EXISTS alertas_audiencia_check;
ALTER TABLE alertas ADD CONSTRAINT alertas_audiencia_check
  CHECK (audiencia IN ('dados_empresa','workflow','pessoal','estoque_silencioso'));

-- Índice partial pra acelerar listagem dos ativos
CREATE INDEX IF NOT EXISTS idx_alertas_estoque_ativo
  ON alertas (tipo, resolvido_em)
  WHERE tipo = 'estoque_baixo' AND resolvido_em IS NULL;

-- ── PASSO 2 · ATUALIZA gerar_alertas() ──
-- Mudanças vs versão anterior:
--   - estoque_baixo agora vai com audiencia='estoque_silencioso'
--   - dedup do estoque considera SÓ alertas não resolvidos
--     (permite recriar alerta depois que admin marcou reabastecido)
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

  -- ★ Estoque baixo — vai pra seção dedicada (audiencia=estoque_silencioso)
  -- Dedup considera SÓ alertas não resolvidos: depois de marcar reabastecido,
  -- o sistema pode emitir novo alerta se o estoque continuar/voltar a estar baixo.
  INSERT INTO alertas (tipo, nivel, titulo, mensagem, dados, audiencia)
  SELECT 'estoque_baixo',
    CASE WHEN estoque_virtual < 3 THEN 'urgent' ELSE 'warn' END,
    nome || ' com estoque baixo (' || estoque_virtual::int || ' un.)',
    'Produto: ' || codigo || ' — considere reabastecer',
    jsonb_build_object('produto_id', id, 'estoque', estoque_virtual, 'empresa', empresa),
    'estoque_silencioso'
  FROM produtos
  WHERE situacao = 'A' AND tipo = 'P' AND estoque_virtual > 0 AND estoque_virtual < 5
  AND NOT EXISTS (
    SELECT 1 FROM alertas
    WHERE tipo = 'estoque_baixo'
      AND (dados->>'produto_id')::bigint = produtos.id
      AND resolvido_em IS NULL
      AND created_at > NOW() - INTERVAL '7 days'
  )
  LIMIT 20;  -- (era 5; com seção dedicada podemos emitir mais por ciclo)

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

-- ── PASSO 3 · LIMPA SINO IMEDIATAMENTE ──
-- Alertas históricos de estoque_baixo que estão em dados_empresa
-- (vinham aparecendo no sino) → migra pra estoque_silencioso.
UPDATE alertas
   SET audiencia = 'estoque_silencioso'
 WHERE tipo = 'estoque_baixo'
   AND audiencia = 'dados_empresa';

-- ── PASSO 4 · VIEW produtos_velocidade_30d ──
-- Calcula: vendas totais 30d, vendas/dia, dias de estoque restantes,
-- quantidade sugerida (cobrir 30 dias + 7 de margem).
-- Match por código exato (sufixo de variação OK — pedidos_itens.codigo
-- inclui variação tipo "-G00"; produtos.codigo pode ser pai ou variação).
CREATE OR REPLACE VIEW produtos_velocidade_30d AS
SELECT
  p.id AS produto_id,
  p.empresa,
  p.codigo,
  p.nome,
  p.estoque_virtual,
  p.preco,
  COALESCE(v.qtd_vendida_30d, 0) AS qtd_vendida_30d,
  ROUND(COALESCE(v.qtd_vendida_30d, 0) / 30.0, 2) AS vendas_dia,
  CASE
    WHEN COALESCE(v.qtd_vendida_30d, 0) = 0 THEN NULL
    ELSE CEIL(p.estoque_virtual::numeric / (v.qtd_vendida_30d::numeric / 30.0))::int
  END AS dias_de_estoque,
  CASE
    WHEN COALESCE(v.qtd_vendida_30d, 0) = 0 THEN 5
    ELSE GREATEST(
      CEIL((v.qtd_vendida_30d::numeric / 30.0) * 37)::int - p.estoque_virtual,
      0
    )
  END AS qtd_sugerida
FROM produtos p
LEFT JOIN LATERAL (
  SELECT SUM(pi.quantidade)::numeric AS qtd_vendida_30d
  FROM pedidos_itens pi
  JOIN pedidos pe ON pe.id = pi.pedido_id
  WHERE pi.codigo = p.codigo
    AND pe.empresa = p.empresa
    AND pe.data >= NOW() - INTERVAL '30 days'
    AND pe.situacao_id != 12
) v ON true
WHERE p.situacao = 'A' AND p.tipo = 'P';

-- ── PASSO 5 · RPC listar_estoque_baixo ──
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
  qtd_vendida_30d numeric,
  vendas_dia numeric,
  dias_de_estoque int,
  qtd_sugerida int
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
    v.qtd_vendida_30d,
    v.vendas_dia,
    v.dias_de_estoque,
    v.qtd_sugerida
  FROM alertas a
  JOIN produtos p ON p.id = (a.dados->>'produto_id')::bigint
  LEFT JOIN produtos_velocidade_30d v ON v.produto_id = p.id
  WHERE a.tipo = 'estoque_baixo'
    AND a.resolvido_em IS NULL
    AND (a.ignorado_ate IS NULL OR a.ignorado_ate < CURRENT_DATE)
    AND (empresa_filter = 'todas' OR p.empresa = empresa_filter)
  ORDER BY p.estoque_virtual ASC, a.created_at DESC;
$$;

-- ── PASSO 6 · RPC listar_estoque_resolvidos ──
-- Pra sub-aba de histórico (últimos 30 dias)
CREATE OR REPLACE FUNCTION listar_estoque_resolvidos(empresa_filter text DEFAULT 'todas')
RETURNS TABLE (
  alerta_id bigint,
  produto_id bigint,
  codigo text,
  nome text,
  empresa text,
  acao_tomada text,
  resolvido_em timestamptz,
  resolvido_por uuid
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    a.id, p.id, p.codigo, p.nome, p.empresa,
    a.acao_tomada, a.resolvido_em, a.resolvido_por
  FROM alertas a
  JOIN produtos p ON p.id = (a.dados->>'produto_id')::bigint
  WHERE a.tipo = 'estoque_baixo'
    AND a.resolvido_em IS NOT NULL
    AND a.resolvido_em > NOW() - INTERVAL '30 days'
    AND (empresa_filter = 'todas' OR p.empresa = empresa_filter)
  ORDER BY a.resolvido_em DESC
  LIMIT 200;
$$;

-- ── PASSO 7 · RPC listar_estoque_ignorados ──
CREATE OR REPLACE FUNCTION listar_estoque_ignorados(empresa_filter text DEFAULT 'todas')
RETURNS TABLE (
  alerta_id bigint,
  produto_id bigint,
  codigo text,
  nome text,
  estoque_virtual int,
  empresa text,
  ignorado_ate date,
  created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    a.id, p.id, p.codigo, p.nome, p.estoque_virtual, p.empresa,
    a.ignorado_ate, a.created_at
  FROM alertas a
  JOIN produtos p ON p.id = (a.dados->>'produto_id')::bigint
  WHERE a.tipo = 'estoque_baixo'
    AND a.resolvido_em IS NULL
    AND a.ignorado_ate IS NOT NULL
    AND a.ignorado_ate >= CURRENT_DATE
    AND (empresa_filter = 'todas' OR p.empresa = empresa_filter)
  ORDER BY a.ignorado_ate ASC;
$$;

-- ── PASSO 8 · RPC resolver_alerta_estoque ──
CREATE OR REPLACE FUNCTION resolver_alerta_estoque(
  p_alerta_id bigint,
  p_acao text,
  p_ignorar_dias int DEFAULT 30
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF p_acao NOT IN ('reabastecido','ignorado','tarefa_criada') THEN
    RAISE EXCEPTION 'Ação inválida: %', p_acao;
  END IF;

  IF p_acao = 'ignorado' THEN
    UPDATE alertas
       SET ignorado_ate = CURRENT_DATE + p_ignorar_dias,
           acao_tomada  = 'ignorado'
     WHERE id = p_alerta_id
       AND tipo = 'estoque_baixo';
  ELSE
    UPDATE alertas
       SET resolvido_em  = NOW(),
           resolvido_por = v_user,
           acao_tomada   = p_acao,
           lido          = true
     WHERE id = p_alerta_id
       AND tipo = 'estoque_baixo';
  END IF;

  RETURN json_build_object('ok', true, 'alerta_id', p_alerta_id, 'acao', p_acao);
END;
$$;

-- ── PASSO 9 · KPIs (RPC consolidado) ──
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
    'detectados_hoje', (
      SELECT COUNT(*) FROM alertas a
      JOIN produtos p ON p.id = (a.dados->>'produto_id')::bigint
      WHERE a.tipo = 'estoque_baixo' AND a.resolvido_em IS NULL
        AND a.created_at >= CURRENT_DATE
        AND (empresa_filter = 'todas' OR p.empresa = empresa_filter)
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

-- ── PASSO 10 · DIAGNÓSTICO FINAL ──
SELECT
  audiencia,
  COUNT(*) FILTER (WHERE resolvido_em IS NULL) AS ativos,
  COUNT(*) FILTER (WHERE resolvido_em IS NOT NULL) AS resolvidos
FROM alertas
WHERE tipo = 'estoque_baixo'
GROUP BY audiencia;
