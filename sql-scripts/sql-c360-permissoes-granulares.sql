-- ============================================================
-- PERMISSOES GRANULARES das abas do Cliente 360
-- Cada aba vira uma chave em cargo_permissoes pra controle fino via Admin -> Permissoes
-- ============================================================

-- Abas do C360: dashboard, clientes, segmentacao, campanhas, sincronizacao, configuracoes, logs
-- meus_clientes ja existe (criado em sql-meus-clientes.sql)

-- 1) Seed de defaults
-- admin, gerente_comercial, gerente_marketing: tudo true (nao muda comportamento atual)
-- vendedor: so meus_clientes = true. Tudo mais = false
-- outros cargos: seguem o que ja tinham em cliente360 (true/false)

WITH cargos_lista AS (
  SELECT DISTINCT cargo FROM cargo_permissoes
),
abas AS (
  SELECT unnest(ARRAY[
    'c360_dashboard',
    'c360_clientes',
    'c360_segmentacao',
    'c360_campanhas',
    'c360_sincronizacao',
    'c360_configuracoes',
    'c360_logs'
  ]) AS secao
),
defaults AS (
  SELECT
    c.cargo,
    a.secao,
    CASE
      WHEN c.cargo IN ('admin', 'gerente_comercial', 'gerente_marketing') THEN true
      WHEN c.cargo = 'vendedor' THEN false
      ELSE COALESCE((
        SELECT cp.permitido FROM cargo_permissoes cp
        WHERE cp.cargo = c.cargo AND cp.secao = 'cliente360'
      ), false)
    END AS permitido
  FROM cargos_lista c
  CROSS JOIN abas a
)
INSERT INTO cargo_permissoes (cargo, secao, permitido)
SELECT cargo, secao, permitido FROM defaults
ON CONFLICT (cargo, secao) DO NOTHING;

-- Validacao
-- SELECT cargo, secao, permitido FROM cargo_permissoes WHERE secao LIKE 'c360_%' OR secao = 'meus_clientes' ORDER BY cargo, secao;
