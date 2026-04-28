-- ══════════════════════════════════════════════════════════
-- HARDENING DE SEGURANÇA · RLS policies
--
-- Adiciona Row Level Security em tabelas sensíveis:
--   - profiles          → só admin muda cargo de outros
--   - cargo_permissoes  → só admin escreve
--   - alertas           → delete protegido
--
-- Isso complementa o fix client-side (ADMIN_ONLY_VIEWS no frontend).
-- Mesmo se alguém abrir DevTools e mudar currentProfile.cargo,
-- operações críticas no banco são negadas pelo Postgres.
--
-- CUIDADO: se rodar sem ter pelo menos 1 admin cadastrado, você pode
-- ficar bloqueado. Primeiro passo confere isso.
-- ══════════════════════════════════════════════════════════

-- ── PASSO 0 · VERIFICAR QUE EXISTE ADMIN ──
DO $do$
BEGIN
  IF (SELECT COUNT(*) FROM public.profiles WHERE cargo = 'admin') = 0 THEN
    RAISE EXCEPTION 'Nenhum admin cadastrado. Abortando pra não te bloquear.';
  END IF;
  RAISE NOTICE 'Admins OK. Prosseguindo...';
END
$do$;

-- ── PASSO 1 · FUNÇÃO is_admin() (helper cacheável) ──
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND cargo = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;

-- ══════════════════════════════════════════════════════════
-- TABELA: profiles
-- ══════════════════════════════════════════════════════════
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Limpa policies antigas pra evitar duplicatas
DROP POLICY IF EXISTS "profiles_select_all" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_delete_admin" ON public.profiles;

-- SELECT: qualquer authenticated vê todos os profiles (pra mostrar nomes nos alertas)
CREATE POLICY "profiles_select_all" ON public.profiles
  FOR SELECT TO authenticated USING (true);

-- UPDATE próprio nome/avatar (mas não cargo — bloqueado via trigger abaixo)
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id);

-- UPDATE por admin: pode alterar qualquer profile (inclusive cargo de outros)
CREATE POLICY "profiles_update_admin" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_admin());

-- INSERT só admin (criar novos usuários passa pela Edge Function criar-usuario)
CREATE POLICY "profiles_insert_admin" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- DELETE só admin
CREATE POLICY "profiles_delete_admin" ON public.profiles
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- Trigger: impede non-admin de mudar próprio cargo
CREATE OR REPLACE FUNCTION public.prevent_self_cargo_change()
RETURNS trigger AS $$
BEGIN
  IF OLD.cargo IS DISTINCT FROM NEW.cargo AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Apenas administradores podem alterar cargos';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_prevent_cargo_change ON public.profiles;
CREATE TRIGGER trg_prevent_cargo_change
  BEFORE UPDATE OF cargo ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_self_cargo_change();

-- ══════════════════════════════════════════════════════════
-- TABELA: cargo_permissoes
-- ══════════════════════════════════════════════════════════
ALTER TABLE public.cargo_permissoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cargo_perm_select_all" ON public.cargo_permissoes;
DROP POLICY IF EXISTS "cargo_perm_insert_admin" ON public.cargo_permissoes;
DROP POLICY IF EXISTS "cargo_perm_update_admin" ON public.cargo_permissoes;
DROP POLICY IF EXISTS "cargo_perm_delete_admin" ON public.cargo_permissoes;

-- Todos authenticated leem (pra saber próprias permissões)
CREATE POLICY "cargo_perm_select_all" ON public.cargo_permissoes
  FOR SELECT TO authenticated USING (true);

-- Só admin escreve
CREATE POLICY "cargo_perm_insert_admin" ON public.cargo_permissoes
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "cargo_perm_update_admin" ON public.cargo_permissoes
  FOR UPDATE TO authenticated
  USING (public.is_admin());

CREATE POLICY "cargo_perm_delete_admin" ON public.cargo_permissoes
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- ══════════════════════════════════════════════════════════
-- TABELA: alertas
-- Políticas: todos leem (frontend filtra); INSERT livre (fluxo app);
-- UPDATE (marcar lido) livre; DELETE só admin ou próprio destinatário
-- ══════════════════════════════════════════════════════════
ALTER TABLE public.alertas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "alertas_select_all" ON public.alertas;
DROP POLICY IF EXISTS "alertas_insert_auth" ON public.alertas;
DROP POLICY IF EXISTS "alertas_update_auth" ON public.alertas;
DROP POLICY IF EXISTS "alertas_delete_admin_or_own" ON public.alertas;

CREATE POLICY "alertas_select_all" ON public.alertas
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "alertas_insert_auth" ON public.alertas
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "alertas_update_auth" ON public.alertas
  FOR UPDATE TO authenticated USING (true);

-- DELETE: admin apaga qualquer, outros só os próprios pessoais
CREATE POLICY "alertas_delete_admin_or_own" ON public.alertas
  FOR DELETE TO authenticated
  USING (public.is_admin() OR destinatario_id = auth.uid());

-- ══════════════════════════════════════════════════════════
-- TABELA: bling_tokens (CRÍTICO — nunca exposto ao frontend)
-- ══════════════════════════════════════════════════════════
ALTER TABLE public.bling_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bling_tokens_service_only" ON public.bling_tokens;

-- Nenhuma policy pra authenticated/anon = só service_role (Edge Functions) acessa
-- (RLS bloqueia todo mundo exceto service_role quando não tem policies)

-- ══════════════════════════════════════════════════════════
-- TABELA: activity_log (auditoria)
-- ══════════════════════════════════════════════════════════
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activity_select_admin" ON public.activity_log;
DROP POLICY IF EXISTS "activity_insert_auth" ON public.activity_log;

-- SELECT: só admin vê log de atividades (privacidade)
CREATE POLICY "activity_select_admin" ON public.activity_log
  FOR SELECT TO authenticated USING (public.is_admin());

-- INSERT: qualquer authenticated grava própria atividade
CREATE POLICY "activity_insert_auth" ON public.activity_log
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ══════════════════════════════════════════════════════════
-- TESTE · confere policies criadas
-- ══════════════════════════════════════════════════════════
SELECT schemaname, tablename, policyname, permissive, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('profiles','cargo_permissoes','alertas','bling_tokens','activity_log')
ORDER BY tablename, cmd;
