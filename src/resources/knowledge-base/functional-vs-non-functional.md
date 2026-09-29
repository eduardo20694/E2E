# Funcional e não funcional

## Funcional

Responde "o sistema faz a coisa certa?": cálculo, permissão, persistência, mensagem de erro, fluxo feliz e fluxo de recusa. A maior parte dos casos de teste vive aqui.

## Não funcional

Responde "o sistema faz isso de um jeito aceitável?":

- Desempenho: carga, stress, volume, resistência.
- Segurança: os riscos do OWASP Top 10 verificados como teste, não como exploração.
- Acessibilidade: WCAG, teclado, nome acessível, contraste.
- Compatibilidade: browsers e dispositivos do público real.
- Confiabilidade: recuperação, idempotência, timeout.

## Erro comum

Tratar não funcional como fase final opcional. Contraste quebrado e consulta sem índice aparecem tarde e custam caro. O plano da funcionalidade nova cita o não funcional que o risco pede, mesmo que a execução seja uma amostra e não uma certificação.
