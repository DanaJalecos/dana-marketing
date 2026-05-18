-- ══════════════════════════════════════════════════════════════
-- Aniversariantes da Carteira — Fase 1 (schema + RPCs)
--
-- Pedido Manu 14/05/2026:
--   "o sistema identificar os clientes que estão de aniversário
--    conforme o cadastro na carteira de cada consultor, sugerir
--    uma mensagem para envio com cupom de 10% para uso no mês do
--    aniversário e o criativo de aniversário"
--
-- Descoberta: Bling tem `dadosAdicionais.dataNascimento` mas só
-- no endpoint /contatos/{id} (não na lista). Logo precisa de um
-- sync separado contato-a-contato (sync-contatos-detalhes).
--
-- Este script cria:
--   1. Colunas em `contatos` (data_nascimento, sexo, sync_em)
--   2. Tabela `cupons_aniversario` + RLS
--   3. RPC `aniversariantes_do_mes(vendedor_id, mes)` — widget
--   4. RPC `contatos_para_sync_nascimento(modo, limite)` — fila de sync
-- ══════════════════════════════════════════════════════════════

-- ─── 1) ALTER TABLE contatos ───
ALTER TABLE contatos
  ADD COLUMN IF NOT EXISTS data_nascimento DATE,
  ADD COLUMN IF NOT EXISTS sexo TEXT,
  ADD COLUMN IF NOT EXISTS nascimento_sincronizado_em TIMESTAMPTZ;

-- Index pra lookups por data
CREATE INDEX IF NOT EXISTS idx_contatos_data_nasc
  ON contatos (data_nascimento)
  WHERE data_nascimento IS NOT NULL;

-- Index pra filtrar por MÊS (usado pelo widget aniversariantes_do_mes)
CREATE INDEX IF NOT EXISTS idx_contatos_mes_nasc
  ON contatos ((EXTRACT(MONTH FROM data_nascimento)))
  WHERE data_nascimento IS NOT NULL;

-- Index pra fila de sync (WHERE data_nascimento IS NULL)
CREATE INDEX IF NOT EXISTS idx_contatos_sem_nasc
  ON contatos (id)
  WHERE data_nascimento IS NULL AND nascimento_sincronizado_em IS NULL;

