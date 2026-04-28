-- ══════════════════════════════════════════════════════════
-- Tabela referencias_conteudo — ideias e referências pra criação
-- Fase 2 da seção Influenciadores
-- Workflow: Pendente → Enviado → Em Produção → Gravado → Editado → Publicado
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS referencias_conteudo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo TEXT NOT NULL,
  descricao TEXT,
  link TEXT,
  influenciador_id UUID REFERENCES influenciadores(id) ON DELETE SET NULL,
  influenciador_nome TEXT,                      -- cache
  tipo_conteudo TEXT,                           -- Reels, Stories, TikTok, Feed, Carrossel, etc
  status TEXT NOT NULL CHECK (status IN ('pendente','enviado','em_producao','gravado','editado','publicado','cancelado')) DEFAULT 'pendente',
  prioridade TEXT NOT NULL CHECK (prioridade IN ('alta','media','baixa')) DEFAULT 'media',
  prazo DATE,
  observacoes TEXT,
  criado_por UUID,
  criado_por_nome TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ref_status ON referencias_conteudo(status);
CREATE INDEX IF NOT EXISTS idx_ref_influenciador ON referencias_conteudo(influenciador_id);
CREATE INDEX IF NOT EXISTS idx_ref_prazo ON referencias_conteudo(prazo);

CREATE OR REPLACE FUNCTION referencias_conteudo_set_updated()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ref_updated ON referencias_conteudo;
CREATE TRIGGER trg_ref_updated BEFORE UPDATE ON referencias_conteudo
  FOR EACH ROW EXECUTE FUNCTION referencias_conteudo_set_updated();

ALTER TABLE referencias_conteudo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_all_ref" ON referencias_conteudo;
CREATE POLICY "read_all_ref" ON referencias_conteudo FOR SELECT USING (true);

DROP POLICY IF EXISTS "write_all_ref" ON referencias_conteudo;
CREATE POLICY "write_all_ref" ON referencias_conteudo FOR ALL USING (true);

-- Adicionar na publicação realtime
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='referencias_conteudo') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.referencias_conteudo;
  END IF;
END $$;

SELECT 'Tabela referencias_conteudo criada' AS status;
