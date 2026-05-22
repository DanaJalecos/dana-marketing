-- ════════════════════════════════════════════════════════════════════════════
-- SECURITY HARDENING — 2026-05-22
-- Pentest report do Manus AI flagrou exposição total via anon key.
-- Verificado: 10+ tabelas com policies anon/public abertas, 13 tabelas sem RLS.
--
-- Estratégia: fechar tudo pra anon. Quem precisa ler = authenticated.
-- Crons/edges usam SERVICE_ROLE (bypassa RLS) — sem impacto.
-- Front DMS sempre loga antes de query → JWT vira authenticated → continua OK.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── FASE 1: DROP de todas as policies abertas pra anon/public (qual=true) ──

-- SELECT pra anon (dados criticos)
DROP POLICY IF EXISTS "read_contas_pagar"   ON public.contas_pagar;
DROP POLICY IF EXISTS "read_contas_receber" ON public.contas_receber;
DROP POLICY IF EXISTS "read_contatos"       ON public.contatos;
DROP POLICY IF EXISTS "read_depositos"      ON public.depositos;
DROP POLICY IF EXISTS "read_pedidos"        ON public.pedidos;
DROP POLICY IF EXISTS "read_produtos"       ON public.produtos;
DROP POLICY IF EXISTS "read_resumo"         ON public.resumo_mensal;
DROP POLICY IF EXISTS "read_vendedores"     ON public.vendedores;

-- TAREFAS — CRUD inteiro aberto pra anon (bug grave)
DROP POLICY IF EXISTS "read_tarefas"   ON public.tarefas;
DROP POLICY IF EXISTS "write_tarefas"  ON public.tarefas;
DROP POLICY IF EXISTS "update_tarefas" ON public.tarefas;
DROP POLICY IF EXISTS "delete_tarefas" ON public.tarefas;
DROP POLICY IF EXISTS "tarefas_read"   ON public.tarefas;  -- public qual=true
DROP POLICY IF EXISTS "tarefas_write"  ON public.tarefas;  -- public ALL qual=true

-- CALENDARIO — mesma coisa
DROP POLICY IF EXISTS "read_calendario"   ON public.calendario;
DROP POLICY IF EXISTS "write_calendario"  ON public.calendario;
DROP POLICY IF EXISTS "update_calendario" ON public.calendario;
DROP POLICY IF EXISTS "delete_calendario" ON public.calendario;
DROP POLICY IF EXISTS "calendario_read"   ON public.calendario;
DROP POLICY IF EXISTS "calendario_write"  ON public.calendario;

-- PUBLIC SELECT/ALL qual=true (qualquer um lê/escreve)
DROP POLICY IF EXISTS "write_all_brandkit"        ON public.brandkit_itens;
DROP POLICY IF EXISTS "read_all_brandkit"         ON public.brandkit_itens;
DROP POLICY IF EXISTS "write_all_briefings"       ON public.briefings_campanha;
DROP POLICY IF EXISTS "read_all_briefings"        ON public.briefings_campanha;
DROP POLICY IF EXISTS "write_all_canais"          ON public.canais_aquisicao;
DROP POLICY IF EXISTS "read_all_canais"           ON public.canais_aquisicao;
DROP POLICY IF EXISTS "cs_hist_select"            ON public.cliente_status_historico;
DROP POLICY IF EXISTS "write_all_concorrentes"    ON public.concorrentes;
DROP POLICY IF EXISTS "read_all_concorrentes"     ON public.concorrentes;
DROP POLICY IF EXISTS "write_all_criativos"       ON public.criativos;
DROP POLICY IF EXISTS "read_all_criativos"        ON public.criativos;
DROP POLICY IF EXISTS "write_all_infl"            ON public.influenciadores;
DROP POLICY IF EXISTS "read_all_infl"             ON public.influenciadores;
DROP POLICY IF EXISTS "kanban_colunas_write"      ON public.kanban_colunas;
DROP POLICY IF EXISTS "kanban_colunas_read"       ON public.kanban_colunas;
DROP POLICY IF EXISTS "write_all_materiais"       ON public.materiais_briefing;
DROP POLICY IF EXISTS "read_all_materiais"        ON public.materiais_briefing;
DROP POLICY IF EXISTS "pedidos_itens_write"       ON public.pedidos_itens;
DROP POLICY IF EXISTS "pedidos_itens_read"        ON public.pedidos_itens;
DROP POLICY IF EXISTS "produtos_custos_select"    ON public.produtos_custos;
DROP POLICY IF EXISTS "prospeccao_config_read_all" ON public.prospeccao_config;
DROP POLICY IF EXISTS "write_all_ref"             ON public.referencias_conteudo;
DROP POLICY IF EXISTS "read_all_ref"              ON public.referencias_conteudo;
DROP POLICY IF EXISTS "read_all_revendas"         ON public.revendas_parceiros;
DROP POLICY IF EXISTS "sync_log_write"            ON public.sync_log;
DROP POLICY IF EXISTS "sync_log_read"             ON public.sync_log;

-- ── FASE 2: CRIAR policies authenticated equivalentes onde faltar ──
-- (algumas tabelas já tinham *_auth, mas tarefas/calendario/etc só tinham anon — preciso criar)

-- TAREFAS: authenticated CRUD
CREATE POLICY "tarefas_sel_auth" ON public.tarefas FOR SELECT TO authenticated USING (true);
CREATE POLICY "tarefas_ins_auth" ON public.tarefas FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "tarefas_upd_auth" ON public.tarefas FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "tarefas_del_auth" ON public.tarefas FOR DELETE TO authenticated USING (true);

