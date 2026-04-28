-- Verificar quantos itens já temos
SELECT COUNT(*) as total_itens FROM pedidos_itens WHERE descricao != '(sem itens)' AND descricao != '';
