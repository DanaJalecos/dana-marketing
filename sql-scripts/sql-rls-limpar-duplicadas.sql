-- ══════════════════════════════════════════════════════════
-- LIMPAR POLICIES DUPLICADAS/INSEGURAS
--
-- Após rodar sql-rls-seguranca.sql, ficaram policies ANTIGAS
-- na tabela que ANULAM a segurança (PostgreSQL faz OR entre
-- policies PERMISSIVE — se qualquer uma permitir, passa).
--
-- Este script DROPA as antigas e deixa só as novas (seguras)
-- + as service_* que Edge Functions precisam.
-- ══════════════════════════════════════════════════════════

-- ── ALERTAS · remover policies que permitiam acesso livre ──
DROP POLICY IF EXISTS "alertas_delete_auth" ON public.alertas;        -- permitia delete livre
DROP POLICY IF EXISTS "write_alertas"       ON public.alertas;        -- duplicada de insert_auth
DROP POLICY IF EXISTS "alertas_read_all"    ON public.alertas;        -- duplicada de select_all
DROP POLICY IF EXISTS "read_alertas"        ON public.alertas;        -- duplicada

-- ── ACTIVITY_LOG · remover acesso livre de leitura ──
DROP POLICY IF EXISTS "activity_select"     ON public.activity_log;   -- anulava admin-only
DROP POLICY IF EXISTS "activity_insert"     ON public.activity_log;   -- duplicada

-- ── PROFILES · remover policies redundantes/menos restritivas ──
DROP POLICY IF EXISTS "insert_own_profile"  ON public.profiles;       -- qualquer user criava profile
DROP POLICY IF EXISTS "profiles_insert"     ON public.profiles;       -- duplicada
DROP POLICY IF EXISTS "read_profiles"       ON public.profiles;       -- duplicada de select_all
DROP POLICY IF EXISTS "profiles_select"     ON public.profiles;       -- duplicada
DROP POLICY IF EXISTS "profiles_update_self" ON public.profiles;      -- duplicada de update_own
DROP POLICY IF EXISTS "update_own_profile"  ON public.profiles;       -- duplicada

-- ── CARGO_PERMISSOES · remover duplicadas ──
DROP POLICY IF EXISTS "cargo_perm_select"   ON public.cargo_permissoes;  -- duplicada de select_all
DROP POLICY IF EXISTS "cargo_perm_admin"    ON public.cargo_permissoes;  -- overlap com as CRUD específicas

-- ══════════════════════════════════════════════════════════
-- VER O RESULTADO FINAL · deve ter só o essencial
-- ══════════════════════════════════════════════════════════
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('profiles','cargo_permissoes','alertas','bling_tokens','activity_log')
ORDER BY tablename, cmd, policyname;
