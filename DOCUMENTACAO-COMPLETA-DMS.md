# DOCUMENTAÇÃO COMPLETA — DMS (Dana Marketing System)

> **Última atualização:** 29/04/2026 — ciclo 42 (sync histórico Bling 2018-2023, bugfixes, prospecção UX, gap RD Station)
> **Repo GitHub:** https://github.com/DanaComercial/dana-marketing
> **Site público:** https://danadash.netlify.app/ (auto-deploy via Netlify)
> **Supabase:** `wltmiqbhziefusnzmmkt`
> Este documento descreve TUDO que foi construído no sistema.
> Use-o como contexto em novos chats para o Claude entender o estado atual.

---

## 1. INFORMAÇÕES DA EMPRESA

- **Nome**: Dana Jalecos Exclusivos
- **Fundadora**: Daniela Binhotti Santos
- **Fundação**: 23/03/2016
- **Fábrica + loja física**: Piçarras SC (SC-414, nº 1322)
- **Loja física**: Balneário Camboriú SC (Centro)
- **Instagram**: @danajalecos (~63k seguidores)
- **Site**: danajalecos.com.br
- **WhatsApp**: (47) 99999-6754
- **Produtos**: jalecos, scrubs, uniformes profissionais de saúde
- **Canais de venda**: Site próprio, Mercado Livre, Shopee, TikTok Shop, Magalu (72+ canais no Bling)
- **ERP**: Bling v3 (OAuth2 read-only)
- **Rebranding**: versão nova 2026 (logos + Manual + fonte Northlane)

---

## 2. ARQUITETURA GERAL

### Stack
- **Frontend**: `index.html` único arquivo (~14.000 linhas) com HTML + CSS + JS inline
- **Backend**: Supabase (PostgreSQL + Edge Functions Deno + Realtime + Storage + Auth)
- **Hospedagem**: GitHub Pages (repo: `DanaComercial/dana-marketing`, branch `main`)
- **Auth**: Supabase Auth (email/senha)
- **Imagens**: Supabase Storage (bucket `kanban`, 1GB free)

### URLs importantes
- **Site produção**: https://danacomercial.github.io/dana-marketing/
- **Supabase**: https://comlppiwzniskjbeneos.supabase.co
- **Projeto Supabase**: `comlppiwzniskjbeneos`
- **GitHub repo**: https://github.com/DanaComercial/dana-marketing
- **Worktree local**: `C:\Users\Juan - Dana Jalecos\Documents\Sistema Marketing\.claude\worktrees\vibrant-davinci`
- **Trello original migrado**: https://trello.com/b/ASteNIOH/dana-jalecos
- **Export JSON Trello**: `C:\Users\Juan - Dana Jalecos\Documents\Sistema Marketing\ASteNIOH.json`

### Deploy
Branch `claude/vibrant-davinci` configurada com upstream em `origin/main`. Push via `git push origin HEAD:main` entrega direto pra produção (GH Pages rebuilda em ~1-2 min).

### Credenciais (PÚBLICAS - estão no frontend)
```javascript
SUPABASE_URL = 'https://comlppiwzniskjbeneos.supabase.co'
SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvbWxwcGl3em5pc2tqYmVuZW9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwODg2MjYsImV4cCI6MjA5MTY2NDYyNn0.jQOYaPklzSxQxTUd7rzktljHpW7ivbxbtilsUUi-TBE'

// Bling API (usadas apenas nas Edge Functions, service role key)
BLING_CLIENT_ID = 'bd02a35efc5c5b4eb2846d77fdc4d6f063b11d19'
BLING_CLIENT_SECRET = 'b2844954fea8b4d935c7aadc1f7f7d99c064792b2c9c2eecc2ab2eb0bb6e'
```

### Usuários admins
- **Dana Jalecos**: `ea3d8584-61dc-4d68-ae62-a5b3b81dc61d` · email `danajalecos@gmail.com` · cargo admin
- **Juan Rebelo**: `0f5a1d8e-7401-4965-9e41-b44bff7d6dd8` · cargo admin

---

## 3. TABELAS DO SUPABASE

### Tabelas de DADOS DO BLING (atualizadas via cron)
- `pedidos` (~8.700 registros) — id, numero, data, total, total_produtos, contato_nome, contato_tipo, situacao_id, loja_id, **vendedor_id**, **vendedor_nome** (🆕 abr/26)
- `contatos` (~28.500) — id, nome, telefone, celular, tipo_pessoa
- `contas_receber` (~6.800) — id, situacao, vencimento, valor, data_emissao, contato_nome, origem_tipo, origem_numero, conta_contabil
- `contas_pagar` (~11.700) — id, situacao, vencimento, valor, contato_id
- `produtos` (~2.200) — id, nome, codigo, preco, estoque_virtual, imagem_url
- `bling_tokens` (1 row com access_token + refresh_token do OAuth)
- `pedidos_itens` — id (uuid), pedido_id, produto_id, codigo, descricao, quantidade, valor_unitario, valor_total
- `vendedores` — id, nome, situacao, desconto_limite, loja_id (nomes vazios, só IDs disponíveis)

### Tabelas do SISTEMA (originais)
- `tarefas` (~460 cards do Trello + customizados) — id (uuid), titulo, descricao, coluna, prioridade, responsavel, tag, prazo, data_inicio, data_fim, posicao, links (text[]), cor, checklist (jsonb), concluido (bool), concluido_em (timestamp)
- `kanban_colunas` — id, coluna, label, cor, ordem, escondida (bool)
- `calendario` — id (uuid), titulo, descricao, tipo, data_inicio, data_fim
- `alertas` — id, tipo, nivel, titulo, mensagem, lido (bool), dados (jsonb), **destinatario_id** (UUID), **destinatario_nome**, **link_ref**, **link_label**, **audiencia** (dados_empresa/workflow/pessoal — 🆕 abr/26)
- `sync_log` — id, tabela, tipo, registros, status, erro, detalhes, created_at

### 🆕 Tabelas NOVAS (criadas neste ciclo)

#### `revendas_parceiros` — mapeia contatos Bling → revendas (Prova Social/Canais e Vendas)
- id (serial), contato_id (FK contatos), categoria ('nacional'|'internacional_parceria'), label_exibicao, local_ou_tipo, ordem, ativo

#### `briefings_campanha` — briefings salvos do Construtor
- id uuid, titulo, publico, problema, conceito, oferta, canais, orcamento, gancho, cta, headline, quote, pontos_ouro jsonb, nunca_dizer jsonb, dados jsonb, criado_por, criado_por_nome, created_at, updated_at

#### `materiais_briefing` — arquivos/links anexados a briefings
- id uuid, briefing_id (FK briefings_campanha ON DELETE CASCADE), url, nome, tipo ('imagem'|'video'|'pdf'|'link'|'outro'), mime_type, tamanho, storage_path, criado_por, criado_por_nome, created_at

#### `brandkit_itens` — biblioteca global de assets da marca
- id uuid, nome, descricao, categoria ('logo'|'foto'|'template'|'documento'|'outro'), url, tipo, mime_type, tamanho, storage_path, criado_por, criado_por_nome, created_at

#### `criativos` — workflow de aprovação de artes
- id uuid, titulo, briefing_id (FK briefings_campanha), briefing_titulo, arquivo_url (nullable, pra demandas to-do), storage_path, tipo, mime_type, tamanho, formato ('reels'|'feed'|'stories'|'carrossel'|'banner'|'outro'), designer_id, designer_nome, status ('aguardando'|'aprovado'|'reprovado'|'todo'|'publicado'), observacoes, feedback, feedback_por, feedback_por_nome, feedback_em, aprovado_por, aprovado_por_nome, aprovado_em, **aprovacao_comentario**, **solicitado_por** (to-do), **solicitado_por_nome**, **prioridade**, **prazo_entrega**, publicado_em, link_post, plataforma, versao, created_at, updated_at

#### `canais_aquisicao` — canais de marketing (pagos e orgânicos)
- id uuid, nome, tipo ('pago'|'organico'), investimento_mensal numeric, status ('ativo'|'pausado'|'inativo'), responsavel, link, observacoes, external_id, external_platform, external_synced_at, criado_por, criado_por_nome, created_at, updated_at

#### `concorrentes` — radar de mercado (CRUD da Dana + 4 seeds)
- id uuid, nome, link_instagram, link_tiktok, link_youtube, site, seguidores int, plataforma_principal, seguidores_atualizado_em, tag, observacoes, **eh_propria_marca** bool (true = Dana), criado_por, criado_por_nome, created_at, updated_at

#### `influenciadores` — CRUD de parcerias
- id uuid, nome, instagram, cidade, regiao, profissao, nicho, seguidores int, inicio_parceria date, status ('ativo'|'pausado'|'inativo'), contato, codigo_cupom, usos_cupom int, vendas_geradas int, receita numeric, observacoes, criado_por, criado_por_nome, created_at, updated_at
- **Seed inicial**: 16 influenciadores (Bianca, Verônica Rodrigues, Consuelo, FLOR DI LIZ, Kawana, Julia Gabriely, Samara Caroline, Guilherme Henrique, Eduardo Picanco, Rebeca Lima, Mariana Fuchs, Anita Guilherme, Yasmin Catherine, Antonia Silveira, Ester García, Suzana Perezin)

#### `referencias_conteudo` — ideias de conteúdo (vinculadas opcionalmente a influenciadores)
- id uuid, titulo, descricao, link, influenciador_id (FK influenciadores ON DELETE SET NULL), influenciador_nome cache, tipo_conteudo, status ('pendente'|'enviado'|'em_producao'|'gravado'|'editado'|'publicado'|'cancelado'), prioridade ('alta'|'media'|'baixa'), prazo date, observacoes, criado_por, criado_por_nome, created_at, updated_at

### Tabelas de AUTH / PERMISSÕES (mantidas)
- `profiles` — id (FK auth.users), nome, cargo, avatar_url, last_login, created_at
- `cargo_permissoes` — id, cargo, secao, permitido (bool)
- `activity_log` — id, user_id, user_nome, user_cargo, acao, detalhes, secao, created_at

### Views (recalculadas em tempo real, mantidas)
- `dashboard_resumo` — receita_2026, pedidos_2026, receita_2025, pedidos_2025, total_receber, total_pagar, total_contatos
- `dashboard_mensal` — agrupado por ano, mes, situacao_id com receita/pedidos total + splits por loja_id
- `dashboard_contas` — cp_aberto_qtd/valor, cp_atrasado, cr_aberto, cr_atrasado
- `cliente_scoring` — score 0-100, segmento (VIP/Frequente/Ocasional/Em Risco/Inativo)
- `funil_vendas`, `receita_historica`, `top_produtos`, `top_produtos_mes`

### Mapeamento loja_id → canal
```
0 ou NULL → Site (e-commerce)
203536978 → Loja/WhatsApp (Piçarras + BC + WhatsApp — MESMO canal no Bling, impossível separar sem mudar processo)
205337834 → Mercado Livre
205430008 → TikTok
205522474 → Shopee
default → Magalu
```

---

## 4. EDGE FUNCTIONS (Deno/TypeScript) — mantidas

- `sync-pedidos`, `sync-contas-receber`, `sync-contas-pagar`, `sync-produtos`, `sync-contatos`, `sync-pedidos-itens`
- `news-search`, `google-suggest`, `google-trends`, `criar-usuario`

Nenhuma Edge Function nova foi criada neste ciclo (tudo foi frontend + tabelas Supabase).

---

## 5. CRON JOBS (mantidos + novo de alertas)

| Nome | Horário | O que sincroniza |
|------|---------|-----------------|
| sync-pedidos-30min | `0,30 * * * *` | Pedidos |
| sync-pedidos-itens-30min | `10,40 * * * *` | Itens dos pedidos |
| sync-cr-aberto-1h | `5 * * * *` | Contas Receber situação 1 |
| sync-cr-atrasado-2h | `10 */2 * * *` | Contas Receber situação 3 |
| sync-cr-recebido-dia | `0 4 * * *` | Contas Receber situação 2 |
| sync-cp-aberto-1h | `15 * * * *` | Contas Pagar situação 1 |
| sync-cp-atrasado-2h | `35 */2 * * *` | Contas Pagar situação 3 |
| sync-cp-pago-dia | `0 5 * * *` | Contas Pagar situação 2 |
| sync-produtos-2h | `20 */2 * * *` | Produtos |
| sync-contatos-2h | `25 */2 * * *` | Contatos |
| gerar-alertas-30min | `5,35 * * * *` | Alertas gerais (estoque baixo, etc) |
| **gerar-alertas-prazos-diario** | `0 9 * * *` | **NOVO**: alertas de prazo de tarefas (hoje/amanhã) |

---

## 6. SEÇÕES DO DASHBOARD (sidebar) — ESTADO ATUAL

### PRINCIPAL
- **Dashboard** (home) — dados Bling (liveData)
- **🆕 Canais de Aquisição** — CRUD de canais pagos/orgânicos (tabela canais_aquisicao)
- **🆕 Analytics** — 10 cards de dashboards externos com logos oficiais + placeholder GA4 integrado
- **🆕 E-commerce** — KPIs + gráfico + top produtos/clientes do SITE (loja_id null)
- **🆕 Loja Física** — mesma estrutura pra Piçarras+BC+WhatsApp (loja_id 203536978)
- **Campanhas** — REESCRITA como placeholder honesto (aguardando APIs de ads)
- **Criativos** — FEATURE COMPLETA com tabs Aguardando/Aprovados/Reprovados/To-Do/Publicados (tabela criativos)
- **Influenciadores** — FEATURE COMPLETA com KPIs, filtros, tabela + aba Referências de Conteúdo (tabelas influenciadores + referencias_conteudo)
- **Públicos Ideais** (personas) — HARDCODED

### INTELIGÊNCIA
- **Palavras-Chave** — Google Suggest
- **Mercado e Tendências** — 4 abas:
  - Notícias do Nicho (Edge Function news-search)
  - Tendências de Busca (Google Suggest)
  - 🆕 **Monitoramento** — CRUD de concorrentes (tabela concorrentes com Dana + 4 seeds)
  - Oportunidades (HARDCODED)
- **Referências** — 7 categorias VAZIAS (placeholder)
- **Performance** — FUNIL + ANALYTICS REAL

### OPERACIONAL
- **Comunidade e CRM** — Scoring real
- **Financeiro** — 100% real
- **Projeções** — 100% real
- **Marketplaces** — 100% real
- **Canais e Vendas** — Canais de Venda DINÂMICO (via Bling) + Revendas dinâmicas (tabela revendas_parceiros) + Eventos hardcoded
- **Prova Social** — KPIs reais + Revendas dinâmicas (mesma tabela revendas_parceiros)
- **Conectar APIs** — formulários de config

### BRIEFING E MARCA
- **Briefing Visual** — 3 ABAS:
  - 📋 **Briefings Salvos** (Fase 1) — galeria dos briefings do Construtor
  - 🎨 **Materiais** (Fase 2) — biblioteca de arquivos/links por briefing
  - ✨ **Brand Kit** (Fase 3) — assets globais (logos, fotos, templates, documentos) + paleta + tipografia Northlane real

### SISTEMA
- **Administrador** — 3 abas (Usuários, Permissões, Atividades) — ganhou 10+ chaves granulares novas

### PRODUTIVIDADE (mantidas)
- Tarefas e Kanban, Calculadora ROI, Relatório Executivo, Calendário, Construtor de Campanha
- **Briefing Visual** — movido pra seção Briefing e Marca (acima)

### REMOVIDOS
- ❌ **Branding** — removida do menu; conteúdo (paleta, tipografia, categorias, modelos, tamanhos) mesclado no **Brand Kit**

### Seção especial
- **Meu Perfil** — acessada ao clicar no nome no sidebar

---

## 7. SISTEMA DE LOGIN E PERMISSÕES

### Cargos (10)
1. **admin** — acesso total
2. **gerente_marketing**
3. **gerente_comercial**
4. **gerente_financeiro**
5. **trafego_pago**
6. **producao_conteudo**
7. **🆕 designer** — seed com TODAS permissões true (admin ajusta)
8. **analista_marketplace**
9. **vendedor** (default novo usuário)
10. **expedicao**

### Sistema de permissões — chaves granulares

**Originais**: `calendario_criar`, `calendario_excluir`, `tarefas_criar`, `tarefas_excluir`

**🆕 Novas chaves adicionadas**:
- `briefing_criar`, `briefing_editar`, `briefing_excluir`
- `brandkit_criar`, `brandkit_excluir`
- `canal_aquisicao_criar`, `canal_aquisicao_editar`, `canal_aquisicao_excluir`
- `criativo_criar`, `criativo_aprovar`, `criativo_publicar`, `criativo_excluir`

### Log de atividades — novos eventos
`criou_briefing`, `duplicou_briefing`, `excluiu_briefing`, `imprimiu_briefing`, `adicionou_material`, `removeu_material`, `adicionou_brandkit`, `removeu_brandkit`, `importou_rebranding`, `enviou_arte`, `aprovou_arte`, `reprovou_arte`, `excluiu_criativo`, `publicou_arte`, `criou_demanda`, `editou_demanda`, `excluiu_demanda`, `adicionou_canal`, `editou_canal`, `excluiu_canal`, `adicionou_concorrente`, `editou_concorrente`, `removeu_concorrente`, `criou_influenciador`, `editou_influenciador`, `excluiu_influenciador`, `criou_referencia`, `editou_referencia`, `excluiu_referencia`

---

## 8. NOTIFICAÇÕES INTELIGENTES (NOVO)

### Schema
Tabela `alertas` foi estendida:
- `destinatario_id` UUID (null = global · uuid = pessoal)
- `destinatario_nome` TEXT
- `link_ref` TEXT (ex: 'criativos', 'tarefas-e-kanban')
- `link_label` TEXT (ex: 'Ver criativo')

### Eventos que disparam alertas personalizados
- **Arte aprovada/reprovada** → notifica designer (`designer_id` UUID)
- **Arte publicada** → notifica designer
- **Demanda de design atribuída** → notifica designer no To-Do
- **Tarefa atribuída no Kanban** (criar OU editar responsável) → notifica novo responsável
- **Cron diário 9h** (`gerar_alertas_prazos`): tarefas com prazo hoje → alerta urgent, prazo amanhã → alerta warn

### UI (bell 🔔)
- **Filtros**: Não lidas (default) · Lidas · Todas com contadores em tempo real
- **Scroll funcionando** (max-height 420px overflow-y auto)
- **Bolinha vermelha** baseada em `_alertasCache` (confiável, não DOM)
- **Ao abrir** recarrega alertas (captura alertas perdidos pelo realtime)
- **Clique no alerta** marca lido automaticamente
- **Deep-link** clicando "Ver criativo →" ou "Ver tarefa →":
  - Navega pra seção
  - Troca pra aba correta (aprovado/reprovado/aguardando)
  - Scroll + highlight azul do card específico
  - Em tarefas: abre modal completo da tarefa
- **Marcar todas lidas** (botão no header)
- **Realtime** filtra pra não mostrar toast de alerta de outros usuários

### Fixes importantes (cadeia de bugs resolvidos)
1. RLS bloqueava INSERT → policies permissivas `auth.role() = 'authenticated'`
2. Coluna `tipo` NOT NULL faltando → derivado de `dados.tipo` ou default 'notificacao'
3. CHECK constraint restritivo em `tipo` → removido (tipos agora livres)
4. Bell não recarregava ao abrir → `toggleNotif` agora chama `loadAlertas`
5. Deep-link pra tarefa chamava `abrirTarefa` (não existe) → corrigido pra `openTarefa`
6. Alertas usavam match por nome → agora usam UUID direto (designer_id, responsavel_id)

---

## 9. SEÇÃO KANBAN (mantido)

Tudo igual, adicionado:
- **Seletor de Responsável via profiles** (não mais input livre)
- **Notificação automática** ao criar tarefa ou editar responsável
- **Alertas de prazo** diários via cron SQL

---

## 10. SEÇÃO BRIEFING VISUAL (NOVA)

Tabs:

### 📋 Briefings Salvos (Fase 1)
- Galeria de cards dos briefings gerados pelo Construtor de Campanha
- `saveBriefing()` agora INSERT no banco (antes era só toast)
- Modal detalhes com: título, público, problema, conceito, oferta, canais, investimento, gancho, CTA, autor, data
- Botões: **🖨 Imprimir** (janela nova A4 print-friendly), **📋 Duplicar** (modal com nome), **🗑 Excluir** (apaga DB + arquivos Storage em bulk)

### 🎨 Materiais (Fase 2)
**Dois lugares**:
1. Dentro do modal Ver Briefing — seção "Materiais da Campanha" com upload e grid
2. Aba top-level "Materiais" — galeria de TODOS materiais de todos os briefings com filtros

- Upload de arquivos (imagens/videos/PDFs até 50MB) + links externos
- Auto-detect tipo (imagem/video/pdf/link/outro)
- Filtros: Todos · 🖼 Imagens · 🎬 Vídeos · 📄 PDFs · 🔗 Links
- Cards mostram briefing de origem, tipo, data, autor
- Excluir apaga do DB + Storage

### ✨ Brand Kit (Fase 3)
- Header compacto:
  - **🎨 Paleta da Marca** — preto #000000 + branco #FFFFFF (pills clicáveis que copiam hex) 
  - **✏️ Tipografia** — Northlane REAL (fonte oficial carregada via @font-face) + DM Sans
  - Botão "⬇ Baixar fonte" link Pixeldrain
  - Clicar Northlane abre Manual da Marca automaticamente
- **👕 Portfólio de Produtos** — 13 categorias (Jalecos, Scrubs, etc) + Modelos de Jalecos (Manuela, Isabel, Chloe, Samuel, Manoel, Heloisa, Clara, Benicio) + Linhas Scrub (Tradicional, Comfy, Glamour) + Tamanhos (PPP ao G3)
- **📦 Biblioteca de Assets**:
  - Botão **⚡ Importar Rebranding** — upload rápido dos 5 arquivos com auto-categorização
  - Botão **📷 Arquivo** — abre modal com nome + categoria + descrição/tag
  - Botão **🔗 Link** — inline com 4 campos (URL, nome, categoria, descrição)
  - Filtros: Todos · 🏷 Logos · 📸 Fotos · 🎨 Templates · 📄 Documentos · 📎 Outros
  - **Logo cards**: fundo xadrez transparente + download overlay + preview grande + botões Baixar/Ver
  - **PDF cards**: gradient vermelho + ícone 📄 + selo "PDF·DOCUMENTO" + botões Abrir/Baixar
  - Badge descrição em todos os cards

### Arquivos relacionados
- `sql-scripts/sql-briefings-campanha.sql`
- `sql-scripts/sql-materiais-briefing.sql`
- `sql-scripts/sql-brandkit-itens.sql`
- `assets/fonts/Northlane-One.otf`
- `assets/fonts/Northlane-Two.otf`
- `docs/GA4-SETUP-GUIDE.md`

---

## 11. SEÇÃO CRIATIVOS (NOVA — workflow completo)

### Fase 1: Workflow de aprovação
- **Enviar arte**: modal com toggle Arquivo/Link, briefing vinculado, formato (Reels/Feed/Stories/Carrossel/Banner/Outro), designer (profiles), observações
- **Tabs funcionais**: Aguardando Aprovação · Aprovados · Reprovados
- **Aprovar**: modal com comentário opcional → notifica designer
- **Reprovar**: modal exige feedback → notifica designer
- **Desfazer aprovação**: volta pra aguardando
- **Excluir**: confirma + apaga DB e Storage
- **Filtros por briefing** (chips dinâmicos)

### Fase 2: To-Do + Publicados
- **Aba To-Do Design**:
  - Botão "+ Nova demanda"
  - Cards ordenados por prioridade > prazo
  - Borda colorida por prioridade (🔴 alta / 🟡 média / 🟢 baixa)
  - Chip de prazo inteligente: ⚠ Atrasado / 🚨 Hoje / ⏰ Em Nd
  - Notifica designer atribuído
  - Botão "↑ Enviar arte" transforma demanda em criativo (UPDATE status todo→aguardando)
- **Aba Publicados**:
  - Modal "🚀 Publicar" com plataforma (Instagram/TikTok/FB/LinkedIn/YouTube/X/Pinterest/email/site), data, link_post
  - Notifica designer "sua arte foi ao ar!"
  - Cards com ícone da plataforma + link clicável
  - Botão desfazer → volta pra aprovado

### Arquivos
- `sql-scripts/sql-criativos.sql`
- `sql-scripts/sql-criativos-add-comentario.sql` (migration do `aprovacao_comentario`)
- `sql-scripts/sql-criativos-fase2.sql` (arquivo_url nullable + colunas de demanda)

---

## 12. SEÇÃO INFLUENCIADORES (NOVA — CRUD + Referências)

### Fase 1: CRUD de Influenciadores
- **4 KPIs dinâmicos**: Total · Receita Total · Taxa de Conversão Média · Top Performer
- **3 Filtros**: Status · Nicho (dinâmico) · Região (5 regiões)
- **Tabela com 11 colunas**: Nome · Instagram (link) · Nicho · Região · Status · Seguidores · Usos Cupom · Vendas · Receita · Conversão · Ações
- **Modal com 14 campos**: Nome*, Instagram*, Cidade, Região, Profissão, Nicho, Seguidores, Início Parceria, Status, Contato, Código Cupom, Usos, Vendas, Receita, Observações
- **16 influenciadores seed** (todos ativos)

### Fase 2: Referências de Conteúdo
- **4 KPIs**: Total · Pendentes · Em Produção · Publicados
- **Filtro de Status** (8 opções com emojis)
- **Grid de cards 320px**:
  - Título, descrição, chips (status/prioridade/tipo), link "Ver referência", influenciador vinculado, prazo
  - Select "Mudar Status" inline (troca direto)
- **Modal com 9 campos**: Título*, Descrição, Link, Influenciador (select), Tipo Conteúdo, Status, Prioridade, Prazo, Observações
- **Workflow**: Pendente → Enviado → Em Produção → Gravado → Editado → Publicado (+ Cancelado)

### Arquivos
- `sql-scripts/sql-influenciadores.sql`
- `sql-scripts/sql-referencias-conteudo.sql`

---

## 13. SEÇÕES NOVAS DE ANALYTICS / VENDAS

### 📊 Analytics (nova)
- 10 cards coloridos com logos oficiais (PNGs/SVGs) linkando pros dashboards nativos:
  - Meta Business Suite, Meta Ads Manager, GA4 (dashboard oficial), Google Ads, Search Console, TikTok Ads Manager, TikTok Studio, Mercado Livre, Shopee Seller, Instagram Insights
- **Placeholder GA4 Integração Nativa** — aguardando Service Account (guia em `docs/GA4-SETUP-GUIDE.md`)

### 🌐 E-commerce (nova)
- Filtro de período: mês atual / acumulado 2026 / ano 2025
- 4 KPIs: Faturamento · Pedidos · Ticket Médio · Share do Total
- Gráfico mensal (últimos 12 meses)
- Top 10 produtos + Top 10 clientes
- Query base: `pedidos WHERE loja_id IS NULL OR loja_id = 0`

### 🏪 Loja Física + WhatsApp (nova)
- Mesma estrutura do E-commerce + gráfico de vendas por dia da semana
- Aviso sobre limitação do Bling (3 canais compartilhando mesmo loja_id)
- Query base: `pedidos WHERE loja_id = 203536978`

### 📢 Canais de Aquisição (nova)
- 4 KPIs: Canais Ativos · Investimento/Mês · Canais Pagos · Canais Orgânicos
- 2 colunas: 💰 Canais Pagos · 🌱 Canais Orgânicos
- Modal com: nome, tipo (pago/orgânico), status, investimento, responsável, link, observações
- Banner sobre integração futura com APIs

### Arquivos
- `sql-scripts/sql-canais-aquisicao.sql`

---

## 14. MERCADO E TENDÊNCIAS (expandido)

### 🎯 Concorrentes — CRUD completo
- Dana incluída como card verde especial (flag `eh_propria_marca=true`)
- 4 concorrentes seed: Dra. Cherie, Farcoo, Jalecos Conforto, Grafitte Jalecos
- Modal com 11 campos: nome, tag, 3 links (IG/TikTok/YouTube), site, seguidores, plataforma principal, observações
- **Botões condicionais nos cards** (só aparecem se link preenchido):
  - 📸 IG · 🎵 TT · ▶ YT · 📊 Socialblade (auto-gerado do URL YouTube) · 🌐 Site
  - ✏️ Editar (sempre) · 🗑 Excluir (só concorrentes, não Dana)
- **Comparativo dinâmico** de alcance (ordenado por seguidores)

### Arquivos
- `sql-scripts/sql-concorrentes.sql`

---

## 15. SINCRONIZAÇÃO REALTIME ENTRE PCs (NOVA)

Canais realtime adicionados no frontend:
- `realtime-criativos`
- `realtime-briefings`
- `realtime-materiais`
- `realtime-brandkit`
- `realtime-canais`
- `realtime-concorrentes`
- `realtime-influenciadores`
- `realtime-referencias`
- `realtime-alertas` (existia, melhorado)
- `realtime-tarefas` (existia)
- `realtime-calendario` (existia)

SQL `sql-scripts/sql-realtime-enable.sql` adiciona todas as tabelas novas à publicação `supabase_realtime` (idempotente).

**Efeito**: excluir arte/briefing/material/etc num PC faz sumir no outro instantaneamente.

---

## 16. URL DEEP-LINKING (NOVA)

Sistema de hash-based routing:
- Cada seção tem slug gerada do title (ex: "Briefing Visual" → `#briefing-visual`)
- Funções `buildSlugMaps()`, `VIEW_ID_TO_SLUG`, `VIEW_SLUG_TO_ID`
- `go()` chama `history.pushState` → URL atualiza
- `popstate` event pra back/forward browser
- Init prioriza: URL hash → localStorage → dashboard default
- Alertas têm deep-link via `link_ref` + `dados.criativo_id`/`tarefa_id`

---

## 17. ARQUIVOS IMPORTANTES NO WORKTREE

```
gracious-edison/
├── index.html                              # ~14k linhas, tudo inline
├── edge-functions/                         # (mantidas)
│   ├── sync-pedidos.ts, sync-contas-receber.ts, etc.
├── sql-scripts/
│   ├── [originais mantidos]
│   ├── sql-revendas-parceiros.sql          # 🆕
│   ├── sql-briefings-campanha.sql          # 🆕
│   ├── sql-materiais-briefing.sql          # 🆕
│   ├── sql-brandkit-itens.sql              # 🆕
│   ├── sql-criativos.sql                   # 🆕
│   ├── sql-criativos-add-comentario.sql    # 🆕
│   ├── sql-criativos-fase2.sql             # 🆕
│   ├── sql-canais-aquisicao.sql            # 🆕
│   ├── sql-concorrentes.sql                # 🆕
│   ├── sql-influenciadores.sql             # 🆕
│   ├── sql-referencias-conteudo.sql        # 🆕
│   ├── sql-alertas-personalizados.sql      # 🆕 (destinatario_id + cron prazos)
│   ├── sql-alertas-fix-rls.sql             # 🆕 (RLS fix)
│   ├── sql-alertas-fix-tipo.sql            # 🆕 (migração da função prazos)
│   ├── sql-alertas-drop-tipo-check.sql     # 🆕 (remove CHECK constraint)
│   ├── sql-realtime-enable.sql             # 🆕 (publica tabelas no realtime)
│   ├── sql-seed-designer.sql               # 🆕 (seeda permissões do novo cargo)
│   └── sql-debug-storage-kanban.sql        # 🆕 (diagnóstico)
├── assets/fonts/                           # 🆕
│   ├── Northlane-One.otf
│   └── Northlane-Two.otf
├── docs/                                   # 🆕
│   └── GA4-SETUP-GUIDE.md                  # guia pra Dana configurar Service Account
└── .claude/
    ├── launch.json
    └── settings.local.json
```

---

## 18. DEPLOY E GIT

- **Branch**: `claude/gracious-edison` com upstream em `origin/main`
- **Push**: `git push origin HEAD:main` (deploy direto pra GH Pages)
- **Commits deste ciclo**: ~45 commits desde o início

### Últimos commits importantes
- `84b833c` — Influenciadores Fase 1
- `b79c513` — Influenciadores Fase 2 (Referências de Conteúdo)
- `a55107d` — Fix badges sidebar
- `82419e4` — Concorrentes CRUD
- `1fc106a` — E-commerce + Loja Física
- `65c78f5` — Analytics section
- `0053fe1` — Criativos Fase 2
- `9750645` — Criativos Fase 1

---

## 19. O QUE FUNCIONA 100% AUTOMÁTICO HOJE

✅ Sync Bling → Supabase (10 cron jobs rodando)
✅ Supabase → Site (refresh 5min + Realtime)
✅ Login com Supabase Auth
✅ **10 cargos** × ~30 seções + ações granulares (13 novas chaves granulares)
✅ Log de atividades (30+ eventos registrados)
✅ Kanban com CRUD + notificação ao atribuir responsável
✅ Upload de imagens para Storage
✅ Calendário integrado com tarefas
✅ **Notificações inteligentes personalizadas** (bell com filtros + deep-link)
✅ **Alertas de prazo** diários via cron SQL (9h)
✅ **Sync realtime entre PCs** (8 canais realtime)
✅ Briefing Visual (3 fases completas)
✅ Criativos (2 fases completas)
✅ Influenciadores (2 fases completas)
✅ Canais de Aquisição, Concorrentes, E-commerce, Loja Física, Analytics

---

## 20. PENDENTE PRA FUTURO

