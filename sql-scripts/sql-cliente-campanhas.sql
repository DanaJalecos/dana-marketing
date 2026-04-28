-- ══════════════════════════════════════════════════════════
-- CLIENTE 360 · Fase 6: Campanhas
-- 2 tabelas: cliente_campanhas (master) + cliente_campanha_envios (tracking)
-- Integração com cliente_segmentos_custom + canais_aquisicao do DMS
-- ══════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────
-- 1) TABELA MASTER: cliente_campanhas
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cliente_campanhas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa TEXT NOT NULL CHECK (empresa IN ('matriz','bc','ambas')) DEFAULT 'matriz',
  nome TEXT NOT NULL,
  descricao TEXT,

  -- Segmento-alvo (pode ser automático RFM ou custom)
  segmento_tipo TEXT NOT NULL CHECK (segmento_tipo IN ('auto','custom')) DEFAULT 'auto',
  segmento_id BIGINT REFERENCES cliente_segmentos_custom(id) ON DELETE SET NULL,
  segmento_nome_cache TEXT,                 -- 'VIP', 'Frequente' ou nome do custom

  -- Canal de envio
  canal TEXT NOT NULL CHECK (canal IN ('whatsapp','email','sms','outro')) DEFAULT 'whatsapp',
  canal_aquisicao_id UUID REFERENCES canais_aquisicao(id) ON DELETE SET NULL,  -- vínculo com DMS

  -- Mensagem / conteúdo
  mensagem TEXT,                            -- template com {{nome}}, {{cupom}}, {{cidade}}
  cupom_codigo TEXT,                        -- opcional — populado em {{cupom}}
  link_cta TEXT,                            -- link da oferta

  -- Agendamento / status
  data_envio TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('rascunho','agendada','enviada','concluida','cancelada')) DEFAULT 'rascunho',

  -- Métricas (atualizadas por trigger ou manualmente)
  total_alvo INT DEFAULT 0,
  total_enviados INT DEFAULT 0,
  total_respondidos INT DEFAULT 0,
  total_falhados INT DEFAULT 0,

  observacoes TEXT,
  criado_por UUID,
  criado_por_nome TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campanhas_empresa ON cliente_campanhas(empresa);
CREATE INDEX IF NOT EXISTS idx_campanhas_status ON cliente_campanhas(status);
CREATE INDEX IF NOT EXISTS idx_campanhas_created ON cliente_campanhas(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campanhas_canal_aq ON cliente_campanhas(canal_aquisicao_id);

-- ──────────────────────────────────────────────────────────
-- 2) TABELA FILHA: cliente_campanha_envios (tracking por cliente)
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cliente_campanha_envios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id UUID NOT NULL REFERENCES cliente_campanhas(id) ON DELETE CASCADE,
  empresa TEXT NOT NULL CHECK (empresa IN ('matriz','bc')) DEFAULT 'matriz',

  -- Dados do cliente (snapshot — não vira órfão se contato sumir)
  contato_id BIGINT,                        -- opcional, FK lógica pra contatos
  contato_nome TEXT NOT NULL,
  contato_telefone TEXT,
  contato_celular TEXT,
  contato_email TEXT,
  contato_cidade TEXT,
  contato_uf TEXT,

  -- Status do envio
  status TEXT NOT NULL CHECK (status IN ('pendente','enviado','entregue','lido','respondido','falhou')) DEFAULT 'pendente',
  enviado_em TIMESTAMPTZ,
  respondido_em TIMESTAMPTZ,
  resposta_texto TEXT,
  erro TEXT,

  -- Mensagem renderizada (com placeholders substituídos)
  mensagem_renderizada TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_envios_campanha ON cliente_campanha_envios(campanha_id);
CREATE INDEX IF NOT EXISTS idx_envios_status ON cliente_campanha_envios(status);
CREATE INDEX IF NOT EXISTS idx_envios_empresa ON cliente_campanha_envios(empresa);

-- ──────────────────────────────────────────────────────────
-- 3) Triggers de updated_at
-- ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cliente_campanhas_set_updated()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_campanhas_updated ON cliente_campanhas;
CREATE TRIGGER trg_campanhas_updated BEFORE UPDATE ON cliente_campanhas
  FOR EACH ROW EXECUTE FUNCTION cliente_campanhas_set_updated();

DROP TRIGGER IF EXISTS trg_envios_updated ON cliente_campanha_envios;
CREATE TRIGGER trg_envios_updated BEFORE UPDATE ON cliente_campanha_envios
  FOR EACH ROW EXECUTE FUNCTION cliente_campanhas_set_updated();