-- CALENDARIO: authenticated CRUD
CREATE POLICY "calendario_sel_auth" ON public.calendario FOR SELECT TO authenticated USING (true);
CREATE POLICY "calendario_ins_auth" ON public.calendario FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "calendario_upd_auth" ON public.calendario FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "calendario_del_auth" ON public.calendario FOR DELETE TO authenticated USING (true);

-- Demais que só tinham public (read+write) → recria pra authenticated
CREATE POLICY "brandkit_sel_auth"        ON public.brandkit_itens        FOR SELECT TO authenticated USING (true);
CREATE POLICY "brandkit_all_auth"        ON public.brandkit_itens        FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "briefings_sel_auth"       ON public.briefings_campanha    FOR SELECT TO authenticated USING (true);
CREATE POLICY "briefings_all_auth"       ON public.briefings_campanha    FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "canais_sel_auth"          ON public.canais_aquisicao      FOR SELECT TO authenticated USING (true);
CREATE POLICY "canais_all_auth"          ON public.canais_aquisicao      FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "cs_hist_sel_auth"         ON public.cliente_status_historico FOR SELECT TO authenticated USING (true);
CREATE POLICY "concorrentes_sel_auth"    ON public.concorrentes          FOR SELECT TO authenticated USING (true);
CREATE POLICY "concorrentes_all_auth"    ON public.concorrentes          FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "criativos_sel_auth"       ON public.criativos             FOR SELECT TO authenticated USING (true);
CREATE POLICY "criativos_all_auth"       ON public.criativos             FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "infl_sel_auth"            ON public.influenciadores       FOR SELECT TO authenticated USING (true);
CREATE POLICY "infl_all_auth"            ON public.influenciadores       FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "kanban_sel_auth"          ON public.kanban_colunas        FOR SELECT TO authenticated USING (true);
CREATE POLICY "kanban_all_auth"          ON public.kanban_colunas        FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "materiais_sel_auth"       ON public.materiais_briefing    FOR SELECT TO authenticated USING (true);
CREATE POLICY "materiais_all_auth"       ON public.materiais_briefing    FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "pedidos_itens_sel_auth"   ON public.pedidos_itens         FOR SELECT TO authenticated USING (true);
CREATE POLICY "pedidos_itens_all_auth"   ON public.pedidos_itens         FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "produtos_custos_sel_auth" ON public.produtos_custos       FOR SELECT TO authenticated USING (true);
CREATE POLICY "prospec_cfg_sel_auth"     ON public.prospeccao_config     FOR SELECT TO authenticated USING (true);
CREATE POLICY "ref_sel_auth"             ON public.referencias_conteudo  FOR SELECT TO authenticated USING (true);
CREATE POLICY "ref_all_auth"             ON public.referencias_conteudo  FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "revendas_sel_auth"        ON public.revendas_parceiros    FOR SELECT TO authenticated USING (true);
CREATE POLICY "sync_log_sel_auth"        ON public.sync_log              FOR SELECT TO authenticated USING (true);
-- sync_log_write fica restrito ao service_role (edges) e admin futuro

CREATE POLICY "resumo_sel_auth"          ON public.resumo_mensal         FOR SELECT TO authenticated USING (true);

-- ── FASE 3: HABILITAR RLS nas 13 tabelas que estavam NUAS ──

ALTER TABLE public.email_config                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.magazord_atendimentos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.magazord_avaliacoes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.magazord_contas_receber         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.magazord_cupons                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.magazord_estoque_movimentacoes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.magazord_newsletter             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.magazord_notas_fiscais          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.magazord_pedido_detalhe         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.magazord_pedido_payments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produtos_mix                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_failures                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_job_routes                 ENABLE ROW LEVEL SECURITY;

-- Policies SELECT authenticated em cada uma
CREATE POLICY "email_config_sel_auth"          ON public.email_config                   FOR SELECT TO authenticated USING (true);
CREATE POLICY "mzd_atend_sel_auth"             ON public.magazord_atendimentos          FOR SELECT TO authenticated USING (true);
CREATE POLICY "mzd_aval_sel_auth"              ON public.magazord_avaliacoes            FOR SELECT TO authenticated USING (true);
CREATE POLICY "mzd_cr_sel_auth"                ON public.magazord_contas_receber        FOR SELECT TO authenticated USING (true);
CREATE POLICY "mzd_cup_sel_auth"               ON public.magazord_cupons                FOR SELECT TO authenticated USING (true);
CREATE POLICY "mzd_estmov_sel_auth"            ON public.magazord_estoque_movimentacoes FOR SELECT TO authenticated USING (true);
CREATE POLICY "mzd_news_sel_auth"              ON public.magazord_newsletter            FOR SELECT TO authenticated USING (true);
CREATE POLICY "mzd_nf_sel_auth"                ON public.magazord_notas_fiscais         FOR SELECT TO authenticated USING (true);
CREATE POLICY "mzd_ped_det_sel_auth"           ON public.magazord_pedido_detalhe        FOR SELECT TO authenticated USING (true);
CREATE POLICY "mzd_ped_pay_sel_auth"           ON public.magazord_pedido_payments       FOR SELECT TO authenticated USING (true);
CREATE POLICY "prod_mix_sel_auth"              ON public.produtos_mix                   FOR SELECT TO authenticated USING (true);
CREATE POLICY "sync_fail_sel_auth"             ON public.sync_failures                  FOR SELECT TO authenticated USING (true);
CREATE POLICY "sync_routes_sel_auth"           ON public.sync_job_routes                FOR SELECT TO authenticated USING (true);

-- Service role NÃO precisa de policy explícita (BYPASSRLS), continua escrevendo via crons/edges.

COMMIT;
