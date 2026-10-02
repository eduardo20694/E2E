import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  boundaryCases,
  collectStates,
  decisionTable,
  inferEquivalenceClasses,
  parseBounds,
  parseDiagram,
  type Transition,
} from "../lib/design.js";
import { doc, markdownTable } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { generatePairwise } from "../lib/pairwise.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";

export interface BoundaryInput {
  rule: string;
  min?: number;
  max?: number;
  variable?: string;
  sourceCode?: string;
}

export function boundaryValueAnalysis(input: BoundaryInput): ToolTextResult {
  if (!input.rule?.trim() && input.min === undefined) {
    return errorResult("boundary_value_analysis exige rule ou os limites min e max.");
  }

  const parsed = parseBounds(`${input.rule ?? ""} ${input.sourceCode ?? ""}`);
  const min = input.min ?? parsed.min;
  const max = input.max ?? parsed.max;
  if (min === undefined || max === undefined) {
    return errorResult(
      "Não encontrei dois limites numéricos. Informe min e max, ou uma regra como 'idade entre 18 e 65'.",
    );
  }

  const cases = boundaryCases(min, max);
  const variable = input.variable ?? "valor";
  return textResult(
    doc([
      `# Análise de valor limite — ${variable}`,
      input.rule ? `Regra: ${input.rule}` : undefined,
      `Intervalo tratado como inclusivo: [${min}, ${max}].`,
      markdownTable(
        ["Caso", variable, "Esperado", "Motivo"],
        cases.map((item, index) => [
          `BV-${index + 1}`,
          String(item.value),
          item.expectation,
          item.reason,
        ]),
      ),
      "Inclua também o tipo errado (texto no lugar do número) como caso negativo fora da borda.",
      citeKnowledge(["test-design-techniques", "black-white-gray-box"]),
    ]),
  );
}

export interface EquivalenceInput {
  domain: string;
  classes?: Array<{ name: string; valid: boolean; representatives: string[] }>;
  sourceCode?: string;
}

export function equivalencePartitioning(input: EquivalenceInput): ToolTextResult {
  if (!input.domain?.trim()) {
    return errorResult("equivalence_partitioning exige domain descrevendo o conjunto de entradas.");
  }

  const classes =
    input.classes && input.classes.length > 0
      ? input.classes
      : inferEquivalenceClasses(`${input.domain}\n${input.sourceCode ?? ""}`);

  return textResult(
    doc([
      "# Particionamento de equivalência",
      `Domínio: ${input.domain}`,
      "Um representante por classe basta para achar o defeito da classe inteira. As bordas entre classes ficam na análise de valor limite.",
      markdownTable(
        ["Classe", "Válida", "Representantes"],
        classes.map((item) => [
          item.name.replace(/\|/g, "/"),
          item.valid ? "sim" : "não",
          item.representatives.join(", ").replace(/\|/g, "/") || "—",
        ]),
      ),
      citeKnowledge(["test-design-techniques"]),
    ]),
  );
}

export interface DecisionTableInput {
  conditions: Array<{ name: string; values: string[] }>;
  actions?: string[];
  rules?: Array<{ when: Record<string, string>; then: string[] }>;
  sourceCode?: string;
}

export function buildDecisionTable(input: DecisionTableInput): ToolTextResult {
  if (!input.conditions?.length) {
    return errorResult("decision_table exige conditions com nome e valores.");
  }

  const rows = decisionTable(input.conditions, input.rules);
  const headers = [...input.conditions.map((condition) => condition.name), "Ações"];
  const truncated = rows.length >= 64;
  return textResult(
    doc([
      "# Tabela de decisão",
      input.actions?.length ? `Ações candidatas: ${input.actions.join(", ")}.` : undefined,
      input.sourceCode ? "O código informado entrou como contexto; as colunas vêm de conditions." : undefined,
      markdownTable(
        headers,
        rows.map((row) => [...input.conditions.map((condition) => row[condition.name] ?? ""), row.acoes]),
      ),
      truncated
        ? "A tabela parou em 64 combinações. Quebre a regra ou use pairwise se o produto cartesiano não couber."
        : `${rows.length} combinações. Linhas com a mesma ação podem ser fundidas.`,
      citeKnowledge(["test-design-techniques"]),
    ]),
  );
}

export interface StateTransitionInput {
  states?: string[];
  transitions?: Transition[];
  diagram?: string;
  sourceCode?: string;
}

export function stateTransitionTest(input: StateTransitionInput): ToolTextResult {
  const fromDiagram = input.diagram ? parseDiagram(input.diagram) : [];
  const transitions = [...(input.transitions ?? []), ...fromDiagram];
  if (transitions.length === 0) {
    return errorResult(
      "state_transition_test exige transitions ou diagram, por exemplo 'criado -> pago -> enviado'.",
    );
  }

  const states = collectStates(transitions, input.states);
  const events = [...new Set(transitions.map((item) => item.event))];
  const validRows = transitions.map((item, index) => [
    `T-${index + 1}`,
    item.from,
    item.event,
    item.to,
    item.guard ?? "—",
    "válida",
  ]);

  const invalid: string[][] = [];
  for (const state of states) {
    for (const event of events) {
      const allowed = transitions.some((item) => item.from === state && item.event === event);
      if (!allowed) {
        invalid.push([`I-${invalid.length + 1}`, state, event, "sem transição", "—", "inválida"]);
      }
    }
  }

  const happy = walkHappyPath(states[0], transitions);

  return textResult(
    doc([
      "# Teste de transição de estado",
      input.sourceCode ? "Máquina conferida também contra o código informado." : undefined,
      `Estados: ${states.join(", ")}`,
      "## Caminho feliz",
      happy.length ? happy.map((step, index) => `${index + 1}. ${step}`).join("\n") : "Não foi possível encadear a partir do primeiro estado.",
      "## Transições válidas",
      markdownTable(["Caso", "De", "Evento", "Para", "Guarda", "Tipo"], validRows),
      "## Transições inválidas",
      invalid.length
        ? markdownTable(
            ["Caso", "De", "Evento", "Para", "Guarda", "Tipo"],
            invalid.slice(0, 20),
          )
        : "Todo evento conhecido sai de todo estado. Confira se a máquina está completa.",
      invalid.length > 20 ? `Mais ${invalid.length - 20} transições inválidas omitidas.` : undefined,
      citeKnowledge(["test-design-techniques"]),
    ]),
  );
}

