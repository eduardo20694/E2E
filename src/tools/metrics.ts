import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { isRiskyPath, parseCoverage } from "../lib/coverage.js";
import { analyzeFlakiness } from "../lib/flakiness.js";
import { doc, markdownTable } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";

export interface FlakinessInput {
  logs: string;
  history?: string;
  sourceCode?: string;
}

export function flakinessAnalyzer(input: FlakinessInput): ToolTextResult {
  if (!input.logs?.trim() && !input.history?.trim()) {
    return errorResult("flakiness_analyzer exige logs ou history das execuções.");
  }

  const signals = analyzeFlakiness(`${input.logs ?? ""}\n${input.history ?? ""}\n${input.sourceCode ?? ""}`);
  if (signals.length === 0) {
    return textResult(
      doc([
        "# Instabilidade",
        "Nenhum padrão clássico (tempo, seletor, dado compartilhado, rede, relógio, ordem, aleatório, retry) apareceu no texto.",
        "Se o teste falha só no CI, compare fuso, paralelismo e serviço externo com a execução local.",
        citeKnowledge(["qa-metrics", "e2e-testing"]),
      ]),
    );
  }

  const sections = signals.map((signal) =>
    [`### ${signal.title}`, signal.advice, "Evidência:", ...signal.evidence.map((line) => `- ${line.slice(0, 180)}`)].join(
      "\n",
    ),
  );

  return textResult(doc(["# Instabilidade da suíte", ...sections, citeKnowledge(["qa-metrics", "e2e-testing"])]));
}

export interface CoverageAdvisorInput {
  report: string;
  sourceCode?: string;
  filePath?: string;
}

export function codeCoverageAdvisor(input: CoverageAdvisorInput): ToolTextResult {
  if (!input.report?.trim()) {
    return errorResult("code_coverage_advisor exige report em LCOV, JSON ou texto com percentuais.");
  }

  let gaps;
  try {
    gaps = parseCoverage(input.report);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Não foi possível ler o relatório: ${message}`);
  }

  if (gaps.length === 0) {
    return textResult(
      doc([
        "# Cobertura",
        "O relatório não trouxe arquivo reconhecível. Envie LCOV (SF/DA), JSON `{ files: [{ path, uncoveredLines }] }` ou linhas `arquivo.ts 70%`.",
        citeKnowledge(["qa-metrics", "unit-testing"]),
      ]),
    );
  }

  const critical = gaps.filter((gap) => isRiskyPath(gap.file) || gap.uncoveredLines.length > 0);
  const focus = (critical.length ? critical : gaps).slice(0, 15);

  return textResult(
    doc([
      "# Lacunas de cobertura",
      "Percentual alto não cobre ramo de pagamento, permissão ou erro se essas linhas não executam.",
      input.filePath ? `Arquivo aberto: \`${input.filePath}\`.` : undefined,
      input.sourceCode
        ? "O código aberto deve ser lido junto: ramo sem teste aqui pesa mais do que um utilitário 100% coberto."
        : undefined,
      markdownTable(
        ["Arquivo", "Linhas sem execução", "Leitura"],
        focus.map((gap) => [
          gap.file.replace(/\|/g, "/"),
          gap.uncoveredLines.slice(0, 8).join(", ") || "—",
          gap.reason,
        ]),
      ),
      citeKnowledge(["qa-metrics", "mutation-testing"]),
    ]),
  );
}

export interface DefectDensityInput {
  defects: number;
  size: number;
  unit?: "kloc" | "historia" | "mudanca";
  period?: string;
}

export function defectDensityReport(input: DefectDensityInput): ToolTextResult {
  if (!Number.isFinite(input.defects) || input.defects < 0) {
    return errorResult("defect_density_report exige defects maior ou igual a zero.");
  }
  if (!Number.isFinite(input.size) || input.size <= 0) {
    return errorResult("defect_density_report exige size maior que zero (KLOC, histórias ou mudanças).");
  }

  const unit = input.unit ?? "kloc";
  const density = input.defects / input.size;
  const label = unit === "kloc" ? "defeitos por KLOC" : unit === "historia" ? "defeitos por história" : "defeitos por mudança";

  return textResult(
    doc([
      "# Densidade de defeitos",
      input.period ? `Período: ${input.period}.` : undefined,
      `**${roundMetric(density)} ${label}** (${input.defects} defeitos / ${input.size}).`,
      density > 5 && unit === "historia"
        ? "Acima de cinco defeitos por história no mesmo período pede mais teste de regra antes do merge, não mais caso E2E."
        : "Compare com o período anterior do mesmo time. Número solto, sem denominador estável, não decide nada.",
      "Densidade alta numa área de pagamento pesa mais do que a mesma densidade num texto de ajuda.",
      citeKnowledge(["qa-metrics"]),
    ]),
  );
}

