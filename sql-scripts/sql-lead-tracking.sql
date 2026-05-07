-- ═══════════════════════════════════════════════════════════════════════════
-- LEAD TRACKING — Feature #3 do roadmap pós-Analytics IA (Section 62.3 da doc)
-- ═══════════════════════════════════════════════════════════════════════════
-- Captura visitantes anônimos do site Dana (Magazord) e amarra retroativamente
-- quando viram cliente. Coração do "Lead Tracking" do RD Station, sem depender
-- de email/SMS. LGPD-friendly: cookie first-party + IP mascarado /24.
--
-- 4 componentes:
--   1) analytics_lead_events    — série temporal de eventos (pageview/click/etc)
--   2) analytics_lead_identity  — resolução cookie_id ↔ contato_nome/email_hash
--   3) View analytics_jornada_cliente — agregação por contato pra Cliente 360
--   4) View cliente_eventos_timeline (recriada) — adiciona eventos do tracker
--      no UNION existente da Timeline (só os que já têm contato_nome resolvido)
--
-- Ingest via edge function dms-tracker-ingest (publica, sem JWT, rate limited).
-- Identidade resolvida quando frontend manda evento purchase/form_submit com
-- email_hash/contato_nome — UPDATE retroativo em todos os eventos do cookie.
--
-- Idempotente: pode rodar múltiplas vezes.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Eventos brutos do tracker (série temporal)
CREATE TABLE IF NOT EXISTS analytics_lead_events (
  id BIGSERIAL PRIMARY KEY,
  cookie_id      UUID NOT NULL,
  -- Resolução de identidade (NULL pra anônimos; UPDATE retroativo quando vira cliente)
  contato_id     BIGINT,                 -- FK lógico pro contato Bling (sem constraint pra performance)
  contato_nome   TEXT,
  email_hash     TEXT,                   -- SHA256 do email lowercase trim — LGPD friendly
  empresa        TEXT,                   -- 'matriz' | 'bc' | NULL se ainda anônimo
  -- Evento
  evento_tipo    TEXT NOT NULL,          -- pageview | click | form_view | form_submit | add_cart | checkout_start | purchase
  url            TEXT,
  url_path       TEXT,                   -- só o pathname pra agregação (ex: /jaleco-feminino-chloe)
  referrer       TEXT,
  -- Atribuição
  utm_source     TEXT,
  utm_medium     TEXT,
  utm_campaign   TEXT,
  utm_content    TEXT,
  utm_term       TEXT,
  -- Contexto técnico
  device         TEXT,                   -- mobile | desktop | tablet
  browser        TEXT,
  os             TEXT,
  user_agent     TEXT,
  ip_anon        TEXT,                   -- /24 mascarado server-side (LGPD)
  pais           TEXT,
  -- Extra
  metadata       JSONB,                  -- {valor_pedido, sku, qtd, ...} dependendo do evento
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lle_cookie_created  ON analytics_lead_events(cookie_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lle_contato_created ON analytics_lead_events(contato_nome, created_at DESC) WHERE contato_nome IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lle_created         ON analytics_lead_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lle_evento_tipo     ON analytics_lead_events(evento_tipo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lle_email_hash      ON analytics_lead_events(email_hash) WHERE email_hash IS NOT NULL;

-- 2) Resolução de identidade (cookie ↔ pessoa)
CREATE TABLE IF NOT EXISTS analytics_lead_identity (
  cookie_id        UUID PRIMARY KEY,
  contato_nome     TEXT,
  email_hash       TEXT,
  empresa          TEXT,
  primeiro_evento  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultimo_evento    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolvido_em     TIMESTAMPTZ,           -- quando virou cliente conhecido
  total_eventos    INT NOT NULL DEFAULT 1,
  primeiro_referrer TEXT,
  primeiro_utm_source TEXT,
  primeiro_utm_campaign TEXT
);

CREATE INDEX IF NOT EXISTS idx_lli_contato     ON analytics_lead_identity(contato_nome) WHERE contato_nome IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lli_email_hash  ON analytics_lead_identity(email_hash)   WHERE email_hash   IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lli_resolvido   ON analytics_lead_identity(resolvido_em DESC) WHERE resolvido_em IS NOT NULL;

-- 3) View de jornada agregada por cliente — usada na aba "🔍 Comportamento" do C360
CREATE OR REPLACE VIEW analytics_jornada_cliente AS
SELECT
  contato_nome,
  empresa,
  COUNT(*)                                                                    AS total_eventos,
  COUNT(*) FILTER (WHERE evento_tipo = 'pageview')                            AS pageviews,
  COUNT(DISTINCT url_path) FILTER (WHERE evento_tipo = 'pageview')            AS paginas_unicas,
  COUNT(DISTINCT DATE(created_at AT TIME ZONE 'America/Sao_Paulo'))           AS dias_visitando,
  MIN(created_at)                                                             AS primeiro_toque,
  MAX(created_at)                                                             AS ultimo_toque,
  EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at)))::INT                AS segundos_jornada,
  COUNT(*) FILTER (WHERE evento_tipo = 'add_cart')                            AS add_carts,
  COUNT(*) FILTER (WHERE evento_tipo = 'checkout_start')                      AS checkouts_iniciados,
  COUNT(*) FILTER (WHERE evento_tipo = 'purchase')                            AS compras,
  array_agg(DISTINCT utm_source)   FILTER (WHERE utm_source   IS NOT NULL)    AS canais,
  array_agg(DISTINCT utm_campaign) FILTER (WHERE utm_campaign IS NOT NULL)    AS campanhas,
  array_agg(DISTINCT device)       FILTER (WHERE device IS NOT NULL)          AS devices
