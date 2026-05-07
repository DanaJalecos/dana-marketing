-- ═══════════════════════════════════════════════════════════════════════════
-- Schema pra Analytics IA insights (Fase 1 do ciclo Analytics IA)
-- ═══════════════════════════════════════════════════════════════════════════
-- Espelho da infra do Cliente 360 (cliente_insights_config + cliente_insights),
-- adaptado pra contexto de tráfego (GA4 + Google Ads + Mercado Livre).
--
-- 5 cargos autorizados: admin (ilimitado) + gerente_marketing + gerente_comercial
-- + trafego_pago + producao_conteudo. Vendedor sem acesso.
--
-- Idempotente: pode rodar múltiplas vezes sem efeitos colaterais.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Config singleton (id=1) — kill-switch + quotas + limite mensal
CREATE TABLE IF NOT EXISTS analytics_insights_config (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ativo BOOLEAN NOT NULL DEFAULT true,
  limite_diario_gerente INT NOT NULL DEFAULT 10,
  limite_diario_trafego INT NOT NULL DEFAULT 10,
  limite_diario_producao INT NOT NULL DEFAULT 5,
  limite_mensal_reais NUMERIC(8,2) NOT NULL DEFAULT 30,
  custo_por_insight_reais NUMERIC(6,4) NOT NULL DEFAULT 0.02,
  pausado_por_limite BOOLEAN NOT NULL DEFAULT false,
  pausado_manual BOOLEAN NOT NULL DEFAULT false,
  observacao TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insere singleton se ainda não existe
INSERT INTO analytics_insights_config (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- 2) Tabela de logging — histórico + quota counter
CREATE TABLE IF NOT EXISTS analytics_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escopo TEXT NOT NULL,                    -- 'painel_geral' | 'drill_canal' | 'drill_pagina' | 'drill_campanha' | 'sistema'
  periodo_dias INT NOT NULL,
  data_ini DATE,
  data_fim DATE,
  contexto_resumido_json JSONB,            -- snapshot do contexto enviado (audit + reuso)
  insight TEXT NOT NULL,
  modelo TEXT,
  modelo_provider TEXT,                    -- 'groq' | 'gemini' | 'desconhecido'
  custo_estimado NUMERIC(6,4) DEFAULT 0,
  user_id UUID,                            -- NULL pra cron
  user_nome TEXT,
  cargo_autor TEXT,                        -- 'sistema' pra cron
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_insights_user      ON analytics_insights(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_insights_escopo    ON analytics_insights(escopo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_insights_created   ON analytics_insights(created_at DESC);

-- 3) RPC: conta insights gerados HOJE pelo user (timezone São Paulo)
CREATE OR REPLACE FUNCTION analytics_insights_count_hoje(uid UUID)
RETURNS INT
LANGUAGE SQL STABLE SECURITY DEFINER
AS $$
  SELECT COUNT(*)::INT
  FROM analytics_insights
  WHERE user_id = uid
    AND (created_at AT TIME ZONE 'America/Sao_Paulo')::DATE
        = (NOW() AT TIME ZONE 'America/Sao_Paulo')::DATE
$$;

-- 4) RPC: gasto acumulado do mês (kill-switch)
CREATE OR REPLACE FUNCTION analytics_insights_gasto_mes()
RETURNS NUMERIC
LANGUAGE SQL STABLE SECURITY DEFINER
AS $$
  SELECT COALESCE(SUM(custo_estimado), 0)::NUMERIC
  FROM analytics_insights
  WHERE date_trunc('month', created_at AT TIME ZONE 'America/Sao_Paulo')
      = date_trunc('month', NOW() AT TIME ZONE 'America/Sao_Paulo')
$$;

-- 5) RLS: SELECT pra os 5 cargos autorizados, INSERT/UPDATE/DELETE só via service_role
ALTER TABLE analytics_insights_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_insights        ENABLE ROW LEVEL SECURITY;

-- Limpa policies antigas (rerun safe)
DROP POLICY IF EXISTS analytics_cfg_select ON analytics_insights_config;
DROP POLICY IF EXISTS analytics_cfg_admin  ON analytics_insights_config;
DROP POLICY IF EXISTS analytics_ins_select ON analytics_insights;
DROP POLICY IF EXISTS analytics_ins_admin  ON analytics_insights;

-- Config: SELECT pra logados, escrita só admin
CREATE POLICY analytics_cfg_select ON analytics_insights_config FOR SELECT TO authenticated
USING (true);
CREATE POLICY analytics_cfg_admin ON analytics_insights_config FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo = 'admin'));

-- Insights: SELECT pra cargos autorizados, INSERT só via service_role (edge function)
CREATE POLICY analytics_ins_select ON analytics_insights FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND cargo IN ('admin','gerente_marketing','gerente_comercial','trafego_pago','producao_conteudo')
  )
);
CREATE POLICY analytics_ins_admin ON analytics_insights FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo = 'admin'));

-- 6) Realtime opcional (admin pode acompanhar geração ao vivo)
ALTER PUBLICATION supabase_realtime ADD TABLE analytics_insights;

-- ═══════════════════════════════════════════════════════════════════════════
-- Validação
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'config' AS tabela, COUNT(*)::TEXT FROM analytics_insights_config
UNION ALL
SELECT 'insights', COUNT(*)::TEXT FROM analytics_insights
UNION ALL
SELECT 'count_hoje_test', analytics_insights_count_hoje('00000000-0000-0000-0000-000000000000'::UUID)::TEXT
UNION ALL
SELECT 'gasto_mes_test', analytics_insights_gasto_mes()::TEXT;

-- Pra desativar:
--   UPDATE analytics_insights_config SET ativo = false WHERE id = 1;
--   ou pra pausar manual: UPDATE ... SET pausado_manual = true WHERE id = 1;
-- ═══════════════════════════════════════════════════════════════════════════
