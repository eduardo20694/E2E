# Teste baseado em propriedade

Em vez de um exemplo, o teste declara uma propriedade e a biblioteca sorteia centenas de entradas. fast-check no JavaScript, Hypothesis no Python, jqwik no Java (família QuickCheck).

Uma propriedade boa é uma frase que continua verdadeira para qualquer entrada do domínio: a inversa desfaz, a saída cabe no intervalo, ordenar duas vezes é igual a ordenar uma.

Propriedade inventada congela um acidente do código. Leia a regra antes de escrever o `assert`.

Quando achar um contraexemplo, a biblioteca encolhe o caso. Guarde esse caso mínimo como teste de exemplo. Ele documenta o furo melhor do que o sorteio inteiro.