FROM analytics_lead_events
WHERE contato_nome IS NOT NULL
GROUP BY contato_nome, empresa;

-- 4) RPC: top páginas vistas por um contato (pra aba Comportamento)
CREATE OR REPLACE FUNCTION analytics_top_paginas_contato(p_contato_nome TEXT, p_empresa TEXT DEFAULT NULL, p_limite INT DEFAULT 15)
RETURNS TABLE (url_path TEXT, vezes BIGINT, ultima_em TIMESTAMPTZ)
LANGUAGE SQL STABLE SECURITY DEFINER
AS $$
  SELECT url_path, COUNT(*)::BIGINT AS vezes, MAX(created_at) AS ultima_em
  FROM analytics_lead_events
  WHERE contato_nome = p_contato_nome
    AND (p_empresa IS NULL OR empresa = p_empresa)
    AND evento_tipo = 'pageview'
    AND url_path IS NOT NULL
  GROUP BY url_path
  ORDER BY vezes DESC, ultima_em DESC
  LIMIT p_limite;
$$;

-- 5) RPC: linha do tempo dos últimos N eventos do contato (pra mini-timeline na aba)
CREATE OR REPLACE FUNCTION analytics_eventos_contato(p_contato_nome TEXT, p_empresa TEXT DEFAULT NULL, p_limite INT DEFAULT 50)
RETURNS TABLE (
  id BIGINT, evento_tipo TEXT, url_path TEXT, url TEXT, utm_source TEXT, utm_campaign TEXT,
  device TEXT, metadata JSONB, created_at TIMESTAMPTZ
)
LANGUAGE SQL STABLE SECURITY DEFINER
AS $$
  SELECT id, evento_tipo, url_path, url, utm_source, utm_campaign, device, metadata, created_at
  FROM analytics_lead_events
  WHERE contato_nome = p_contato_nome
    AND (p_empresa IS NULL OR empresa = p_empresa)
  ORDER BY created_at DESC
  LIMIT p_limite;
$$;