-- ──────────────────────────────────────────────────────────
-- 4) Trigger que mantém contadores da campanha atualizados
--    Quando um envio muda de status, recalcula totais na master
-- ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cliente_campanha_recalc_totais()
RETURNS TRIGGER AS $$
DECLARE
  v_camp UUID;
BEGIN
  v_camp := COALESCE(NEW.campanha_id, OLD.campanha_id);
  UPDATE cliente_campanhas SET
    total_enviados     = (SELECT COUNT(*) FROM cliente_campanha_envios WHERE campanha_id = v_camp AND status IN ('enviado','entregue','lido','respondido')),
    total_respondidos  = (SELECT COUNT(*) FROM cliente_campanha_envios WHERE campanha_id = v_camp AND status = 'respondido'),
    total_falhados     = (SELECT COUNT(*) FROM cliente_campanha_envios WHERE campanha_id = v_camp AND status = 'falhou'),
    total_alvo         = (SELECT COUNT(*) FROM cliente_campanha_envios WHERE campanha_id = v_camp)
  WHERE id = v_camp;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_envios_recalc ON cliente_campanha_envios;
CREATE TRIGGER trg_envios_recalc
  AFTER INSERT OR UPDATE OR DELETE ON cliente_campanha_envios
  FOR EACH ROW EXECUTE FUNCTION cliente_campanha_recalc_totais();

-- ──────────────────────────────────────────────────────────
-- 5) RLS · permissão 'cliente360' em cargo_permissoes
-- ──────────────────────────────────────────────────────────
ALTER TABLE cliente_campanhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE cliente_campanha_envios ENABLE ROW LEVEL SECURITY;

-- Helper pra checar permissão cliente360 (reaproveita padrão das outras fases)
CREATE OR REPLACE FUNCTION has_cliente360_perm()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM cargo_permissoes cp
    JOIN profiles p ON p.cargo = cp.cargo
    WHERE p.id = auth.uid()
      AND cp.secao = 'cliente360'
      AND cp.permitido = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- CAMPANHAS: leitura pra quem tem cliente360
DROP POLICY IF EXISTS "campanhas_select" ON cliente_campanhas;
CREATE POLICY "campanhas_select" ON cliente_campanhas FOR SELECT USING (has_cliente360_perm());

DROP POLICY IF EXISTS "campanhas_insert" ON cliente_campanhas;
CREATE POLICY "campanhas_insert" ON cliente_campanhas FOR INSERT WITH CHECK (
  has_cliente360_perm() AND criado_por = auth.uid()
);

DROP POLICY IF EXISTS "campanhas_update" ON cliente_campanhas;
CREATE POLICY "campanhas_update" ON cliente_campanhas FOR UPDATE USING (
  criado_por = auth.uid() OR is_admin()
);

DROP POLICY IF EXISTS "campanhas_delete" ON cliente_campanhas;
CREATE POLICY "campanhas_delete" ON cliente_campanhas FOR DELETE USING (
  criado_por = auth.uid() OR is_admin()
);

-- ENVIOS: mesma lógica, mas tudo permitido pra quem tem cliente360 (são dependentes)
DROP POLICY IF EXISTS "envios_select" ON cliente_campanha_envios;
CREATE POLICY "envios_select" ON cliente_campanha_envios FOR SELECT USING (has_cliente360_perm());

DROP POLICY IF EXISTS "envios_insert" ON cliente_campanha_envios;
CREATE POLICY "envios_insert" ON cliente_campanha_envios FOR INSERT WITH CHECK (has_cliente360_perm());

DROP POLICY IF EXISTS "envios_update" ON cliente_campanha_envios;
CREATE POLICY "envios_update" ON cliente_campanha_envios FOR UPDATE USING (has_cliente360_perm());

DROP POLICY IF EXISTS "envios_delete" ON cliente_campanha_envios;
CREATE POLICY "envios_delete" ON cliente_campanha_envios FOR DELETE USING (has_cliente360_perm());

-- ──────────────────────────────────────────────────────────
-- 6) Realtime
-- ──────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='cliente_campanhas') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cliente_campanhas;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='cliente_campanha_envios') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cliente_campanha_envios;
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────
-- 7) Verificação final
-- ──────────────────────────────────────────────────────────
SELECT 'cliente_campanhas + cliente_campanha_envios criadas ·' AS status,
       (SELECT COUNT(*) FROM cliente_campanhas)        AS total_campanhas,
       (SELECT COUNT(*) FROM cliente_campanha_envios)  AS total_envios;