-- ─── 2) Tabela cupons_aniversario ───
CREATE TABLE IF NOT EXISTS cupons_aniversario (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo            TEXT NOT NULL UNIQUE,           -- "ANIV-JAQ-12-26"
  contato_id        BIGINT NOT NULL,
  contato_nome      TEXT NOT NULL,
  empresa           TEXT NOT NULL,
  desconto_pct      NUMERIC NOT NULL DEFAULT 10,
  data_emissao      DATE NOT NULL DEFAULT CURRENT_DATE,
  validade_ate      DATE NOT NULL,                  -- último dia do mês de aniv
  -- audit envio
  enviado_em        TIMESTAMPTZ,
  enviado_por       UUID REFERENCES auth.users(id),
  enviado_por_nome  TEXT,
  -- audit resgate (manual quando cliente usar)
  resgatado_em      TIMESTAMPTZ,
  resgatado_por     TEXT,                            -- ex: "Maria balcão"
  resgatado_valor   NUMERIC,                         -- opcional pra acompanhar gasto
  observacao        TEXT,
  status            TEXT NOT NULL DEFAULT 'gerado'  -- gerado|enviado|resgatado|expirado
                    CHECK (status IN ('gerado','enviado','resgatado','expirado')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cupons_contato ON cupons_aniversario (contato_id);
CREATE INDEX IF NOT EXISTS idx_cupons_status_validade ON cupons_aniversario (status, validade_ate);
CREATE INDEX IF NOT EXISTS idx_cupons_created_at ON cupons_aniversario (created_at DESC);

-- RLS
ALTER TABLE cupons_aniversario ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cupons_select_all ON cupons_aniversario;
CREATE POLICY cupons_select_all ON cupons_aniversario
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS cupons_insert_auth ON cupons_aniversario;
CREATE POLICY cupons_insert_auth ON cupons_aniversario
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS cupons_update_owner_admin ON cupons_aniversario;
CREATE POLICY cupons_update_owner_admin ON cupons_aniversario
  FOR UPDATE USING (
    auth.uid() = enviado_por
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND cargo IN ('admin','gerente_comercial','gerente_financeiro')
    )
  );

-- ─── 3) RPC aniversariantes_do_mes ───
-- Lista aniversariantes de UM mês na carteira de UMA vendedora (ou de TODOS).
-- p_vendedor_id NULL = admin/gerente vê tudo
-- p_mes NULL = mês corrente
DROP FUNCTION IF EXISTS aniversariantes_do_mes(UUID, INT);
CREATE OR REPLACE FUNCTION aniversariantes_do_mes(
  p_vendedor_id UUID DEFAULT NULL,
  p_mes INT DEFAULT NULL
)
RETURNS TABLE (
  contato_id BIGINT,
  contato_nome TEXT,
  empresa TEXT,
  data_nascimento DATE,
  dia_aniversario INT,
  dias_ate_aniversario INT,
  telefone TEXT,
  celular TEXT,
  cupom_ja_gerado BOOLEAN,
  cupom_codigo TEXT,
  cupom_status TEXT,
  cupom_enviado_em TIMESTAMPTZ,
  vendedor_profile_id UUID,
  vendedor_nome TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH mes_alvo AS (
    SELECT COALESCE(p_mes, EXTRACT(MONTH FROM CURRENT_DATE)::INT) AS mes
  ),
  base AS (
    SELECT
      c.id AS contato_id,
      c.nome AS contato_nome,
      COALESCE(csv.empresa, c.empresa) AS empresa,
      c.data_nascimento,
      c.telefone,
      c.celular,
      csv.vendedor_profile_id,
      csv.vendedor_nome,
      EXTRACT(DAY FROM c.data_nascimento)::INT AS dia,
      -- dia_no_mes_atual: tenta montar data deste ano no mês alvo
      -- (negativo = passou; 0 = hoje; positivo = futuro)
      (
        make_date(
          EXTRACT(YEAR FROM CURRENT_DATE)::INT,
          (SELECT mes FROM mes_alvo),
          LEAST(EXTRACT(DAY FROM c.data_nascimento)::INT,
                EXTRACT(DAY FROM
                  (date_trunc('month',
                    make_date(EXTRACT(YEAR FROM CURRENT_DATE)::INT,
                              (SELECT mes FROM mes_alvo), 1))
                  + INTERVAL '1 month - 1 day')::date
                )::INT)
        ) - CURRENT_DATE
      )::INT AS dias_ate
    FROM contatos c
    LEFT JOIN cliente_scoring_vendedor csv ON csv.contato_id = c.id
    WHERE c.data_nascimento IS NOT NULL
      AND EXTRACT(MONTH FROM c.data_nascimento) = (SELECT mes FROM mes_alvo)
      AND (
        p_vendedor_id IS NULL
        OR csv.vendedor_profile_id = p_vendedor_id
      )
  )
  SELECT
    b.contato_id,
    b.contato_nome,
    b.empresa,
    b.data_nascimento,
    b.dia,
    b.dias_ate,
    b.telefone,
    b.celular,
    cp.codigo IS NOT NULL AS cupom_ja_gerado,
    cp.codigo AS cupom_codigo,
    cp.status AS cupom_status,
    cp.enviado_em AS cupom_enviado_em,
    b.vendedor_profile_id,
    b.vendedor_nome
  FROM base b
  LEFT JOIN LATERAL (
    SELECT codigo, status, enviado_em
    FROM cupons_aniversario
    WHERE contato_id = b.contato_id
      AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE)
    ORDER BY created_at DESC
    LIMIT 1
  ) cp ON true
  ORDER BY b.dia ASC, b.contato_nome;
