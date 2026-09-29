import { doc } from "./format.js";

/**
 * Bloco obrigatório das tools de produção. Deixa explícito que o alvo é
 * tráfego real, quais travas existem, e que isso não substitui o teste pré-deploy.
 */
export function productionNotice(activity: string): string {
  return doc([
    `> **Isto roda de verdade em produção.** ${activity} Não é mock.`,
    "## Cuidados",
    "- Conta e dado sintéticos, marcados como teste. Cliente real, cobrança real e e-mail real ficam fora.",
    "- Blast radius escrito antes de começar: uma rota, um pod ou um percentual pequeno.",
    "- Rollback automático com métrica, limite e dono. Sem abort, o experimento não sobe.",
    "- Permissão e janela combinadas com quem opera produção.",
    "## Shift-left não substitui isto, e isto não substitui shift-left",
    "Shift-left pega o defeito antes do deploy: unitário, contrato, integração isolada, E2E em staging. Shift-right pega o que só aparece com tráfego, dado e escala reais. Os dois convivem.",
  ]);
}
