import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectStack, stackSummary } from "../lib/detect.js";
import { doc, markdownTable } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";
import type { ProjectContextInput } from "../lib/schema.js";

export interface TestPlanInput extends ProjectContextInput {
  feature: string;
  scope?: string;
  risks?: string;
  deadline?: string;
}

export function generateTestPlan(input: TestPlanInput): ToolTextResult {
  if (!input.feature?.trim()) {
    return errorResult("generate_test_plan exige feature com o que será testado.");
  }

  const stack = detectStack(input.projectRoot);
  return textResult(
    doc([
      `# Plano de teste — ${input.feature}`,
      "## Objetivo",
      `Demonstrar que ${input.feature} cumpre a regra de negócio e não regride o fluxo vizinho.`,
      "## Escopo",
      input.scope ? `Dentro: ${input.scope}` : "Dentro: a funcionalidade descrita e as integrações diretas (API e persistência).",
      "Fora: teste de carga completo e compatibilidade exaustiva, salvo risco explícito.",
      "## Riscos",
      input.risks ?? "Risco principal não informado. Trate autenticação, perda de dado e regressão do fluxo feliz como prioridade até haver lista melhor.",
      "## Stack detectada",
      stackSummary(stack),
      "## Abordagem por camada",
      "- Unitário: regra pura e bordas numéricas.",
      "- Integração: contrato da API e persistência, com Testcontainers se houver banco.",
      "- E2E: um fluxo feliz e um fluxo de recusa.",
      "- Não funcional: acessibilidade da tela nova e um smoke de latência se o caminho for síncrono.",
      "## Critérios de entrada",
      "- História com resultado observável, build instalando e ambiente de teste com dados descartáveis.",
      "## Critérios de saída",
      "- Casos de risco alto executados, defeitos bloqueadores fechados ou aceitos, e suíte automatizada da mudança verde no CI.",
      "## Cronograma",
      input.deadline
        ? `Marco informado: ${input.deadline}. Desenho dos casos no início, automação junto do código, execução final no ambiente integrado.`
        : "Sem data. Sugestão: desenho no primeiro dia, automação em paralelo ao desenvolvimento, execução no último terço.",
      input.sourceCode ? "O código aberto entra no escopo técnico da mudança, não substitui o critério de negócio." : undefined,
      citeKnowledge(["test-environments", "functional-vs-non-functional", "shift-left", "shift-right"]),
    ]),
  );
}

const SEVERITY_HINTS: Array<{ level: string; pattern: RegExp }> = [
  { level: "blocker", pattern: /perda de dado|data loss|não abre|cannot start|produção fora|down/i },
  { level: "critical", pattern: /crash|exception|500|pagamento|cobran|security|vazamento/i },
  { level: "major", pattern: /errado|incorreto|não salva|não funciona|workaround/i },
  { level: "minor", pattern: /texto|label|alinhamento|typo|cosmetic/i },
];

export interface BugReportInput {
  description: string;
  environment?: string;
  severity?: "blocker" | "critical" | "major" | "minor" | "trivial";
  sourceCode?: string;
  filePath?: string;
}

export function generateBugReport(input: BugReportInput): ToolTextResult {
  if (!input.description?.trim()) {
    return errorResult("generate_bug_report exige description do problema, mesmo informal.");
  }

  const severity =
    input.severity ??
    SEVERITY_HINTS.find((hint) => hint.pattern.test(input.description))?.level ??
    "major";
  const priority = severity === "blocker" || severity === "critical" ? "alta" : severity === "major" ? "média" : "baixa";
  const sentences = input.description.split(/(?<=[.!;])\s+/).map((item) => item.trim()).filter(Boolean);

  return textResult(
    doc([
      "# Relato de defeito",
      `**Título:** ${sentences[0]?.slice(0, 110) ?? "Defeito observado"}`,
      `**Severidade:** ${severity}`,
      `**Prioridade:** ${priority}`,
      `**Ambiente:** ${input.environment ?? "não informado — completar build, navegador ou device e dados usados"}`,
      input.filePath ? `**Código relacionado:** \`${input.filePath}\`` : undefined,
      "## Passos",
      sentences.map((sentence, index) => `${index + 1}. ${sentence}`).join("\n"),
      "## Esperado",
      "O comportamento descrito na regra de negócio, sem erro e com o estado persistido coerente.",
      "## Atual",
      input.description,
      "## Evidência",
      input.sourceCode
        ? "Há trecho de código no contexto. Anexe também a resposta HTTP, o log ou o print do estado na tela."
        : "Anexe log, resposta da API ou captura. Sem evidência o relato não fecha.",
      citeKnowledge(["qa-metrics"]),
    ]),
  );
}

