-- ============================================================
-- EXPEDICAO (modulo dentro de CAMPANHAS INTERNAS)
-- Manu: "Nao pode ser separada. Campanha = estrategia + modulo de expedicao dentro."
-- Cada campanha pode ter varios destinos de expedicao (N:1)
-- ============================================================

CREATE TABLE IF NOT EXISTS campanha_expedicoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id UUID NOT NULL REFERENCES campanhas_internas(id) ON DELETE CASCADE,

  -- Destino
  tipo_destino TEXT NOT NULL CHECK (tipo_destino IN ('loja_propria','revendedora','influencer','cliente_final')),
  destino_nome TEXT NOT NULL, -- ex: "Loja Piçarras", "Revendedora Julia", "@dra.cherry"
  destino_endereco TEXT,
  destino_contato TEXT,

  -- Brinde (hibrido: catalogo Bling OU cadastro livre)
  brinde_tipo TEXT CHECK (brinde_tipo IN ('catalogo','livre','nenhum')),
  brinde_produto_codigo TEXT, -- codigo no Bling se for do catalogo
  brinde_produto_nome TEXT, -- nome do produto
  brinde_foto_url TEXT, -- URL da imagem (Storage ou externa)
  brinde_descricao TEXT,
  brinde_quantidade INTEGER DEFAULT 1,

  -- Condicao comercial (estruturada)
  compra_minima NUMERIC,
  desconto_pct NUMERIC,
  frete_gratis BOOLEAN DEFAULT false,
  tem_brinde BOOLEAN DEFAULT false, -- redundante mas simplifica filtros
  condicao_observacao TEXT, -- texto livre ("valido apenas jalecos brancos", "nao cumulativo com cupom")

  -- Datas e status
  data_envio_estimada DATE,
  data_envio_real DATE,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','em_producao','enviado','entregue','cancelado')),

  -- Alerta
  alerta_7d_enviado BOOLEAN DEFAULT false, -- pra nao repetir
  alerta_3d_enviado BOOLEAN DEFAULT false,

  -- Metadata
  criado_por UUID REFERENCES profiles(id),
  criado_por_nome TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ce_campanha ON campanha_expedicoes(campanha_id);
CREATE INDEX IF NOT EXISTS idx_ce_status ON campanha_expedicoes(status);
CREATE INDEX IF NOT EXISTS idx_ce_envio ON campanha_expedicoes(data_envio_estimada);

CREATE OR REPLACE FUNCTION ce_update_ts() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ce_updated_at ON campanha_expedicoes;
CREATE TRIGGER trg_ce_updated_at BEFORE UPDATE ON campanha_expedicoes
  FOR EACH ROW EXECUTE FUNCTION ce_update_ts();

ALTER TABLE campanha_expedicoes REPLICA IDENTITY FULL;

-- RLS: quem ve campanhas internas pode ver expedicoes
ALTER TABLE campanha_expedicoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ce_select ON campanha_expedicoes;
DROP POLICY IF EXISTS ce_write ON campanha_expedicoes;

CREATE POLICY ce_select ON campanha_expedicoes FOR SELECT TO authenticated
  USING (has_campanha_interna_perm());

-- INSERT/UPDATE/DELETE: quem pode editar a campanha (mesmo criterio dos membros)
CREATE POLICY ce_write ON campanha_expedicoes FOR ALL TO authenticated
  USING (has_campanha_interna_editar() OR EXISTS(
    SELECT 1 FROM campanhas_internas c WHERE c.id = campanha_id AND (c.responsavel_id = auth.uid() OR c.criado_por = auth.uid())
  ))
  WITH CHECK (has_campanha_interna_editar() OR EXISTS(
    SELECT 1 FROM campanhas_internas c WHERE c.id = campanha_id AND (c.responsavel_id = auth.uid() OR c.criado_por = auth.uid())
  ));

-- Realtime
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE campanha_expedicoes; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- ============================================================
-- CRON: alertas 7d + 3d antes do envio estimado
-- ============================================================
CREATE OR REPLACE FUNCTION gerar_alertas_expedicao() RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  exp RECORD;
  camp RECORD;
  mem RECORD;
  dias INT;
  titulo_alerta TEXT;
  msg_alerta TEXT;
