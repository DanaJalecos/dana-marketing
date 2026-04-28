-- ══════════════════════════════════════════════════════════
-- Habilitar Realtime nas tabelas do DMS
-- (pra deletar/inserir/atualizar propagar entre PCs automaticamente)
-- ══════════════════════════════════════════════════════════

-- Ver o que já está habilitado
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
ORDER BY tablename;

-- Adicionar tabelas uma por uma (ignora erro se já existir)
DO $$
DECLARE
  tabelas TEXT[] := ARRAY[
    'criativos',
    'briefings_campanha',
    'materiais_briefing',
    'brandkit_itens',
    'canais_aquisicao',
    'revendas_parceiros',
    'concorrentes'
  ];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      RAISE NOTICE 'Adicionada: %', t;
    ELSE
      RAISE NOTICE 'Já estava: %', t;
    END IF;
  END LOOP;
END $$;

-- Verificação final
SELECT tablename AS "Tabelas com Realtime ativo"
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
ORDER BY tablename;
