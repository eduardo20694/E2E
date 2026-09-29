# Regressão visual

Regressão visual compara uma captura atual com uma linha de base aprovada. Percy e Applitools encaixam em fluxo de browser. Chromatic encaixa em Storybook.

## Quando usar

Tela de layout caro: checkout, dashboard, biblioteca de componentes. Não snapshot de toda página logada com nome de usuário e relógio.

## Higiene da linha de base

- Máscara em região dinâmica (anúncio, hora, avatar).
- Fonte e viewport fixos.
- Aprovação humana do diff. Aceitar tudo no CI apaga a técnica.
- Uma linha de base por viewport que o público usa, não por toda combinação.

## O que a ferramenta não vê

Foco de teclado, ordem de leitura e texto alternativo. Isso continua em teste de acessibilidade. Pixel igual não significa fluxo correto: o botão pode estar bonito e apontar para o lugar errado.