-- 6) RLS — leitura só pros 5 cargos do Analytics IA (mesmo whitelist),
--    insert/update só via service_role (edge function ingest)
ALTER TABLE analytics_lead_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_lead_identity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lle_select ON analytics_lead_events;
DROP POLICY IF EXISTS lle_admin  ON analytics_lead_events;
DROP POLICY IF EXISTS lli_select ON analytics_lead_identity;
DROP POLICY IF EXISTS lli_admin  ON analytics_lead_identity;

-- Eventos: SELECT pra cargos autorizados (admin + gerente_marketing + gerente_comercial + trafego_pago + producao_conteudo)
CREATE POLICY lle_select ON analytics_lead_events FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND cargo IN ('admin','gerente_marketing','gerente_comercial','trafego_pago','producao_conteudo')
  )
);

-- Identity: mesmo SELECT
CREATE POLICY lli_select ON analytics_lead_identity FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND cargo IN ('admin','gerente_marketing','gerente_comercial','trafego_pago','producao_conteudo')
  )
);

-- Admin pode escrever direto se precisar (corrigir, apagar GDPR, etc)
CREATE POLICY lle_admin ON analytics_lead_events FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo = 'admin'));

CREATE POLICY lli_admin ON analytics_lead_identity FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo = 'admin'));

