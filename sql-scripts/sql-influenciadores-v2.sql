-- ══════════════════════════════════════════════════════════════
-- Influencer OS — FASE 1 (schema + comissão automática + portal)
--
-- Pedido Manu: transformar a listinha de influenciadores num
-- sistema com portal próprio, comissão automática (via mapeamento
-- Bling) e crédito de resgate.
--
-- Decisões Juan 15/05:
--  - Portal dentro do sistema (cargo 'influenciador')
--  - Comissão por nível + override individual
--  - Resgate: sistema gera código CRED-…, admin cadastra no Bling
--
-- Reusa: padrão de agregação do cliente_scoring (pedidos,
-- situacao_id<>12 = não cancelado), vendedor_mapping.
-- ══════════════════════════════════════════════════════════════

-- ─── 1) Expandir tabela influenciadores ───
ALTER TABLE influenciadores
  ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bling_vendedor_id BIGINT,
  ADD COLUMN IF NOT EXISTS empresa TEXT,
  ADD COLUMN IF NOT EXISTS nivel TEXT DEFAULT 'nano',
  ADD COLUMN IF NOT EXISTS comissao_pct_override NUMERIC,
  ADD COLUMN IF NOT EXISTS tiktok TEXT,
  ADD COLUMN IF NOT EXISTS youtube TEXT,
  ADD COLUMN IF NOT EXISTS estado TEXT,
  ADD COLUMN IF NOT EXISTS segmento TEXT,
  ADD COLUMN IF NOT EXISTS media_views INT,
  ADD COLUMN IF NOT EXISTS engajamento_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS tipo_conteudo TEXT,
  ADD COLUMN IF NOT EXISTS publico_predominante TEXT,
  ADD COLUMN IF NOT EXISTS ja_comprou_dana BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS ja_postou_dana BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS responsavel_interno TEXT,
  ADD COLUMN IF NOT EXISTS potencial_embaixador TEXT;

CREATE INDEX IF NOT EXISTS idx_influ_profile ON influenciadores (profile_id) WHERE profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_influ_bling ON influenciadores (bling_vendedor_id, empresa) WHERE bling_vendedor_id IS NOT NULL;

-- ─── 2) Tabela de níveis (% padrão por nível) ───
CREATE TABLE IF NOT EXISTS influenciador_niveis (
  nivel        TEXT PRIMARY KEY,
  comissao_pct NUMERIC NOT NULL,
  label        TEXT NOT NULL,
  ordem        INT NOT NULL DEFAULT 0
);
INSERT INTO influenciador_niveis (nivel, comissao_pct, label, ordem) VALUES
  ('nano',       5,  'Nano Creator', 1),
  ('creator',    8,  'Creator',      2),
  ('embaixador', 10, 'Embaixador',   3),
  ('elite',      15, 'Elite Dana',   4)
ON CONFLICT (nivel) DO UPDATE SET comissao_pct=EXCLUDED.comissao_pct, label=EXCLUDED.label, ordem=EXCLUDED.ordem;

-- ─── 3) Central de Recebidos ───
CREATE TABLE IF NOT EXISTS influenciador_recebidos (
  id              BIGSERIAL PRIMARY KEY,
  influenciador_id UUID NOT NULL REFERENCES influenciadores(id) ON DELETE CASCADE,
  descricao       TEXT NOT NULL,
  custo_real      NUMERIC NOT NULL DEFAULT 0,
  valor_venda     NUMERIC NOT NULL DEFAULT 0,
  frete           NUMERIC NOT NULL DEFAULT 0,
  embalagem       NUMERIC NOT NULL DEFAULT 0,
  campanha        TEXT,
  data            DATE NOT NULL DEFAULT CURRENT_DATE,
  obs             TEXT,
  criado_por      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recebidos_influ ON influenciador_recebidos (influenciador_id);

-- ─── 4) Créditos (ledger de resgate) ───
CREATE TABLE IF NOT EXISTS influenciador_creditos (
  id              BIGSERIAL PRIMARY KEY,
  influenciador_id UUID NOT NULL REFERENCES influenciadores(id) ON DELETE CASCADE,
  codigo          TEXT NOT NULL UNIQUE,
  valor           NUMERIC NOT NULL,
  status          TEXT NOT NULL DEFAULT 'gerado'
                  CHECK (status IN ('gerado','cadastrado_bling','resgatado','expirado','cancelado')),
  gerado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  gerado_por      UUID REFERENCES auth.users(id),
  cadastrado_em   TIMESTAMPTZ,
  cadastrado_por  UUID REFERENCES auth.users(id),
  resgatado_em    TIMESTAMPTZ,
  obs             TEXT
);
CREATE INDEX IF NOT EXISTS idx_creditos_influ ON influenciador_creditos (influenciador_id, status);

