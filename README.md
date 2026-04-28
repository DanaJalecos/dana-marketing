# Dana Marketing System (DMS)

Sistema interno de gestão de marketing, vendas e CRM da **Dana Jalecos Exclusivos**.

## Stack

- **Frontend**: SPA estática em HTML+JS+CSS inline (`index.html`, `cliente-360.html`, `cliente-360-boot.js`)
- **Backend**: Supabase (PostgreSQL + Auth + Storage + Realtime + Edge Functions Deno)
- **ERP integrado**: Bling v3 (OAuth2 read-only)
- **IA**: Groq Llama 3.3 (free) + Gemini 2.5 Flash (rotação de keys via `gemini-proxy`) + ImgBB
- **Deploy**: Vercel (este repo)

## Estrutura

```
.
├── index.html              # App principal (SPA, ~14k linhas)
├── cliente-360.html        # Página standalone do C360
├── cliente-360-boot.js     # Lógica do C360 (chat, scoring, insights)
├── assets/                 # Logos + fontes
├── docs/                   # Guias internos
├── edge-functions/         # Source TS das edge functions Supabase
├── sql-scripts/            # DDL/migrações SQL
├── supabase-setup.sql      # Setup inicial (auth + tabelas base)
├── sync-completo.js        # Helper de sync manual
├── generate-sql.js         # Helper geração SQL
└── DOCUMENTACAO-COMPLETA-DMS.md   # Doc completa do sistema
```

## Documentação

A documentação completa do sistema está em [`DOCUMENTACAO-COMPLETA-DMS.md`](./DOCUMENTACAO-COMPLETA-DMS.md). Cobre arquitetura, schema, edge functions, fluxos de IA, permissões e histórico de mudanças por ciclo.

## Deploy local

Site estático puro — qualquer servidor HTTP serve. Pra rodar localmente:

```bash
python -m http.server 8080
# abrir http://localhost:8080
```

## Deploy Vercel

Conecta o repo ao Vercel e faz deploy automático em qualquer push pra `main`. Sem build step (HTML estático).

## Credenciais necessárias (já configuradas no Supabase, não no repo)

- `BLING_CLIENT_ID` / `BLING_CLIENT_SECRET` — OAuth Bling
- `GROQ_API_KEY` — Groq
- `GEMINI_API_KEY` + `_KEY_2` + `_KEY_3` + `_KEY_PAID` — Gemini (rotação no proxy)
- `GEMINI_IMAGE_API_KEY` — Gemini Image (paga, exclusiva pra geração)
- `IMGBB_API_KEY` — Hosting de imagens IA

Nenhuma credencial é exposta no frontend além da `SUPABASE_ANON_KEY` (pública por design).

## Empresa

- **Dana Jalecos Exclusivos** — Piçarras SC + Balneário Camboriú SC
- Site público: https://danajalecos.com.br
- Repo Estoque (sistema separado): https://github.com/DanaJalecos/estoque
