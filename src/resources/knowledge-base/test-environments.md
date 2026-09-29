# Ambientes de teste

Cada ambiente responde uma pergunta. Misturar as perguntas produz um teste que não falha pelo motivo certo.

| Ambiente | Natureza | O que roda | O que não roda |
| --- | --- | --- | --- |
| Dev | Mock | Unitário, dublê de relógio e de HTTP | Banco real, browser, produção |
| Teste | Real isolado | Integração com Testcontainers, contrato, fila local | Terceiro pago, dado de cliente, produção |
| Staging | Real compartilhado, dado fake | E2E, acessibilidade da tela nova, smoke largo | Carga destrutiva, cliente real |
| Produção | Real | Smoke sintético, canário, flag, sintético 24/7, dark launch | Suíte inteira, carga sem acordo, dado de teste visível ao cliente |

## Mockado

A unidade não fala com rede nem disco. O dublê devolve o que o caso precisa. Serve para a regra. Não serve para provar que a migração aplica.

## Ambiente real isolado

O banco, a fila ou o broker sobem com o teste e descem com ele. Testcontainers é o caminho usual. O teste não depende de linha deixada por outra pessoa. Serviço de terceiro com custo continua mockado.

## Produção real

O caminho crítico não está mockado. A conta é sintética, o blast radius está escrito e o rollback tem métrica. Sem esses três, o teste em produção é incidente.

## Critério de entrada

Build instalado, migração aplicada no ambiente da faixa, e uma forma de jogar fora o dado daquele teste. Sem isso o resultado mede o ambiente, não a mudança.
