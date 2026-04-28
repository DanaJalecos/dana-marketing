-- ══════════════════════════════════════════════════════════
-- Tabela influenciadores — CRUD completo de parcerias
-- Inspirado no dashboard Manus (danadash-gr3czv99.manus.space/influenciadores)
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS influenciadores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  instagram TEXT,                              -- @username OU URL completa
  cidade TEXT,
  regiao TEXT CHECK (regiao IN ('Nordeste','Sudeste','Centro Oeste','Sul','Norte') OR regiao IS NULL),
  profissao TEXT,
  nicho TEXT,
  seguidores INT DEFAULT 0,
  inicio_parceria DATE,
  status TEXT NOT NULL CHECK (status IN ('ativo','pausado','inativo')) DEFAULT 'ativo',
  contato TEXT,                                -- email ou telefone
  codigo_cupom TEXT,
  usos_cupom INT DEFAULT 0,
  vendas_geradas INT DEFAULT 0,
  receita NUMERIC DEFAULT 0,                   -- R$ gerado
  observacoes TEXT,
  criado_por UUID,
  criado_por_nome TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_infl_status ON influenciadores(status);
CREATE INDEX IF NOT EXISTS idx_infl_receita ON influenciadores(receita DESC NULLS LAST);

CREATE OR REPLACE FUNCTION influenciadores_set_updated()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_infl_updated ON influenciadores;
CREATE TRIGGER trg_infl_updated BEFORE UPDATE ON influenciadores
  FOR EACH ROW EXECUTE FUNCTION influenciadores_set_updated();

ALTER TABLE influenciadores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_all_infl" ON influenciadores;
CREATE POLICY "read_all_infl" ON influenciadores FOR SELECT USING (true);

DROP POLICY IF EXISTS "write_all_infl" ON influenciadores;
CREATE POLICY "write_all_infl" ON influenciadores FOR ALL USING (true);

-- Adicionar na publicação realtime
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='influenciadores') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.influenciadores;
  END IF;
END $$;

-- Seed com os 16 influenciadores (só insere se vazio)
INSERT INTO influenciadores (nome, instagram, nicho, regiao, status, seguidores, usos_cupom)
SELECT * FROM (VALUES
  ('Bianca', 'https://www.instagram.com/bianca.viictoria?igsh=eWVtam9wbTFvbGJ4', 'Lifestyle', 'Sul', 'ativo', 6473, 0),
  ('Verônica Rodrigues da Silva', 'https://www.instagram.com/veronica_rodrigues_odonto?igsh=MWlyd3AxOHd4bHN2OA==', NULL, 'Nordeste', 'ativo', 3252, 0),
  ('Consuelo', 'https://www.instagram.com/consuelo_vasc?igsh=Zmt2dHd2c2plMHFv', NULL, 'Sul', 'ativo', 1093, 0),
  ('FLOR DI LIZ', 'https://www.instagram.com/floordiliz?igsh=MXdzMHdxdzc4eXZrdA==', NULL, 'Centro Oeste', 'ativo', 4136, 15),
  ('Kawana Aparecida Timoteo', '@at.kawana', 'Lifestyle, beleza e odontologia', 'Sudeste', 'ativo', 0, 0),
  ('Julia Gabriely Farias', '@juliagabriely.f', 'lifestyle, rotina, saúde', 'Sul', 'ativo', 0, 0),
  ('Samara Caroline Mendes Cunha', '@samaracunha1', 'Rotina, saúde mental', 'Sudeste', 'ativo', 0, 0),
  ('Guilherme Henrique', '@odontobygui', 'Lifestyle, saúde, odontologia', 'Sudeste', 'ativo', 0, 6),
  ('Eduardo Picanco', '@eduardopicanco', 'Business', 'Sudeste', 'ativo', 0, 0),
  ('Rebeca Lima', '@rebecalima.oficioal', NULL, 'Centro Oeste', 'ativo', 0, 0),
  ('Mariana Fuchs Paulo', '@marifuchs.p', 'lifestyle', 'Sul', 'ativo', 0, 1),
  ('Anita Guilherme', '@odontoanitacarv', 'Lifestyle e odontologia', 'Nordeste', 'ativo', 0, 0),
  ('Yasmin Catherine da Silva', '@fisioyasmincath', 'rotina e profissional', 'Sul', 'ativo', 0, 0),
  ('Antonia Silveira', '@antoniavsilveira', 'lifestyle', 'Sul', 'ativo', 0, 0),
  ('Ester García Amaral', '@dra.esteramaral', 'estudantes, dentista e profissionais da saúde', 'Sudeste', 'ativo', 0, 0),
  ('Suzana Perezin', '@dra.suzanaperezin', NULL, 'Sul', 'ativo', 0, 0)
) AS seed(nome, instagram, nicho, regiao, status, seguidores, usos_cupom)
WHERE NOT EXISTS (SELECT 1 FROM influenciadores);

SELECT 'Tabela influenciadores criada ·' AS status, COUNT(*) AS total FROM influenciadores;
