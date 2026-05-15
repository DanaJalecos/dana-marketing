-- ══════════════════════════════════════════════════════════════
-- Influencer OS — FASE 2 · ONDA 1
-- Dashboard executivo + Ranking de creators + Alertas automáticos
--
-- Reusa a infra da Fase 1 (influenciador_vendas, _influ_pct,
-- influenciador_recebidos, influenciador_creditos). Custo R$0.
-- ══════════════════════════════════════════════════════════════

-- ─── 1) RPC agregado: 1 linha por influenciador c/ ROI ───
-- Admin/gerente. Quando NÃO tem mapeamento Bling, cai no manual
-- (i.receita / i.vendas_geradas) pra não ficar zerado antes do sync.
DROP FUNCTION IF EXISTS influenciador_dashboard();
CREATE OR REPLACE FUNCTION influenciador_dashboard()
RETURNS TABLE (
  influenciador_id UUID, nome TEXT, status TEXT, nivel TEXT, nivel_label TEXT,
  comissao_pct NUMERIC, tem_mapeamento BOOLEAN,
  total_pedidos BIGINT, receita_bruta NUMERIC, ticket_medio NUMERIC,
  ultima_venda DATE,
  comissao_devida NUMERIC, recebidos_total NUMERIC,
  creditos_gerados NUMERIC, saldo_disponivel NUMERIC,
  investimento NUMERIC, roi NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH base AS (
    SELECT
      i.id, i.nome, COALESCE(i.status,'ativo') AS status, i.nivel,
      (SELECT label FROM influenciador_niveis WHERE nivel = i.nivel) AS nivel_label,
      _influ_pct(i.id) AS pct,
      (i.bling_vendedor_id IS NOT NULL) AS tem_map,
      COALESCE(v.total_pedidos, 0)::bigint AS qped,
      -- receita: Bling se mapeado, senão manual
      COALESCE(v.receita_bruta, i.receita, 0) AS receita,
      COALESCE(v.ticket_medio, 0) AS ticket,
      v.ultima_venda,
      COALESCE((SELECT SUM(custo_real+frete+embalagem) FROM influenciador_recebidos r WHERE r.influenciador_id=i.id), 0) AS receb,
      COALESCE((SELECT SUM(valor) FROM influenciador_creditos c WHERE c.influenciador_id=i.id AND c.status <> 'cancelado'), 0) AS cred
    FROM influenciadores i
    LEFT JOIN influenciador_vendas v
      ON v.bling_vendedor_id = i.bling_vendedor_id AND v.empresa = i.empresa
  )
  SELECT
    b.id, b.nome, b.status, b.nivel, b.nivel_label, b.pct, b.tem_map,
    b.qped, b.receita, b.ticket, b.ultima_venda,
    ROUND(b.receita * b.pct / 100.0, 2)                          AS comissao_devida,
    b.receb                                                       AS recebidos_total,
    b.cred                                                        AS creditos_gerados,
    GREATEST(ROUND(b.receita * b.pct / 100.0, 2) - b.cred, 0)      AS saldo_disponivel,
    ROUND(b.receb + b.receita * b.pct / 100.0, 2)                  AS investimento,
    CASE WHEN (b.receb + b.receita * b.pct / 100.0) > 0
      THEN ROUND(b.receita / (b.receb + b.receita * b.pct / 100.0), 2)
      ELSE NULL END                                               AS roi
  FROM base b
  ORDER BY b.receita DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION influenciador_dashboard() TO authenticated;

-- ─── 2) Alertas automáticos (sino) ───
-- 3 tipos, com dedup por NOT EXISTS (não repete enquanto não resolvido).
CREATE OR REPLACE FUNCTION gerar_alertas_influenciadores()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total INT := 0; v_n INT;
BEGIN
  -- a) Saldo de comissão acumulado >= R$100 (vale gerar crédito)
  INSERT INTO alertas (tipo,nivel,titulo,mensagem,audiencia,link_ref,link_label,dados)
  SELECT 'influ_saldo','info',
    '💰 ' || d.nome || ' tem comissão pra resgatar',
    d.nome || ' acumulou R$ ' || to_char(d.saldo_disponivel,'FM999G999G990D00')
      || ' de comissão. Gere o crédito no painel do influenciador.',
    'dados_empresa','influenciadores','Abrir Influenciadores',
    jsonb_build_object('influenciador_id',d.influenciador_id,'saldo',d.saldo_disponivel)
  FROM influenciador_dashboard() d
  WHERE d.status='ativo' AND d.saldo_disponivel >= 100
    AND NOT EXISTS (
      SELECT 1 FROM alertas a WHERE a.tipo='influ_saldo'
        AND a.dados->>'influenciador_id' = d.influenciador_id::text
        AND a.resolvido_em IS NULL
        AND a.created_at > now() - interval '7 days');
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

  -- b) Crédito gerado há +2 dias e ainda não cadastrado no Bling
  INSERT INTO alertas (tipo,nivel,titulo,mensagem,audiencia,link_ref,link_label,dados)
  SELECT 'influ_credito_bling','warn',
    '🎟️ Crédito ' || c.codigo || ' aguardando cadastro no Bling',
    'O crédito ' || c.codigo || ' (R$ ' || to_char(c.valor,'FM999G999G990D00')
      || ') de ' || i.nome || ' foi gerado há '
      || EXTRACT(DAY FROM now()-c.gerado_em)::int || ' dia(s) e ainda não foi marcado como cadastrado no Bling.',
    'dados_empresa','influenciadores','Abrir Influenciadores',
    jsonb_build_object('credito_id',c.id,'codigo',c.codigo,'influenciador_id',c.influenciador_id)
  FROM influenciador_creditos c
  JOIN influenciadores i ON i.id = c.influenciador_id
  WHERE c.status = 'gerado' AND c.gerado_em < now() - interval '2 days'
    AND NOT EXISTS (
      SELECT 1 FROM alertas a WHERE a.tipo='influ_credito_bling'
        AND a.dados->>'credito_id' = c.id::text
        AND a.resolvido_em IS NULL);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

  -- c) Creator ativo c/ mapeamento mas sem venda há +60 dias
  INSERT INTO alertas (tipo,nivel,titulo,mensagem,audiencia,link_ref,link_label,dados)
  SELECT 'influ_inativo','info',
    '😴 ' || d.nome || ' sem vendas há um tempo',
    d.nome || ' está ativo mas não gera venda desde '
      || to_char(d.ultima_venda,'DD/MM/YYYY') || '. Vale um follow-up.',
    'dados_empresa','influenciadores','Abrir Influenciadores',
    jsonb_build_object('influenciador_id',d.influenciador_id,'ultima_venda',d.ultima_venda)
  FROM influenciador_dashboard() d
  WHERE d.status='ativo' AND d.tem_mapeamento
    AND d.ultima_venda IS NOT NULL
    AND d.ultima_venda < (CURRENT_DATE - 60)
    AND NOT EXISTS (
      SELECT 1 FROM alertas a WHERE a.tipo='influ_inativo'
        AND a.dados->>'influenciador_id' = d.influenciador_id::text
        AND a.resolvido_em IS NULL
        AND a.created_at > now() - interval '30 days');
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

  RETURN v_total;
END $$;

-- ─── 3) Cron diário 09:20 (12:20 UTC) ───
SELECT cron.unschedule('alertas_influenciadores_diario')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='alertas_influenciadores_diario');
SELECT cron.schedule('alertas_influenciadores_diario','20 12 * * *',
  $$SELECT gerar_alertas_influenciadores()$$);

-- ─── Diagnóstico ───
SELECT
  (SELECT COUNT(*) FROM influenciador_dashboard())                       AS linhas_dashboard,
  (SELECT COUNT(*) FROM influenciador_dashboard() WHERE tem_mapeamento)  AS com_mapeamento,
  gerar_alertas_influenciadores()                                        AS alertas_gerados_agora,
  (SELECT COUNT(*) FROM cron.job WHERE jobname='alertas_influenciadores_diario') AS cron_ok;
