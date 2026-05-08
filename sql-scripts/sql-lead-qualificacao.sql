-- ═══════════════════════════════════════════════════════════════════════════
-- LEAD QUALIFICACAO IA — 6 pilares (Dor / Perfil / Budget / Urgencia / Timing / Objecao)
-- Pedido da Manu: "criar dentro da aba comercial uma seção de qualificação do lead"
-- Implementacao: Prospeccao (botao no card Kanban + Lista)
-- ═══════════════════════════════════════════════════════════════════════════
-- Tabela historica: cada qualificacao gera nova row (igual cliente_insights),
-- pra ver evolucao do lead ao longo do tempo.
--
-- Edge function qualificar-lead chama IA (cascade Groq Llama 3.3 → Gemini 2.5)
-- com prompt restrito aos 6 pilares + anti-alucinacao. Confianca calculada
-- DETERMINISTICAMENTE pelo backend (50% + 5%/sinal disponivel) — IA nao
-- inventa confianca, fica transparente pra vendedora julgar.
--
-- Quotas reusam cliente_insights_config (mesma config de kill-switch R$30/mes)
-- mas limite_diario_vendedor=3 conforme decidido pelo user.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Tabela historica
CREATE TABLE IF NOT EXISTS lead_qualificacao (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID,                       -- FK logico pra prospects (sem constraint pra performance)
  contato_nome TEXT,                      -- pra clientes do Bling no futuro
  empresa TEXT,                           -- 'matriz' | 'bc' | NULL pra leads sem empresa
  -- Os 6 pilares (TEXT pra dar liberdade a IA, mas regex no edge garante formato)
  dor TEXT,
  perfil TEXT,
  budget TEXT,                            -- formato 'NIVEL · faixa' ex: 'Médio · R$ 200-400/peça'
  urgencia TEXT,                          -- formato 'NIVEL · descrição' ex: 'Alta · até 7 dias'
  timing TEXT,                            -- formato '🔍 Etapa · descrição'
  objecoes JSONB,                         -- array de strings ['Frete alto', 'Prazo de entrega']
  -- Score + acao
  lead_score INT NOT NULL CHECK (lead_score BETWEEN 0 AND 100),
  acao_recomendada TEXT,
  confianca_pct INT NOT NULL CHECK (confianca_pct BETWEEN 0 AND 100),
  -- Audit
  fontes_analisadas JSONB,                -- {tem_mensagem_ia: true, tem_pedidos: false, ...}
  contexto_resumido_json JSONB,           -- snapshot do contexto enviado pra IA (audit + debug)
  -- IA metadata
  modelo TEXT,
  modelo_provider TEXT,                   -- 'groq' | 'gemini' | 'fallback_deterministico'
  custo_estimado NUMERIC(6,4) DEFAULT 0,
  -- Quem gerou
  user_id UUID,
  user_nome TEXT,
  cargo_autor TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_qual_prospect    ON lead_qualificacao(prospect_id, created_at DESC) WHERE prospect_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_qual_contato     ON lead_qualificacao(contato_nome, created_at DESC) WHERE contato_nome IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_qual_user        ON lead_qualificacao(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_qual_score       ON lead_qualificacao(lead_score DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_qual_created     ON lead_qualificacao(created_at DESC);

-- 2) View: ultima qualificacao de cada prospect (mais recente)
CREATE OR REPLACE VIEW lead_qualificacao_atual AS
SELECT DISTINCT ON (prospect_id)
  prospect_id, lead_score, confianca_pct, acao_recomendada,
  dor, perfil, budget, urgencia, timing, objecoes,
  user_nome, modelo_provider, created_at
FROM lead_qualificacao
WHERE prospect_id IS NOT NULL
ORDER BY prospect_id, created_at DESC;

-- 3) RPC: contagem de qualificacoes hoje pelo user (timezone São Paulo)
CREATE OR REPLACE FUNCTION lead_qualificacao_count_hoje(uid UUID)
RETURNS INT
LANGUAGE SQL STABLE SECURITY DEFINER
AS $$
  SELECT COUNT(*)::INT
  FROM lead_qualificacao
  WHERE user_id = uid
    AND (created_at AT TIME ZONE 'America/Sao_Paulo')::DATE
        = (NOW() AT TIME ZONE 'America/Sao_Paulo')::DATE
$$;

-- 4) RPC: gasto mensal (kill-switch compartilhado com cliente_insights)
CREATE OR REPLACE FUNCTION lead_qualificacao_gasto_mes()
RETURNS NUMERIC
LANGUAGE SQL STABLE SECURITY DEFINER
AS $$
  SELECT COALESCE(SUM(custo_estimado), 0)::NUMERIC
  FROM lead_qualificacao
  WHERE date_trunc('month', created_at AT TIME ZONE 'America/Sao_Paulo')
      = date_trunc('month', NOW() AT TIME ZONE 'America/Sao_Paulo')
$$;

-- 5) RLS: leitura pros 5 cargos do Analytics IA + vendedoras (porque elas usam pra qualificar próprios leads)
--    INSERT só via service_role (edge function)
ALTER TABLE lead_qualificacao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_qual_select ON lead_qualificacao;
DROP POLICY IF EXISTS lead_qual_admin ON lead_qualificacao;

-- Vendedora vê só qualificações de prospects que ela criou (RLS escopada)
-- Demais cargos veem tudo
CREATE POLICY lead_qual_select ON lead_qualificacao FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid()
    AND cargo IN ('admin','gerente_marketing','gerente_comercial','trafego_pago','producao_conteudo')
  )
  OR
  -- Vendedora vê só qualificações dos seus próprios leads
  (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo = 'vendedor')
    AND prospect_id IN (
      SELECT id FROM prospects WHERE criado_por = auth.uid()
    )
  )
);

CREATE POLICY lead_qual_admin ON lead_qualificacao FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo = 'admin'));

-- 6) Garantir que cliente_insights_config tem campo limite_diario_vendedor
--    (pode já existir; ALTER ... ADD COLUMN IF NOT EXISTS é PG 9.6+)
ALTER TABLE cliente_insights_config
  ADD COLUMN IF NOT EXISTS limite_diario_vendedor INT NOT NULL DEFAULT 3;

-- ═══════════════════════════════════════════════════════════════════════════
-- Validação
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'lead_qualificacao' AS tabela, COUNT(*) FROM lead_qualificacao
UNION ALL
SELECT 'view_atual',                  COUNT(*) FROM lead_qualificacao_atual
UNION ALL
SELECT 'count_hoje_test',             lead_qualificacao_count_hoje('00000000-0000-0000-0000-000000000000'::UUID)::TEXT::INT
UNION ALL
SELECT 'limite_vendedor_default',     limite_diario_vendedor FROM cliente_insights_config WHERE id = 1;

-- Pra reverter:
--   DROP TABLE IF EXISTS lead_qualificacao CASCADE;
--   DROP FUNCTION IF EXISTS lead_qualificacao_count_hoje(UUID), lead_qualificacao_gasto_mes();
--   ALTER TABLE cliente_insights_config DROP COLUMN IF EXISTS limite_diario_vendedor;
-- ═══════════════════════════════════════════════════════════════════════════
