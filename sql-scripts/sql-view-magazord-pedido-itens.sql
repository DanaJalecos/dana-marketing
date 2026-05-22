-- magazord_pedido_itens — flatten dos itens do pedido do Site (Magazord)
-- a partir do raw jsonb de magazord_pedido_detalhe.
-- Estrutura origem: data.arrayPedidoRastreio[*].pedidoItem[*]
-- Sempre fresca (lê do raw, sem ETL). Atualiza junto com o cron sync-magazord-pedido-detalhe-1h.
-- CPV exato: JOIN com produtos_custos via produto_codigo ou produto_id.
DROP VIEW IF EXISTS public.magazord_pedido_itens;
CREATE VIEW public.magazord_pedido_itens AS
SELECT
  d.codigo                                       AS pedido_codigo,
  d.id                                           AS pedido_id,
  d.data_hora                                    AS pedido_data_hora,
  (item->>'produtoId')::bigint                   AS produto_id,
  item->>'produtoDerivacaoCodigo'                AS produto_codigo,
  item->>'codigoPai'                             AS produto_codigo_pai,
  item->>'produtoNome'                           AS produto_nome,
  item->>'produtoTitulo'                         AS produto_titulo,
  (item->>'produtoDerivacaoId')::bigint          AS produto_derivacao_id,
  item->>'descricao'                             AS descricao,
  (item->>'quantidade')::numeric                 AS quantidade,
  (item->>'valorUnitario')::numeric              AS preco_unitario,
  (item->>'valorDesconto')::numeric              AS valor_desconto,
  (item->>'valorAcrescimo')::numeric             AS valor_acrescimo,
  (item->>'valorItem')::numeric                  AS valor_total,
  item->>'ean'                                   AS ean,
  item->>'marcaNome'                             AS marca_nome,
  item->>'categoria'                             AS categoria,
  item->>'categoriaArvore'                       AS categoria_arvore,
  (item->>'categoria_id')::int                   AS categoria_id,
  (item->>'deposito')::int                       AS deposito_id,
  item->>'depositoNome'                          AS deposito_nome,
  (item->>'produtoTipo')::int                    AS produto_tipo,
  (ar->>'id')::bigint                            AS rastreio_id,
  d.synced_at
FROM public.magazord_pedido_detalhe d
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.raw->'arrayPedidoRastreio','[]'::jsonb)) ar
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ar->'pedidoItem','[]'::jsonb)) item;

COMMENT ON VIEW public.magazord_pedido_itens IS
'Flatten dos itens de pedido do Site (Magazord) a partir de magazord_pedido_detalhe.raw->arrayPedidoRastreio[*].pedidoItem[*]. Atualiza junto com a tabela origem (cron sync-magazord-pedido-detalhe-1h). Para CPV exato: JOIN com produtos_custos via produto_id ou produto_codigo.';
