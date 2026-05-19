-- ══════════════════════════════════════════════════════════════
-- ranking_geral_periodo — faturamento/pedidos por vendedor num
-- PERÍODO (pro filtro da aba "Geral" do C360). Atribuição idêntica
-- ao resto do sistema: override manual (cliente_vendedor_manual)
-- vence; senão vendedor Bling do pedido (vendedor_mapping ativo).
-- p_dias <= 0  → desde sempre (equivale ao total da view).
-- ══════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS ranking_geral_periodo(text, int);
CREATE OR REPLACE FUNCTION ranking_geral_periodo(
  p_empresa text DEFAULT 'todas', p_dias int DEFAULT 0)
RETURNS TABLE (vendedor_profile_id uuid, vendedor_nome text,
               pedidos bigint, faturamento numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ped AS (
    SELECT p.empresa, p.total, p.vendedor_id, p.contato_nome
    FROM pedidos p
    WHERE p.situacao_id <> 12
      AND (p_empresa = 'todas' OR p.empresa = p_empresa)
      AND (p_dias <= 0 OR p.data >= (CURRENT_DATE - p_dias))
  ),
  attr AS (
    SELECT pd.total,
           COALESCE(m.profile_id, vm.profile_id) AS profile_id
    FROM ped pd
    LEFT JOIN contatos c
      ON c.nome = pd.contato_nome AND c.empresa = pd.empresa
    LEFT JOIN cliente_vendedor_manual m
      ON m.contato_id = c.id AND m.empresa = pd.empresa
    LEFT JOIN vendedor_mapping vm
      ON vm.bling_vendedor_id = pd.vendedor_id
     AND vm.empresa = pd.empresa AND vm.ativo = true
  )
  SELECT a.profile_id, pr.nome,
         COUNT(*)::bigint, ROUND(COALESCE(SUM(a.total),0),2)
  FROM attr a
  JOIN profiles pr ON pr.id = a.profile_id
  WHERE a.profile_id IS NOT NULL
    AND a.profile_id NOT IN (
      SELECT profile_id FROM vendedor_mapping
      WHERE excluir_ranking = true AND profile_id IS NOT NULL)
  GROUP BY a.profile_id, pr.nome
  ORDER BY 4 DESC;
$$;
GRANT EXECUTE ON FUNCTION ranking_geral_periodo(text,int) TO authenticated;

-- Diagnóstico: 90 dias, todas
SELECT vendedor_nome, pedidos, faturamento
FROM ranking_geral_periodo('todas', 90) LIMIT 8;
