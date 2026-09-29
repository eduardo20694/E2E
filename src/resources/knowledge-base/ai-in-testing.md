# IA em teste

Modelo de linguagem acelera rascunho: caso a partir de uma regra, dados sintéticos, leitura de log instável, revisão de assert fraco. Não substitui o oráculo. Se o modelo inventa o resultado esperado a partir do mesmo código que pode estar errado, o teste congela o defeito.

## Onde ajuda

- Primeira versão de Gherkin, tabela de decisão e plano, para um humano cortar.
- Explicar um log de falha e apontar padrão de instabilidade.
- Sugerir lacuna em cobertura de arquivo de risco.

## Onde não delegar

- Aceitar o teste gerado sem rodar.
- Gerar exploração ofensiva ou payload de ataque no lugar de um checklist.
- Tratar resposta do modelo como evidência de que o produto funciona.

## Higiene

Código de produção e dado de cliente não vão para um prompt externo sem acordo. O rascunho entra no repositório pelo mesmo review do código. A suíte continua determinística: sem chamada de modelo no meio do assert.
