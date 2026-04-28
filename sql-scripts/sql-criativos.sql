-- ══════════════════════════════════════════════════════════
-- Tabela criativos — workflow de aprovação de artes
-- Fase 1: status aguardando / aprovado / reprovado
-- Fase 2 (futuro): status 'todo' e 'publicado'
-- Storage: reusa bucket "kanban" com prefix "criativo-"
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS criativos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo TEXT NOT NULL,
  briefing_id UUID REFERENCES briefings_campanha(id) ON DELETE SET NULL,
  briefing_titulo TEXT,                -- cache do título do briefing pra display
  arquivo_url TEXT NOT NULL,           -- URL pública do Storage
  storage_path TEXT,                   -- path no bucket pra deletar depois
  tipo TEXT CHECK (tipo IN ('imagem','video','pdf','outro')),
  mime_type TEXT,
  tamanho BIGINT,
  formato TEXT,                        -- 'reels','feed','stories','carrossel','banner','outro'
  designer_id UUID,                    -- FK auth.users (designer que produziu)
  designer_nome TEXT,                  -- cache do nome
  status TEXT NOT NULL CHECK (status IN ('aguardando','aprovado','reprovado','todo','publicado')) DEFAULT 'aguardando',
  observacoes TEXT,                    -- conceito/briefing preenchido pelo designer no upload
  feedback TEXT,                       -- razão da reprovação
  feedback_por UUID,
  feedback_por_nome TEXT,
  feedback_em TIMESTAMPTZ,
  aprovado_por UUID,
  aprovado_por_nome TEXT,
  aprovado_em TIMESTAMPTZ,
  publicado_em TIMESTAMPTZ,            -- Fase 2
  link_post TEXT,                      -- Fase 2
  plataforma TEXT,                     -- Fase 2: 'instagram','tiktok','facebook','linkedin'
  versao INT DEFAULT 1,                -- Fase 2: versões sucessivas após feedback
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_criativos_status ON criativos(status);
CREATE INDEX IF NOT EXISTS idx_criativos_briefing_id ON criativos(briefing_id);
CREATE INDEX IF NOT EXISTS idx_criativos_created_at ON criativos(created_at DESC);

CREATE OR REPLACE FUNCTION criativos_set_updated()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_criativos_updated ON criativos;
CREATE TRIGGER trg_criativos_updated
  BEFORE UPDATE ON criativos
  FOR EACH ROW EXECUTE FUNCTION criativos_set_updated();

ALTER TABLE criativos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_all_criativos" ON criativos;
CREATE POLICY "read_all_criativos" ON criativos FOR SELECT USING (true);

DROP POLICY IF EXISTS "write_all_criativos" ON criativos;
CREATE POLICY "write_all_criativos" ON criativos FOR ALL USING (true);

SELECT 'criativos criada com sucesso' AS status;
