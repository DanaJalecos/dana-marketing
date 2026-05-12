-- =============================================================================
-- FASE 2: Inadimplência (view agregada por cliente + índice)
-- =============================================================================
-- contas_receber.empresa existe (validado), simplifica view (sem LATERAL JOIN)
-- =============================================================================

-- 1) View agregada: 1 row por cliente x empresa com dívida em aberto/atrasada
CREATE OR REPLACE VIEW cliente_inadimplencia AS
SELECT
  cr.contato_nome,
  cr.empresa,
  COUNT(*)::INT AS qtd_contas_atrasadas,
  SUM(cr.valor) AS total_atrasado,
  MIN(cr.vencimento) AS vencimento_mais_antigo,
  GREATEST(0, (CURRENT_DATE - MIN(cr.vencimento)::DATE))::INT AS max_dias_atraso,
  STRING_AGG(DISTINCT cr.origem_numero, ', ' ORDER BY cr.origem_numero) AS pedidos_origem
FROM contas_receber cr
WHERE cr.situacao = 3                                -- atrasado
  AND cr.contato_nome IS NOT NULL
  AND cr.contato_nome <> ''
  AND cr.valor > 0
GROUP BY cr.contato_nome, cr.empresa;

COMMENT ON VIEW cliente_inadimplencia IS
  'Agregação de contas_receber em atraso (situacao=3) por cliente. Usado no header do C360 + filtro lista + contexto IA insight.';

GRANT SELECT ON cliente_inadimplencia TO authenticated;

-- 2) Índice parcial pra acelerar filtro (situacao=3 vai ficar pequeno)
CREATE INDEX IF NOT EXISTS idx_contas_receber_inadimplencia
  ON contas_receber(contato_nome, empresa) WHERE situacao = 3;

-- 3) Verificação
--   SELECT COUNT(*) AS clientes_devedores FROM cliente_inadimplencia;
--   SELECT * FROM cliente_inadimplencia ORDER BY total_atrasado DESC LIMIT 5;
