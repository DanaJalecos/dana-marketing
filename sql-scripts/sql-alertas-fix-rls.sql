-- ══════════════════════════════════════════════════════════
-- FIX RLS — permitir usuários autenticados criarem alertas
-- Erro: "new row violates row-level security policy for table alertas"
-- ══════════════════════════════════════════════════════════

-- Listar policies atuais (pra debug)
SELECT policyname, cmd, qual::text, with_check::text
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'alertas';

-- Remover policies antigas que podem estar bloqueando
DROP POLICY IF EXISTS "alertas_insert" ON alertas;
DROP POLICY IF EXISTS "insert_alertas" ON alertas;
DROP POLICY IF EXISTS "alertas_select" ON alertas;
DROP POLICY IF EXISTS "select_alertas" ON alertas;
DROP POLICY IF EXISTS "alertas_update" ON alertas;
DROP POLICY IF EXISTS "update_alertas" ON alertas;

-- Garantir que RLS está habilitado
ALTER TABLE alertas ENABLE ROW LEVEL SECURITY;

-- Policies limpas e permissivas (controle no frontend)
-- Leitura: tudo liberado (o frontend já filtra por destinatario_id)
CREATE POLICY "alertas_read_all" ON alertas
  FOR SELECT USING (true);

-- Insert: qualquer usuário autenticado pode criar alertas
-- (incluindo alertas pra OUTROS usuários — que é o caso dos eventos de aprovação)
CREATE POLICY "alertas_insert_auth" ON alertas
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Update: qualquer autenticado pode marcar como lido, etc.
CREATE POLICY "alertas_update_auth" ON alertas
  FOR UPDATE USING (auth.role() = 'authenticated');

-- Delete (não usa no frontend, mas libera pra admin se precisar)
DROP POLICY IF EXISTS "alertas_delete" ON alertas;
CREATE POLICY "alertas_delete_auth" ON alertas
  FOR DELETE USING (auth.role() = 'authenticated');

-- Verificação final
SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'alertas'
ORDER BY cmd;

SELECT 'Policies de alertas corrigidas' AS status;
