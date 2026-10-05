import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { codeBlock, doc, splitSteps } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";
import { runClosed } from "../lib/runner.js";
import { runShape, writeShape } from "../lib/schema.js";
import { deliver, resolveToolRoot, resultText, slug, type LoopFlags } from "./loop.js";

export interface GherkinInput {
  requirement: string;
  title?: string;
  sourceCode?: string;
  filePath?: string;
  projectRoot?: string;
}

export function gherkinFeature(input: GherkinInput): { title: string; feature: string } | undefined {
  if (!input.requirement?.trim()) return undefined;
  const sentences = splitSteps(input.requirement);
  const title = input.title?.trim() || sentences[0]?.replace(/\.$/, "") || "comportamento pedido";
  const given = sentences[0] ?? input.requirement;
  const when = sentences[1] ?? "o usuário conclui a ação principal";
  const then = sentences.slice(2).join(" ") || "o sistema apresenta o resultado observável da regra";
  const feature = `# language: pt
Funcionalidade: ${title}
  ${input.sourceCode ? "O código aberto descreve a regra; o cenário descreve o comportamento visível." : "Comportamento observável, sem detalhe de implementação."}

  Cenário: caminho feliz
    Dado ${stripPeriod(given)}
    Quando ${stripPeriod(when)}
    Então ${stripPeriod(then)}

  Cenário: caminho inválido
    Dado ${stripPeriod(given)}
    Quando a informação obrigatória está ausente ou fora da regra
    Então o sistema recusa a operação e informa o motivo
`;
  return { title, feature };
}

export function generateGherkinScenario(input: GherkinInput): ToolTextResult {
  const built = gherkinFeature(input);
  if (!built) {
    return errorResult("generate_gherkin_scenario exige requirement em linguagem natural.");
  }
  const { feature } = built;

  return textResult(
    doc([
      "# Cenário Gherkin",
      codeBlock("gherkin", feature),
      "Um passo, um ator, um resultado. Se o Então lista três efeitos, quebre em cenários.",
      citeKnowledge(["bdd", "tdd"]),
    ]),
  );
}

function stripPeriod(value: string): string {
  return value.replace(/\.$/, "");
}

export async function handleGenerateGherkinScenario(input: GherkinInput & LoopFlags, server?: McpServer): Promise<ToolTextResult> {
  const result = generateGherkinScenario(input);
  const built = gherkinFeature(input);
  if (result.isError || !built) return result;
  const root = (await resolveToolRoot(server, input.projectRoot, input.filePath)) ?? input.projectRoot;
  const ready = { ...input, projectRoot: root };
  const relativePath = `${slug(built.title)}.feature`;
  const delivered = await deliver({
    server,
    input: ready,
    preface: result,
    relativePath,
    contents: built.feature,
    neverRun: true,
  });
  if (delivered.isError || ready.run === false || !ready.projectRoot) {
    if (!delivered.isError) {
      const note =
        ready.run === false
          ? "Não foi executado."
          : "Não foi executado. Não há runner: cucumber não está instalado em node_modules.";
      return textResult([resultText(delivered), note].join("\n\n"));
    }
    return delivered;
  }
  const scan = await runClosed(ready.projectRoot, "cucumber", relativePath);
  return textResult([resultText(delivered), scan].join("\n\n"));
}

export function registerBddTools(server: McpServer): void {
  registerTool(
    server,
    "generate_gherkin_scenario",
    "Gerar cenário Gherkin",
    "Gherkin grava `*.feature` e executa com o cucumber de node_modules quando o binário existe; sem cucumber, grava e não executa e diz que não há runner. Vitest, Jest, Playwright, ESLint, Stryker e Cucumber só rodam se já estão em `node_modules` (não baixam pacote). k6, npm, Bandit e Gosec são CLI de máquina, procurados no PATH. Não há `npx`.",
    {
      requirement: z.string().describe("Requisito ou história em linguagem natural."),
      title: z.string().optional(),
      sourceCode: z.string().optional(),
      filePath: z.string().optional(),
      projectRoot: z.string().optional(),
      ...writeShape,
      ...runShape,
    },
    (args) => handleGenerateGherkinScenario(args as unknown as GherkinInput & LoopFlags, server),
    { readOnly: false },
  );
}
