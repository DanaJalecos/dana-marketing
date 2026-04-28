-- ══════════════════════════════════════════════════════════
-- Adiciona vendedor_id e vendedor_nome na tabela pedidos
--
-- Motivo: a Dana tem um vendedor chamado "SITE" no Bling que marca
-- os pedidos vindos do e-commerce real (checkout automatizado).
-- Sem esse campo, não dá pra separar vendas B2C do site de vendas
-- B2B/manuais lançadas no Bling (que ficam com loja_id=0 junto).
--
-- Depois de rodar este SQL:
-- 1. Redeployar sync-pedidos-itens.ts e sync-pedidos-itens-backfill.ts
--    (elas foram atualizadas pra gravar vendedor no mesmo loop)
-- 2. Esperar o backfill rodar (já tá rodando a cada 15min ou manual)
-- 3. Frontend da aba E-commerce passa a filtrar por vendedor_nome='SITE'
-- ══════════════════════════════════════════════════════════

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS vendedor_id bigint,
  ADD COLUMN IF NOT EXISTS vendedor_nome text;

-- Index pra filtros rápidos por vendedor
CREATE INDEX IF NOT EXISTS idx_pedidos_vendedor_id   ON public.pedidos(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_vendedor_nome ON public.pedidos(vendedor_nome);

-- Verificação
SELECT COUNT(*) AS total,
       COUNT(vendedor_id) AS com_vendedor,
       COUNT(*) FILTER (WHERE vendedor_nome IS NOT NULL) AS com_nome
FROM public.pedidos;
