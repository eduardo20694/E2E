import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { renderMobileTest } from "../lib/codegen.js";
import { detectStack, inferLanguage, resolveJsRunner, stackSummary } from "../lib/detect.js";
import { codeBlock, doc, splitSteps } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";
import { appiumInstalled } from "../lib/runner.js";
import { writeShape, type ProjectContextInput } from "../lib/schema.js";
import { deliver, hydrateSource, type LoopFlags } from "./loop.js";

export interface GenerateMobileTestInput extends ProjectContextInput {
  flow: string;
  platform?: "android" | "ios" | "both";
}

export function generateMobileTest(input: GenerateMobileTestInput): ToolTextResult {
  if (!input.flow?.trim()) {
    return errorResult("generate_mobile_test exige flow com o caminho no aplicativo.");
  }

  const stack = detectStack(input.projectRoot);
  const language = inferLanguage(input.sourceCode, input.filePath);
  const platform = input.platform ?? "android";
  const rendered = renderMobileTest({
    flow: input.flow,
    platform,
    steps: splitSteps(input.flow),
    language: language === "python" ? "python" : "ts",
    runner: resolveJsRunner({ projectRoot: input.projectRoot, filePath: input.filePath, stack }),
  });

  return textResult(
    doc([
      `# Teste mobile — Appium (${platform})`,
      "Roda em emulador, simulador ou device de teste. Não é produção e não usa conta de cliente.",
      stack.mobileTools.length
        ? `Appium/WebdriverIO já aparece no projeto.`
        : "Appium não foi detectado. O script assume o servidor em 127.0.0.1:4723.",
      "## Stack detectada",
      stackSummary(stack),
      "## Código",
      codeBlock(rendered.language, rendered.code),
      "## Antes de rodar",
      "- Android: UiAutomator2. iOS: XCUITest, com simulador ou device confiável.",
      platform === "both"
        ? "- Rode o mesmo fluxo duas vezes, uma capability por plataforma. Não misture seletores de Android e iOS no mesmo caso."
        : undefined,
      "- Prefira accessibility id. XPath de hierarquia quebra a cada release.",
      "- Deixe o app num estado conhecido (limpar dados ou usar um build de teste).",
      citeKnowledge(["mobile-testing", "e2e-testing"]),
    ]),
  );
}

export async function handleGenerateMobileTest(input: GenerateMobileTestInput & LoopFlags, server?: McpServer): Promise<ToolTextResult> {
  const hydrated = await hydrateSource(server, input);
  if ("isError" in hydrated && hydrated.isError) return hydrated;
  const ready = hydrated as GenerateMobileTestInput & LoopFlags;
  const result = generateMobileTest(ready);
  if (result.isError) return result;
  const language = inferLanguage(ready.sourceCode, ready.filePath);
  const rendered = renderMobileTest({
    flow: ready.flow,
    platform: ready.platform ?? "android",
    steps: splitSteps(ready.flow),
    language: language === "python" ? "python" : "ts",
    runner: resolveJsRunner({ projectRoot: ready.projectRoot, filePath: ready.filePath }),
  });
  const hasAppium = Boolean(ready.projectRoot && appiumInstalled(ready.projectRoot));
  return deliver({
    server,
    input: ready,
    preface: result,
    relativePath: rendered.fileName,
    contents: rendered.code,
    neverRun: true,
    skippedNote: hasAppium
      ? "Não foi executado. appium está em node_modules, mas não há comando fechado para o spec sem subir servidor."
      : "Não foi executado. Não há runner: appium não está instalado em node_modules.",
  });
}

export function registerMobileTools(server: McpServer): void {
  registerTool(
    server,
    "generate_mobile_test",
    "Gerar teste mobile",
    "Mobile grava e não executa o fluxo Appium (`mobile.spec.ts` ou `test_mobile.py`); sem `appium` em node_modules, diz que não há runner.",
    {
      flow: z.string().describe("Fluxo no aplicativo, em linguagem natural."),
      platform: z.enum(["android", "ios", "both"]).optional(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
      ...writeShape,
    },
    (args) => handleGenerateMobileTest(args as unknown as GenerateMobileTestInput & LoopFlags, server),
    { readOnly: false },
  );
}
