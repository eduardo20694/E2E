import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectStack, inferLanguage, stackSummary, type Language } from "../lib/detect.js";
import { codeBlock, doc } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { textResult, type ToolTextResult } from "../lib/result.js";
import type { ProjectContextInput } from "../lib/schema.js";

export interface MutationReportInput extends ProjectContextInput {
  language?: string;
  currentScore?: number;
}

export function mutationTestingReport(input: MutationReportInput): ToolTextResult {
  const stack = detectStack(input.projectRoot);
  const language = (input.language as Language | undefined) ?? inferLanguage(input.sourceCode, input.filePath);
  const engine = pickEngine(stack, language);
  const score = input.currentScore;

  let interpretation = "Ainda não há score. Rode um módulo pequeno antes da suíte inteira.";
  if (score !== undefined) {
    if (score < 60) interpretation = `${score}% indica suíte que passa sem segurar regressão. Faltam asserts de resultado.`;
    else if (score < 80) interpretation = `${score}% é faixa utilizável. Olhe os mutantes sobreviventes em ramo de negócio, não persiga 100%.`;
    else interpretation = `${score}% é forte. Confira se os mutantes mortos não são equivalentes (mudança que não altera comportamento).`;
  }

  return textResult(
    doc([
      `# Mutation testing — ${engine.name}`,
      "## Stack detectada",
      stackSummary(stack),
      `Motor escolhido para ${language}: **${engine.name}**.`,
      engine.install,
      "## Configuração",
      codeBlock(engine.lang, engine.config),
      "## Como ler o score",
      interpretation,
      "- Mutante morto: algum teste falhou depois da alteração. A suíte viu a mudança.",
      "- Mutante sobrevivente: a suíte continuou verde. Falta assert ou o mutante é equivalente.",
      "- Timeout: o mutante pode ter criado laço. Trate como sinal, não como cobertura ganha.",
      citeKnowledge(["mutation-testing", "unit-testing", "qa-metrics"]),
    ]),
  );
}

function pickEngine(stack: ReturnType<typeof detectStack>, language: Language): {
  name: string;
  lang: string;
  install: string;
  config: string;
} {
  if (stack.mutationTools.includes("pit") || language === "java") {
    return {
      name: "PIT",
      lang: "xml",
      install: "No Maven, o goal `org.pitest:pitest-maven:mutationCoverage` usa os testes JUnit já existentes.",
      config: `<plugin>
  <groupId>org.pitest</groupId>
  <artifactId>pitest-maven</artifactId>
  <version>1.17.0</version>
  <configuration>
    <targetClasses><param>com.example.*</param></targetClasses>
  </configuration>
</plugin>`,
    };
  }
  if (stack.mutationTools.includes("mutmut") || language === "python") {
    return {
      name: "mutmut",
      lang: "toml",
      install: "Instale `mutmut` no mesmo ambiente do pytest. Ele altera o código e reroda a suíte.",
      config: `[tool.mutmut]
paths_to_mutate = "src/"
tests_dir = "tests/"
runner = "python -m pytest -x"`,
    };
  }
  return {
    name: "Stryker",
    lang: "json",
    install: stack.mutationTools.includes("stryker")
      ? "Stryker já está no projeto. Aponte `mutate` para o código de produção, não para o teste."
      : "Para TypeScript, `@stryker-mutator/core` com o runner do Vitest ou do Jest que o projeto já usa.",
    config: `{
  "packageManager": "npm",
  "testRunner": "${stack.unitFrameworks.includes("jest") ? "jest" : "vitest"}",
  "mutate": ["src/**/*.ts", "!src/**/*.test.ts"]
}`,
  };
}

export function registerMutationTools(server: McpServer): void {
  registerTool(
    server,
    "mutation_testing_report",
    "Relatório de mutation testing",
    "Explica como configurar Stryker, PIT ou mutmut conforme a stack do projeto e como interpretar o mutation score.",
    {
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
      language: z.string().optional(),
      currentScore: z.number().min(0).max(100).optional().describe("Score atual, se já houver uma execução."),
    },
    (args) => mutationTestingReport(args as unknown as MutationReportInput),
  );
}
