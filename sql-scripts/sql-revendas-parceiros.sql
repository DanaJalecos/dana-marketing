-- ══════════════════════════════════════════════════════════
-- Tabela revendas_parceiros — mapeia contatos Bling → revendas/parcerias
-- Rodar no SQL Editor do Supabase
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS revendas_parceiros (
  id SERIAL PRIMARY KEY,
  contato_id BIGINT REFERENCES contatos(id) ON DELETE SET NULL,
  categoria TEXT NOT NULL CHECK (categoria IN ('nacional','internacional_parceria')),
  label_exibicao TEXT NOT NULL,
  local_ou_tipo TEXT,
  ordem INT DEFAULT 0,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_revendas_categoria_ordem ON revendas_parceiros(categoria, ordem);

-- RLS
ALTER TABLE revendas_parceiros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_all_revendas" ON revendas_parceiros;
CREATE POLICY "read_all_revendas" ON revendas_parceiros FOR SELECT USING (true);

DROP POLICY IF EXISTS "admin_write_revendas" ON revendas_parceiros;
CREATE POLICY "admin_write_revendas" ON revendas_parceiros FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo = 'admin')
);

-- Limpar antes de repopular (idempotente)
TRUNCATE revendas_parceiros RESTART IDENTITY;

-- ── NACIONAIS (8) ──
INSERT INTO revendas_parceiros (contato_id, categoria, label_exibicao, local_ou_tipo, ordem) VALUES
(15864000513, 'nacional', 'Jalecos Bauru',         'Bauru, SP',        1),
(15874878285, 'nacional', 'Nossa Dental',          'Imperatriz, MA',   2),
(16059052871, 'nacional', 'Doctor Scan',           'Cuiabá, MT',       3),
(16165038384, 'nacional', 'Fatel',                 'Londrina, PR',     4),
(15920612400, 'nacional', 'Meus Jalecos',          'Palmas, TO',       5),
(17321065177, 'nacional', 'Revenda Mafra — Susan', 'Mafra, SC',        6),
(17592492257, 'nacional', 'Revenda Porto Velho',   'Porto Velho, RO',  7),
(16103808060, 'nacional', 'Marize',                'Petrolândia, PE',  8);

-- ── INTERNACIONAIS + PARCERIAS (15) ──
INSERT INTO revendas_parceiros (contato_id, categoria, label_exibicao, local_ou_tipo, ordem) VALUES
(15860649950, 'internacional_parceria', 'Izaya Comércio Inter',                 'Revenda Moçambique',       1),
(15860650822, 'internacional_parceria', 'Espreso Dental',                       'Revenda Costa Rica',       2),
(4771598066,  'internacional_parceria', 'Dental/Quantity Original',             'Parceira Daniela Binhotti', 3),
(11839264608, 'internacional_parceria', 'Dental/Quantity Parcial',              'Parceira',                 4),
(15628051498, 'internacional_parceria', 'IOA Joinville — Dina',                 'Parceira regional',        5),
(10170847133, 'internacional_parceria', 'IOA Joinville — Dr. Paulo',            'Parceira regional',        6),
(6695820195,  'internacional_parceria', 'IOA Joinville — Tiago',                'Parceira regional',        7),
(15888079330, 'internacional_parceria', 'IOA Joinville — Patrocinio',           'Parceira regional',        8),
(15983169449, 'internacional_parceria', 'Paulo Kano — Marina',                  'Parceria odonto',          9),
(16924999018, 'internacional_parceria', 'Lype Depyl',                           'Parceiro (desconto 20%)', 10),
(16938836818, 'internacional_parceria', 'Lype Depyl — Depilação a Laser LTDA',  'Parceiro (desconto 20%)', 11),
(17950396968, 'internacional_parceria', 'Lype Depyl — Capão da Canoa',          'Parceiro (desconto 20%)', 12),
(16939054111, 'internacional_parceria', 'Lype Depyl — Governador Valadares',    'Parceiro (desconto 20%)', 13),
(17310318181, 'internacional_parceria', 'Lype Depyl — Indaial',                 'Parceiro (desconto 20%)', 14),
(17083633473, 'internacional_parceria', 'Lype Depyl — Manaus',                  'Parceiro (desconto 20%)', 15);

-- Verificação rápida
SELECT categoria, COUNT(*) as total
FROM revendas_parceiros
GROUP BY categoria;
-- Esperado: nacional=8, internacional_parceria=15
