# Teste de integração

Teste de integração verifica se duas ou mais partes reais colaboram: handler e banco, consumidor e fila, cliente HTTP e contrato do serviço vizinho.

## Quando usar

- SQL, migração e constraint.
- Serialização na borda da API.
- Transação que precisa confirmar ou reverter de verdade.

O teste sobe a dependência de verdade em ambiente descartável. Testcontainers sobe Postgres, Redis ou o broker no Docker e derruba ao final. Banco compartilhado de desenvolvimento vaza dado entre execuções.

## O que afirmar

O efeito observável: linha gravada, mensagem publicada, status HTTP. Não afirme o texto interno de um log.

## Exemplo

Subir Postgres 16, aplicar a migração, postar um pedido e ler a linha com o mesmo id. O segundo teste não pode depender dessa linha.

## Armadilhas

- Chamar de integração um teste que mocka todos os colaboradores.
- Sleep para esperar o consumer. Espere a condição na fila ou na tabela.
