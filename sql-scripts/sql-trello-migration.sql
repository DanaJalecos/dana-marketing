-- ══════════════════════════════════════════════════════════
-- Migração Trello → DMS Kanban
-- Rodar no Supabase SQL Editor
-- ══════════════════════════════════════════════════════════

-- 1. Adicionar campos extras na tabela tarefas
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS links text[];
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS cor text DEFAULT '';
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS data_inicio date;
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS data_fim date;
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS checklist jsonb DEFAULT '[]';

-- 2. Storage bucket para imagens do Kanban
INSERT INTO storage.buckets (id, name, public) VALUES ('kanban', 'kanban', true)
ON CONFLICT (id) DO NOTHING;

-- Policy para storage
CREATE POLICY "kanban_public_read" ON storage.objects FOR SELECT USING (bucket_id = 'kanban');
CREATE POLICY "kanban_auth_write" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'kanban');
CREATE POLICY "kanban_auth_delete" ON storage.objects FOR DELETE USING (bucket_id = 'kanban');

-- 3. Limpar tarefas antigas (se quiser começar limpo)
-- DELETE FROM tarefas;

-- 4. Inserir TODOS os cards do Trello

-- ══ MARCAS REFERÊNCIAS ══
INSERT INTO tarefas (titulo, descricao, coluna, tag, prioridade, posicao, links) VALUES
('John John | Compre online', 'Compre na loja online John John. www.johnjohndenim.com.br', 'referencias', 'Marcas', 'media', 0, ARRAY['https://www.johnjohndenim.com.br']),
('Saint Germain - Relógios', 'Saint Germain presente em todos os momentos. Relógios Masculinos e Femininos.', 'referencias', 'Marcas', 'media', 1, ARRAY['https://www.saintgermain.com.br']),
('Sephora', 'Loja online de cosméticos e beleza com frete grátis', 'referencias', 'Marcas', 'media', 2, ARRAY['https://www.sephora.com.br']),
('Arezzo', 'Referência de marca premium brasileira', 'referencias', 'Marcas', 'media', 3, ARRAY['https://www.arezzo.com.br']),
('Schutz', 'Referência de marca premium', 'referencias', 'Marcas', 'media', 4, ARRAY['https://www.schutz.com.br']),
('Lança Perfume', 'Outlet coleção — referência de moda', 'referencias', 'Marcas', 'media', 5, ARRAY['https://www.lancaperfume.com.br/outlet-colecao']),
('Vivara', 'Joias — referência de marca premium', 'referencias', 'Marcas', 'media', 6, ARRAY['https://www.vivara.com.br']),
('Luz da Lua', 'Referência de marca', 'referencias', 'Marcas', 'media', 7, ARRAY['https://www.luzdalua.com.br']),
('Tula', 'Referência de marca skincare', 'referencias', 'Marcas', 'media', 8, ARRAY['https://tula.com']);

-- ══ MATERIAIS ══
INSERT INTO tarefas (titulo, descricao, coluna, tag, prioridade, posicao, links) VALUES
('DANA - Google Drive', 'Pasta principal de materiais no Google Drive', 'materiais', 'Drive', 'alta', 0, ARRAY['https://drive.google.com']),
('Fotos ensaio 2024 - Google Drive', 'Fotos do ensaio fotográfico 2024', 'materiais', 'Fotos', 'alta', 1, ARRAY['https://drive.google.com']),
('Imagens com selo - Google Drive', 'Imagens com selo da marca', 'materiais', 'Fotos', 'media', 2, ARRAY['https://drive.google.com']),
('Linha office', 'Materiais da linha office', 'materiais', 'Produto', 'media', 3, NULL),
('Conteúdos finalizados', 'Conteúdos prontos para publicação', 'materiais', 'Conteúdo', 'media', 4, NULL),
('Ensaio 20/06', 'Ensaio fotográfico agendado', 'materiais', 'Fotos', 'media', 5, NULL);

