# Teste de ponta a ponta

Teste E2E percorre o sistema como o usuário: navegador ou cliente real, contra a aplicação montada. Cypress, Playwright e Selenium dirigem o browser. A diferença prática está em espera automática, depuração e modelo de processo, não no objetivo.

## Quando usar

Um fluxo de alto risco por jornada: comprar, pagar, entrar, recuperar senha. A pirâmide fica invertida quando toda regra vira E2E.

## Estabilidade

- Localizador por papel acessível ou `data-testid`.
- Esperar URL, texto ou resposta, nunca `sleep` fixo.
- Dado criado pelo próprio teste e apagado ao final.
- Um assert de resultado visível. Abrir a página não é teste.

## Exemplo

Entrar, adicionar um item, confirmar o pedido e ver o número do pedido na tela de sucesso.

## Armadilhas

- XPath absoluto e classe gerada por CSS-in-JS.
- Compartilhar login entre testes paralelos.
- Repetir no E2E a matriz de bordas que o unitário já cobre.
