-- ════════════════════════════════════════════════════════════════════════════
-- Compact/24: Revalidate pedidos por id + catálogo bling_situacoes
-- Parte 1: revalidated_at em public.pedidos
-- Parte 2: catálogo bling_situacoes (Vendas módulo Bling)
--
-- Descoberta sync: na matriz, IDs herdam de bases (idHerdado):
--   9 (Atendido)/12 (Cancelado) = únicos terminais
--   35734=Costura (idHerdado=6 Em aberto), 35736=Bordado 2 (idem),
--   35737=Finalização (idem) — NÃO são Atendido como o FAI achava
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ───────── Parte 1: revalidated_at em pedidos ─────────
ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS revalidated_at timestamptz;

-- Index pra ORDER BY revalidated_at NULLS FIRST filtrado pra não-terminal
-- e janela 180d (pedidos antigos abandonados ignorados)
CREATE INDEX IF NOT EXISTS idx_pedidos_revalidate
  ON public.pedidos (empresa, revalidated_at NULLS FIRST, id)
  WHERE situacao_id NOT IN (9, 12);

-- ───────── Parte 2: catálogo bling_situacoes ─────────
CREATE TABLE IF NOT EXISTS public.bling_situacoes (
  id_bling      bigint        NOT NULL,
  loja_id       int           NOT NULL,
  empresa       text          NOT NULL,                  -- 'matriz' | 'bc'
  modulo_id     bigint        NOT NULL,                  -- 98310 = Vendas matriz
  modulo_nome   text          NOT NULL,                  -- 'Vendas', 'PedidosCompra', etc
  nome          text          NOT NULL,
  cor           text,
  id_herdado    bigint        DEFAULT 0,                 -- 0 = base; outro = situacao base herdada
  -- terminal calculado: id herdou de 9/12 OU é própria 9/12
  terminal      boolean       GENERATED ALWAYS AS (
    id_bling IN (9, 12) OR id_herdado IN (9, 12)
  ) STORED,
  raw           jsonb         NOT NULL,
  synced_at     timestamptz   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_bling, modulo_id, empresa)
);

CREATE INDEX IF NOT EXISTS idx_bsit_empresa_modulo
  ON public.bling_situacoes (empresa, modulo_id);
CREATE INDEX IF NOT EXISTS idx_bsit_terminal
  ON public.bling_situacoes (empresa, terminal);

ALTER TABLE public.bling_situacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bsit_service_all ON public.bling_situacoes;
CREATE POLICY bsit_service_all ON public.bling_situacoes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bsit_auth_sel ON public.bling_situacoes;
CREATE POLICY bsit_auth_sel ON public.bling_situacoes
  FOR SELECT TO authenticated USING (true);

COMMIT;
