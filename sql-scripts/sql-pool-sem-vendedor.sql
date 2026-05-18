-- ══════════════════════════════════════════════════════════════
-- POOL "Clientes sem vendedor" (Matriz) + auto-atribuição
--
-- Regra (decisão Juan):
--  - Pool visível pra todos os vendedores da Matriz (vendedor/vendedor_b2b)
--  - Vendedor mexeu no STATUS ou registrou CONTATO num cliente sem
--    dono → vira dele automaticamente (grava cliente_vendedor_manual)
--  - Primeiro que pega é o dono (lock por unique index)
--  - cliente_scoring_vendedor já usa cliente_vendedor_manual como
--    override → carteira/ranking/scoring/aniversariantes já somam
--    todas as compras (passadas e futuras) pro vendedor. Zero a mais.
--  - Admin/gerente mexendo NÃO assume (não é vendedor).
--  - Cliente que já tem vendedor (manual ou Bling) NÃO é tocado.
-- ══════════════════════════════════════════════════════════════

-- ─── 1) Lock: 1 dono por (contato, empresa) ───
-- (tabela está vazia hoje — índice seguro)
CREATE UNIQUE INDEX IF NOT EXISTS uq_cvm_contato_empresa
  ON cliente_vendedor_manual (contato_id, empresa);

-- ─── 2) Função central de auto-atribuição ───
-- Só atribui se: empresa=matriz · quem mexeu é vendedor/vendedor_b2b ·
-- cliente sem dono manual · cliente sem vendedor Bling.
CREATE OR REPLACE FUNCTION pool_auto_atribuir(
  p_contato_id BIGINT, p_empresa TEXT, p_user_id UUID, p_user_nome TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_nome_contato  TEXT;
  v_bling_profile UUID;
BEGIN
  IF p_contato_id IS NULL OR p_user_id IS NULL THEN RETURN; END IF;
  IF COALESCE(p_empresa,'') <> 'matriz' THEN RETURN; END IF;

  -- quem mexeu precisa ser vendedor (admin/gerente não vira "dono")
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = p_user_id AND cargo IN ('vendedor','vendedor_b2b')
  ) THEN RETURN; END IF;

  -- já tem dono manual? (lock — primeiro que pegou fica)
  IF EXISTS (
    SELECT 1 FROM cliente_vendedor_manual
    WHERE contato_id = p_contato_id AND empresa = p_empresa
  ) THEN RETURN; END IF;

  -- já tem vendedor pelo Bling? MESMA regra da view cliente_scoring_vendedor:
  -- olha só o ÚLTIMO pedido com vendedor e vê se mapeia p/ um profile ativo.
  -- (NÃO usar "qualquer pedido" — senão diverge da view e o cliente fica
  --  no limbo: aparece no pool mas não deixa pegar.)
  SELECT nome INTO v_nome_contato FROM contatos WHERE id = p_contato_id;
  IF v_nome_contato IS NOT NULL THEN
    SELECT vm.profile_id INTO v_bling_profile
    FROM (
      SELECT p.vendedor_id
      FROM pedidos p
      WHERE p.contato_nome = v_nome_contato
        AND p.empresa = p_empresa
        AND p.vendedor_id IS NOT NULL AND p.vendedor_id > 0
      ORDER BY p.data DESC NULLS LAST
      LIMIT 1
    ) lp
    LEFT JOIN vendedor_mapping vm
      ON vm.bling_vendedor_id = lp.vendedor_id
     AND vm.empresa = p_empresa
     AND vm.ativo = true;
    IF v_bling_profile IS NOT NULL THEN RETURN; END IF;
  END IF;

  -- assume
  INSERT INTO cliente_vendedor_manual
    (contato_id, empresa, profile_id, atribuido_por, atribuido_por_nome, atribuido_em, motivo)
  VALUES
    (p_contato_id, p_empresa, p_user_id, p_user_id, p_user_nome, now(),
     'auto: assumiu ao trabalhar o cliente (pool sem vendedor)')
  ON CONFLICT (contato_id, empresa) DO NOTHING;  -- corrida → 1º ganha
END $$;

-- ─── 3) Trigger A: mudou o STATUS ───
CREATE OR REPLACE FUNCTION trg_pool_status() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM pool_auto_atribuir(NEW.contato_id, NEW.empresa,
                             NEW.mudado_por_id, NEW.mudado_por_nome);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS pool_atribuir_status ON cliente_status_historico;
CREATE TRIGGER pool_atribuir_status
  AFTER INSERT ON cliente_status_historico
  FOR EACH ROW EXECUTE FUNCTION trg_pool_status();

