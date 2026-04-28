-- ============================================================
-- AVATARES IA (geracao de imagens via Gemini 2.5 Flash Image paid)
-- Cada imagem custa ~R$ 0,20. Admin ilimitado. Demais usuarios 5/dia.
-- Kill-switch global se gastar > R$ 50/mes.
-- ============================================================

-- Config global (singleton — id=1)
CREATE TABLE IF NOT EXISTS avatares_ia_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ativo BOOLEAN DEFAULT true,
  limite_diario_usuario INTEGER DEFAULT 5,
  limite_mensal_reais NUMERIC DEFAULT 50.00,
  custo_por_imagem_reais NUMERIC DEFAULT 0.20,
  pausado_por_limite BOOLEAN DEFAULT false,
  pausado_em TIMESTAMPTZ,
  atualizado_por UUID REFERENCES profiles(id),
  atualizado_em TIMESTAMPTZ DEFAULT now()
);

INSERT INTO avatares_ia_config (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Log de cada geracao (pra quota + dashboard de custo)
CREATE TABLE IF NOT EXISTS avatares_ia_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  user_nome TEXT,
  user_cargo TEXT,
  contexto TEXT NOT NULL, -- 'persona','campanha_interna','briefing','criativo','outro'
  contexto_ref_id TEXT,   -- id do recurso (persona_v='dra_mariana', campanha_id, briefing_id, etc)
  prompt TEXT NOT NULL,
  url TEXT,               -- URL no Storage (null se falhou)
  tamanho_bytes BIGINT,
  modelo TEXT DEFAULT 'gemini-2.5-flash-image',
  custo_estimado_reais NUMERIC DEFAULT 0.20,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','erro','bloqueado_quota','bloqueado_killswitch')),
  erro_msg TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aia_user_dia ON avatares_ia_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aia_contexto ON avatares_ia_log(contexto, contexto_ref_id);
CREATE INDEX IF NOT EXISTS idx_aia_created ON avatares_ia_log(created_at DESC);

ALTER TABLE avatares_ia_log REPLICA IDENTITY FULL;

-- ==============
-- RLS
-- ==============
ALTER TABLE avatares_ia_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE avatares_ia_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS aic_sel ON avatares_ia_config;
DROP POLICY IF EXISTS aic_upd ON avatares_ia_config;
DROP POLICY IF EXISTS aial_sel ON avatares_ia_log;
DROP POLICY IF EXISTS aial_ins ON avatares_ia_log;

-- config: todos leem (pra quota ficar visivel); so admin muda
CREATE POLICY aic_sel ON avatares_ia_config FOR SELECT TO authenticated USING (true);
CREATE POLICY aic_upd ON avatares_ia_config FOR UPDATE TO authenticated
  USING (EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo = 'admin'))
  WITH CHECK (EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo = 'admin'));

-- log: user ve os seus + admin ve tudo; insert pelo backend (service_role); nada mais
CREATE POLICY aial_sel ON avatares_ia_log FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo = 'admin'));
-- sem policy de INSERT pra authenticated — só service_role (edge function)

-- ==============
-- PERMISSAO na secao (pra admin poder liberar/bloquear por cargo)
-- ==============
INSERT INTO cargo_permissoes (cargo, secao, permitido) VALUES
  ('admin', 'avatares_ia_gerar', true),
  ('gerente_marketing', 'avatares_ia_gerar', true),
  ('gerente_comercial', 'avatares_ia_gerar', true),
  ('gerente_financeiro', 'avatares_ia_gerar', false),
  ('trafego_pago', 'avatares_ia_gerar', true),
  ('designer', 'avatares_ia_gerar', true),
  ('producao_conteudo', 'avatares_ia_gerar', true),
  ('analista_marketplace', 'avatares_ia_gerar', false),
  ('vendedor', 'avatares_ia_gerar', false),
  ('expedicao', 'avatares_ia_gerar', false)
ON CONFLICT (cargo, secao) DO NOTHING;

-- ==============
-- Realtime
-- ==============
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE avatares_ia_config; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE avatares_ia_log; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- ==============
-- HELPER: conta imagens do user hoje
-- ==============
CREATE OR REPLACE FUNCTION avatares_ia_count_hoje(p_user_id UUID) RETURNS INTEGER
  LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COUNT(*)::INTEGER FROM avatares_ia_log
  WHERE user_id = p_user_id
    AND status = 'ok'
    AND created_at >= (CURRENT_DATE AT TIME ZONE 'America/Sao_Paulo');
$$;

-- HELPER: total gasto no mes corrente
CREATE OR REPLACE FUNCTION avatares_ia_gasto_mes() RETURNS NUMERIC
  LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(SUM(custo_estimado_reais), 0) FROM avatares_ia_log
  WHERE status = 'ok'
    AND created_at >= date_trunc('month', now());
$$;
