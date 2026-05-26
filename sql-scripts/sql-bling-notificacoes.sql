-- ════════════════════════════════════════════════════════════════════════════
-- BLING LOTE 3 — bling_notificacoes (avisos Bling)
-- GET /notificacoes — alertas que aparecem no sino do Bling
-- Pra que serve: Renato/Márcia veem NF rejeitada, certificado vencendo, etc
-- Volume: ~5/dia. Cron 30min.
-- IDs vêm como ULID/string — guardar como text.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.bling_notificacoes (
  id_bling      text          PRIMARY KEY,
  loja_id       int           NOT NULL,
  tipo          text,                                    -- ex: 'nfe_rejeitada', 'certificado_vencendo'
  titulo        text,
  mensagem      text,
  prioridade    text,                                    -- 'alta', 'media', 'baixa'
  lida          boolean       DEFAULT false,
  data          timestamptz,
  url           text,                                    -- link Bling pra ação
  raw           jsonb         NOT NULL,
  synced_at     timestamptz   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bnot_loja_data       ON public.bling_notificacoes (loja_id, data DESC);
CREATE INDEX IF NOT EXISTS idx_bnot_nao_lidas       ON public.bling_notificacoes (loja_id) WHERE lida = false;
CREATE INDEX IF NOT EXISTS idx_bnot_alta            ON public.bling_notificacoes (loja_id, data DESC) WHERE prioridade = 'alta';
CREATE INDEX IF NOT EXISTS idx_bnot_tipo            ON public.bling_notificacoes (tipo);

ALTER TABLE public.bling_notificacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bnot_service_all ON public.bling_notificacoes;
CREATE POLICY bnot_service_all ON public.bling_notificacoes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bnot_auth_sel ON public.bling_notificacoes;
CREATE POLICY bnot_auth_sel ON public.bling_notificacoes
  FOR SELECT TO authenticated USING (true);

COMMIT;