-- ══ CAMPANHAS 2 TRI ══
INSERT INTO tarefas (titulo, descricao, coluna, tag, prioridade, posicao, data_inicio, data_fim) VALUES
('Campanha de frete grátis', 'Campanha de frete grátis Q2', 'campanhas', 'Campanha', 'alta', 0, '2026-04-27', '2026-05-03'),
('Novas cores Lorenzo/Clara e Benicio', 'Lançamento novas cores — prazo 9 abr', 'campanhas', 'Lançamento', 'alta', 1, NULL, '2026-04-09'),
('Campanha 10 anos', 'Campanha comemorativa 10 anos Dana Jalecos', 'campanhas', 'Campanha', 'alta', 2, NULL, NULL),
('Copa do mundo', 'Campanha temática Copa do Mundo', 'campanhas', 'Campanha', 'media', 3, NULL, NULL);

-- ══ PRODUÇÃO ══
INSERT INTO tarefas (titulo, descricao, coluna, tag, prioridade, posicao, checklist) VALUES
('Entrega final', 'Entrega final de produção', 'producao', 'Entrega', 'alta', 0, '[]'),
('Relançamento Jaleco Box (antecipação)', 'Antecipação do relançamento Jaleco Box', 'producao', 'Lançamento', 'alta', 1, '[]'),
('Carrossel fotos scrub confy bordo e jaleco manu com detalhes - Consu', 'Carrossel de fotos scrub confy bordo e jaleco manu com detalhes', 'producao', 'Conteúdo', 'media', 2, '[]'),
('Unboxing lançamento', 'Vídeo de unboxing do lançamento — 2 comentários, checklist 1/1', 'producao', 'Vídeo', 'media', 3, '[{"text":"Filmar unboxing","done":true}]'),
('Detalhes regata poliamida', 'Checklist: 1/1 Detalhes, 0/1 Teste poliamida, 0/1 3 formas de usar, 0/1 Look academia', 'producao', 'Produto', 'media', 4, '[{"text":"Detalhes regata","done":true},{"text":"Teste de poliamida","done":false},{"text":"3 formas de usar a regata","done":false},{"text":"Look academia","done":false}]');

-- ══ CRONOGRAMA MARÇO ══
INSERT INTO tarefas (titulo, descricao, coluna, tag, prioridade, posicao, data_fim) VALUES
('TRÁFEGO — Março', '1 anexo', 'cronograma', 'Tráfego', 'alta', 0, NULL),
('Ser mulher é...', 'Post 1 de março', 'cronograma', 'Conteúdo', 'media', 1, '2026-03-01'),
('A inicial que carrega sua história', 'Post 3 de março', 'cronograma', 'Conteúdo', 'media', 2, '2026-03-03'),
('CARROSSEL – SAÚDE DA MULHER COM RESPEITO E LEVEZA', 'Post 5 de março — 6 slides', 'cronograma', 'Carrossel', 'media', 3, '2026-03-05'),
('Uma carta para mulheres que sustentam vidas', 'Post 8 de março — Dia da Mulher — 8 slides', 'cronograma', 'Conteúdo', 'alta', 4, '2026-03-08'),
('Quando você compra na Dana...', 'Post 9 de março — 2 slides', 'cronograma', 'Conteúdo', 'media', 5, '2026-03-09'),
('Escolha de produtos + condição exclusiva', 'Post 11 de março — 1 slide', 'cronograma', 'Promo', 'media', 6, '2026-03-11'),
('Consuelo - Vídeo scrub com jaleco branco bordo e azul', 'Post 13 de março — 3 slides', 'cronograma', 'Vídeo', 'media', 7, '2026-03-13'),
('Antecipação Poliamida (1)', 'Post 16 de março — checklist 1/1', 'cronograma', 'Lançamento', 'media', 8, '2026-03-16'),
('Bastidores, produção', 'Post 18 de março', 'cronograma', 'Conteúdo', 'media', 9, '2026-03-18'),
('Antecipação Poliamida (2)', 'Post 20 de março', 'cronograma', 'Lançamento', 'media', 10, '2026-03-20'),
('Lançamento Oficial Poliamida', 'Manu e Florinda — checklist 1/1', 'cronograma', 'Lançamento', 'alta', 11, '2026-03-22'),
('CARROSSEL Regatas', 'Carrossel de regatas', 'cronograma', 'Carrossel', 'media', 12, NULL),
('Colégio Legacy (antecipação sobre padronização)', 'Antecipação padronização colégio', 'cronograma', 'B2B', 'media', 13, NULL);

