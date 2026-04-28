-- ══════════════════════════════════════════════════════════
-- DIAGNÓSTICO — Storage bucket "kanban"
-- Rodar e colar o resultado pra investigar o HTTP 400
-- ══════════════════════════════════════════════════════════

-- 1. Configurações do bucket (limite de tamanho + MIME types permitidos)
SELECT id, name, public, file_size_limit, allowed_mime_types, owner, created_at
FROM storage.buckets
WHERE id = 'kanban';

-- 2. Todas as policies do storage.objects (INSERT/SELECT/UPDATE/DELETE)
SELECT policyname, cmd,
       COALESCE(qual::text, 'NULL') AS condicao_leitura,
       COALESCE(with_check::text, 'NULL') AS condicao_gravacao
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY cmd, policyname;

-- 3. Últimos 10 arquivos no bucket kanban pra confirmar que outros uploads funcionam
SELECT name, metadata->>'size' AS tamanho_bytes, created_at
FROM storage.objects
WHERE bucket_id = 'kanban'
ORDER BY created_at DESC
LIMIT 10;
