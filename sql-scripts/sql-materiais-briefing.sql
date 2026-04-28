-- ══════════════════════════════════════════════════════════
-- Tabela materiais_briefing — assets anexados a cada briefing
-- Requer: sql-briefings-campanha.sql (já rodado)
-- Storage: reusa bucket "kanban" (já existente)
-- Rodar no SQL Editor do Supabase
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS materiais_briefing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_id UUID REFERENCES briefings_campanha(id) ON DELETE CASCADE,
  url TEXT NOT NULL,                -- URL pública (Storage ou externa)
  nome TEXT,                        -- Nome exibido (filename original ou label)
  tipo TEXT CHECK (tipo IN ('imagem','video','pdf','link','outro')),
  mime_type TEXT,                   -- Ex: image/jpeg, application/pdf
  tamanho BIGINT,                   -- Bytes (null pra links externos)
  storage_path TEXT,                -- Nome do arquivo no bucket (null pra links)
  criado_por UUID,
  criado_por_nome TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_materiais_briefing_id ON materiais_briefing(briefing_id);
CREATE INDEX IF NOT EXISTS idx_materiais_tipo ON materiais_briefing(tipo);
CREATE INDEX IF NOT EXISTS idx_materiais_created_at ON materiais_briefing(created_at DESC);

-- RLS liberal (controle no frontend via cargo_permissoes)
ALTER TABLE materiais_briefing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_all_materiais" ON materiais_briefing;
CREATE POLICY "read_all_materiais" ON materiais_briefing FOR SELECT USING (true);

DROP POLICY IF EXISTS "write_all_materiais" ON materiais_briefing;
CREATE POLICY "write_all_materiais" ON materiais_briefing FOR ALL USING (true);

-- Verificação
SELECT 'materiais_briefing criada com sucesso' AS status;