-- ─── 4) Trigger B: registrou CONTATO/nota ───
-- cliente_notas guarda contato_nome (não id) → resolve id (1 match só).
CREATE OR REPLACE FUNCTION trg_pool_nota() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cid BIGINT;
BEGIN
  SELECT id INTO v_cid FROM contatos
   WHERE nome = NEW.contato_nome
   LIMIT 1;
  IF v_cid IS NOT NULL THEN
    PERFORM pool_auto_atribuir(v_cid, NEW.empresa, NEW.user_id, NEW.user_nome);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS pool_atribuir_nota ON cliente_notas;
CREATE TRIGGER pool_atribuir_nota
  AFTER INSERT ON cliente_notas
  FOR EACH ROW EXECUTE FUNCTION trg_pool_nota();

-- ─── 5) RPC: lista paginada do pool (sem vendedor) ───
DROP FUNCTION IF EXISTS clientes_sem_vendedor(TEXT, TEXT, INT, INT);
CREATE OR REPLACE FUNCTION clientes_sem_vendedor(
  p_empresa TEXT DEFAULT 'matriz',
  p_busca   TEXT DEFAULT NULL,
  p_offset  INT  DEFAULT 0,
  p_limit   INT  DEFAULT 25
) RETURNS TABLE (
  contato_id BIGINT, contato_nome TEXT, telefone TEXT, celular TEXT,
  segmento TEXT, score INT, total_pedidos INT, total_gasto NUMERIC,
  ultima_compra DATE, dias_sem_compra INT, total_count BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH base AS (
    SELECT csv.contato_id::bigint            AS contato_id,
           csv.contato_nome::text            AS contato_nome,
           csv.telefone::text                AS telefone,
           csv.celular::text                 AS celular,
           csv.segmento::text                AS segmento,
           csv.score::int                    AS score,
           csv.total_pedidos::int            AS total_pedidos,
           csv.total_gasto::numeric          AS total_gasto,
           csv.ultima_compra::date           AS ultima_compra,
           csv.dias_sem_compra::int          AS dias_sem_compra
    FROM cliente_scoring_vendedor csv
    WHERE csv.empresa = p_empresa
      AND csv.vendedor_profile_id IS NULL
      AND (p_busca IS NULL OR p_busca = ''
           OR csv.contato_nome ILIKE '%'||replace(p_busca,'%','')||'%')
  )
  SELECT b.contato_id, b.contato_nome, b.telefone, b.celular, b.segmento,
         b.score, b.total_pedidos, b.total_gasto, b.ultima_compra,
         b.dias_sem_compra, (SELECT COUNT(*) FROM base)::bigint AS total_count
  FROM base b
  ORDER BY b.score DESC NULLS LAST, b.total_gasto DESC NULLS LAST
  OFFSET GREATEST(p_offset,0) LIMIT LEAST(GREATEST(p_limit,1),100);
$$;
GRANT EXECUTE ON FUNCTION clientes_sem_vendedor(TEXT,TEXT,INT,INT) TO authenticated;

-- ─── 6) RPC: soltar cliente de volta pro pool (dono ou admin) ───
DROP FUNCTION IF EXISTS soltar_cliente(BIGINT, TEXT);
CREATE OR REPLACE FUNCTION soltar_cliente(p_contato_id BIGINT, p_empresa TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cargo TEXT; v_dono UUID;
BEGIN
  SELECT cargo INTO v_cargo FROM profiles WHERE id = auth.uid();
  SELECT profile_id INTO v_dono FROM cliente_vendedor_manual
    WHERE contato_id = p_contato_id AND empresa = p_empresa;
  IF v_dono IS NULL THEN RETURN false; END IF;            -- não estava atribuído
  IF v_dono = auth.uid()
     OR v_cargo IN ('admin','gerente_comercial','gerente_marketing') THEN
    DELETE FROM cliente_vendedor_manual
      WHERE contato_id = p_contato_id AND empresa = p_empresa;
    RETURN true;
  END IF;
  RETURN false;                                            -- sem permissão
END $$;
GRANT EXECUTE ON FUNCTION soltar_cliente(BIGINT,TEXT) TO authenticated;

-- ─── Diagnóstico ───
SELECT
  (SELECT COUNT(*) FROM cliente_scoring_vendedor
     WHERE empresa='matriz' AND vendedor_profile_id IS NULL) AS pool_matriz,
  (SELECT total_count FROM clientes_sem_vendedor('matriz',NULL,0,1) LIMIT 1) AS rpc_total,
  (SELECT COUNT(*) FROM pg_trigger
     WHERE tgname IN ('pool_atribuir_status','pool_atribuir_nota')) AS triggers_ok;
