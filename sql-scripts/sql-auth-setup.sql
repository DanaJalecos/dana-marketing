-- ══════════════════════════════════════════════════════════
-- Sistema de Login + Cargos + Permissões + Log de Atividades
-- Rodar no Supabase SQL Editor
-- ══════════════════════════════════════════════════════════

-- 1. Tabela de perfis (vinculada ao Supabase Auth)
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome text NOT NULL DEFAULT '',
  cargo text NOT NULL DEFAULT 'vendedor',
  avatar_url text,
  created_at timestamptz DEFAULT now(),
  last_login timestamptz
);

-- 2. Trigger: criar profile automaticamente ao registrar usuario
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, nome, cargo)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'nome', NEW.email), 'vendedor');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 3. Tabela de permissoes por cargo
CREATE TABLE IF NOT EXISTS cargo_permissoes (
  id serial PRIMARY KEY,
  cargo text NOT NULL,
  secao text NOT NULL,
  permitido boolean DEFAULT true,
  UNIQUE(cargo, secao)
);

-- 4. Tabela de log de atividades
CREATE TABLE IF NOT EXISTS activity_log (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id),
  user_nome text,
  user_cargo text,
  acao text NOT NULL,
  detalhes text,
  secao text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_date ON activity_log(created_at DESC);

-- 5. RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE cargo_permissoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- Profiles: usuario le o proprio, admin le todos
DROP POLICY IF EXISTS "profiles_select" ON profiles;
CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (
  auth.uid() = id
  OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo = 'admin')
);
DROP POLICY IF EXISTS "profiles_update_self" ON profiles;
CREATE POLICY "profiles_update_self" ON profiles FOR UPDATE USING (
  auth.uid() = id
  OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo = 'admin')
);
-- Admin pode inserir (para quando cria usuarios via Edge Function)
DROP POLICY IF EXISTS "profiles_insert" ON profiles;
CREATE POLICY "profiles_insert" ON profiles FOR INSERT WITH CHECK (true);

-- Cargo permissoes: todos leem, so admin escreve
DROP POLICY IF EXISTS "cargo_perm_select" ON cargo_permissoes;
CREATE POLICY "cargo_perm_select" ON cargo_permissoes FOR SELECT USING (true);
DROP POLICY IF EXISTS "cargo_perm_admin" ON cargo_permissoes;
CREATE POLICY "cargo_perm_admin" ON cargo_permissoes FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo = 'admin')
);

-- Activity log: todos inserem, admin le tudo, usuario le o proprio
DROP POLICY IF EXISTS "activity_insert" ON activity_log;
CREATE POLICY "activity_insert" ON activity_log FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "activity_select" ON activity_log;
CREATE POLICY "activity_select" ON activity_log FOR SELECT USING (
  auth.uid() = user_id
  OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND cargo = 'admin')
);

-- 6. Seed: permissoes default (todos os cargos com acesso a todas as secoes)
DO $$
DECLARE
  _cargo text;
  _secao text;
  _cargos text[] := ARRAY['admin','gerente_marketing','gerente_comercial','gerente_financeiro','trafego_pago','producao_conteudo','analista_marketplace','vendedor','expedicao'];
  _secoes text[] := ARRAY['home','campanhas','criativos','influenciadores','personas','mercado','referencias','performance','comunidade','financeiro','projecoes','marketplaces','canaisvendas','provasocial','branding','apis','tarefas','roi','relatorio','construtor','briefingvisual','calendario','keywords','admin'];
BEGIN
  FOREACH _cargo IN ARRAY _cargos LOOP
    FOREACH _secao IN ARRAY _secoes LOOP
      INSERT INTO cargo_permissoes (cargo, secao, permitido)
      VALUES (_cargo, _secao, CASE WHEN _secao = 'admin' AND _cargo != 'admin' THEN false ELSE true END)
      ON CONFLICT (cargo, secao) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

-- 7. Habilitar Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE activity_log;
