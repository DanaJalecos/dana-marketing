-- ══════════════════════════════════════════════════════════
-- Tabela canais_aquisicao — canais de marketing/tráfego da Dana
-- Suporta cadastro manual agora + integração futura com APIs
-- (Meta Ads / Google Ads / TikTok Ads via external_id + platform)
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS canais_aquisicao (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('pago','organico')),
  investimento_mensal NUMERIC DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('ativo','pausado','inativo')) DEFAULT 'ativo',
  responsavel TEXT,
  link TEXT,
  observacoes TEXT,
  -- Campos pra integração futura com APIs
  external_id TEXT,              -- id da campanha no Meta/Google/TikTok
  external_platform TEXT,        -- 'meta_ads', 'google_ads', 'tiktok_ads', 'manual'
  external_synced_at TIMESTAMPTZ,
  criado_por UUID,
  criado_por_nome TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canais_tipo ON canais_aquisicao(tipo);
CREATE INDEX IF NOT EXISTS idx_canais_status ON canais_aquisicao(status);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION canais_aquisicao_set_updated()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_canais_updated ON canais_aquisicao;
CREATE TRIGGER trg_canais_updated
  BEFORE UPDATE ON canais_aquisicao
  FOR EACH ROW EXECUTE FUNCTION canais_aquisicao_set_updated();

-- RLS liberal (controle no frontend via cargo_permissoes)
ALTER TABLE canais_aquisicao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_all_canais" ON canais_aquisicao;
CREATE POLICY "read_all_canais" ON canais_aquisicao FOR SELECT USING (true);

DROP POLICY IF EXISTS "write_all_canais" ON canais_aquisicao;
CREATE POLICY "write_all_canais" ON canais_aquisicao FOR ALL USING (true);

SELECT 'canais_aquisicao criada com sucesso' AS status;