### Analytics — Google Analytics 4 integrado (Parte C)
Dana precisa completar o setup do Service Account seguindo `docs/GA4-SETUP-GUIDE.md`. Quando ela mandar o JSON + Property ID, precisa:
1. Salvar JSON como Supabase Secret
2. Criar Edge Function `ga4-sync`
3. Criar tabela `ga4_config` / `ga4_snapshots`
4. Substituir placeholder do GA4 por dashboard real

### Campanhas
Aguardando Meta Ads + Google Ads + TikTok Ads APIs (App Review da Meta demora 2-8 semanas).

### Referências (antiga, vazia)
Seção `Referências` do menu (categorias Instagram/Facebook/TikTok/YouTube/Pinterest/LinkedIn/Blog) ainda vazia, aguardando uploads.

### Prova Social — botão "Novo Conteúdo" sem função
Botão `Novo Conteúdo` na topbar quando a view `provasocial` está ativa está mapeado em `VIEW_META` mas não tem handler. Clicar não faz nada.

Antes de implementar, **precisa da Dana/Juan definir o fluxo real de UGC**:
1. Quem cria conteúdo? cliente posta no Instagram / envia no WhatsApp / escreve review no site?
2. Onde fica guardado hoje? Só Instagram / pasta Drive / planilha?
3. Precisa workflow de aprovação (pendente → aprovado → publicado) tipo Criativos?

Opções depois da resposta:
- **A (MVP CRUD)**: tabela `prova_social_conteudos` (tipo, título, autor @, link, descrição, status), modal de criação, grid na view, botões aprovar/rejeitar. ~30 min de implementação.
- **B (link externo)**: botão só abre Instagram DM ou pasta Drive com UGC.
- **C (remover)**: tira o botão da topbar pra `provasocial` enquanto não tem fluxo.

### Outras pontas soltas
- Publicados do Criativos poderia puxar métricas reais quando conectar Meta/Instagram API
- Separar Piçarras vs BC nas vendas físicas exige mudar processo no Bling (usar vendedor diferente)
- Integração com Reportei ou equivalente — discutido mas adiado
- **Magazord API** — Dana precisa enviar email pra `integracao@magazord.com.br` solicitando credenciais pra puxar dados de influenciadores/cupons que o Bling não tem

---

## 21. CICLO 17-20/04/2026 — NOVIDADES E CORREÇÕES

### Persona Real (Públicos Ideais · data-driven)
Seção original mantém as 5 personas aspiracionais (Dra. Mariana, Diretor Gabriel, Coord. Eduardo, Profissional Liberal, Estudante). Acrescentado:

- **Ranking no topo** (card preto) — mostra qual das 5 personas mais representa a base real (baseado em classificação automática de clientes Bling)
- **Bloco "📊 Realidade nos Dados · Bling"** dentro de cada persona com: % receita, receita 12m, clientes, ticket médio, pedidos/cliente, canal principal
- **Status inteligente**: 🟢 ATIVO (≥15% receita) · 🟡 MODERADO (≥5%) · 🔴 ASPIRACIONAL (<5%) · ⚪ Sem representação
- **Chip no Step 1 do Construtor de Campanha**: cada card de público mostra "X% da base real · R$ Y/ano"

**Função de classificação** (`classifyClienteToPersona` no frontend):
| Perfil | Persona |
|--------|---------|
| PJ · ticket > R$1.500 | Empresas (Diretor Gabriel) |
| PJ · 1 pedido · ticket ≥ R$700 | Instituições (Coord. Eduardo) |
| PJ · 2+ pedidos · ticket ≥ R$400 | Clínicas (Dra. Mariana) |
| PJ · restante | Clínicas (default) |
| PF · ticket ≥ R$450 ou 2+ pedidos | Profissional Liberal |
| PF · ticket baixo · 1 pedido | Estudante |

Cache 5min pra não martelar Supabase. Paginação 1000/query.

### Mobile Responsive (URL unificada)
Trabalho grande de 13 iterações (mobile 1.0 → 1.13). Todo o CSS mobile está dentro de um bloco `@media (max-width: 768px)` no próprio `index.html`. **Não tem arquivo separado** — mesma URL (`danacomercial.github.io/dana-marketing/`) pra celular e desktop.

Principais componentes:
- **Hamburger button** (☰) fixo canto superior esquerdo + botão X dentro da sidebar
- **Overlay** escuro quando sidebar aberta
- **Sidebar vira drawer** com `transform: translateX(-100%)` + transition
- **Topbar sticky** no topo
- Grids `.kpi-grid`/`.g2`/`.g3`/`.g4` → 1 coluna
- Tabelas convertidas em cards (Influenciadores, Comunidade/CRM via render JS condicional `window.innerWidth <= 768`)
- Gráficos comprimidos (font 7px, labels truncados)
- Tabs em `flex-wrap` em vez de scroll horizontal
- Kanban **mantém scroll horizontal** (exceção — empilhar quebrava visual)
- Modais em tela cheia com `overflow-y: auto` e padding-bottom 24px
- Admin permissões em dropdown de cargo + lista de seções (em vez de tabela)
- Regras agressivas pra `auto-fill`/`auto-fit`/`minmax()` inline → 1fr
- `body:has(.modal-overlay.open) .mobile-menu-btn { display: none }` — hamburger some em modais