-- 7) View cliente_eventos_timeline RECRIADA — adiciona eventos do tracker no UNION
-- Mantém os 4 tipos existentes (pedido/pagamento|cobranca/nota/insight) e adiciona
-- 'lead_event' agrupado por dia+url_path (evita explodir timeline com 200 pageviews)
CREATE OR REPLACE VIEW cliente_eventos_timeline AS
SELECT contato_nome, data_evento, tipo, titulo, descricao, dados, empresa FROM (
  -- Pedidos
  SELECT pedidos.contato_nome,
    pedidos.data::timestamp with time zone AS data_evento,
    'pedido'::text AS tipo,
    'Pedido #'::text || pedidos.numero AS titulo,
    'Total: R$ '::text || COALESCE(pedidos.total, 0::numeric)::text AS descricao,
    jsonb_build_object('pedido_id', pedidos.id, 'numero', pedidos.numero, 'total', pedidos.total,
                       'situacao_id', pedidos.situacao_id, 'vendedor_nome', pedidos.vendedor_nome) AS dados,
    pedidos.empresa
  FROM pedidos
  WHERE pedidos.data IS NOT NULL AND pedidos.contato_nome IS NOT NULL

  UNION ALL

  -- Contas a receber
  SELECT contas_receber.contato_nome,
    COALESCE(contas_receber.vencimento, contas_receber.data_emissao)::timestamp with time zone AS data_evento,
    CASE WHEN contas_receber.situacao = 2 THEN 'pagamento'::text ELSE 'cobranca'::text END AS tipo,
    CASE WHEN contas_receber.situacao = 2 THEN 'Pagou R$ '::text || COALESCE(contas_receber.valor, 0::numeric)::text
         ELSE 'Conta a vencer R$ '::text || COALESCE(contas_receber.valor, 0::numeric)::text END AS titulo,
    COALESCE('Origem: '::text || contas_receber.origem_numero, 'Sem origem'::text) AS descricao,
    jsonb_build_object('conta_id', contas_receber.id, 'valor', contas_receber.valor,
                       'situacao', contas_receber.situacao, 'origem_numero', contas_receber.origem_numero) AS dados,
    contas_receber.empresa
  FROM contas_receber
  WHERE COALESCE(contas_receber.vencimento, contas_receber.data_emissao) IS NOT NULL
    AND contas_receber.contato_nome IS NOT NULL

  UNION ALL

  -- Notas
  SELECT cliente_notas.contato_nome,
    cliente_notas.created_at AS data_evento,
    'nota'::text AS tipo,
    COALESCE(cliente_notas.user_nome, 'Alguém'::text) || ' adicionou nota'::text AS titulo,
    COALESCE(cliente_notas.texto, ''::text) AS descricao,
    jsonb_build_object('nota_id', cliente_notas.id, 'user_id', cliente_notas.user_id,
                       'user_nome', cliente_notas.user_nome, 'cargo', cliente_notas.user_cargo) AS dados,
    cliente_notas.empresa
  FROM cliente_notas
  WHERE cliente_notas.contato_nome IS NOT NULL

  UNION ALL

  -- Insights IA
  SELECT cliente_insights.contato_nome,
    cliente_insights.created_at AS data_evento,
    'insight'::text AS tipo,
    'Insight IA gerado'::text AS titulo,
    "left"(COALESCE(cliente_insights.insight, ''::text), 250) AS descricao,
    jsonb_build_object('insight_id', cliente_insights.id, 'modelo', cliente_insights.modelo,
                       'modelo_provider', cliente_insights.modelo_provider, 'custo', cliente_insights.custo_estimado,
                       'user_nome', cliente_insights.user_nome) AS dados,
    cliente_insights.empresa
  FROM cliente_insights
  WHERE cliente_insights.contato_nome IS NOT NULL

  UNION ALL

  -- 🆕 Lead events do tracker — agregado por dia+url_path pra evitar explodir timeline
  SELECT
    contato_nome,
    MAX(created_at) AS data_evento,
    'lead_event'::text AS tipo,
    CASE evento_tipo
      WHEN 'pageview'        THEN '👁 Visitou ' || COALESCE(url_path, '/')
      WHEN 'add_cart'        THEN '🛒 Adicionou ao carrinho'
      WHEN 'checkout_start'  THEN '💳 Iniciou checkout'
      WHEN 'purchase'        THEN '✅ Comprou (tracker)'
      WHEN 'form_submit'     THEN '📩 Enviou formulário'
      WHEN 'form_view'       THEN '👀 Viu formulário'
      WHEN 'click'           THEN '🖱 Click em CTA'
      ELSE '· ' || evento_tipo
    END AS titulo,
    CASE
      WHEN COUNT(*) > 1 THEN COUNT(*)::text || 'x · '
                             || COALESCE(MAX(utm_source), 'direto')
                             || COALESCE(' / ' || MAX(utm_campaign), '')
      ELSE COALESCE(utm_source, 'direto') || COALESCE(' / ' || utm_campaign, '')
    END AS descricao,
    jsonb_build_object(
      'evento_tipo', evento_tipo,
      'url_path',    url_path,
      'vezes',       COUNT(*),
      'utm_source',  MAX(utm_source),
      'utm_campaign',MAX(utm_campaign),
      'device',      MAX(device)
    ) AS dados,
    empresa
  FROM analytics_lead_events
  WHERE contato_nome IS NOT NULL
  GROUP BY contato_nome, empresa, evento_tipo, url_path,
           DATE(created_at AT TIME ZONE 'America/Sao_Paulo'),
           -- evento_tipo + utm + device juntos só quando tiver 1 evento (pra preservar info)
           utm_source, utm_campaign, device
) t
ORDER BY data_evento DESC;

-- ═══════════════════════════════════════════════════════════════════════════
-- Validação
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'analytics_lead_events'   AS tabela, COUNT(*) FROM analytics_lead_events
UNION ALL
SELECT 'analytics_lead_identity',         COUNT(*) FROM analytics_lead_identity
UNION ALL
SELECT 'view_jornada_count',              COUNT(*) FROM analytics_jornada_cliente
UNION ALL
SELECT 'timeline_total',                  COUNT(*) FROM cliente_eventos_timeline;

-- Pra reverter:
--   DROP TABLE IF EXISTS analytics_lead_events, analytics_lead_identity CASCADE;
--   DROP FUNCTION IF EXISTS analytics_top_paginas_contato, analytics_eventos_contato;
--   -- e re-rodar a versão original da view cliente_eventos_timeline (sem o UNION ALL com lead events)
-- ═══════════════════════════════════════════════════════════════════════════
