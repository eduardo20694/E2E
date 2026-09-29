# Otimização da suíte no CI

## Impacto

No pull request, rode o que o diff pode quebrar. Na linha principal, rode tudo. Atalho por nome de arquivo erra quando o teste mora em outra pasta. Um mapa ou a cobertura da última execução corrige.

## Paralelismo

Shard por arquivo, com dado isolado. Teste que divide banco não fica paralelo até deixar de dividir. E2E não ocupa o mesmo shard do unitário.

## Quarentena

Teste instável sai do job que bloqueia o merge, continua rodando todo dia, ganha dono e prazo. Sem prazo, a quarentena vira o lugar onde o teste morre. Retry infinito não é quarentena.
