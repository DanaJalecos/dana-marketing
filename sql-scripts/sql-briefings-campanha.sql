-- ══════════════════════════════════════════════════════════
-- Tabela briefings_campanha — briefings gerados pelo Construtor
-- Rodar no SQL Editor do Supabase
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS briefings_campanha (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo TEXT NOT NULL,
  publico TEXT,              -- Ex: "Profissional Liberal"
  problema TEXT,             -- Ex: "Síndrome do Uniforme Invisível"
  conceito TEXT,             -- Frase-conceito da campanha
  oferta TEXT,               -- Descrição da oferta
  canais TEXT,               -- Ex: "Meta Ads + Instagram"
  orcamento NUMERIC,         -- Investimento previsto em R$
  gancho TEXT,               -- Copy do gancho
  cta TEXT,                  -- Copy do CTA
  headline TEXT,             -- Headline do briefing
  quote TEXT,                -- Quote / mensagem central
  pontos_ouro JSONB,         -- Array de pontos fortes
  nunca_dizer JSONB,         -- Array de coisas proibidas
  dados JSONB,               -- Estado completo do wizard (pra reconstruir)
  criado_por UUID,           -- FK auth.users (sem CASCADE pra manter histórico)
  criado_por_nome TEXT,      -- Cache do nome (evita join)
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_briefings_created_at ON briefings_campanha(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_briefings_criado_por ON briefings_campanha(criado_por);

-- Trigger pra atualizar updated_at
CREATE OR REPLACE FUNCTION briefings_campanha_set_updated()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_briefings_updated ON briefings_campanha;
CREATE TRIGGER trg_briefings_updated
  BEFORE UPDATE ON briefings_campanha
  FOR EACH ROW EXECUTE FUNCTION briefings_campanha_set_updated();

-- RLS liberal (controle no frontend via cargo_permissoes)
ALTER TABLE briefings_campanha ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_all_briefings" ON briefings_campanha;
CREATE POLICY "read_all_briefings" ON briefings_campanha FOR SELECT USING (true);

DROP POLICY IF EXISTS "write_all_briefings" ON briefings_campanha;
CREATE POLICY "write_all_briefings" ON briefings_campanha FOR ALL USING (true);

-- Verificação
SELECT 'briefings_campanha criada com sucesso' AS status;
