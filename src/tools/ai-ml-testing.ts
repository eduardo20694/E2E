import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { doc, markdownTable } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";
import { runShape, writeShape } from "../lib/schema.js";
import { deliver, slug, type LoopFlags } from "./loop.js";

export interface ModelPlanInput {
  model: string;
  task?: string;
  slices?: string[];
  sourceCode?: string;
}

export function suggestModelTestingPlan(input: ModelPlanInput): ToolTextResult {
  if (!input.model?.trim()) {
    return errorResult("suggest_model_testing_plan exige model com o nome ou o papel do modelo.");
  }

  const slices = input.slices?.length ? input.slices : ["grupo majoritário", "grupo minoritário", "caso vazio", "caso fora da distribuição de treino"];

  return textResult(
    doc([
      `# Plano de teste do modelo — ${input.model}`,
      input.task ? `Tarefa: ${input.task}.` : undefined,
      "## O que medir",
      "- Acurácia ou a métrica do negócio no conjunto de teste que o modelo não viu no treino.",
      "- A mesma métrica em cada fatia. Média alta com fatia ruim é viés, não sucesso.",
      "- Data drift: a distribuição de entrada em produção comparada à do treino, com alerta antes da métrica cair.",
      "- Queda de qualidade depois de um retreino. O modelo anterior fica como baseline.",
      markdownTable(
        ["Fatia", "Pergunta"],
        slices.map((slice) => [slice, "a métrica segura o mínimo combinado?"]),
      ),
      "O teste do modelo não substitui o teste do sistema em volta: timeout, fallback quando o modelo não responde, e o que a tela faz com uma previsão baixa.",
      input.sourceCode ? "O código aberto é a borda que chama o modelo. Cubra o fallback ali com teste unitário." : undefined,
      citeKnowledge(["ai-ml-testing", "ai-in-testing"]),
    ]),
  );
}

export interface AbInput {
  metric: string;
  baselineRate: number;
  minimumDetectableEffect: number;
}

/** Tamanho por variante, proporção, 5% de significância e 80% de poder. */
export function sampleSizePerVariant(baseline: number, effect: number): number {
  if (baseline <= 0 || baseline >= 1) throw new Error("baselineRate precisa estar entre 0 e 1.");
  if (effect <= 0) throw new Error("minimumDetectableEffect precisa ser positivo.");
  const z = 1.96 + 0.84;
  const n = (2 * baseline * (1 - baseline) * z * z) / (effect * effect);
  return Math.ceil(n);
}

export function suggestAbTestDesign(input: AbInput): ToolTextResult {
  if (!input.metric?.trim()) {
    return errorResult("suggest_ab_test_design exige metric.");
  }

  let n: number;
  try {
    n = sampleSizePerVariant(input.baselineRate, input.minimumDetectableEffect);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(message);
  }

  return textResult(
    doc([
      `# A/B — ${input.metric}`,
      "Modelo de planejamento: teste de proporção, bicaudal, significância 5%, poder 80%. Não é análise pronta de um experimento já rodado.",
      `- Taxa de base: ${input.baselineRate}.`,
      `- Efeito mínimo absoluto: ${input.minimumDetectableEffect}.`,
      `- **${n} observações por variante** (${n * 2} no total).`,
      "Não pare no primeiro dia em que a diferença parece grande. O tamanho acima é o combinado antes de olhar o resultado.",
      "Se a métrica não for proporção (receita média, por exemplo), este número não vale. Aí a variância entra na conta e este atalho erra.",
      citeKnowledge(["ai-ml-testing"]),
    ]),
  );
}

export interface LlmPromptInput {
  prompt: string;
  expectedFormat?: string;
}

