# Mutation testing

Mutation testing altera o código de produção (um operador, uma condição, um retorno) e reroda a suíte. Se algum teste falha, o mutante morreu. Se a suíte continua verde, o mutante sobreviveu: a suíte não segurou aquela mudança.

Ferramentas usuais: Stryker (JavaScript e TypeScript), PIT (Java), mutmut (Python).

## Como ler o score

Score = mutantes mortos / mutantes válidos.

- Abaixo de 60%: a suíte passa sem proteger regressão. Faltam asserts de resultado.
- De 60% a 80%: utilizável. Olhe sobreviventes em código de negócio.
- Acima de 80%: forte. Separe mutante equivalente (a mudança não altera o comportamento observável) de lacuna real.

Cobertura de linha alta com score baixo é comum: a linha executou, ninguém conferiu o valor.

## Como começar

Aponte a ferramenta para um módulo, não para o repositório inteiro. Exclua teste, migração gerada e código de terceiros. Use o runner que o projeto já tem (Vitest, Jest, pytest, JUnit).

## Armadilha

Perseguir 100%. Mutante equivalente consome tempo e não é defeito da suíte.
