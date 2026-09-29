# Golden master

Código legado sem teste não se refatora no escuro. O characterization test, ou golden master, grava a saída atual para um conjunto de entradas e falha se a refatoração mudar essa saída.

O golden não diz que o legado está certo. Diz que você não mudou o que ele faz. Comportamento errado que precisa continuar errado até um segundo passo também fica gravado, de propósito.

Congele relógio e aleatoriedade. Quando a mudança for intencional, aprove o arquivo de baseline sozinho, separado do commit que mexe na estrutura.
