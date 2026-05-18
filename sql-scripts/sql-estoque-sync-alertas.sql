-- ══════════════════════════════════════════════════════════════
-- estoque_sync_alertas() — faz os alertas de estoque ESPELHAREM
-- os dados reais (não depender de cron/sync ter rodado).
--
-- Antes: seção mostrava só produtos que já tinham alerta gerado
-- (~733), faltando ~centenas que vendem e estão baixos.
--
-- Agora (idempotente, roda ao abrir a seção):
--  1) cria alerta p/ TODO produto que VENDE (velocidade 90d > 0)
--     e está com estoque <= 5 e ainda não tem alerta aberto;
--  2) RESOLVE automaticamente alertas cujo produto reabasteceu
--     (estoque > 5) ou parou de vender → some da lista sozinho.
--
-- Mantém 100% a UX existente (ignorar/resolver/resolvidos/KPIs
-- continuam via alertas — só que agora completos e em dia).
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION estoque_sync_alertas()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_criados INT := 0; v_resolvidos INT := 0;
BEGIN
  -- 1) Cria alertas faltantes (produto vende + estoque baixo + sem alerta aberto)
  WITH base AS (
    SELECT p.id, p.codigo, p.nome, p.empresa, p.estoque_virtual
    FROM produtos p
    JOIN produtos_velocidade_90d v ON v.produto_id = p.id
    WHERE COALESCE(p.estoque_virtual, 0) <= 5
      AND COALESCE(v.qtd_vendida_90d, 0) > 0
      AND NOT EXISTS (
        SELECT 1 FROM alertas a
        WHERE a.tipo = 'estoque_baixo'
          AND a.resolvido_em IS NULL
          AND (a.dados->>'produto_id')::bigint = p.id
      )
  ),
  ins AS (
    INSERT INTO alertas (tipo, nivel, titulo, mensagem, audiencia, dados)
    SELECT
      'estoque_baixo',
      CASE WHEN COALESCE(b.estoque_virtual,0) < 3 THEN 'urgent' ELSE 'warn' END,
      b.nome || ' com estoque baixo (' || COALESCE(b.estoque_virtual,0) || ' un.)',
      'Produto: ' || COALESCE(b.codigo,'—') || ' — considere reabastecer',
      'estoque_silencioso',
      jsonb_build_object('empresa', b.empresa, 'estoque', COALESCE(b.estoque_virtual,0), 'produto_id', b.id)
    FROM base b
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_criados FROM ins;

  -- 2) Auto-resolve: produto reabasteceu (>5) ou não vende mais
  WITH alvo AS (
    SELECT a.id
    FROM alertas a
    JOIN produtos p ON p.id = (a.dados->>'produto_id')::bigint
    LEFT JOIN produtos_velocidade_90d v ON v.produto_id = p.id
    WHERE a.tipo = 'estoque_baixo'
      AND a.resolvido_em IS NULL
      AND (
        COALESCE(p.estoque_virtual,0) > 5
        OR COALESCE(v.qtd_vendida_90d,0) = 0
      )
  ),
  upd AS (
    UPDATE alertas SET resolvido_em = now()
    WHERE id IN (SELECT id FROM alvo)
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_resolvidos FROM upd;

  RETURN json_build_object('criados', v_criados, 'resolvidos', v_resolvidos);
END $$;
GRANT EXECUTE ON FUNCTION estoque_sync_alertas() TO authenticated;

-- Roda 1x agora pra já corrigir o estado
SELECT estoque_sync_alertas() AS resultado;

-- Diagnóstico depois do sync
SELECT
  (SELECT COUNT(*) FROM alertas WHERE tipo='estoque_baixo' AND resolvido_em IS NULL) AS alertas_abertos,
  (SELECT COUNT(*) FROM produtos p JOIN produtos_velocidade_90d v ON v.produto_id=p.id
     WHERE COALESCE(p.estoque_virtual,0)<=5 AND COALESCE(v.qtd_vendida_90d,0)>0) AS deveria_ter;