-- ══ CRONOGRAMA ABRIL ══
INSERT INTO tarefas (titulo, descricao, coluna, tag, prioridade, posicao, data_fim) VALUES
('CARROSSEL Scrub Tec Easy masculino', 'Post 1 de abril — 6 slides', 'crono_abril', 'Carrossel', 'media', 0, '2026-04-01'),
('Loja Penha', 'Post 4 de abril — 1 slide', 'crono_abril', 'Loja', 'media', 1, '2026-04-04'),
('Looks faculdade', 'Post 6 de abril — 2 slides', 'crono_abril', 'Conteúdo', 'media', 2, '2026-04-06'),
('CARROSSEL Uniformização OralClin', 'Post 8 de abril — checklist 1/1, 27 interações', 'crono_abril', 'B2B', 'alta', 3, '2026-04-08'),
('Arrume-se comigo look poliamida', 'Post 11 de abril — checklist 1/1', 'crono_abril', 'Vídeo', 'media', 4, '2026-04-11'),
('Collab com influencer', 'Post 14 de abril — checklist 1/1', 'crono_abril', 'Influencer', 'alta', 5, '2026-04-14'),
('CARROSSEL com diversidades de fotos com prova social', 'Post 16 de abril — fotos humanizadas — 1 slide', 'crono_abril', 'Carrossel', 'media', 6, '2026-04-16'),
('Pov: turbantes perfeitos para o trabalho', 'Post 18 de abril', 'crono_abril', 'Vídeo', 'media', 7, '2026-04-18'),
('Depoimento OralClin sobre padronização', 'Post 20 de abril', 'crono_abril', 'B2B', 'media', 8, '2026-04-20'),
('Variação de cores regata poliamida', 'Post 22 de abril — checklist 1/1', 'crono_abril', 'Produto', 'media', 9, '2026-04-22');

-- ══ COMPRE E GANHE 02/04 - 12/04 ══
INSERT INTO tarefas (titulo, descricao, coluna, tag, prioridade, posicao) VALUES
('Visão geral — Compre e Ganhe', 'Visão geral da campanha compre e ganhe 02/04 a 12/04', 'campanhas', 'Compre e Ganhe', 'alta', 10),
('Condições comerciais — Compre e Ganhe', 'Condições comerciais da campanha', 'campanhas', 'Compre e Ganhe', 'alta', 11),
('Estrutura digital — Compre e Ganhe', 'Estrutura digital da campanha', 'campanhas', 'Compre e Ganhe', 'media', 12);

-- ══ TO DO - LUANA ══
INSERT INTO tarefas (titulo, descricao, coluna, tag, prioridade, posicao, checklist) VALUES
('ABRIL — Luana', 'Checklist 2/2 — 1 comentário', 'todo', 'Luana', 'alta', 0, '[{"text":"Item 1","done":true},{"text":"Item 2","done":true}]'),
('Observações — Luana', '1 comentário', 'todo', 'Luana', 'media', 1, '[]'),
('Criativos e banner - DANA TEAM', '1 comentário', 'todo', 'Luana', 'media', 2, '[]'),
('Banner equipe uniformizada e sua equipe', 'FAZER — 1 comentário, 3 slides', 'todo', 'Luana', 'alta', 3, '[]'),
('Landing page B2B', 'FAZER', 'todo', 'Luana', 'alta', 4, '[]'),
('Landing page site - caixa de assinatura', 'FAZER — 1 comentário', 'todo', 'Luana', 'alta', 5, '[]'),
('Fotos plus size e ambientadas para adicionar ao site', 'FAZER', 'todo', 'Luana', 'media', 6, '[]'),
('Catálogo Dana', 'EM ANDAMENTO — 1 comentário', 'todo', 'Luana', 'media', 7, '[]');

