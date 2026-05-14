-- ══════════════════════════════════════════════════════════════
-- Bucket Storage pra criativos de aniversário
--
-- Criativo master é gerado via Estúdio IA (post_feed 1:1) e
-- baixado/subido manualmente como `padrao.png` neste bucket.
-- A edge `gerar-cupom-aniversario` retorna a URL pública desse bucket.
--
-- Rodar no Supabase Studio → SQL Editor uma vez.
-- (Bucket precisa ser PÚBLICO pra WhatsApp renderizar a imagem.)
-- ══════════════════════════════════════════════════════════════

-- Cria bucket público se não existir
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'criativos-aniversario',
  'criativos-aniversario',
  true,                          -- PUBLIC
  5242880,                        -- 5 MB limit
  ARRAY['image/png','image/jpeg','image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Policy: leitura pública (qualquer um lê pra mostrar no WhatsApp/Insta)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'aniv_read_public') THEN
    CREATE POLICY aniv_read_public ON storage.objects
      FOR SELECT
      USING (bucket_id = 'criativos-aniversario');
  END IF;
END $$;

-- Policy: upload apenas admin/gerente
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'aniv_upload_admin') THEN
    CREATE POLICY aniv_upload_admin ON storage.objects
      FOR INSERT
      WITH CHECK (
        bucket_id = 'criativos-aniversario'
        AND EXISTS (
          SELECT 1 FROM profiles
          WHERE id = auth.uid()
            AND cargo IN ('admin','gerente_comercial','gerente_financeiro','design')
        )
      );
  END IF;
END $$;

-- Policy: update/delete admin
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'aniv_modify_admin') THEN
    CREATE POLICY aniv_modify_admin ON storage.objects
      FOR ALL
      USING (
        bucket_id = 'criativos-aniversario'
        AND EXISTS (
          SELECT 1 FROM profiles
          WHERE id = auth.uid()
            AND cargo IN ('admin','gerente_comercial')
        )
      );
  END IF;
END $$;

SELECT id, name, public, file_size_limit
FROM storage.buckets
WHERE id = 'criativos-aniversario';
