-- ══════════════════════════════════════════════════════════
-- C360 · Histórico de status_relacionamento + Funil de conversão
-- (pedido da Manu — 14/05/2026)
--
-- "no C360, ele não está mostrando quando muda o status ali, apenas o
--  contatado / por exemplo essa cliente já virou em negociação /
--  conseguimos colocar de repente o histórico de alteração desses status?
--  até para medirmos o que evoluiu / podemos fazer um funil também
--  x contatados > x em negociação / para ver quantos retornam"
--
-- Entrega:
--   1. Tabela `cliente_status_historico` (audit trail)
--   2. Trigger que captura toda mudança de status_relacionamento
--   3. Backfill com snapshot atual (1 registro por cliente_metadata)
--   4. RPC `cliente_status_historico_listar(contato_id, empresa)` pra timeline
--   5. RPC `cliente_funil_stats(empresa, periodo_dias)` pro widget de funil
-- ══════════════════════════════════════════════════════════

-- ─── 1. Tabela do histórico ───
CREATE TABLE IF NOT EXISTS cliente_status_historico (
  id              bigserial PRIMARY KEY,
  contato_id      bigint NOT NULL,
  empresa         text   NOT NULL,
  status_anterior text,            -- NULL na primeira mudança (cliente sem status anterior)
  status_novo     text   NOT NULL,
  observacao      text,            -- copia da observacao_rapida no momento da mudança
  mudado_em       timestamptz NOT NULL DEFAULT now(),
  mudado_por_id   uuid REFERENCES auth.users(id),
  mudado_por_nome text,
  -- contexto extra (pra correlacionar com motivos de perda)
  motivo_perda           text,
  motivo_perda_detalhe   text
);

CREATE INDEX IF NOT EXISTS idx_cs_hist_contato
  ON cliente_status_historico (contato_id, empresa, mudado_em DESC);
CREATE INDEX IF NOT EXISTS idx_cs_hist_mudado_em
  ON cliente_status_historico (mudado_em DESC);
CREATE INDEX IF NOT EXISTS idx_cs_hist_status_novo
  ON cliente_status_historico (status_novo);

-- RLS: usuário vê histórico do contato_id que ele consegue ver normalmente
ALTER TABLE cliente_status_historico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cs_hist_select ON cliente_status_historico;
CREATE POLICY cs_hist_select ON cliente_status_historico FOR SELECT
  USING (true);  -- pra simplificar: quem está logado vê. Granularidade fica no app.

