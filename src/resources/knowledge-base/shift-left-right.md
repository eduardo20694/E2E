# Shift-left e shift-right

Os dois artigos seguintes separam as faixas. Este arquivo existe para quem ainda referencia o nome antigo.

- [Shift-left](e2e://knowledge/shift-left): antes do deploy. Mock no unitário, ambiente real isolado na integração, staging no E2E.
- [Shift-right](e2e://knowledge/shift-right): em produção. Smoke sintético, canário, feature flag, chaos com blast radius, monitoramento sintético e dark launch.

Um não substitui o outro. Left evita que o defeito saia do branch. Right pega o que só o tráfego real revela.
