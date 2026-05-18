-- ══════════════════════════════════════════════════════════════
-- FIX pool "Clientes sem vendedor" + backfill retroativo
--
-- Bug: pool_auto_atribuir bloqueava se o contato tivesse QUALQUER
-- pedido mapeado a um vendedor Bling ativo. Mas a view
-- cliente_scoring_vendedor (que define "sem vendedor" no widget)
-- olha só o ÚLTIMO pedido com vendedor. Resultado: cliente
-- aparecia no pool mas não deixava o vendedor pegar.
--
-- Correção: usar EXATAMENTE a regra da view (último pedido com
-- vendedor → vendedor_mapping ativo → profile_id). Se esse
-- profile for NULL (ou não há pedido com vendedor) = sem dono.
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION pool_auto_atribuir(
  p_contato_id BIGINT, p_empresa TEXT, p_user_id UUID, p_user_nome TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_nome_contato  TEXT;
  v_bling_profile UUID;
BEGIN
  IF p_contato_id IS NULL OR p_user_id IS NULL THEN RETURN; END IF;
  IF COALESCE(p_empresa,'') <> 'matriz' THEN RETURN; END IF;

  -- quem mexeu precisa ser vendedor (admin/gerente não vira "dono")
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = p_user_id AND cargo IN ('vendedor','vendedor_b2b')
  ) THEN RETURN; END IF;

  -- já tem dono manual? (lock — primeiro que pegou fica)
  IF EXISTS (
    SELECT 1 FROM cliente_vendedor_manual
    WHERE contato_id = p_contato_id AND empresa = p_empresa
  ) THEN RETURN; END IF;

  -- já tem vendedor pelo Bling? MESMA regra da view cliente_scoring_vendedor:
  -- olha só o ÚLTIMO pedido com vendedor e vê se mapeia p/ um profile ativo
  SELECT nome INTO v_nome_contato FROM contatos WHERE id = p_contato_id;
  IF v_nome_contato IS NOT NULL THEN
    SELECT vm.profile_id INTO v_bling_profile
    FROM (
      SELECT p.vendedor_id
      FROM pedidos p
      WHERE p.contato_nome = v_nome_contato
        AND p.empresa = p_empresa
        AND p.vendedor_id IS NOT NULL AND p.vendedor_id > 0
      ORDER BY p.data DESC NULLS LAST
      LIMIT 1
    ) lp
    LEFT JOIN vendedor_mapping vm
      ON vm.bling_vendedor_id = lp.vendedor_id
     AND vm.empresa = p_empresa
     AND vm.ativo = true;
    IF v_bling_profile IS NOT NULL THEN RETURN; END IF;  -- tem dono Bling real
  END IF;

  -- assume (primeiro que pega leva)
  INSERT INTO cliente_vendedor_manual
    (contato_id, empresa, profile_id, atribuido_por, atribuido_por_nome, atribuido_em, motivo)
  VALUES
    (p_contato_id, p_empresa, p_user_id, p_user_id, p_user_nome, now(),
     'auto: assumiu ao trabalhar o cliente (pool sem vendedor)')
  ON CONFLICT (contato_id, empresa) DO NOTHING;
END $$;

-- ─── BACKFILL retroativo ───
-- Todo cliente da Matriz que: está sem vendedor (regra da view),
-- sem dono manual, e teve mudança de status por um VENDEDOR →
-- vai pro PRIMEIRO vendedor que mexeu (data mais antiga).
WITH toques AS (
  SELECT DISTINCT ON (h.contato_id)
    h.contato_id, h.empresa, h.mudado_por_id AS profile_id,
    h.mudado_por_nome, h.mudado_em
  FROM cliente_status_historico h
  JOIN profiles pr ON pr.id = h.mudado_por_id
   AND pr.cargo IN ('vendedor','vendedor_b2b')
  WHERE h.empresa = 'matriz'
    AND h.contato_id IS NOT NULL
  ORDER BY h.contato_id, h.mudado_em ASC      -- 1º que mexeu
),
elegiveis AS (
  SELECT t.*
  FROM toques t
  JOIN cliente_scoring_vendedor csv
    ON csv.contato_id = t.contato_id
   AND csv.empresa = t.empresa
   AND csv.vendedor_profile_id IS NULL        -- realmente sem dono (view)
  WHERE NOT EXISTS (
    SELECT 1 FROM cliente_vendedor_manual m
    WHERE m.contato_id = t.contato_id AND m.empresa = t.empresa
  )
)
INSERT INTO cliente_vendedor_manual
  (contato_id, empresa, profile_id, atribuido_por, atribuido_por_nome, atribuido_em, motivo)
SELECT contato_id, empresa, profile_id, profile_id, mudado_por_nome, mudado_em,
       'backfill: 1º vendedor que trabalhou o cliente (pool sem vendedor)'
FROM elegiveis
ON CONFLICT (contato_id, empresa) DO NOTHING;

-- ─── Diagnóstico ───
SELECT
  (SELECT COUNT(*) FROM cliente_vendedor_manual) AS atribuidos_total,
  (SELECT COUNT(*) FROM cliente_vendedor_manual
     WHERE motivo LIKE 'backfill:%') AS backfill_agora,
  (SELECT COUNT(*) FROM cliente_scoring_vendedor
     WHERE empresa='matriz' AND vendedor_profile_id IS NULL) AS pool_restante,
  (SELECT COUNT(*) FROM cliente_vendedor_manual m
     JOIN contatos c ON c.id=m.contato_id WHERE c.nome='Laboratório Lebon') AS lebon_ok;