-- ─── 2. Trigger que captura mudanças ───
CREATE OR REPLACE FUNCTION trg_cliente_status_historico() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Só grava se houve mudança real de status_relacionamento
  IF TG_OP = 'INSERT' THEN
    -- insert inicial: se já vem com status diferente de 'novo'/NULL, grava
    IF NEW.status_relacionamento IS NOT NULL AND NEW.status_relacionamento <> 'novo' THEN
      INSERT INTO cliente_status_historico (
        contato_id, empresa, status_anterior, status_novo,
        observacao, mudado_em, mudado_por_id, mudado_por_nome,
        motivo_perda, motivo_perda_detalhe
      ) VALUES (
        NEW.contato_id, NEW.empresa, NULL, NEW.status_relacionamento,
        NEW.observacao_rapida, COALESCE(NEW.atualizado_em, now()),
        NEW.atualizado_por, NEW.atualizado_por_nome,
        NEW.motivo_perda, NEW.motivo_perda_detalhe
      );
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status_relacionamento IS DISTINCT FROM OLD.status_relacionamento THEN
      INSERT INTO cliente_status_historico (
        contato_id, empresa, status_anterior, status_novo,
        observacao, mudado_em, mudado_por_id, mudado_por_nome,
        motivo_perda, motivo_perda_detalhe
      ) VALUES (
        NEW.contato_id, NEW.empresa, OLD.status_relacionamento, NEW.status_relacionamento,
        NEW.observacao_rapida, COALESCE(NEW.atualizado_em, now()),
        NEW.atualizado_por, NEW.atualizado_por_nome,
        NEW.motivo_perda, NEW.motivo_perda_detalhe
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cliente_metadata_status_audit ON cliente_metadata;
CREATE TRIGGER cliente_metadata_status_audit
AFTER INSERT OR UPDATE OF status_relacionamento ON cliente_metadata
FOR EACH ROW EXECUTE FUNCTION trg_cliente_status_historico();

-- ─── 3. Backfill — snapshot atual de cada cliente_metadata vira a primeira linha ───
INSERT INTO cliente_status_historico (
  contato_id, empresa, status_anterior, status_novo,
  observacao, mudado_em, mudado_por_id, mudado_por_nome,
  motivo_perda, motivo_perda_detalhe
)
SELECT
  cm.contato_id, cm.empresa, NULL, cm.status_relacionamento,
  cm.observacao_rapida, COALESCE(cm.atualizado_em, now()),
  cm.atualizado_por, cm.atualizado_por_nome,
  cm.motivo_perda, cm.motivo_perda_detalhe
FROM cliente_metadata cm
WHERE cm.status_relacionamento IS NOT NULL
  AND cm.status_relacionamento <> 'novo'
  AND NOT EXISTS (
    SELECT 1 FROM cliente_status_historico h
    WHERE h.contato_id = cm.contato_id AND h.empresa = cm.empresa
  );

-- ─── 4. RPC listar histórico de um contato ───
DROP FUNCTION IF EXISTS cliente_status_historico_listar(bigint, text);
CREATE OR REPLACE FUNCTION cliente_status_historico_listar(
  p_contato_id bigint, p_empresa text
)
RETURNS TABLE (
  id bigint,
  status_anterior text, status_novo text,
  observacao text,
  mudado_em timestamptz,
  mudado_por_nome text,
  motivo_perda text, motivo_perda_detalhe text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, status_anterior, status_novo, observacao,
         mudado_em, mudado_por_nome, motivo_perda, motivo_perda_detalhe
  FROM cliente_status_historico
  WHERE contato_id = p_contato_id AND empresa = p_empresa
  ORDER BY mudado_em DESC
  LIMIT 50;
$$;

-- ─── 5. RPC do funil ───
-- Retorna contagens + taxa de conversão entre stages.
-- "contagens_atual" = quantos clientes ESTÃO em cada status agora
-- "fluxo_periodo"   = movimentações que aconteceram no período (entradas em cada status)
DROP FUNCTION IF EXISTS cliente_funil_stats(text, int);
CREATE OR REPLACE FUNCTION cliente_funil_stats(
  empresa_filter text DEFAULT 'todas',
  periodo_dias int DEFAULT 30
)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH atual AS (
    SELECT status_relacionamento, COUNT(*) AS qt
    FROM cliente_metadata
    WHERE (empresa_filter = 'todas' OR empresa = empresa_filter)
      AND status_relacionamento IS NOT NULL
    GROUP BY status_relacionamento
  ),
  fluxo AS (
    SELECT status_novo, COUNT(DISTINCT (contato_id, empresa)) AS qt
    FROM cliente_status_historico
    WHERE (empresa_filter = 'todas' OR empresa = empresa_filter)
      AND mudado_em >= NOW() - (periodo_dias || ' days')::interval
    GROUP BY status_novo
  ),
  -- conversões de "contatado → negociando" no período
  conv_neg AS (
    SELECT COUNT(DISTINCT (h.contato_id, h.empresa)) AS qt
    FROM cliente_status_historico h
    WHERE h.status_anterior = 'contatado'
      AND h.status_novo = 'negociando'
      AND h.mudado_em >= NOW() - (periodo_dias || ' days')::interval
      AND (empresa_filter = 'todas' OR h.empresa = empresa_filter)
  ),
  conv_won AS (
    SELECT COUNT(DISTINCT (h.contato_id, h.empresa)) AS qt
    FROM cliente_status_historico h
    WHERE h.status_anterior = 'negociando'
      AND h.status_novo = 'convertido'
      AND h.mudado_em >= NOW() - (periodo_dias || ' days')::interval
      AND (empresa_filter = 'todas' OR h.empresa = empresa_filter)
  ),
  conv_lost AS (
    SELECT COUNT(DISTINCT (h.contato_id, h.empresa)) AS qt
    FROM cliente_status_historico h
    WHERE h.status_novo IN ('perdido','sem_interesse')
      AND h.mudado_em >= NOW() - (periodo_dias || ' days')::interval
      AND (empresa_filter = 'todas' OR h.empresa = empresa_filter)
  )
  SELECT json_build_object(
    'periodo_dias', periodo_dias,
    'empresa', empresa_filter,
    'atual', json_build_object(
      'novo',          COALESCE((SELECT qt FROM atual WHERE status_relacionamento='novo'),0),
      'contatado',     COALESCE((SELECT qt FROM atual WHERE status_relacionamento='contatado'),0),
      'negociando',    COALESCE((SELECT qt FROM atual WHERE status_relacionamento='negociando'),0),
      'convertido',    COALESCE((SELECT qt FROM atual WHERE status_relacionamento='convertido'),0),
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
      'contatado_para_negociando', (SELECT qt FROM conv_neg),
      'negociando_para_convertido', (SELECT qt FROM conv_won),
      'total_perdidos',             (SELECT qt FROM conv_lost)
    )
  );
$$;

-- ─── Diagnóstico ───
SELECT
  'historico_total' AS m, COUNT(*) AS qt FROM cliente_status_historico
UNION ALL SELECT 'contatos_com_status', COUNT(DISTINCT (contato_id, empresa))
  FROM cliente_status_historico
UNION ALL SELECT 'trigger_existe', COUNT(*)::bigint
  FROM pg_trigger WHERE tgname = 'cliente_metadata_status_audit';

-- Smoke test do funil
SELECT cliente_funil_stats('todas', 30) AS funil_30d;
