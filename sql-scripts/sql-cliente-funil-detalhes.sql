-- ══════════════════════════════════════════════════════════
-- C360 · Funil — drill-down (clique no card abre lista de clientes)
-- (pedido Manu 14/05/2026)
--
-- "quando os adms ou gerentes comerciais clicarem em um desses cards,
--  é para abrir uma janelinha mostrando quais clientes foram mexidos
--  e quem mudou o status"
--
-- Entrega: RPC `cliente_funil_detalhes(tipo, status, empresa, periodo)`
-- que aceita 4 modos:
--   - 'snapshot'   → clientes que ESTÃO no status agora (cliente_metadata)
--   - 'fluxo'      → clientes que ENTRARAM no status no período (historico)
--   - 'conversao'  → clientes que mudaram de A→B no período
--   - 'perdidos'   → clientes que viraram perdido/sem_interesse no período
-- ══════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS cliente_funil_detalhes(text, text, text, text, int);
CREATE OR REPLACE FUNCTION cliente_funil_detalhes(
  modo text,                              -- 'snapshot'|'fluxo'|'conversao'|'perdidos'
  status_filtro text DEFAULT NULL,        -- 'contatado'|'negociando'|'convertido'|...
  empresa_filter text DEFAULT 'todas',
  status_anterior_filtro text DEFAULT NULL,   -- só pra modo 'conversao'
  periodo_dias int DEFAULT 30
)
RETURNS TABLE (
  contato_id bigint,
  empresa text,
  cliente_nome text,
  status_anterior text,
  status_novo text,
  observacao text,
  mudado_em timestamptz,
  mudado_por_nome text,
  motivo_perda text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH base AS (
    -- 1) Snapshot: estado ATUAL em cliente_metadata
    SELECT
      cm.contato_id, cm.empresa, c.nome AS cliente_nome,
      NULL::text AS status_anterior, cm.status_relacionamento AS status_novo,
      cm.observacao_rapida AS observacao,
      cm.atualizado_em AS mudado_em,
      cm.atualizado_por_nome AS mudado_por_nome,
      cm.motivo_perda
    FROM cliente_metadata cm
    LEFT JOIN contatos c ON c.id = cm.contato_id
    WHERE modo = 'snapshot'
      AND (empresa_filter = 'todas' OR cm.empresa = empresa_filter)
      AND cm.status_relacionamento IS NOT NULL
      AND (status_filtro IS NULL OR cm.status_relacionamento = status_filtro)

    UNION ALL

    -- 2) Fluxo: clientes que entraram no status (status_novo) no período
    SELECT
      h.contato_id, h.empresa, c.nome AS cliente_nome,
      h.status_anterior, h.status_novo, h.observacao,
      h.mudado_em, h.mudado_por_nome, h.motivo_perda
    FROM cliente_status_historico h
    LEFT JOIN contatos c ON c.id = h.contato_id
    WHERE modo = 'fluxo'
      AND (empresa_filter = 'todas' OR h.empresa = empresa_filter)
      AND h.status_novo = status_filtro
      AND h.mudado_em >= NOW() - (periodo_dias || ' days')::interval

    UNION ALL

    -- 3) Conversão: A → B específico no período (ex: contatado → negociando)
    SELECT
      h.contato_id, h.empresa, c.nome AS cliente_nome,
      h.status_anterior, h.status_novo, h.observacao,
      h.mudado_em, h.mudado_por_nome, h.motivo_perda
    FROM cliente_status_historico h
    LEFT JOIN contatos c ON c.id = h.contato_id
    WHERE modo = 'conversao'
      AND (empresa_filter = 'todas' OR h.empresa = empresa_filter)
      AND h.status_anterior = status_anterior_filtro
      AND h.status_novo = status_filtro
      AND h.mudado_em >= NOW() - (periodo_dias || ' days')::interval

    UNION ALL

    -- 4) Perdidos/sem_interesse no período
    SELECT
      h.contato_id, h.empresa, c.nome AS cliente_nome,
      h.status_anterior, h.status_novo, h.observacao,
      h.mudado_em, h.mudado_por_nome, h.motivo_perda
    FROM cliente_status_historico h
    LEFT JOIN contatos c ON c.id = h.contato_id
    WHERE modo = 'perdidos'
      AND (empresa_filter = 'todas' OR h.empresa = empresa_filter)
      AND h.status_novo IN ('perdido', 'sem_interesse')
      AND h.mudado_em >= NOW() - (periodo_dias || ' days')::interval
  )
  SELECT *
  FROM base
  ORDER BY mudado_em DESC NULLS LAST
  LIMIT 200;
$$;

-- Diagnóstico
SELECT 'snapshot_contatado' AS m, COUNT(*) FROM cliente_funil_detalhes('snapshot','contatado','todas',NULL,30)
UNION ALL SELECT 'snapshot_negociando', COUNT(*) FROM cliente_funil_detalhes('snapshot','negociando','todas',NULL,30)
UNION ALL SELECT 'fluxo_negociando_30d', COUNT(*) FROM cliente_funil_detalhes('fluxo','negociando','todas',NULL,30)
UNION ALL SELECT 'perdidos_30d', COUNT(*) FROM cliente_funil_detalhes('perdidos',NULL,'todas',NULL,30);
