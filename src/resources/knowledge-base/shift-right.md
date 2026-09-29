# Shift-right

Shift-right observa o sistema em produção, com tráfego e dado reais, sob controle. Não é mock. Também não é desculpa para pular o teste de antes do deploy.

## Canary release

Uma fração do tráfego real vai para a versão nova. Argo Rollouts, Flagger ou Spinnaker avançam o percentual só se erro e latência seguram. Sem métrica de abort, é um deploy lento, não um canário. Rollback volta para a versão estável sem espera de alguém acordar.

## Feature flag

LaunchDarkly, Unleash ou GrowthBook ligam o código novo para a equipe, depois 1%, 10%, 50% e 100%. O caminho antigo continua de pé com a flag desligada. O critério de cada fatia é métrica, não calendário. Remover a flag é outro passo, depois que o comportamento acalmou.

## Chaos engineering

Um experimento tem hipótese, estado estável, ação e abort. O primeiro alvo é um pod ou uma dependência, por poucos minutos, fora do pico. Litmus, Chaos Mesh ou Gremlin executam isso com blast radius escrito. Derrubar o cluster inteiro não é o primeiro experimento.

## Monitoramento sintético

Um robô (Checkly, Datadog Synthetics ou Playwright agendado) repete a jornada crítica em produção o dia inteiro, com conta sintética. Duas falhas seguidas disparam alerta. Isto não é teste de carga: uma execução por vez.

## Dark launching

O código novo processa o mesmo input real em paralelo e a resposta é comparada com a do caminho antigo. O usuário só vê o caminho antigo. O caminho novo não grava, não cobra e não envia mensagem. Dupla escrita não é dark launch.

## Smoke pós-deploy

Logo depois do deploy, health-check e login sintético confirmam que o caminho crítico responde. Checkout em produção só existe se o pedido for marcado como sintético e não gerar cobrança.

## O que isto não substitui

O defeito de regra pura tinha que morrer no unitário. O contrato quebrado tinha que morrer na integração. Shift-right pega o resto: o que só existe com escala, dado real e falha parcial.