-- ══ ROTEIROS A PRODUZIR ══
INSERT INTO tarefas (titulo, descricao, coluna, tag, prioridade, posicao, links) VALUES
('Estilo Profissional com Jaleco', 'Roteiro para produzir', 'roteiros', 'Roteiro', 'media', 0, NULL),
('Compre e ganhe', 'Roteiro campanha compre e ganhe', 'roteiros', 'Roteiro', 'media', 1, NULL),
('São Leopoldo Mandic tráfego', 'Roteiro para tráfego São Leopoldo Mandic', 'roteiros', 'Tráfego', 'media', 2, NULL),
('[NS] Roteiros - Anúncios Meta Ads (Narrados ou Falados)', 'Roteiros para anúncios narrados ou falados — 1 comentário', 'roteiros', 'Ads', 'alta', 3, NULL),
('Jaleco Fashion em 3 Combos', 'Roteiro', 'roteiros', 'Roteiro', 'media', 4, NULL),
('Carrossel Nosso Diferencial em 3 Palavras', 'Roteiro carrossel', 'roteiros', 'Carrossel', 'media', 5, NULL),
('Carrossel - Uniforme é muito mais que roupa', 'Prazo 1 de maio', 'roteiros', 'Carrossel', 'media', 6, ARRAY['https://br.pinterest.com/pin/1050746156837676939/']),
('Eu já usei muitos jalecos. Mas nenhum como esse', 'Roteiro emocional', 'roteiros', 'Roteiro', 'media', 7, NULL),
('Jaleco Heloisa', 'Roteiro produto Heloisa', 'roteiros', 'Produto', 'media', 8, NULL),
('Humor — Elegância não aceita desculpas', 'Roteiro humor + "Você não desistiu"', 'roteiros', 'Humor', 'media', 9, NULL),
('Tráfego pago — Benefícios jaleco box', 'Roteiro tráfego', 'roteiros', 'Tráfego', 'alta', 10, NULL),
('[NS] Anúncios em vídeo focados no público B2B', 'Roteiro B2B', 'roteiros', 'B2B', 'alta', 11, NULL),
('[NS] Anúncios Meta Ads - Tipo UGC', 'Roteiro UGC', 'roteiros', 'UGC', 'alta', 12, ARRAY['https://pin.it/5IBTtkZ8t']),
('Produtos PARA TRABALHAR', 'Roteiro produtos', 'roteiros', 'Roteiro', 'media', 13, NULL),
('Dia da Black', 'Roteiro Black Friday', 'roteiros', 'Black', 'media', 14, NULL);

-- ══ CAMPANHAS ATIVAS ══
INSERT INTO tarefas (titulo, descricao, coluna, tag, prioridade, posicao, cor) VALUES
('Campanha Semana do Consumidor', 'Campanha ativa', 'campanhas_ativas', 'Ativa', 'alta', 0, '#1a7a3a'),
('Campanha Dia da Mulher', 'Campanha ativa — 1 anexo', 'campanhas_ativas', 'Ativa', 'alta', 1, '#1a7a3a'),
('Campanha de Professoras', 'Campanha ativa', 'campanhas_ativas', 'Ativa', 'media', 2, '#1a7a3a'),
('Campanha de Recompra', 'Campanha ativa — 1 anexo', 'campanhas_ativas', 'Ativa', 'alta', 3, '#1a7a3a'),
('Campanha de Jalecos e Scrubs', 'Campanha ativa', 'campanhas_ativas', 'Ativa', 'media', 4, '#1a7a3a'),
('Campanha de Alcance Reels Instagram', 'Campanha ativa', 'campanhas_ativas', 'Ativa', 'media', 5, '#1a7a3a'),
('Campanha de Visitas ao perfil do Instagram', 'Foco na localização da loja', 'campanhas_ativas', 'Ativa', 'media', 6, '#1a7a3a'),
('Campanha de Catálogo - Gorros, Jalecos e Scrubs', 'Campanha ativa', 'campanhas_ativas', 'Ativa', 'media', 7, '#1a7a3a'),
('Campanha de Volta às Aulas 2026', 'Planejada', 'campanhas_ativas', 'Planejada', 'media', 8, ''),
('Campanha The Last Dance', 'Planejada', 'campanhas_ativas', 'Planejada', 'media', 9, ''),
('Campanha CIOSP 2026', 'Planejada', 'campanhas_ativas', 'Planejada', 'media', 10, ''),
('Campanha de Assinatura Jaleco Box', 'Planejada', 'campanhas_ativas', 'Planejada', 'media', 11, ''),
('Campanha de Crachás Magnéticos', 'Planejada', 'campanhas_ativas', 'Planejada', 'media', 12, ''),
('Campanha de Artesãos/Ceramistas', 'Planejada', 'campanhas_ativas', 'Planejada', 'media', 13, ''),
('Campanha de Frete Grátis', 'Planejada', 'campanhas_ativas', 'Planejada', 'media', 14, '');