-- ─── 5) View: vendas por vendedor Bling (não cancelado) ───
CREATE OR REPLACE VIEW influenciador_vendas AS
SELECT
  p.vendedor_id   AS bling_vendedor_id,
  p.empresa,
  COUNT(*)        AS total_pedidos,
  COALESCE(SUM(p.total), 0)                       AS receita_bruta,
  ROUND(COALESCE(AVG(p.total), 0)::numeric, 2)    AS ticket_medio,
  MAX(p.data)     AS ultima_venda
FROM pedidos p
WHERE p.situacao_id <> 12          -- 12 = cancelado
  AND p.vendedor_id IS NOT NULL
GROUP BY p.vendedor_id, p.empresa;

-- pct efetivo de um influenciador (override > nível > 0)
CREATE OR REPLACE FUNCTION _influ_pct(p_id UUID) RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    i.comissao_pct_override,
    (SELECT n.comissao_pct FROM influenciador_niveis n WHERE n.nivel = i.nivel),
    0
  )
  FROM influenciadores i WHERE i.id = p_id;
$$;

-- ─── 6) RPC painel (admin) — consolida tudo de 1 influenciador ───
DROP FUNCTION IF EXISTS influenciador_painel(UUID);
CREATE OR REPLACE FUNCTION influenciador_painel(p_id UUID)
RETURNS TABLE (
  influenciador_id UUID, nome TEXT, nivel TEXT, comissao_pct NUMERIC,
  total_pedidos BIGINT, receita_bruta NUMERIC, ticket_medio NUMERIC,
  comissao_devida NUMERIC, recebidos_total NUMERIC,
  creditos_gerados NUMERIC, saldo_disponivel NUMERIC,
  vendas_manual NUMERIC, receita_manual NUMERIC, tem_mapeamento BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    i.id, i.nome, i.nivel, _influ_pct(i.id) AS comissao_pct,
    COALESCE(v.total_pedidos, 0)::bigint AS total_pedidos,
    COALESCE(v.receita_bruta, 0),
    COALESCE(v.ticket_medio, 0),
    ROUND(COALESCE(v.receita_bruta, 0) * _influ_pct(i.id) / 100.0, 2) AS comissao_devida,
    COALESCE((SELECT SUM(custo_real+frete+embalagem) FROM influenciador_recebidos r WHERE r.influenciador_id=i.id), 0) AS recebidos_total,
    COALESCE((SELECT SUM(valor) FROM influenciador_creditos c WHERE c.influenciador_id=i.id AND c.status <> 'cancelado'), 0) AS creditos_gerados,
    GREATEST(
      ROUND(COALESCE(v.receita_bruta, 0) * _influ_pct(i.id) / 100.0, 2)
      - COALESCE((SELECT SUM(valor) FROM influenciador_creditos c WHERE c.influenciador_id=i.id AND c.status <> 'cancelado'), 0)
    , 0) AS saldo_disponivel,
    COALESCE(i.vendas_geradas, 0)::numeric, COALESCE(i.receita, 0),
    (i.bling_vendedor_id IS NOT NULL) AS tem_mapeamento
  FROM influenciadores i
  LEFT JOIN influenciador_vendas v
    ON v.bling_vendedor_id = i.bling_vendedor_id AND v.empresa = i.empresa
  WHERE i.id = p_id;
$$;

-- ─── 7) RPC portal — o influenciador logado vê só o DELE ───
DROP FUNCTION IF EXISTS influenciador_meu_painel();
CREATE OR REPLACE FUNCTION influenciador_meu_painel()
RETURNS TABLE (
  influenciador_id UUID, nome TEXT, nivel TEXT, nivel_label TEXT,
  comissao_pct NUMERIC, seguidores INT, engajamento_pct NUMERIC,
  total_pedidos BIGINT, receita_bruta NUMERIC,
  comissao_devida NUMERIC, creditos_gerados NUMERIC, saldo_disponivel NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    pn.influenciador_id, pn.nome, pn.nivel,
    (SELECT label FROM influenciador_niveis WHERE nivel = pn.nivel),
    pn.comissao_pct, i.seguidores, i.engajamento_pct,
    pn.total_pedidos, pn.receita_bruta,
    pn.comissao_devida, pn.creditos_gerados, pn.saldo_disponivel
  FROM influenciadores i
  CROSS JOIN LATERAL influenciador_painel(i.id) pn
  WHERE i.profile_id = auth.uid()
  LIMIT 1;
$$;

-- ─── 8) RLS ───
ALTER TABLE influenciador_recebidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE influenciador_creditos  ENABLE ROW LEVEL SECURITY;
ALTER TABLE influenciador_niveis    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS niveis_read ON influenciador_niveis;
CREATE POLICY niveis_read ON influenciador_niveis FOR SELECT TO authenticated USING (true);

