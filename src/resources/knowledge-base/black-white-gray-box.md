# Caixa-preta, caixa-branca e caixa-cinza

## Caixa-preta

O teste olha a especificação e ignora o código. Partição, limite, tabela de decisão e fluxo de usuário nascem aqui. Serve para não copiar o bug do código para o teste.

## Caixa-branca

O teste olha o código: ramos, condições, exceções, mutação. Serve para achar caminho que a especificação não cita e que o percentual de cobertura esconde.

## Caixa-cinza

Usa os dois. O caso nasce da regra (preta) e o dado ou o ponto de observação usa conhecimento interno (branca): id de fixture, flag, contrato interno.

## Como escolher

| Pergunta | Abordagem |
| --- | --- |
| O usuário consegue ver o resultado? | Preta, muitas vezes E2E ou API |
| O defeito está num ramo? | Branca, unitário |
| A regra é externa e o setup é interno? | Cinza, integração |

Um projeto saudável mistura as três. Só caixa-branca testa o que o código faz, inclusive o erro. Só caixa-preta deixa ramo de erro sem execução.
