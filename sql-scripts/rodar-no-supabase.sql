-- ══════════════════════════════════════════════════════════
-- DMS UPGRADE — Rodar TUDO de uma vez no SQL Editor do Supabase
-- Projeto: comlppiwzniskjbeneos
-- Data: 15/04/2026
-- ══════════════════════════════════════════════════════════

-- ═══════════════════════════════════
-- PARTE 1: EXTENSÕES NECESSÁRIAS
-- ═══════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ═══════════════════════════════════
-- PARTE 2: NOVAS TABELAS
-- ═══════════════════════════════════

-- 2.1 Tarefas (Kanban persistente)
CREATE TABLE IF NOT EXISTS tarefas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  descricao text,
  coluna text NOT NULL DEFAULT 'backlog'
    CHECK (coluna IN ('backlog','doing','review','done')),
  prioridade text DEFAULT 'media'
    CHECK (prioridade IN ('alta','media','baixa')),
  responsavel text,
  tag text,
  prazo date,
  posicao int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE tarefas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_tarefas" ON tarefas FOR SELECT TO anon USING (true);
CREATE POLICY "write_tarefas" ON tarefas FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "update_tarefas" ON tarefas FOR UPDATE TO anon USING (true);
CREATE POLICY "delete_tarefas" ON tarefas FOR DELETE TO anon USING (true);
CREATE POLICY "service_tarefas" ON tarefas FOR ALL TO service_role USING (true);

