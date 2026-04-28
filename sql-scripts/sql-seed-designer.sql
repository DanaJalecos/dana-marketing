-- ══════════════════════════════════════════════════════════
-- Novo cargo: Designer
-- Seed: todas as permissões em true (admin depois ajusta no painel)
-- ══════════════════════════════════════════════════════════

-- Inserir Designer em todas as seções/ações que já existem no sistema
-- pra cada cargo (copia o modelo de outro cargo pra não esquecer de nada)

INSERT INTO cargo_permissoes (cargo, secao, permitido)
SELECT 'designer' AS cargo, secao, true AS permitido
FROM (
  SELECT DISTINCT secao FROM cargo_permissoes
) existing_secoes
ON CONFLICT (cargo, secao) DO NOTHING;

-- Garantir que as chaves granulares também estejam lá pro Designer
-- (caso não tenham sido ainda usadas por nenhum cargo)
INSERT INTO cargo_permissoes (cargo, secao, permitido) VALUES
  ('designer', 'home', true),
  ('designer', 'canaisaquisicao', true),
  ('designer', 'analytics', true),
  ('designer', 'campanhas', true),
  ('designer', 'criativos', true),
  ('designer', 'influenciadores', true),
  ('designer', 'personas', true),
  ('designer', 'keywords', true),
  ('designer', 'mercado', true),
  ('designer', 'referencias', true),
  ('designer', 'performance', true),
  ('designer', 'comunidade', true),
  ('designer', 'financeiro', true),
  ('designer', 'projecoes', true),
  ('designer', 'marketplaces', true),
  ('designer', 'canaisvendas', true),
  ('designer', 'provasocial', true),
  ('designer', 'apis', true),
  ('designer', 'tarefas', true),
  ('designer', 'roi', true),
  ('designer', 'relatorio', true),
  ('designer', 'calendario', true),
  ('designer', 'construtor', true),
  ('designer', 'briefingvisual', true),
  ('designer', 'calendario_criar', true),
  ('designer', 'calendario_excluir', true),
  ('designer', 'tarefas_criar', true),
  ('designer', 'tarefas_excluir', true),
  ('designer', 'briefing_criar', true),
  ('designer', 'briefing_editar', true),
  ('designer', 'briefing_excluir', true),
  ('designer', 'brandkit_criar', true),
  ('designer', 'brandkit_excluir', true),
  ('designer', 'canal_aquisicao_criar', true),
  ('designer', 'canal_aquisicao_editar', true),
  ('designer', 'canal_aquisicao_excluir', true),
  ('designer', 'criativo_criar', true),
  ('designer', 'criativo_aprovar', true),
  ('designer', 'criativo_publicar', true),
  ('designer', 'criativo_excluir', true)
ON CONFLICT (cargo, secao) DO NOTHING;

-- Verificação
SELECT cargo, COUNT(*) AS total_permissoes
FROM cargo_permissoes
WHERE cargo = 'designer'
GROUP BY cargo;
