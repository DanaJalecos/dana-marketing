-- ═══════════════════════════════════════════════════════════════════════════
-- MERCADO ADS (Product Ads) — cache da API ML pra dashboard sem latência
-- ═══════════════════════════════════════════════════════════════════════════
-- Sincronizado por edge function sync-ml-ads (cron diário 06:25 BRT).
-- Lê access_token de analytics_ml_connections (refresh automático se expira < 1h).
-- API: GET /marketplace/advertising/MLB/advertisers/{adv_id}/product_ads/campaigns/search
--
-- 3 tabelas:
--   1) analytics_ml_ads_campanhas    — config das campanhas (1 row por campaign_id)
--   2) analytics_ml_ads_metricas     — métricas agregadas por (campaign_id, periodo)
--   3) analytics_ml_ads_diario       — série temporal diária (1 row por dia/advertiser)
--
-- Métricas como % vêm já em percentual da API (15.2 não 0.152) — gravamos como veio.
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Campanhas (config + última leitura "all-time")
CREATE TABLE IF NOT EXISTS analytics_ml_ads_campanhas (
  campaign_id      BIGINT PRIMARY KEY,
  advertiser_id    BIGINT NOT NULL,
  name             TEXT,
  status           TEXT,                    -- active | paused | finalized
  strategy         TEXT,                    -- PROFITABILITY | INCREASE_VISITS | etc
  channel          TEXT,
  budget           NUMERIC(10,2),
  acos_target      NUMERIC(6,2),
  acos_top_search_target NUMERIC(6,2),
  roas_target      NUMERIC(6,2),
  automatic_budget BOOLEAN,
  date_created     TIMESTAMPTZ,
  last_updated     TIMESTAMPTZ,
  raw              JSONB,
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ml_ads_campanhas_advertiser ON analytics_ml_ads_campanhas(advertiser_id);
CREATE INDEX IF NOT EXISTS idx_ml_ads_campanhas_status     ON analytics_ml_ads_campanhas(status);

-- 2) Métricas por período (cache pra evitar chamar API toda vez que abre dashboard)
-- periodo: '7d' | '30d' | '90d'
CREATE TABLE IF NOT EXISTS analytics_ml_ads_metricas (
  campaign_id  BIGINT NOT NULL,
  periodo      TEXT NOT NULL,              -- 7d | 30d | 90d
  date_from    DATE NOT NULL,
  date_to      DATE NOT NULL,
  clicks       INT     NOT NULL DEFAULT 0,
  prints       INT     NOT NULL DEFAULT 0,
  cost         NUMERIC(12,2) NOT NULL DEFAULT 0,
  cpc          NUMERIC(8,2)  NOT NULL DEFAULT 0,
  ctr          NUMERIC(6,2)  NOT NULL DEFAULT 0,   -- já em %
  cvr          NUMERIC(6,2)  NOT NULL DEFAULT 0,   -- já em %
  acos         NUMERIC(6,2)  NOT NULL DEFAULT 0,   -- já em %
  roas         NUMERIC(8,2)  NOT NULL DEFAULT 0,   -- multiplicador
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  direct_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  indirect_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  direct_units_quantity   INT NOT NULL DEFAULT 0,
  indirect_units_quantity INT NOT NULL DEFAULT 0,
  units_quantity          INT NOT NULL DEFAULT 0,
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, periodo)
);

CREATE INDEX IF NOT EXISTS idx_ml_ads_metricas_periodo ON analytics_ml_ads_metricas(periodo, synced_at DESC);