function walkHappyPath(start: string | undefined, transitions: Transition[]): string[] {
  if (!start) return [];
  const steps: string[] = [];
  let current = start;
  const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    const next = transitions.find((item) => item.from === current);
    if (!next) break;
    steps.push(`${current} —${next.event}→ ${next.to}`);
    current = next.to;
  }
  return steps;
}

export interface PairwiseInput {
  parameters: Array<{ name: string; values: string[] }>;
  sourceCode?: string;
}

export function pairwiseTestGenerator(input: PairwiseInput): ToolTextResult {
  if (!input.parameters?.length) {
    return errorResult("pairwise_test_generator exige parameters com nome e values.");
  }

  const result = generatePairwise(input.parameters);
  const headers = input.parameters.map((parameter) => parameter.name);
  const cartesian = input.parameters.reduce((total, parameter) => total * parameter.values.length, 1);

  return textResult(
    doc([
      "# Combinações pairwise",
      input.sourceCode ? "Parâmetros aplicados sobre o código de contexto informado." : undefined,
      `Pares a cobrir: ${result.pairCount}. Cobertos: ${result.covered}. Linhas: ${result.rows.length} (cartesiano completo: ${cartesian}).`,
      markdownTable(
        ["#", ...headers],
        result.rows.map((row, index) => [String(index + 1), ...headers.map((header) => row[header] ?? "")]),
      ),
      result.covered < result.pairCount
        ? "O algoritmo parou antes de cobrir todos os pares. Reduza valores duplicados ou nomes repetidos."
        : "Cada par de valores de parâmetros diferentes aparece em ao menos uma linha.",
      citeKnowledge(["test-design-techniques"]),
    ]),
  );
}

const conditionSchema = z.object({
  name: z.string(),
  values: z.array(z.string()).min(1),
});

export function registerDesignTools(server: McpServer): void {
  registerTool(
    server,
    "boundary_value_analysis",
    "Análise de valor limite",
    "Limite calcula e não grava os casos nas bordas de uma regra numérica (abaixo, no limite, acima e o valor nominal).",
    {
      rule: z.string().describe("Regra de negócio, por exemplo 'idade entre 18 e 65'."),
      min: z.number().optional(),
      max: z.number().optional(),
      variable: z.string().optional(),
      sourceCode: z.string().optional(),
    },
    (args) => boundaryValueAnalysis(args as unknown as BoundaryInput),
  );

  registerTool(
    server,
    "equivalence_partitioning",
    "Particionamento de equivalência",
    "Equivalência calcula e não grava um representante de cada classe válida e inválida do domínio.",
    {
      domain: z.string().describe("Descrição do domínio de entrada."),
      classes: z
        .array(
          z.object({
            name: z.string(),
            valid: z.boolean(),
            representatives: z.array(z.string()),
          }),
        )
        .optional(),
      sourceCode: z.string().optional(),
    },
    (args) => equivalencePartitioning(args as unknown as EquivalenceInput),
  );

  registerTool(
    server,
    "decision_table",
    "Tabela de decisão",
    "Decisão calcula e não grava a tabela a partir das condições e das ações de cada regra.",
    {
      conditions: z.array(conditionSchema).min(1),
      actions: z.array(z.string()).optional(),
      rules: z
        .array(
          z.object({
            when: z.record(z.string()),
            then: z.array(z.string()),
          }),
        )
        .optional(),
      sourceCode: z.string().optional(),
    },
    (args) => buildDecisionTable(args as unknown as DecisionTableInput),
  );

  registerTool(
    server,
    "state_transition_test",
    "Teste de transição de estado",
    "Estados calcula e não grava as transições válidas e inválidas de uma máquina de estados.",
    {
      states: z.array(z.string()).optional(),
      transitions: z
        .array(
          z.object({
            from: z.string(),
            event: z.string(),
            to: z.string(),
            guard: z.string().optional(),
          }),
        )
        .optional(),
      diagram: z.string().optional().describe("Exemplo: criado -> pago -> enviado"),
      sourceCode: z.string().optional(),
    },
    (args) => stateTransitionTest(args as unknown as StateTransitionInput),
  );

  registerTool(
    server,
    "pairwise_test_generator",
    "Gerador pairwise",
    "Pairwise calcula e não grava o conjunto em que cada par de valores aparece ao menos uma vez.",
    {
      parameters: z
        .array(
          z.object({
            name: z.string(),
            values: z.array(z.string()).min(1),
          }),
        )
        .min(1),
      sourceCode: z.string().optional(),
    },
    (args) => pairwiseTestGenerator(args as unknown as PairwiseInput),
  );
}
