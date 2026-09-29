# Teste de contrato de API

Contrato é o acordo entre cliente e servidor: rota ou operação, campos, tipos, status e erros. O teste de contrato quebra quando o acordo muda, mesmo que a tela ainda não exista.

## REST

Afirme status, cabeçalho e corpo. Casos mínimos: sucesso, validação (400 ou 422), autenticação (401), autorização (403), ausência (404) e conflito (409) quando a operação pode repetir.

## GraphQL

HTTP 200 convive com `errors`. O teste olha `data` e `errors`. Campo obrigatório ausente e profundidade excessiva são casos, não detalhe.

## gRPC

O oráculo é o status canônico: OK, INVALID_ARGUMENT, NOT_FOUND, UNAUTHENTICATED, PERMISSION_DENIED. Não invente um HTTP por cima.

## Contrato do consumidor

Pact e ferramentas parecidas gravam o que o consumidor espera e verificam no provedor. Útil quando os times publicam em ritmos diferentes. O schema OpenAPI ou proto versionado é o documento; o teste é a trava.

## Borda

String vazia, unicode, número no limite, lista vazia, id de outro tenant. O último é autorização, não só "formato".
