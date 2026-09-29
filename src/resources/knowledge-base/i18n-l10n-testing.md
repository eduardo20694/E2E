# Teste de i18n e l10n

Internacionalização é o código aceitar locale. Localização é o conteúdo daquele locale estar certo.

O teste mínimo compara as chaves do catálogo com o idioma base. Chave crua na tela é defeito. Data, moeda e separador decimal seguem o locale, não uma string fixa.

Locale RTL (árabe, hebraico, persa, urdu) exige `dir` e alinhamento, não só a tradução. Pseudo-locale com texto alongado revela botão estourado antes da tradução chegar.
