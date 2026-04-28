-- ============================================================
-- MEUS CLIENTES — Fase 2
-- 1. clientes_manuais: prospects cadastrados no DMS (fora do Bling)
-- 2. cliente_metadata: overrides em clientes Bling (status, tel alt)
-- ============================================================

-- ==============
-- CLIENTES_MANUAIS
-- ==============
CREATE TABLE IF NOT EXISTS clientes_manuais (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  telefone TEXT,
  email TEXT,
  documento TEXT, -- CNPJ ou CPF
  cidade TEXT,
  uf TEXT,
  empresa TEXT NOT NULL CHECK (empresa IN ('matriz', 'bc')),
  profile_id_vendedor UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  observacao TEXT,
  status_relacionamento TEXT DEFAULT 'novo', -- novo, contatado, negociando, comprou, perdido, sem_interesse
  criado_por UUID REFERENCES profiles(id),
  criado_por_nome TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cm_vendedor ON clientes_manuais(profile_id_vendedor);
CREATE INDEX IF NOT EXISTS idx_cm_empresa ON clientes_manuais(empresa);
CREATE INDEX IF NOT EXISTS idx_cm_nome ON clientes_manuais(nome);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION clientes_manuais_update_ts() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cm_updated_at ON clientes_manuais;
CREATE TRIGGER trg_cm_updated_at BEFORE UPDATE ON clientes_manuais
  FOR EACH ROW EXECUTE FUNCTION clientes_manuais_update_ts();

ALTER TABLE clientes_manuais REPLICA IDENTITY FULL;

-- RLS
ALTER TABLE clientes_manuais ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cm_select ON clientes_manuais;
DROP POLICY IF EXISTS cm_insert ON clientes_manuais;
DROP POLICY IF EXISTS cm_update ON clientes_manuais;
DROP POLICY IF EXISTS cm_delete ON clientes_manuais;

-- SELECT: vendedor ve os seus, admin/gerente_comercial/gerente_marketing veem todos
CREATE POLICY cm_select ON clientes_manuais FOR SELECT TO authenticated
  USING (
    has_cliente360_perm() AND (
      EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo IN ('admin','gerente_comercial','gerente_marketing'))
      OR profile_id_vendedor = auth.uid()
    )
  );

-- INSERT: precisa perm cliente360 e só pode criar pra si mesmo (vendedor) ou qualquer (admin/gerente)
CREATE POLICY cm_insert ON clientes_manuais FOR INSERT TO authenticated
  WITH CHECK (
    has_cliente360_perm() AND (
      EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo IN ('admin','gerente_comercial','gerente_marketing'))
      OR profile_id_vendedor = auth.uid()
    )
  );

-- UPDATE: vendedor atualiza os seus, admin/gerente qualquer
CREATE POLICY cm_update ON clientes_manuais FOR UPDATE TO authenticated
  USING (
    has_cliente360_perm() AND (
      EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo IN ('admin','gerente_comercial','gerente_marketing'))
      OR profile_id_vendedor = auth.uid()
    )
  )
  WITH CHECK (
    has_cliente360_perm() AND (
      EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo IN ('admin','gerente_comercial','gerente_marketing'))
      OR profile_id_vendedor = auth.uid()
    )
  );

-- DELETE: vendedor apaga os seus, admin/gerente_comercial qualquer
CREATE POLICY cm_delete ON clientes_manuais FOR DELETE TO authenticated
  USING (
    EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo IN ('admin','gerente_comercial'))
    OR (has_cliente360_perm() AND profile_id_vendedor = auth.uid())
  );

-- ==============
-- CLIENTE_METADATA (overrides em clientes Bling)
-- ==============
CREATE TABLE IF NOT EXISTS cliente_metadata (
  contato_id BIGINT NOT NULL,
  empresa TEXT NOT NULL CHECK (empresa IN ('matriz', 'bc')),
  status_relacionamento TEXT DEFAULT 'novo', -- novo, contatado, negociando, comprou, perdido, sem_interesse
  telefone_alternativo TEXT,
  observacao_rapida TEXT,
  atualizado_por UUID REFERENCES profiles(id),
  atualizado_por_nome TEXT,
  atualizado_em TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (contato_id, empresa)
);

CREATE INDEX IF NOT EXISTS idx_cmeta_status ON cliente_metadata(status_relacionamento);

ALTER TABLE cliente_metadata REPLICA IDENTITY FULL;

-- RLS
ALTER TABLE cliente_metadata ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cmeta_select ON cliente_metadata;
DROP POLICY IF EXISTS cmeta_write ON cliente_metadata;

CREATE POLICY cmeta_select ON cliente_metadata FOR SELECT TO authenticated
  USING (has_cliente360_perm());

-- INSERT/UPDATE/DELETE: autor ou admin/gerente
CREATE POLICY cmeta_write ON cliente_metadata FOR ALL TO authenticated
  USING (has_cliente360_perm())
  WITH CHECK (has_cliente360_perm());

-- Realtime
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE clientes_manuais; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE cliente_metadata; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
