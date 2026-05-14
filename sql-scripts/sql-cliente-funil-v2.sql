-- ══════════════════════════════════════════════════════════
-- C360 · Funil v2 — ajustes pedidos pela Manu (14/05/2026)
--
-- Pedidos:
-- 1. "agora não temos novo contato mais, pois excluimos a opção de criar novo
--    renomeie para Não contatado, ali no funil que fala 🆕 Novos, Coloca Não contatado
--    ai coloca a quantidade de quantos não foram contatados naquele mês
--    e esse numero de Não contatado, leve em conta se está a mais de 90 dias
--    sem entrar em contato (para não ENCHER de cliente)"
--
-- 2. "em 📈 Contatado → Negociando, devia ter 2, pois 2 clientes tiveram o
--    status mudado para Em negociação"
--    -> O backfill criou os registros com status_anterior=NULL, então a query
--    antiga que exigia "anterior=contatado AND novo=negociando" achava 0.
--    Mudei pra contar QUALQUER entrada em "negociando" no período
--    (ignora de onde veio — só interessa que avançou).
--
-- "Não contatado" = clientes ATIVOS (com pedido nos últimos 12 meses) +
--   - NÃO tem cliente_metadata, OU
--   - tem metadata com status='novo', OU
--   - foi atualizado há 90+ dias (sumiu do radar)
-- ══════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS cliente_funil_stats(text, int);
CREATE OR REPLACE FUNCTION cliente_funil_stats(
  empresa_filter text DEFAULT 'todas',
  periodo_dias int DEFAULT 30
)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH
  -- 1. Clientes ATIVOS (têm pedidos nos últimos 12 meses)
  ativos AS (
    SELECT DISTINCT
      c.id AS contato_id,
      c.empresa
    FROM contatos c
    WHERE (empresa_filter = 'todas' OR c.empresa = empresa_filter)
      AND EXISTS (
        SELECT 1 FROM pedidos pe
        WHERE pe.contato_nome = c.nome
          AND pe.empresa = c.empresa
          AND pe.data >= NOW() - INTERVAL '12 months'
          AND pe.situacao_id != 12
      )
  ),
  -- 2. Snapshot atual por status (vem da tabela metadata)
  atual AS (
    SELECT status_relacionamento, COUNT(*) AS qt
    FROM cliente_metadata
    WHERE (empresa_filter = 'todas' OR empresa = empresa_filter)
      AND status_relacionamento IS NOT NULL
    GROUP BY status_relacionamento
  ),
  -- 3. NÃO CONTATADO = ativos sem metadata recente
  nao_contatado AS (
    SELECT COUNT(*) AS qt FROM ativos a
    WHERE NOT EXISTS (
      SELECT 1 FROM cliente_metadata cm
      WHERE cm.contato_id = a.contato_id
        AND cm.empresa = a.empresa
        AND cm.status_relacionamento NOT IN ('novo')
        AND cm.atualizado_em >= NOW() - INTERVAL '90 days'
    )
  ),
  -- 4. Fluxo no período (entradas por status — ignora de onde veio)
  fluxo AS (
    SELECT status_novo, COUNT(DISTINCT (contato_id, empresa)) AS qt
    FROM cliente_status_historico
    WHERE (empresa_filter = 'todas' OR empresa = empresa_filter)
      AND mudado_em >= NOW() - (periodo_dias || ' days')::interval
    GROUP BY status_novo
  ),
  -- 5. Conversão pra "negociando" = QUALQUER entrada em negociando no período
  -- (Manu: "2 clientes tiveram status mudado para Em negociação" — não importa
  --  se vieram de contatado ou direto de novo; o que importa é que avançaram)
  conv_neg AS (
    SELECT COUNT(DISTINCT (contato_id, empresa)) AS qt
    FROM cliente_status_historico
    WHERE status_novo = 'negociando'
      AND mudado_em >= NOW() - (periodo_dias || ' days')::interval
      AND (empresa_filter = 'todas' OR empresa = empresa_filter)
  ),
  -- 6. Conversão pra "convertido" no período (entrou no estágio final)
  conv_won AS (
    SELECT COUNT(DISTINCT (contato_id, empresa)) AS qt
    FROM cliente_status_historico
    WHERE status_novo = 'convertido'
      AND mudado_em >= NOW() - (periodo_dias || ' days')::interval
      AND (empresa_filter = 'todas' OR empresa = empresa_filter)
  ),
  -- 7. Perdidos/sem interesse no período
  conv_lost AS (
    SELECT COUNT(DISTINCT (contato_id, empresa)) AS qt
    FROM cliente_status_historico
    WHERE status_novo IN ('perdido','sem_interesse')
      AND mudado_em >= NOW() - (periodo_dias || ' days')::interval
      AND (empresa_filter = 'todas' OR empresa = empresa_filter)
  )
  SELECT json_build_object(
    'periodo_dias', periodo_dias,
    'empresa', empresa_filter,
    'atual', json_build_object(
      -- nao_contatado substitui o 'novo'; mantém 'novo' por compat reverso
      'nao_contatado', (SELECT qt FROM nao_contatado),
      'novo',          COALESCE((SELECT qt FROM atual WHERE status_relacionamento='novo'),0),
      'contatado',     COALESCE((SELECT qt FROM atual WHERE status_relacionamento='contatado'),0),
      'negociando',    COALESCE((SELECT qt FROM atual WHERE status_relacionamento='negociando'),0),
      'convertido',    COALESCE((SELECT qt FROM atual WHERE status_relacionamento IN ('convertido','comprou')),0),
      'perdido',       COALESCE((SELECT qt FROM atual WHERE status_relacionamento='perdido'),0),
      'sem_interesse', COALESCE((SELECT qt FROM atual WHERE status_relacionamento='sem_interesse'),0)
    ),
    'fluxo_periodo', json_build_object(
      'contatado',     COALESCE((SELECT qt FROM fluxo WHERE status_novo='contatado'),0),
      'negociando',    COALESCE((SELECT qt FROM fluxo WHERE status_novo='negociando'),0),
      'convertido',    COALESCE((SELECT qt FROM fluxo WHERE status_novo='convertido'),0),
      'perdido',       COALESCE((SELECT qt FROM fluxo WHERE status_novo='perdido'),0),
      'sem_interesse', COALESCE((SELECT qt FROM fluxo WHERE status_novo='sem_interesse'),0)
    ),
    'conversao_periodo', json_build_object(
      'contatado_para_negociando',  (SELECT qt FROM conv_neg),
      'negociando_para_convertido', (SELECT qt FROM conv_won),
      'total_perdidos',             (SELECT qt FROM conv_lost)
    )
  );
$$;

-- Smoke test
SELECT cliente_funil_stats('todas', 30) AS funil_30d;
SELECT cliente_funil_stats('matriz', 30) AS funil_matriz;
