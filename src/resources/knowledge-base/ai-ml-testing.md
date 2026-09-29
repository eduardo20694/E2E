# Teste de IA e ML

Modelo pede métrica num conjunto que ele não usou para treinar, a mesma métrica por fatia, e um alerta de drift quando a entrada de produção deixa de parecer a do treino.

Viés aparece na fatia, não na média. Retreino compara com o modelo anterior.

Em volta do modelo, o sistema precisa de fallback quando a previsão não vem ou vem baixa. Esse fallback é teste de software comum.

Teste A/B de proporção combina tamanho de amostra, significância e poder antes de olhar o gráfico. Parar no primeiro dia verde invalida a conta.

Prompt de LLM se testa pelo contrato da saída: formato, vazio, fora de escopo. A suíte determinística não depende de uma chamada de rede a cada commit.
