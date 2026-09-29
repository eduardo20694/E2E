import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { renderE2eTest } from "../lib/codegen.js";
import { chooseE2eFramework, detectStack, stackSummary, type E2eFramework } from "../lib/detect.js";
import { codeBlock, doc, splitSteps } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";
import type { ProjectContextInput } from "../lib/schema.js";
import { cursorRoots, resolveProjectRoot } from "../lib/workspace.js";
import { persistGenerated } from "./execution.js";
import type { TestRunner } from "../lib/runner.js";

export interface GenerateE2eTestInput extends ProjectContextInput {
  userFlow: string;
  framework?: E2eFramework;
  baseUrl?: string;
  writeToProject?: boolean;
  run?: boolean;
}

export interface BuiltE2eTest {
  result: ToolTextResult;
  code?: string;
  fileName?: string;
  framework?: E2eFramework;
}

export function buildE2eTest(input: GenerateE2eTestInput): BuiltE2eTest {
  if (!input.userFlow?.trim()) {
    return { result: errorResult("generate_e2e_test exige userFlow com o caminho do usuário.") };
  }

  const stack = detectStack(input.projectRoot);
  const choice = chooseE2eFramework(input.framework, stack);
  const steps = splitSteps(input.userFlow);
  const rendered = renderE2eTest({
    framework: choice.framework,
    steps,
    baseUrl: input.baseUrl ?? "http://127.0.0.1:3000",
    title: steps[0] ?? "fluxo principal",
  });

  return {
    result: textResult(
    doc([
      `# Teste E2E — ${choice.framework} em staging`,
      "Isto roda em **staging**, com dado fake. Não é mock de browser e não é produção.",
      "## Dados",
      "- Setup cria usuário e massa deste teste. Teardown apaga os dois.",
      "- Não reutilize login compartilhado nem pedido deixado pela execução anterior.",
      choice.warning ? `> ${choice.warning}` : undefined,
      stack.e2eFrameworks.length
        ? `Framework detectado no projeto: ${stack.e2eFrameworks.join(", ")}.`
        : "Nenhum Cypress, Playwright ou Selenium detectado. O padrão adotado é Playwright.",
      "## Stack detectada",
      stackSummary(stack),
      "## Passos do fluxo",
      steps.map((step, index) => `${index + 1}. ${step}`).join("\n"),
      "## Código",
      codeBlock(rendered.language, rendered.code),
      "## Estabilidade",
      "- Um fluxo por teste, no caminho de maior risco.",
      "- Localizadores por papel acessível ou data-testid.",
      "- Espere estado, não um sleep fixo.",
      input.sourceCode
        ? "O código aberto foi considerado como contexto do fluxo; os passos continuam vindo de userFlow."
        : undefined,
      citeKnowledge(["e2e-testing", "black-white-gray-box"]),
    ]),
    ),
    code: rendered.code,
    fileName: rendered.fileName,
    framework: choice.framework,
  };
}

export function generateE2eTest(input: GenerateE2eTestInput): ToolTextResult {
  return buildE2eTest(input).result;
}

export function registerE2eTools(server: McpServer): void {
  registerTool(
    server,
    "generate_e2e_test",
    "Gerar teste E2E",
    "Transforma um fluxo de usuário em teste Cypress, Playwright ou Selenium. Usa o framework já presente no projeto quando framework não é informado.",
    {
      userFlow: z.string().describe("Fluxo em linguagem natural, um passo por frase ou linha."),
      framework: z.enum(["playwright", "cypress", "selenium"]).optional(),
      baseUrl: z.string().optional().describe("URL da aplicação sob teste."),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
      writeToProject: z.boolean().optional().describe("Grava o spec em e2e/ dentro da raiz."),
      run: z.boolean().optional().describe("Executa com Playwright quando esse for o framework."),
    },
    async (args) => {
      const input = args as unknown as GenerateE2eTestInput;
      const resolved = await resolveProjectRoot({
        explicit: input.projectRoot,
        filePath: input.filePath,
        listRoots: () => cursorRoots(server),
      });
      const built = buildE2eTest({ ...input, projectRoot: resolved.root ?? input.projectRoot });
      if (built.result.isError || (!input.writeToProject && !input.run) || !built.code || !built.fileName) return built.result;
      return persistGenerated({
        projectRoot: resolved.root ?? input.projectRoot,
        fileName: built.fileName,
        code: built.code,
        folder: "e2e",
        runner: built.framework === "playwright" ? ("playwright" satisfies TestRunner) : undefined,
        write: input.writeToProject,
        run: input.run,
        preface: built.result.content[0]?.text ?? "",
      });
    },
    { readOnly: false },
  );
}
