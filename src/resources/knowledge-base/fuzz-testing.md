# Fuzz testing

Fuzz entrega entrada malformada e observa se o programa quebra. O oráculo é ausência de crash e de erro não tratado, não o valor de negócio.

Parser local usa o fuzz da linguagem ou Jazzer em Java. Endpoint parte do OpenAPI do próprio serviço (Schemathesis é comum em Python) e roda em ambiente local. Formulário cobre vazio, longo e tipo trocado.

Fuzz contra produção não é teste. É carga imprevisível no caminho do cliente.
