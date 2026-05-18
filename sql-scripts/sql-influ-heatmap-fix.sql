-- ══════════════════════════════════════════════════════════════
-- FIX influenciador_heatmap() — nicho era texto livre (frases
-- longas e únicas → dezenas de colunas ilegíveis). Agora normaliza
-- cada creator em UMA categoria canônica curta (por prioridade).
-- ══════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS influenciador_heatmap();
CREATE OR REPLACE FUNCTION influenciador_heatmap()
RETURNS TABLE (
  regiao TEXT, nicho TEXT,
  creators BIGINT, receita_bruta NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH norm AS (
    SELECT
      COALESCE(NULLIF(TRIM(i.regiao),''),'(sem região)') AS regiao,
      CASE
        WHEN i.nicho IS NULL OR TRIM(i.nicho)='' THEN 'Sem nicho'
        WHEN i.nicho ILIKE '%odonto%' OR i.nicho ILIKE '%dentist%' THEN 'Odontologia'
        WHEN i.nicho ILIKE '%estudante%' OR i.nicho ILIKE '%acadêmic%' OR i.nicho ILIKE '%academic%' THEN 'Estudantes'
        WHEN i.nicho ILIKE '%veterin%' OR i.nicho ILIKE '%vet %' OR i.nicho ILIKE '%pet%' THEN 'Veterinária'
        WHEN i.nicho ILIKE '%enferm%' THEN 'Enfermagem'
        WHEN i.nicho ILIKE '%estétic%' OR i.nicho ILIKE '%estetic%' OR i.nicho ILIKE '%beleza%' OR i.nicho ILIKE '%makeup%' OR i.nicho ILIKE '%maquia%' THEN 'Beleza/Estética'
        WHEN i.nicho ILIKE '%nutri%' THEN 'Nutrição'
        WHEN i.nicho ILIKE '%psico%' OR i.nicho ILIKE '%mental%' THEN 'Saúde mental'
        WHEN i.nicho ILIKE '%médic%' OR i.nicho ILIKE '%medic%' OR i.nicho ILIKE '%saúde%' OR i.nicho ILIKE '%saude%' THEN 'Saúde'
        WHEN i.nicho ILIKE '%business%' OR i.nicho ILIKE '%empreend%' OR i.nicho ILIKE '%negócio%' THEN 'Business'
        WHEN i.nicho ILIKE '%lifestyle%' OR i.nicho ILIKE '%rotina%' OR i.nicho ILIKE '%dia a dia%' THEN 'Lifestyle'
        ELSE 'Outros'
      END AS nicho
    FROM influenciadores i
    JOIN influenciador_dashboard() d ON d.influenciador_id = i.id
  )
  SELECT regiao, nicho,
         COUNT(*)::bigint AS creators,
         0::numeric       AS receita_bruta
  FROM norm
  GROUP BY regiao, nicho;
$$;
GRANT EXECUTE ON FUNCTION influenciador_heatmap() TO authenticated;

-- Diagnóstico: nichos agora limpos
SELECT nicho, SUM(creators) total
FROM influenciador_heatmap()
GROUP BY nicho ORDER BY total DESC;