-- 3) Série diária (1 row por dia da conta toda — daily aggregation não tem breakdown por campanha)
CREATE TABLE IF NOT EXISTS analytics_ml_ads_diario (
  data           DATE NOT NULL,
  advertiser_id  BIGINT NOT NULL,
  clicks         INT NOT NULL DEFAULT 0,
  prints         INT NOT NULL DEFAULT 0,
  cost           NUMERIC(12,2) NOT NULL DEFAULT 0,
  cpc            NUMERIC(8,2)  NOT NULL DEFAULT 0,
  ctr            NUMERIC(6,2)  NOT NULL DEFAULT 0,
  cvr            NUMERIC(6,2)  NOT NULL DEFAULT 0,
  acos           NUMERIC(6,2)  NOT NULL DEFAULT 0,
  roas           NUMERIC(8,2)  NOT NULL DEFAULT 0,
  total_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
  direct_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
  indirect_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  units_quantity INT NOT NULL DEFAULT 0,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (data, advertiser_id)
);

CREATE INDEX IF NOT EXISTS idx_ml_ads_diario_data ON analytics_ml_ads_diario(data DESC);

-- 4) View resumo: total da conta por período (somando todas campanhas)
CREATE OR REPLACE VIEW analytics_ml_ads_resumo AS
SELECT
  m.periodo,
  m.date_from,
  m.date_to,
  COUNT(DISTINCT m.campaign_id) AS total_campanhas,
  COUNT(DISTINCT m.campaign_id) FILTER (WHERE c.status = 'active') AS campanhas_ativas,
  SUM(m.cost) AS cost_total,
  SUM(m.total_amount) AS total_amount_total,
  SUM(m.direct_amount) AS direct_amount_total,
  SUM(m.indirect_amount) AS indirect_amount_total,
  SUM(m.clicks) AS clicks_total,
  SUM(m.prints) AS prints_total,
  SUM(m.units_quantity) AS units_total,
  -- ACOS médio ponderado pelo cost
  CASE WHEN SUM(m.total_amount) > 0
       THEN ROUND((SUM(m.cost) / SUM(m.total_amount) * 100)::NUMERIC, 2)
       ELSE 0 END AS acos_medio,
  -- ROAS médio ponderado
  CASE WHEN SUM(m.cost) > 0
       THEN ROUND((SUM(m.total_amount) / SUM(m.cost))::NUMERIC, 2)
       ELSE 0 END AS roas_medio,
  -- CTR médio ponderado
  CASE WHEN SUM(m.prints) > 0
       THEN ROUND((SUM(m.clicks)::NUMERIC / SUM(m.prints) * 100), 2)
       ELSE 0 END AS ctr_medio,
  -- CVR médio ponderado
  CASE WHEN SUM(m.clicks) > 0
       THEN ROUND((SUM(m.units_quantity)::NUMERIC / SUM(m.clicks) * 100), 2)
       ELSE 0 END AS cvr_medio,
  MAX(m.synced_at) AS ultima_sync
FROM analytics_ml_ads_metricas m
LEFT JOIN analytics_ml_ads_campanhas c ON c.campaign_id = m.campaign_id
GROUP BY m.periodo, m.date_from, m.date_to;

