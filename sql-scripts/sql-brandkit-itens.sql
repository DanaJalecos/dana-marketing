-- ══════════════════════════════════════════════════════════
-- Tabela brandkit_itens — assets globais reutilizáveis da marca
-- (logos, fotos de produto, templates, documentos)
-- NÃO vinculada a briefings — biblioteca-mãe da marca.
-- Storage: reusa bucket "kanban" com prefix "brandkit-"
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS brandkit_itens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  descricao TEXT,
  categoria TEXT NOT NULL CHECK (categoria IN ('logo','foto','template','documento','outro')),
  url TEXT NOT NULL,
  tipo TEXT CHECK (tipo IN ('imagem','video','pdf','link','outro')),
  mime_type TEXT,
  tamanho BIGINT,
  storage_path TEXT,
  criado_por UUID,
  criado_por_nome TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brandkit_categoria ON brandkit_itens(categoria);
CREATE INDEX IF NOT EXISTS idx_brandkit_tipo ON brandkit_itens(tipo);
CREATE INDEX IF NOT EXISTS idx_brandkit_created_at ON brandkit_itens(created_at DESC);

-- RLS liberal (controle no frontend via cargo_permissoes)
ALTER TABLE brandkit_itens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_all_brandkit" ON brandkit_itens;
CREATE POLICY "read_all_brandkit" ON brandkit_itens FOR SELECT USING (true);

DROP POLICY IF EXISTS "write_all_brandkit" ON brandkit_itens;
CREATE POLICY "write_all_brandkit" ON brandkit_itens FOR ALL USING (true);

SELECT 'brandkit_itens criada com sucesso' AS status;
