-- ══════════════════════════════════════════════════════════
-- Tabela concorrentes — radar de concorrentes da Dana
-- Com link por plataforma (IG, TikTok, YouTube)
-- Botões na UI aparecem conforme link preenchido
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS concorrentes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  link_instagram TEXT,
  link_tiktok TEXT,
  link_youtube TEXT,
  site TEXT,
  seguidores INT,
  plataforma_principal TEXT CHECK (plataforma_principal IN ('instagram','tiktok','youtube','outro')),
  seguidores_atualizado_em TIMESTAMPTZ,
  tag TEXT,                -- ex: 'Líder · 16x maior', 'Premium', 'Próximo'
  observacoes TEXT,
  eh_propria_marca BOOLEAN DEFAULT false,  -- true = a própria Dana (sem comparação)
  criado_por UUID,
  criado_por_nome TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Adicionar coluna se tabela já existe
ALTER TABLE concorrentes ADD COLUMN IF NOT EXISTS eh_propria_marca BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_concorrentes_seguidores ON concorrentes(seguidores DESC NULLS LAST);

CREATE OR REPLACE FUNCTION concorrentes_set_updated()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_concorrentes_updated ON concorrentes;
CREATE TRIGGER trg_concorrentes_updated
  BEFORE UPDATE ON concorrentes
  FOR EACH ROW EXECUTE FUNCTION concorrentes_set_updated();

ALTER TABLE concorrentes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_all_concorrentes" ON concorrentes;
CREATE POLICY "read_all_concorrentes" ON concorrentes FOR SELECT USING (true);

DROP POLICY IF EXISTS "write_all_concorrentes" ON concorrentes;
CREATE POLICY "write_all_concorrentes" ON concorrentes FOR ALL USING (true);

-- Seed inicial: Dana (marca própria) + 4 concorrentes (só insere se vazio)
INSERT INTO concorrentes (nome, link_instagram, site, seguidores, plataforma_principal, tag, observacoes, eh_propria_marca, seguidores_atualizado_em)
SELECT * FROM (VALUES
  ('Dana Jalecos Exclusivos', 'https://instagram.com/danajalecos', 'https://danajalecos.com.br', 63000, 'instagram', 'Você',
    'Fundada em 2016 por Daniela Binhotti Santos. Fábrica + loja em Piçarras SC, loja em Balneário Camboriú SC. 72+ canais de venda no Bling. Diferencial: atendimento consultivo B2B + eventos presenciais.',
    true, now()),
  ('Dra. Cherie', 'https://instagram.com/dra.cherie', 'https://dracherie.com.br', 1000000, 'instagram', 'Líder · 16x maior',
    'Fundada em 2014 por Ana Carolina e Ana Cecilia Navarro (SP). Faturamento ~R$60M. 8 lojas físicas + e-commerce. Lançou linhas "Cherie For Men" e "Cherie For Teams". Expansão acelerada — nova loja em São José dos Campos.',
    false, now()),
  ('Farcoo', 'https://instagram.com/farcoo', 'https://farcoo.com', 263000, 'instagram', 'Premium · 4x maior',
    'Liderada por Barbara Ganzarolli. Posicionamento ultra-premium: "Isso não é um jaleco. É UM FARCOO." Design autoral, bordados à mão, produção própria. 1.296 posts. Coleções femininas e masculinas bem segmentadas.',
    false, now()),
  ('Jalecos Conforto', 'https://instagram.com/jalecosconforto', 'https://jalecosconforto.com.br', 77000, 'instagram', 'Próximo · 1.2x maior',
    'Posicionamento: "Conforto, Praticidade e Elegância." 1.104 posts. Scrubs e pijamas cirúrgicos. Entrega para todo Brasil. Frete fixo e grátis. Blog ativo com conteúdo para veterinários e biomédicos.',
    false, now()),
  ('Grafitte Jalecos', 'https://instagram.com/grafittejalecos', 'https://grafittejalecos.com.br', null, 'instagram', 'E-commerce',
    'Scrubs e jalecos de performance e estilo. E-commerce ativo + Mercado Livre. Público-alvo: estudantes de medicina e profissionais de saúde. Promoções frequentes.',
    false, null)
) AS seed(nome, link_instagram, site, seguidores, plataforma_principal, tag, observacoes, eh_propria_marca, seguidores_atualizado_em)
WHERE NOT EXISTS (SELECT 1 FROM concorrentes);

SELECT 'Tabela concorrentes criada ·' AS status, COUNT(*) AS registros FROM concorrentes;
