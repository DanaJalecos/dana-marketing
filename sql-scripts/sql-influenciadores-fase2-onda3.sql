-- ══════════════════════════════════════════════════════════════
-- Influencer OS — FASE 2 · ONDA 3
-- Mapa de influência + Heatmap + Embaixadores (promoção sugerida)
--
-- Reusa influenciador_dashboard() (Onda 1). Custo R$0.
-- Promoção = SUGESTÃO; admin confirma na UI (mexe em comissão).
-- ══════════════════════════════════════════════════════════════

-- ─── 1) Mapa: distribuição por região / estado ───
DROP FUNCTION IF EXISTS influenciador_mapa();
CREATE OR REPLACE FUNCTION influenciador_mapa()
RETURNS TABLE (
  regiao TEXT, estado TEXT,
  creators BIGINT, ativos BIGINT,
  receita_bruta NUMERIC, comissao_devida NUMERIC,
  roi NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE(NULLIF(TRIM(i.regiao),''),'(sem região)') AS regiao,
    COALESCE(NULLIF(TRIM(i.estado),''),'—')            AS estado,
    COUNT(*)::bigint                                    AS creators,
    COUNT(*) FILTER (WHERE COALESCE(i.status,'ativo')='ativo')::bigint AS ativos,
    ROUND(SUM(d.receita_bruta),2)                       AS receita_bruta,
    ROUND(SUM(d.comissao_devida),2)                     AS comissao_devida,
    CASE WHEN SUM(d.investimento) > 0
      THEN ROUND(SUM(d.receita_bruta)/SUM(d.investimento),2) ELSE NULL END AS roi
  FROM influenciadores i
  JOIN influenciador_dashboard() d ON d.influenciador_id = i.id
  GROUP BY 1,2
  ORDER BY receita_bruta DESC NULLS LAST;
$$;
GRANT EXECUTE ON FUNCTION influenciador_mapa() TO authenticated;

-- ─── 2) Heatmap: região × nicho (receita + qtd) ───
DROP FUNCTION IF EXISTS influenciador_heatmap();
CREATE OR REPLACE FUNCTION influenciador_heatmap()
RETURNS TABLE (
  regiao TEXT, nicho TEXT,
  creators BIGINT, receita_bruta NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE(NULLIF(TRIM(i.regiao),''),'(sem região)') AS regiao,
    COALESCE(NULLIF(TRIM(i.nicho),''),'(sem nicho)')   AS nicho,
    COUNT(*)::bigint                                    AS creators,
    ROUND(SUM(d.receita_bruta),2)                       AS receita_bruta
  FROM influenciadores i
  JOIN influenciador_dashboard() d ON d.influenciador_id = i.id
  GROUP BY 1,2;
$$;
GRANT EXECUTE ON FUNCTION influenciador_heatmap() TO authenticated;

-- ─── 3) Embaixadores: sugestão de promoção de nível ───
-- Bandas por receita gerada (12m acumulado do mapeamento/manual).
-- nano <5k · creator 5k–20k · embaixador 20k–50k · elite 50k+
-- Retorna SÓ quem o nível sugerido > nível atual.
DROP FUNCTION IF EXISTS influenciador_promocao_sugestoes();
CREATE OR REPLACE FUNCTION influenciador_promocao_sugestoes()
RETURNS TABLE (
  influenciador_id UUID, nome TEXT,
  nivel_atual TEXT, nivel_atual_label TEXT, pct_atual NUMERIC,
  nivel_sugerido TEXT, nivel_sugerido_label TEXT, pct_sugerido NUMERIC,
  receita_bruta NUMERIC, total_pedidos BIGINT, roi NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH calc AS (
    SELECT
      d.influenciador_id, d.nome, d.receita_bruta, d.total_pedidos, d.roi,
      COALESCE(d.nivel,'nano') AS nivel_atual,
      CASE
        WHEN d.receita_bruta >= 50000 THEN 'elite'
        WHEN d.receita_bruta >= 20000 THEN 'embaixador'
        WHEN d.receita_bruta >= 5000  THEN 'creator'
        ELSE 'nano'
      END AS nivel_sugerido
    FROM influenciador_dashboard() d
    WHERE d.status = 'ativo'
  )
  SELECT
    c.influenciador_id, c.nome,
    c.nivel_atual,    na.label, na.comissao_pct,
    c.nivel_sugerido, ns.label, ns.comissao_pct,
    c.receita_bruta, c.total_pedidos, c.roi
  FROM calc c
  JOIN influenciador_niveis na ON na.nivel = c.nivel_atual
  JOIN influenciador_niveis ns ON ns.nivel = c.nivel_sugerido
  WHERE ns.ordem > na.ordem        -- só promoção (nunca rebaixa)
  ORDER BY c.receita_bruta DESC;
$$;
GRANT EXECUTE ON FUNCTION influenciador_promocao_sugestoes() TO authenticated;

-- ─── 4) Estende alertas: creator pronto pra subir de nível ───
CREATE OR REPLACE FUNCTION gerar_alertas_influenciadores()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total INT := 0; v_n INT;
BEGIN
  -- a) Saldo de comissão acumulado >= R$100
  INSERT INTO alertas (tipo,nivel,titulo,mensagem,audiencia,link_ref,link_label,dados)
  SELECT 'influ_saldo','info',
    '💰 ' || d.nome || ' tem comissão pra resgatar',
    d.nome || ' acumulou R$ ' || to_char(d.saldo_disponivel,'FM999G999G990D00')
      || ' de comissão. Gere o crédito no painel do influenciador.',
    'dados_empresa','influenciadores','Abrir Influenciadores',
    jsonb_build_object('influenciador_id',d.influenciador_id,'saldo',d.saldo_disponivel)
  FROM influenciador_dashboard() d
  WHERE d.status='ativo' AND d.saldo_disponivel >= 100
    AND NOT EXISTS (SELECT 1 FROM alertas a WHERE a.tipo='influ_saldo'
        AND a.dados->>'influenciador_id'=d.influenciador_id::text
        AND a.resolvido_em IS NULL AND a.created_at > now()-interval '7 days');
  GET DIAGNOSTICS v_n=ROW_COUNT; v_total:=v_total+v_n;

  -- b) Crédito gerado +2 dias sem cadastro no Bling
  INSERT INTO alertas (tipo,nivel,titulo,mensagem,audiencia,link_ref,link_label,dados)
  SELECT 'influ_credito_bling','warn',
    '🎟️ Crédito ' || c.codigo || ' aguardando cadastro no Bling',
    'O crédito ' || c.codigo || ' (R$ ' || to_char(c.valor,'FM999G999G990D00')
      || ') de ' || i.nome || ' foi gerado há '
      || EXTRACT(DAY FROM now()-c.gerado_em)::int || ' dia(s) e ainda não foi marcado como cadastrado no Bling.',
    'dados_empresa','influenciadores','Abrir Influenciadores',
    jsonb_build_object('credito_id',c.id,'codigo',c.codigo,'influenciador_id',c.influenciador_id)
  FROM influenciador_creditos c
  JOIN influenciadores i ON i.id=c.influenciador_id
  WHERE c.status='gerado' AND c.gerado_em < now()-interval '2 days'
    AND NOT EXISTS (SELECT 1 FROM alertas a WHERE a.tipo='influ_credito_bling'
        AND a.dados->>'credito_id'=c.id::text AND a.resolvido_em IS NULL);
  GET DIAGNOSTICS v_n=ROW_COUNT; v_total:=v_total+v_n;

  -- c) Creator ativo c/ mapeamento sem venda +60 dias
  INSERT INTO alertas (tipo,nivel,titulo,mensagem,audiencia,link_ref,link_label,dados)
  SELECT 'influ_inativo','info',
    '😴 ' || d.nome || ' sem vendas há um tempo',
    d.nome || ' está ativo mas não gera venda desde '
      || to_char(d.ultima_venda,'DD/MM/YYYY') || '. Vale um follow-up.',
    'dados_empresa','influenciadores','Abrir Influenciadores',
    jsonb_build_object('influenciador_id',d.influenciador_id,'ultima_venda',d.ultima_venda)
  FROM influenciador_dashboard() d
  WHERE d.status='ativo' AND d.tem_mapeamento
    AND d.ultima_venda IS NOT NULL AND d.ultima_venda < (CURRENT_DATE-60)
    AND NOT EXISTS (SELECT 1 FROM alertas a WHERE a.tipo='influ_inativo'
        AND a.dados->>'influenciador_id'=d.influenciador_id::text
        AND a.resolvido_em IS NULL AND a.created_at > now()-interval '30 days');
  GET DIAGNOSTICS v_n=ROW_COUNT; v_total:=v_total+v_n;

  -- d) Creator pronto pra subir de nível (embaixadores)
  INSERT INTO alertas (tipo,nivel,titulo,mensagem,audiencia,link_ref,link_label,dados)
  SELECT 'influ_promocao','info',
    '⭐ ' || s.nome || ' merece subir pra ' || s.nivel_sugerido_label,
    s.nome || ' gerou R$ ' || to_char(s.receita_bruta,'FM999G999G990D00')
      || ' e está como ' || s.nivel_atual_label || ' ('|| s.pct_atual ||'%). '
      || 'Sugestão: promover pra ' || s.nivel_sugerido_label || ' ('|| s.pct_sugerido ||'%).',
    'dados_empresa','influenciadores','Abrir Influenciadores',
    jsonb_build_object('influenciador_id',s.influenciador_id,
        'nivel_atual',s.nivel_atual,'nivel_sugerido',s.nivel_sugerido)
  FROM influenciador_promocao_sugestoes() s
  WHERE NOT EXISTS (SELECT 1 FROM alertas a WHERE a.tipo='influ_promocao'
      AND a.dados->>'influenciador_id'=s.influenciador_id::text
      AND a.dados->>'nivel_sugerido'=s.nivel_sugerido
      AND a.resolvido_em IS NULL AND a.created_at > now()-interval '30 days');
  GET DIAGNOSTICS v_n=ROW_COUNT; v_total:=v_total+v_n;

  RETURN v_total;
END $$;

-- ─── Diagnóstico ───
SELECT
  (SELECT COUNT(*) FROM influenciador_mapa())                AS linhas_mapa,
  (SELECT COUNT(*) FROM influenciador_heatmap())             AS celulas_heatmap,
  (SELECT COUNT(*) FROM influenciador_promocao_sugestoes())  AS candidatos_promocao,
  gerar_alertas_influenciadores()                            AS alertas_gerados_agora;
