import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { renderE2eTest } from "../lib/codegen.js";
import { chooseE2eFramework, detectStack, stackSummary, type E2eFramework } from "../lib/detect.js";
import { codeBlock, doc, splitSteps } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";
import type { ProjectContextInput } from "../lib/schema.js";
import { runShape, writeShape } from "../lib/schema.js";
import { extractUi, routeFromPage } from "../lib/web.js";
import { persistGenerated } from "./execution.js";
import { hydrateSource, shouldRun, shouldWrite } from "./loop.js";
import type { TestRunner } from "../lib/runner.js";

export interface GenerateE2eTestInput extends ProjectContextInput {
  userFlow?: string;
  framework?: E2eFramework;
  baseUrl?: string;
  writeToProject?: boolean;
  run?: boolean;
  overwrite?: boolean;
}

export interface BuiltE2eTest {
  result: ToolTextResult;
  code?: string;
  fileName?: string;
  framework?: E2eFramework;
}

function outsideBase(baseUrl?: string): boolean {
  const raw = baseUrl?.trim();
  if (!raw) return false;
  try {
    const host = new URL(raw).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return host !== "127.0.0.1" && host !== "localhost" && host !== "::1";
  } catch {
    return true;
  }
}

export function buildE2eTest(input: GenerateE2eTestInput): BuiltE2eTest {
  const controls = extractUi(input.sourceCode ?? "");
  const route = input.filePath ? routeFromPage(input.filePath) : undefined;
  const steps = input.userFlow?.trim() ? splitSteps(input.userFlow) : [];
  if (controls.length === 0 && steps.length === 0) {
    return {
      result: errorResult(
        "Passe o arquivo da tela (filePath ou sourceCode) com os controles, ou um userFlow. Sem controle e sem fluxo não há o que exercitar.",
      ),
    };
  }
  if (controls.length === 0) {
    return {
      result: errorResult(
        "Passe o arquivo da tela (filePath ou sourceCode) com os controles. Só o userFlow, sem o arquivo da tela, não mostra o que a página precisa.",
      ),
    };
  }

  const stack = detectStack(input.projectRoot);
  const choice = chooseE2eFramework(input.framework, stack);
  const fromScreen = controls.length > 0;
  const rendered = renderE2eTest({
    framework: choice.framework,
    steps,
    baseUrl: input.baseUrl ?? "http://127.0.0.1:3000",
    title: steps[0] ?? (route ? `tela ${route}` : "fluxo principal"),
    controls,
    route,
    sourceCode: input.sourceCode,
    filePath: input.filePath,
  });

  return {
    result: textResult(
    doc([
      `# Teste E2E — ${choice.framework} local`,
      "Teste local. A página é HTML criado dos controles do arquivo. Os retornos JSON são criados no teste. Sem app no ar e sem rede externa.",
      outsideBase(input.baseUrl)
        ? "> A URL de fora foi ignorada. O teste abre só `http://127.0.0.1:3000`."
        : undefined,
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
      fromScreen
        ? `O teste usa os controles e a rota do arquivo${route ? ` (\`${route}\`)` : ""}.${steps.length ? " O userFlow entra junto com esses controles." : ""}`
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
    "Teste local. A página é HTML criado dos controles do arquivo. Os retornos JSON são criados no teste. Sem app no ar e sem rede externa. Grava e executa o Playwright (`*.spec.ts`) quando esse runner está na lista fechada; Cypress e Selenium são gravados e ficam sem execução.",
    {
      userFlow: z.string().optional().describe("Fluxo em linguagem natural. Se o arquivo da tela foi passado, os controles e a rota dele entram no teste."),
      framework: z.enum(["playwright", "cypress", "selenium"]).optional(),
      baseUrl: z.string().optional().describe("Ignorada quando o host é de fora. O teste abre só http://127.0.0.1:3000."),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
      ...writeShape,
      ...runShape,
    },
    async (args) => {
      const hydrated = await hydrateSource(server, args as unknown as GenerateE2eTestInput);
      if ("isError" in hydrated && hydrated.isError) return hydrated;
      const ready = hydrated as GenerateE2eTestInput;
      const built = buildE2eTest(ready);
      if (built.result.isError || !built.code || !built.fileName) return built.result;
      const runner = built.framework === "playwright" ? ("playwright" satisfies TestRunner) : undefined;
      const write = shouldWrite(ready.writeToProject, ready.projectRoot);
      const run = shouldRun(ready.run, Boolean(runner), ready.projectRoot);
      if (!write && !run) return built.result;
      return persistGenerated({
        projectRoot: ready.projectRoot,
        fileName: built.fileName,
        code: built.code,
        folder: "e2e",
        runner,
        write,
        run,
        overwrite: ready.overwrite,
        preface: [built.result.content[0]?.text ?? "", run ? undefined : "Não foi executado."].filter(Boolean).join("\n\n"),
      });
    },
    { readOnly: false },
  );
}
