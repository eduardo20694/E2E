# Teste mobile

Appium fala com o aplicativo nativo ou híbrido por meio de um driver: UiAutomator2 no Android, XCUITest no iOS. WebdriverIO e clientes Python são cascas comuns em volta do protocolo.

## O que automatizar

Fluxo crítico de negócio no device ou simulador: entrar, concluir a tarefa principal, ver o estado final. Gesto, permissão do sistema e interrupção (ligação, rotação) entram se o risco do produto estiver ali.

## Estabilidade

- Accessibility id estável. XPath da hierarquia quebra a cada layout.
- Capability explícita de plataforma, app e activity ou bundle id.
- Estado limpo: desinstalar dado do app ou usar build de teste.
- Não misture seletor de Android e de iOS no mesmo caso. Compartilhe o roteiro, separe a capability.

## O que deixar fora

A matriz inteira de aparelhos. Escolha um atual e um atrasado do público real. O resto da regra de negócio fica em teste unitário, que não precisa de emulador.
