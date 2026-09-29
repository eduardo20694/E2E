import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { renderMobileTest } from "../lib/codegen.js";
import { detectStack, inferLanguage, stackSummary } from "../lib/detect.js";
import { codeBlock, doc, splitSteps } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";
import type { ProjectContextInput } from "../lib/schema.js";

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

export function registerMobileTools(server: McpServer): void {
  registerTool(
    server,
    "generate_mobile_test",
    "Gerar teste mobile",
    "Gera um teste Appium (WebdriverIO ou cliente Python) para um fluxo Android, iOS ou ambos.",
    {
      flow: z.string().describe("Fluxo no aplicativo, em linguagem natural."),
      platform: z.enum(["android", "ios", "both"]).optional(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
    },
    (args) => generateMobileTest(args as unknown as GenerateMobileTestInput),
  );
}
