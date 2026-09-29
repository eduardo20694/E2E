# Técnicas de design de casos

Técnicas de design escolhem poucos casos com chance alta de achar defeito. Elas não substituem o oráculo: alguém ainda define o resultado esperado.

## Particionamento de equivalência

O domínio vira classes em que todos os valores deveriam se comportar igual. Um representante por classe. Classes inválidas são testadas uma de cada vez, para o erro de uma não mascarar o da outra.

## Valor limite

Defeito se concentra na borda. Para um intervalo inclusivo [min, max], exercite min−1, min, um ponto interno, max e max+1.

## Tabela de decisão

Várias condições independentes que mudam a ação. Cada coluna é um caso. Colunas com a mesma ação podem ser fundidas depois de escritas.

## Transição de estado

Estados, eventos e o estado de destino. Teste a transição válida e o evento que não deveria sair daquele estado. Guarda (saldo suficiente, papel) entra como condição da transição.

## Pairwise

Quando há vários parâmetros com vários valores, o produto cartesiano explode. Pairwise garante que cada par de valores de fatores diferentes aparece ao menos uma vez. Não garante a combinação dos três ao mesmo tempo; use o cartesiano só no risco que exige isso.

## Exemplo curto

Idade de 18 a 65: classes "menor", "dentro", "maior". Limites 17, 18, 65, 66. A classe "dentro" não precisa de dez idades.
