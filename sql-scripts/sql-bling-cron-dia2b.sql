-- ════════════════════════════════════════════════════════════════════════════
-- BLING SYNC v3 — CRON DO TOKEN REFRESH (LOTE 1 / DIA 2b)
-- Pré-requisito: sql-bling-vault-dia2.sql aplicado + edges bling-token-refresh
-- e bling-oauth-callback deployadas.
--
-- Estrutura:
-- 1. Service role key cifrado no Vault (reusável por outros crons futuros)
-- 2. Helper public._call_edge(function, body) — chama edge via net.http_post
-- 3. Cron 'bling-token-refresh-5h' = '0 */5 * * *' (00,05,10,15,20 UTC)
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Service role key no Vault — só rodar UMA VEZ por projeto.
-- IMPORTANTE: substitua <SERVICE_ROLE_KEY> pela key real ao rodar manualmente.
-- A 1ª aplicação deste script foi feita via Management API com a key embutida
-- dinamicamente. Aqui fica documentado o objeto criado.
--
-- SELECT public._vault_upsert_secret(
--   'supabase_service_role_key',
--   '<SERVICE_ROLE_KEY>',
--   'Service role key do projeto (uso interno em pg_cron pra chamar Edge Functions)'
-- );

-- 2. Helper genérico pra crons chamarem edge functions autenticadas
CREATE OR REPLACE FUNCTION public._call_edge(p_function text, p_body jsonb DEFAULT '{}'::jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions, net
AS $func$
DECLARE
  v_key text;
  v_url text;
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets
  WHERE name = 'supabase_service_role_key';

  IF v_key IS NULL THEN
    RAISE EXCEPTION 'supabase_service_role_key não encontrado no Vault';
  END IF;

  v_url := 'https://wltmiqbhziefusnzmmkt.supabase.co/functions/v1/' || p_function;

  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type', 'application/json'
    ),
    body := p_body
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$func$;

REVOKE EXECUTE ON FUNCTION public._call_edge(text, jsonb) FROM PUBLIC, anon, authenticated;
-- service_role + postgres só

-- 3. Cron de refresh proativo a cada 5h (Bling expira em ~6h, 1h margem)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bling-token-refresh-5h') THEN
    PERFORM cron.unschedule('bling-token-refresh-5h');
  END IF;
END $$;

SELECT cron.schedule(
  'bling-token-refresh-5h',
  '0 */5 * * *',  -- 00:00, 05:00, 10:00, 15:00, 20:00 UTC
  $$SELECT public._call_edge('bling-token-refresh');$$
);

COMMIT;

-- Verificações pós-aplicação:
-- SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname='bling-token-refresh-5h';
-- SELECT public._call_edge('bling-token-refresh');  -- disparo manual
-- SELECT id, tabela, loja_id, status, duracao_ms FROM bling_sync_log WHERE tabela='oauth_refresh' ORDER BY id DESC LIMIT 4;
