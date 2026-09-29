# Teste unitário

Teste unitário exercita uma unidade pequena — função, método ou classe — isolada das dependências reais. O resultado depende só da entrada e do estado que o teste montou.

## Quando usar

- Regra de negócio pura: cálculo, validação, transição de estado.
- Ramificações que seriam caras de reproduzir pela interface.
- Regressão de um bug que cabe numa função.

Não use teste unitário para provar que o banco grava, que o browser renderiza ou que dois serviços conversam. Isso é integração ou E2E.

## Estrutura

Arrange, Act, Assert. Um comportamento por caso. O nome diz a condição e o resultado, não o número do ticket.

Dependência externa (relógio, HTTP, repositório) entra por parâmetro ou é substituída por um dublê. Mockar o que está dentro da mesma unidade esconde o comportamento.

## Exemplo

```ts
it("recusa idade abaixo de 18", () => {
  expect(canSubscribe({ age: 17 })).toBe(false);
});
```

## Armadilhas

- Assert que só verifica se a função foi chamada.
- Snapshot gigante de objeto sem contrato.
- Teste que lê variável global deixada pelo caso anterior.
