-- ══════════════════════════════════════════════════════════════
-- FIX: card "Convertidos" do funil C360 mostrava 12 mas a lista
-- abria vazia. Causa: cliente_metadata/historico usam o status
-- 'comprou', mas o card/drill filtra 'convertido' → 0 linhas.
-- Solução: normalizar 'convertido' ↔ 'comprou' dentro da RPC
-- cliente_funil_detalhes (1 alias, sem mexer no front).
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cliente_funil_detalhes(
  modo text, status_filtro text DEFAULT NULL::text,
  empresa_filter text DEFAULT 'todas'::text,
  status_anterior_filtro text DEFAULT NULL::text,
  periodo_dias integer DEFAULT 30)
 RETURNS TABLE(contato_id bigint, empresa text, cliente_nome text, status_anterior text, status_novo text, observacao text, mudado_em timestamp with time zone, mudado_por_nome text, motivo_perda text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH sf AS (
    -- 'convertido' (rótulo do funil) == 'comprou' (valor real no banco)
    SELECT CASE WHEN status_filtro = 'convertido' THEN 'comprou' ELSE status_filtro END AS v
  ),
  base AS (
    SELECT
      cm.contato_id, cm.empresa, c.nome AS cliente_nome,
      NULL::text AS status_anterior, cm.status_relacionamento AS status_novo,
      cm.observacao_rapida AS observacao,
      cm.atualizado_em AS mudado_em,
      cm.atualizado_por_nome AS mudado_por_nome,
      cm.motivo_perda
    FROM cliente_metadata cm
    LEFT JOIN contatos c ON c.id = cm.contato_id
    WHERE modo = 'snapshot'
      AND (empresa_filter = 'todas' OR cm.empresa = empresa_filter)
      AND cm.status_relacionamento IS NOT NULL
      AND ((SELECT v FROM sf) IS NULL OR cm.status_relacionamento = (SELECT v FROM sf))

    UNION ALL
    SELECT h.contato_id, h.empresa, c.nome, h.status_anterior, h.status_novo,
      h.observacao, h.mudado_em, h.mudado_por_nome, h.motivo_perda
    FROM cliente_status_historico h
    LEFT JOIN contatos c ON c.id = h.contato_id
    WHERE modo = 'fluxo'
      AND (empresa_filter = 'todas' OR h.empresa = empresa_filter)
      AND h.status_novo = (SELECT v FROM sf)
      AND h.mudado_em >= NOW() - (periodo_dias || ' days')::interval

    UNION ALL
    SELECT h.contato_id, h.empresa, c.nome, h.status_anterior, h.status_novo,
      h.observacao, h.mudado_em, h.mudado_por_nome, h.motivo_perda
    FROM cliente_status_historico h
    LEFT JOIN contatos c ON c.id = h.contato_id
    WHERE modo = 'conversao'
      AND (empresa_filter = 'todas' OR h.empresa = empresa_filter)
      AND h.status_novo = (SELECT v FROM sf)
      AND h.mudado_em >= NOW() - (periodo_dias || ' days')::interval

    UNION ALL
    SELECT h.contato_id, h.empresa, c.nome, h.status_anterior, h.status_novo,
      h.observacao, h.mudado_em, h.mudado_por_nome, h.motivo_perda
    FROM cliente_status_historico h
    LEFT JOIN contatos c ON c.id = h.contato_id
    WHERE modo = 'perdidos'
      AND (empresa_filter = 'todas' OR h.empresa = empresa_filter)
      AND h.status_novo IN ('perdido', 'sem_interesse')
      AND h.mudado_em >= NOW() - (periodo_dias || ' days')::interval

    UNION ALL
    SELECT c.id, c.empresa, c.nome, NULL::text, 'nao_contatado',
      NULL::text, MAX(pe.data), NULL::text, NULL::text
    FROM contatos c
    LEFT JOIN pedidos pe ON pe.contato_nome = c.nome AND pe.empresa = c.empresa
       AND pe.data >= NOW() - INTERVAL '12 months' AND pe.situacao_id != 12
    WHERE modo = 'nao_contatado'
      AND (empresa_filter = 'todas' OR c.empresa = empresa_filter)
      AND EXISTS (SELECT 1 FROM pedidos pe2
        WHERE pe2.contato_nome = c.nome AND pe2.empresa = c.empresa
          AND pe2.data >= NOW() - INTERVAL '12 months' AND pe2.situacao_id != 12)
      AND NOT EXISTS (SELECT 1 FROM cliente_metadata cm
        WHERE cm.contato_id = c.id AND cm.empresa = c.empresa
          AND cm.status_relacionamento NOT IN ('novo')
          AND cm.atualizado_em >= NOW() - INTERVAL '90 days')
    GROUP BY c.id, c.empresa, c.nome
  )
  SELECT * FROM base ORDER BY mudado_em DESC NULLS LAST LIMIT 200;
$function$;

-- Diagnóstico: agora deve trazer os 12
SELECT COUNT(*) convertidos_lista
FROM cliente_funil_detalhes('snapshot','convertido','todas',NULL,30);
