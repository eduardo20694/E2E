# Gestão de dados de teste

Dado de teste vem de três lugares, e só um deles é aceitável para pessoa real.

## Sintético

Faker ou Mockaroo, com semente fixa. O valor parece e-mail e não é de ninguém. A suíte reproduz a mesma linha amanhã.

## Mascarado

Quando a estrutura tem que ser a de produção (volume, cardinalidade), o identificador vira token irreversível. Truncar o e-mail não anonimiza. LGPD e GDPR tratam dado de pessoa no ambiente de teste com a mesma seriedade do produto.

## Seed

Factory constrói o mínimo que o caso pede. Fixture grande só quando o grafo é o assunto do teste. O seed roda em banco que nasce e morre com o teste.

## Virtualização

WireMock ou Hoverfly substituem pagamento, e-mail e outro terceiro. Não substituem o banco deste sistema.