-- ══ TO DO - ÚLTIMA REUNIÃO ══
INSERT INTO tarefas (titulo, descricao, coluna, tag, prioridade, posicao, checklist) VALUES
('CONTEÚDO & STORIES', '2 comentários — checklist 2/12', 'todo_reuniao', 'Conteúdo', 'alta', 0, '[{"text":"Item 1","done":true},{"text":"Item 2","done":true},{"text":"Item 3","done":false},{"text":"Item 4","done":false},{"text":"Item 5","done":false},{"text":"Item 6","done":false},{"text":"Item 7","done":false},{"text":"Item 8","done":false},{"text":"Item 9","done":false},{"text":"Item 10","done":false},{"text":"Item 11","done":false},{"text":"Item 12","done":false}]'),
('BRANDING & VISUAL', '1 comentário — checklist 3/8', 'todo_reuniao', 'Branding', 'alta', 1, '[{"text":"Item 1","done":true},{"text":"Item 2","done":true},{"text":"Item 3","done":true},{"text":"Item 4","done":false},{"text":"Item 5","done":false},{"text":"Item 6","done":false},{"text":"Item 7","done":false},{"text":"Item 8","done":false}]'),
('UGC, PARCERIAS E CONTEÚDO REAL', '1 comentário — checklist 0/8', 'todo_reuniao', 'UGC', 'alta', 2, '[{"text":"Item 1","done":false},{"text":"Item 2","done":false},{"text":"Item 3","done":false},{"text":"Item 4","done":false},{"text":"Item 5","done":false},{"text":"Item 6","done":false},{"text":"Item 7","done":false},{"text":"Item 8","done":false}]'),
('Pecados capitais', '1 comentário, 1 slide', 'todo_reuniao', 'Conteúdo', 'media', 3, '[]'),
('Catálogo novo', 'Catálogo atualizado', 'todo_reuniao', 'Material', 'media', 4, '[]'),
('POSTAR A CADA 15 DIAS', 'Experiência de cor — 3 comentários, 3 slides', 'todo_reuniao', 'Conteúdo', 'media', 5, '[]'),
('Aumento de ticket', '1 comentário, 1 slide', 'todo_reuniao', 'Comercial', 'alta', 6, '[]');

