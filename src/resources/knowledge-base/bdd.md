# BDD

Behavior-Driven Development descreve comportamento em linguagem que negócio e engenharia leem igual. Gherkin é o formato comum: Funcionalidade, Cenário, Dado, Quando, Então.

## Um bom cenário

- Fala do que o usuário percebe, não da tabela ou da classe.
- Um Quando principal.
- Então verificável, sem "o sistema funciona".
- Contexto no Dado, ação no Quando, resultado no Então.

## Exemplo

```gherkin
# language: pt
Funcionalidade: assinatura
  Cenário: menor de idade não assina
    Dado uma pessoa com 17 anos
    Quando ela pede a assinatura
    Então a assinatura é recusada
    E a mensagem explica o limite de idade
```

## Automação

O passo reutilizável chama código de teste. Passo que só existe para um cenário, com detalhe de seletor dentro da frase, deixa de ser especificação.

BDD não obriga Cucumber. A conversa sobre exemplos antes do código já é o ganho. A ferramenta entra se o time executa aqueles exemplos.