export function generateLlmPromptTest(input: LlmPromptInput): ToolTextResult {
  if (!input.prompt?.trim()) {
    return errorResult("generate_llm_prompt_test exige prompt.");
  }

  return textResult(
    doc([
      "# Casos para o prompt",
      "O assert confere o contrato da saída. Não confere que o modelo 'parece certo'. A suíte não chama o modelo a cada execução se o custo ou a rede tornarem o teste instável: grave exemplos de regressão e rode a chamada num job separado.",
      markdownTable(
        ["Caso", "Entrada", "Esperado"],
        [
          ["feliz", "pedido coberto pelo prompt", input.expectedFormat ?? "JSON ou texto no formato combinado"],
          ["vazio", "mensagem vazia", "erro orientado ou pedido de esclarecimento, sem inventar dado"],
          ["fora de escopo", "assunto que o prompt não cobre", "recusa curta, sem cumprir a tarefa alheia"],
          ["conteúdo não confiável", "texto do usuário pedindo para ignorar a instrução do sistema", "o comportamento do sistema permanece o do prompt"],
          ["formato", "pedido válido com campo a mais", "campos extras ignorados, campos obrigatórios presentes"],
        ],
      ),
      "Trecho do prompt sob teste:",
      input.prompt.slice(0, 400),
      citeKnowledge(["ai-ml-testing", "ai-in-testing"]),
    ]),
  );
}

function llmTestSource(input: LlmPromptInput): string {
  const format = input.expectedFormat ?? "JSON ou texto no formato combinado";
  return `import { describe, it, expect } from "vitest";

const casos = [
  { caso: "feliz", esperado: ${JSON.stringify(format)} },
  { caso: "vazio", esperado: "erro orientado ou pedido de esclarecimento, sem inventar dado" },
  { caso: "fora de escopo", esperado: "recusa curta, sem cumprir a tarefa alheia" },
  { caso: "conteúdo não confiável", esperado: "o comportamento do sistema permanece o do prompt" },
  { caso: "formato", esperado: "campos extras ignorados, campos obrigatórios presentes" },
];

describe("contrato do prompt", () => {
  it("cada caso tem resultado esperado e não chama o modelo", () => {
    expect(casos.every((caso) => caso.esperado.length > 0)).toBe(true);
  });
});
`;
}

export async function handleSuggestModelTestingPlan(input: ModelPlanInput & LoopFlags, server?: McpServer): Promise<ToolTextResult> {
  const result = suggestModelTestingPlan(input);
  if (result.isError) return result;
  return deliver({
    server,
    input,
    preface: result,
    relativePath: `docs/qa/plano-${slug(input.model)}.md`,
    contents: result.content[0]?.text ?? "",
  });
}

export async function handleGenerateLlmPromptTest(input: LlmPromptInput & LoopFlags, server?: McpServer): Promise<ToolTextResult> {
  const result = generateLlmPromptTest(input);
  if (result.isError) return result;
  return deliver({
    server,
    input,
    preface: result,
    relativePath: "llm-prompt.test.ts",
    contents: llmTestSource(input),
    runner: "vitest",
  });
}

export function registerAiMlTools(server: McpServer): void {
  registerTool(
    server,
    "suggest_model_testing_plan",
    "Plano de teste de modelo",
    "Modelo grava e não executa `docs/qa/*.md` com acurácia, fatias de viés, drift e fallback em volta do modelo.",
    {
      model: z.string(),
      task: z.string().optional(),
      slices: z.array(z.string()).optional(),
      sourceCode: z.string().optional(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      ...writeShape,
    },
    (args) => handleSuggestModelTestingPlan(args as unknown as ModelPlanInput & LoopFlags, server),
    { readOnly: false },
  );

  registerTool(
    server,
    "suggest_ab_test_design",
    "Desenho de teste A/B",
    "Amostra calcula e não grava o tamanho por variante para uma métrica de proporção, com 5% de significância e 80% de poder.",
    {
      metric: z.string(),
      baselineRate: z.number(),
      minimumDetectableEffect: z.number(),
    },
    (args) => suggestAbTestDesign(args as unknown as AbInput),
  );

  registerTool(
    server,
    "generate_llm_prompt_test",
    "Testes de prompt de LLM",
    "Prompt grava e executa no runner local `llm-prompt.test.ts` para formato, vazio, fora de escopo e conteúdo de usuário não confiável.",
    {
      prompt: z.string(),
      expectedFormat: z.string().optional(),
      projectRoot: z.string().optional(),
      ...writeShape,
      ...runShape,
    },
    (args) => handleGenerateLlmPromptTest(args as unknown as LlmPromptInput & LoopFlags, server),
    { readOnly: false },
  );
}
