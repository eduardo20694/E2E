# Métricas de QA

Métrica serve para decidir, não para enfeitar o relatório. Cada número abaixo mente se for lido sozinho.

## Cobertura

Percentual de linha ou ramo executado. Mostra o que nem chegou a rodar. Não mostra se o assert conferiu o valor. Cruze com mutation score e com arquivo de risco (auth, pagamento, permissão).

## Densidade de defeitos

Defeitos por tamanho da mudança ou por área. Uma área com densidade alta pede mais teste e, em geral, mais desenho. Compare períodos iguais; uma semana de release concentra defeito.

## Densidade de defeitos

Defeitos divididos por tamanho: KLOC, história ou mudança. O denominador precisa ser o mesmo entre períodos. Densidade alta em pagamento pesa mais do que a mesma densidade em texto de ajuda. A ferramenta `defect_density_report` faz a conta.

## MTTR

Tempo médio até restaurar o serviço, do início do incidente até a recuperação. Não mede prevenção. Encurta com alerta, smoke sintético e rollback com dono. O caso de regressão evita a reincidência; não devolve o serviço sozinho. A ferramenta `mttr_report` calcula a partir dos horários.

## Escape

Defeito achado em produção que a suíte ou a homologação deveria ter pego. É a métrica que importa para o cliente. Classifique a causa: faltou caso, o caso era instável, o ambiente era outro.

## Flakiness

Taxa de testes que falham e passam sem mudança de código. Acima de um punhado recorrente, a suíte perde crédito e o time começa a ignorar vermelho. Meça por teste, não só pela pipeline.

## O que não perseguir

100% de cobertura, zero defeito aberto, ou mais casos escritos na semana. Volume de caso sem risco associado é custo.
