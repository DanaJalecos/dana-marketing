-- ════════════════════════════════════════════════════════════════════════════
-- BLING SYNC v3 — FUNDAÇÃO (LOTE 1 / DIA 1)
-- Pedido pelo Finance AI em `Ideias Projeto/Finance AI/04-PEDIDO-PRO-DMS-SYNC-BLING.md`
-- Aceite mútuo em `05` → `06` → `07-RESPOSTA-DMS-LOTE1-START.md`
-- Data: 2026-05-26
--
-- Esse script cria:
-- 1. Tabela bling_sync_log (observability — toda Edge function escreve aqui)
-- 2. Índices pra leitura rápida
-- 3. RLS: service_role full, authenticated read-only (Finance AI consome)
-- 4. View bling_sync_health (1 row por tabela+loja com último status + saúde)
-- 5. REVOKE anon + GRANT authenticated na view
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Tabela bling_sync_log ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bling_sync_log (
  id              bigserial PRIMARY KEY,
  tabela          text        NOT NULL,           -- ex: 'bling_nfe_entrada' ou 'oauth_refresh'
  loja_id         int         NOT NULL,           -- 203536978 Matriz | 203550865 BC
  iniciado_em     timestamptz NOT NULL DEFAULT NOW(),
  finalizado_em   timestamptz,
  duracao_ms      int,
  qtd_lidos       int         DEFAULT 0,          -- itens vindos da API
  qtd_inseridos   int         DEFAULT 0,
  qtd_atualizados int         DEFAULT 0,
  qtd_erros       int         DEFAULT 0,
  desde           timestamptz,                    -- janela de sync incremental
  ate             timestamptz,
  status          text        NOT NULL DEFAULT 'rodando',
  -- valores possíveis: 'rodando' | 'ok' | 'erro' | 'parcial' | 'rate_limited'
  erro_tipo       text,                           -- 'rate_limit' | 'auth' | 'http_5xx' | 'parse' | 'db'
  erro_msg        text,                           -- mensagem curta (SEM payload/token)
  api_calls       int         DEFAULT 0,          -- requests Bling executadas
  CONSTRAINT bling_sync_log_status_valid CHECK (
    status IN ('rodando','ok','erro','parcial','rate_limited')
  )
);

-- ── 2. Índices ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_bling_sync_log_tabela_iniciado
  ON public.bling_sync_log (tabela, iniciado_em DESC);

CREATE INDEX IF NOT EXISTS idx_bling_sync_log_loja_iniciado
  ON public.bling_sync_log (loja_id, iniciado_em DESC);

CREATE INDEX IF NOT EXISTS idx_bling_sync_log_status_alerta
  ON public.bling_sync_log (status) WHERE status != 'ok';

-- ── 3. RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.bling_sync_log ENABLE ROW LEVEL SECURITY;

-- service_role: ALL (edges escrevem o log)
DROP POLICY IF EXISTS bling_sync_log_service_all ON public.bling_sync_log;
CREATE POLICY bling_sync_log_service_all
  ON public.bling_sync_log FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- authenticated: SELECT (Finance AI consome via /visao widget)
DROP POLICY IF EXISTS bling_sync_log_auth_sel ON public.bling_sync_log;
CREATE POLICY bling_sync_log_auth_sel
  ON public.bling_sync_log FOR SELECT TO authenticated
  USING (true);

-- anon: bloqueado por padrão (sem policy = sem acesso)

-- ── 4. View bling_sync_health ──────────────────────────────────────────────
-- 1 linha por (tabela, loja_id) com último estado + saúde derivada
DROP VIEW IF EXISTS public.bling_sync_health;
CREATE VIEW public.bling_sync_health AS
WITH latest AS (
  SELECT DISTINCT ON (tabela, loja_id)
    tabela,
    loja_id,
    status,
    iniciado_em,
    finalizado_em,
    duracao_ms,
    qtd_lidos,
    qtd_inseridos,
    qtd_atualizados,
    qtd_erros,
    erro_tipo,
    erro_msg,
    api_calls
  FROM public.bling_sync_log
  ORDER BY tabela, loja_id, iniciado_em DESC
)
SELECT
  tabela,
  loja_id,
  status AS ultimo_status,
  iniciado_em AS ultima_execucao,
  finalizado_em,
  duracao_ms,
  ROUND(EXTRACT(EPOCH FROM (NOW() - iniciado_em)) / 60.0, 1) AS minutos_desde_ultima,
  qtd_lidos,
  qtd_inseridos,
  qtd_atualizados,
  qtd_erros,
  erro_tipo,
  erro_msg,
  api_calls,
  -- Saúde derivada
  CASE
    WHEN status = 'erro' THEN 'erro'
    WHEN status = 'rate_limited' THEN 'rate_limited'
    WHEN EXTRACT(EPOCH FROM (NOW() - iniciado_em)) / 60.0 > 180 THEN 'atrasado'
    WHEN qtd_erros > 0 THEN 'parcial'
    WHEN status = 'rodando' AND EXTRACT(EPOCH FROM (NOW() - iniciado_em)) / 60.0 > 30 THEN 'travado'
    ELSE 'ok'
  END AS saude
FROM latest;

COMMENT ON VIEW public.bling_sync_health IS
'1 linha por (tabela, loja_id) com último status do sync Bling + saúde derivada (ok/erro/atrasado/parcial/rate_limited/travado). Consumida pelo widget Saúde Bling no Finance AI /visao.';

-- ── 5. View: REVOKE anon, GRANT authenticated (e service_role implícito) ───
REVOKE ALL  ON public.bling_sync_health FROM anon, public;
GRANT SELECT ON public.bling_sync_health TO authenticated;
GRANT SELECT ON public.bling_sync_health TO service_role;

-- ── 6. Limpeza automática: TRUNCATE logs > 90 dias ─────────────────────────
-- Cron diário às 04:00 BRT (07:00 UTC). NÃO ATIVAR ainda (Dia 1 só estrutura).
-- Vai ser criado no Dia 2 junto com os outros crons.
--
-- SELECT cron.schedule('bling-log-cleanup-diario', '0 7 * * *', $$
--   DELETE FROM public.bling_sync_log WHERE iniciado_em < NOW() - INTERVAL '90 days';
-- $$);

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- SMOKE TEST (rodar manualmente após o COMMIT pra validar)
-- ════════════════════════════════════════════════════════════════════════════
-- 1) Insert dummy (deve passar com service_role):
--    INSERT INTO bling_sync_log (tabela, loja_id, status, qtd_lidos)
--    VALUES ('_smoke_test', 203536978, 'ok', 0);
--
-- 2) Anon NÃO lê (deve retornar []):
--    curl -H "apikey: <ANON>" https://wltmiqbhziefusnzmmkt.supabase.co/rest/v1/bling_sync_log
--
-- 3) Authenticated lê (deve retornar a linha):
--    SELECT * FROM bling_sync_log WHERE tabela = '_smoke_test';
--
-- 4) View funciona:
--    SELECT * FROM bling_sync_health WHERE tabela = '_smoke_test';
--    → saude deve estar 'ok'
--
-- 5) Limpa smoke test:
--    DELETE FROM bling_sync_log WHERE tabela = '_smoke_test';
-- ════════════════════════════════════════════════════════════════════════════