export interface TraceabilityInput {
  requirements: Array<{ id: string; description: string }>;
  testCases: Array<{ id: string; title: string; covers?: string[] }>;
  sourceCode?: string;
}

export function generateTraceabilityMatrix(input: TraceabilityInput): ToolTextResult {
  if (!input.requirements?.length) {
    return errorResult("generate_traceability_matrix exige requirements com id e description.");
  }

  const cases = input.testCases ?? [];
  const rows = input.requirements.map((requirement) => {
    const linked = cases.filter((testCase) => covers(requirement, testCase));
    return [
      requirement.id,
      requirement.description.replace(/\|/g, "/").slice(0, 80),
      linked.map((testCase) => testCase.id).join(", ") || "—",
      linked.length ? "coberto" : "lacuna",
    ];
  });
  const gaps = rows.filter((row) => row[3] === "lacuna");

  return textResult(
    doc([
      "# Matriz de rastreabilidade",
      input.sourceCode ? "Requisitos cruzados com os casos informados e o código de contexto." : undefined,
      markdownTable(["Requisito", "Descrição", "Casos", "Situação"], rows),
      gaps.length
        ? `Sem caso ligado: ${gaps.map((row) => row[0]).join(", ")}. Esses itens entram primeiro no plano.`
        : "Todo requisito informado tem ao menos um caso associado pelo id ou por sobreposição de palavras.",
      citeKnowledge(["qa-metrics", "bdd"]),
    ]),
  );
}

function covers(
  requirement: { id: string; description: string },
  testCase: { id: string; title: string; covers?: string[] },
): boolean {
  if (testCase.covers?.some((id) => id.toLowerCase() === requirement.id.toLowerCase())) return true;
  const tokens = requirement.description
    .toLowerCase()
    .split(/[^a-z0-9áéíóúãõç]+/i)
    .filter((token) => token.length > 4);
  const haystack = `${testCase.title} ${testCase.id}`.toLowerCase();
  const hits = tokens.filter((token) => haystack.includes(token));
  return hits.length >= 2 || haystack.includes(requirement.id.toLowerCase());
}

export function registerTestPlanTools(server: McpServer): void {
  registerTool(
    server,
    "generate_test_plan",
    "Gerar plano de teste",
    "Gera um plano com escopo, riscos, camadas, cronograma e critérios de entrada e saída.",
    {
      feature: z.string(),
      scope: z.string().optional(),
      risks: z.string().optional(),
      deadline: z.string().optional(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
    },
    (args) => generateTestPlan(args as unknown as TestPlanInput),
  );

  registerTool(
    server,
    "generate_bug_report",
    "Gerar relato de defeito",
    "Transforma uma descrição informal em relato com passos, esperado, atual, severidade e prioridade.",
    {
      description: z.string(),
      environment: z.string().optional(),
      severity: z.enum(["blocker", "critical", "major", "minor", "trivial"]).optional(),
      sourceCode: z.string().optional(),
      filePath: z.string().optional(),
    },
    (args) => generateBugReport(args as unknown as BugReportInput),
  );

  registerTool(
    server,
    "generate_traceability_matrix",
    "Matriz de rastreabilidade",
    "Cruza requisitos com casos de teste e aponta requisito sem cobertura.",
    {
      requirements: z.array(z.object({ id: z.string(), description: z.string() })).min(1),
      testCases: z
        .array(
          z.object({
            id: z.string(),
            title: z.string(),
            covers: z.array(z.string()).optional(),
          }),
        )
        .optional(),
      sourceCode: z.string().optional(),
    },
    (args) => generateTraceabilityMatrix(args as unknown as TraceabilityInput),
  );
}
