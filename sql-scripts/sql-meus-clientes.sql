-- ============================================================
-- MEUS CLIENTES (Fase 8 Cliente 360)
-- Cliente pertence ao vendedor. Vendedor ve so a carteira dele.
-- Admin ve tudo + performance.
-- ============================================================

-- 1) Permissao meus_clientes em cargo_permissoes
INSERT INTO cargo_permissoes (cargo, secao, permitido) VALUES
  ('admin', 'meus_clientes', true),
  ('gerente_comercial', 'meus_clientes', true),
  ('gerente_marketing', 'meus_clientes', true),
  ('vendedor', 'meus_clientes', true),
  ('gerente_financeiro', 'meus_clientes', false),
  ('trafego_pago', 'meus_clientes', false),
  ('designer', 'meus_clientes', false),
  ('producao_conteudo', 'meus_clientes', false),
  ('analista_marketplace', 'meus_clientes', false),
  ('expedicao', 'meus_clientes', false)
ON CONFLICT (cargo, secao) DO NOTHING;

-- 2) Mapeamento vendedor Bling -> profile DMS
-- O Bling so expoe bling_vendedor_id (bigint), nomes vem vazios.
-- Admin mapeia manualmente cada bling_id ao profile correspondente.
CREATE TABLE IF NOT EXISTS vendedor_mapping (
  bling_vendedor_id BIGINT NOT NULL,
  empresa TEXT NOT NULL CHECK (empresa IN ('matriz', 'bc')),
  profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  display_name TEXT,
  ativo BOOLEAN DEFAULT true,
  atualizado_em TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (bling_vendedor_id, empresa)
);

CREATE INDEX IF NOT EXISTS idx_vm_profile ON vendedor_mapping(profile_id);

-- 3) Atribuicao manual (override do Bling)
CREATE TABLE IF NOT EXISTS cliente_vendedor_manual (
  contato_id BIGINT NOT NULL,
  empresa TEXT NOT NULL CHECK (empresa IN ('matriz', 'bc')),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  atribuido_por UUID REFERENCES profiles(id),
  atribuido_por_nome TEXT,
  atribuido_em TIMESTAMPTZ DEFAULT now(),
  motivo TEXT,
  PRIMARY KEY (contato_id, empresa)
);

CREATE INDEX IF NOT EXISTS idx_cvm_profile ON cliente_vendedor_manual(profile_id);

-- 4) Historico de reatribuicoes
CREATE TABLE IF NOT EXISTS cliente_vendedor_historico (
  id BIGSERIAL PRIMARY KEY,
  contato_id BIGINT NOT NULL,
  contato_nome TEXT,
  empresa TEXT NOT NULL,
  profile_id_anterior UUID,
  profile_id_novo UUID,
  profile_nome_anterior TEXT,
  profile_nome_novo TEXT,
  fonte_anterior TEXT, -- 'bling' | 'manual' | 'nao_atribuido'
  alterado_por UUID REFERENCES profiles(id),
  alterado_por_nome TEXT,
  alterado_em TIMESTAMPTZ DEFAULT now(),
  motivo TEXT
);

CREATE INDEX IF NOT EXISTS idx_cvh_contato ON cliente_vendedor_historico(contato_id, empresa);
CREATE INDEX IF NOT EXISTS idx_cvh_alterado_em ON cliente_vendedor_historico(alterado_em DESC);

-- 5) View consolidada: para cada cliente retorna o vendedor "dono"
-- Prioridade: atribuicao manual -> vendedor Bling (via mapping) -> nao atribuido
-- Baseada em cliente_scoring_full (que ja tem contato_id)
CREATE OR REPLACE VIEW cliente_scoring_vendedor AS
WITH latest_pedido AS (
  SELECT DISTINCT ON (contato_nome, empresa)
    contato_nome, empresa, vendedor_id
  FROM pedidos
  WHERE vendedor_id IS NOT NULL AND vendedor_id > 0
  ORDER BY contato_nome, empresa, data DESC NULLS LAST
)
SELECT
  csf.*,
  COALESCE(m.profile_id, vm.profile_id) AS vendedor_profile_id,
  COALESCE(p_m.nome, p_vm.nome, vm.display_name) AS vendedor_nome,
  CASE
    WHEN m.profile_id IS NOT NULL THEN 'manual'
    WHEN vm.profile_id IS NOT NULL THEN 'bling'
    ELSE 'nao_atribuido'
  END AS vendedor_fonte,
  lp.vendedor_id AS bling_vendedor_id
FROM cliente_scoring_full csf
LEFT JOIN cliente_vendedor_manual m
  ON m.contato_id = csf.contato_id AND m.empresa = csf.empresa
LEFT JOIN profiles p_m ON p_m.id = m.profile_id
LEFT JOIN latest_pedido lp
  ON lp.contato_nome = csf.contato_nome AND lp.empresa = csf.empresa
LEFT JOIN vendedor_mapping vm
  ON vm.bling_vendedor_id = lp.vendedor_id AND vm.empresa = csf.empresa AND vm.ativo = true
LEFT JOIN profiles p_vm ON p_vm.id = vm.profile_id;

-- 6) RLS das tabelas novas
ALTER TABLE vendedor_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE cliente_vendedor_manual ENABLE ROW LEVEL SECURITY;
ALTER TABLE cliente_vendedor_historico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vm_select ON vendedor_mapping;
DROP POLICY IF EXISTS vm_admin_write ON vendedor_mapping;
DROP POLICY IF EXISTS cvm_select ON cliente_vendedor_manual;
DROP POLICY IF EXISTS cvm_write ON cliente_vendedor_manual;
DROP POLICY IF EXISTS cvh_select ON cliente_vendedor_historico;
DROP POLICY IF EXISTS cvh_insert ON cliente_vendedor_historico;

-- vendedor_mapping: todos logados leem (pra ranking/dashboard). So admin/gerente_comercial escrevem.
CREATE POLICY vm_select ON vendedor_mapping FOR SELECT TO authenticated USING (true);
CREATE POLICY vm_admin_write ON vendedor_mapping FOR ALL TO authenticated
  USING (
    EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo IN ('admin','gerente_comercial'))
  )
  WITH CHECK (
    EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo IN ('admin','gerente_comercial'))
  );

-- cliente_vendedor_manual: SELECT com permissao cliente360, UPDATE/INSERT/DELETE so admin/gerente_comercial
CREATE POLICY cvm_select ON cliente_vendedor_manual FOR SELECT TO authenticated USING (has_cliente360_perm());
CREATE POLICY cvm_write ON cliente_vendedor_manual FOR ALL TO authenticated
  USING (
    EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo IN ('admin','gerente_comercial'))
  )
  WITH CHECK (
    EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo IN ('admin','gerente_comercial'))
  );

-- historico: SELECT por cliente360 perm, INSERT pelos escritores
CREATE POLICY cvh_select ON cliente_vendedor_historico FOR SELECT TO authenticated USING (has_cliente360_perm());
CREATE POLICY cvh_insert ON cliente_vendedor_historico FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo IN ('admin','gerente_comercial'))
  );

-- 7) Realtime pras tabelas novas (ignora se ja estiverem na publicacao)
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE cliente_vendedor_manual; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE vendedor_mapping; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE cliente_vendedor_historico; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- ============================================================
-- Fim da migracao
-- ============================================================