-- 5) RPC: alertas inteligentes (campanhas em situação de risco/oportunidade)
CREATE OR REPLACE FUNCTION analytics_ml_ads_alertas(p_periodo TEXT DEFAULT '30d')
RETURNS TABLE (
  tipo TEXT,
  severidade TEXT,
  campaign_id BIGINT,
  campaign_name TEXT,
  mensagem TEXT,
  acos NUMERIC,
  roas NUMERIC,
  cost NUMERIC,
  total_amount NUMERIC,
  clicks INT
)
LANGUAGE SQL STABLE SECURITY DEFINER
AS $$
  WITH base AS (
    SELECT c.campaign_id, c.name, c.status, c.acos_target, c.roas_target, c.budget,
           m.acos, m.roas, m.cost, m.total_amount, m.clicks, m.units_quantity
    FROM analytics_ml_ads_campanhas c
    JOIN analytics_ml_ads_metricas m ON m.campaign_id = c.campaign_id
    WHERE m.periodo = p_periodo AND c.status = 'active'
  )
  -- ACOS estourando meta em 20%+
  SELECT 'acos_alto'::TEXT AS tipo,
         'alta'::TEXT AS severidade,
         campaign_id,
         name,
         ('ACOS ' || acos::TEXT || '% vs meta ' || acos_target::TEXT || '% — está ' || ROUND((acos / NULLIF(acos_target,0) - 1) * 100, 0)::TEXT || '% acima')::TEXT AS mensagem,
         acos, roas, cost, total_amount, clicks
  FROM base
  WHERE acos_target > 0 AND acos > acos_target * 1.2 AND total_amount > 0
  UNION ALL
  -- Campanha com 100+ cliques e zero conversão atribuída
  SELECT 'sem_conversao'::TEXT, 'alta'::TEXT, campaign_id, name,
         ('100+ cliques (' || clicks::TEXT || ') sem nenhuma venda atribuída — verificar tracking ou pausar')::TEXT,
         acos, roas, cost, total_amount, clicks
  FROM base
  WHERE clicks >= 100 AND units_quantity = 0
  UNION ALL
  -- Batendo meta forte (oportunidade aumentar budget)
  SELECT 'batendo_meta'::TEXT, 'oportunidade'::TEXT, campaign_id, name,
         ('Batendo meta forte: ROAS ' || roas::TEXT || 'x vs meta ' || roas_target::TEXT || 'x — considerar aumentar budget (atual R$ ' || budget::TEXT || ')')::TEXT,
         acos, roas, cost, total_amount, clicks
  FROM base
  WHERE roas_target > 0 AND roas > roas_target * 1.3 AND total_amount > 100
  ORDER BY severidade DESC, total_amount DESC;
$$;

-- 6) RLS: SELECT pros 5 cargos do Analytics IA
ALTER TABLE analytics_ml_ads_campanhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_ml_ads_metricas  ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_ml_ads_diario    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ml_ads_camp_select ON analytics_ml_ads_campanhas;
DROP POLICY IF EXISTS ml_ads_camp_admin  ON analytics_ml_ads_campanhas;
DROP POLICY IF EXISTS ml_ads_metr_select ON analytics_ml_ads_metricas;
DROP POLICY IF EXISTS ml_ads_metr_admin  ON analytics_ml_ads_metricas;
DROP POLICY IF EXISTS ml_ads_dia_select  ON analytics_ml_ads_diario;
DROP POLICY IF EXISTS ml_ads_dia_admin   ON analytics_ml_ads_diario;

CREATE POLICY ml_ads_camp_select ON analytics_ml_ads_campanhas FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()
               AND cargo IN ('admin','gerente_marketing','gerente_comercial','trafego_pago','producao_conteudo')));
CREATE POLICY ml_ads_camp_admin ON analytics_ml_ads_campanhas FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo = 'admin'));

CREATE POLICY ml_ads_metr_select ON analytics_ml_ads_metricas FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()
               AND cargo IN ('admin','gerente_marketing','gerente_comercial','trafego_pago','producao_conteudo')));
CREATE POLICY ml_ads_metr_admin ON analytics_ml_ads_metricas FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo = 'admin'));

CREATE POLICY ml_ads_dia_select ON analytics_ml_ads_diario FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()
               AND cargo IN ('admin','gerente_marketing','gerente_comercial','trafego_pago','producao_conteudo')));
CREATE POLICY ml_ads_dia_admin ON analytics_ml_ads_diario FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo = 'admin'));

-- ═══════════════════════════════════════════════════════════════════════════
-- Validação
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'campanhas' AS tabela, COUNT(*) FROM analytics_ml_ads_campanhas
UNION ALL
SELECT 'metricas',            COUNT(*) FROM analytics_ml_ads_metricas
UNION ALL
SELECT 'diario',              COUNT(*) FROM analytics_ml_ads_diario;

-- Reverter:
--   DROP TABLE IF EXISTS analytics_ml_ads_campanhas, analytics_ml_ads_metricas, analytics_ml_ads_diario CASCADE;
--   DROP FUNCTION IF EXISTS analytics_ml_ads_alertas(TEXT);
-- ═══════════════════════════════════════════════════════════════════════════