export interface MttrIncident {
  id: string;
  startedAt: string;
  restoredAt: string;
}

export interface MttrInput {
  incidents: MttrIncident[];
}

export function mttrReport(input: MttrInput): ToolTextResult {
  if (!input.incidents?.length) {
    return errorResult("mttr_report exige incidents com id, startedAt e restoredAt.");
  }

  const rows = input.incidents.map((incident) => {
    const start = Date.parse(incident.startedAt);
    const end = Date.parse(incident.restoredAt);
    if (Number.isNaN(start) || Number.isNaN(end)) {
      throw new Error(`Data inválida em ${incident.id}. Use ISO-8601.`);
    }
    if (end < start) throw new Error(`${incident.id}: restoredAt é anterior a startedAt.`);
    const minutes = (end - start) / 60000;
    return { ...incident, minutes };
  });
  const mean = rows.reduce((total, row) => total + row.minutes, 0) / rows.length;

  return textResult(
    doc([
      "# MTTR",
      `Tempo médio até restaurar: **${roundMetric(mean)} minutos** em ${rows.length} incidente(s).`,
      markdownTable(
        ["Incidente", "Minutos"],
        rows.map((row) => [row.id, roundMetric(row.minutes)]),
      ),
      "MTTR mede restauração, não prevenção. Para encurtar o próximo: alerta do sintoma, smoke sintético e um dono de rollback. O caso de regressão evita a reincidência; não devolve o serviço sozinho.",
      citeKnowledge(["qa-metrics", "shift-right"]),
    ]),
  );
}

function roundMetric(value: number): string {
  return String(Math.round(value * 10) / 10);
}

export function registerMetricsTools(server: McpServer): void {
  registerTool(
    server,
    "flakiness_analyzer",
    "Analisar instabilidade",
    "Lê logs ou histórico de execução e aponta padrões de teste instável: tempo, seletor, dados, rede, relógio, ordem e retry.",
    {
      logs: z.string().optional().describe("Log ou saída da execução."),
      history: z.string().optional().describe("Histórico resumido de passes e falhas."),
      sourceCode: z.string().optional(),
    },
    (args) => flakinessAnalyzer(args as unknown as FlakinessInput),
  );

  registerTool(
    server,
    "code_coverage_advisor",
    "Aconselhar cobertura",
    "Lê um relatório de cobertura e aponta lacunas de risco, não só o percentual.",
    {
      report: z.string().describe("LCOV, JSON ou texto com arquivos e percentuais."),
      sourceCode: z.string().optional(),
      filePath: z.string().optional(),
    },
    (args) => codeCoverageAdvisor(args as unknown as CoverageAdvisorInput),
  );

  registerTool(
    server,
    "defect_density_report",
    "Densidade de defeitos",
    "Calcula defeitos pelo tamanho informado (KLOC, história ou mudança) e diz como ler o número.",
    {
      defects: z.number(),
      size: z.number().positive(),
      unit: z.enum(["kloc", "historia", "mudanca"]).optional(),
      period: z.string().optional(),
    },
    (args) => defectDensityReport(args as unknown as DefectDensityInput),
  );

  registerTool(
    server,
    "mttr_report",
    "MTTR",
    "Calcula o tempo médio até restaurar a partir dos horários de início e de restauração dos incidentes.",
    {
      incidents: z
        .array(
          z.object({
            id: z.string(),
            startedAt: z.string().describe("ISO-8601"),
            restoredAt: z.string().describe("ISO-8601"),
          }),
        )
        .min(1),
    },
    (args) => mttrReport(args as unknown as MttrInput),
  );
}