$$;

-- ─── 4) RPC contatos_para_sync_nascimento ───
-- Retorna fila priorizada de contatos pra sincronizar dataNascimento
-- modo='carteira' → quem tem vendedor (manual ou Bling via vendedor_mapping)
-- modo='ativos'   → contatos com pedido 12m sem vendedor (FASE 2)
-- modo='todos'    → varredura ampla (background)
--
-- IMPORTANTE: NÃO usa a view cliente_scoring_vendedor (cara demais ~7s timeout).
-- Em vez disso, junta direto contatos + cliente_vendedor_manual + (pedidos JOIN vendedor_mapping).
DROP FUNCTION IF EXISTS contatos_para_sync_nascimento(TEXT, INT);
CREATE OR REPLACE FUNCTION contatos_para_sync_nascimento(
  modo TEXT DEFAULT 'carteira',
  p_limite INT DEFAULT 500
)
RETURNS TABLE (contato_id BIGINT, empresa TEXT, nome TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $func$
  SELECT DISTINCT ON (c.id) c.id, c.empresa, c.nome
  FROM contatos c
  WHERE c.data_nascimento IS NULL
    AND c.nascimento_sincronizado_em IS NULL
    AND (
      modo = 'todos'
      OR (modo = 'carteira' AND (
        EXISTS (SELECT 1 FROM cliente_vendedor_manual mvm WHERE mvm.contato_id = c.id)
        OR EXISTS (
          SELECT 1 FROM pedidos pe
          JOIN vendedor_mapping vm ON vm.bling_vendedor_id = pe.vendedor_id AND vm.ativo
          WHERE pe.contato_nome = c.nome
            AND pe.data >= NOW() - INTERVAL '24 months'
        )
      ))
      OR (modo = 'ativos' AND EXISTS (
        SELECT 1 FROM pedidos pe
        WHERE pe.contato_nome = c.nome
          AND pe.data >= NOW() - INTERVAL '12 months'
          AND pe.situacao_id <> 12
      ))
    )
  ORDER BY c.id
  LIMIT p_limite;
$func$;

-- ─── 5) RPC marcar_cupom_enviado ───
-- Vendedora clica "Marcar como enviado" no widget → updates enviado_em
DROP FUNCTION IF EXISTS marcar_cupom_enviado(UUID);
CREATE OR REPLACE FUNCTION marcar_cupom_enviado(p_cupom_id UUID)
RETURNS TABLE (id UUID, status TEXT, enviado_em TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_nome TEXT;
BEGIN
  -- p.id qualificado: senão "id" colide com o OUT param id (RETURNS TABLE)
  SELECT p.nome INTO v_nome FROM profiles p WHERE p.id = auth.uid();
  UPDATE cupons_aniversario
  SET enviado_em = now(),
      enviado_por = auth.uid(),
      enviado_por_nome = v_nome,
      status = 'enviado'
  WHERE cupons_aniversario.id = p_cupom_id;
  RETURN QUERY
    SELECT c.id, c.status, c.enviado_em
    FROM cupons_aniversario c
    WHERE c.id = p_cupom_id;
END $$;

-- ─── 6) Diagnóstico imediato ───
-- (rodar SEPARADAMENTE depois do primeiro burst — é caro)
-- SELECT
--   (SELECT COUNT(*) FROM contatos WHERE data_nascimento IS NOT NULL) AS com_nascimento,
--   (SELECT COUNT(*) FROM contatos WHERE nascimento_sincronizado_em IS NOT NULL AND data_nascimento IS NULL) AS sincronizados_sem_data,
--   (SELECT COUNT(*) FROM contatos WHERE nascimento_sincronizado_em IS NULL AND data_nascimento IS NULL) AS nao_sincronizados,
--   (SELECT COUNT(*) FROM contatos_para_sync_nascimento('carteira', 5000)) AS fila_fase1_carteira_amostra;
