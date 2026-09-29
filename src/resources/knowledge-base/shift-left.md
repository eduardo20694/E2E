# Shift-left

Shift-left traz a descoberta do defeito para perto de quem escreveu o código, antes do deploy.

## O que entra

- Exemplo da regra no refinamento.
- Teste unitário mockado no mesmo pull request.
- Contrato e integração em ambiente real isolado (Testcontainers), ainda no CI.
- E2E em staging com dado fake, setup e teardown.

## O que isto não vê

Tráfego real, combinação de dado de produção, escala e falha parcial de uma zona. Isso é shift-right. Escrever mais teste unitário não substitui o canário, e o canário não substitui o teste unitário.

## Como saber se está acontecendo

O pull request da regra traz o teste que falha se a regra quebrar. A suíte de integração sobe o banco do zero. Ninguém espera a homologação compartilhada para descobrir que a constraint recusa o pedido.
