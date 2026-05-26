-- ════════════════════════════════════════════════════════════════════════════
-- BLING SYNC v3 — VAULT + WRAPPER (LOTE 1 / DIA 2)
-- Espelha credenciais Bling pro vault.secrets (cifrado) sem quebrar os 7 edges
-- existentes que ainda lêem `bling_tokens` plain text.
--
-- Estratégia DUAL durante migração:
-- 1. Vault recebe cópia atualizada (cifrada) via wrapper
-- 2. Tabela `bling_tokens` continua viva pros edges antigos
-- 3. Edges novas leem do Vault desde o início
-- 4. Quando todas as 7 edges antigas estiverem migradas (Dia 3-4), aí
--    deletamos a tabela plain e criamos view do Vault.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Helper: insere ou atualiza secret no Vault ──────────────────────────
-- vault.create_secret falha se nome já existe. Precisamos de upsert.
CREATE OR REPLACE FUNCTION public._vault_upsert_secret(
  p_name        text,
  p_secret      text,
  p_description text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM vault.secrets WHERE name = p_name;
  IF v_id IS NULL THEN
    SELECT vault.create_secret(p_secret, p_name, COALESCE(p_description, 'Bling OAuth credential')) INTO v_id;
  ELSE
    PERFORM vault.update_secret(v_id, p_secret, p_name, COALESCE(p_description, 'Bling OAuth credential'));
  END IF;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._vault_upsert_secret(text, text, text) FROM PUBLIC, anon, authenticated;
-- só service_role (que é quem roda os crons/edges) pode chamar

-- ── 2. Wrapper público: bling_token_upsert(empresa, access, refresh, expires) ──
-- Edges chamam essa função em vez de INSERT direto.
-- Por enquanto, escreve EM AMBOS os lugares (vault + tabela plain) pra compat.
CREATE OR REPLACE FUNCTION public.bling_token_upsert(
  p_empresa     text,           -- 'matriz' | 'bc'
  p_access      text,
  p_refresh     text,
  p_expires_at  timestamptz DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_empresa_lower text := lower(p_empresa);
  v_id_legacy     int;
BEGIN
  -- Valida
  IF v_empresa_lower NOT IN ('matriz', 'bc') THEN
    RAISE EXCEPTION 'empresa inválida: %. Aceita: matriz, bc', p_empresa;
  END IF;

  -- 1. Atualiza Vault (cifrado)
  PERFORM public._vault_upsert_secret(
    'bling_' || v_empresa_lower || '_access',
    p_access,
    'Bling ' || initcap(v_empresa_lower) || ' — access_token (rotaciona ~6h)'
  );

  PERFORM public._vault_upsert_secret(
    'bling_' || v_empresa_lower || '_refresh',
    p_refresh,
    'Bling ' || initcap(v_empresa_lower) || ' — refresh_token (rotaciona ~30d)'
  );

  -- 2. Atualiza tabela legada (mantém compat com 7 edges antigas)
  v_id_legacy := CASE v_empresa_lower WHEN 'matriz' THEN 1 ELSE 2 END;

  UPDATE public.bling_tokens
     SET access_token  = p_access,
         refresh_token = p_refresh,
         expires_at    = p_expires_at,
         updated_at    = NOW()
   WHERE id = v_id_legacy;

  IF NOT FOUND THEN
    INSERT INTO public.bling_tokens (id, empresa, access_token, refresh_token, expires_at, updated_at)
    VALUES (v_id_legacy, v_empresa_lower, p_access, p_refresh, p_expires_at, NOW());
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bling_token_upsert(text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.bling_token_upsert(text, text, text, timestamptz) TO service_role;

COMMENT ON FUNCTION public.bling_token_upsert IS
'Wrapper que escreve tokens Bling no Vault (cifrado) + tabela legada plain.
Edges devem chamar esta função em vez de UPDATE direto em bling_tokens.
Quando todas as 7 edges antigas migrarem (Dia 3-4), tabela plain será removida.';

-- ── 3. Helper de leitura: bling_token_get(empresa) → access + refresh ──────
-- Edges novas chamam isso em vez de SELECT na tabela plain.
CREATE OR REPLACE FUNCTION public.bling_token_get(p_empresa text)
RETURNS TABLE (
  access_token  text,
  refresh_token text,
  expires_at    timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_empresa_lower text := lower(p_empresa);
BEGIN
  IF v_empresa_lower NOT IN ('matriz', 'bc') THEN
    RAISE EXCEPTION 'empresa inválida: %. Aceita: matriz, bc', p_empresa;
  END IF;

  RETURN QUERY
  SELECT
    (SELECT decrypted_secret FROM vault.decrypted_secrets
      WHERE name = 'bling_' || v_empresa_lower || '_access')   AS access_token,
    (SELECT decrypted_secret FROM vault.decrypted_secrets
      WHERE name = 'bling_' || v_empresa_lower || '_refresh')  AS refresh_token,
    (SELECT expires_at FROM public.bling_tokens
      WHERE empresa = v_empresa_lower
      ORDER BY id LIMIT 1)                                     AS expires_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bling_token_get(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.bling_token_get(text) TO service_role;

COMMENT ON FUNCTION public.bling_token_get IS
'Lê tokens decifrados do Vault. Edges novas devem usar isto em vez de SELECT na bling_tokens.';

-- ── 4. Helper de leitura: client_id/client_secret do Vault ──────────────────
CREATE OR REPLACE FUNCTION public.bling_client_creds(p_empresa text)
RETURNS TABLE (
  client_id     text,
  client_secret text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_empresa_lower text := lower(p_empresa);
BEGIN
  IF v_empresa_lower NOT IN ('matriz', 'bc') THEN
    RAISE EXCEPTION 'empresa inválida: %', p_empresa;
  END IF;

  RETURN QUERY
  SELECT
    (SELECT decrypted_secret FROM vault.decrypted_secrets
      WHERE name = 'bling_' || v_empresa_lower || '_client_id')      AS client_id,
    (SELECT decrypted_secret FROM vault.decrypted_secrets
      WHERE name = 'bling_' || v_empresa_lower || '_client_secret')  AS client_secret;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bling_client_creds(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.bling_client_creds(text) TO service_role;

COMMIT;
