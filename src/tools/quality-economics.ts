import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { doc, markdownTable } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";

const DEFAULT_COST = { dev: 1, qa: 5, staging: 15, producao: 50 } as const;

export interface CostInput {
  defects?: Partial<Record<keyof typeof DEFAULT_COST, number>>;
  costs?: Partial<Record<keyof typeof DEFAULT_COST, number>>;
}

export function calculateCostOfQuality(input: CostInput): ToolTextResult {
  const costs = { ...DEFAULT_COST, ...input.costs };
  const defects = {
    dev: input.defects?.dev ?? 0,
    qa: input.defects?.qa ?? 0,
    staging: input.defects?.staging ?? 0,
    producao: input.defects?.producao ?? 0,
  };
  const rows = (Object.keys(costs) as Array<keyof typeof costs>).map((phase) => {
    const weight = costs[phase];
    const count = defects[phase];
    return [phase, String(weight), String(count), String(weight * count)];
  });
  const total = rows.reduce((sum, row) => sum + Number(row[3]), 0);

  return textResult(
    doc([
      "# Custo relativo da qualidade",
      "Os pesos padrão (1, 5, 15, 50) são um modelo de planejamento para comparar fases, não uma medida universal. Passe costs se o time tiver número próprio.",
      markdownTable(["Fase", "Peso", "Defeitos", "Custo relativo"], rows),
      `Total relativo: **${total}**.`,
      total === 0
        ? "Sem contagem de defeitos, a tabela só mostra o peso. O defeito em produção pesa mais porque o cliente já viu."
        : "Se o custo relativo de produção domina, o próximo caso entra antes do deploy, na fase em que o peso é menor.",
      citeKnowledge(["cost-of-quality", "qa-metrics"]),
    ]),
  );
}

export interface RoiInput {
  name: string;
  runsPerMonth: number;
  manualMinutes: number;
  automationMinutes: number;
  maintenanceMinutesPerMonth?: number;
  stability?: number;
}

export function suggestAutomationRoi(input: RoiInput): ToolTextResult {
  if (!input.name?.trim()) return errorResult("suggest_automation_roi exige name do teste.");
  if (input.runsPerMonth <= 0 || input.manualMinutes <= 0 || input.automationMinutes <= 0) {
    return errorResult("runsPerMonth, manualMinutes e automationMinutes precisam ser maiores que zero.");
  }

  const maintenance = input.maintenanceMinutesPerMonth ?? 30;
  const stability = input.stability ?? 3;
  const savedPerMonth = input.runsPerMonth * input.manualMinutes - maintenance;
  const payback = savedPerMonth <= 0 ? Infinity : input.automationMinutes / savedPerMonth;
  const worth = stability >= 3 && payback <= 6;

  return textResult(
    doc([
      `# ROI de automação — ${input.name}`,
      worth
        ? "**Vale automatizar.** A tela ou o fluxo é estável o bastante e o retorno cabe em poucos meses."
        : "**Não automatize ainda.** Ou o fluxo muda demais, ou o tempo de escrita não se paga.",
      `- Execuções por mês: ${input.runsPerMonth}. Manual: ${input.manualMinutes} min. Escrita: ${input.automationMinutes} min.`,
      `- Manutenção estimada: ${maintenance} min/mês. Estabilidade (1 frágil, 5 estável): ${stability}.`,
      savedPerMonth <= 0
        ? "A manutenção come toda a economia. Automatizar aumenta custo."
        : `Retorno aproximado: ${payback.toFixed(1)} meses.`,
      stability < 3 ? "Estabilidade baixa: o teste de UI vai quebrar mais do que economiza. Cubra a regra em unitário." : undefined,
      citeKnowledge(["cost-of-quality"]),
    ]),
  );
}

export function registerEconomicsTools(server: McpServer): void {
  registerTool(
    server,
    "calculate_cost_of_quality",
    "Custo da qualidade",
    "Estima o custo relativo de defeitos em dev, QA, staging e produção com pesos editáveis.",
    {
      defects: z
        .object({
          dev: z.number().optional(),
          qa: z.number().optional(),
          staging: z.number().optional(),
          producao: z.number().optional(),
        })
        .optional(),
      costs: z
        .object({
          dev: z.number().optional(),
          qa: z.number().optional(),
          staging: z.number().optional(),
          producao: z.number().optional(),
        })
        .optional(),
    },
    (args) => calculateCostOfQuality(args as unknown as CostInput),
  );

  registerTool(
    server,
    "suggest_automation_roi",
    "ROI de automação",
    "Diz se vale automatizar um caso a partir da frequência, do tempo manual, do custo de escrita e da estabilidade.",
    {
      name: z.string(),
      runsPerMonth: z.number().positive(),
      manualMinutes: z.number().positive(),
      automationMinutes: z.number().positive(),
      maintenanceMinutesPerMonth: z.number().nonnegative().optional(),
      stability: z.number().min(1).max(5).optional(),
    },
    (args) => suggestAutomationRoi(args as unknown as RoiInput),
  );
}