-- helper: é admin/gerente?
-- (usa profiles.cargo)
DROP POLICY IF EXISTS recebidos_rw ON influenciador_recebidos;
CREATE POLICY recebidos_rw ON influenciador_recebidos FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id=auth.uid() AND cargo IN ('admin','gerente_comercial','gerente_marketing'))
    OR EXISTS (SELECT 1 FROM influenciadores i WHERE i.id=influenciador_id AND i.profile_id=auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id=auth.uid() AND cargo IN ('admin','gerente_comercial','gerente_marketing'))
  );

DROP POLICY IF EXISTS creditos_read ON influenciador_creditos;
CREATE POLICY creditos_read ON influenciador_creditos FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id=auth.uid() AND cargo IN ('admin','gerente_comercial','gerente_marketing'))
    OR EXISTS (SELECT 1 FROM influenciadores i WHERE i.id=influenciador_id AND i.profile_id=auth.uid())
  );
DROP POLICY IF EXISTS creditos_write_admin ON influenciador_creditos;
CREATE POLICY creditos_write_admin ON influenciador_creditos FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id=auth.uid() AND cargo IN ('admin','gerente_comercial','gerente_marketing')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id=auth.uid() AND cargo IN ('admin','gerente_comercial','gerente_marketing')));

-- ─── 9) Cargo 'influenciador' nas permissões (tudo false + portal) ───
INSERT INTO cargo_permissoes (cargo, secao, permitido)
SELECT 'influenciador', secao, false
FROM (SELECT DISTINCT secao FROM cargo_permissoes) s
ON CONFLICT (cargo, secao) DO NOTHING;
INSERT INTO cargo_permissoes (cargo, secao, permitido)
VALUES ('influenciador', 'portal_influenciador', true)
ON CONFLICT (cargo, secao) DO UPDATE SET permitido = true;

-- ─── Diagnóstico ───
SELECT
  (SELECT COUNT(*) FROM influenciador_niveis) AS niveis,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='influenciadores' AND column_name IN ('profile_id','bling_vendedor_id','nivel','comissao_pct_override')) AS cols_novas,
  (SELECT COUNT(*) FROM cargo_permissoes WHERE cargo='influenciador' AND secao='portal_influenciador' AND permitido) AS portal_ok;