Baseado em auditoria técnica feita com Playwright (relatório em `C:\Users\Juan - Dana Jalecos\Documents\Sistema Marketing\RELATORIO ERROS SITE MOBILE\`).

### Exportar PDF (7 seções)
Botão "Exportar PDF" no topbar quando está em:
- Relatório Executivo
- Financeiro
- E-commerce
- Loja Física + WhatsApp
- Marketplaces
- Projeções
- Performance

Função genérica `exportarViewPDF(viewId, titulo)` abre nova janela com CSS print-friendly (Syne + DM Sans, header preto, KPI cards, grids preservados) e dispara `window.print()` automático em 400ms. CSS custom properties (`--black`, `--grey3`, `--green`, etc) incluídas no style pra gráficos renderizarem corretamente. `-webkit-print-color-adjust: exact` em `*` pra preservar cores/backgrounds.

Dispatch via `topbarAction()` com lookup em `EXPORT_PDF_VIEWS` map.

### Sync de Itens (pedidos_itens) corrigido
Situação: `sync-pedidos-itens-30min` rodava 1x em 24h apesar do cron ativo. Causa: bug no `.slice(0, 100)` só checava existentes nos primeiros 100 pedidos do lote de 500, forçando retrabalho e timeout silencioso no Edge Runtime.

**Correções aplicadas em `sync-pedidos-itens.ts`:**
- Check de existentes em chunks de 100 cobrindo TODOS os pedidos do lote
- Grava `tabela='pedidos_itens'` no sync_log (antes era NULL, dificultava filtro)
- `resp?.data` com optional chaining defensivo
- Upsert com `?.error` defensivo

**NOVA Edge Function** `sync-pedidos-itens-backfill.ts`:
- Processa pedidos de 2026-01-01 em diante (pedidos de 2025 não são tocados)
- Body: `{"inicio":"2026-01-01","limite":50}`
- DEFAULT_LIMITE reduzido de 300 → 50 (CPU time do Edge Runtime abortava com 150)
- MAX_LIMITE 100

**Resultado:** cobertura de itens de 2026 subiu de 22.6% → 100% em ~3 horas.

### Vendedor nos pedidos (filtro correto do Site)
Dana confirmou "no site só vendemos R$72k em abril" mas E-commerce no DMS mostrava R$195k. Investigação:

**Causa raiz:** Bling usa `loja_id=0` como default pra TUDO que não é marketplace/loja física. Vendas B2B manuais lançadas no Bling caem com `loja_id=0` junto com as do site real, inflando o total.

**Solução:** a Dana tem um vendedor cadastrado no Bling chamado "Site" (código 156, id `4283606619`). Pedidos reais do checkout do danajalecos.com.br recebem esse vendedor automaticamente via integração Magazord→Bling. Vendas manuais não têm vendedor.

**Implementação:**
- ALTER TABLE pedidos ADD vendedor_id, vendedor_nome + indexes
- `sync-pedidos-itens.ts` enriquece pedidos com vendedor no MESMO loop que pega itens (aproveita o GET detalhado)
- `sync-pedidos-itens-backfill.ts` também
- **NOVA Edge Function** `sync-pedidos-vendedor-backfill.ts` — dedicada a preencher vendedor em pedidos antigos sem `vendedor_id`. Body: `{"inicio":"2026-01-01","limite":50}`
- Frontend `queryPedidosPorCanal('site')` filtra por `vendedor_id = VENDEDOR_ID_SITE` (constante = `4283606619`)
- **Fallback total_produtos**: Bling zera `total` pra pedidos do site. Frontend usa `total || total_produtos` como valor efetivo.

**Backfill rodando a cada 15min via cron `sync-pedidos-vendedor-backfill-15min` processando 50 pedidos/execução. Leva ~10h para fechar todos os 2.262 pedidos de 2026.**

### Alertas · correções e refatoração grande

#### Problema antigo: "50 notificações que voltam"
- Frontend `loadAlertas()` tinha `.limit(50)` hardcoded. Alertas lidos antigos sumiam da lista quando novos chegavam.
- Função SQL `gerar_alertas()` recria alertas dos MESMOS produtos a cada 24h (dedupe curto).
- Combinação: o bell sempre mostrava 50 "não lidas" de novo.

**Fix:**
- Frontend `.limit(50)` → `.limit(500)`
- SQL `sql-alertas-fix-dedup-purge.sql`:
  - Dedupe 24h → **7 dias** em `gerar_alertas()`
  - DELETE de duplicatas históricas (mantém 1 por produto_id)
  - DELETE de alertas lidos com mais de 30 dias
- Botão **"🗑 Apagar lidas"** no dropdown do bell (vermelho, aparece só se tem lidos)

#### Audiência por cargo (`sql-alertas-audiencia.sql`)
Coluna nova na tabela `alertas`: `audiencia` TEXT com valores:
- `dados_empresa` → só admin + gerente_comercial + gerente_financeiro (estoque, financeiro, vendas, clientes)
- `workflow` → todos com acesso à seção (criativos, tarefas, prazos)
- `pessoal` → só destinatario_id específico

Designer, producao_conteudo, vendedor, etc. **não recebem mais alertas de estoque/financeiro**.

Frontend (`loadAlertas()` e `realtime-alertas`) filtra client-side usando `CARGOS_DADOS_EMPRESA = ['admin','gerente_comercial','gerente_financeiro']`.

**Camada 2 não feita**: lido continua global entre admins. Quando Dana tiver mais de 2 admins + precisar isolar leitura, criar tabela `alertas_usuario (alerta_id, user_id, lido, apagado)`.

### Segurança · Hardening
Falha descoberta: designer podia acessar URL `/#administrador` direto, bypassing a verificação de permissão.

**Fixes:**

#### Client-side (`index.html`)
- Constante `ADMIN_ONLY_VIEWS = ['admin']`
- `go()` checa primeiro: se view é admin-only + cargo != 'admin' → bloqueia + toast "🚫 Acesso negado" + redireciona pra home
- Cobre todos caminhos: clique sidebar, URL hash, popstate (botão voltar), init da página

#### Server-side (`sql-rls-seguranca.sql` + `sql-rls-limpar-duplicadas.sql`)
RLS policies + função `is_admin()`:
- `profiles`: admin muda cargo de outros; user só muda próprio nome/avatar. Trigger `prevent_self_cargo_change` impede non-admin de alterar próprio cargo.
- `cargo_permissoes`: SELECT livre, escrita só admin
- `alertas`: DELETE só admin ou próprio destinatário
- `bling_tokens`: zero acesso pra authenticated (só service_role)
- `activity_log`: SELECT só admin, INSERT só com `user_id = auth.uid()`

Script de limpeza `sql-rls-limpar-duplicadas.sql` removeu 13 policies antigas que anulavam a segurança (OR entre PERMISSIVEs).

Resultado: 18 policies finais, nenhuma duplicada. Mesmo modificando `currentProfile.cargo = 'admin'` via DevTools, operações críticas no banco são negadas.

### Migração Trello → DMS
Arquivo `ASteNIOH.json` (3MB, 487 cards, 54 listas) com export completo do Trello. Cards com `dueComplete: true` mapeados pros títulos no DMS.

**Critério rigoroso:**
- Match só por título EXATO normalizado (lowercase, sem acentos, sem pontuação)
- Só coluna visível ativa (excluída coluna `arquivo`, colunas escondidas)
- Só títulos ÚNICOS no DMS (descartados duplicados pra evitar marcar errado)

**Resultado:** 28 tarefas marcadas como concluídas automaticamente. Duplicatas (Volta ás aulas, FOTO+LEGENDA, Campanha de Frete Grátis) ficaram pro Juan/Dana decidirem manualmente.

### Views otimizadas
`sql-views-top-produtos-marketplaces.sql`:
- `top_produtos_marketplaces` (all time)
- `top_produtos_marketplaces_mes` (por mês)
- Filtro: `loja_id IS NOT NULL AND loja_id != 0 AND loja_id != 203536978`
- Exclui site + loja física → só ML/Shopee/TikTok/Magalu
- Seção Marketplaces no frontend usa essas views (antes usava `top_produtos` geral, mostrava dados errados)

### Fixes diversos
- **Perfil F5**: `window.load` virou async com `await checkAuth()` antes de restaurar view do hash/localStorage. Antes `loadPerfilView()` rodava com `currentProfile = null` → mostrava "--"
- **Admin entra vazio**: `go('admin')` força classe `.active` no primeiro tab + painel `admin-usuarios` antes de chamar `loadAdminUsers()`
- **Exportar PDF**: `</script>` dentro de template literal fecha script pai → trocado por `<\/script>`
- **Acentuação**: CARGO_LABELS (Tráfego, Produção, Expedição), admin tabs (Usuários, Permissões, Relatório), "Minhas Seções", `Você não tem acesso`, etc.
- **ADMIN_ONLY_VIEWS filtra "Minhas Seções"**: designer não vê chip "Administrador" na lista de acesso no próprio perfil

### Arquivos novos / alterados neste ciclo
**SQL:**
- `sql-alertas-fix-dedup-purge.sql` — dedupe 7d + purge 30d
- `sql-alertas-audiencia.sql` — coluna + update `gerar_alertas()`
- `sql-rls-seguranca.sql` — policies completas
- `sql-rls-limpar-duplicadas.sql` — dropa antigas
- `sql-views-top-produtos-marketplaces.sql` — views filtradas
- `sql-pedidos-vendedor.sql` — colunas vendedor_id/nome
- `sql-fix-cron-itens.sql` — reativa cron + agenda backfill
- `sql-views-top-produtos-marketplaces.sql` — top produtos filtrado

**Edge Functions:**
- `sync-pedidos-itens.ts` (modificada — traz vendedor + fix bugs)
- `sync-pedidos-itens-backfill.ts` (modificada — traz vendedor + limite reduzido)
- `sync-pedidos-vendedor-backfill.ts` (NOVA)

**Documentos:**
- `RELATORIO ERROS SITE MOBILE/` — auditoria técnica mobile feita com Playwright
- `ASteNIOH.json` — export Trello pra migração

---

## 22. PROMPT PARA CONTEXTO DO PRÓXIMO CHAT

```
Estou continuando o desenvolvimento do DMS (Dana Marketing System) da Dana Jalecos.

Por favor, leia o arquivo de documentação antes de tudo pra entender o estado completo do sistema:

C:\Users\Juan - Dana Jalecos\Documents\Sistema Marketing\DOCUMENTACAO-COMPLETA-DMS.md

Ele tem TUDO: informações da empresa, arquitetura, tabelas Supabase, seções do menu, sistema de permissões, notificações com audiência por cargo, sincronização realtime, mobile responsive (URL unificada), Persona Real (data-driven), exportar PDF em 7 seções, Briefing Visual (3 fases), Criativos (2 fases), Influenciadores (2 fases), Concorrentes, Analytics, E-commerce com filtro por vendedor, Loja Física, Canais de Aquisição, RLS hardening, etc.

Tecnologias: HTML/JS/CSS inline (index.html ~16k linhas após merge mobile), Supabase (PG + Edge Functions + Storage + Auth + Realtime), GitHub Pages.

Estado atual: tudo deployado na main. Mobile e desktop usam mesma URL. Fontes Northlane carregadas via @font-face. Rebranding 2026 importado no Brand Kit. Sync Bling rodando (pedidos 30min, contas 1h, produtos 2h, itens 30min, vendedor backfill 15min). Cobertura de itens 2026: 100%. Vendedor_id backfill em andamento (~10% ao fim de 20/04).

Vamos continuar de onde paramos.
```

---

## 22. CICLO 22/04/2026 — MULTI-EMPRESA (BC) + BACKUP + AGENTE IA

### Novidade grande: integração com segunda conta Bling (Balneário Camboriú)

A Dana tem agora 2 contas Bling separadas (CNPJs diferentes): **Matriz** (Piçarras SC) e **BC** (Balneário Camboriú SC). O sistema foi adaptado pra multi-empresa com isolamento total de dados.

#### Arquitetura multi-empresa

**Schema:** Adicionada coluna `empresa TEXT NOT NULL DEFAULT 'matriz'` nas 8 tabelas Bling:
- pedidos, pedidos_itens, contatos, produtos, vendedores
- contas_receber, contas_pagar, bling_tokens
- CHECK constraint: `empresa IN ('matriz', 'bc')`
- Índices em (empresa, data) pra performance

**Credenciais BC:**
- CLIENT_ID / CLIENT_SECRET salvos em `.claude/BLING_BC.txt` (fora do git)
- OAuth autorizado, tokens salvos em `bling_tokens` com `id=2` + `empresa='bc'`
- Constraint antigo `single_row` foi DROPPED pra permitir múltiplas rows

**Edge Functions BC:** 6 clones das syncs principais (`sync-pedidos-bc`, `sync-pedidos-itens-bc`, `sync-contas-receber-bc`, `sync-contas-pagar-bc`, `sync-produtos-bc`, `sync-contatos-bc`). Cada uma:
- Usa credenciais BC hardcoded
- Busca token da row id=2
- Marca `empresa='bc'` nos upserts via `.map((__r) => ({...__r, empresa: 'bc'}))`

**Crons BC (10 ativos, intercalados com matriz pra rate limit):**
- sync-pedidos-bc-30min (`:15, :45`)
- sync-pedidos-itens-bc-30min (`:25, :55`)
- sync-cr-aberto-bc-1h (`:20`)
- sync-cr-atrasado-bc-2h (`:25 */2`)
- **sync-cr-recebido-bc-dia (`04:15`)** 🆕
- sync-cp-aberto-bc-1h (`:30`)
- sync-cp-atrasado-bc-2h (`:50 */2`)
- **sync-cp-pago-bc-dia (`05:15`)** 🆕
- sync-produtos-bc-2h (`:40`)
- sync-contatos-bc-2h (`:45`)

**Backfill BC completo:**
- Pedidos 2025+2026: 4.367
- Pedidos_itens: 7.468 (100% dos pedidos)
- Contatos: 12.340
- Contas_receber (todas situações): 6.275
- Contas_pagar: 0 (BC não usa o módulo no Bling)
- Produtos: 2.547

### Seletor de empresa no topbar

UI global: `[Empresa: Todas ▼]` (matriz/bc/todas) com persistência localStorage.
- Cor da bolinha: azul (matriz), verde (BC), gradiente (todas)
- Botão compacto no mobile (só ícone)
- Função helper `aplicarEmpresa(query)` injeta `.eq('empresa', X)` em qualquer query
- Mudou filtro → `recarregarTudoPorEmpresa()` força `await loadSupabaseData()` + chama callback da view ativa

**Views recriadas com suporte a empresa** (retornam 1 row por empresa + 1 row 'todas' agregada):
- dashboard_resumo, dashboard_contas, dashboard_mensal
- cliente_scoring, funil_vendas, receita_historica
- top_produtos, top_produtos_mes (JOIN pelo par `pedido_id + empresa`)

**Frontend com filtro propagado em todas seções:**
- Dashboard (home, KPIs, gráficos, Top Produtos dinâmico que substituiu HTML hardcoded)
- E-commerce / Loja Física (`lojaIdsLojaFisica()` retorna loja_id correto por empresa — matriz=203536978, bc=203550865)
- Financeiro / Projeções
- Marketplaces (Top Clientes + Top SKUs)
- Canais e Vendas (inclui "Loja Física BC" no mapping de loja_id)
- Comunidade e CRM (cliente_scoring)
- Performance (funil_vendas por canal)
- Relatório Executivo (badge de empresa no header, PDF export corrigido)
- Personas (classificação PF/PJ filtrada)

**Depósitos Bling no Dashboard:** card que era hardcoded virou dinâmico. Matriz: 5 deps (Dhom, Donare, Ducato, Magalu, Marcia). BC: 1 dep (Geral). Todas: 6 combinados com label da empresa.

**Financeiro Resumo no Dashboard:** card tl-item que era hardcoded ('38 categorias', '6 depósitos Dhom...') virou dinâmico por empresa via `atualizarFinanceiroResumoCard()`.

### Agente IA (AI Chat)

Balão flutuante 💬 no canto inferior direito do site (visível pra qualquer logado).

**Backend (`ai-chat` Edge Function):**
- Motor primário: **Groq Llama 3.3 70B** (key em Supabase Secret `GROQ_API_KEY`)
- Fallback automático: **Gemini 2.5 Flash** (`GEMINI_API_KEY`) se Groq der 429/erro
- Keys: user gerou em `console.groq.com` e `aistudio.google.com` — gravadas localmente em `.claude/AI_KEYS.txt`
- Rate limit: 50 perguntas/hora/usuário
- Log em tabela `ai_chat_log` (RLS: user vê próprios, admin vê todos)

**Tool-calling com 10 ferramentas:**
- `consultar_faturamento`, `consultar_contas_financeiras`
- `top_clientes`, `top_produtos`, `vendas_por_canal`
- `buscar_tarefas` (com filtros prioridade/tag/prazo/atrasadas/incluir_concluidas)
- `resumo_kanban` (panorama geral)
- `buscar_contato` (cliente + histórico), `info_produto` (estoque/preço)
- `listar_schema` + `consultar_tabela` (query genérica — só admin)

**Permissões por cargo (REGRA IMPORTANTE):**
Cada tool exige permissão em pelo menos UMA seção do `cargo_permissoes`:
- consultar_faturamento: financeiro, home, marketplaces, canaisvendas, relatorio
- consultar_contas_financeiras: financeiro
- top_clientes: comunidade, financeiro
- top_produtos: marketplaces, home, financeiro
- vendas_por_canal: financeiro, marketplaces, canaisvendas, home
- buscar_tarefas, resumo_kanban: tarefas
- buscar_contato: comunidade
- info_produto: marketplaces, home
- consultar_tabela: admin only

Tool retorna `{erro_permissao}` quando user não tem → agente responde educadamente "você não tem acesso a essa informação".

**Frontend (no index.html):**
- Balão fixo bottom-right (52px mobile, 58px desktop)
- Chat modal 420x640px desktop, fullscreen no mobile (`100dvh` + safe-area-inset-bottom)
- Histórico em localStorage por user_id (`dms_ai_chat_v2_${uid}`) — isolado entre contas
- Limpa caches no logout
- Autocomplete `@usuário` em comentários de tarefas funcionando
- Menções salvas em `tarefa_comentarios.mentions_ids` (UUID array)
- Deep-link no alerta: clicar na notificação abre tarefa + rola até comentário e pisca

### Comentários em tarefas (Kanban)

Nova tabela `tarefa_comentarios` (id, tarefa_id, user_id, user_nome, user_cargo, mensagem, mentions_ids UUID[], created_at, updated_at).

RLS:
- SELECT: authenticated
- INSERT: user_id = auth.uid()
- UPDATE: autor
- DELETE: autor OR is_admin()

UI no modal da tarefa (layout 2 colunas — detalhes esquerda 980px, comentários direita 360px):
- Avatar com iniciais coloridas
- Timestamp relativo ("agora", "5min atrás", "2h atrás")
- Editar/excluir próprios comentários
- Autocomplete de @ com dropdown filtrado por nome
- Realtime: novo comentário aparece em todos PCs com a tarefa aberta
- Notifica responsável da tarefa (se não for quem comentou)
- Notifica usuários mencionados via `alertas` (audiência=pessoal, link deep-link)

### Logo branding + favicon

- Sidebar: `assets/logos/principal-horizontal-branca.png` (substituiu base64 inline de 150kb, índex.html ficou 150kb menor)
- Favicon: `assets/logos/logo-sozinha-branca.png`
- Textos: Marketing System alinhado à esquerda, title da aba "Dana Marketing System"

### Sidebar reorganizada (Opção 1 — por função)

7 categorias:
- **Visão Geral**: Dashboard, Analytics, Relatório Executivo
- **Vendas**: E-commerce, Loja Física, Marketplaces, Canais e Vendas, Comunidade e CRM
- **Financeiro**: Financeiro, Projeções, Calculadora ROI
- **Marketing**: Canais de Aquisição, Campanhas, Construtor, Criativos, Briefing Visual, Influenciadores, Prova Social
- **Inteligência**: Públicos Ideais, Palavras-Chave, Mercado e Tendências, Referências, Performance
- **Produtividade**: Tarefas e Kanban, Calendário
- **Sistema**: Conectar APIs, Administrador

Seções sem itens visíveis (tudo escondido por permissão) desaparecem automaticamente.

### Calendário — cor por evento

Coluna `cor` já existia na tabela `calendario`, agora usada. Modal de novo evento ganhou paleta de 11 cores (preto, vermelho, laranja, amarelo, verde, ciano, azul, roxo, rosa, cinza + custom via `<input type="color">`).

Modal de ver-evento tem botão "🎨 Cor" pra trocar depois da criação — abre modal com paleta (substituiu `prompt()` nativo).

### Log de atividades — dropdown corrigido

Antes: dropdown filtrava `DISTINCT user_nome FROM activity_log` → só mostrava quem tinha ação registrada (3 dos 7 users).
Agora: `SELECT id, nome FROM profiles ORDER BY nome` → lista completa.

### E-commerce — placeholder Magazord

Dana confirmou que os R$72k de faturamento do "site" não são do Bling (a API zera `total` em checkout web) — vêm do dashboard Magazord.

Seção E-commerce no DMS transformada em **placeholder limpo**:
- Remove KPIs, gráficos, tops
- Mostra card "Aguardando integração Magazord"
- CTA pra solicitar API: `integracao@magazord.com.br`
- `loadEcommerce()` virou no-op
- Botão "Exportar PDF" removido (não tem dados)

### Backup completo em `.BACKUP/`

Snapshot completo gerado pra facilitar migração futura:
```
.BACKUP/ (15 MB total)
├── README.md                  ← guia geral
├── 01-schema/ (81KB)           ← 8 arquivos DDL
│   ├── 00-extensions.sql
│   ├── 01-tables.sql (29 tabelas)
│   ├── 02-constraints.sql (70)
│   ├── 03-indexes.sql (43)
│   ├── 04-views.sql (10)
│   ├── 05-functions.sql (11)
│   ├── 06-triggers.sql (7)
│   └── 07-rls-policies.sql (87)
├── 02-dados/ (14MB)            ← 25 tabelas em SQL INSERT
│   ├── bling/ (8 arquivos)
│   ├── dms/ (19 arquivos)
│   └── outras/
├── 03-edge-functions/ (19 .ts)
├── 04-crons/ (all-crons.sql, 22 crons)
├── 05-secrets/ (nomes dos secrets, não valores)
└── 99-restore/
    ├── restore.py
    └── restore.md
```

**Como usar:** `python restore.py --ref NOVO_REF --pat NOVO_PAT` (~15-20min completo).

### Ideia futura — Cliente 360 integrado

Arquivo standalone `DANA_CLIENTE_360_COMPLETO.html` em `.ANALISE E PESQUISA/` foi analisado:
- Dashboard CRM em HTML estático (300KB)
- 7 abas: Dashboard, Clientes, Segmentação, Campanhas, Sincronização, Configurações, Logs
- 30 clientes demo hardcoded, sem backend

**Plano aprovado pela chefe (via zap):** integrar como extensão do DMS via iframe isolado.
- Rota: `https://danacomercial.github.io/dana-marketing/#cliente360`
- Acesso requer login DMS + permissão `cliente360` em `cargo_permissoes`
- Iframe full-screen com `cliente-360.html` (deploy no mesmo repo GitHub Pages)
- Auth compartilhada via localStorage (mesmo domínio)
- Filtro empresa passado via query string `?empresa=matriz|bc|todas`
- Isolamento total de CSS/JS (iframe é contexto separado)
- ~2h de trabalho pra implementar

**Status:** ainda não implementado, aguardando confirmação pra começar.

### Fixes diversos do ciclo

- **Race condition**: trocar filtro mostrava dados da empresa anterior pois `loadSupabaseData()` era chamado sem `await`. Corrigido com `await loadSupabaseData()` antes de chamar callback da view.
- **Callbacks errados**: map tinha `loadComunidade`, `loadPerformance`, `loadPersonaReal`, `renderRelatorioExecutivo`, `loadCanaisVendas` — nenhuma existia. Corrigido com nomes reais (`loadClienteScoring`, `loadPerformanceData`, `loadPersonasStats`, `loadRelatorio`, `loadCanaisVenda`).
- **Bell não mostrava bolinha vermelha** ao trocar de conta: `loadAlertas()` não rodava no SPA login. Corrigido com chamada logo após `checkAuth()` + limpeza de caches no logout.
- **Top Clientes em Canais e Vendas**: populado por `loadMarketplacesExtras` (compartilha `mp-*` IDs). Callback de `canaisvendas` agora é array `['loadCanaisVenda', 'loadMarketplacesExtras']`.
- **Loja Física com BC**: filtro era hardcoded `loja_id=203536978` (matriz). Função `lojaIdsLojaFisica()` retorna o ID correto por empresa.

### Arquivos novos / alterados neste ciclo

**Edge Functions criadas:**
- `ai-chat.ts`
- 6 `sync-*-bc.ts` (clones matriz)

**SQL scripts rodados (via Management API):**
- ADD COLUMN empresa em 8 tabelas + CHECK + indexes
- DROP + CREATE dashboard_resumo/contas/mensal com empresa
- DROP + CREATE cliente_scoring/funil_vendas/receita_historica/top_produtos/top_produtos_mes com empresa
- CREATE TABLE tarefa_comentarios + RLS
- CREATE TABLE ai_chat_log + RLS
- ALTER TABLE bling_tokens DROP CONSTRAINT single_row
- 10 cron.schedule() pra BC + 2 novos de pago/atrasado

**Novo:** `.BACKUP/` (15MB snapshot completo)

**Arquivos assets:**
- `assets/logos/principal-horizontal-branca.png`
- `assets/logos/logo-sozinha-branca.png`
- `assets/logos/principal-horizontal.png`
- `assets/logos/logo-sozinha.png`

**Credenciais locais (fora do git):**
- `.claude/TOKEN SUPABASE.txt` (PAT pra Management API)
- `.claude/BLING_BC.txt` (CLIENT_ID/SECRET BC)
- `.claude/AI_KEYS.txt` (GROQ + GEMINI)

### Estado final dos dados (22/04/2026)

| Tabela | Matriz | BC | Total |
|---|---|---|---|
| pedidos | 8.781 | 4.367 | 13.148 |
| pedidos_itens | **4.211** ⚠ | 7.468 ✅ | 11.679 |
| contatos | 28.601 | 12.340 | 40.941 |
| produtos | 2.204 | 2.547 | 4.751 |
| contas_receber | 6.782 | 6.275 | 13.057 |
| contas_pagar | 11.743 | 0 | 11.743 |
| vendedores | 76 | 76 | — |

⚠ **Matriz pedidos_itens incompleto** (muitos pedidos sem itens cadastrados desde o início do sync). Ação pendente: backfill completo estimado em ~30-35min (ritmo 400ms/call pra respeitar rate limit Bling). **Lembrete agendado pra 11:58 do dia 22/04** via CronCreate.

---

## 23. PROMPT PARA CONTEXTO DO PRÓXIMO CHAT (após /compact em 22/04)

```
Estou continuando o desenvolvimento do DMS (Dana Marketing System) da Dana Jalecos.

Por favor, leia o arquivo de documentação antes de tudo pra entender o estado completo do sistema:

C:\Users\Juan - Dana Jalecos\Documents\Sistema Marketing\DOCUMENTACAO-COMPLETA-DMS.md

Estado atual (22/04/2026 manhã):
- Sistema multi-empresa funcionando (Matriz + BC)
- Backup completo em .BACKUP/ (15MB)
- Todas as seções respeitam filtro de empresa (matriz/bc/todas)
- Agente IA rodando (Groq + Gemini fallback)
- Comentários em tarefas com @menções e deep-link
- Sidebar reorganizada em 7 categorias

AÇÃO IMEDIATA PENDENTE:
Rodar o backfill completo de pedidos_itens da MATRIZ (os que ainda não têm itens sincronizados). Estimativa: ~30-35min no ritmo 400ms/call (2.5 req/s). A matriz tem 8.781 pedidos total mas só 4.211 itens cadastrados — muitos pedidos sem itens. Criar script similar ao _backfill_bc_completo.py mas pra matriz: usar token da row id=1 de bling_tokens, marcar empresa='matriz' nos upserts, pular pedidos que já têm itens (incremental).

Ideia em aberto (aprovada pela chefe):
Criar seção Cliente 360 no DMS via iframe isolado. Arquivo DANA_CLIENTE_360_COMPLETO.html existe em `.ANALISE E PESQUISA/`. Rota: `#cliente360`. Auth guard + permissão via cargo_permissoes. ~2h de trabalho.

Tecnologias: HTML/JS/CSS inline (index.html ~18k linhas), Supabase (PG + Edge Functions + Storage + Auth + Realtime), GitHub Pages.

Vamos começar pelo backfill da matriz.
```

---

## 24. CICLO 22/04/2026 TARDE — MIGRAÇÃO + CLIENTE 360 + MELHORIAS

### 24.1 Backfill completo de pedidos_itens da MATRIZ
Cobertura matriz pedidos_itens: 26% → **99.98%** (2.287 → 8.786 pedidos com itens, 4.215 → 23.276 linhas de itens).

Script: `_backfill_matriz_itens.py`
- Busca pedidos matriz sem itens (incremental)
- GET detalhado no Bling pra cada pedido (itens + vendedor)
- Batch UPSERT a cada 50 (reduz latência DB)
- 200ms entre calls (vs 400ms do BC) — usa latência natural do HTTP
- Refresh automático de token via `refresh_token` quando expira
- Tratamento 429/401 com backoff
- urllib.request (não curl) — evita limite de 32KB da linha de comando do Windows

**Resultado**: ~65 minutos reais pra processar 6.497 pedidos matriz 2025.

### 24.2 MIGRAÇÃO COMPLETA pra novo projeto Supabase

- **Projeto antigo**: `comlppiwzniskjbeneos` (crons pausados via `cron.alter_job(active:=false)`)
- **Projeto novo**: `wltmiqbhziefusnzmmkt` (us-east-2, ACTIVE_HEALTHY)

**Schema migrado via DDL files de `.BACKUP/01-schema/`:**
- 7 extensions, 29 tables, 70 constraints, 43 indexes, 10 views, 11 functions, 7 triggers, 87 RLS policies
- Correções pontuais aplicadas:
  - ARRAY genérico → text[]/uuid[] explícito (3 columns)
  - Reordenar constraints: PK/UNIQUE antes de FK
  - CREATE INDEX IF NOT EXISTS pra evitar conflito com indexes auto-gerados
  - CREATE SEQUENCE antes dos CREATE TABLE que usam nextval
  - DROP SCHEMA public CASCADE + CREATE SCHEMA pra começar limpo
  - Grants padrão Supabase restaurados (schema grants removidos pelo DROP)

**Dados migrados via `_migrate_data.py` (25 tabelas, diff=0 vs antigo):**
- Copia SELECT * do antigo → INSERT upsert no novo
- Ordem respeitando FKs
- Batch 200-500 por tabela
- Fix esc() pra distinguir PG array (text[]) vs jsonb (lists de dicts)
- Retry em 5xx/timeout

**Auth migrado:**
- 7 usuários recriados via Admin API `POST /auth/v1/admin/users` preservando UUIDs
- Senha temp inicial: `DanaTemp2026!`
- Senhas finais trocadas via Admin API `PUT /admin/users/{id}`:
  - danajalecos@gmail.com
  - danaiaju4n@gmail.com (Juan)
  - manuelabinhottisantos@gmail.com

**Secrets:**
- GROQ_API_KEY e GEMINI_API_KEY recriados via Management API

**Storage:**
- Bucket `kanban` recriado via Storage API
- 7 arquivos (18.88MB) re-uploadados
- 4 policies (public SELECT/INSERT/UPDATE/DELETE no bucket kanban)

**Edge Functions:**
- 19 funções redeployadas via Management API (multipart/form-data)

**Crons:**
- 22 crons recriados com URL + ANON_KEY do novo projeto (substituição via Python)
- Todos ativos, sincronizando OK

**Frontend:**
- `index.html` atualizado: `SUPABASE_URL` + `SUPABASE_ANON_KEY` apontando pro novo
- Commit + push pro `origin/main` (GitHub Pages redeploy)

**Fixes pós-migração:**
- Sequences fora de sync (`activity_log_id_seq=53` causava 409 Conflict) → ajustadas via `setval` pra `max(id)+1`
- Storage policies faltando → recriadas (public role)
- Realtime publication vazia → `ALTER PUBLICATION supabase_realtime ADD TABLE` pra 24 tabelas
- Bug ai-chat: `.single()` em view multi-empresa com 3 rows → adicionado filtro `empresa` + `.eq()`

### 24.3 Trocar senha no perfil

Novo card "Trocar Senha" em **Meu Perfil**:
- 3 campos: senha atual, nova, confirmar
- Valida senha atual via `signInWithPassword` antes de atualizar
- Validações: 6+ caracteres, nova ≠ atual, confirma = nova
- Log em `activity_log` ação `alterou_senha`
- Posicionado logo abaixo do card principal (não no final)

### 24.4 Admin · Permissões redesenhada

**Antes**: tabela gigante 40+ secoes × 9 cargos (poluído)

**Agora**:
- Dropdown de cargo no topo (unificado desktop/mobile)
- Botões "Marcar tudo / Desmarcar tudo" globais
- Seções agrupadas em 8 categorias com headers:
  - 📊 Visão Geral · 💰 Vendas · 🏦 Financeiro · 📣 Marketing
  - 🎯 Inteligência · ✅ Produtividade · ⚙️ Sistema · ⚡ Ações Específicas
- Cada grupo com botões ✓/✕ pra marcar/desmarcar o grupo todo
- Toggle switches iOS-style (preto = ON)
- Badge no botão: "Salvar (3 alterações)" quando há mudanças pendentes
- Salvar envia só o que mudou (reduz tráfego)
- Estado em memória `_permState` evita perda ao trocar cargo

### 24.5 CLIENTE 360 — FASES 1 a 5

**Arquivo principal**: `cliente-360.html` (753KB, HTML estático com demo) + `cliente-360-boot.js` (boot script que sobrescreve UI demo com dados reais do Supabase)

**Rota**: `https://danacomercial.github.io/dana-marketing/#cliente360`

**Permissão**: chave `cliente360` em `cargo_permissoes`:
- admin, gerente_comercial, gerente_marketing: true (default)
- demais: false (ajustável via Admin)

**Navegação**:
- DMS principal esconde o filtro global de empresa quando na view #cliente360
- Cliente 360 tem toggle interno Matriz | Balneário no sidebar interno
- Persistência em localStorage (`c360_empresa`)
- Cache-busting no iframe: `?v=timestamp` por sessão + `Cache-Control: no-cache` no HTML

#### Fase 1 — Iframe + login gate
- Cópia `cliente-360.html` no repo
- Nova entrada no sidebar (Vendas > Cliente 360)
- Permission check no `go()` do DMS
- Iframe fullscreen lazy-loaded

#### Fase 2 — Dados reais

**Lista de clientes (aba Clientes):**
- View server-side `cliente_scoring_full` (JOIN lateral com contatos pra telefone/celular)
- Index `idx_contatos_nome_empresa` pra evitar timeout (sem index: >3s / com: ~500ms)
- Cache por empresa (5min) — trocas Matriz↔BC instantâneas após 1º load
- Top 1000 por score (limite PostgREST default)
- Busca por nome + telefone + celular (não por email — Bling não expõe)
- Filtro "Todos os estágios" = segmento RFM
- Filtro "Todos os estados" = UF inferida do DDD do fone (~95% acurácia)
- Paginação client-side 50/página
- Loading indicator
- Avatar + segmento badge + risco badge + score colorido

**Detalhe do cliente:**
- Reaproveita `page-cliente-1` como template, reescrito dinamicamente
- Header: avatar, nome, segmento badge, risco badge, fone, CNPJ/CPF, UF, empresa, tipo pessoa
- 6 KPI cards: Total Pedidos, Total Gasto, Ticket Médio, Ciclo Médio (calc), Última Compra, Próxima Estimada
- Score RFM decomposto: Recência/Frequência/Monetário (0-5 cada)
- Score de Recompra: prob 0-100 (heurística score + dias_sem_compra) + Categoria preferida (inferida de pedidos_itens.descricao: Jalecos/Scrubs/Kits/Conjuntos/Camisas/Calças/Aventais/Acessórios) + Canal preferido (loja_id majoritário)
- Tabs Pedidos / Insights IA / Notas

**Dashboard:**
- View server-side `cliente_scoring_resumo` (agregados por empresa)
- 4 Alertas Inteligentes clicáveis → filtram lista:
  - Prontos recompra (score ≥80 + 30+ dias)
  - VIPs sem comprar (segmento=VIP + 120+ dias)
  - Novos sem 2ª compra (total_pedidos=1 + 30+ dias)
  - Alto potencial (2+ pedidos + score ≥70 + <90 dias)
- 5 Métricas Principais: Total Clientes, Ativos, VIPs, Em Risco, Perdidos
- 5 Métricas Secundárias: Faturamento, Ticket Médio, Ciclo, Taxa Recompra, Fiéis
- Botão Atualizar (invalida cache)
- Card overflow fixado com `white-space:nowrap + text-overflow:ellipsis + font-variant-numeric:tabular-nums`

#### Fase 3 — Insights IA por cliente

**Backend:**
- Nova edge function `cliente360-insight` (Groq Llama 3.3 70B + fallback Gemini 2.5 Flash)
- Nova tabela `cliente_insights` (histórico + RLS admin+gerentes)
- Permissão: apenas admin, gerente_comercial, gerente_marketing (consome API paga)
- Contexto enviado pro LLM: segmento, score, ticket, canais preferidos, categorias, últimas 5 compras

**System prompt estruturado em 3 seções fixas:**
- ANÁLISE DO COMPORTAMENTO ATUAL
- RISCO OU OPORTUNIDADE PRINCIPAL
- AÇÃO COMERCIAL RECOMENDADA

**Frontend:**
- Botão ◆ Insight IA no header do detalhe gera insight
- Tab Insights IA lista histórico (máx 10)
- Card estilizado: ícone ◉ + título "Análise de Comportamento" + data + autor
- Seções com label em CAIXA ALTA cor champanhe
- Negrito `**texto**` em cor champanhe
- Emojis de sub-tópicos (📋 Perfil, 📊 Padrão) destacados
- Botão lixeira por insight (apaga do DB)

#### Fase 4 — Notas por cliente + menções + sininho

**Backend:**
- Nova tabela `cliente_notas` (id, empresa, contato_nome, texto, mentions_ids uuid[], user_id, user_nome, timestamps)
- RLS:
  - SELECT: usuários com permissão `cliente360`
  - INSERT: autor + permissão cliente360
  - UPDATE: autor
  - DELETE: autor OU admin
- Realtime ativado

**Frontend:**
- Aba Notas: CRUD funcional
- Form com textarea + **autocomplete de @**
  - Dropdown aparece ao digitar @
  - Lista filtrada por permissão `cliente360` (hoje: 5 pessoas)
- Cards de nota: avatar + nome + tempo relativo (agora, 5min, 2h, data)
- **✏ Editar nota** (autor): textarea inline com Salvar/Cancelar
- **🗑 Apagar nota** (autor ou admin)
- @menção realçada em cor champanhe

**Notificações no sininho:**
- Ao postar com menções, cria linhas em `alertas`:
  - destinatario_id, audiencia='pessoal'
  - link_ref='cliente360', link_label='Ver nota'
  - dados: {empresa, contato_nome, tab:'notas', nota_id}
- Bell do DMS detecta via realtime automaticamente

**Deep-link:**
- DMS `abrirLinkAlerta` handler novo pra viewId='cliente360':
  - Salva spec em sessionStorage (fallback pra iframe não-montado)
  - postMessage pro iframe (caso já montado)
- Iframe:
  - `checkDeepLink` lê sessionStorage no boot
  - `window.addEventListener('message')` escuta postMessage
  - `openClienteFromSpec(spec)`: troca empresa se necessário → abre detalhe → muda pra aba notas → scroll + highlight da nota por 2s

**Realtime entre usuários:**
- Channel `realtime-cliente-notas` subscribe em `postgres_changes` event=*
- Se nota mudada é do cliente atual aberto + aba visível, re-renderiza instantâneo

#### Fase 5 — Segmentação

**Backend:**
- Nova tabela `cliente_segmentos_custom`:
  - nome, descricao, empresa (matriz/bc/ambas), filtros jsonb, cor, user_id/nome, timestamps
- RLS: cliente360 perm pra SELECT/INSERT (autor), admin OU autor pra UPDATE/DELETE
- Realtime ativado

**Frontend:**
- Aba Segmentação reescrita dinamicamente
- **Segmentos Automáticos (5)**: cards clicáveis com contagens reais — clicar aplica filtro na lista
- **Segmentos Customizados**: grid de cards com nome, cor, contagem, preview filtros
- Modal criar/editar com:
  - Nome, descrição, empresa, cor (color picker)
  - Filtros:
    - Tipo Pessoa (PJ/PF)
    - **Estados: chips clicáveis** com contagem, botões Todos/Limpar
    - Segmentos RFM (multi checkboxes)
    - Min/Max pedidos, gasto, dias sem compra, score
  - Preview live: "X cliente(s) correspondem"
- Ações por segmento: Ver clientes (aplica filtro), ⬇ CSV (export com BOM UTF-8, sep=;), ✏ Editar, 🗑 Apagar
- Realtime sync

### 24.6 Tabelas NOVAS desse ciclo

| Tabela | Descrição |
|---|---|
| `cliente_insights` | Histórico de insights IA por cliente |
| `cliente_notas` | Notas internas por cliente com @menções |
| `cliente_segmentos_custom` | Segmentos customizados com filtros jsonb |

### 24.7 Views NOVAS desse ciclo

| View | Descrição |
|---|---|
| `cliente_scoring_full` | cliente_scoring + JOIN lateral com contatos (telefone/celular/documento) |
| `cliente_scoring_resumo` | Agregados por empresa (total, vip, em_risco, perdidos, faturamento, alertas RFM) |

### 24.8 Edge Functions NOVAS

| Function | Descrição |
|---|---|
| `cliente360-insight` | Gera insight IA por cliente (Groq+Gemini fallback) |

### 24.9 Arquivos NOVOS no repo GitHub Pages

```
dana-marketing/
├── cliente-360.html            # 753KB - demo base rewrite via boot
└── cliente-360-boot.js         # ~1200 linhas - toda logica C360
```

### 24.10 Scripts locais desse ciclo (não commitados)

Em `.claude/worktrees/vibrant-davinci/`:
- `_backfill_matriz_itens.py` — backfill pedidos_itens matriz
- `_migrate.py` — migra schema DDL
- `_migrate_data.py` — migra dados (25 tabelas)
- `_migrate_users.py` — recria 7 usuários via Admin API
- `_migrate_rest.py` — secrets + storage + edge functions
- `_migrate_fix.py` — corrige 3 tabelas com bug inicial no esc()
- `_dump_auth_users.py` — exporta auth.users pro backup

### 24.11 Credenciais (arquivos locais fora do git)

`C:\Users\Juan - Dana Jalecos\Documents\Sistema Marketing\.claude\`:
- `TOKEN SUPABASE.txt` — PAT da conta antiga (ainda válido, projeto pausado)
- `AI_KEYS.txt` — GROQ + GEMINI keys

`C:\Users\Juan - Dana Jalecos\Documents\Sistema Marketing\.BACKUP\`:
- `.Tokens nova conta supabase.txt` — anon, service_role, PAT (30 dias) da nova conta

### 24.12 Dados atuais (22/04/2026 tarde)

| Métrica | Matriz | BC |
|---|---|---|
| Total clientes (cliente_scoring) | 5.549 | 3.036 |
| Faturamento total | R$ 4.85M | R$ 1.67M |
| VIPs | 24 | 0 (sem combinação RFM suficiente) |
| Clientes ativos | 922 | 601 |
| Em risco | 638 | 472 |
| Perdidos | 4.627 | 2.435 |
| Fiéis (5+ pedidos) | 96 | 51 |
| Taxa recompra | 19.7% | 23.6% |

### 24.13 Projeto antigo Supabase

- **Status**: ACTIVE mas **22 crons PAUSADOS** via `cron.alter_job(active:=false)`
- **Rollback disponível**: 1 comando SQL reativa os crons se precisar voltar
- **Recomendação**: manter 7 dias como fallback; depois pode ser apagado

### 24.14 Senhas atuais dos 7 usuários

| Email | Status |
|---|---|
| danajalecos@gmail.com | ✅ trocada (`Dana@200104mh`) |
| danaiaju4n@gmail.com | ✅ trocada (`danaju4nia2202`) |
| manuelabinhottisantos@gmail.com | ✅ trocada (`290808Mb@`) |
| comercial@danajalecos.com.br | ⚠️ ainda `DanaTemp2026!` |
| hadassahzcf@gmail.com | ⚠️ ainda `DanaTemp2026!` |
| luanadomecianomkt@gmail.com | ⚠️ ainda `DanaTemp2026!` |
| hdonare@gmail.com | ⚠️ ainda `DanaTemp2026!` |

Pendente: avisar os 4 restantes pra entrarem em **Meu Perfil** e trocarem.

### 24.15 Cache-busting do iframe Cliente 360

- `cliente-360.html` com meta `Cache-Control: no-cache, no-store, must-revalidate`
- `cliente-360-boot.js?v=N` onde N é bumpado a cada deploy
- Variável `CLIENTE360_VERSION = Date.now()` no DMS adiciona `?v=<ts>` ao iframe src por sessão

### 24.16 Deep-link Cliente 360 (via postMessage)

Arquitetura: DMS pai → postMessage → iframe filho
```js
// DMS (index.html)
iframe.contentWindow.postMessage({ type:'c360_open_cliente', spec:{...} }, '*');

// Iframe (cliente-360-boot.js)
window.addEventListener('message', (e) => {
  if (e.data?.type === 'c360_open_cliente') openClienteFromSpec(e.data.spec);
});
```

Fallback pra primeira montagem: `sessionStorage.setItem('c360_open_cliente', JSON)` lido no boot.

---

## 25. PRÓXIMAS FASES SUGERIDAS

### 25.1 Cliente 360 — Fase 6: Campanhas (~4-6h)
Aba Campanhas hoje é demo. Implementar:
- Criar campanha vinculada a um segmento (predefinido ou custom)
- Campos: nome, mensagem (WhatsApp/email), data programada, canal
- Tracking: quem foi contatado, quem respondeu
- **Integração futura**: WhatsApp Business API ou SendGrid (hoje seria só registro manual)
- Nova tabela `cliente_campanhas` + `cliente_campanha_envios`

### 25.2 Cliente 360 — Fase 7: Sincronização + Configurações (~2h)
- Aba Sincronização: mostra últimas execuções dos crons Bling (query em `sync_log`), permite trigger manual
- Aba Configurações: ajustar thresholds VIP (ex: score ≥70 em vez de 80), limpar cache de insights antigos, gerenciar segmentos de outros users (admin)

### 25.3 Cliente 360 — Paginação server-side (~45min)
Hoje limita aos top 1000 por score (limite PostgREST). Implementar scroll infinito ou paginação `.range()` pra ver todos os 5.549 matriz / 3.036 BC.

### 25.4 Cliente 360 — Bulk Insights IA (~1.5h)
Gerar insights pra múltiplos clientes de uma vez (ex: "gerar insights pra todos VIPs do segmento X"). Respeita rate limit via queue.

### 25.5 Cliente 360 — Notas com anexos (~2h)
Permitir anexar imagens/PDFs às notas (print de WhatsApp, pedido assinado, etc). Usar mesmo bucket `kanban` com prefix `notas/`.

### 25.6 Cliente 360 — Timeline unificada (~3h)
Aba nova "Timeline" que agrega cronologicamente: pedidos + notas + insights + mudanças de segmento. Visão completa do relacionamento.

### 25.7 Cliente 360 — Comparação entre clientes (~2h)
Selecionar 2-3 clientes na lista → modal comparativo lado-a-lado (KPIs, categorias, canais).

### 25.8 Apagar projeto Supabase antigo
Depois de 7 dias com o novo funcionando 100%, deletar o projeto `comlppiwzniskjbeneos` definitivamente pra liberar slot na conta Free/Pro.

### 25.9 Fora do Cliente 360 — Pendências antigas
- Avisar os 4 usuários restantes sobre senha temp
- GA4 integração (plano descrito na seção 20)
- Campanhas do DMS (aguardando APIs Meta/Google/TikTok)

---

## 26. PROMPT PARA CONTEXTO DO PRÓXIMO CHAT

```
Estou continuando o desenvolvimento do DMS da Dana Jalecos.

Leia primeiro: C:\Users\Juan - Dana Jalecos\Documents\Sistema Marketing\DOCUMENTACAO-COMPLETA-DMS.md

Estado atual (22/04/2026 tarde):
- MIGRAÇÃO COMPLETA pra novo Supabase wltmiqbhziefusnzmmkt (antigo pausado)
- Cliente 360 Fases 1-5 completas (lista, detalhe, dashboard, insights IA, notas com @ + sininho, segmentação customizada)
- Admin Permissões redesenhada com grupos + toggles
- Senha editável no Meu Perfil
- 22 crons sincronizando novo banco

Arquivos principais:
- index.html (~18k linhas no DMS)
- cliente-360.html (demo base) + cliente-360-boot.js (toda lógica dinâmica do C360)
- edge-functions/ (20 funções: ai-chat, cliente360-insight, sync-*, etc)

Credenciais:
- Supabase PAT (30d): .BACKUP/.Tokens nova conta supabase.txt
- GROQ+GEMINI keys: .claude/AI_KEYS.txt

Próximas fases sugeridas (secao 25):
- Fase 6 Cliente 360: Campanhas
- Fase 7 Cliente 360: Sincronização + Configurações
- Paginação server-side, Bulk insights, Notas com anexos, Timeline, Comparação

Vamos continuar de onde paramos.
```

---

## 27. CICLO 23/04/2026 — FASE 6 FINALIZADA + FASE 7 COMPLETA + INTEGRAÇÕES + LIMPEZA

### 27.1 Cliente 360 — Fase 6: Campanhas (entregue e deployada)

**2 tabelas novas criadas:**
- `cliente_campanhas` (23 colunas): master das campanhas com FK para `cliente_segmentos_custom` e `canais_aquisicao`
- `cliente_campanha_envios` (18 colunas): tracking individual por cliente com snapshot (não quebra se contato sumir)

**Trigger automático `cliente_campanha_recalc_totais`**: toda mudança em envios recalcula `total_alvo/enviados/respondidos/falhados` na master.

**RLS:** função `has_cliente360_perm()` + verificação `criado_por = auth.uid()` OU `is_admin()` para UPDATE/DELETE.

**CASCADE DELETE** nos envios ao apagar campanha. FK com `ON DELETE SET NULL` para `calendario_evento_id`.

**Frontend (`cliente-360-boot.js`):**
- Grid de campanhas em cards com status colorido, barra de progresso, contadores
- Modal criar/editar com 11 campos + **preview dinâmico** ("≈ X clientes no segmento")
- Placeholders em mensagens: `{{nome}}`, `{{primeiro_nome}}`, `{{cupom}}`, `{{link}}`, `{{cidade}}`, `{{uf}}`
- Segmentos disponíveis: 5 automáticos (VIP/Frequente/Ocasional/Em Risco/Inativo + Todos) + todos os customizados da Fase 5
- Canal: WhatsApp / Email / SMS / Outro
- Vínculo opcional com `canais_aquisicao` do DMS (para análise futura de ROI)
- Status workflow: rascunho → agendada → enviada → concluida/cancelada

**Fluxo completo Gerar → Exportar → Marcar:**
- **📋 Gerar**: popula lista de envios a partir do segmento (dedupe por contato_id, chunks de 500)
- **👁 Envios**: modal com lista completa + mudança de status individual + bulk ("Marcar todos pendentes", "Limpar pendentes")
- **3 formatos de export:**
  - 📄 **PDF** print-friendly (cabeçalho preto, tabela numerada, checkboxes pra riscar offline, mensagem exemplo)
  - ⬇ **CSV** com BOM UTF-8 pt-BR (Excel-friendly, sep `;`)
  - 📋 **Copiar** mensagens já personalizadas pro clipboard (pra broadcast em WhatsApp)

**Commits desse módulo (13 ao todo):**
```
9aaf4a2 Fase 6 base: Campanhas + envios + PDF/CSV/copiar
180c3a2 Options dark + c360Confirm custom (substituiu confirm() em 7 pontos)
31dac5c c360Confirm em apagar nota/insight/segmento
2315ecc Exige Gerar antes de PDF/CSV/Copiar (workflow consistente)
c90bc34 Integração automática com calendário DMS
ddf7a91 Eventos campanha_c360 read-only no calendário
ae897e9 Fix double-submit + banner laranja
87afb33 Campanha_c360 laranja vibrante no grid
53936ca cor=null explícito (default DEFAULT era preto)
6115a37 Overlay de loading pra evitar FOUC demo
0ff8121 Anti-autofill Chrome (1ª tentativa)
dcbb11c Autofill à prova de balas + contador dinâmico
87e97a5 Mata flash do dashboard demo (CSS inline + script síncrono)
```

### 27.2 Integração Cliente 360 ↔ Calendário DMS

**Novo tipo de evento**: `campanha_c360` (ícone 📢, cor laranja vibrante `#f97316`)

**SQL aplicado:**
- CHECK constraint de `calendario.tipo` reexpandido pra incluir `campanha_c360`
- Coluna `cliente_campanhas.calendario_evento_id` UUID REFERENCES calendario(id) ON DELETE SET NULL

**Comportamento automático (`syncCampanhaToCalendario`):**
- Campanha com `data_envio` + sem evento → cria evento
- Com data + com evento → atualiza evento
- Remove data (clear) + com evento → apaga evento + clear FK
- Apagar campanha → apaga evento junto (cascata manual no frontend)

**Read-only no calendário:** eventos com `tipo='campanha_c360'` no modal `ver-evento` do DMS agora:
- Banner laranja "🔒 Gerenciada pelo Cliente 360"
- Botões Excluir + Mudar Cor ocultos
- Botão novo "📢 Abrir no Cliente 360" com deep-link pra aba Campanhas
- Opção `campanha_c360` removida do dropdown de criação manual

**Deep-link infra:**
- `sessionStorage.c360_open_tab` + `postMessage({ type: 'c360_open_tab', tab: 'campanhas' })`
- Handler em `checkDeepLink()` + listener de `message` no iframe

### 27.3 Cliente 360 — Fase 7 (completa)

**7.1 Aba Sincronização** (nova, substitui demo):
- Query direta em `sync_log` (top 200 ordenados desc)
- 4 KPI cards: Pedidos, Contatos, Produtos, Contas a Receber — cada um com Matriz + BC separados
- Bolinha colorida por status (ok=verde / parcial=âmbar / erro=vermelho)
- Tabela últimas 50 execuções com filtro de empresa (todas/matriz/bc)
- Realtime subscribe no `sync_log` (debounced 800ms)
- Botão "🔄 Atualizar" manual

**7.2 Aba Configurações** (nova):
- **3 blocos** organizados:
  1. **Info de Uso** (read-only): 5 cards com contagens reais (clientes scorados, notas, insights IA com contagem de antigos >60d, segmentos custom, campanhas + envios)
  2. **Preferências pessoais** (localStorage): itens por página (25/50/100) + empresa padrão (matriz/bc)
  3. **Manutenção** (só admin, visualmente desabilitado pra outros): 🗑 apagar insights IA com mais de 60 dias + 🔄 invalidar cache local
- `c360Confirm` em tema dark pra confirmações destrutivas

**7.3 Aba Logs** (nova):
- Timeline unificada de 4 fontes: `cliente_notas`, `cliente_insights`, `cliente_segmentos_custom`, `cliente_campanhas`
- Filtros: tipo (todos/nota/insight/segmento/campanha) + período (7d/30d/90d)
- Paginação client-side 50/página
- Export CSV com BOM UTF-8
- Cores por tipo (azul/roxo/verde/âmbar)
- Autor destacado na cor do tipo + ação + alvo em negrito + timestamp

**Commits:**
- `ba0fd8b` Fase 7.1 Sincronização
- `5475cdd` Fase 7.2+7.3 Configurações + Logs

### 27.4 AI Chat — 6 tools novas do Cliente 360

Adicionadas em `edge-functions/ai-chat.ts`:

| Tool | Descrição |
|---|---|
| `resumo_cliente360` | Panorama geral (VIPs, ativos, em risco, faturamento, taxa recompra) |
| `alertas_cliente360` | 4 alertas RFM (prontos_recompra, vips_sem_comprar, novos_sem_segunda, alto_potencial) |
| `listar_segmentos_c360` | 5 automáticos com contagens + customizados |
| `listar_campanhas_c360` | Campanhas com progresso (alvo/enviados/taxa envio/resposta) |
| `detalhe_cliente_c360` | Info completa + notas recentes + insights IA |
| `buscar_notas_c360` | Busca por cliente, autor, período |

Todas exigem permissão `cliente360`. Tabelas relacionadas adicionadas em `TABELAS_PERMITIDAS`.

**Robustez do chat melhorada:**
- `comRetry()` util detecta erros transientes (503/429/UNAVAILABLE/overloaded) e retenta até 2x com backoff 1.5s
- Fluxo Groq → Gemini (com retry) → Groq (retry pós-fallback) → mensagem amigável
- HTTP 503 (não 500) pra erros transientes → client mostra mensagem amigável
- Reset de secrets `GROQ_API_KEY` e `GEMINI_API_KEY` (hashes divergentes)

**Edge function versões deployadas:** v3 (tools novas) → v4 (schema fix) → v5 (retry) → v7 (after secret reset)

**Commits:** `0a95702`, `5ded694`

### 27.5 Melhorias de UX e bugs críticos (várias pequenas mas impactantes)

**Flash demo (FOUC) resolvido** (`87e97a5`):
- `<style>` inline no `<head>` esconde `#root` até JS marcar `body.c360-ready`
- `<script>` síncrono logo após `<body>` cria overlay antes do parse do demo
- `boot()` com try/finally → `body.classList.add('c360-ready')` + `hideBootOverlay()` em qualquer caso

**Autofill Chrome (bulletproof)** (`dcbb11c`):
- `readonly="readonly"` inicial + unlock no primeiro focus/mousedown/touchstart
- Chrome não autofill em readonly → quando user interage, remove readonly
- Defensivos: 2 timeouts (200ms, 800ms) zeram `value` se contém `@`
- `type="search"`, `autocomplete="off"`, `name` aleatório

**Contador dinâmico de clientes** (`dcbb11c`):
- `updateCountLabel()` substitui "30 clientes encontrados" hardcoded
- Singular/plural ("1 cliente encontrado" vs "N clientes encontrados")

**`c360Confirm` custom** (`180c3a2`, `31dac5c`):
- Substituiu confirm() nativo em **7 pontos**: apagar campanha/nota/insight/segmento, gerar envios, marcar todos enviados, limpar pendentes
- ESC cancela, Enter confirma
- Botão vermelho pra `{ danger: true }`

**Dropdowns dark theme** (`180c3a2`):
- Chrome/Windows não herdava bg/color do select → CSS inline forçado
- `#c360-camp-modal select option`, `select optgroup` com bg/color !important

**Double-submit fix** (`ae897e9`):
- `state.savingCampanha` flag + disabled button + try/finally
- Evita 2 INSERTs quando clique duplo

**Banner laranja no calendário** (`ae897e9`, `87afb33`):
- Trocado de azul (#1d4ed8 que virava cinza no dark) para laranja vibrante (#f97316)
- Consistente em 3 lugares: chip no grid (tiposCor), badge modal (tiposConfig), banner lock

**Cor default preto resolvido** (`53936ca`):
- Default `calendario.cor` era `#0a0a0a` (preto) → sobrescrevia `tiposCor[tipo]`
- Fix: `syncCampanhaToCalendario` passa `cor: null` explícito
- UPDATE banco pra limpar evento existente `Era uma Vez · Cliente 360`

### 27.6 Fix encoding Google Suggest (seção Palavras-Chave)

Commit `b9e5023`:

**Problema:** "scrub preço" aparecia "pre�o" (replacement char). Google Suggest retornava bytes em Latin-1 (não UTF-8) pro IP da Supabase us-east-2.

**Fix em `edge-functions/google-suggest.ts`:**
- Adicionado `Accept-Charset: utf-8` + `User-Agent: Mozilla/5.0` no fetch
- Leitura via `Content-Type` header
- Fallback: se UTF-8 decode gerar `\uFFFD`, re-decoda como ISO-8859-1 (Latin-1 sempre decoda sem erro)
- Edge function v4 deployada

### 27.7 Dashboard DMS — "Tarefas desta semana" agora dinâmica

Commit `c8ce283`:

**Antes:** 4 tarefas hardcoded fake no HTML ("Publicar reels Scrub Comfy", "Briefing @dra.caroll", etc). `toggleCheck` só marcava visual (perdido no reload).

**Agora:** `loadMinhasTarefasSemana()` query em `tarefas`:
- Prazo entre hoje e +7 dias, não concluídas
- Responsável contém nome do `currentProfile.nome` (match parcial ILIKE-like)
- Fallback: se user não tem tarefas, mostra top 6 da equipe (label muda para "Próximas da equipe")
- Label auto-adapta: "Sem tarefas desta semana" se vazio

**Interação real:**
- Checkbox marca `concluido=true` no banco (com animação fade-out)
- Click no título → `openTarefa(id)` abre modal do Kanban
- Chip colorido de prazo: ⚠ atrasada (vermelho) / 🚨 hoje (vermelho) / amanhã (âmbar) / em Nd (cinza)
- "Ver todas →" no canto leva pro Kanban

**Chamada:** no init após `checkAuth()` + quando volta pra `viewId='home'`.

### 27.8 Remoção de "Comunidade e CRM" + migração de permissões

Commit `de68098`:

**Problema:** seção era 95% duplicada pelo Cliente 360 (scoring, KPIs, tabela por segmento). Único conteúdo único: tabela "Canais de Relacionamento" (6 CRMs internos).

**Cirurgia:**
- ❌ `view-comunidade` inteira removida (65 linhas)
- ❌ nav-item "Comunidade e CRM" do sidebar
- ❌ `VIEW_META['comunidade']`
- ❌ `'comunidade'` da categoria Vendas em sidebar groups
- ❌ callback map `comunidade: 'loadClienteScoring'`
- ❌ chamada órfã `loadClienteScoring()` no boot (economiza 1 query)
- ✅ Tabela "Canais de Relacionamento (CRMs Internos)" **movida para Canais e Vendas** (antes do bloco Eventos)
- ✅ Dead code preservado: função `loadClienteScoring()`, `renderScoringKPIs`, `renderScoringTable`, `filterScoring`, `_scoringCache`, CSS `#scoring-*` (inofensivos, não chamados)

**SQL (via Management API):**
- `gerente_financeiro` ganhou `cliente360=true`
- `trafego_pago` ganhou `cliente360=true`
- `comunidade=true` mantido pra compat (sem efeito no UI)

**Efeito líquido:**
- `admin`, `gerente_comercial`, `gerente_marketing`: sem mudança
- `gerente_financeiro`, `trafego_pago`: agora veem Cliente 360 completo
- `designer`, `producao_conteudo`, `vendedor`, `expedicao`: continuam sem CRM (como era antes)

### 27.9 Chave Gemini Pro + pricing Nano Banana 2 descobertos

**Chave nova testada** (<REVOGADA — ver TOKENS local>):
- ✅ PAID/PRO — tem acesso a Gemini 2.5 Pro (chave antiga dava 429 nele)
- ✅ `gemini-2.5-flash-image` funcionando (Nano Banana 2)
- ❌ Imagen 3 e 4 via AI Studio endpoint: 404 (precisaria Vertex AI direto)

**Teste manual no Media Studio do Google Cloud Agent Studio:**
- Projeto criado: "My First Project"
- Vertex AI / Agent Platform API ativada
- Avatar Dra. Mariana gerado com sucesso (9/10 de qualidade)
- Anatomia, mãos, traços brasileiros, jaleco elegante, consultório real

**Prompt que funcionou:**
```
Professional portrait photography of a 35-year-old Brazilian female
dentist with medium-length dark brown hair, light-medium warm skin
tone, confident genuine smile showing authority and approachability,
wearing an elegant tailored white medical lab coat with subtle
premium detailing. She stands in a modern minimalist dental clinic
with soft natural daylight from a large window. 3/4 portrait
composition, shot on Canon EOS R5 with 50mm lens, shallow depth of
field, beige and warm white color palette, photorealistic, editorial
commercial photography style, high detail, sharp focus on face.
```

**Pricing confirmado:**
- `gemini-2.5-flash-image`: US$ 0.039/imagem = **~R$ 0,20**
- Input: US$ 0.30 / 1M tokens = R$ 1,56 / 1M tokens
- Sem free tier para imagem
- "Privacidade garantida" (não usado pra treino no tier pago)

**⚠️ Crédito grátis já expirou:**
- Criado em 24/04/2025, valor R$ 1.960,19
- Expirou em 25/07/2025 sem uso
- Qualquer gasto agora vai direto no cartão

### 27.10 Arquivos novos / commits deste ciclo

**SQL scripts criados:**
- `sql-scripts/sql-cliente-campanhas.sql` (Fase 6)
- `sql-scripts/sql-campanhas-calendario-integracao.sql` (integração calendário)

**Edge Functions modificadas (todas deployadas via Management API):**
- `ai-chat.ts` (v3→v4→v5→v7): +6 tools C360 + retry + reset secrets
- `google-suggest.ts` (v4): encoding fix Latin-1 fallback

**Arquivos novos no repo GitHub Pages:**
- Nenhum — tudo mudanças em arquivos existentes

**Commits deste ciclo** (da Fase 6 até agora):
```
9aaf4a2 → Fase 6 base
180c3a2 → options dark + c360Confirm
31dac5c → c360Confirm em nota/insight/segmento
2315ecc → exige Gerar antes de PDF/CSV/Copiar
c90bc34 → integração automática com calendário
ddf7a91 → eventos read-only calendário
ae897e9 → fix double-submit + banner laranja
87afb33 → laranja vibrante no grid
53936ca → cor null pra herdar do tipo
6115a37 → overlay loading (FOUC fix v1)
0ff8121 → anti-autofill Chrome v1
dcbb11c → autofill bulletproof + contador dinâmico
87e97a5 → mata flash demo definitivamente
ba0fd8b → Fase 7.1 Sincronização
0a95702 → +6 tools C360 no ai-chat
5ded694 → retry + mensagem amigável no ai-chat
b9e5023 → fix encoding google-suggest
c8ce283 → tarefas da semana dinâmicas no dashboard
5475cdd → Fase 7.2 + 7.3 Configurações + Logs
de68098 → Remove 'Comunidade e CRM', move tabela pra Canais e Vendas
```

**19 commits** no total durante este ciclo.

**Cache-busting final do Cliente 360:** `cliente-360-boot.js?v=29`

### 27.11 Estado dos dados (23/04/2026 final)

| Métrica | Matriz | BC |
|---|---|---|
| Clientes no cliente_scoring | 5.560 | 3.036 |
| Pedidos | 8.812 | 4.374 |
| pedidos_itens | 23.318 | 7.485 |
| Contatos | 28.620 | 12.344 |
| Produtos | 2.205 | 2.547 |
| Faturamento total | R$ 4.87M | R$ 1.67M |
| VIPs | 23 | 0 |
| Em risco | 638 | 472 |
| Perdidos | 4.627 | 2.435 |

**Crons Bling**: 22/22 ativos, 0 falhas últimas 48h, cobertura 100%.

---

## 28. PENDÊNCIAS AGUARDANDO DECISÃO

### 28.1 🕒 3 Features pedidas pela Manu (WhatsApp 23/04 manhã)

**Manu confirmou que são 3 features SEPARADAS**, não relacionadas entre si. Juan mandou perguntas pra ela responder depois da aula. Contexto em `memory/pendente_3_features_manuela.md`.

#### 1) Campanhas Internas (nova aba no DMS principal)
Fluxo: subir campanha → todos recebem notificação → cada pessoa vê na aba dela a função dela naquela campanha.

**Perguntas em aberto:**
- Que campos a campanha tem? (nome, data ini/fim, descrição, orçamento, briefing?)
- Quais funções possíveis? (Designer, Copy, Revisor, Editor vídeo, Gerente... outras?)
- Uma pessoa pode ter mais de uma função na mesma campanha?
- Quem pode subir/atribuir? Só admin/gerente ou qualquer um?

**Defaults se não responder**: nome, data ini/fim, descrição, briefing_id opcional. Funções: Designer/Copy/Revisor/Editor Vídeo/Gerente/Outra. Múltiplas por pessoa. Só admin/gerente_marketing atribui.

#### 2) Expedição (nova seção no DMS, FORA do Cliente 360)
Card por campanha com data início/fim, brinde, condição comercial, alerta automático 1 semana antes pra revisar brindes e enviar pras lojas.

**Perguntas em aberto:**
- "Lojas" = Piçarras + BC (físicas) ou também revendedoras?
- Brinde = catálogo Dana ou cadastro livre (nome + foto)?
- Condição comercial = texto livre ou campos estruturados?
- Alerta 1 semana antes: só sininho ou também email?
- Relaciona com Campanhas Internas ou é independente?

**Defaults**: Piçarras + BC. Brinde cadastro livre com upload. Condição texto livre. Alerta só sininho. Independente de Campanhas Internas.

#### 3) Meus Clientes (nova aba DENTRO do Cliente 360)
Vendedor loga com senha → vê só a carteira dele (VIPs e clientes que atende).

**Perguntas em aberto:**
- Como cliente vira "do vendedor"? Pelo `pedidos.vendedor_id` do Bling ou atribuição manual?
- Senha do vendedor = mesma do DMS ou separada?
- Vendedor só vê ou também edita clientes dele?
- Admin vê a carteira de todos?

**Defaults**: vendedor_id do Bling auto + possibilidade de atribuição manual (tabela `cliente_vendedor`). Senha DMS normal. Vendedor só vê. Admin vê todos.

**Ordem de implementação sugerida quando liberar**: Meus Clientes (mais simples) → Expedição → Campanhas Internas.

### 28.2 🎨 Integração Gemini 2.5 Flash Image (Nano Banana 2)

**Status**: validado tecnicamente, aguardando aprovação da Manu sobre custo recorrente.

**O que foi descoberto/testado:**
- Chave nova Gemini PAID (REVOGADA — ver TOKENS local) funciona pra:
  - `gemini-2.5-flash` (bot IA texto) — ~R$ 0,009/pergunta
  - `gemini-2.5-pro` (bot IA avançado) — ~R$ 0,02/pergunta
  - `gemini-2.5-flash-image` (imagem) — R$ 0,20/imagem
- Avatar teste (Dra. Mariana) gerado com qualidade 9/10 no Media Studio
- Crédito grátis do Google já expirou em 2025-07-25 — gastos vão direto no cartão

**Plano de implementação (~2h):**
1. Troca secret `GEMINI_API_KEY` no Supabase pra a nova (bônus: bot ganha Pro + some 503)
2. Atualiza `.claude/AI_KEYS.txt` local
3. Cria edge function `gerar-avatar-persona` com 5 prompts prontos (Clínicas/Empresas/Instituições/Liberal/Estudante)
4. Bucket Storage `avatares-personas` (público leitura)
5. Botão "🎨 Gerar Avatar IA" nos cards de persona + modal + galeria

**Custos estimados pra Manu:**
| Cenário | Bot perguntas/dia | Imagens/mês | Total/mês |
|---|---|---|---|
| Conservador | 50 | 15 | R$ 13 |
| Moderado (esperado) | 100 | 30 | R$ 33 |
| Intenso | 300 | 100 | R$ 100 |
| Super pesado | 500 | 300 | R$ 195 |

**Proteção sugerida**: alerta de orçamento em https://console.cloud.google.com/billing/budgets. Começar com R$ 30/mês.

**Detalhes completos em**: `memory/ideia_avatar_ia_personas.md`

### 28.3 📄 Portfolio zju4nndev.netlify.app (fora do escopo DMS)

Plano completo de melhorias documentado em:
`C:/Users/Juan - Dana Jalecos/Documents/Sistema Marketing/PORTFOLIO - MELHORIAS.txt`

Inclui: reposicionar case Dana Jalecos, stack real, prova social, funil comercial, vídeo loop hero, migração pra Next.js/Astro, SEO, analytics. Cronograma de 4 semanas (~24h de trabalho).

### 28.4 🧹 Seções ainda de demo (baixa prioridade)

- **Referências** (menu Inteligência): 7 categorias vazias
- **Prova Social**: botão "Novo Conteúdo" na topbar sem handler
- **Campanhas** (DMS): placeholder, aguardando APIs de ads (Meta App Review 2-8 sem)
- **E-commerce** (DMS): placeholder Magazord (solicitar `integracao@magazord.com.br`)

### 28.5 🔐 Senhas temporárias (pendência de usuário)

**4 usuários ainda com `DanaTemp2026!`** (plano: avisar pra trocarem em Meu Perfil):
- comercial@danajalecos.com.br
- hadassahzcf@gmail.com
- luanadomecianomkt@gmail.com
- hdonare@gmail.com

---

## 29. PROMPT PARA PRÓXIMO CHAT

```
Estou continuando o desenvolvimento do DMS (Dana Marketing System) da Dana Jalecos.

Por favor, leia o arquivo de documentação antes de tudo pra entender o estado completo do sistema:

C:/Users/Juan - Dana Jalecos/Documents/Sistema Marketing/DOCUMENTACAO-COMPLETA-DMS.md

Estado atual (23/04/2026 final):
- Cliente 360 COMPLETO (Fases 1-7): lista, detalhe, dashboard, insights IA, notas com @ + sininho, segmentação customizada, CAMPANHAS com envios/PDF/CSV, SINCRONIZAÇÃO, CONFIGURAÇÕES, LOGS
- Integração Cliente 360 ↔ Calendário DMS funcionando (campanhas com data criam eventos laranjas automaticamente, read-only no calendário)
- AI Chat com 17 tools incluindo 6 do Cliente 360 + retry automático + mensagem amigável pra 503
- Seção "Comunidade e CRM" removida (duplicada com C360), tabela CRMs internos migrada pra Canais e Vendas
- Tarefas desta semana no Dashboard agora dinâmica (puxa do Kanban)
- Fix de encoding Google Suggest (palavras-chave) resolvido
- 22 crons sincronizando o novo banco wltmiqbhziefusnzmmkt (100% uptime)

Pendências aguardando decisão:
1. 3 features novas pedidas pela Manu (Campanhas Internas + Expedição + Meus Clientes) — perguntas em aberto na memória
2. Integração Gemini 2.5 Flash Image (Nano Banana 2) pra geração de avatares das personas — aguardando Manu aprovar custo ~R$ 30-50/mês
3. Portfolio zju4nndev.netlify.app refatoração — plano em PORTFOLIO - MELHORIAS.txt no Desktop

Arquivos principais:
- index.html (~18k linhas, DMS)
- cliente-360.html (demo base) + cliente-360-boot.js (~3500 linhas, toda lógica do C360)
- edge-functions/ (21 funções: ai-chat, gerar-avatar-persona [pendente], cliente360-insight, sync-*, etc)

Credenciais:
- Supabase PAT: .BACKUP/.Tokens nova conta supabase.txt
- Gemini API chave antiga (free): .claude/AI_KEYS.txt
- Gemini API chave nova (PAID, aguardando troca): <REVOGADA — ver TOKENS local>
- Google Cloud projeto: "My First Project" (Dana conta Google)

Vamos continuar de onde paramos.
```

---

**Fim do ciclo 23/04 · Novo ciclo abaixo**

---

## 30. CICLO 24/04/2026 — 3 FEATURES MANU + 9 MELHORIAS + AVATARES IA

Sessão gigantesca. As 3 features que a Manu pediu ficaram **100% completas**, mais 9 melhorias extras em Campanhas Internas, integração de geração de imagens IA em 4 seções, novos usuários, fixes críticos e um dashboard de custos no Admin.

### 30.1 Feature 3 — MEUS CLIENTES (Cliente 360 Fase 8)

**Objetivo Manu:** vendedor loga → vê só a carteira dele; admin vê tudo + performance por vendedor; reatribuição manual possível.

#### SQL base (`sql-meus-clientes.sql`)
3 tabelas novas:
- **`vendedor_mapping`** — mapa Bling `vendedor_id` (bigint) → `profile_id` UUID + display_name + empresa. PK composto.
- **`cliente_vendedor_manual`** — override manual (contato_id, empresa, profile_id, motivo, autor). PK composto.
- **`cliente_vendedor_historico`** — log imutável de toda reatribuição (anterior → novo, quem, quando, motivo).

**View `cliente_scoring_vendedor`** — resolve dono do cliente com prioridade:
1. Manual (`cliente_vendedor_manual`)
2. Bling (via `vendedor_mapping` + último pedido do cliente)
3. `nao_atribuido` (fonte = null)

**Views agregadas** (`sql-meus-clientes-view-agregada.sql`):
- `vendedor_performance` — GROUP BY vendedor + empresa (clientes, vips, ativos, faturamento, ticket)
- `meus_clientes_totais` — 1 row por empresa (total, com/sem vendedor, faturamento total)
- `bling_vendedor_counts` — agregação pedidos por bling_id (usada no modal Mapear)

**Permissão `meus_clientes`** em cargo_permissoes:
- admin, gerente_comercial, gerente_marketing, vendedor: true
- demais: false

**RLS:** vendedor_mapping escrita só admin/gerente_comercial; cliente_vendedor_manual SELECT via `has_cliente360_perm()`, escrita admin/gerente_comercial.

#### SQL Fase 2 (`sql-meus-clientes-fase2.sql`)
Mais 2 tabelas pra completar o que a Manu pediu:

- **`clientes_manuais`** — prospects/leads cadastrados no DMS que NÃO vêm do Bling
  - Campos: nome, telefone, email, documento, cidade, UF, empresa, observação, status_relacionamento, profile_id_vendedor
  - Status: novo, contatado, negociando, comprou, perdido, sem_interesse
  - RLS: vendedor vê os dele; admin/gerente_comercial/gerente_marketing vê todos
- **`cliente_metadata`** — overrides em clientes Bling (status_relacionamento, telefone_alternativo, observacao_rapida)
  - PK composto (contato_id, empresa)
  - Usado no painel "Acompanhamento comercial" do detalhe do cliente

#### Frontend (`cliente-360-boot.js` subindo de v=30 → v=40)
Nova aba **"Meus Clientes"** no sidebar C360 (injetada dinamicamente).

**Vista vendedor** (cargo=vendedor):
- 6 KPIs: clientes, VIPs, ativos, em risco, faturamento, ticket médio
- Tabela só com os dele (filtrada server-side via `.eq('vendedor_profile_id', profileId)`)
- Mensagem "carteira vazia" se ainda não foi mapeado

**Vista admin/gerente:**
- 5 KPIs globais + badge "⚠ Nenhum vendedor mapeado" se vazio
- **🏆 Ranking por vendedor** (medalhas 🥇🥈🥉 + share %)
- **⚙ Mapear vendedores Bling** — modal com top 50 bling_ids + dropdown pra profile do DMS
- Filtro "Todos / Sem vendedor / [cada vendedor]"

**Reatribuir cliente** (botão 🔀 na linha — só admin/gerente_comercial):
- Modal escolhe novo profile + motivo
- Upsert em `cliente_vendedor_manual` + insert em `cliente_vendedor_historico`

**Filtros completos** (vendedor E admin):
- Busca por nome (ilike, debounce 400ms)
- Segmento (VIP, Frequente, Ocasional, Em Risco, Inativo, Novo)
- Min/Max pedidos
- Min/Max gasto R$
- Admin: filtro por vendedor + "Sem vendedor"
- Botão "Limpar filtros" (aparece vermelho com filtro ativo)

**Adicionar/editar clientes manuais:**
- Botão **"+ Novo cliente"** na barra de filtros
- Modal com 10 campos
- Badge roxo **"DMS"** na tabela pra diferenciar
- Click no cliente manual abre edição; click no Bling abre detalhe tradicional

**Escopo granular por cargo** (`cargo_permissoes`):
7 chaves novas: `c360_dashboard`, `c360_clientes`, `c360_segmentacao`, `c360_campanhas`, `c360_sincronizacao`, `c360_configuracoes`, `c360_logs` + a existente `meus_clientes`.
- Admin pode ligar/desligar cada aba do C360 por cargo
- UI no Admin → Permissões: novo grupo **"👤 Cliente 360 · Abas"** com 8 toggles
- Sessão aberta redireciona automaticamente se admin muda permissão (via realtime `cargo_permissoes`)

**Detalhe do cliente Bling** (`cliente-360-boot.js` v=40):
- Painel novo **"📝 Acompanhamento comercial"** no topo do detalhe
- Status do relacionamento (dropdown 6 opções)
- Telefone alternativo (não sobrescreve o do Bling — só adiciona)
- Observação rápida (1 linha)
- Upsert em `cliente_metadata`, mostra autor + timestamp

#### Nova usuária — THAMYRES
- Criada via Admin API `POST /auth/v1/admin/users`
- Email: `comercial.dana3@gmail.com` · UUID: `a6350288-c0fe-4413-bff2-b9c993229e37`
- Cargo: vendedor
- Senha temp: `DanaTemp2026!`
- 2 bling_ids mapeados: `15596839174` (197 pedidos) + `15596839173` (189 pedidos)
- **Carteira inicial: 314 clientes · R$ 212.496,16 faturamento histórico**

#### AI Chat — nova tool `minha_carteira`
- Edge function `ai-chat` v8 deployada
- Tool nova filtra clientes por `vendedor_profile_id = userId`
- System prompt blindado: cargo=vendedor → bot OBRIGATORIAMENTE usa `minha_carteira`, NUNCA `resumo_cliente360`/`top_clientes`/`buscar_contato`
- Resposta em 2ª pessoa ("sua carteira", "seu top cliente")
- Ex: "qual minha cliente com melhor score" → Natália Brianez Fioretti (VIP, score 81)

---

### 30.2 Feature 1 — CAMPANHAS INTERNAS

**Objetivo Manu:** organização da equipe por campanha. Cada pessoa vê o que faz em cada campanha. 11 funções. Múltiplas funções por pessoa. Só admin/gerente cria.

#### SQL (`sql-campanhas-internas.sql`)
- **`campanhas_internas`** — 19 colunas
  - Obrigatórios: nome, tipo (venda/branding/lancamento/clearance/institucional/outro), datas, status (planejamento/producao/ativa/encerrada/cancelada), objetivo, meta_tipo+meta_valor, publico_alvo, canais[], briefing_link, responsavel_id
  - Estratégicos Dana: oferta_principal, produtos_foco, argumento_central, risco/gargalo
- **`campanha_interna_membros`** — N:N com profiles, **array de funções** (múltiplas permitidas)
  - 11 funções Dana: gerente, copy, designer, editor_video, trafego, social_media, crm, comercial, producao, expedicao, influencer_manager + outro

**Permissões granulares** (4 chaves):
- `campanhas_internas` (ver aba)
- `campanha_interna_criar` (só admin + gerentes)
- `campanha_interna_editar`
- `campanha_interna_excluir`

**Funções SQL helper**:
- `has_campanha_interna_perm()` / `_criar()` / `_editar()` / `_excluir()`

**RLS:** criar/editar permite responsável + criador (mesmo sem perm granular). Membros: SELECT com perm, escrita com editor OR responsável/criador.

#### Frontend (`index.html`)
Nova seção **"Campanhas Internas"** na sidebar (Marketing → após Campanhas), com badge contador de campanhas ativas da pessoa.

**Lista de cards** (grid):
- 5 KPIs: Total, Ativas, Produção, Planejamento, **Em que estou**
- Filtros: status + "👤 Só as minhas"
- Cada card: nome, tipo, datas, responsável, status badge, objetivo resumido, meta, **suas funções destacadas em negrito**

**Modal Criar/Editar** — 14 campos:
- Nome*, Tipo, Status, Data início/fim, Responsável, Objetivo, Meta tipo+valor, Público, Canais (multi), Briefing link
- **Bloco Estratégia Dana**: Oferta principal, Produtos foco, Argumento central, Risco

**Modal Detalhes** — mostra tudo formatado + 4 blocos coloridos (oferta dourada, produtos azul, argumento roxo, risco vermelho) + lista de equipe + (expedição + anexos + comentários + timeline conforme melhorias abaixo).

**Atribuir membro:**
- Dropdown de profile (filtra quem já tá atribuído)
- **Checkboxes das 11 funções Dana** (múltiplas)
- Observação opcional
- Ao salvar, insere em `alertas` pra pessoa atribuída (audiencia=pessoal, link_ref=campanhas-internas)

---

### 30.3 Feature 2 — EXPEDIÇÃO (módulo DENTRO da campanha)

**Objetivo Manu (textual):** "Expedição NÃO pode ser separada. É a mesma campanha, com módulo de expedição dentro."

#### SQL (`sql-campanha-expedicoes.sql`)
- **`campanha_expedicoes`** — FK pra campanhas_internas, 21 colunas
  - 4 tipos destino: `loja_propria`, `revendedora`, `influencer`, `cliente_final`
  - Brinde híbrido: `brinde_tipo` (catalogo/livre/nenhum) + produto_codigo + produto_nome + foto_url + descricao + quantidade
  - Condição estruturada: compra_minima, desconto_pct, frete_gratis, tem_brinde + observação texto livre
  - Status: pendente/em_producao/enviado/entregue/cancelado
  - Flags `alerta_7d_enviado`/`alerta_3d_enviado` pra não repetir

**Função `gerar_alertas_expedicao()`** — procurura expedições com data de envio em 7 ou 3 dias, insere alerta pessoal pra:
- Responsável da campanha
- Todos com função `expedicao`, `comercial` ou `gerente`

**Cron agendado** `gerar-alertas-expedicao-diario` — `0 12 * * *` (9h São Paulo).

#### Frontend
Seção **"📦 Expedição"** no modal de Ver Campanha com:
- Botão **"+ Novo envio"** (se puder editar)
- Cards por expedição com badges de status + dias até envio
- Modal criar/editar com 20+ campos (destino, endereço, contato, brinde, condição...)
- Toggle dinâmico dos campos de brinde (catálogo → busca produtos, livre → nome+foto+descrição)
- Integra com tabela `produtos` (catálogo Bling) pra auto-preencher foto/nome

---

### 30.4 Feature complementar — CAMPANHAS (listagem de briefings do Construtor)

**Problema:** a seção "Campanhas" no DMS principal era placeholder aguardando APIs de Meta/Google/TikTok Ads. Sem ação.

**Fix:** quando o usuário salva briefing no **Construtor de Campanha**, agora aparece automaticamente na seção **Campanhas** como card:
- Badge "📴 Não conectada" (vai virar "🟢 Ativa" quando conectar as APIs)
- Mostra título, conceito (140 chars), público, canais, investimento, autor, data
- Click no card → modal detalhado (público, problema, conceito, oferta, gancho, CTA...)
- Botão "🔌 Conectar API" leva pra seção APIs

O placeholder "aguardando APIs" ficou abaixo dos cards explicando o que virá quando conectar.

Hook no `saveBriefing()`: após insert, também chama `loadCampanhasFromBriefings()` se estiver na view.

---

### 30.5 9 MELHORIAS em Campanhas Internas

Sequência de commits, cada um uma melhoria:

#### a) Integração com Calendário (`98fd3ce`)
- Novo tipo `campanha_interna` em calendario (CHECK expandido)
- Coluna `calendario_evento_id UUID` em campanhas_internas (FK ON DELETE SET NULL)
- Sync automático via `ciSyncCalendario(campanhaId, camp)`:
  - Cria evento se a campanha tem data e ainda não tem evento
  - Atualiza se mudar a data ou nome
  - Apaga se tirar a data
- Cor **roxa** (#a855f7) no calendário
- Evento **read-only** no modal ver-evento do DMS (banner "🔒 Gerenciada pelo módulo Campanhas Internas" + botão "🎯 Abrir Campanha Interna")
- Deep-link: clicar no evento navega direto pro modal da campanha

#### b) Comentários com @menções (`95c1ba8`)
- Tabela nova `campanha_interna_comentarios` (com mentions_ids UUID[])
- UI no modal: lista + textarea + @menção regex
- Realtime sincroniza entre browsers
- Notificação pessoal via `alertas` quando menciona alguém
- Editar/apagar próprios comentários

#### c) Anexos & Materiais (`af7dccd`)
- Tabela `campanha_interna_materiais` (link, descrição, tipo MIME)
- Grid com ícone auto por tipo de arquivo (PDF, imagem, vídeo, Figma, etc)
- Modal pra adicionar link + descrição
- Realtime

#### d) Progresso por membro (`86d89c8`)
- Coluna `status` em `campanha_interna_membros` (pendente/em_andamento/concluido/bloqueado)
- Dropdown inline no modal de detalhes pra cada membro mudar seu próprio status (ou admin/gerente mudar de todos)
- **Barra de progresso da equipe** no card da lista ("X/Y concluído")

#### e) Timeline + Notificação auto (`657e642`)
- Tabela `campanha_interna_historico` (tipo + descrição + user + dados_antes/depois)
- Helper `ciRegistrarHistorico()` em todas mutações (criar, editar, mudar_status, add_membro, remove_membro, add_material, add_expedicao)
- Seção timeline collapse no modal (últimos 30 eventos)
- **Notificação automática**: quando status da campanha muda, insere alertas pessoais pra TODOS os membros + responsável

#### f) View Kanban (`0b7a2f7`)
- Toggle **▦ Grid ↔ ▤ Kanban**
- 5 colunas (Planejamento, Produção, Ativa, Encerrada, Cancelada — cancelada esconde se vazia)
- Cards arrastáveis entre colunas via HTML5 drag & drop
- Drop muda o status + registra histórico + notifica equipe + sincroniza calendário

#### g) Filtro por responsável (`0b7a2f7`)
- Dropdown no topo da lista: "Responsável: todos" + cada pessoa com campanha
- Funciona tanto no Grid quanto no Kanban

#### h) Export PDF (`ae70e04`)
- Botão "🖨 Exportar PDF" no modal de detalhes
- HTML print-friendly com 6 seções: info geral + estratégia (4 blocos) + equipe (tabela) + expedição (tabela) + anexos (tabela) + histórico (últimos 20)
- `window.print()` automático 400ms após abertura

#### i) Botão "Apagar" no modal de ver (`3fb5cb2`)
- Sem precisar abrir editar
- Validação clara de permissão e RLS
- Console log pra diagnóstico

---

### 30.6 AVATARES IA (Gemini 2.5 Flash Image + ImgBB)

**Objetivo:** gerar avatares profissionais via IA pra usar em briefings, personas, mockups de campanha e referências pra designer.

#### Infra
- **Chave PAID Gemini** separada (`GEMINI_IMAGE_API_KEY`) — só essa endpoint, bot IA continua na chave free (economia)
- **Upload pra ImgBB** (não usa storage Supabase) — `IMGBB_API_KEY` como secret
- Tabelas:
  - **`avatares_ia_config`** (id=1 singleton) — ativo, limite_diario_usuario, limite_mensal_reais, custo_por_imagem_reais, pausado_por_limite
  - **`avatares_ia_log`** — user, contexto, ref_id, prompt, url (ImgBB), custo, status (ok/erro/bloqueado_quota/bloqueado_killswitch)
- Funções SQL: `avatares_ia_count_hoje(uid)` + `avatares_ia_gasto_mes()`
- Permissão `avatares_ia_gerar` por cargo

#### Edge function `gerar-avatar-ia` (v8)
Pipeline:
1. Auth JWT + busca profile
2. Valida permissão `avatares_ia_gerar` por cargo
3. Valida config global ativa + kill-switch mensal
4. **Quota diária**: admin ilimitado, outros 5/dia (count de hoje via RPC)
5. **Enhancer da logo Dana**: detecta regex `lab coat|jaleco|scrub|doctor|nurse|etc` → fetch da logo "Principal Horizontal" do brandkit → envia como `inlineData` (image-to-image). Pula se prompt tem `NO lab coat|NOT a doctor|etc`.
6. **Aspect ratio dinâmico**: persona→9:16, campanha→16:9, outros→1:1
7. Call Gemini `generateContent` com `generationConfig.imageConfig.aspectRatio`
8. Upload do PNG base64 pra ImgBB → URL permanente
9. Log no banco + retorna URL + custo estimado

#### Frontend
**Helper reutilizável `window.gerarImagemIA({prompt, contexto, contextoRefId, titulo, onSave})`**:
- Modal com textarea de prompt editável + preview + botões (gerar/regerar/baixar/salvar)
- Mostra quota atual ("3/5 hoje" ou "admin · ilimitado") + gasto mensal
- Callback `onSave` opcional pra vincular URL ao recurso

**Botões integrados em 4 seções:**

1. **Públicos Ideais** — 5 personas cada com prompt pronto (Dra. Mariana dentista, Diretor Gabriel executivo-terno, Coord. Eduardo blazer-acadêmico, Profissional Liberal, Estudante). Cada card tem 2 botões: **🎨 Gerar Avatar IA** + **📚 Histórico**.

2. **Campanhas Internas** — botão **🎨 Visual IA** no footer. Prompt construído a partir de oferta + produtos foco + argumento + público. onSave vincula como material anexo.

3. **Briefing Visual** — botão **🎨 Mockup IA** no modal. Prompt a partir de conceito + oferta + público + quote. onSave salva em `materiais_briefing`.

4. **Criativos aba To-Do** — botão **🎨 IA** por demanda. Aspect ratio conforme formato (reels/stories→9:16, feed/carrossel→1:1, banner→16:9). Gera imagem de referência conceitual.

**Modal Histórico** (`window.abrirHistoricoIA({contexto, contextoRefId, titulo})`):
- Grid responsivo de cards com preview via `<img src=url>` do ImgBB
- Filtros: contexto + checkbox "ver de todos" (admin)
- Resolve nome amigável pro `ref_id` (persona → "Dra. Mariana (Clínicas)", campanha → nome, briefing → título)
- Cada card: preview + autor + data + prompt (100 chars) + botões:
  - **⬇ Baixar** → abre URL em nova aba
  - **🔗 Link** → copia URL pro clipboard
  - **🗑 Apagar** inline 2-cliques (1º vira vermelho "✓ Confirmar apagar", 2º apaga; auto-reverte 5s)

#### Admin → Custos IA (nova aba no Administrador)
Dashboard só pra admin:
- **Gasto do mês** com barra de progresso (verde < 50%, amarelo 50-80%, vermelho > 80%)
- Imagens do mês, % orçamento, restante (R$ e imagens)
- Badge "⏸ PAUSADO" se bateu limite
- Botões: 🔄 atualizar · ⚙ configurar (limites) · ⏸ pausar/ativar · ▶ despausar (confirmação)
- **Ranking top usuários** (nome, cargo, imagens mês, custo mês, 90d)
- Cards por contexto: Personas · Campanhas · Briefings · Outros (contadores mês)
- Grid com últimas 20 gerações (thumbnails 9:16 clicáveis)

#### Defaults da config
- Limite diário por user: **5**
- Limite mensal: **R$ 50**
- Custo por imagem: **R$ 0,20** (Nano Banana 2)
- Budget alert no GCP em R$ 50 (alertas 50/90/100%) — **Juan já criou**

---

### 30.7 FIXES CRÍTICOS

#### a) Personas mostravam 0% pra Gabriel/Eduardo/Mariana
**Causa raiz:** a coluna `contatos.tipo_pessoa` está **vazia em 100% dos registros** (Bling não sincroniza esse campo). O código fazia `contatosByName[nome] || 'F'` → todos caíam como Pessoa Física.

**Fix em `loadPersonasStats`:** agora lê `contato_tipo` direto dos **pedidos** (onde está correto, com F/J/E). Agrega por cliente via voto majoritário (maior número de pedidos define o tipo).

**Distribuição real (Matriz, 12 meses):**
| Persona | Clientes | Receita | % |
|---|---|---|---|
| **Diretor Gabriel (Empresas)** | 69 | R$ 1.330.907 | **41,1%** 🥇 |
| Profissional Liberal | 1.049 | R$ 980.867 | 30,3% |
| **Dra. Mariana (Clínicas)** | 278 | R$ 440.483 | 13,6% |
| Estudante | 2.898 | R$ 434.822 | 13,4% |
| Coord. Eduardo (Instituições) | 51 | R$ 54.269 | 1,7% |

Gabriel é o TOP 1 em receita — antes do fix, aparecia como 0%.

#### b) Prompts dos avatares dos compradores (Gabriel/Eduardo)
**Bug:** Gabriel e Eduardo estavam recebendo jaleco no prompt — mas eles NÃO são profissionais de saúde, são compradores (diretor administrativo e coordenador institucional).

**Fix:**
- Gabriel: prompt reescrito pra **terno executivo** + "NO lab coat, NO scrubs, NO stethoscope"
- Eduardo: prompt pra **blazer + chinos casual acadêmico** + "NO medical lab coat, NO healthcare uniform"
- Regex `NAO_ROUPA` no edge function detecta essas instruções explícitas e **pula a injeção da logo Dana** pra esses casos

Dra. Mariana, Profissional Liberal e Estudante continuam com jaleco (são as usuárias finais do produto).

#### c) Usuário sem permissão pra home caía em tela branca
**Causa:** quando Thamyres (cargo=vendedor, `home=false`) entrava em `https://.../dana-marketing/` sem hash, a init não chamava `go()` — deixava o HTML default com home ativo. Ela via o Dashboard sem permissão.

**Fix:** novo helper `firstAllowedView()` que retorna a primeira view permitida pelo cargo. 3 lugares corrigidos:
1. Init pós-login: sempre chama `go()`, com fallback pra `firstAllowedView()`
2. Init com hash inválido: se a view do hash/localStorage é bloqueada, vai pra `firstAllowedView`
3. `go()` fallback: quando bloqueia navegação, redireciona pra primeira permitida (não mais home hardcoded)

Pra vendedor: `cliente360` é a primeira permitida → cai direto nela.

#### d) Topbar action button respeitando permissão
Novo mapa `TOPBAR_ACTION_PERMS` gateia o botão de ação (Novo Evento, Nova Tarefa, Novo Criativo, Nova Campanha Interna). `go()` esconde + `topbarAction()` valida.

#### e) Admin Permissões — 3 bugs
1. **"Após salvar voltava tudo"** — era bug visual: reload mostrava `cargos[0]` (alfabético = analista_marketplace) em vez do cargo que você editava. Fix: preserva `window._permLastCargo` entre reloads.
2. **Botões ✓/✕ por grupo não funcionavam** — `toggleGroupPerms` chamava `renderPermsForCargo` que o primeiro passo é LER checkboxes de volta pro state (sobrescrevendo a mudança). Fix: agora atualiza DOM direto sem re-renderizar.
3. **Botão "Gerenciar Colunas" do Kanban** não tinha gate de permissão → mostrava mesmo sem `tarefas_criar`. Fix aplicado.

#### f) Realtime entre PCs — notas/deletes
**Causa:** Postgres por default só envia o ID no payload de DELETE. Meus filtros frontend (`row.empresa !== state.empresa`) falhavam porque `empresa` vinha `undefined` em DELETE → skip do re-render → nota não sumia em outros PCs sem F5.

**Fix:** `ALTER TABLE ... REPLICA IDENTITY FULL` em **11 tabelas**:
- cliente_notas, cliente_insights, cliente_segmentos_custom, cliente_campanhas, cliente_campanha_envios, vendedor_mapping, cliente_vendedor_manual, cliente_vendedor_historico, tarefa_comentarios, profiles, cargo_permissoes

Agora DELETEs trazem o row completo → filtro funciona → re-render dispara em todos browsers.

#### g) Realtime em cargo_permissoes
Admin muda permissão → sessão aberta do vendedor recebe o evento → `mcApplyTabPermissions` re-aplica hide/show na hora, sem F5.

#### h) Campanhas Internas — modal footer overlap
Usei `max-height:70vh;overflow-y:auto` no modal-body inline + o `.modal` já tem `max-height:88vh;overflow-y:auto` → double scroll. Footer se sobrepunha ao conteúdo.
**Fix:** removido overflow inline do body; footer usa `justify-content:space-between` + border-top.

#### i) Meus Clientes — race condition auth em aba anônima
**Causa:** em aba anônima, auth demorava pra hidratar → `mcLoadPerms` retornava `{meus_clientes: false}` → cacheava → `mcSetupNav` bailava sem injetar a aba Meus Clientes → TODO o resto aparecia MENOS a dela.

**Fix:** `mcLoadPerms` marca resultado como `_degradado: true` quando auth não está pronta. Setup e hide re-tentam em 500ms até ter auth real. Cache só guarda resultado válido.

#### j) Edge function gerar-avatar-ia — 3 bugs sequenciais
1. **"contexto_ref_id is not defined"** (500) — object shorthand com variável inexistente (variável é `contextoRefId`)
2. **BOOT_ERROR** — redeclarei `const parts` duas vezes no mesmo escopo (strict mode rejeita). Renomeei a segunda pra `partsRet`
3. **PATCH deploy via JSON quebrou a função** — Management API `/functions/{slug}` só aceita metadata; código precisa ir via `POST /functions/deploy?slug=X` com **multipart/form-data**. Criei helper `deploy_edge_via_multipart`.

#### k) Histórico IA — apagar não funcionava
**Causa 1:** RLS da `avatares_ia_log` só tinha SELECT e INSERT policies. UPDATE passava silenciosamente.
**Causa 2:** CHECK constraint do status não permitia `'apagado_usuario'` → 400.

**Fix:** Adicionadas policies UPDATE + DELETE. Troquei soft-delete (status) por **hard DELETE**. RLS garante que só dono ou admin apagam.

#### l) Modal Admin → Permissões não tinha grupo Cliente 360
Adicionado grupo **"👤 Cliente 360 · Abas"** com 8 toggles + labels pra cada chave (c360_dashboard, c360_clientes, meus_clientes, etc).

---

### 30.8 MIGRAÇÕES DO EDGE FUNCTION DEPLOY

Descobri que o método PATCH `/functions/{slug}` só atualiza metadata (verify_jwt, name) e **quebra a função** se enviado com `body`. A forma correta é `POST /functions/deploy?slug=X` com **multipart/form-data**:

```python
body_parts = [
    f'--{boundary}\r\n'.encode(),
    b'Content-Disposition: form-data; name="metadata"\r\n',
    b'Content-Type: application/json\r\n\r\n',
    json.dumps({'name':'X','verify_jwt':True,'entrypoint_path':'X.ts'}).encode(),
    b'\r\n',
    f'--{boundary}\r\n'.encode(),
    b'Content-Disposition: form-data; name="file"; filename="X.ts"\r\n',
    b'Content-Type: application/typescript\r\n\r\n',
    code_bytes,
    b'\r\n',
    f'--{boundary}--\r\n'.encode()
]
```

Usei isso pra ai-chat (v8) + gerar-avatar-ia (v1 → v8). Todas edge functions futuras devem seguir esse padrão.

---

### 30.9 NÚMEROS E MÉTRICAS FINAIS DO CICLO

#### Tabelas novas criadas (13)
- `vendedor_mapping`
- `cliente_vendedor_manual`
- `cliente_vendedor_historico`
- `clientes_manuais`
- `cliente_metadata`
- `campanhas_internas`
- `campanha_interna_membros`
- `campanha_expedicoes`
- `campanha_interna_comentarios`
- `campanha_interna_materiais`
- `campanha_interna_historico`
- `avatares_ia_config`
- `avatares_ia_log`

#### Views novas (4)
- `cliente_scoring_vendedor`
- `vendedor_performance`
- `meus_clientes_totais`
- `bling_vendedor_counts`

#### Edge functions alteradas/criadas
- **`ai-chat`** (v8) — nova tool `minha_carteira` + prompt blindado pra cargo=vendedor
- **`gerar-avatar-ia`** (v8, nova) — pipeline Gemini + ImgBB + quota + kill-switch

#### Cron novo
- `gerar-alertas-expedicao-diario` — `0 12 * * *` (9h SP)

#### Secrets Supabase adicionadas (2)
- `GEMINI_IMAGE_API_KEY` — chave paga separada
- `IMGBB_API_KEY` — hospedagem de imagens

#### Bucket Supabase
- `avatares-personas` foi **CRIADO e DELETADO** — migrou tudo pra ImgBB (poupa storage Free tier)

#### Permissões novas em cargo_permissoes (16 chaves)
- `meus_clientes`
- `c360_dashboard`, `c360_clientes`, `c360_segmentacao`, `c360_campanhas`, `c360_sincronizacao`, `c360_configuracoes`, `c360_logs`
- `campanhas_internas`, `campanha_interna_criar`, `campanha_interna_editar`, `campanha_interna_excluir`
- `avatares_ia_gerar`
- `c360_*` = 7 já no conteúdo acima

#### Usuários novos no sistema
- **Thamyres** (`comercial.dana3@gmail.com`) — cargo `vendedor` · senha temp · carteira 314 clientes Matriz

#### Arquivos SQL criados
- `sql-scripts/sql-meus-clientes.sql`
- `sql-scripts/sql-meus-clientes-view-agregada.sql`
- `sql-scripts/sql-meus-clientes-fase2.sql`
- `sql-scripts/sql-c360-permissoes-granulares.sql`
- `sql-scripts/sql-campanhas-internas.sql`
- `sql-scripts/sql-campanha-expedicoes.sql`
- `sql-scripts/sql-avatares-ia.sql`

#### Versões cache-busting
- `cliente-360-boot.js` subiu de `v=29` → `v=40`

#### Commits principais
~35 commits no ciclo. Mais relevantes:
- `e2af898` Meus Clientes base (carteira, reatribuir, mapear)
- `4518d74` Fix layout + KPIs agregados
- `596ec56` Campanhas Internas base
- `5555120` Expedição
- `98fd3ce` Integração Calendário
- `95c1ba8` Comentários
- `af7dccd` Anexos
- `86d89c8` Progresso
- `657e642` Timeline + notif auto
- `0b7a2f7` Kanban + filtro responsável
- `ae70e04` Export PDF
- `1d48f7a` Meus Clientes Fase 2 (manuais)
- `ad8c3e7` view-campanhas briefings
- `790a5e7` Avatares IA base
- `6cab879` IA Campanhas + Briefing
- `a43e6fa` ImgBB migration + Histórico
- `01b59c2` RLS apagar + confirm inline
- `229602c` Aspect ratio vertical personas
- `782191c` Gabriel/Eduardo sem jaleco
- `c4dd27a` Admin Custos IA + Metadata cliente + IA em Criativos

---

### 30.10 PENDÊNCIAS AINDA ABERTAS

Pra o próximo chat:

**🔴 Alta — ação manual do Juan/Dana:**
1. **Mapear vendedores Bling restantes** via Admin → Meus Clientes → ⚙ Mapear (só Thamyres está mapeada; outros ~15 bling_ids precisam ser ligados aos profiles)
2. **Avisar os 4+1 usuários com senha temp** `DanaTemp2026!` pra trocar em Meu Perfil:
   - comercial@danajalecos.com.br
   - hadassahzcf@gmail.com
   - luanadomecianomkt@gmail.com
   - hdonare@gmail.com
   - comercial.dana3@gmail.com (Thamyres)

**🟢 Baixa — terceiros/decisões:**
3. GA4 Service Account (Dana manda JSON)
4. Magazord API (Dana mandar email pra `integracao@magazord.com.br`)
5. Meta/Google/TikTok Ads (App Review 2-8 semanas)
6. Seção Referências (definir fluxo)
7. Botão "Novo Conteúdo" Prova Social (definir fluxo UGC)

**🔧 Técnicas:**
8. Apagar projeto Supabase antigo `comlppiwzniskjbeneos` (7+ dias rodando OK no novo)
9. Backup automatizado semanal

**📄 Fora do DMS:**
10. Portfolio `zju4nndev.netlify.app` — plano em `PORTFOLIO - MELHORIAS.txt`

---

## 31. PROMPT PARA PRÓXIMO CHAT (após /compact em 24/04)

```
Estou continuando o desenvolvimento do DMS (Dana Marketing System) da Dana Jalecos.

Por favor leia antes de tudo:
C:\Users\Juan - Dana Jalecos\Documents\Sistema Marketing\DOCUMENTACAO-COMPLETA-DMS.md

Estado atual (24/04/2026 final):
- As 3 features da Manu (Meus Clientes + Campanhas Internas + Expedição) estão 100% completas
- 9 melhorias extras em Campanhas Internas (Kanban, timeline, comentários, anexos, progresso, PDF, calendário, notif auto, filtros)
- Avatares IA integrado em 4 lugares (Personas, Campanhas Internas, Briefings, Criativos) via Gemini 2.5 Flash Image + ImgBB (zero storage Supabase)
- Admin → Custos IA dashboard com gasto mensal, ranking por usuário, kill-switch R$50/mês
- Thamyres criada como vendedora (314 clientes mapeados)
- Fix Personas: Diretor Gabriel é 41% da receita (era 0% antes do fix)
- Bot IA tem tool 'minha_carteira' que scope por vendedor

Arquivos principais:
- index.html (~19k linhas, DMS)
- cliente-360.html + cliente-360-boot.js (v=40, ~4k linhas)
- edge-functions/ (22 funções: ai-chat v8, gerar-avatar-ia v8, cliente360-insight, sync-*, etc)

Credenciais (arquivos locais fora do git):
- Supabase PAT: .BACKUP/.Tokens nova conta supabase.txt
- AI keys: .claude/AI_KEYS.txt
- ImgBB key: ffbf2140daf4cd3ca2cc1f17885779a7 (secret IMGBB_API_KEY no Supabase)
- Gemini PAID (imagens): <REVOGADA — ver TOKENS local> (secret GEMINI_IMAGE_API_KEY)

Pendências pra atacar (seção 30.10):
- Mapear vendedores Bling restantes (só Thamyres mapeada)
- Avisar 5 users pra trocar senha temp
- GA4 + Magazord + Ads APIs aguardando terceiros
- Apagar projeto Supabase antigo (7+ dias estáveis)

Vamos continuar de onde paramos.
```

---

**Fim da documentação · Atualizado em 24/04/2026 (ciclo 3 features Manu + Avatares IA + 9 melhorias + fixes críticos)**

---

## 32. CICLO 24/04/2026 (TARDE) — VENDEDORAS + UGC + BOT + POLISH

Sessão continuando o mesmo dia. Foco em operacionalizar o sistema com dados reais, limpar UI e fechar pendências técnicas.

### 32.1 Vendedoras novas + categoria "Site" / "Mercado Livre"

Criadas via Admin API (senha padrão `DanaTemp2026!`, cargo `vendedor`):

**Matriz (6 novos):**
- Fabiana Elisa (`fabiana-elisa@danacomercial.com`) — bling 15596436265 + 15596596117 (1.050 clientes)
- Shayda (`shayda@danacomercial.com`) — bling 15596867269
- Natã (`nata@danacomercial.com`) — bling 9139513147 + 15596390268 + 15596418600
- Arthur Garcia (`arthur-garcia@danacomercial.com`) — bling 8783323557
- Euvira Bonatti (`euvira-bonatti@danacomercial.com`) — bling 15596535940
- **Site** (`site@danacomercial.com`, fake) — bling 4283606619 (1.335 clientes) → `excluir_ranking=true`

**BC (4 novas):**
- Camilli Dias (`camilli-dias@danacomercial.com`) — bling 15596840644
- Fabiane Aparecida (`fabiane-aparecida@danacomercial.com`) — bling 15596854721
- Telma (`telma@danacomercial.com`) — bling 15596438449
- Beatriz (`beatriz-bc@danacomercial.com`) — bling 15596142406

**Marketplace fake:**
- Mercado Livre (`mercado-livre@danacomercial.com`, fake) — bling 8075643404 → `excluir_ranking=true`

### 32.2 Flag `excluir_ranking` em `vendedor_mapping`

Nova coluna `excluir_ranking BOOLEAN DEFAULT false` em `vendedor_mapping`. View `vendedor_performance` recriada pra filtrar esses fora do ranking (mas dados continuam na base — filtro "Sem vendedor" ainda mostra).

Também filtra clientes sem vendedor (`vendedor_profile_id IS NULL`) do ranking — deixa limpo só com humanos.

**Uso:** Site, Mercado Livre, e qualquer marketplace futuro não aparece no 🏆 Ranking mas dados ficam pra consulta.

### 32.3 Tag de equipe em Criativos (🏠 Dana / 🏢 Intensiva)

- Coluna `equipe` em `criativos` com CHECK (`dana` | `intensiva`)
- Dropdown "Equipe" no modal "Enviar Arte" (ao lado de Designer)
- Badge colorido nos cards (azul Time Dana, roxo Intensiva)
- Edição pré-preenche o campo quando reabre demanda

### 32.4 Flash de Dashboard fake eliminado

- **Problema:** ao entrar no Cliente 360 aparecia por 1-2s o dashboard com R$ 41.409,90 (30 clientes fake) do template estático antes do boot.js hidratar
- **Fix:** substituí o HTML estático das 6 páginas (dashboard, segmentos, campanhas, sincronização, configurações, logs) por skeleton de "Carregando..." e deletei 29 pages `page-cliente-2` até `page-cliente-30` (boot.js só usa `page-cliente-1` como template)
- **Redução:** 700KB → 310KB (-55.7%)

### 32.5 Fix: primeiro login vai pra Perfil

Comportamento antigo: vendedor novo caía em view bloqueada após login.

Comportamento novo:
- **1º login** (`last_login=null` no banco) → cai em **Perfil** + toast "troque sua senha temporária"
- **Logins seguintes** → última view visitada (localStorage) com fallback `firstAllowedView()`

Detecção antes de `loadProfile` (que atualiza `last_login`) pra capturar o valor anterior.

### 32.6 Reorder do boot C360 pra não travar

**Antes:** `Promise.all([loadClientes, loadDashboard])` antes de `mcSetupNav`. Se qualquer query falhasse, sidebar ficava sem "Meus Clientes".

**Depois:** setup de permissões roda PRIMEIRO em `Promise.allSettled`. Dados vêm depois, cada um com `.catch` individual. Subscriptions realtime com `try/catch` individual. Reaplica permissões no fim (anti-race).

### 32.7 Realtime em `pedidos` no C360

Adicionado subscribe em `postgres_changes` da tabela `pedidos` dentro do iframe C360. Debounce de 8s pra não floodar durante rajada de sync. Quando entra pedido novo → invalida cache, re-render Meus Clientes (se ativa), reload Dashboard (se ativo).

### 32.8 Prova Social UGC completo

Nova tabela `prova_social_conteudo`:
- **Tipos:** depoimento, foto, video, mencao_rede_social, review_produto
- **Workflow:** rascunho → aprovado → publicado → arquivado
- **Autor:** nome, cidade, UF, profissão, Instagram
- **Meta:** rating (1-5), tags[], destaque, origem (instagram/whatsapp/email/google_review/...)
- **RLS:** logado insere rascunho próprio; admin/gerente_mkt/gerente_comercial aprovam e editam qualquer; todos veem aprovados+publicados

**UI:**
- Botão "Novo Conteúdo" na topbar (já existia) agora abre modal completo
- Grid filtrável por tipo (Todos / 💬 Depoimentos / 📸 Fotos / 🎥 Vídeos / 📱 Menções)
- Badge de rascunho pra admin revisar (aparece só pra quem tem `provasocial_aprovar`)
- Cards com rating ⭐, badge de status, marcar/desmarcar destaque

**Permissões novas:** `provasocial_criar`, `provasocial_aprovar`, `provasocial_excluir`.

### 32.9 Bot IA responde sobre Campanhas Internas

`ai-chat.ts` v9 com 2 tools novas:

**`listar_campanhas_internas`** — filtros: `status` (planejamento/producao/ativa/encerrada/cancelada/todos) e `minhas` (bool, filtra onde user é responsável OU membro).

**`detalhe_campanha_interna`** — por `id` ou `nome` (ilike). Retorna: campanha + equipe com funções + expedições + comentários recentes + materiais anexados.

System prompt atualizado enfatizando diferença "Campanhas" (Ads) vs "Campanhas Internas" (gestão de equipe). Whitelist adiciona as 6 tabelas de CI + `prova_social_conteudo`.

Perguntas que o bot responde agora:
- "Quais campanhas internas estão ativas?"
- "Em quais campanhas a Manuela tá?"
- "Me fala tudo sobre a campanha de primavera"
- "Próximas expedições de brinde?"
- "Quem tá na equipe da campanha X?"

### 32.10 Export PDF do Ranking de Meus Clientes

Botão 🖨 "Exportar PDF" no header do ranking (admin/gerente). Gera janela nova com:
- Header com período + empresa + data/hora
- 4 KPIs: vendedores, clientes somados, faturamento total, ticket médio geral
- Tabela completa: medalha 🥇🥈🥉 + vendedor + clientes + VIPs + ativos + em risco + pedidos + faturamento + ticket + %share
- A4 paisagem, auto-print depois de 500ms
- Zebra nas linhas, cabeçalho preto com texto branco

### 32.11 Pausa do Supabase antigo

Projeto `comlppiwzniskjbeneos` (conta Supabase antiga — outro PAT) estava ACTIVE_HEALTHY há 7+ dias sem uso real. Pausado via Management API (`POST /projects/{id}/pause`). Status: PAUSING → PAUSED.

**NÃO deletado** (Juan pediu pra manter desativado, não apagar).

### 32.12 Números finais do ciclo tarde

**Migrations SQL aplicadas:**
- `ALTER TABLE vendedor_mapping ADD COLUMN excluir_ranking`
- `CREATE OR REPLACE VIEW vendedor_performance` (filtro sem-vendedor + marketplace)
- `ALTER TABLE criativos ADD COLUMN equipe`
- `CREATE TABLE prova_social_conteudo` + RLS + realtime + permissões

**Edge functions:**
- `ai-chat` v9 deployada via multipart (novas tools de Campanhas Internas)

**Usuários novos:** 10 vendedoras humanas + 2 fake (Site, Mercado Livre)

**Redução HTML:** `cliente-360.html` 700KB → 310KB

**Cache busting:** `cliente-360-boot.js` v=41 → v=42 → v=43

**Commits principais:**
- `1fd2bc6` Limpa cliente-360.html
- `8466ade` Fix post-login redirect
- `bdd822b` Primeiro login → Perfil
- `1e572fa` C360 boot reordering
- `660ef05` Realtime em pedidos
- `a468280` Tag Intensiva nos Criativos
- `424d242` 4-in-1 (Prova Social UGC + Bot CI + PDF Ranking + pausa Supabase)

### 32.13 Pendências abertas (atualizadas 24/04 tarde)

**🔴 Ainda requerem ação externa:**
- Notificar as 10 vendedoras novas pra trocar senha temp `DanaTemp2026!`
- GA4 Service Account (aguardando Dana)
- Magazord API (Dana mandar email pra `integracao@magazord.com.br`)
- Meta/Google/TikTok Ads (App Review 2-8 semanas)

**🔧 Técnicas internas:**
- **Backup automatizado semanal** — próximo passo (ver seção 33)

**📄 Fora do DMS:**
- Portfolio `zju4nndev.netlify.app` — plano em `PORTFOLIO - MELHORIAS.txt`
- Sistema de Estoque (Tecidos Projeto) — evoluindo em `. Outro sistema/Tecidos Projeto/` com ROADMAP próprio

---

## 33. BACKUP AUTOMATIZADO SEMANAL (pendente — próxima ação)

Ver seção dedicada criada pelo Juan logo após o ciclo 32. Opções avaliadas:
1. pg_cron no Supabase + dump pra Storage bucket
2. GitHub Action agendada puxando schema+dados
3. Task Scheduler local chamando `supabase db dump`
4. Edge function schedulada disparando export

---

**Fim da documentação · Atualizado em 24/04/2026 (tarde) — ciclo 32 adicionado**

---

## 34. CICLO 27/04/2026 — INSIGHTS IA PARA VENDEDORES + BACKUP

Sessão focada em fechar pendências do DMS. Não foi adicionada feature visual nova de grande porte, mas o **bot IA agora responde sobre Campanhas Internas, vendedor pode gerar Insights próprios, e o backup automatizado semanal foi implementado**.

### 34.1 Insights IA agora liberados pra vendedor (com quota)

**Antes:** botão "Gerar Insight" no detalhe do cliente C360 só funcionava pra admin/gerente_comercial/gerente_marketing. Vendedora clicava e tomava 403.

**Agora:**

| Cargo | Quota diária | Escopo |
|---|---|---|
| `admin` | ilimitada | qualquer cliente |
| `gerente_comercial` / `gerente_marketing` | 20/dia | qualquer cliente |
| `vendedor` | **5/dia** | **APENAS clientes da carteira dela** (validado via `cliente_scoring_vendedor`) |
| outros cargos | bloqueado | — |

**Kill-switch automático:** se gasto mensal `>= R$ 30`, geração pausa automaticamente. Admin pode despausar e ajustar limites.

#### Schema novo (`sql-cliente-insights-quota.sql`)

```sql
CREATE TABLE cliente_insights_config (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ativo BOOLEAN NOT NULL DEFAULT true,
  limite_diario_vendedor INT DEFAULT 5,
  limite_diario_gerente INT DEFAULT 20,
  limite_mensal_reais NUMERIC DEFAULT 30,
  custo_por_insight_reais NUMERIC DEFAULT 0.02,
  pausado_por_limite BOOLEAN DEFAULT false,
  ...
);
```

Funções SQL:
- `cliente_insights_count_hoje(uid)` — quantos insights o usuário gerou hoje (timezone São Paulo)
- `cliente_insights_gasto_mes()` — gasto acumulado do mês (kill-switch)
- `cliente_insights_ranking_usuarios()` — pra dashboard admin

Colunas adicionais em `cliente_insights`: `custo_estimado`, `modelo_provider` (groq/gemini), `cargo_autor`.

#### Edge function `cliente360-insight` v2

Novo pipeline:
1. Auth JWT
2. Carrega cargo do user
3. Valida config global ativa + kill-switch
4. **Se vendedor:** verifica que `contato_nome` está em `cliente_scoring_vendedor` com `vendedor_profile_id = userId` (escopo carteira)
5. Conta insights de hoje, compara com limite do cargo, retorna 429 se atingiu
6. Gera insight (Groq → fallback Gemini)
7. Calcula custo (Groq=0, Gemini=R$ 0.02 default) e grava em `cliente_insights`
8. Retorna quota info pra UI mostrar "3/5 hoje"

#### UI no Cliente 360

- Quando abre aba "Insights", chama `c360LoadInsightQuota()` antes de renderizar
- Badge ao lado do botão:
  - 🟢 `5/5 hoje` (sobrando)
  - 🟡 `4/5 hoje` (quase no limite)
  - 🔴 `5/5 hoje` (estourou) → botão fica "🚫 Indisponível"
  - 💜 `∞ ADMIN` pra admin
- Toast pós-geração mostra quota atualizada
- Cache busting `cliente-360-boot.js` v=43 → v=44

### 34.2 Backup automatizado semanal via GitHub Actions

**Arquivos criados:**
- `scripts/backup/backup-supabase.py` — script Python que dumpa 48 tabelas como JSON.gz usando Management API PAT (NÃO precisa DB password/URI)
- `scripts/backup/README.md` — documentação completa
- `.github/workflows/backup-supabase.yml` — workflow agendado (precisa ser criado manualmente pelo Juan via interface GitHub porque o PAT do git local não tem scope `workflow`)

**Como funciona:**
- Roda toda **domingo 03:07 UTC (00:07 BRT)** + manual via "Run workflow"
- Dumpa 48 tabelas:
  - Tabelas pesadas (pedidos, ai_chat_log, activity_log, sync_log, cliente_insights, avatares_ia_log) → janela recente (30-180 dias)
  - Demais (contatos, produtos, briefings, criativos, etc) → completas
- Salva em `backups/YYYY-MM-DD/` no próprio repositório
- Schema + RLS policies + views + functions em `_schema.json.gz`
- Manifest em `_metadata.json.gz`
- **Rotação automática:** mantém últimas 12 semanas (~3 meses), apaga as mais antigas
- Commit + push automático via `github-actions[bot]`
- Rate limit local 0.6s entre queries + retry exponencial em 429

**Teste local:** 48 tabelas · 121.426 rows · 4.285 KB comprimidos.

**Custo:** zero (GitHub Actions free tier).

**Setup pendente do Juan (1x):**
1. Criar workflow `.github/workflows/backup-supabase.yml` via interface GitHub (cole conteúdo do arquivo local)
2. Adicionar secrets `SUPABASE_PAT` e `PROJECT_REF`
3. Settings → Actions → Workflow permissions → "Read and write permissions"

### 34.3 PAT antigo invalidado

**Descoberta:** durante a sessão, o PAT `sbp_4057fd5b...` (que estava sendo usado em todos scripts) foi revogado. Substituído pelo PAT `sbp_b77399b3...` que está válido. Salvo em `TOKENS SUPABASE.txt` da pasta Tecidos Projeto.

### 34.4 Atualização do cliente_insights schema (colunas extras)

`ALTER TABLE cliente_insights ADD COLUMN`:
- `custo_estimado NUMERIC DEFAULT 0`
- `modelo_provider TEXT` ('groq' | 'gemini' | 'desconhecido')
- `cargo_autor TEXT`

Permite calcular gasto mensal preciso (kill-switch) e ranking por usuário.

### 34.5 Pendências DMS após este ciclo

| Item | Status |
|---|---|
| 10 vendedoras avisadas pra trocar senha temp | 🔴 ação Juan |
| GA4 Service Account JSON | 🔴 Dana |
| Magazord API | 🔴 Dana |
| Meta/Google/TikTok Ads (App Review) | 🟡 esperando |
| Workflow `.github/workflows/backup-supabase.yml` criar manual + secrets | 🔴 Juan (5 min) |
| Card Insights Custos no Admin → Custos IA (similar Avatares) | 💡 sugestão |

---

---

## 35. CICLO 27/04/2026 (NOITE) — POLIMENTO + AUDITORIAS + CAMPANHAS GLOBAIS

### 35.1 Auditoria seção Performance — bugs corrigidos

**KPIs principais (Faturamento, Ticket, Melhor Canal, Total Pedidos):** todos validados contra banco. Bate exatamente.

**Funil de Vendas — Bug 4529%**
- Cálculo era `etapa_atual / etapa_anterior * 100` → para Atendido (317) vs Confeccionado (7) dava 4529%
- Causa: as etapas são SNAPSHOT (estado atual), não histórico de transições
- Fix: agora % é sobre o **total de pedidos do mês**
- Subtítulo trocado: "Conversão entre etapas" → "**Distribuição dos pedidos por status do mês**"

**Analytics por Canal — Edge cases de crescimento**
- TikTok Abr R$ 530, Mar R$ 0 → mostrava `+0%` (errado)
- Shopee Abr R$ 0, Mar R$ 204 → mostrava `-100%` (correto mas confuso)
- Fix:
  - `prev=0, atual>0` → mostra **"Novo"** (verde)
  - `prev>0, atual=0` → mostra **"Sem vendas"** (vermelho)
  - `ambos=0` → mostra `—`
  - normal → cálculo % normal

**Por Status — Mapeamento de IDs**
- `ID 15` → "Verificado" (Bling default)
- `ID 26884` (BC custom) → "Confeccionado" — confirmado com Manu
- `ID 35734/35736` (Matriz) → Costura/Bordado
- `ID 17008` (Matriz) → Confeccionado

**View `funil_vendas` no DMS atualizada:**
```sql
CREATE OR REPLACE VIEW funil_vendas AS
SELECT empresa, ano, mes, loja_id,
  COUNT(*) FILTER (WHERE situacao_id = 21) AS em_digitacao,
  COUNT(*) FILTER (WHERE situacao_id = 6)  AS em_aberto,
  COUNT(*) FILTER (WHERE situacao_id IN (35734, 35736)) AS producao,
  COUNT(*) FILTER (WHERE situacao_id IN (17008, 26884)) AS confeccionado, -- BC + Matriz
  COUNT(*) FILTER (WHERE situacao_id = 9)  AS atendido,
  COUNT(*) FILTER (WHERE situacao_id = 12) AS cancelado,
  COUNT(*) AS total
FROM pedidos GROUP BY empresa, ano, mes, loja_id;
```

**Top Produtos — Era TODO "em breve"**
- Plugou na view `top_produtos_mes` que já existia
- Filtra empresa + ano + mês → top 10 por quantidade vendida

### 35.2 Calendário — Editar evento existente

**Antes**: clicar num evento abria modal "Detalhes" com botões Excluir / Mudar Cor. Pra editar título/data/descrição precisava apagar e criar de novo.

**Agora**: botão azul **"Editar"** no modal (visível pra quem tem `calendario_criar` OU é admin · oculto pra eventos gerenciados pelo Cliente 360 / Campanhas Internas).

Implementação:
- `_editingEventoId` global flag
- `editarEventoAtual()` preenche modal `novo-evento` com dados existentes (título, tipo, datas, descrição, cor, campanha)
- Modal mostra título "Editar Evento" + botão "Salvar Alterações"
- `salvarEvento()` detecta modo edição: faz UPDATE em vez de INSERT
- `resetarFormNovoEvento()` limpa estado ao fechar/cancelar/abrir-novo

### 35.3 Kanban — Drag & Drop posicional (bug crítico)

**Sintoma reportado pela Manu**: "tento arrastar uma tarefa para baixo e nada, ela não vai".

**Causa raiz descoberta após debug intensivo:**
1. Existiam **DUAS funções `drop()` no arquivo** (linhas 9779 e 13822). Em JS a última declaração ganha → a antiga sobrescrevia a nova.
2. A drop antiga só fazia `UPDATE coluna` — não mexia em `posicao`. Por isso reordenar dentro da MESMA coluna era no-op.
3. Tinham mais 4 duplicatas: `drag()`, `dragOver()`, `addCard()`, `createTask()` — todas residuais de versões antigas.

**Fix completo:**
- Removidas 5 duplicatas. Mantida 1 versão de cada (a com Supabase + posição).
- `drop()` agora faz UPDATE individual em paralelo via `Promise.all` (upsert dava erro 23502 NOT NULL no `titulo` ao tentar INSERT em conflito).
- Indicador visual: linha azul gradiente mostra onde o card vai cair (placeholder).
- Drop fallback global na coluna inteira (não só `.kanban-body`) — capture phase pra bypass `stopPropagation()` dos inline handlers.
- `_dragSilenceRealtime` flag por 1.5s pós-drop pra impedir saltos de UI causados pelo realtime listener.
- Cache local `_tarefasCache` atualizado imediatamente.

**Funcionalidades validadas:**
- ✅ Reordenar dentro da mesma coluna
- ✅ Mover entre colunas
- ✅ Soltar entre cards específicos / topo / fim
- ✅ Outro user vê em ~250ms via realtime

### 35.4 Construtor de Campanhas — Multi-públicos + Aba Observações (Fase 1)

**Pedido da Manu:**
> "Coloca a opção pra eu selecionar todos os públicos. E a hora que ele for montar o briefing, adicionar uma aba de observações + os to-dos que precisam ser feitos."

**Schema:**
```sql
ALTER TABLE briefings_campanha
  ADD COLUMN observacoes TEXT,
  ADD COLUMN publicos TEXT[];
ALTER TABLE tarefas       ADD COLUMN campanha_id UUID REFERENCES briefings_campanha(id) ON DELETE SET NULL;
ALTER TABLE calendario    ADD COLUMN campanha_id UUID REFERENCES briefings_campanha(id) ON DELETE SET NULL;
CREATE INDEX idx_tarefas_campanha    ON tarefas(campanha_id);
CREATE INDEX idx_calendario_campanha ON calendario(campanha_id);
```

**Construtor (view-construtor):**
- Step 1 (Público) agora é **MULTI-seleção** (toggle ao clicar)
- Botão "Selecionar todos os públicos" / "Limpar seleção"
- Briefing final mostra todos os públicos separados por `·`
- `cbData.publicos` array global

**Step 8 (Briefing) — Sub-abas:**
- **Briefing**: documento final (existente)
- **Observações & To-dos** (nova):
  - Textarea de observações livres
  - Lista de to-dos com add/check/remove
  - Estado em `cbData.todos = [{id, texto, done}]`

**`saveBriefing()` atualizado:**
- Se houver to-dos pendentes → modal pergunta "Qual coluna do Kanban?"
- Salva briefing + cria N tarefas com `campanha_id` setado pra coluna escolhida
- Toast: "✓ Briefing salvo + N tarefas criadas no Kanban!"

### 35.5 Vínculo de campanha em Tarefas e Calendário (Fase 2)

**Pedido da Manu:**
> "Em qualquer área que eu for construir alguma coisa, ter a opção de marcar aquela campanha. Tanto no Tarefas, calendário."

**Cache global:**
```js
window._campanhasCache  // [{id, titulo, publico, publicos, created_at}]
loadCampanhasCache(force?)  // carrega/refresca
popularSelectCampanhas(selectId)  // popula <select>
popularTodosSelectsCampanha()  // popula todos
```

**Modais com dropdown "Vincular à campanha":**
- Nova Tarefa (`#new-task-campanha`)
- Novo Link/Card (`#new-link-campanha`)
- Novo Evento (`#evt-campanha`)
- Editar Evento — preenche dropdown com campanha vinculada
- Modal **Ver Evento** mostra banner roxo `🎯 Vinculado à campanha: <nome>`

**Persistência:**
- `createTask`, `createTask(link)`, `salvarEvento` (insert+update) salvam `campanha_id`

**Filtros no topo:**
- Kanban: `<select id="kanban-filtro-campanha">` com Todas / Sem campanha / cada campanha → filtra `_tarefasCache` em memória antes de renderizar
- Calendário: `<select id="cal-filtro-campanha">` mesmo padrão → filtra eventos E tarefas-com-prazo

**Badges visuais:**
- Cards do Kanban: chip roxo `🎯 <nome da campanha>` (cortado em 22 chars)
- Modal ver-evento: banner roxo no topo

**Loop fechado** que a Manu agora consegue fazer:
1. Cria campanha no Construtor (multi-públicos + observações + to-dos)
2. To-dos viram tarefas no Kanban com `campanha_id` setado
3. Adiciona mais tarefas depois pelo Kanban, vinculando à mesma campanha
4. Adiciona eventos no Calendário vinculados
5. **Filtra Kanban ou Calendário pela campanha** → vê tudo da campanha junto

### 35.6 Segurança — GEMINI_IMAGE_API_KEY exposta

**Incidente:**
- Key Gemini PAID (gera imagens) estava commitada no DOC público em 3 lugares (linhas 1739, 1961, 2538). [Detalhes em TOKENS local]
- Bots de scraping indexam keys do GitHub em < 1h. Risco real de uso indevido (custo financeiro).

**Mitigação:**
1. Removida do DOC + substituída por `<REVOGADA — ver TOKENS local>`
2. Juan revogou no Google Cloud Console + criou nova [valor em TOKENS local, NÃO commitar]
3. `GEMINI_IMAGE_API_KEY` atualizada no Supabase do DMS via Management API
4. Geração de imagem testada: gemini-2.5-flash-image retornou PNG 336KB ✓

**Prevenção:**
Criado `.gitignore` no DMS (não existia!):
```
*TOKEN*.txt, *AI_KEYS*, TOKENS/, .claude/, bling-matriz/, .env, .env.*, etc
```

⚠️ **Histórico do git ainda contém a key (commit 34d84b1)** — mas como foi revogada no Google, fica inofensiva. Pra remover do histórico de fato precisa `git filter-repo` (operação destrutiva).

### 35.7 Bot IA do estoque — chave Groq também regenerada

Durante o ciclo, descobrimos que a `GROQ_API_KEY` antiga estava com valor truncado/inválido (preview `63c19083...` sem prefixo `gsk_`). Juan apagou e gerou nova: `gsk_HnzgBMG...`. Atualizada no DMS + Estoque.

Também atualizada `GEMINI_API_KEY` (free tier do bot do estoque) — valor em TOKENS local. Usada como fallback quando Groq tá fora.

### 35.8 Estado dos dados (27/04/2026 noite)

| Tabela | Rows | Δ ciclo |
|---|---|---|
| pedidos (Matriz Abr/26) | 533 | — |
| pedidos (BC Abr/26) | 198 | — |
| briefings_campanha | 0 | (Manu vai criar) |
| campanhas_internas | 0 | (idem) |
| tarefas com `campanha_id` | 0 | (idem) |
| calendario com `campanha_id` | 0 | (idem) |

### 35.9 Pendências aguardando Manu

| Pedido | Status | Próximo passo |
|---|---|---|
| Selecionar briefing existente / criar novo no modal Nova Campanha Interna | ✅ Resolvido em 36.2 | — |
| Card "Aguardando briefing" na seção Construtor | ✅ Resolvido em 36.2 (Briefings Visuais) | — |
| Vincular `briefings_campanha.campanha_interna_id` (relação reversa) | ✅ Resolvido em 36.2 (vincular briefing avulso a campanha) | — |

---

## 36. CICLO 28/04/2026 — ESTÚDIO IA + ROTAÇÃO DE KEYS + PERFORMANCE + CAMPANHAS

Sessão massiva (~30+ commits). Foco em Estúdio IA Fase 1+2, custos, performance e estabilização das IAs.

### 36.1 Schema novo (3 tabelas + 2 colunas + 1 bucket)

```sql
-- Vínculo briefing ↔ campanha interna (relação reversa)
ALTER TABLE campanhas_internas
  ADD COLUMN IF NOT EXISTS briefing_id UUID REFERENCES briefings_campanha(id) ON DELETE SET NULL;
CREATE INDEX idx_campanhas_internas_briefing ON campanhas_internas(briefing_id);

-- Log de prospecção pra painel Custos IA
CREATE TABLE ia_prospeccao_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID, user_nome TEXT, user_cargo TEXT,
  segmento TEXT, cidade TEXT, estado TEXT,
  qtd_leads INT,
  custo_estimado_reais NUMERIC(8,4) DEFAULT 0.05,
  status TEXT DEFAULT 'ok', erro TEXT,
  provider TEXT, tokens_input INT, tokens_output INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- RLS: admin ve tudo, user vê só os próprios

-- Galeria do Estúdio IA
CREATE TABLE estudio_pecas (
  id UUID PRIMARY KEY,
  produto_id BIGINT, produto_nome TEXT, produto_imagem_url TEXT,
  tipo_peca TEXT NOT NULL, tema TEXT, copy_extra TEXT,
  prompt_usado TEXT,
  imagem_url TEXT, storage_path TEXT,
  status TEXT, erro TEXT,
  custo_estimado_reais NUMERIC(8,4) DEFAULT 0.20,
  criado_por UUID, criado_por_nome TEXT,
  created_at TIMESTAMPTZ
);
-- RLS: admin-only

-- Storage permanente das imagens dos produtos (URLs Bling expiram em 1h)
ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS imagem_storage_url TEXT,
  ADD COLUMN IF NOT EXISTS imagem_storage_synced_at TIMESTAMPTZ;
-- Bucket: produtos-imagens (público, max 5MB)
```

### 36.2 Vínculo briefing ↔ campanha interna (3 modos + Aguardando + reverso)

Resolveu as 3 pendências do ciclo 35.

**Modal Nova Campanha Interna**: substituiu input único de URL por radio group:
- ⚪ Sem briefing ainda — vincular depois (default)
- ⚪ Selecionar briefing existente → dropdown com TODOS briefings (avulsos + vinculados)
- ⚪ Link externo → URL input

**Briefings Visuais → "⏳ Aguardando briefing"** (banner amarelo no topo):
- Lista campanhas internas sem briefing_id E sem briefing_link
- Cada card tem 2 botões:
  - "Criar briefing →" abre Construtor pré-preenchido com nome da campanha + banner roxo "⏳ Vinculando à campanha". `saveBriefing()` detecta `_aguardandoCampanhaPendente` e linka briefing_id automático.
  - "Selecionar existente" → modal pra escolher briefing já criado.

**Vincular briefing avulso a campanha** (reverso): novo botão roxo "🎯 Vincular a campanha" no modal `ver-briefing`. Lista todas campanhas internas, mostra flag se briefing já está vinculado a outras. Permission: admin OU `campanha_interna_editar`.

### 36.3 Construtor de Campanhas — IA contextual em 4 steps

Manu reportou: "eu seleciono público diferente mas a copy sai sempre igual". Antes os steps 3/4/5/6 do Construtor tinham textos hardcoded.

**Edge function `construtor-ai`** (Groq Llama 3.3 70B + Gemini fallback):
- Input: `publicos[]`, `problema`, `conceito_nome?`, `conceito_msg?`, `oferta_tipo?`
- Output JSON: `conceito_nome`, `conceito_msg`, `hashtag`, `oferta_tipo`, `oferta_argumento`, `gancho`, `realidade`, `autoridade`, `solucao`, `cta`, `canais_360[]`
- Sistema prompt em PT com voz Dana hardcoded
- Whitelist de oferta_tipo (6 tipos do frontend) e canais_360 (13 canais válidos)
- Sanitização com fallback fuzzy (primeira palavra) pra normalizar acentos

**Frontend (Construtor)**:
- `cbData.aiSugestao` cache (chamada UNICA, todos os steps leem)
- `cbData.aiStepsAplicados` track quais steps já receberam auto-apply
- `gerarEstrategiaComIA(force, scope)`:
  - scope: `'conceito' | 'oferta' | 'copy' | '360'`
  - Hook em `goStep`: ao chegar Steps 2/3/4/5 pela 1ª vez → auto-aplica
  - Botões roxos "🔄 Regenerar com IA" em cada step
- `aplicarSugestaoIA(scope)` popula campos do step a partir do cache:
  - **Step 3 Conceito**: nome + mensagem central + hashtag
  - **Step 4 Oferta**: marca card sugerido + banner roxo com argumento
  - **Step 5 Copy**: 5 campos (gancho, realidade, autoridade, solução, CTA)
  - **Step 6 360°**: toggle on/off dos pillars baseado em canais sugeridos
- Invalidação de cache ao mudar público (`selectAud` + `toggleAllAud`), problema (`selPain`), oferta (`selOffer`)

**Bug fix Step 4 Oferta**: matching de cards falhava por mismatch de acentos (`Lancamento de Colecao` vs `Lançamento de Coleção`). Helper `normStr()` normaliza NFD + remove diacríticos + 3-pass match (exato → contains → primeira palavra).

### 36.4 Imagens IA com tema da campanha (meta-prompting)

Manu reportou: "criei campanha 'Copa do Mundo' e a IA gerou imagem de spa, nada a ver". Causa: prompt era template fixo com `${contexto}` que ficava vazio.

**Edge function `gerar-prompt-visual`** (Groq + Gemini fallback):
- Recebe TODOS os dados da campanha (nome/tema, tipo, objetivo, público, oferta, conceito, datas, observações)
- Gera prompt visual em inglês adaptado ao tema:
  - Copa do Mundo → green-yellow accents, stadium-clinic crossover, patriotic
  - Black Friday → dramatic dark, urgency
  - Natal → red gold festive
  - Volta às aulas → anatomy books, university hospital corridor
  - etc.
- Sanitiza prompt (remove markdown/quotes), max 2000 chars

**Frontend (3 lugares atualizados)**:
- `ciGerarVisualIA` (campanhas internas) — async, chama prompt-visual antes
- `bvGerarMockupIA` (briefings) — idem
- `criGerarReferenciaIA` (demandas/criativos) — mantém dimensões do formato no fim

Fallback gracioso: se meta-prompt falhar, monta prompt antigo MELHORADO (inclui c.nome como `Campaign theme` e instrui IA a adaptar ambiente/paleta).

### 36.5 Página Vendas → Prospecção (NOVA)

Pedido da Manu: "uma IA que busque dados reais do Google, eu coloco filtros (segmento, cidade, estado), aparece os leads (nome, site, Instagram, WhatsApp), e gera mensagem personalizada".

**Edge function `prospectar`** (Gemini 2.5 Flash + Google Search grounding):
- Input: `segmento, cidade, estado, qtd_max, ja_prospectados[]`
- Auth via JWT, valida cargo: admin = 30 leads/busca, demais = 10
- Usa `tools: [{ googleSearch: {} }]` no Gemini pra buscar leads B2B reais
- Sistema prompt em PT instrui:
  - APENAS leads VERIFICADOS na busca real (nada inventado)
  - Mensagem mediana profissional, max 350 chars, termina com pergunta aberta
  - Insight curto de por que faz sentido pra Dana abordar
- Output: `leads[]` com `nome, segmento, cidade, estado, endereco, telefone, whatsapp, website, instagram, ia_insight, ia_mensagem`
- Tabela `prospects` (criada antes do compact) armazena leads
- **Logging via `await logProspeccao()`** (await crítico — sem ele o isolate Deno destruía o INSERT antes de executar)

**Frontend `view-prospeccao`**:
- Filtros: segmento + cidade + estado + qtd
- Botão "🔎 Buscar leads" chama edge function
- Resultados em cards: nome + ícones telefone/WhatsApp/Instagram/website + insight roxo + mensagem com botão "💬 Abrir WhatsApp" (URL com texto pronto)
- Anti-duplicação: filtra leads que já existem em `prospects` table antes de inserir

### 36.6 Custos IA — agora cobre Imagens + Prospecção

Painel Admin → Custos IA expandido:

```
🔝 Card preto no topo: Custo total IA do mês = Imagens + Prospecção
   - 3 KPIs: imagens · buscas · leads gerados

🎨 Imagens IA (existente) — Gemini 2.5 Flash Image (paga)
   - Limite mensal · Top usuários · Contextos · Últimas 20

🔍 Prospecção IA (NOVO) — gemini-2.5-flash + Google Search (paga)
   - Card de gasto: R$/mês, buscas, leads, custo médio/busca
   - Top vendedores em prospecção (mês + 90d)
   - Últimas 20 buscas (data, vendedor, segmento, local, leads, custo)
```

Custo da prospecção calculado via `estimarCustoReais(tokensIn, tokensOut)`:
- Tokens × $0.30/1M (input) + $2.50/1M (output) — Gemini 2.5 Flash paga
- + R$ 0,18 por Google Search query
- Convertido USD → BRL com taxa 5.0
- Mínimo R$ 0,05

### 36.7 Estúdio IA — Fase 1 (Marketing → admin-only)

Pedido da Manu: "uma página onde IA gera banner/post pra usar no site, com produtos reais, e que aprenda com os banners atuais".

Eu acessei https://danajalecos.com.br no Chrome dela e tirei screenshots dos banners reais. Identifiquei:
- Paleta: cream/beige/preto + acentos terracota
- Tipografia hero: serif elegante (script-feel)
- Composição: modelo de um lado + texto/CTA do outro lado
- CTAs: botões pretos sólidos OU terracota
- Estilo fotográfico: editorial premium, lifestyle
- Aspect ratio banner: 16:9 (Gemini não suporta 21:9 nativo)

**Sidebar Marketing**: novo item "🎨 Estúdio IA" com badge NOVO roxo. Inicialmente em `ADMIN_ONLY_VIEWS` (depois passou pra controle via cargo_permissoes — ver 36.8).

**View `view-estudio`**: 4 painéis (stepper visual roxo):
1. **Selecionar produto** — busca server-side com `ILIKE` em nome OU código no catálogo Bling (~4.7k produtos sincronizados)
2. **Tipo de peça** (cards visuais):
   - 🖼 Banner site (16:9 ultrawide)
   - 📷 Post Instagram (1:1)
   - 📱 Story/Reels (9:16)
   - 💰 Anúncio Meta (1:1)
3. **Tema/copy opcional** ("Volta às aulas", "10% OFF", etc.)
4. **Resumo + botão Gerar** com aviso de custo "~R$ 0,20 por imagem"

**Edge function `gerar-peca-ia`** (várias versões iteradas):
- v1-v8: Groq → Gemini fallback (text only, recebia só nome do produto)
- **v9+: Gemini 2.5 Flash com VISION** — baixa imagem do produto e analisa visualmente:
  - Cor exata ("warm ecru, pearlescent sheen" em vez de "beige")
  - Modelagem (slim cut, double-lapel, mid-thigh)
  - Detalhes (bolsos patch, mangas longas, botões)
  - Tecido aparente (crepe, malha)
- Sistema prompt em INGLÊS (Gemini estava misturando idiomas com PT)
- Regra crítica: tema visual **CONCRETO** (não palavra renderizada):
  - Volta às aulas → MANDATORY: bookshelf with anatomy textbooks, anatomical torso model, stethoscope, university hospital corridor
- Regra crítica: aspect ratio explícito no início do prompt
- Regra crítica: rich scene (theme elements occupy 30-40% of frame, NEVER leave 60% blank)
- Regra crítica: política de texto:
  - Se user passou `copy_extra` → renderiza o texto literalmente em badge terracota + tema como headline secundária
  - Se não passou → 100% sem texto (designer adiciona em pós)
- `thinkingConfig.thinkingBudget: 0` desabilita "thinking" do Gemini 2.5 que cortava output

**Galeria**: lista últimas 50 peças geradas com aspect ratio correto por tipo. Click abre imagem cheia.

**Custos visíveis em 3 lugares**:
- Banner amarelo no topo da seção
- Card amarelo no Step 4 (Gerar)
- Botão de gerar mostra custo

Cada peça gerada é registrada em **3 lugares**: `estudio_pecas` (galeria), `avatares_ia_log` (painel Custos IA Imagens), log da geração.

### 36.8 Estúdio IA — Fase 2 (variações + Storage + permissões)

#### Permissões controláveis via banco
- `'estudio'` saiu de `ADMIN_ONLY_VIEWS` (era hardcoded)
- 9 rows criadas em `cargo_permissoes` com `permitido=false`:
  - gerente_marketing, gerente_comercial, gerente_financeiro
  - trafego_pago, producao_conteudo, designer
  - analista_marketplace, vendedor, expedicao
- Admin sempre vê (cargo bypass)
- Pra liberar: Juan vai em **Admin → Permissões** e troca `estudio` pra `true` no cargo

#### Variações A/B/C
Step 4 ganhou selector 1/2/3 imagens (custo proporcional R$ 0,20 cada).

`estGerar` agora chama `gerar-avatar-ia` em **paralelo** N vezes:
- Variant suffixes pra forçar diversidade real:
  - v1: prompt original
  - v2: "alternative camera angle, slightly different model pose"
  - v3: "different lighting mood (golden hour vs midday) and different expression"
- Progresso visível: "🎨 1/3 prontas..." → "🎨 2/3 prontas..."
- Cada peça salva separada em `estudio_pecas` (galeria mostra todas)
- Errors tratados separados: "✓ 2/3 geradas. 1 falhou: ..."

#### Storage permanente das imagens dos produtos

**Problema**: URLs do Bling são pré-assinadas S3 que expiram em **1 hora**. Por isso Gemini Vision falhava em analisar produtos (`viu_imagem: false` no log).

**Solução**:
- Schema: `produtos.imagem_storage_url` + `imagem_storage_synced_at`
- Bucket novo `produtos-imagens` (público, max 5MB)
- **Edge function `sync-imagens-produtos`** (admin-only):
  - Baixa do Bling, upload pro Supabase Storage, atualiza `imagem_storage_url`
  - Batch 50 produtos por chamada (paralelo de 5)
- Frontend prefere `imagem_storage_url`, fallback `imagem_url`
- Botão **"🔄 Sincronizar imagens dos produtos"** no canto direito do Estúdio (admin)

### 36.9 Performance — startup 33→10 requests

Manu reportou site lento. Diagnóstico via Chrome network: **33 requests** disparados no startup mesmo o user só estando numa view (Estúdio IA).

**Causa**: `initUpgradeFeatures` carregava 11 funções pesadas no startup (loadTarefas, initCalendario, loadPerformanceData com `pedidos limit=10000`, loadFinanceiro, loadProvaSocial, etc.) + alertas duplicado.

**Fix**:
1. `initUpgradeFeatures` enxuto: só `setupRealtimeSubscriptions` + `loadColunasCustom`
2. Sistema de **lazy-load com cache** em `go(viewId)`:
   - `window._viewLoaded[key]` garante 1x por sessão
   - `loadOnce(key, fn)` helper
   - 11 funções migradas pro `go()` com cache flag (home, kanban, calendario, performance, financeiro, projecoes, marketplaces, provasocial, canaisvendas, relatorio)
3. `loadTarefas` ganhou `.limit(1000)` (antes era sem limit)
4. `vendedores HEAD count` wrappado em `.catch()` pro 503 intermitente do Supabase não derrubar dashboard

Resultado: site abre em <1s pra Estúdio IA (antes 4-6s).

### 36.10 Sistema de rotação de keys Gemini (gemini-proxy)

#### Causa raiz descoberta tarde
ai-chat (bot do DMS) reportado dando "sobrecarregado (Groq/Gemini)" frequente. Deploy de `ai-chat-debug` revelou: **Gemini free `JL1Y` tava com quota ESGOTADA** durante o dia (~20 RPM ou 1500/dia atingidos por uso intenso de Construtor + Estúdio + ai-chat + Estoque).

#### Solução
Manu pediu: "Gerar 2-3 keys Gemini free novas e fazer rotação".

User criou 2 keys novas:
- `GEMINI_API_KEY_2 = AIzaSyAC49Bi...AbGI`
- `GEMINI_API_KEY_3 = AIzaSyC1qoM...JgxE`

**Edge function `gemini-proxy`** (v1):
- Recebe `{ endpoint, model, payload }` (suporta `generateContent` nativo + `openai_chat`)
- Rotação ordenada: `GEMINI_API_KEY` (JL1Y) → `_KEY_2` (AC49Bi) → `_KEY_3` (C1qoM) → `_KEY_PAID` (NTwk paga)
- Se key bate quota (429 + "exceeded"/"quota"/"rate.limit"), tenta próxima automaticamente
- Erros não-quota (400/500) retornam imediato sem tentar outras keys
- Header `X-Gemini-Key` no response indica qual key respondeu (debug)
- Header `X-Gemini-Attempts` indica quantas tentativas

**Edge functions migradas pro proxy**:
- `gerar-peca-ia` v11 (Estúdio IA)
- `gerar-prompt-visual` v3 (mockups de campanha/briefing/criativo)
- `construtor-ai` v7 (Construtor de Campanhas)

**ai-chat NÃO migrou** (source extraído de binary corrompeu, não dá pra editar). Continua usando `GEMINI_API_KEY` direto. Workaround: retry no client (3 tentativas com 2s/5s backoff) + Groq como primary saudável. Pendente reescrever do zero (~1h).

### 36.11 Outros polimentos pequenos

#### Estúdio IA — múltiplos bug fixes durante iteração
- Aspect ratio: passar `aspect_ratio: '16:9'` no body do POST (`gerar-avatar-ia` default era 1:1)
- Logo Dana embroidered: passar `incluir_logo: false` no body (estava sempre adicionando "Dana" cursivado no peito)
- Prompt em português: trocar system prompt do `gerar-peca-ia` pra inglês (Gemini misturava idiomas)
- ReferenceError: `opts is not defined` em `aiaGerar` — usei `window._aiaCurrentOpts` (mesmo padrão da `aiaSalvar`)
- Limite hardcoded de 2000 chars no `gerar-avatar-ia` → reescrita pra **5000 chars** (extraí source do binary, recriei limpo, redeploy v14)
- Truncagem inteligente no frontend: 4900 chars max, mantém início (descrição visual) + final (anti-text instruction)

#### ai-chat retry no client
`aiChatEnviar` agora retenta 3x com backoff:
- Tentativa 1: imediato
- Tentativa 2: +2s delay (mostra "⏳ IA sobrecarregada, tentando de novo em 2s")
- Tentativa 3: +5s delay
- Só retenta em 503 ou erros transientes

#### Bug crítico: Custos IA Prospecção zerado
`logProspeccao()` chamada **sem `await`** (fire-and-forget) → no Deno Edge Functions, isolate destruído antes do INSERT. Tabela `ia_prospeccao_log` ficava vazia mesmo com chamadas funcionando. Fix em `prospectar` v7: `await logProspeccao(...)` nos 2 paths (sucesso + erro).

### 36.12 Edge Functions ATIVAS no DMS (estado final)

| Function | Versão | Função |
|---|---|---|
| **ai-chat** | v18 | Bot principal do DMS — usa GEMINI_API_KEY direto (esgota quando quota free zera) |
| **construtor-ai** | v7 | IA contextual nos 4 steps do Construtor — via gemini-proxy |
| **prospectar** | v7 | Prospecção de leads via Gemini + Google Search grounding (paga NTwk) |
| **gerar-peca-ia** | v11 | Prompt visual rico com Gemini Vision pro Estúdio IA — via gemini-proxy |
| **gerar-prompt-visual** | v3 | Meta-prompting pra mockups de campanha/briefing — via gemini-proxy |
| **gerar-avatar-ia** | v14 | Geração de imagens via Gemini 2.5 Flash Image (paga cR6I, limite 5000 chars) |
| **gemini-proxy** | v1 | Proxy de rotação automática entre 4 keys Gemini |
| **sync-imagens-produtos** | v1 | Sync URLs Bling → Supabase Storage permanente |
| **cliente360-insight** | v10 | Insights IA pro Cliente 360 (Groq + Gemini) |
| **ai-chat-debug** | v1 | Debug helper temporário (testa Groq + Gemini com tools) |

### 36.13 Secrets ATIVOS (DMS)

| Var | Valor | Uso |
|---|---|---|
| `GROQ_API_KEY` | gsk_HnzgBMG... | Bot/Construtor primário (Groq Llama 3.3 70B free) |
| `GEMINI_API_KEY` | JL1Y free | Rotação proxy posição 1 (1500/dia) |
| `GEMINI_API_KEY_2` | AC49Bi free | Rotação proxy posição 2 (NOVA hoje) |
| `GEMINI_API_KEY_3` | C1qoM free | Rotação proxy posição 3 (NOVA hoje) |
| `GEMINI_API_KEY_PAID` | NTwk paga | Rotação proxy posição 4 (último fallback, paga) E `prospectar` direto |
| `GEMINI_IMAGE_API_KEY` | cR6I paga | Exclusiva pra `gerar-avatar-ia` (imagens, ~R$ 0,20/img) |

### 36.14 Estado dos dados (28/04/2026 noite)

| Tabela | Rows | Δ ciclo |
|---|---|---|
| produtos | ~4.753 | +imagens persistidas conforme sync |
| ia_prospeccao_log | crescente | nova feature |
| estudio_pecas | crescente | nova feature |
| campanhas_internas | varias | +briefing_id col |
| briefings_campanha | varias | uso ativo |
| cargo_permissoes | +9 rows | seção `estudio` bloqueada pra todos não-admin |

### 36.15 Pendências aguardando próxima sessão

| Item | Tipo | Prioridade |
|---|---|---|
| Reescrever `ai-chat` do zero pra usar `gemini-proxy` (source v18 corrompeu na extração) | Reescrita TS ~1500 linhas | 🟡 Baixa — retry no client + Groq cobrem |
| Liberar Estúdio IA pros cargos `designer` e `gerente_marketing` quando Manu aprovar | Toggle em `cargo_permissoes` | 🟡 Aguardando Manu |
| Sync inicial massivo de imagens dos produtos (4.7k → Storage permanente) | Rodar `sync-imagens-produtos` ~95 vezes (50 por batch) | 🟡 Quando der |
| GitHub Action workflow `backup-supabase.yml` (PAT lacks `workflow` scope) | Manual no GitHub UI | 🟡 Quando der |
| Limpar histórico do git da key Gemini banida (`q12A`) | git-filter-repo (destrutivo) | 🟢 Já revogada, inofensiva |
| Inconsistência permissão `campanhas_internas` (false) vs `campanhas-internas` (true) pra vendedor | DELETE da row duplicada | 🟢 Não bloqueante |

### 36.16 Onde paramos

Última ação: **Section 36 sendo escrita** (esta seção, ciclo 28/04 documentado).

Sessão anterior (compact) terminou com Manu reportando ai-chat com "sobrecarregado (Groq/Gemini)". Diagnose feita: Gemini free `JL1Y` esgotou quota durante o dia. **Solução**: Manu criou 2 keys novas Gemini free, eu criei `gemini-proxy` que rotaciona entre 4 keys (3 free + 1 paga), refatorei 3 edge functions pra usar o proxy. ai-chat ainda usa GEMINI_API_KEY direto (source corrompido bloqueia edit) — workaround é retry no client + Groq como primary saudável.

**Próxima sessão**: a Manu provavelmente vai pedir mais polimento no Estúdio IA (qualidade da imagem gerada — tema/composição/anti-texto/aspect-ratio) ou novas features. Verificar se o problema do ai-chat persiste depois das keys novas absorverem o uso.

---

**Fim da documentação · Atualizado em 28/04/2026 noite — ciclo 36 adicionado · v4.0**

---

## 37. CICLO 28/04/2026 NOITE-TARDE — ai-chat v19 (REWRITE FROM SCRATCH)

### 37.1 Motivo da reescrita

A `ai-chat` v18 tinha source TS corrompida na extração via eszip2 (caracteres UTF-8 trocados em comentários). Bloqueava qualquer edit. Pendência prioritária 🟡 da Section 36 cumprida.

### 37.2 Arquivo novo

`C:/Users/Juan - Dana Jalecos/Documents/Sistema Marketing/.claude/scripts/ai-chat-v19/index.ts` — 1475 linhas, 67KB, código limpo.

### 37.3 Mudanças vs v18

| Aspecto | v18 | v19 |
|---|---|---|
| Source | duplicada (JS+TS, 3383 linhas) | TS único (1475 linhas) |
| Gemini | direto via `GEMINI_API_KEY` | via `gemini-proxy` (rotação 4 keys) |
| Tools | 19 | **38** (cobre TODOS domínios) |
| Tabelas C360 | parcial | scoring_full, scoring_vendedor, segmentos, campanhas, envios, insights, notas, metadata, vendedor_manual, clientes_manuais |
| Cascade | Groq → Gemini → Groq retry | Groq 70B → gemini-proxy → Groq 8B |
| MAX_TOOL_ROUNDS | 5 | 6 |
| Rate limit | 50/h | 60/h |
| Vendedor scoping | regra no system prompt | gate hard-coded `TOOLS_BLOQUEADAS_VENDEDOR` |
| Versão deploy | v18 ACTIVE | **v20 ACTIVE** |

### 37.4 Tools implementadas (38)

**VENDAS (7)**: `consultar_faturamento`, `vendas_por_canal`, `vendas_por_vendedor`, `top_clientes`, `top_produtos`, `pedidos_cliente`, `pedido_detalhe`

**FINANCEIRO (3)**: `consultar_contas_financeiras`, `contas_atrasadas`, `fluxo_caixa_mes`

**ESTOQUE (2)**: `info_produto`, `produtos_sem_estoque`

**C360 (10)**: `buscar_contato`, `resumo_cliente360`, `alertas_cliente360` (vips_em_risco/a_recuperar/prontos_recompra), `listar_segmentos_c360`, `listar_campanhas_c360`, `detalhe_cliente_c360`, `buscar_notas_c360`, `minha_carteira` (vendedor scoped: resumo/vips/em_risco/top), `ranking_carteiras`, `prospects_lista`

**MARKETING (10)**: `listar_campanhas_internas` (com filtro `minhas`), `detalhe_campanha_interna` (equipe + expedições + comentários + materiais + timeline), `expedicoes_pendentes`, `briefings_lista`, `criativos_status`, `criativos_to_do`, `influenciadores_performance`, `concorrentes_lista`, `canais_aquisicao_roi`, `estudio_pecas_galeria`

**SISTEMA (6)**: `buscar_tarefas`, `minhas_tarefas`, `resumo_kanban`, `alertas_pessoais`, `sync_status`, `calendario_proximos`

**FALLBACK (2 — admin)**: `listar_schema`, `consultar_tabela`

### 37.5 Permissões (TOOL_SECOES)

Cada tool gateada por uma ou mais seções de `cargo_permissoes.secao`. Admin sempre passa. Tools `[]` (sem exigência) liberadas pra qualquer logado: `minhas_tarefas`, `alertas_pessoais`, `calendario_proximos`, `listar_schema`.

Vendedor com `TOOLS_BLOQUEADAS_VENDEDOR` set: `top_clientes`, `resumo_cliente360`, `alertas_cliente360`, `listar_segmentos_c360`, `listar_campanhas_c360`, `detalhe_cliente_c360`, `buscar_notas_c360`, `buscar_contato`, `consultar_tabela`, `ranking_carteiras`, `vendas_por_vendedor` — system prompt orienta usar `minha_carteira`.

### 37.6 Cascade de providers

```
1. Groq Llama 3.3 70B (primário, sem retry)
   ↓ falha
2. gemini-proxy (rotaciona 4 keys, com retry 1×)
   ↓ falha
3. Groq Llama 3.1 8B (última tentativa)
   ↓ falha
4. 503 "IA temporariamente sobrecarregada"
```

### 37.7 Tabelas BLOQUEADAS (segurança)

`profiles`, `bling_tokens`, `ai_chat_log`, `cargo_permissoes`, `activity_log`, `avatares_ia_log`, `ia_prospeccao_log` — não estão em `TABELAS_PERMITIDAS`.

### 37.8 Contrato (mantido idêntico ao v18 — UI sem alteração)

```
IN  POST /functions/v1/ai-chat
    Authorization: Bearer <user JWT>
    body: { messages: [{role, content}, ...max 20] }

OUT 200 { resposta, modelo, tools_usadas, tokens, duracao_ms }
ERR 401 JWT inválido | 429 rate limit | 503 transiente | 500 outros
```

Frontend `aiChatEnviar` no `index.html` segue funcionando sem mudança (já tem retry 3× client-side com backoff 0/2/5s).

### 37.9 Deploy

```bash
python .claude/scripts/deploy-ai-chat-v19.py
# -> HTTP 201 version=20 status=ACTIVE
```

Smoke test: gateway retorna `401 UNAUTHORIZED_LEGACY_JWT` quando JWT inválido (esperado), `401 NO_AUTH_HEADER` quando ausente. Função compila e responde.

### 37.10 O que mudou na pendência da Section 36

| Antes (Section 36.15) | Agora |
|---|---|
| 🟡 Reescrever ai-chat from scratch (~1h) | ✅ FEITO |
| ai-chat usa GEMINI_API_KEY direto | ai-chat usa gemini-proxy (rotação 4 keys) |
| Source corrompida bloqueia edits | Source limpa em `ai-chat-v19/index.ts` |

### 37.11 Pendências atualizadas

| Item | Tipo | Prioridade |
|---|---|---|
| Liberar Estúdio IA pros cargos `designer` e `gerente_marketing` | Toggle `cargo_permissoes` | 🟡 Aguardando Manu |
| Sync inicial massivo das ~4.7k imagens dos produtos | ~95 batches | 🟡 Quando der |
| GitHub Action `backup-supabase.yml` | Manual GitHub UI | 🟡 Quando der |
| Validação real do ai-chat v19 com perguntas variadas | User no browser | 🟢 Próxima sessão |
| Inconsistência permissão `campanhas_internas` vs `campanhas-internas` | DELETE row dup | 🟢 Não bloqueante |

### 37.12 Onde paramos

ai-chat v19 deployado e ACTIVE. Próximo passo é o user (Manu/Juan) testar via UI. As novas tools cobrem TUDO: vendas/financeiro/estoque/C360/marketing/sistema. Bot agora "sabe de tudo".

---

**Fim da documentação · Atualizado em 28/04/2026 noite-tarde — ciclo 37 (ai-chat v19) · v4.1**

---

## 38. CICLO 28/04/2026 NOITE — SYNC HISTÓRICO BLING 2024

### 38.1 Motivo

Card "Total de Clientes Matriz" mostrava **5.630**. A Dana achava que era pouco. Investigação:

| O que | Quantidade |
|---|---|
| Contatos totais Bling | 41.047 |
| Contatos que NUNCA compraram (leads, fornecedores, transportadoras) | 31.529 |
| Contatos que compraram | 8.634 |

A view `cliente_scoring` puxa **da tabela `pedidos`** (não `contatos`). "Cliente" = nome distinto que fez ≥1 pedido não-cancelado. Os 31k contatos são leads/fornecedores que nunca geraram pedido — corretamente filtrados.

**Mas** o sync Bling só vinha de Jan/2025 pra cá. Faltavam **12 meses de 2024** com clientes reais. A Dana decidiu sincronizar 2024.

### 38.2 Script novo

`C:/Users/Juan - Dana Jalecos/Documents/Sistema Marketing/.claude/scripts/sync-pedidos-historico-2024/sync.py`

Funcionamento:
- Lê tokens das duas empresas direto de `bling_tokens` via Management SQL API
- Bate na Bling `pedidos/vendas?dataInicial&dataFinal&pagina&limite=100` mês a mês
- Token bucket por empresa (2.5 req/s) — Matriz e BC têm tokens separados, rate limit independente
- Paralelo Matriz + BC (5 req/s efetivo no nosso lado, 2.5 cada Bling)
- Refresh automático se 401 (mas tokens estavam vivos)
- Sanitização: `data='0000-00-00'` (Bling às vezes manda) → vira null. Pedidos sem data válida são pulados
- Upsert em batches de 200 com fallback 1-a-1 se algum batch falhar
- Idempotente: rerun não duplica (UPSERT em `id`)

3 fases:
- `pass1`: lista pedidos 2024 (rápido, ~2 min)
- `pass2`: detalha itens de cada pedido (lento, ~1h)
- `tudo`: as duas em sequência

### 38.3 Resultado PASS 1 (executado)

| Empresa | Antes (Jan/2025+) | Depois (com 2024) | Δ pedidos |
|---|---|---|---|
| Matriz | 8.921 | **17.456** | +8.535 |
| BC | 4.420 | **7.083** | +2.663 |

**Tempo: 2.2 min** (1 minuto inicial + 1 minuto re-run após sanitizar `data_saida='0000-00-00'`).

Bling não caiu, sem 429.

### 38.4 Impacto no `cliente_scoring_resumo`

A view é dinâmica (não materializada) — recalculou sozinha:

| Métrica | Matriz antes | Matriz depois | BC antes | BC depois |
|---|---|---|---|---|
| **Total clientes** | 5.630 | **10.416** | 3.062 | **4.504** |
| Faturamento total | — | **R$ 13.458.773** | — | **R$ 2.717.919** |
| Em risco | 649 | 1.650 | 485 | 923 |
| Perdidos | 4.693 | 8.365 | 2.446 | 3.398 |
| VIPs | 0 | 31 | 0 | 0 |

**Ganho: +6.228 clientes** (+72% no total geral DMS).

### 38.5 PASS 2 (em background quando este doc foi escrito)

PASS 2 vai detalhar os ~11.198 pedidos 2024 e popular `pedidos_itens`. Necessário pra:
- Bot/`top_produtos` retornar SKUs de 2024 corretamente
- Análise de mix de produto histórico
- Cálculos de "produto preferido" do cliente C360

Estimativa: ~75 min (paralelo Matriz + BC, 2.5 req/s cada, ~11k pedidos).

Pode ser interrompido e retomado — o pass2 só busca pedidos que ainda NÃO têm itens (`NOT EXISTS`).

### 38.6 Edge cases observados no Bling

- **`dataSaida='0000-00-00'`**: ~5-10% dos pedidos. Sanitizado pra null no mapper.
- **Pedidos com `contato_nome` vazio**: alguns. Mantidos no banco (vão ser ignorados pela view scoring).
- **Pedidos cancelados (situacao_id=12)**: trazidos de qualquer forma. View filtra.
- **Pedidos com mesmo `contato_nome` (homônimos)**: 2 pessoas "Maria Silva" colapsam em 1 cliente. Limitação conhecida desde Section 33.

### 38.7 O que NÃO foi sincronizado

- **Anos antes de 2024**: Dana disse "desde 2024 tá ok". Se um dia quiser anos anteriores, é só rodar o script com range customizado.
- **Pedidos cancelados com nome vazio**: invisíveis pro C360 mesmo no banco.
- **Pedidos de COMPRA** (entrada/fornecedores): Bling tem endpoint `/Api/v3/pedidos/compras` separado. Não é cliente, é fornecedor — sai pelo Sistema de Estoque.

### 38.8 Próximos passos pra rerodar / estender

```bash
# Sincronizar ano específico (editar dates no script):
python .claude/scripts/sync-pedidos-historico-2024/sync.py pass1
python .claude/scripts/sync-pedidos-historico-2024/sync.py pass2
python .claude/scripts/sync-pedidos-historico-2024/sync.py tudo  # PASS 1 + PASS 2
```

Pra anos anteriores (2023, 2022...): copiar `sync-pedidos-historico-2024/` → `sync-pedidos-historico-2023/`, trocar o `range(1, 13)` e o `2024` no código pra ano alvo.

### 38.9 Onde paramos

Card C360 mostra agora **10.416 Matriz / 4.504 BC** (em vez de 5.630 / 3.062). PASS 2 rodando em background pra completar `pedidos_itens`. Próxima sessão pode validar com a Dana se o número faz sentido pra ela.

### 38.10 Pendências atualizadas

- ✅ Sync 2024 OK (PASS 1)
- 🟡 PASS 2 (itens) terminando em background — ~75 min total
- 🟢 Anos pré-2024: aguardando pedido da Dana

---

**Fim da documentação · Atualizado em 28/04/2026 noite — ciclo 38 (sync histórico 2024) · v4.2**

---

## 39. CICLO 28/04/2026 NOITE — INSIGHT C360 v13 + BOTÃO WHATSAPP + FIX KANBAN

### 39.1 Bug Kanban

Sintoma: usuário clicava em "Tarefas e Kanban" e ficava travado em "Carregando quadro...".

**Causa**: regressão da otimização lazy-load (Section 36.9). O dashboard chama `loadOnce('tarefas', loadTarefas)` pra alimentar widgets. `loadOnce` marca `_viewLoaded.tarefas=true` ANTES de chamar a função. Mas `loadTarefas` faz early-return `if (!board) return` quando `#kanban-board` não existe (só existe na view-kanban). Resultado: cache marcado como carregado mas board NUNCA renderizou. Clicar em Kanban depois não disparava novo render porque o flag tava true.

**Fix** (`index.html` linha 9724): na view-kanban, sempre chamar `loadTarefas()` direto sem `loadOnce`. Custo: +1 SELECT por entrada na view (mínimo). Commit `77dbc44`.

### 39.2 cliente360-insight v13 — reescrito do zero

Source antigo (v12) era binário extraído (chars corrompidos). Reescrito limpo em `.claude/scripts/cliente360-insight-v13/index.ts` (368 linhas).

**Mudanças vs v12:**

| Aspecto | v12 | v13 |
|---|---|---|
| Source | binário extraído | TS limpo, 368 linhas |
| Gemini | direto via `GEMINI_API_KEY` | via `gemini-proxy` (rotação 4 keys) |
| System prompt | 3 seções | **4 seções** (+ MENSAGEM WHATSAPP) |
| Modelos | Llama 3.3 + Gemini 2.5 | iguais |
| Quota/permissões | mantido | mantido (admin ilim, gerente 20/dia, vendedor 5/dia) |

**4ª seção do system prompt** (NOVA):
```
MENSAGEM WHATSAPP:
(uma mensagem de texto curta, 250-350 chars, pra colar direto no WhatsApp.
PRIMEIRA PALAVRA é "Olá" + primeiro nome. Tom: educado, profissional,
levemente caloroso. Conecta com a AÇÃO RECOMENDADA. SEMPRE termina com
pergunta aberta. Assina "— Equipe Dana Jalecos" no final.)
```

Com isso a IA já gera junto a frase pronta pro vendedor copiar/enviar — sem chamar IA duas vezes, sem latência extra.

### 39.3 Frontend — botão WhatsApp no insight

`cliente-360-boot.js`:

**`parseInsightSecoes`** estendido pra capturar 4 seções (era 3). Regex agora aceita `mensagem whatsapp` como label adicional. Insights antigos (sem 4ª seção) → `s.mensagem_whatsapp = ''` → botão não renderiza (fallback gracioso).

**`insightCard`** ganhou `waBlock`:
- Renderiza box verde (rgba 34,197,94) com:
  - Botão "📱 Enviar pelo WhatsApp" (verde sólido `#22c55e`)
  - Mensagem em preview (white-space:pre-wrap)
  - Hint: "Você pode editar a mensagem direto no WhatsApp Web antes de enviar"
- Só renderiza se `s.mensagem_whatsapp` existe **E** cliente tem `celular || telefone`
- Se mensagem existe mas cliente sem fone → renderiza aviso cinza "💬 IA sugeriu mensagem mas cliente sem telefone"

**`c360OpenWhatsApp(contatoNome, msgEncoded)`** (novo helper):
- Busca cliente em `state.clientes`, pega `c.celular || c.telefone`
- Strip não-dígitos (`replace(/\D/g, '')`)
- Prefixo `55` se length ∈ {10, 11} (BR mobile/landline)
- Abre `https://wa.me/{num}?text={encodeURIComponent(msg)}` em nova aba
- Mesmo padrão do Prospecção (Section 36.5)

`renderInsightsTab` atualizado pra passar `contatoNome` ao `insightCard`.

### 39.4 Fluxo completo

1. User clica "Insight IA" na ficha do cliente
2. Frontend POST → `cliente360-insight` v13
3. Edge function: auth + quota + monta contexto + chama Groq (ou gemini-proxy se Groq falhar)
4. IA gera 4 seções incluindo `MENSAGEM WHATSAPP:`
5. Frontend parseia, renderiza card com 4 blocos
6. 4º bloco (verde) tem botão "📱 Enviar pelo WhatsApp"
7. Click → abre `wa.me/55XXXX?text=...` com mensagem pré-pronta
8. Vendedor revisa/edita no WhatsApp Web e envia

### 39.5 Compatibilidade com insights antigos

Insights gerados pela v12 (3 seções) continuam renderizando normalmente — só não vão ter o botão WhatsApp. Pra ganhar o botão, é só clicar "Recalcular" e a v13 gera com 4 seções.

### 39.6 Edge Functions estado final

| Função | Versão | Mudou? |
|---|---|---|
| ai-chat | v20 | (cycle 37) |
| construtor-ai | v7 | (gemini-proxy) |
| gerar-peca-ia | v11 | (gemini-proxy) |
| gerar-prompt-visual | v3 | (gemini-proxy) |
| **cliente360-insight** | **v13** | **NOVO ciclo 39 (gemini-proxy + WhatsApp)** |
| ai-chat-debug | v2 | sem mudança |
| gemini-proxy | v1 | sem mudança |

Pendência fechada: ✅ migrar `cliente360-insight` pro `gemini-proxy` (era a última edge function que ainda chamava Gemini direto).

### 39.7 Onde paramos

- Bug Kanban: ✅ corrigido (commit `77dbc44`)
- ai-chat v19 + cliente360-insight v13: ambos em prod
- Botão WhatsApp: pronto pra testar quando o Manu/Juan abrir um cliente e gerar novo insight
- PASS 2 do sync 2024 (itens): rodando em background (~75 min total — ainda em curso)

### 39.8 Pendências atualizadas

- 🟡 PASS 2 (itens 2024) terminando — ainda em background
- 🟡 Testar fluxo completo Insight + WhatsApp com cliente real
- 🟡 Liberar Estúdio IA pros cargos `designer` e `gerente_marketing` (aguardando Manu)
- 🟢 Sync inicial massivo das ~4.7k imagens dos produtos pro Storage
- 🟢 GitHub Action `backup-supabase.yml`

---

**Fim da documentação · Atualizado em 28/04/2026 noite — ciclo 39 (insight v13 + WhatsApp + Kanban fix) · v4.3**

---

## 40. CICLO 28/04/2026 NOITE-LATE — Quota Prospecção + UI Permissões

### 40.1 Limite diário pra Prospecção IA

Antes só tinha limite **por busca** (admin 30 / demais 10 leads), sem teto diário/mensal — qualquer vendedor podia rodar 100 buscas/dia → R$ 18-20/dia/vendedor de gasto descontrolado na key paga.

**SQL aplicada:**
```sql
CREATE TABLE prospeccao_config (
  id=1, ativo bool, limite_diario_vendedor int=5,
  limite_diario_gerente int=10, limite_mensal_reais numeric=100,
  custo_estimado_por_busca_reais numeric=0.18,
  pausado_por_limite bool, pausado_manual bool, ...
);
CREATE FUNCTION prospeccao_count_hoje(uid) → INT;
CREATE FUNCTION prospeccao_gasto_mes() → NUMERIC;
```

Espelha exatamente o padrão do `cliente_insights_config`. RLS: read aberto, write só admin.

### 40.2 prospectar v9 ACTIVE

Antes do `callGeminiWithSearch`, valida (admin é ilimitado, pula tudo):
1. **Kill-switches**: `pausado_manual` (admin define via SQL/painel) e `pausado_por_limite` (auto-set quando bate teto mensal)
2. **Limite mensal**: lê `prospeccao_gasto_mes()` — se >= R$ 100, auto-pausa e retorna 403
3. **Limite diário**: vendedor 5/dia, gerente 10/dia. Conta via `prospeccao_count_hoje(uid)`. 429 quando estoura.

Resposta passa a incluir `quota: { usados, limite, restante }` pra UI mostrar contador "3/5" igual o insight.

### 40.3 Reorganização do painel Permissões (admin)

Antes a categoria "📌 Outros" amontoava 11 chaves (avatares_ia_gerar, branding, campanhas_internas, comunidade, prospeccao*, provasocial_*, estudio) sem label descritivo, só com a chave bruta — confuso saber o que cada toggle fazia.

**Mudanças em `PERM_GROUPS`** (`index.html` linha ~19235):
- 💰 Vendas: + `comunidade`, `prospeccao`, `prospeccao_buscar`, `prospeccao_editar`
- 📣 Marketing: + `campanhas_internas` (legada), `branding`, `provasocial_aprovar/criar/excluir`
- 🤖 IA Gerativa: NOVA categoria com `estudio`, `avatares_ia_gerar`

**Labels descritivas adicionadas em `secaoLabels`** — ex:
- `prospeccao_buscar` → "🚀 Prospecção · Buscar leads (Google + Gemini)"
- `provasocial_aprovar` → "✅ Prova Social · Aprovar conteúdo UGC"
- `estudio` → "🎬 Estúdio IA · Banner/Post/Story/Anúncio"
- `campanhas_internas` (com underscore) → "📋 Campanhas Internas · Acessar (legada — duplicata histórica)"
- `campanhas-internas` (com hífen) → "📋 Campanhas Internas · Acessar (preferida)"

⚠ **Nada foi desmarcado** — só reorganizado e renomeado. Todos os toggles continuam fazendo exatamente o que faziam antes.

### 40.4 Edge Functions estado final

| Função | Versão | Mudou? |
|---|---|---|
| **prospectar** | **v9** | **NOVO ciclo 40 (quota diária + mensal)** |
| Demais | (sem mudanças desde ciclo 39) | |

### 40.5 Pendências atualizadas

- 🟡 PASS 2 (itens 2024) ainda em background
- 🟡 Liberar Estúdio IA pros cargos `designer` e `gerente_marketing`
- 🟢 Inconsistência `campanhas_internas` vs `campanhas-internas` (ainda 2 chaves duplicadas — mas agora pelo menos com label deixando claro qual é qual)
- 🟢 Sync inicial das ~4.7k imagens dos produtos pro Storage
- 🟢 Migração R2 (plano salvo em `steady-imagining-charm.md`)

### 40.6 Onde paramos

prospectar v9 ACTIVE com quota. Painel admin de permissões reorganizado. Próxima sessão: pode rodar `loadAdminPermissoes()` no admin → dropdown "vendedor" → ver os toggles agora arrumados em 💰 Vendas / 📣 Marketing / 🤖 IA Gerativa em vez de "Outros".

---

**Fim da documentação · Atualizado em 28/04/2026 noite-late — ciclo 40 (quota prospecção + perms UI) · v4.4**

---

## 41. CICLO 28/04/2026 NOITE — LOGIN BUGS + LAZY-LOAD FIXES + VIP

### 41.1 Migração Vercel + repo novo `DanaJalecos/dana-marketing`

User criou novo repo na conta `DanaJalecos` (mesmo dono do `DanaJalecos/estoque`) pra unificar gerência. Antes: `DanaComercial/dana-marketing` (deploy GH Pages). Agora: `DanaJalecos/dana-marketing` deploya no Vercel.

**Estrategia escolhida**: 2 repos separados (não monorepo), repo antigo continua como espelho/backup.

**O que subiu** (filtrado, sem .claude/, scripts/backup/, tokens, _migrate*.py, *.html.backup-*):
- index.html, cliente-360.html, cliente-360-boot.js
- assets/, docs/, edge-functions/ (TS source), sql-scripts/ (44 SQL)
- supabase-setup.sql, sync-completo.js, generate-sql.js
- DOCUMENTACAO-COMPLETA-DMS.md
- vercel.json (zero build, headers de segurança, cache assets/*)
- README.md (novo)
- .gitignore reforçado

**Workflow daqui pra frente**: edição feita no worktree (`vibrant-davinci`) → commit em DanaComercial. Mesma alteração copiada manualmente pro staging dir `_staging-dana-marketing/` → commit em DanaJalecos. Worktree tem 2 remotes mas repo histórico é diferente.

### 41.2 Bug login redirect pra C360 (vários iterações)

User: "ele joga pro C360 e fica na tela antiga dele toda bugada"

Iter 1 — `firstAllowedView()` reorganizada:
- admin → home (já era)
- vendedor → meus_clientes/cliente360
- demais (gerente, designer, etc) → home primeiro, cliente360 só fallback
Antes era cliente360 PRIMEIRO pra todos não-admin, jogando gerentes/designers no iframe C360 logo após login.

Iter 2 — localStorage trap: `localStorage['dms-active-view']='cliente360'` salvo de sessão anterior sobrepunha o fix. Limpar cache do navegador NÃO limpa localStorage. Fix: na restauração pós-login, se saved view é 'cliente360' E cargo NÃO é vendedor, descarta e usa firstAllowedView.

Iter 3 — view morta: `firstAllowedView` pra vendedor retornava `meus_clientes` que não existe mais como view standalone (virou aba interna do C360). User caía em `#meus_clientes` com tela em branco. Fix: vendedor → cliente360 direto. + validação extra: se localStorage aponta pra view sem div correspondente no DOM, descarta.

Iter 4 — vercel.json removeu rewrite `/cliente-360 → /cliente-360.html` (porta de entrada acidental pra página standalone fora do DMS).

Iter 5 — dashboard C360 silencioso: `loadDashboardResumo()` fazia `return` quando data era null/erro, deixando demo HTML "Carregando..." travado. Fix: `renderDashboardErro()` mostra box vermelho com mensagem real do erro + botão "Tentar de novo". Usuário consegue ver o erro real e nos passa.

### 41.3 Lazy-load fixes pós Section 36.9

**Bug Kanban** (1ª iter): `loadOnce` marcava `_viewLoaded.tarefas=true` quando dashboard chamava loadTarefas pra widgets. Mas loadTarefas faz `if (!board) return` quando `#kanban-board` não está no DOM (só existe em view-tarefas). Resultado: cache=true, mas board nunca renderizou. Fix: na view-tarefas, sempre chamar loadTarefas direto.

**Bug Kanban pra designer** (2ª iter): id da view é `tarefas`, mas eu tinha posto `kanban` no handler. Pra admin não aparecia (dashboard chama loadTarefas pros widgets, cache fica populado). Pra designer (que cai DIRETO em tarefas, sem passar pelo home) o handler nunca disparava. Fix: aceitar `'tarefas' OU 'kanban'` como id.

**Bug Canais e Vendas** (3 widgets travados): a view tem 3 áreas independentes:
- Top Clientes por Volume → `loadMarketplacesExtras` (não `loadMarketplaces` — atenção ao sufixo)
- Canais de Venda → `loadCanaisVenda` ✓
- Revendas Nacionais/Internacionais → `loadRevendasParceiros`
Antes só `loadCanaisVenda` era chamada. Fix: chamar as 3.

**Bug Dashboard "Previsão de Receita" travado em "calculando..."**: `loadPrevisaoReceita` só era chamada na view financeiro. Fix: adicionar loadOnce('previsao-receita', ...) na home.

**Top Clientes — desempate por valor**: ordenação só por contagem fazia clientes B2B grandes (LSI S.A R$ 38k, 3 ped) ficarem atrás de pequenos (Willian Hara R$ 901, 3 ped) quando empatam. Fix: sort agora é (pedidos DESC, total DESC).

### 41.4 VIP threshold 80 → 75 (view alterada no banco)

User: "quando um cliente bater score 75, ele é considerado VIP"

Antes: VIP >= 80 (rigoroso). Resultado: matriz 31 VIPs, BC 0 VIPs.

Aplicado via `CREATE OR REPLACE VIEW cliente_scoring`:
```sql
CASE
  WHEN score >= 75 THEN 'VIP'        -- era 80
  WHEN score >= 60 THEN 'Frequente'
  WHEN score >= 40 THEN 'Ocasional'
  WHEN dias_sem_compra > 90 AND total_pedidos >= 2 THEN 'Em Risco'
  ELSE 'Inativo'
END
```

Resultado: matriz **40 VIPs** (+9), BC **3 VIPs** (+3). Como é view dinâmica, todas telas (C360 dashboard, lista, bot ai-chat tools, edge cliente360-insight) refletem na hora.

### 41.5 cliente360-insight v14 (bugfix)

V13 (recém deployada com botão WhatsApp) tinha `select('nome, cargo, ativo')` mas coluna `ativo` NÃO existe em `profiles` (só id, nome, email, role, cargo, last_login). PostgREST retornava erro, frontend recebia 403 "Profile não encontrado". Fix: tirar `ativo` do select. Deploy v14 ACTIVE.

### 41.6 Sync histórico — investigação

User pediu sincronizar histórico Bling pra chegar nos 80k clientes esperados pela Dana.

Diagnóstico:
- **Bling tem pedidos de 2018-2023** (matriz: todos anos cheios; BC: começou em 2020)
- Hoje temos 14.739 clientes únicos (matriz 10.451 + bc 4.517 dedup)
- Estimativa pós-sync 2018-2023: **40-55k clientes** (não chega aos 80k — a Dana provavelmente está incluindo os 41k contatos do Bling, que misturam leads/fornecedores)
- Tempo estimado sync 2018-2023: ~12-18min paralelo (mesmo script `sync-pedidos-historico-2024`)

**Status**: aguardando confirmação do user pra rodar (ainda não disparado).

### 41.7 PASS 2 (itens 2024) — TERMINADO

Background task da Section 38 completou: 98.6% Matriz + 98.8% BC dos pedidos 2024 com itens populados em `pedidos_itens`. Ainda restam ~150 pedidos sem itens (alguns Bling não retornou items no detail endpoint — cancelados ou estados especiais).

### 41.8 Edge Functions estado atual

| Função | Versão | Status |
|---|---|---|
| ai-chat | v20 | ACTIVE (Section 37) |
| construtor-ai | v7 | ACTIVE |
| prospectar | v9 | ACTIVE (quota Section 40) |
| gerar-peca-ia | v11 | ACTIVE |
| gerar-prompt-visual | v3 | ACTIVE |
| gerar-avatar-ia | v15 | ACTIVE |
| **cliente360-insight** | **v14** | **ACTIVE (Section 41 bugfix)** |
| gemini-proxy | v1 | ACTIVE |
| sync-imagens-produtos | v2 | ACTIVE |

### 41.9 Pendências aguardando

| Item | Tipo | Prioridade |
|---|---|---|
| Sync histórico Bling 2018-2023 (~12-18min) | rodar script | 🟡 Esperando OK do user |
| Liberar Estúdio IA pros cargos `designer`/`gerente_marketing` | toggle cargo_permissoes | 🟡 Esperando Manu |
| Migração R2 (plano em `steady-imagining-charm.md`) | edge functions + frontend | 🟢 Quando der |
| Sync inicial das ~4.7k imagens dos produtos pro Storage | rodar batches | 🟢 Quando der |
| Padronização: editar só no worktree e push pros 2 repos via 2 remotes | git remote sync | 🟢 Hoje preciso copiar pro staging dir |
| Inconsistência `campanhas_internas` vs `campanhas-internas` (chaves duplicadas) | DELETE row dup | 🟢 Não bloqueante (label já distingue) |

### 41.10 Onde paramos

**Tudo no ar nos 2 repos** (DanaComercial espelho + DanaJalecos Vercel ativo):
- `eaae624` push final do DanaJalecos antes deste consolidado
- `5a46860` Top clientes desempate (DanaComercial)
- `a20387d` Kanban viewId fix designer (DanaJalecos)

**Vercel deploys ativos**:
- DMS: `danamarketing.vercel.app` (importado pelo user)
- Estoque: `danajalecos/estoque` aguardando importação no Vercel (vercel.json no commit `33ef933`)

**Próxima sessão**:
- User decide: rodar sync histórico 2018-2023?
- Liberar Estúdio IA pros cargos quando Manu aprovar
- Eventualmente migrar storage pro R2

---

**Fim da documentação · Atualizado em 28/04/2026 madrugada — ciclos 41-43 consolidados · v4.5**

---

## 42. CICLO 29/04/2026 — SYNC HISTÓRICO + BUGFIXES + PROSPECÇÃO + RD STATION GAP

### 42.1 Sync histórico Bling 2018-2023 (matriz) + 2020-2023 (BC)

Script `_apply` existente (`sync-pedidos-historico-2024`) clonado pra `sync-pedidos-historico-2018-2023`. Range parametrizável por empresa.
- Matriz: 6 anos (2018-2023) → +30.582 pedidos
- BC: 4 anos (2020-2023) → +8.369 pedidos
- **Total inserido: +38.951 pedidos**, 4.7 min execução paralela
- Pós-sync: 48.058 matriz + 15.456 BC = **~33k clientes únicos** (Dana esperava 80k — diferença é mistura de leads/fornecedores na base bling, e pré-2018 não existe no Bling)
- Distribuição cliente_scoring: 65 VIPs, 148 Frequentes, 1.030 Ocasionais, 8.075 Em Risco, 23.617 Inativos

### 42.2 C360 Insight: bug do placeholder "Fase 3"

Toda vez que abria a aba Insights de um cliente, aparecia *"Insights IA — em breve / Disponível na Fase 3"* por ~ms até `renderInsightsTab` substituir.

Causa: template inicial de `c360-tabpanel-insights` no HTML tinha esse placeholder antigo hardcoded.

Fix: trocou por loader silencioso `⏳ Carregando insights...` (mesmo padrão da aba Notas).

Commits: `591a90f` DanaComercial, `eb0f921` DanaJalecos.

### 42.3 Prospecção: 4 melhorias UX

User reportou que ao buscar com IA aparecia leads "Contatado" misturados com novos.

**B. Filtro padrão "Novos"**: select de status default vira `🆕 Novos` (era "Todos status"). Vendedor abre página → vê só atacáveis.

**C. Ordenação**: novo → em_negociacao → contatado → convertido → descartado. Dentro de cada grupo, mais recente primeiro. Aplica mesmo com filtro "Todos".

**D. Botão WhatsApp distinto**:
- Lead novo: `💬 WhatsApp` verde
- Lead contatado: `✅ Já contatado` cinza com tooltip da data. Continua clicável.

**E. IA recebe blacklist completa**:
- Frontend: enviava 30 nomes truncados, agora envia TODOS leads do mesmo segmento+região
- Edge function `prospectar` v10: cap aumentado 30→80, blacklist numerada com header explícito, instrução reforçada *"REGRA OBRIGATÓRIA: ignore qualquer empresa da BLACKLIST. Se só achar repetidas, retorne lista vazia"*

Commits: `3d3e042` DanaComercial, `2176c7d` DanaJalecos.

### 42.4 Bug Criativos: constraint `criativos_tipo_check`

Designer recebia erro: *"new row for relation criativos violates check constraint criativos_tipo_check"*.

**Causa:** ao escolher modo "Link" (cola URL ao invés de upload), `detectTipoMaterial(url)` retornava `'link'`. Mas constraint só aceitava `imagem|video|pdf|outro`. Inconsistência histórica — `materiais_briefing` e `brandkit_itens` já aceitavam `link`, só `criativos` ficou de fora.

**Fix SQL:**
```sql
ALTER TABLE criativos DROP CONSTRAINT criativos_tipo_check;
ALTER TABLE criativos ADD CONSTRAINT criativos_tipo_check
  CHECK (tipo IN ('imagem','video','pdf','link','outro'));
```

Não precisou mexer no frontend — só no banco. Aplicado direto no projeto DMS Supabase.

### 42.5 Análise RD Station — gap identificado pra próximas ondas

Usuário pediu pra ler `Engenharia_Reversa_e_Análise_Arquitetural_do_Ecossistema_RD_Station.docx` e dizer o que falta no DMS.

**Gaps relevantes pro caso Dana (priorizados):**

| Onda | Feature | Esforço | Custo recorrente |
|---|---|---|---|
| **1** | Funil Kanban dos prospects (já tem dados, falta UI) | 3-4h | R$ 0 |
| **2** | Timeline unificada do C360 (cliente_eventos + view + UI) | 6h | R$ 0 |
| **3** | Listas dinâmicas + API captura de leads (FB Ads/forms externos) | 8h | R$ 0 |
| **4** | Provedor email (Resend free tier 100/dia) + automação básica | 16h | R$ 0 (free tier) |
| **5** | WhatsApp Omnichannel (Meta API ou Z-API) | 30h+ | R$ 50-300/mês |

**Não vale a pena pra Dana:**
- Construtor LP (GrapesJS): Dana usa Shopify + 70 canais Bling
- Lead Tracking script: sem volume de tráfego anônimo significativo
- Filas Redis/Kafka: cron + edge functions cobrem
- iPaaS: Dana não vende integrações
- Construtor visual de e-mails (Unlayer): templates simples bastam

**O que Dana JÁ tem do paradigma RD:**
- Cliente Scoring composto ✅
- Segmentação básica (VIP/Frequente/etc) ✅
- Webhooks de entrada (Bling) ✅
- Sync automático ✅
- Bot IA com 38 tools ✅
- Insights IA + WhatsApp pré-pronto ✅
- Permissões granulares ✅

User vai dar `/compact` e retomar com Onda 1 depois.

### 42.6 Edge Functions estado atual

| Função | Versão | Mudou? |
|---|---|---|
| **prospectar** | **v10** | **NOVO ciclo 42 (blacklist reforçada)** |
| ai-chat | v20 | (sem mudança) |
| construtor-ai | v7 | (sem mudança) |
| gerar-peca-ia | v11 | (sem mudança) |
| gerar-prompt-visual | v3 | (sem mudança) |
| gerar-avatar-ia | v15 | (sem mudança) |
| cliente360-insight | v14 | (sem mudança) |
| gemini-proxy | v1 | (sem mudança) |
| sync-imagens-produtos | v2 | (sem mudança) |

### 42.7 Pendências atualizadas

| Item | Status |
|---|---|
| Onda 1 (Funil Kanban Prospects) | 🟢 Pronto pra começar — dados existem |
| Onda 2 (Timeline unificada C360) | 🟢 Pronto |
| Onda 3 (API captura leads + listas dinâmicas) | 🟢 Pronto |
| Onda 4 (provedor email + automação) | 🟡 Aguardando assinatura Resend (gratuito) |
| Onda 5 (WhatsApp Omnichannel) | 🟡 Decisão da Manu — só vale se centralizar atendimento |
| Migração R2 storage | 🟢 Plano salvo, baixa prioridade |
| Liberar Estúdio IA pros cargos designer/gerente_marketing | 🟡 Manu precisa aprovar |
| Sync inicial 4.7k imagens produtos pro Storage | 🟢 Quando der |

### 42.8 Onde paramos

User pediu `/compact` pra continuar com as ondas RD Station depois.

**Commits do dia 29/04:**
- `591a90f` C360 Insights placeholder fix (DanaComercial)
- `eb0f921` Mesma coisa (DanaJalecos)
- `3d3e042` Prospecção 4 melhorias (DanaComercial)
- `2176c7d` Mesma coisa (DanaJalecos)
- (sem commit) ALTER TABLE criativos no banco

---

## 43. CICLO 29/04/2026 (TARDE) — ONDA #0: SYNC RETRIES COM BACKOFF EXPONENCIAL

**Roadmap pós-RD Station:** primeiro item das 5 ondas (#0 Webhook retries → adaptado pra DMS sync retries, já que DMS usa cron polling, não webhook).

### 43.1 Problema

As ~10 sync functions do Bling (`sync-pedidos`, `sync-contatos`, `sync-contas-pagar/receber`, etc — matriz e BC) rodam via pg_cron a cada 1-6h. Se uma falhar (rate limit, network glitch, Bling 5xx), o evento ficava só logado em `sync_log` com `status='error'` e a próxima execução seria 6h depois — sem retry imediato.

Falhas reais nos últimos 30 dias: 2 (`'fetch failed'` em 15/04 + 1 backfill parcial em 20/04). Raríssimo, mas crítico quando acontece.

### 43.2 Arquitetura (zero invasão nas sync functions existentes)

```
┌───────────────┐ trigger    ┌───────────────┐ cron 1m   ┌─────────────────────┐
│  sync_log     │ ─────────▶│ sync_failures │ ─────────▶│ sync-retry-processor │
│  (existente)  │ on error   │  (queue)      │           │ (edge function)      │
└───────────────┘            └───────────────┘           └─────────────────────┘
                                     ▲                           │
                                     │ updates status            │ POST job_url
                                     └───────────────────────────┘
```

**Tabelas novas:**
- `sync_failures` (queue): id, job_name, job_url, job_body jsonb, attempts, max_attempts (6), last_error, last_attempt_response, next_retry_at, status (pending/retrying/success/failed/cancelled), original_log_id (FK sync_log), created_at, updated_at
- `sync_job_routes` (mapping): tabela + tipo → URL da edge function (12 rotas: matriz × BC × {pedidos, contatos, contas_pagar, contas_receber, produtos, pedidos_itens})

**Função SQL `backoff_minutes(attempts)`:**
- 0 → 1 min
- 1 → 5 min
- 2 → 30 min
- 3 → 120 min (2h)
- 4 → 360 min (6h)
- ≥5 → 1440 min (24h)

**Trigger `enqueue_sync_retry_from_log`** (AFTER INSERT em sync_log):
- Se `NEW.status = 'error'`, busca rota em sync_job_routes, INSERT em sync_failures com `next_retry_at = NOW() + 1min`
- Idempotente: se já existe row pending pra mesma URL, ignora (evita duplicatas)

**Edge function `sync-retry-processor` v2 ACTIVE:**
- SELECT pending com `next_retry_at <= NOW()` LIMIT 10
- Pra cada: PATCH status='retrying' (lock soft), POST job_url
- Sucesso (2xx) → status='success', registra resposta
- Falha → attempts++, agenda próximo retry com backoff
- Após 6 tentativas (~33h cumulativos) → status='failed', cria alerta em `alertas` audiência=`dados_empresa`

**Cron job 24:** `* * * * *` invoca o processor a cada 1min (via `net.http_post` com Service Role).

### 43.3 UI admin — `view-admin` ganhou aba "🔄 Sync Retries"

Visível apenas pra admins (a aba inteira já está dentro de `view-admin` que tem permissão admin).

- 4 cards de stats: Pendentes / Retentando / Sucesso / Desistiu
- Tabela das últimas 100 falhas (id, job, status badge colorido, attempts/max, próximo retry relativo, criado relativo, erro truncado 60ch com tooltip completo)
- Botão "▶ Rodar agora" — invoca processor manualmente (útil pra debug ou força ciclo)
- Botão "▶ Agora" por linha — força retry imediato dessa falha específica (UPDATE next_retry_at=NOW + invoca processor)

Funções JS adicionadas em `index.html` (~linha 18590):
- `loadSyncRetries()` — fetch + render
- `retryNowSync(id)` — força retry de uma row
- `runSyncRetryProcessor(silent)` — invoca processor

### 43.4 Validação fim-a-fim (passou no teste)

1. INSERT manual em `sync_log (tabela='pedidos', status='error', erro='TESTE')` → trigger criou row em `sync_failures` (pending, attempts=0)
2. UPDATE `next_retry_at = NOW()` → invoca processor manualmente
3. Processor pegou a row, fez POST em sync-pedidos → recebeu HTTP 200 com 175 pedidos sincronizados de verdade
4. Row marcada como `status='success'`, attempts=1, last_attempt_response="200: {...}"
5. Limpeza: DELETE da row de teste + log de teste

### 43.5 Bug encontrado e corrigido (deploy v1 → v2)

**Bug:** `sb()` helper na edge function tentava `r.json()` mesmo quando o servidor retornava 204 No Content (porque os UPDATEs usam `Prefer: return=minimal`). Resultado: `Unexpected end of JSON input` no primeiro PATCH.

**Fix:** checar `r.status === 204` ou body vazio antes de fazer JSON.parse.

### 43.6 Estado atual

| Componente | Status |
|---|---|
| Tabela `sync_failures` | ✅ criada com 3 indexes |
| Tabela `sync_job_routes` | ✅ criada + 12 rotas seedadas |
| Função `backoff_minutes(int)` | ✅ |
| Trigger `tr_sync_log_enqueue_retry` | ✅ ATIVO em sync_log |
| Edge function `sync-retry-processor` | ✅ v2 ACTIVE |
| Cron job (id=24) `sync-retry-processor-1min` | ✅ rodando a cada 1min |
| UI admin "🔄 Sync Retries" | ✅ adicionada em view-admin |
| Documentação | ✅ esta seção |

### 43.7 Próxima onda

**#1 Funil Kanban dos Prospects** (3-4h) — aba dentro de `view-prospeccao`, drag-and-drop reaproveitando lib do Kanban de Tarefas. Sem mudança de banco (`prospects.status` já existe).

### 43.8 Edge Functions estado

| Função | Versão | Status |
|---|---|---|
| **sync-retry-processor** | **v2** | **NOVO ciclo 43** |
| prospectar | v10 | (sem mudança) |
| ai-chat | v20 | (sem mudança) |
| outras 26 | — | sem mudança |

### 43.9 Cron jobs DMS

| Job ID | Schedule | Comando |
|---|---|---|
| 1 | `5,35 * * * *` | gerar_alertas |
| 2 | `0 9 * * *` | gerar_alertas_prazos |
| 3-23 | (vários) | sync-* matriz + BC + outros |
| **24** ⭐ | `* * * * *` | **sync-retry-processor (NOVO ciclo 43)** |

---

## 44. CICLO 29/04/2026 (TARDE-2) — ONDA #1: FUNIL KANBAN DOS PROSPECTS

**Roadmap pós-RD Station:** segundo item das 5 ondas. RD destacou Funil Kanban como feature #1 do CRM. Dana já tinha os dados (`prospects.status`), faltava UI.

### 44.1 Decisão de UX

User aprovou **Opção A**: Kanban como **aba nova dentro da seção Prospecção**, NÃO seção separada na sidebar.

Razões:
- Mesma fonte de dados (tabela `prospects`)
- Filtros (Segmento) e botão "Buscar com IA" continuam no topo, valem pras 2 abas
- Vendedora escolhe se prefere lista (escanear) ou Kanban (arrastar)
- Sidebar não cresce

### 44.2 Implementação

**HTML adicionado em `view-prospeccao` (linha ~7102):**
```html
<div class="mkt-tabs">
  <div class="mkt-tab active" onclick="prospSwitchTab(this,'kanban')">🗂️ Funil Kanban</div>
  <div class="mkt-tab" onclick="prospSwitchTab(this,'lista')">📋 Lista</div>
</div>
...
<div id="prsp-lista" style="display:none">...</div>      <!-- existente -->
<div id="prsp-tab-kanban" style="display:block">...</div> <!-- NOVO -->
```

**Default: Kanban** (`window._prspTab = 'kanban'`). Lista é a aba secundária.

**JS adicionado (linha ~18305):**
- `prospSwitchTab(el, qual)` — alterna display + esconde filtro de status quando em Kanban
- `prospRender()` (refatorada como dispatcher) chama `prospRenderLista()` + `prospRenderKanban()`. Ambas leves; renderizar a invisível custa ~5ms.
- `prospRenderKanban()` — 5 colunas (novo/contatado/em_negociacao/convertido/descartado) com cor/ícone próprios e badge de contagem
- `prospRenderKanbanCard(p, podeEditar)` — versão compacta do card (vs Lista): nome, segmento+cidade, insight IA truncado 80ch, botão WhatsApp/Já contatado, copiar msg, apagar
- `prospWireKanbanDrag()` — adiciona dragstart listeners aos cards (`text/prsp-id` no dataTransfer)
- `prospKanbanDrop(event, novoStatus)` — pega ID, **optimistic UI** (atualiza local + re-render), depois UPDATE no banco; rollback em caso de erro
- Helper `_prospStatusCor(s)` — cores das bordas dos cards

### 44.3 Padrão reusado

Espelhei o `ciKanbanDrop` (Campanhas Internas, linha 22201) — código mais limpo que o do Kanban de Tarefas (que tinha 5 duplicatas de função `drop` resolvidas no ciclo 35).

Difere em 3 pontos:
- DataTransfer key: `text/prsp-id` (vs `text/ci-id`) pra evitar colisão
- Optimistic UI explícito (com rollback)
- Cores das colunas seguem padrão visual da Lista

### 44.4 Filtros e integração

- **Filtro Segmento** (input topbar): aplica em ambas as abas
- **Filtro Status** (select topbar): só visível na Lista — no Kanban as colunas SÃO os status (faria filtragem dupla)
- **Botão "Buscar com IA"**: continua no topo, atualiza `_prspCache` → `prospRender()` → ambas re-renderizam
- Contagem no subtítulo (`prsp-count-sub`): aplicada pela aba ativa

### 44.5 Permissões

Cards são `draggable="true"` apenas se `prospPodeEditar()` retorna true (cargo admin OU permissão `prospeccao_editar`). Drop também valida antes do UPDATE — defesa em camadas.

### 44.6 Activity log

Cada drop com mudança de status loga em `activity_log`:
```js
logActivity('moveu_lead_kanban', `${p.nome}: ${statusAnterior} → ${novoStatus}`, 'prospeccao');
```

### 44.7 Estado dos dados (29/04/2026)

| Status | Qtd |
|---|---|
| novo | 3 |
| contatado | 2 |
| em_negociacao | 0 |
| convertido | 0 |
| descartado | 0 |

Funil ainda está vazio em produção porque a Manu / vendedoras ainda não usaram em escala. Esta UI é parte do incentivo pra adoção.

### 44.8 Próxima onda

**#3 API captura leads + filtros dinâmicos** (8h) ou **#2 Timeline C360** (6h). User decide depois.

---

---

## 45. CICLO 29/04/2026 (NOITE) — ONDA #3: API DE CAPTURA DE LEADS

**Roadmap pós-RD Station:** terceira onda. RD descreve "Webhooks de entrada + API REST + iPaaS". Pra Dana, basta um endpoint POST autenticado com token compartilhado — bem mais simples que RDQL ou OAuth.

### 45.1 Schema atualizado

```sql
ALTER TABLE prospects
  ADD COLUMN origem TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN email TEXT,
  ADD COLUMN dados_extras JSONB DEFAULT '{}'::jsonb;
CREATE INDEX idx_prospects_origem ON prospects(origem);
-- Backfill: leads com ia_insight viraram 'ia_prospectar'
UPDATE prospects SET origem = 'ia_prospectar' WHERE ia_insight IS NOT NULL;
```

Estado pós-migration: 5 leads, todos `ia_prospectar` (eram da função `prospectar`).

### 45.2 Edge function `captura-lead` v1 ACTIVE

**Endpoint:** `POST https://wltmiqbhziefusnzmmkt.supabase.co/functions/v1/captura-lead`

**Auth:** header `X-Capture-Token` deve bater com `CAPTURE_LEAD_TOKEN` (secret do Supabase). Sem token ou errado → 401. Token foi gerado com `secrets.token_urlsafe(32)` e salvo em `.claude/tokens/CAPTURE_LEAD_TOKEN.txt` localmente.

**Body aceito:**
```json
{
  "nome": "Clinica Bem-Vida",          // OBRIGATÓRIO
  "telefone": "47999998888",
  "whatsapp": "47999998888",
  "email": "contato@clinica.com",
  "segmento": "clinicas",
  "cidade": "Balneario Camboriu",
  "estado": "SC",
  "endereco": "...",
  "website": "...",
  "instagram": "@nome",
  "origem": "fb_lead_ads",              // categoriza no funil
  "dados_extras": { "utm_source": "...", "campanha": "..." }
}
```

**Anti-spam básico:**
- Token obrigatório (bloqueia 99% do spam)
- Lead sem nenhum canal de contato (telefone/whatsapp/email/website/instagram) → 400
- Detecção de duplicata por `nome + cidade` → retorna 200 com `duplicado: true` em vez de criar nova

**Side-effects:**
- Cria alerta `lead_novo_externo` em `alertas` (audiência `dados_empresa`) com link pro funil

**Códigos de retorno:**
| Status | Cenário |
|---|---|
| 201 | Lead criado |
| 200 com `duplicado: true` | Já existia |
| 400 | Body inválido / sem canal de contato |
| 401 | Token errado/ausente |
| 500 | Erro interno |

**Validado fim-a-fim** com 4 cenários (token errado, sem canal, lead novo, duplicata) — todos retornaram esperado.

### 45.3 Edge function `get-capture-token` v1 ACTIVE

Pequena função auxiliar pra UI admin revelar o token. Valida JWT do user via `/auth/v1/user` e checa `profiles.cargo === 'admin'`. Sem cargo admin → 403. Retorna `{ token: "..." }` apenas pra admins.

### 45.4 UI Prospecção — filtros novos

Adicionados 2 filtros no topbar (vale pra Lista + Kanban):

- **`prsp-filtro-origem`** — select dinâmico (populado de valores distintos no `_prspCache`). Esconde se cache vazio. Labels emoji: ✍️ Manual, 🤖 IA Prospectar, 📘 FB Lead Ads, 🛒 Shopify, 🌐 Site, 📷 Instagram, 🌐 Externo
- **`prsp-filtro-canal`** — fixo: Qualquer / Tem WhatsApp / Tem email / Sem canal

Função nova `_prospFiltrosCacheFiltrado()` aplica filtros segmento + origem + canal. Reusada por `prospRenderLista` e `prospRenderKanban`.

### 45.5 UI Admin — aba "🎯 Captura de Leads"

Nova aba em `view-admin` (admin only).

**Stats por origem (tabela):**
- Total · Novos · Contatados · Em negociação · Convertidos · % Conversão · Último lead
- Cor do % conversão: verde ≥10%, amarelo ≥3%, cinza <3%

**Endpoint público (card):**
- URL completa
- Token mascarado (`••••••••`) com botões Revelar/Ocultar e Copiar
- Body JSON com todos os campos comentados
- Botão "📋 Copiar exemplo curl" — gera curl completo com token preenchido pra colar em FB Ads/Shopify/Zapier

### 45.6 Edge Functions estado

| Função | Versão | Status |
|---|---|---|
| **captura-lead** | **v1** | **NOVO ciclo 45** |
| **get-capture-token** | **v1** | **NOVO ciclo 45** |
| sync-retry-processor | v2 | (sem mudança) |
| outras 27 | — | sem mudança |

### 45.7 Como integrar (instruções pra Manu)

**FB Lead Ads (via Zapier ou Meta direto):**
1. No formulário, mapeia campos: nome → `nome`, telefone → `telefone`, email → `email`
2. Webhook URL: `https://wltmiqbhziefusnzmmkt.supabase.co/functions/v1/captura-lead`
3. Header: `X-Capture-Token: <token revelado no admin>`
4. Field fixo: `origem: "fb_lead_ads"`
5. Opcional: `dados_extras.campanha` = nome da campanha do FB

**Shopify form:**
- Mesmo endpoint. Origem `shopify_form`.
- Pode usar o app "ShopifyFlow" ou um webhook custom.

**Zapier "make"** ou similar: mesmo padrão. Endpoint + headers + JSON body.

### 45.8 Próxima onda

User decide entre **#2 Timeline C360** (6h, modelagem polimórfica) ou ir direto pra **#4 Resend** (8h, automação email).

---

---

## 46. CICLO 29/04/2026 (NOITE-2) — REVERT PARCIAL DA ONDA #3

**Decisão de produto:** user questionou o valor real do endpoint público pra Dana hoje. Reflexão sincera:
- Vendedora já usa "Buscar com IA" no Prospecção e funciona
- Manu nunca pediu FB Lead Ads / formulário de revendedoras / Zapier
- Endpoint ficaria parado igual a página Vínculos MP→Ficha (ciclo 20.3)

**Aprendizado:** validar com stakeholder ANTES de implementar features que parecem "boa ideia técnica" mas não têm demanda real.

### 46.1 O que foi removido

**Backend (Supabase DMS):**
- ✅ Edge function `captura-lead` v1 → DELETADA
- ✅ Edge function `get-capture-token` v1 → DELETADA
- ✅ Secret `CAPTURE_LEAD_TOKEN` → REMOVIDO

**Frontend:**
- ✅ Aba "🎯 Captura de Leads" em view-admin → REMOVIDA
- ✅ Botão "🧪 Enviar lead de teste" → REMOVIDO
- ✅ Funções JS: `loadOrigensLeads`, `_fetchCaptureToken`, `revelarToken`, `copiarToken`, `enviarLeadDeTeste`, `copiarExemploCurl` → REMOVIDAS (177 linhas)

**Local:**
- ✅ Source TS `.claude/scripts/captura-lead/index.ts` → APAGADO
- ✅ Source TS `.claude/scripts/get-capture-token/index.ts` → APAGADO
- ✅ Deploy scripts `deploy-captura-lead.py` + `deploy-get-capture-token.py` → APAGADOS
- ✅ `.claude/tokens/CAPTURE_LEAD_TOKEN.txt` → APAGADO

### 46.2 O que SOBROU (porque vale a pena)

**Schema:**
- ✅ `prospects.origem` (text, default 'manual')
- ✅ `prospects.email` (text)
- ✅ `prospects.dados_extras` (jsonb)
- ✅ Index `idx_prospects_origem`
- ✅ Backfill: 5 leads existentes marcados como `ia_prospectar`

**Frontend (Prospecção):**
- ✅ Filtro "📍 Origem" no topbar (select dinâmico baseado em valores únicos do cache)
- ✅ Filtro "📱 Canal" (whatsapp / email / sem)
- ✅ Função `_prospFiltrosCacheFiltrado()` reusada por Lista e Kanban
- ✅ Função `_prospAtualizarFiltroOrigem()` popula select dinâmico

Razão: filtros + colunas servem pra ondas futuras (Onda #4 email vai usar `email`; Onda #2 timeline pode usar `origem` pra mostrar de onde veio).

### 46.3 Estado dos dados

```sql
SELECT origem, COUNT(*) FROM prospects GROUP BY origem;
-- ia_prospectar: 5 (todos vieram do botao "Buscar com IA")
```

Quando Manu adicionar novos leads manualmente pelo "+ Adicionar manual" do Prospecção, eles virão com `origem = 'manual'` (default).

### 46.4 Edge Functions estado (após revert)

| Função | Versão | Status |
|---|---|---|
| sync-retry-processor | v2 | (Onda #0) |
| ~~captura-lead~~ | — | **DELETADA** |
| ~~get-capture-token~~ | — | **DELETADA** |
| outras 27 | — | sem mudança |

Total: 28 functions ativas (era 30).

### 46.5 Próxima onda

User decide qual fazer:
- **#2 Timeline unificada do C360** (6h) — modelagem polimórfica de eventos
- **#4 Resend + automação email** (8h) — campanhas usando o `prospects.email` que sobrou

---

---

## 47. CICLO 29/04/2026 (NOITE-3) — ONDA #2: TIMELINE UNIFICADA DO C360

**Roadmap pós-RD Station:** quarta onda implementada. RD destacou "Timeline polimórfica" como o coração do "histórico 360°". Pra Dana basta uma VIEW agregadora — sem tabela física, sem triggers, sem backfill.

### 47.1 Decisão de arquitetura

**VIEW agregadora vs tabela física com triggers:**
- Tabela + triggers: complexo (precisa de DDL em 4 tabelas, backfill, manter consistência)
- VIEW: filtra `?contato_nome=eq.X` na hora, Postgres empurra o filtro pra cada UNION

Escolhido **VIEW** porque:
- Volume Dana (~50k pedidos, ~6k contas, etc) é pequeno o suficiente
- Filtro por contato_nome com indexes é rápido (<100ms)
- Zero risco de inconsistência (lê direto da fonte)
- Reverter é trivial: `DROP VIEW`

### 47.2 SQL aplicado

**Indexes adicionados (faltavam):**
```sql
CREATE INDEX idx_pedidos_contato_nome ON pedidos(contato_nome);
CREATE INDEX idx_contas_receber_contato_nome ON contas_receber(contato_nome);
-- cliente_notas e cliente_insights ja tinham
```

**VIEW `cliente_eventos_timeline`:**
```sql
CREATE OR REPLACE VIEW cliente_eventos_timeline AS
SELECT contato_nome, data_evento, tipo, titulo, descricao, dados, empresa FROM (
  -- Pedidos
  SELECT contato_nome, data::timestamptz AS data_evento, 'pedido'::text AS tipo,
         'Pedido #' || numero AS titulo,
         'Total: R$ ' || COALESCE(total, 0)::text AS descricao,
         jsonb_build_object(...) AS dados, empresa
  FROM pedidos WHERE data IS NOT NULL AND contato_nome IS NOT NULL
  UNION ALL
  -- Contas a receber (pagamento se situacao=2, cobranca caso contrario)
  SELECT contato_nome, COALESCE(vencimento, data_emissao)::timestamptz, ...
  FROM contas_receber WHERE COALESCE(vencimento, data_emissao) IS NOT NULL
  UNION ALL
  -- Notas
  SELECT contato_nome, created_at, 'nota'::text, ...
  FROM cliente_notas WHERE contato_nome IS NOT NULL
  UNION ALL
  -- Insights IA
  SELECT contato_nome, created_at, 'insight'::text, ...
  FROM cliente_insights WHERE contato_nome IS NOT NULL
) t ORDER BY data_evento DESC;
```

5 tipos de evento: `pedido`, `pagamento`, `cobranca`, `nota`, `insight`. Alertas não foram incluídos (mais ruído que valor — alertas no DMS são por destinatário, não por cliente).

### 47.3 Frontend — `cliente-360-boot.js`

**Aba "📜 Timeline" adicionada:**
- Posição: depois de Pedidos, antes de Insights IA + Notas
- Container `c360-tabpanel-timeline` (display:none por padrão)
- `c360SwitchTab` agora dispatcha pra `loadTimeline()` na primeira vez que abre a aba (lazy)

**`loadTimeline(force)`** (window-scoped):
- Lê `state.currentContatoNome` (setado em `showClientDetail`)
- `SELECT * FROM cliente_eventos_timeline WHERE contato_nome = ?` LIMIT 500
- Cache em `window._c360TimelineCache`, flag `_c360TimelineLoaded`
- Reset ao trocar de cliente

**`_renderTimeline(eventos)`:**
- Agrupa por dia (yyyy-mm-dd)
- Cada dia tem header relativo ("Hoje · 14:32" / "Ontem" / "3 dias atrás" / "2 sem atrás" / "23 abr 2026")
- Cada evento: ícone colorido por tipo + título + descrição truncada + hora à direita
- Bordas coloridas por tipo (azul/verde/laranja/roxo/rosa)

**Filtros:** 6 chips no topo da aba (Tudo / Pedidos / Pagamentos / Cobranças / Notas / Insights). Filtro client-side (cache local), zero round-trip.

### 47.4 Validação

Cliente teste: **QUANTITY SERVICOS** (744 pedidos). View retornou em <100ms com mistura de pedidos + cobranças + pagamentos:

```
2026-04-24  cobranca   Conta a vencer R$ 12876.00
2026-04-23  pedido     Pedido #48214
2026-04-02  pagamento  Pagou R$ 10521.00
2026-04-01  pedido     Pedido #47904
2026-03-16  pagamento  Pagou R$ 4956.00
...
```

### 47.5 Estado dos dados

| Fonte | Rows totais | Acessível via timeline? |
|---|---|---|
| pedidos | ~52.500 | ✅ |
| contas_receber | ~7.800 | ✅ (pagamento + cobrança) |
| cliente_notas | (variável) | ✅ |
| cliente_insights | (variável) | ✅ |
| alertas | ~ | ❌ (excluído por design) |

### 47.6 Edge functions estado (sem mudanças)

Onda #2 é puro SQL + frontend, sem novas edge functions. Total continua 28.

### 47.7 Próxima onda

**#4 Resend + automação email** (6-8h) — só se Manu validar interesse em email marketing.
Caso contrário: roadmap RD Station considera-se concluído com #0, #1, #2 (e schema/filtros da #3).

---

---

## 48. CICLO 30/04/2026 — DARK MODE NO DMS (sem sidebar, sem C360)

**Pedido do user:** modo escuro pras seções, mantendo sidebar (preta) e Cliente 360 (visual próprio) inalterados. Botão toggle ao lado do filtro de empresa.

### 48.1 Estratégia técnica

**Mecanismo:** atributo `data-theme="dark"` no `<html>` (anti-flash) + override de variáveis CSS escopadas em `.main` e `.topbar` apenas.

**Por que funciona com pouco código:** as ~80 ocorrências de `var(--white)` e maioria dos `var(--surface)/--bg/--text*` herdam automaticamente as novas vars. Não precisou editar caso a caso.

**Tratamento especial de `var(--black)`:** usada em 137 lugares pra TEXTO e ~5 pra BACKGROUND. Sobrescrita no dark pra `#f2f2f2` (texto claro), com regras específicas restaurando #0a0a0a só pros backgrounds (`.btn-primary`, `.tl-dot.done`, `.check-item.done .check-box`).

### 48.2 Paleta dark aplicada

| Var | Light | Dark |
|---|---|---|
| `--white` | #ffffff | #1a1a1a |
| `--bg` | #f5f5f5 | #0f0f0f |
| `--surface` | #ffffff | #1a1a1a |
| `--surface2` | #fafafa | #222222 |
| `--surface3` | #f5f5f5 | #2a2a2a |
| `--border` | #e2e2e2 | #2e2e2e |
| `--text` | #0a0a0a | #f2f2f2 |
| `--text2` | #3d3d3d | #c8c8c8 |
| `--text3` | #777777 | #999999 |
| `--black` (dentro de .main) | #0a0a0a | #f2f2f2 |
| `color-scheme` | light | dark |

Cores semânticas (`--green/--red/--amber/--blue`) mantém em ambos os temas.

### 48.3 Escopo do override

```
html[data-theme="dark"] .main, html[data-theme="dark"] .topbar { ... vars ... }
html[data-theme="dark"] #view-cliente360 { ... vars do light ... }   /* reset */
html[data-theme="dark"] .kpi-card.dark { ... neutraliza ... }         /* não duplo-dark */
```

`.sidebar` é IRMÃ de `.main` — nunca recebe override → permanece preta.

`#view-cliente360` recebe reset que volta às vars do light → mantém visual próprio (oklch e cores específicas do design original do C360).

### 48.4 Anti-flash

Script inline no `<head>` (ANTES de qualquer CSS render):
```js
(function(){ try { var t=localStorage.getItem('dms_theme')||'light';
  document.documentElement.setAttribute('data-theme',t); } catch(e){} })();
```

Setta o atributo em `<html>` antes do CSS carregar → zero flicker no F5.

### 48.5 Botão toggle

- Local: dentro da topbar, ANTES de `#empresa-btn`
- Ícone: 🌙 (light, indica "clica pra escurecer") / ☀️ (dark, "clica pra clarear")
- Função `toggleTheme()` alterna data-theme em `<html>` + persiste em `localStorage('dms_theme')`
- Função `applyTheme(t)` atualiza ícone + tooltip do botão

### 48.6 Migração de literais inline (~10 conversões)

Convertidos pra `var()`:
- `.topbar { background: white }` → `var(--white)` (estava bloqueando o dark da topbar!)
- `.tl-dot.done .tl-inner`, `.roi-field:focus`, `.p-real-stat`, `.est-var-label` → `var(--white)`
- AI chat panel completo (`#ai-chat-panel`, `.ai-sug`, `.ai-msg.ai .ai-bubble`, `.ai-chat-footer`, `#ai-chat-input:focus`) → `var(--white)` + `var(--text)` + `var(--border)`
- 3 inline `background:white` em criativos/reels/alerta → `var(--white)`

NÃO convertidos (intencionais):
- `.p-ranking-bar-fill` (barra de progresso branca por design)
- Color picker visual (`background:#fff` mostrando a cor branca em si)
- Relatório PDF (visual fixo independente do tema)
- Cores de marca (#2563eb azul Matriz, #15803d verde BC, gradientes)
- Bubble do user no AI chat (#0f172a) — sempre dark, OK em ambos

### 48.7 Reversibilidade

- `localStorage.removeItem('dms_theme')` no console → volta pra light
- Toggle desaparece com 1 commit revert se necessário
- Light mode 100% preservado (todas regras escopadas em `[data-theme="dark"]`)

### 48.8 Arquivos tocados

`index.html` apenas. Sem mudança em:
- `cliente-360.html`, `cliente-360-boot.js`
- Edge functions
- Banco
- `vercel.json`

### 48.9 Próximo passo (opcional)

Testar visualmente seções menos visitadas (Estúdio IA, Construtor Campanhas, Briefing Visual, etc) e ajustar literais hardcoded que aparecerem com texto invisível ou cores estranhas.

---

**Fim da documentação · Atualizado em 30/04/2026 — ciclo 48 (Dark Mode) · v5.2**
