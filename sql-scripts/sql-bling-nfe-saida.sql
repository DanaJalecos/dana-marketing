-- ════════════════════════════════════════════════════════════════════════════
-- BLING SYNC v3 — NFe DE SAÍDA (LOTE 2 / DIA 1)
-- Schema espelho de GET /nfe?tipo=1 (NFs emitidas pela Dana)
-- A MAIS AGUARDADA pelo Finance AI — destrava DIFAL (parsing XML on-read).
--
-- Decisão: schema enxuto + raw jsonb completo.
-- Impostos detalhados (ICMS/PIS/COFINS/IPI/DIFAL) ficam no raw e o Finance
-- AI calcula via VIEW dele consumindo o XML (URL salva em xml_url).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.bling_nfe_saida (
  id_bling                bigint        PRIMARY KEY,
  loja_id                 int           NOT NULL,
  numero                  text          NOT NULL,
  serie                   text,
  chave_acesso            text          UNIQUE,
  situacao                int           NOT NULL,
  -- 1 Pendente | 2 Cancelada | 3 Aguardando recibo | 4 Rejeitada | 5 Autorizada
  -- 6 Emitida DANFE | 7 Registrada | 8 Aguardando emissão | 9 Denegada
  data_emissao            timestamptz   NOT NULL,
  data_operacao           timestamptz,
  tipo                    int,                       -- 1 (saída sempre)
  -- Valores globais (somas que o Bling retorna direto)
  valor_total             numeric(14,2),
  valor_frete             numeric(14,2),
  -- Cliente
  cliente_id              bigint,
  cliente_nome            text,
  cliente_cpf_cnpj        text,
  cliente_uf              text,                      -- ⭐ pra DIFAL (interestadual)
  cliente_ie              text,
  -- Vendedor/intermediador
  vendedor_id             bigint,
  intermediador_cnpj      text,                      -- ML/Shopee/etc
  intermediador_nome      text,
  -- Operacional
  natureza_operacao_id    bigint,
  numero_pedido_loja      text,                      -- vínculo com /pedidos/vendas
  optante_simples         boolean,
  cfop                    text,                      -- 1º item (Bling não retorna global)
  consumidor_final        boolean,                   -- derivado do CFOP no raw
  -- URLs (drill on-demand pra DIFAL/parsing XML)
  xml_url                 text,
  pdf_url                 text,
  -- Tudo o resto fica no raw
  raw                     jsonb         NOT NULL,
  synced_at               timestamptz   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bns_loja_data
  ON public.bling_nfe_saida (loja_id, data_emissao DESC);
CREATE INDEX IF NOT EXISTS idx_bns_cliente
  ON public.bling_nfe_saida (cliente_cpf_cnpj);
CREATE INDEX IF NOT EXISTS idx_bns_situacao
  ON public.bling_nfe_saida (situacao);
CREATE INDEX IF NOT EXISTS idx_bns_uf_difal
  ON public.bling_nfe_saida (cliente_uf, consumidor_final)
  WHERE consumidor_final = true;
CREATE INDEX IF NOT EXISTS idx_bns_synced
  ON public.bling_nfe_saida (synced_at DESC);

-- RLS
ALTER TABLE public.bling_nfe_saida ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bns_service_all ON public.bling_nfe_saida;
CREATE POLICY bns_service_all ON public.bling_nfe_saida
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bns_auth_sel ON public.bling_nfe_saida;
CREATE POLICY bns_auth_sel ON public.bling_nfe_saida
  FOR SELECT TO authenticated USING (true);

COMMIT;
