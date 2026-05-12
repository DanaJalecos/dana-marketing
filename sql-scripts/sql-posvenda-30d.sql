-- =============================================================================
-- FASE 1: Pós-venda 30d (cron diário + alerta pessoal pra vendedora)
-- =============================================================================
-- Idempotente. Reaplicar é seguro.
-- =============================================================================

-- 1) Flag em pedidos pra evitar duplicação
ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS posvenda_alertado_em TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_pedidos_posvenda_pendente
  ON pedidos(data)
  WHERE posvenda_alertado_em IS NULL AND vendedor_id IS NOT NULL;

-- 2) Função que gera alertas. Idempotente.
--    - Pedidos com data exatamente 30 dias atrás
--    - vendedor mapeado, ativo, sem excluir_ranking (descarta Site/ML fake)
--    - Não cancelado (situacao_id != 12)
--    - posvenda_alertado_em IS NULL (não dupla)
CREATE OR REPLACE FUNCTION gerar_alertas_posvenda_30d()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inseridos INT := 0;
  v_ids BIGINT[];
BEGIN
  -- Captura IDs alvo + insere alertas em 1 passada
  WITH alvos AS (
    SELECT
      p.id, p.numero, p.data, p.contato_nome, p.empresa, p.total,
      vm.profile_id, vm.display_name
    FROM pedidos p
    JOIN vendedor_mapping vm
      ON vm.bling_vendedor_id = p.vendedor_id
     AND vm.empresa = p.empresa
     AND vm.ativo = TRUE
     AND COALESCE(vm.excluir_ranking, FALSE) = FALSE
     AND vm.profile_id IS NOT NULL
    WHERE p.data = (CURRENT_DATE - INTERVAL '30 days')::DATE
      AND p.posvenda_alertado_em IS NULL
      AND p.situacao_id != 12
      AND p.contato_nome IS NOT NULL
      AND p.contato_nome <> ''
  ),
  ins AS (
    INSERT INTO alertas (
      tipo, nivel, titulo, mensagem,
      audiencia, destinatario_id, destinatario_nome,
      link_ref, link_label, dados
    )
    SELECT
      'posvenda_30d',
      'info',
      '📞 Pós-venda: ' || contato_nome,
      'Pedido #' || numero::TEXT || ' fechado há ~30 dias. Hora do follow-up.',
      'pessoal',
      profile_id,
      display_name,
      'cliente360',
      'Abrir cliente',
      jsonb_build_object(
        'contato_nome', contato_nome,
        'empresa',      empresa,
        'pedido_id',    id,
        'pedido_numero', numero,
        'pedido_data',  data,
        'pedido_total', total
      )
    FROM alvos
    RETURNING (dados->>'pedido_id')::BIGINT AS pedido_id
  )
  -- Marca pedidos como alertados
  UPDATE pedidos
     SET posvenda_alertado_em = NOW()
   WHERE id IN (SELECT pedido_id FROM ins);

  GET DIAGNOSTICS v_inseridos = ROW_COUNT;
  RETURN v_inseridos;
END $$;

COMMENT ON FUNCTION gerar_alertas_posvenda_30d() IS
  'Gera alertas pessoais "posvenda_30d" pra vendedores 30 dias após pedido. Idempotente (flag posvenda_alertado_em).';

-- 3) Cron diário: 11:00 UTC = 08:00 BRT
--    Roda depois do sync-pedidos (06:00 BRT) e do cron-cliente-tem-magazord (06:50 BRT)
--    Idempotente: unschedule se já existir, schedule novo
DO $$
BEGIN
  PERFORM cron.unschedule('cron-posvenda-30d');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'cron-posvenda-30d',
  '0 11 * * *',
  $cron$SELECT gerar_alertas_posvenda_30d();$cron$
);

-- 4) Verificação pós-deploy
-- Rodar:
--   SELECT gerar_alertas_posvenda_30d();
--   SELECT COUNT(*) FROM alertas WHERE tipo='posvenda_30d' AND audiencia='pessoal';
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname='cron-posvenda-30d';