-- 2.2 Alertas inteligentes
CREATE TABLE IF NOT EXISTS alertas (
  id serial PRIMARY KEY,
  tipo text NOT NULL
    CHECK (tipo IN ('vendas_queda','pagamento_atrasado','cliente_inativo','canal_anomalia','estoque_baixo','meta_atingida')),
  nivel text DEFAULT 'info'
    CHECK (nivel IN ('urgent','warn','info','ok')),
  titulo text NOT NULL,
  mensagem text,
  lido boolean DEFAULT false,
  dados jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE alertas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_alertas" ON alertas FOR SELECT TO anon USING (true);
CREATE POLICY "write_alertas" ON alertas FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "update_alertas" ON alertas FOR UPDATE TO anon USING (true);
CREATE POLICY "service_alertas" ON alertas FOR ALL TO service_role USING (true);

-- 2.3 Calendario de campanhas
CREATE TABLE IF NOT EXISTS calendario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  descricao text,
  tipo text DEFAULT 'campanha'
    CHECK (tipo IN ('campanha','promocao','lancamento','evento','deadline','feriado')),
  cor text DEFAULT '#0a0a0a',
  data_inicio date NOT NULL,
  data_fim date,
  dia_todo boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE calendario ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_calendario" ON calendario FOR SELECT TO anon USING (true);
CREATE POLICY "write_calendario" ON calendario FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "update_calendario" ON calendario FOR UPDATE TO anon USING (true);
CREATE POLICY "delete_calendario" ON calendario FOR DELETE TO anon USING (true);
CREATE POLICY "service_calendario" ON calendario FOR ALL TO service_role USING (true);

-- ═══════════════════════════════════
-- PARTE 3: NOVAS VIEWS
-- ═══════════════════════════════════

-- 3.1 Cliente Scoring
CREATE OR REPLACE VIEW cliente_scoring AS
WITH cliente_stats AS (
  SELECT
    contato_nome,
    COUNT(*) as total_pedidos,
    COALESCE(SUM(total),0) as total_gasto,
    COALESCE(AVG(total),0) as ticket_medio,
    MAX(data) as ultima_compra,
    (CURRENT_DATE - MAX(data))::int as dias_sem_compra,
    COUNT(DISTINCT (EXTRACT(YEAR FROM data)::text || '-' || EXTRACT(MONTH FROM data)::text)) as meses_ativos
  FROM pedidos
  WHERE contato_nome IS NOT NULL AND contato_nome != '' AND situacao_id != 12
  GROUP BY contato_nome
)
SELECT *,
  LEAST(100, (
    LEAST(25, total_pedidos * 5) +
    LEAST(25, (total_gasto / 1000)::int) +
    LEAST(25, GREATEST(0, 25 - dias_sem_compra / 3)) +
    LEAST(25, (ticket_medio / 40)::int)
  )::int) as score,
  CASE
    WHEN LEAST(100, (LEAST(25,total_pedidos*5)+LEAST(25,(total_gasto/1000)::int)+LEAST(25,GREATEST(0,25-dias_sem_compra/3))+LEAST(25,(ticket_medio/40)::int))::int) >= 80 THEN 'VIP'
    WHEN LEAST(100, (LEAST(25,total_pedidos*5)+LEAST(25,(total_gasto/1000)::int)+LEAST(25,GREATEST(0,25-dias_sem_compra/3))+LEAST(25,(ticket_medio/40)::int))::int) >= 60 THEN 'Frequente'
    WHEN LEAST(100, (LEAST(25,total_pedidos*5)+LEAST(25,(total_gasto/1000)::int)+LEAST(25,GREATEST(0,25-dias_sem_compra/3))+LEAST(25,(ticket_medio/40)::int))::int) >= 40 THEN 'Ocasional'
    WHEN dias_sem_compra > 90 AND total_pedidos >= 2 THEN 'Em Risco'
    ELSE 'Inativo'
  END as segmento
FROM cliente_stats;
GRANT SELECT ON cliente_scoring TO anon;
GRANT SELECT ON cliente_scoring TO authenticated;

-- 3.2 Funil de vendas
CREATE OR REPLACE VIEW funil_vendas AS
SELECT
  EXTRACT(YEAR FROM data)::int as ano,
  EXTRACT(MONTH FROM data)::int as mes,
  loja_id,
  COUNT(*) FILTER (WHERE situacao_id = 21) as em_digitacao,
  COUNT(*) FILTER (WHERE situacao_id = 6) as em_aberto,
  COUNT(*) FILTER (WHERE situacao_id IN (35734, 35736)) as producao,
  COUNT(*) FILTER (WHERE situacao_id = 17008) as confeccionado,
  COUNT(*) FILTER (WHERE situacao_id = 9) as atendido,
  COUNT(*) FILTER (WHERE situacao_id = 12) as cancelado,
  COUNT(*) as total
FROM pedidos
GROUP BY ano, mes, loja_id;
GRANT SELECT ON funil_vendas TO anon;
GRANT SELECT ON funil_vendas TO authenticated;

-- 3.3 Receita historica
CREATE OR REPLACE VIEW receita_historica AS
SELECT
  EXTRACT(YEAR FROM data)::int as ano,
  EXTRACT(MONTH FROM data)::int as mes,
  SUM(total) as receita,
  COUNT(*) as pedidos,
  CASE WHEN COUNT(*)>0 THEN SUM(total)/COUNT(*) ELSE 0 END as ticket_medio
FROM pedidos
WHERE situacao_id != 12
GROUP BY ano, mes
ORDER BY ano, mes;
GRANT SELECT ON receita_historica TO anon;
GRANT SELECT ON receita_historica TO authenticated;

-- ═══════════════════════════════════
-- PARTE 4: FUNCTION GERAR ALERTAS
-- ═══════════════════════════════════

CREATE OR REPLACE FUNCTION gerar_alertas()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  receita_semana_atual numeric;
  receita_semana_anterior numeric;
  qtd_atrasados int;
  valor_atrasados numeric;
BEGIN
  DELETE FROM alertas WHERE created_at < NOW() - INTERVAL '7 days';

  -- Queda de vendas semanal >20%
  SELECT COALESCE(SUM(total),0) INTO receita_semana_atual
  FROM pedidos WHERE data >= CURRENT_DATE - 7 AND data <= CURRENT_DATE AND situacao_id != 12;
  SELECT COALESCE(SUM(total),0) INTO receita_semana_anterior
  FROM pedidos WHERE data >= CURRENT_DATE - 14 AND data < CURRENT_DATE - 7 AND situacao_id != 12;

  IF receita_semana_anterior > 0 AND
     ((receita_semana_anterior - receita_semana_atual) / receita_semana_anterior) > 0.20 THEN
    INSERT INTO alertas (tipo, nivel, titulo, mensagem, dados)
    SELECT 'vendas_queda', 'urgent',
      'Vendas caíram ' || ROUND(((receita_semana_anterior - receita_semana_atual) / receita_semana_anterior * 100))::text || '% esta semana',
      'Receita semanal: R$' || ROUND(receita_semana_atual/1000)::text || 'k vs R$' || ROUND(receita_semana_anterior/1000)::text || 'k semana anterior',
      jsonb_build_object('atual', receita_semana_atual, 'anterior', receita_semana_anterior)
    WHERE NOT EXISTS (SELECT 1 FROM alertas WHERE tipo = 'vendas_queda' AND created_at > NOW() - INTERVAL '24 hours');
  END IF;

  -- Pagamentos atrasados (pagar)
  SELECT COUNT(*), COALESCE(SUM(valor),0) INTO qtd_atrasados, valor_atrasados
  FROM contas_pagar WHERE situacao = 3 AND vencimento < CURRENT_DATE;
  IF qtd_atrasados > 0 THEN
    INSERT INTO alertas (tipo, nivel, titulo, mensagem, dados)
    SELECT 'pagamento_atrasado', 'warn',
      qtd_atrasados || ' contas a pagar atrasadas',
      'Total atrasado: R$' || ROUND(valor_atrasados)::text,
      jsonb_build_object('qtd', qtd_atrasados, 'valor', valor_atrasados)
    WHERE NOT EXISTS (SELECT 1 FROM alertas WHERE tipo = 'pagamento_atrasado' AND titulo LIKE '%pagar%' AND created_at > NOW() - INTERVAL '24 hours');
  END IF;

  -- Contas a receber atrasadas
  SELECT COUNT(*), COALESCE(SUM(valor),0) INTO qtd_atrasados, valor_atrasados
  FROM contas_receber WHERE situacao = 3 AND vencimento < CURRENT_DATE;
  IF qtd_atrasados > 0 THEN
    INSERT INTO alertas (tipo, nivel, titulo, mensagem, dados)
    SELECT 'pagamento_atrasado', 'warn',
      qtd_atrasados || ' contas a receber atrasadas',
      'Total atrasado: R$' || ROUND(valor_atrasados)::text,
      jsonb_build_object('qtd', qtd_atrasados, 'valor', valor_atrasados)
    WHERE NOT EXISTS (SELECT 1 FROM alertas WHERE tipo = 'pagamento_atrasado' AND titulo LIKE '%receber%' AND created_at > NOW() - INTERVAL '24 hours');
  END IF;

  -- Estoque baixo (<5 unidades)
  INSERT INTO alertas (tipo, nivel, titulo, mensagem, dados)
  SELECT 'estoque_baixo', 'warn',
    nome || ' com estoque baixo (' || estoque_virtual::int || ' un.)',
    'Produto: ' || codigo || ' — considere reabastecer',
    jsonb_build_object('produto_id', id, 'estoque', estoque_virtual)
  FROM produtos
  WHERE situacao = 'A' AND tipo = 'P' AND estoque_virtual > 0 AND estoque_virtual < 5
  AND NOT EXISTS (
    SELECT 1 FROM alertas WHERE tipo = 'estoque_baixo' AND (dados->>'produto_id')::bigint = produtos.id AND created_at > NOW() - INTERVAL '24 hours'
  )
  LIMIT 5;

  -- Meta ticket medio atingida
  PERFORM 1 FROM pedidos
  WHERE data >= DATE_TRUNC('month', CURRENT_DATE) AND situacao_id != 12
  HAVING AVG(total) >= 500;
  IF FOUND THEN
    INSERT INTO alertas (tipo, nivel, titulo, mensagem)
    SELECT 'meta_atingida', 'ok',
      'Ticket médio acima de R$500 este mês!',
      'Média: R$' || ROUND((SELECT AVG(total) FROM pedidos WHERE data >= DATE_TRUNC('month', CURRENT_DATE) AND situacao_id != 12))::text
    WHERE NOT EXISTS (SELECT 1 FROM alertas WHERE tipo = 'meta_atingida' AND created_at > NOW() - INTERVAL '24 hours');
  END IF;
END;
$$;

-- ═══════════════════════════════════
-- PARTE 5: REALTIME NAS NOVAS TABELAS
-- ═══════════════════════════════════

ALTER PUBLICATION supabase_realtime ADD TABLE tarefas;
ALTER PUBLICATION supabase_realtime ADD TABLE alertas;
ALTER PUBLICATION supabase_realtime ADD TABLE calendario;

-- ═══════════════════════════════════
-- PARTE 6: VERIFICAR/CRIAR CRON
-- ═══════════════════════════════════

-- Remover cron antigo se existir (evitar duplicatas)
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'sync-bling-30min';

-- Criar cron: sync Bling a cada 30 minutos
SELECT cron.schedule(
  'sync-bling-30min',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://comlppiwzniskjbeneos.supabase.co/functions/v1/sync-bling',
    headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvbWxwcGl3em5pc2tqYmVuZW9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwODg2MjYsImV4cCI6MjA5MTY2NDYyNn0.jQOYaPklzSxQxTUd7rzktljHpW7ivbxbtilsUUi-TBE"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- Criar cron: gerar alertas a cada 30 minutos (logo apos o sync)
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'gerar-alertas-30min';

SELECT cron.schedule(
  'gerar-alertas-30min',
  '5,35 * * * *',
  $$
  SELECT gerar_alertas();
  $$
);

-- ═══════════════════════════════════
-- PARTE 7: VERIFICAÇÃO FINAL
-- ═══════════════════════════════════

-- Rodar gerar_alertas() agora para popular alertas iniciais
SELECT gerar_alertas();

-- Verificar se tudo foi criado
SELECT 'TABELAS' as tipo, tablename as nome FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('tarefas','alertas','calendario')
UNION ALL
SELECT 'VIEWS', viewname FROM pg_views WHERE schemaname = 'public' AND viewname IN ('cliente_scoring','funil_vendas','receita_historica','dashboard_resumo','dashboard_mensal','dashboard_contas')
UNION ALL
SELECT 'CRON JOBS', jobname FROM cron.job;
