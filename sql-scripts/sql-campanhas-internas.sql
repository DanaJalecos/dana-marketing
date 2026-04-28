-- ============================================================
-- CAMPANHAS INTERNAS (Feature 1 da Manu)
-- Diferente das "Campanhas" (Meta Ads) e das "Campanhas C360" (disparo WhatsApp)
-- Aqui é a ORGANIZACAO/ATRIBUICAO DA EQUIPE por campanha (quem faz o que)
-- ============================================================

-- ==============
-- TABELA PRINCIPAL
-- ==============
CREATE TABLE IF NOT EXISTS campanhas_internas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Campos obrigatorios
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('venda','branding','lancamento','clearance','institucional','outro')),
  data_inicio DATE,
  data_fim DATE,
  status TEXT NOT NULL DEFAULT 'planejamento' CHECK (status IN ('planejamento','producao','ativa','encerrada','cancelada')),
  objetivo TEXT,
  meta_tipo TEXT, -- 'faturamento', 'leads', 'pedidos', 'alcance', 'outro'
  meta_valor NUMERIC,
  publico_alvo TEXT,
  canais TEXT[], -- ['site','loja','whatsapp','trafego','influenciador','email','marketplace']
  briefing_link TEXT,
  responsavel_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  responsavel_nome TEXT,

  -- Campos estrategicos (diferencial Dana)
  oferta_principal TEXT,
  produtos_foco TEXT,
  argumento_central TEXT,
  risco TEXT,

  -- Metadata
  criado_por UUID REFERENCES profiles(id),
  criado_por_nome TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ci_status ON campanhas_internas(status);
CREATE INDEX IF NOT EXISTS idx_ci_responsavel ON campanhas_internas(responsavel_id);
CREATE INDEX IF NOT EXISTS idx_ci_data ON campanhas_internas(data_inicio DESC);

CREATE OR REPLACE FUNCTION ci_update_ts() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ci_updated_at ON campanhas_internas;
CREATE TRIGGER trg_ci_updated_at BEFORE UPDATE ON campanhas_internas
  FOR EACH ROW EXECUTE FUNCTION ci_update_ts();

ALTER TABLE campanhas_internas REPLICA IDENTITY FULL;

-- ==============
-- MEMBROS (quem tem qual funcao na campanha)
-- ==============
CREATE TABLE IF NOT EXISTS campanha_interna_membros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id UUID NOT NULL REFERENCES campanhas_internas(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  profile_nome TEXT,
  -- Funcoes padrao Dana (array pra suportar multiplas por pessoa):
  -- gerente, copy, designer, editor_video, trafego, social_media, crm, comercial,
  -- producao, expedicao, influencer_manager, outro
  funcoes TEXT[] NOT NULL DEFAULT '{}',
  observacao TEXT,
  atribuido_por UUID REFERENCES profiles(id),
  atribuido_por_nome TEXT,
  atribuido_em TIMESTAMPTZ DEFAULT now(),
  UNIQUE (campanha_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_cim_campanha ON campanha_interna_membros(campanha_id);
CREATE INDEX IF NOT EXISTS idx_cim_profile ON campanha_interna_membros(profile_id);

ALTER TABLE campanha_interna_membros REPLICA IDENTITY FULL;

-- ==============
-- PERMISSOES GRANULARES
-- ==============
-- Seção: campanhas_internas → ver a aba
-- Acao: campanha_interna_criar → criar campanha (so admin + gerente_marketing + gerente_comercial)
-- Acao: campanha_interna_editar → editar campanha existente
-- Acao: campanha_interna_excluir → apagar campanha
INSERT INTO cargo_permissoes (cargo, secao, permitido) VALUES
  -- Seção: ver Campanhas Internas
  ('admin', 'campanhas_internas', true),
  ('gerente_marketing', 'campanhas_internas', true),
  ('gerente_comercial', 'campanhas_internas', true),
  ('gerente_financeiro', 'campanhas_internas', true),
  ('trafego_pago', 'campanhas_internas', true),
  ('designer', 'campanhas_internas', true),
  ('producao_conteudo', 'campanhas_internas', true),
  ('analista_marketplace', 'campanhas_internas', true),
  ('vendedor', 'campanhas_internas', false),
  ('expedicao', 'campanhas_internas', true),
  -- Acao: criar
  ('admin', 'campanha_interna_criar', true),
  ('gerente_marketing', 'campanha_interna_criar', true),
  ('gerente_comercial', 'campanha_interna_criar', true),
  ('gerente_financeiro', 'campanha_interna_criar', false),
  ('trafego_pago', 'campanha_interna_criar', false),
  ('designer', 'campanha_interna_criar', false),
  ('producao_conteudo', 'campanha_interna_criar', false),
  ('analista_marketplace', 'campanha_interna_criar', false),
  ('vendedor', 'campanha_interna_criar', false),
  ('expedicao', 'campanha_interna_criar', false),
  -- Acao: editar
  ('admin', 'campanha_interna_editar', true),
  ('gerente_marketing', 'campanha_interna_editar', true),
  ('gerente_comercial', 'campanha_interna_editar', true),
  ('gerente_financeiro', 'campanha_interna_editar', false),
  ('trafego_pago', 'campanha_interna_editar', false),
  ('designer', 'campanha_interna_editar', false),
  ('producao_conteudo', 'campanha_interna_editar', false),
  ('analista_marketplace', 'campanha_interna_editar', false),
  ('vendedor', 'campanha_interna_editar', false),
  ('expedicao', 'campanha_interna_editar', false),
  -- Acao: excluir
  ('admin', 'campanha_interna_excluir', true),
  ('gerente_marketing', 'campanha_interna_excluir', true),
  ('gerente_comercial', 'campanha_interna_excluir', false),
  ('gerente_financeiro', 'campanha_interna_excluir', false),
  ('trafego_pago', 'campanha_interna_excluir', false),
  ('designer', 'campanha_interna_excluir', false),
  ('producao_conteudo', 'campanha_interna_excluir', false),
  ('analista_marketplace', 'campanha_interna_excluir', false),
  ('vendedor', 'campanha_interna_excluir', false),
  ('expedicao', 'campanha_interna_excluir', false)
ON CONFLICT (cargo, secao) DO NOTHING;

-- ==============
-- FUNCAO helper: usuario tem permissao em campanhas_internas?
-- ==============
CREATE OR REPLACE FUNCTION has_campanha_interna_perm() RETURNS BOOLEAN
  LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM cargo_permissoes cp
    JOIN profiles p ON p.cargo = cp.cargo
    WHERE p.id = auth.uid()
      AND cp.secao = 'campanhas_internas'
      AND cp.permitido = true
  );
END;
$$;

CREATE OR REPLACE FUNCTION has_campanha_interna_criar() RETURNS BOOLEAN
  LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM cargo_permissoes cp
    JOIN profiles p ON p.cargo = cp.cargo
    WHERE p.id = auth.uid()
      AND cp.secao = 'campanha_interna_criar'
      AND cp.permitido = true
  );
