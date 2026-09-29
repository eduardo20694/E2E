# TDD

Test-Driven Development escreve o teste que falha antes do código que faz passar. O ciclo é vermelho, verde, refatorar.

## Vermelho

O teste descreve um comportamento que ainda não existe e falha pelo motivo certo (assert, não erro de compilação esquecido).

## Verde

O menor código que faz aquele teste passar. Sem antecipar o próximo caso.

## Refatorar

Limpa o código e o teste com a suíte verde. Se a refatoração muda comportamento, o teste tinha que ter falhado.

## Quando vale

Regra com resultado claro: cálculo, política de desconto, validador. TDD é desconfortável na borda de UI instável; ali o teste de componente ou o contrato chega depois de um esboço, e a regra por baixo continua no ciclo.

## O que não é

Escrever o teste depois e chamar de TDD. O valor está na falha inicial, que prova que o teste consegue falhar.
