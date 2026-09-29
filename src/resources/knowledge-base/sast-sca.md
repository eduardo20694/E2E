# SAST e SCA

SAST lê o código. ESLint com regras de segurança, Bandit, SpotBugs ou SonarQube apontam eval, concatenação de comando, segredo no fonte. O gate olha código novo. Zerar o legado num sprint só ensina o time a ignorar o aviso.

SCA lê a dependência. Dependabot abre o pull request no GitHub. Snyk entra quando a política pede licença e CVE fora desse fluxo. Duas ferramentas com limiares diferentes bloqueiam o merge por motivos que brigam entre si.

Nenhum dos dois prova que o fluxo de autorização funciona. Isso continua sendo teste.
