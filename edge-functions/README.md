# Edge Functions — Dana Marketing System

## Funções de Sincronização do Bling (NOVAS — divididas)

Cada uma roda rápido (< 60s) e sincroniza apenas UMA tabela.

| Arquivo | Endpoint | Função | Duração |
|---------|----------|--------|---------|
| `sync-pedidos.ts` | `/functions/v1/sync-pedidos` | Pedidos (últimos 7 dias) | ~15-25s |
| `sync-contas-receber.ts` | `/functions/v1/sync-contas-receber` | Contas a receber (todas situações) | ~40-50s |
| `sync-contas-pagar.ts` | `/functions/v1/sync-contas-pagar` | Contas a pagar (todas situações) | ~40-50s |
| `sync-produtos.ts` | `/functions/v1/sync-produtos` | Produtos ativos (até 5000) | ~25-35s |
| `sync-contatos.ts` | `/functions/v1/sync-contatos` | Contatos (últimos 1000) | ~15-20s |

## Outras Edge Functions

| Arquivo | Função |
|---------|--------|
| `sync-pedidos-itens.ts` | Puxa ITENS de cada pedido (para "Top Produtos") |
| `criar-usuario.ts` | Admin cria novo usuário pelo painel |
| `news-search.ts` | Busca notícias do Google News |
| `google-suggest.ts` | Palavras-chave — proxy Google Suggest |
| `google-trends.ts` | Palavras-chave — proxy Google Trends |

## Pasta `antigas/`

Código antigo que foi substituído. Mantido só como backup.
- `sync-bling.ts` — função monolítica que fazia tudo (substituída pelas 5 novas)

## Como deployar

1. Abra Supabase > Edge Functions
2. Para cada arquivo, crie uma função com o MESMO NOME do arquivo (sem `.ts`)
3. Cole o conteúdo e salve
4. Rode o SQL em `../sql-scripts/sql-cron-sync-split.sql` para configurar os cron jobs