-- ══ BLACK FRIDAY DANA ══
INSERT INTO tarefas (titulo, descricao, coluna, tag, prioridade, posicao, checklist) VALUES
('META! — Black Friday', 'Meta principal Black Friday Dana', 'black_friday', 'Meta', 'alta', 0, '[]'),
('Estrutura de promoções e condições', '3 comentários, 3 anexos', 'black_friday', 'Estrutura', 'alta', 1, '[]'),
('Checklist Black', 'Checklist 6/6 — tudo concluído', 'black_friday', 'Checklist', 'media', 2, '[{"text":"Item 1","done":true},{"text":"Item 2","done":true},{"text":"Item 3","done":true},{"text":"Item 4","done":true},{"text":"Item 5","done":true},{"text":"Item 6","done":true}]'),
('Ações Comerciais Black', 'Checklist 0/6', 'black_friday', 'Comercial', 'alta', 3, '[{"text":"Ação 1","done":false},{"text":"Ação 2","done":false},{"text":"Ação 3","done":false},{"text":"Ação 4","done":false},{"text":"Ação 5","done":false},{"text":"Ação 6","done":false}]'),
('Identidade/materiais visuais para serem seguidos', 'Materiais visuais de referência', 'black_friday', 'Visual', 'media', 4, '[]'),
('Grupo Black', 'Grupo de comunicação Black Friday', 'black_friday', 'Grupo', 'media', 5, '[]');

-- ══ INFORMAÇÕES JALECO BOX ══
INSERT INTO tarefas (titulo, descricao, coluna, tag, prioridade, posicao) VALUES
('O que é jaleco box?', 'Definição e conceito do Jaleco Box', 'info_jaleco_box', 'Info', 'media', 0),
('Descrição Jaleco Box', 'Descrição do produto/serviço', 'info_jaleco_box', 'Info', 'media', 1),
('Link da landing page', 'Link da LP do Jaleco Box', 'info_jaleco_box', 'Link', 'media', 2),
('Ajuda de conteúdo', 'Ideias e ajuda para conteúdo Jaleco Box', 'info_jaleco_box', 'Conteúdo', 'media', 3);

-- ══ 10 ANOS DANA ══
INSERT INTO tarefas (titulo, descricao, coluna, tag, prioridade, posicao) VALUES
('Marketing — 10 Anos Dana', 'Planejamento de marketing para campanha 10 anos', '10_anos', 'Marketing', 'alta', 0),
('Comercial — 10 Anos Dana', 'Planejamento comercial para campanha 10 anos', '10_anos', 'Comercial', 'alta', 1),
('Tráfego pago — 10 Anos Dana', 'Planejamento de tráfego para campanha 10 anos', '10_anos', 'Tráfego', 'alta', 2);

-- ══ CAMPANHAS 1 TRI ══
INSERT INTO tarefas (titulo, descricao, coluna, tag, prioridade, posicao, data_inicio, data_fim) VALUES
('Semana do Consumidor', 'Campanha Q1', 'campanhas_q1', 'Campanha', 'alta', 0, '2026-03-09', '2026-03-17'),
('Caixa de assinatura', 'Lançamento caixa de assinatura', 'campanhas_q1', 'Lançamento', 'alta', 1, '2026-03-16', '2026-03-22'),
('Início outono', 'Campanha início outono — 1 anexo', 'campanhas_q1', 'Campanha', 'media', 2, '2026-03-20', NULL),
('Lançamento regatas poliamida', 'Lançamento nova linha', 'campanhas_q1', 'Lançamento', 'alta', 3, '2026-03-23', NULL),
('Compre e ganhe linha office', 'Campanha compre e ganhe', 'campanhas_q1', 'Promo', 'alta', 4, '2026-04-01', '2026-04-12'),
('Detalhes definidos e pontos de atenção', 'IMPORTANTE — detalhes da campanha', 'campanhas_q1', 'Importante', 'alta', 5, NULL, NULL),
('Cupom FELIZ2026', 'Campanha cupom — 1 comentário', 'campanhas_q1', 'Cupom', 'media', 6, '2025-12-22', '2026-01-09'),
('CIOSP', 'Evento CIOSP', 'campanhas_q1', 'Evento', 'alta', 7, '2026-01-26', '2026-02-03'),
('Volta às aulas', 'Campanha volta às aulas', 'campanhas_q1', 'Campanha', 'media', 8, '2026-01-14', '2026-02-28'),
('Last Dance - SITE', 'Campanha last dance', 'campanhas_q1', 'Campanha', 'media', 9, '2026-02-19', '2026-02-28'),
('Dia da Mulher', 'Campanha Dia da Mulher', 'campanhas_q1', 'Campanha', 'alta', 10, NULL, NULL);
