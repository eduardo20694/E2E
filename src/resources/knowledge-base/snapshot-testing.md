# Teste de snapshot

O snapshot grava uma saída e falha quando ela muda. Serve para um contrato pequeno: texto visível, JSON estável, papel acessível.

Não serve para a árvore HTML inteira. Classe gerada e espaço em branco fazem o teste quebrar sem defeito, e o time passa a aceitar o snapshot sem ler.

Atualizar o snapshot é uma decisão, num commit que explica a mudança de comportamento. Aceitar tudo no CI apaga a técnica.
