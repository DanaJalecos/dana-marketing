-- ════════════════════════════════════════════════════════════════════════════
-- Pedido FAI 28/05: adicionar forma_pagamento_id + conta_financeira_id
-- em contas_pagar e contas_receber.
--
-- Bonus: categoria_id (mapeada pro 'portador.id' do Bling = conta financeira;
--        e 'categoria.id' do Bling = categoria DRE)
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.contas_pagar
  ADD COLUMN IF NOT EXISTS forma_pagamento_id  bigint,
  ADD COLUMN IF NOT EXISTS conta_financeira_id bigint,
  ADD COLUMN IF NOT EXISTS categoria_id        bigint;

ALTER TABLE public.contas_receber
  ADD COLUMN IF NOT EXISTS forma_pagamento_id  bigint,
  ADD COLUMN IF NOT EXISTS conta_financeira_id bigint,
  ADD COLUMN IF NOT EXISTS categoria_id        bigint;

-- Índices p/ filtros típicos
CREATE INDEX IF NOT EXISTS idx_cp_forma_pagamento
  ON public.contas_pagar (forma_pagamento_id) WHERE forma_pagamento_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cp_conta_fin
  ON public.contas_pagar (conta_financeira_id) WHERE conta_financeira_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cp_categoria
  ON public.contas_pagar (categoria_id) WHERE categoria_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cp_drillpend
  ON public.contas_pagar (id) WHERE forma_pagamento_id IS NULL AND situacao IN (1, 3, 5);

CREATE INDEX IF NOT EXISTS idx_cr_forma_pagamento
  ON public.contas_receber (forma_pagamento_id) WHERE forma_pagamento_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cr_conta_fin
  ON public.contas_receber (conta_financeira_id) WHERE conta_financeira_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cr_categoria
  ON public.contas_receber (categoria_id) WHERE categoria_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cr_drillpend
  ON public.contas_receber (id) WHERE forma_pagamento_id IS NULL AND situacao IN (1, 3, 5);

-- View resolutiva (combina ambas tabelas + JOIN nomes)
DROP VIEW IF EXISTS public.contas_completas;
CREATE VIEW public.contas_completas AS
SELECT
  'pagar'::text  AS direcao,
  cp.id, cp.empresa, cp.situacao, cp.vencimento, cp.valor,
  cp.contato_id::bigint AS contato_id, NULL::text AS contato_nome,
  cp.forma_pagamento_id, fp.descricao AS forma_pagamento_nome,
  cp.conta_financeira_id, cf.nome AS conta_financeira_nome,
  cp.categoria_id, cat.nome AS categoria_nome
FROM public.contas_pagar cp
LEFT JOIN public.bling_formas_pagamento   fp  ON fp.id_bling  = cp.forma_pagamento_id
LEFT JOIN public.bling_contas_financeiras cf  ON cf.id_bling  = cp.conta_financeira_id
LEFT JOIN public.bling_categorias         cat ON cat.id_bling = cp.categoria_id

UNION ALL

SELECT
  'receber'::text AS direcao,
  cr.id, cr.empresa, cr.situacao, cr.vencimento, cr.valor,
  NULL::bigint AS contato_id, cr.contato_nome,
  cr.forma_pagamento_id, fp.descricao AS forma_pagamento_nome,
  cr.conta_financeira_id, cf.nome AS conta_financeira_nome,
  cr.categoria_id, cat.nome AS categoria_nome
FROM public.contas_receber cr
LEFT JOIN public.bling_formas_pagamento   fp  ON fp.id_bling  = cr.forma_pagamento_id
LEFT JOIN public.bling_contas_financeiras cf  ON cf.id_bling  = cr.conta_financeira_id
LEFT JOIN public.bling_categorias         cat ON cat.id_bling = cr.categoria_id;

GRANT SELECT ON public.contas_completas TO authenticated;
GRANT SELECT ON public.contas_completas TO service_role;
REVOKE ALL ON public.contas_completas FROM anon;

COMMIT;