END;
$$;

CREATE OR REPLACE FUNCTION has_campanha_interna_editar() RETURNS BOOLEAN
  LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM cargo_permissoes cp
    JOIN profiles p ON p.cargo = cp.cargo
    WHERE p.id = auth.uid()
      AND cp.secao = 'campanha_interna_editar'
      AND cp.permitido = true
  );
END;
$$;

CREATE OR REPLACE FUNCTION has_campanha_interna_excluir() RETURNS BOOLEAN
  LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM cargo_permissoes cp
    JOIN profiles p ON p.cargo = cp.cargo
    WHERE p.id = auth.uid()
      AND cp.secao = 'campanha_interna_excluir'
      AND cp.permitido = true
  );
END;
$$;

-- ==============
-- RLS
-- ==============
ALTER TABLE campanhas_internas ENABLE ROW LEVEL SECURITY;
ALTER TABLE campanha_interna_membros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ci_select ON campanhas_internas;
DROP POLICY IF EXISTS ci_insert ON campanhas_internas;
DROP POLICY IF EXISTS ci_update ON campanhas_internas;
DROP POLICY IF EXISTS ci_delete ON campanhas_internas;
DROP POLICY IF EXISTS cim_select ON campanha_interna_membros;
DROP POLICY IF EXISTS cim_write ON campanha_interna_membros;

-- SELECT: qualquer membro com permissao ve todas (necessario pra ver as campanhas em que esta atribuido)
CREATE POLICY ci_select ON campanhas_internas FOR SELECT TO authenticated
  USING (has_campanha_interna_perm());

-- INSERT: apenas quem tem campanha_interna_criar
CREATE POLICY ci_insert ON campanhas_internas FOR INSERT TO authenticated
  WITH CHECK (has_campanha_interna_criar());

-- UPDATE: quem tem campanha_interna_editar OU e o responsavel/criador da campanha
CREATE POLICY ci_update ON campanhas_internas FOR UPDATE TO authenticated
  USING (has_campanha_interna_editar() OR responsavel_id = auth.uid() OR criado_por = auth.uid())
  WITH CHECK (has_campanha_interna_editar() OR responsavel_id = auth.uid() OR criado_por = auth.uid());

-- DELETE: apenas quem tem campanha_interna_excluir
CREATE POLICY ci_delete ON campanhas_internas FOR DELETE TO authenticated
  USING (has_campanha_interna_excluir());

-- MEMBROS: SELECT qualquer usuario com perm, INSERT/UPDATE/DELETE quem pode editar campanha
CREATE POLICY cim_select ON campanha_interna_membros FOR SELECT TO authenticated
  USING (has_campanha_interna_perm());

CREATE POLICY cim_write ON campanha_interna_membros FOR ALL TO authenticated
  USING (has_campanha_interna_editar() OR EXISTS(
    SELECT 1 FROM campanhas_internas c WHERE c.id = campanha_id AND (c.responsavel_id = auth.uid() OR c.criado_por = auth.uid())
  ))
  WITH CHECK (has_campanha_interna_editar() OR EXISTS(
    SELECT 1 FROM campanhas_internas c WHERE c.id = campanha_id AND (c.responsavel_id = auth.uid() OR c.criado_por = auth.uid())
  ));

-- Realtime
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE campanhas_internas; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE campanha_interna_membros; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
