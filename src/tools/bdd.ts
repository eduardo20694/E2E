import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { codeBlock, doc, splitSteps } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";

export interface GherkinInput {
  requirement: string;
  title?: string;
  sourceCode?: string;
  filePath?: string;
}

export function generateGherkinScenario(input: GherkinInput): ToolTextResult {
  if (!input.requirement?.trim()) {
    return errorResult("generate_gherkin_scenario exige requirement em linguagem natural.");
  }

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

export function registerBddTools(server: McpServer): void {
  registerTool(
    server,
    "generate_gherkin_scenario",
    "Gerar cenário Gherkin",
    "Converte um requisito em linguagem natural para um cenário Gherkin em português (Dado/Quando/Então), com caminho feliz e inválido.",
    {
      requirement: z.string().describe("Requisito ou história em linguagem natural."),
      title: z.string().optional(),
      sourceCode: z.string().optional(),
      filePath: z.string().optional(),
    },
    (args) => generateGherkinScenario(args as unknown as GherkinInput),
  );
}
