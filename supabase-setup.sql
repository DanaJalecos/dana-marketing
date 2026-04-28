-- ============================================
-- DMS - Dana Marketing System
-- Executar no SQL Editor do Supabase
-- ============================================

-- PASSO 1: Criar tabelas
CREATE TABLE IF NOT EXISTS bling_tokens (
  id int PRIMARY KEY DEFAULT 1,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz,
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS pedidos (
  id bigint PRIMARY KEY,
  numero int,
  numero_loja text,
  data date,
  data_saida date,
  total_produtos numeric(12,2),
  total numeric(12,2),
  contato_nome text,
  contato_tipo text,
  situacao_id int,
  loja_id bigint,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS produtos (
  id bigint PRIMARY KEY,
  nome text,
  codigo text,
  preco numeric(12,2),
  preco_custo numeric(12,2),
  estoque_virtual numeric(12,2) DEFAULT 0,
  tipo text,
  situacao text,
  formato text,
  imagem_url text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contatos (
  id bigint PRIMARY KEY,
  nome text,
  codigo text,
  situacao text,
  tipo_pessoa text,
  numero_documento text,
  telefone text,
  celular text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contas_receber (
  id bigint PRIMARY KEY,
  situacao int,
  vencimento date,
  valor numeric(12,2),
  data_emissao date,
  contato_nome text,
  contato_tipo text,
  origem_tipo text,
  origem_numero text,
  conta_contabil text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contas_pagar (
  id bigint PRIMARY KEY,
  situacao int,
  vencimento date,
  valor numeric(12,2),
  contato_id bigint,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vendedores (
  id bigint PRIMARY KEY,
  nome text,
  situacao text,
  desconto_limite numeric(5,2) DEFAULT 0,
  loja_id bigint DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS depositos (
  id bigint PRIMARY KEY,
  descricao text,
  situacao int,
  padrao boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS resumo_mensal (
  id serial PRIMARY KEY,
  ano int NOT NULL,
  mes int NOT NULL,
  receita numeric(12,2) DEFAULT 0,
  pedidos int DEFAULT 0,
  ticket_medio numeric(12,2) DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(ano, mes)
);

CREATE TABLE IF NOT EXISTS sync_log (
  id serial PRIMARY KEY,
  tabela text,
  registros int,
  status text,
  erro text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome text,
  email text,
  role text DEFAULT 'viewer',
  created_at timestamptz DEFAULT now()
);

-- PASSO 2: RLS + Policies
ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE contatos ENABLE ROW LEVEL SECURITY;
ALTER TABLE contas_receber ENABLE ROW LEVEL SECURITY;
ALTER TABLE contas_pagar ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE depositos ENABLE ROW LEVEL SECURITY;
ALTER TABLE resumo_mensal ENABLE ROW LEVEL SECURITY;
ALTER TABLE bling_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_pedidos" ON pedidos FOR SELECT TO anon USING (true);
CREATE POLICY "read_produtos" ON produtos FOR SELECT TO anon USING (true);
CREATE POLICY "read_contatos" ON contatos FOR SELECT TO anon USING (true);
CREATE POLICY "read_contas_receber" ON contas_receber FOR SELECT TO anon USING (true);
CREATE POLICY "read_contas_pagar" ON contas_pagar FOR SELECT TO anon USING (true);
CREATE POLICY "read_vendedores" ON vendedores FOR SELECT TO anon USING (true);
CREATE POLICY "read_depositos" ON depositos FOR SELECT TO anon USING (true);
CREATE POLICY "read_resumo" ON resumo_mensal FOR SELECT TO anon USING (true);

CREATE POLICY "read_pedidos_auth" ON pedidos FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_produtos_auth" ON produtos FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_contatos_auth" ON contatos FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_contas_receber_auth" ON contas_receber FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_contas_pagar_auth" ON contas_pagar FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_vendedores_auth" ON vendedores FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_depositos_auth" ON depositos FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_resumo_auth" ON resumo_mensal FOR SELECT TO authenticated USING (true);

CREATE POLICY "tokens_service_only" ON bling_tokens FOR ALL TO service_role USING (true);
CREATE POLICY "sync_service_only" ON sync_log FOR ALL TO service_role USING (true);

CREATE POLICY "service_pedidos" ON pedidos FOR ALL TO service_role USING (true);
CREATE POLICY "service_produtos" ON produtos FOR ALL TO service_role USING (true);
CREATE POLICY "service_contatos" ON contatos FOR ALL TO service_role USING (true);
CREATE POLICY "service_contas_r" ON contas_receber FOR ALL TO service_role USING (true);
CREATE POLICY "service_contas_p" ON contas_pagar FOR ALL TO service_role USING (true);
CREATE POLICY "service_vendedores" ON vendedores FOR ALL TO service_role USING (true);
CREATE POLICY "service_depositos" ON depositos FOR ALL TO service_role USING (true);
CREATE POLICY "service_resumo" ON resumo_mensal FOR ALL TO service_role USING (true);

CREATE POLICY "read_profiles" ON profiles FOR SELECT USING (true);
CREATE POLICY "update_own_profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "insert_own_profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "service_profiles" ON profiles FOR ALL TO service_role USING (true);

-- PASSO 3: Views e Functions
CREATE OR REPLACE VIEW dashboard_resumo AS
SELECT
  (SELECT COALESCE(SUM(total), 0) FROM pedidos WHERE data >= '2026-01-01' AND data <= '2026-12-31') as receita_2026,
  (SELECT COUNT(*) FROM pedidos WHERE data >= '2026-01-01' AND data <= '2026-12-31') as pedidos_2026,
  (SELECT COALESCE(SUM(total), 0) FROM pedidos WHERE data >= '2025-01-01' AND data <= '2025-12-31') as receita_2025,
  (SELECT COUNT(*) FROM pedidos WHERE data >= '2025-01-01' AND data <= '2025-12-31') as pedidos_2025,
  (SELECT COALESCE(SUM(valor), 0) FROM contas_receber WHERE situacao = 1) as total_receber,
  (SELECT COALESCE(SUM(valor), 0) FROM contas_pagar WHERE situacao = 1) as total_pagar,
  (SELECT COUNT(*) FROM contatos) as total_contatos;

CREATE OR REPLACE VIEW dashboard_mensal AS
SELECT
  EXTRACT(YEAR FROM data)::int as ano,
  EXTRACT(MONTH FROM data)::int as mes,
  situacao_id,
  COUNT(*)::int as pedidos,
  COALESCE(SUM(total), 0) as receita,
  CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(total), 0) / COUNT(*) ELSE 0 END as ticket_medio,
  COUNT(*) FILTER (WHERE loja_id = 203536978)::int as pedidos_loja,
  COALESCE(SUM(total) FILTER (WHERE loja_id = 203536978), 0) as receita_loja,
  COUNT(*) FILTER (WHERE loja_id = 205337834)::int as pedidos_ml,
  COALESCE(SUM(total) FILTER (WHERE loja_id = 205337834), 0) as receita_ml,
  COUNT(*) FILTER (WHERE loja_id = 205430008)::int as pedidos_tiktok,
  COALESCE(SUM(total) FILTER (WHERE loja_id = 205430008), 0) as receita_tiktok,
  COUNT(*) FILTER (WHERE loja_id = 205522474)::int as pedidos_shopee,
  COALESCE(SUM(total) FILTER (WHERE loja_id = 205522474), 0) as receita_shopee,
  COUNT(*) FILTER (WHERE loja_id = 0 OR loja_id IS NULL)::int as pedidos_site,
  COALESCE(SUM(total) FILTER (WHERE loja_id = 0 OR loja_id IS NULL), 0) as receita_site
FROM pedidos
GROUP BY ano, mes, situacao_id
ORDER BY ano, mes;

CREATE OR REPLACE VIEW dashboard_contas AS
SELECT
  (SELECT COUNT(*) FROM contas_pagar WHERE situacao = 1 AND vencimento >= '2026-01-01') as cp_aberto_qtd,
  (SELECT COALESCE(SUM(valor), 0) FROM contas_pagar WHERE situacao = 1 AND vencimento >= '2026-01-01') as cp_aberto_valor,
  (SELECT COUNT(*) FROM contas_pagar WHERE situacao = 3 AND vencimento >= '2026-01-01') as cp_atrasado_qtd,
  (SELECT COALESCE(SUM(valor), 0) FROM contas_pagar WHERE situacao = 3 AND vencimento >= '2026-01-01') as cp_atrasado_valor,
  (SELECT COUNT(*) FROM contas_receber WHERE situacao = 1 AND vencimento >= '2026-01-01') as cr_aberto_qtd,
  (SELECT COALESCE(SUM(valor), 0) FROM contas_receber WHERE situacao = 1 AND vencimento >= '2026-01-01') as cr_aberto_valor,
  (SELECT COUNT(*) FROM contas_receber WHERE situacao = 3 AND vencimento >= '2026-01-01') as cr_atrasado_qtd,
  (SELECT COALESCE(SUM(valor), 0) FROM contas_receber WHERE situacao = 3 AND vencimento >= '2026-01-01') as cr_atrasado_valor;

GRANT SELECT ON dashboard_resumo TO anon;
GRANT SELECT ON dashboard_resumo TO authenticated;
GRANT SELECT ON dashboard_mensal TO anon;
GRANT SELECT ON dashboard_mensal TO authenticated;
GRANT SELECT ON dashboard_contas TO anon;
GRANT SELECT ON dashboard_contas TO authenticated;

-- PASSO 4: Novas tabelas (Upgrade DMS)

-- 4.1 Tarefas (Kanban persistente)
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

-- 4.2 Alertas inteligentes
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

-- 4.3 Calendario de campanhas
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

-- PASSO 5: Novas views (Upgrade DMS)

-- 5.1 Cliente Scoring — segmentacao automatica
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

-- 5.2 Funil de vendas — contagem por status
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

-- 5.3 Receita historica — base para previsao
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

-- PASSO 6: Function gerar_alertas
CREATE OR REPLACE FUNCTION gerar_alertas()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  receita_semana_atual numeric;
  receita_semana_anterior numeric;
  qtd_atrasados int;
  valor_atrasados numeric;
BEGIN
  -- Limpar alertas antigos (mais de 7 dias)
  DELETE FROM alertas WHERE created_at < NOW() - INTERVAL '7 days';

  -- 1. Queda de vendas semanal (>20%)
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
    WHERE NOT EXISTS (
      SELECT 1 FROM alertas WHERE tipo = 'vendas_queda' AND created_at > NOW() - INTERVAL '24 hours'
    );
  END IF;

  -- 2. Pagamentos atrasados
  SELECT COUNT(*), COALESCE(SUM(valor),0) INTO qtd_atrasados, valor_atrasados
  FROM contas_pagar WHERE situacao = 3 AND vencimento < CURRENT_DATE;

  IF qtd_atrasados > 0 THEN
    INSERT INTO alertas (tipo, nivel, titulo, mensagem, dados)
    SELECT 'pagamento_atrasado', 'warn',
      qtd_atrasados || ' contas a pagar atrasadas',
      'Total atrasado: R$' || ROUND(valor_atrasados)::text,
      jsonb_build_object('qtd', qtd_atrasados, 'valor', valor_atrasados)
    WHERE NOT EXISTS (
      SELECT 1 FROM alertas WHERE tipo = 'pagamento_atrasado' AND created_at > NOW() - INTERVAL '24 hours'
    );
  END IF;

  -- 3. Contas a receber atrasadas
  SELECT COUNT(*), COALESCE(SUM(valor),0) INTO qtd_atrasados, valor_atrasados
  FROM contas_receber WHERE situacao = 3 AND vencimento < CURRENT_DATE;

  IF qtd_atrasados > 0 THEN
    INSERT INTO alertas (tipo, nivel, titulo, mensagem, dados)
    SELECT 'pagamento_atrasado', 'warn',
      qtd_atrasados || ' contas a receber atrasadas',
      'Total atrasado: R$' || ROUND(valor_atrasados)::text,
      jsonb_build_object('qtd', qtd_atrasados, 'valor', valor_atrasados)
    WHERE NOT EXISTS (
      SELECT 1 FROM alertas WHERE tipo = 'pagamento_atrasado' AND mensagem LIKE '%receber%' AND created_at > NOW() - INTERVAL '24 hours'
    );
  END IF;

  -- 4. Produtos com estoque baixo (<5)
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

  -- 5. Meta de ticket medio atingida
  PERFORM 1 FROM pedidos
  WHERE data >= DATE_TRUNC('month', CURRENT_DATE)
  AND situacao_id != 12
  HAVING AVG(total) >= 500;

  IF FOUND THEN
    INSERT INTO alertas (tipo, nivel, titulo, mensagem)
    SELECT 'meta_atingida', 'ok',
      'Ticket médio acima de R$500 este mês!',
      'Média: R$' || ROUND((SELECT AVG(total) FROM pedidos WHERE data >= DATE_TRUNC('month', CURRENT_DATE) AND situacao_id != 12))::text
    WHERE NOT EXISTS (
      SELECT 1 FROM alertas WHERE tipo = 'meta_atingida' AND created_at > NOW() - INTERVAL '24 hours'
    );
  END IF;
END;
$$;

-- PASSO 7: Realtime (tabelas originais + novas)
ALTER PUBLICATION supabase_realtime ADD TABLE pedidos;
ALTER PUBLICATION supabase_realtime ADD TABLE produtos;
ALTER PUBLICATION supabase_realtime ADD TABLE contatos;
ALTER PUBLICATION supabase_realtime ADD TABLE contas_receber;
ALTER PUBLICATION supabase_realtime ADD TABLE contas_pagar;
ALTER PUBLICATION supabase_realtime ADD TABLE vendedores;
ALTER PUBLICATION supabase_realtime ADD TABLE depositos;
ALTER PUBLICATION supabase_realtime ADD TABLE resumo_mensal;
ALTER PUBLICATION supabase_realtime ADD TABLE tarefas;
ALTER PUBLICATION supabase_realtime ADD TABLE alertas;
ALTER PUBLICATION supabase_realtime ADD TABLE calendario;