BEGIN
  -- Itera expedicoes pendentes/em_producao com data_envio_estimada futura
  FOR exp IN
    SELECT e.*
    FROM campanha_expedicoes e
    WHERE e.status IN ('pendente', 'em_producao')
      AND e.data_envio_estimada IS NOT NULL
      AND e.data_envio_estimada >= CURRENT_DATE
      AND e.data_envio_estimada <= CURRENT_DATE + INTERVAL '7 days'
  LOOP
    dias := (exp.data_envio_estimada - CURRENT_DATE);

    -- Alerta 7 dias antes
    IF dias <= 7 AND dias > 3 AND NOT exp.alerta_7d_enviado THEN
      SELECT * INTO camp FROM campanhas_internas WHERE id = exp.campanha_id;
      IF camp.id IS NULL THEN CONTINUE; END IF;

      titulo_alerta := '📦 Expedição em 7 dias · ' || camp.nome;
      msg_alerta := 'Destino: ' || exp.destino_nome || ' — revise brindes + condição comercial';

      -- Manda pro responsavel + membros com funcao 'expedicao' ou 'comercial'
      FOR mem IN
        SELECT DISTINCT m.profile_id, m.profile_nome
        FROM campanha_interna_membros m
        WHERE m.campanha_id = exp.campanha_id
          AND ('expedicao' = ANY(m.funcoes) OR 'comercial' = ANY(m.funcoes) OR 'gerente' = ANY(m.funcoes))
        UNION
        SELECT c.responsavel_id, c.responsavel_nome
        FROM campanhas_internas c
        WHERE c.id = exp.campanha_id AND c.responsavel_id IS NOT NULL
      LOOP
        INSERT INTO alertas (tipo, nivel, titulo, mensagem, destinatario_id, destinatario_nome, audiencia, link_ref, link_label, dados, lido)
        VALUES (
          'expedicao_7d', 'warn', titulo_alerta, msg_alerta,
          mem.profile_id, mem.profile_nome, 'pessoal',
          'campanhas-internas', 'Ver campanha',
          jsonb_build_object('campanha_id', exp.campanha_id, 'expedicao_id', exp.id),
          false
        );
      END LOOP;

      UPDATE campanha_expedicoes SET alerta_7d_enviado = true WHERE id = exp.id;
    END IF;

    -- Alerta 3 dias antes
    IF dias <= 3 AND dias >= 0 AND NOT exp.alerta_3d_enviado THEN
      SELECT * INTO camp FROM campanhas_internas WHERE id = exp.campanha_id;
      IF camp.id IS NULL THEN CONTINUE; END IF;

      titulo_alerta := '🚨 Expedição em ' || dias || ' dias · ' || camp.nome;
      msg_alerta := 'URGENTE — Destino: ' || exp.destino_nome || '. Separar brinde + enviar pra loja.';

      FOR mem IN
        SELECT DISTINCT m.profile_id, m.profile_nome
        FROM campanha_interna_membros m
        WHERE m.campanha_id = exp.campanha_id
          AND ('expedicao' = ANY(m.funcoes) OR 'comercial' = ANY(m.funcoes) OR 'gerente' = ANY(m.funcoes))
        UNION
        SELECT c.responsavel_id, c.responsavel_nome
        FROM campanhas_internas c
        WHERE c.id = exp.campanha_id AND c.responsavel_id IS NOT NULL
      LOOP
        INSERT INTO alertas (tipo, nivel, titulo, mensagem, destinatario_id, destinatario_nome, audiencia, link_ref, link_label, dados, lido)
        VALUES (
          'expedicao_3d', 'urgent', titulo_alerta, msg_alerta,
          mem.profile_id, mem.profile_nome, 'pessoal',
          'campanhas-internas', 'Ver campanha',
          jsonb_build_object('campanha_id', exp.campanha_id, 'expedicao_id', exp.id),
          false
        );
      END LOOP;

      UPDATE campanha_expedicoes SET alerta_3d_enviado = true WHERE id = exp.id;
    END IF;
  END LOOP;
END;
$$;

-- Agenda cron diario as 9h (local = sao paulo, UTC-3)
SELECT cron.schedule(
  'gerar-alertas-expedicao-diario',
  '0 12 * * *', -- 12 UTC = 9h SP
  $$SELECT gerar_alertas_expedicao();$$
);
