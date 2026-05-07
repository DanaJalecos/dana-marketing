-- ═══════════════════════════════════════════════════════════════════════════
-- MOTIVOS DE PERDA — Feature #1 do roadmap pós-Analytics IA (Section 62.1 da doc)
-- ═══════════════════════════════════════════════════════════════════════════
-- Captura por que um lead/cliente foi descartado/perdido.
-- Tabela base de relatório futuro "Top motivos de perda do mês" no Performance.
--
-- Aplicado em:
--   - prospects (Prospecção): quando vai pra status='descartado'
--   - cliente_metadata (Cliente 360 detalhe): quando status_relacionamento muda pra 'perdido' ou 'sem_interesse'
--   - clientes_manuais (Cliente 360 manual): mesma lógica de cliente_metadata
--
-- Opções pré-definidas (escolha 1) + texto livre opcional (obrigatório se motivo='outro'):
--   sem_orcamento        — Sem orçamento
--   comprou_concorrente  — Comprou de concorrente
--   nao_responde         — Não responde
--   nao_era_icp          — Não era ICP (perfil errado)
--   preco_alto           — Preço alto
--   prazo_longo          — Prazo de entrega muito longo
--   sem_interesse        — Sem interesse no momento
--   outro                — Outro (detalhe obrigatório)
--
-- Idempotente: ALTER TABLE ... IF NOT EXISTS — pode rodar múltiplas vezes.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) prospects
ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS motivo_perda TEXT,
  ADD COLUMN IF NOT EXISTS motivo_perda_detalhe TEXT,
  ADD COLUMN IF NOT EXISTS motivo_perda_em TIMESTAMPTZ;

-- 2) cliente_metadata (Cliente 360 vindo do Bling)
ALTER TABLE cliente_metadata
  ADD COLUMN IF NOT EXISTS motivo_perda TEXT,
  ADD COLUMN IF NOT EXISTS motivo_perda_detalhe TEXT,
  ADD COLUMN IF NOT EXISTS motivo_perda_em TIMESTAMPTZ;

-- 3) clientes_manuais
ALTER TABLE clientes_manuais
  ADD COLUMN IF NOT EXISTS motivo_perda TEXT,
  ADD COLUMN IF NOT EXISTS motivo_perda_detalhe TEXT,
  ADD COLUMN IF NOT EXISTS motivo_perda_em TIMESTAMPTZ;

-- 4) Índices pra agregação rápida no card "Top motivos de perda do mês"
CREATE INDEX IF NOT EXISTS idx_prospects_motivo_perda
  ON prospects(motivo_perda) WHERE motivo_perda IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cliente_metadata_motivo_perda
  ON cliente_metadata(motivo_perda) WHERE motivo_perda IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clientes_manuais_motivo_perda
  ON clientes_manuais(motivo_perda) WHERE motivo_perda IS NOT NULL;

-- 5) View unificada — facilita o card no Performance (UNION ALL)
CREATE OR REPLACE VIEW motivos_perda_unificado AS
  SELECT
    'prospect'::TEXT AS origem,
    id::TEXT         AS ref_id,
    nome,
    motivo_perda,
    motivo_perda_detalhe,
    motivo_perda_em,
    criado_por_nome  AS responsavel_nome
  FROM prospects
  WHERE motivo_perda IS NOT NULL
  UNION ALL
  SELECT
    'cliente_bling'::TEXT,
    contato_id::TEXT,
    NULL                AS nome,
    motivo_perda,
    motivo_perda_detalhe,
    motivo_perda_em,
    atualizado_por_nome AS responsavel_nome
  FROM cliente_metadata
  WHERE motivo_perda IS NOT NULL
  UNION ALL
  SELECT
    'cliente_manual'::TEXT,
    id::TEXT,
    nome,
    motivo_perda,
    motivo_perda_detalhe,
    motivo_perda_em,
    criado_por_nome     AS responsavel_nome
  FROM clientes_manuais
  WHERE motivo_perda IS NOT NULL;

-- 6) RPC: top motivos do mês corrente (timezone São Paulo)
CREATE OR REPLACE FUNCTION motivos_perda_top_mes()
RETURNS TABLE (
  motivo_perda TEXT,
  total        BIGINT,
  pct          NUMERIC
)
LANGUAGE SQL STABLE SECURITY DEFINER
AS $$
  WITH base AS (
    SELECT motivo_perda
    FROM motivos_perda_unificado
    WHERE date_trunc('month', motivo_perda_em AT TIME ZONE 'America/Sao_Paulo')
        = date_trunc('month', NOW() AT TIME ZONE 'America/Sao_Paulo')
  ),
  agg AS (
    SELECT motivo_perda, COUNT(*)::BIGINT AS total
    FROM base
    GROUP BY motivo_perda
  ),
  total_geral AS (
    SELECT NULLIF(SUM(total), 0)::NUMERIC AS tg FROM agg
  )
  SELECT
    a.motivo_perda,
    a.total,
    ROUND((a.total::NUMERIC / (SELECT tg FROM total_geral)) * 100, 1) AS pct
  FROM agg a
  ORDER BY a.total DESC;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Validação
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'prospects'         AS tabela, COUNT(*) FILTER (WHERE motivo_perda IS NOT NULL) AS com_motivo FROM prospects
UNION ALL
SELECT 'cliente_metadata', COUNT(*) FILTER (WHERE motivo_perda IS NOT NULL)            FROM cliente_metadata
UNION ALL
SELECT 'clientes_manuais', COUNT(*) FILTER (WHERE motivo_perda IS NOT NULL)            FROM clientes_manuais;

SELECT * FROM motivos_perda_top_mes() LIMIT 10;

-- Pra reverter:
--   ALTER TABLE prospects        DROP COLUMN IF EXISTS motivo_perda, DROP COLUMN IF EXISTS motivo_perda_detalhe, DROP COLUMN IF EXISTS motivo_perda_em;
--   ALTER TABLE cliente_metadata DROP COLUMN IF EXISTS motivo_perda, DROP COLUMN IF EXISTS motivo_perda_detalhe, DROP COLUMN IF EXISTS motivo_perda_em;
--   ALTER TABLE clientes_manuais DROP COLUMN IF EXISTS motivo_perda, DROP COLUMN IF EXISTS motivo_perda_detalhe, DROP COLUMN IF EXISTS motivo_perda_em;
--   DROP FUNCTION IF EXISTS motivos_perda_top_mes();
--   DROP VIEW IF EXISTS motivos_perda_unificado;
-- ═══════════════════════════════════════════════════════════════════════════
