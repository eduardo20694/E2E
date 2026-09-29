import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectStack, stackSummary } from "../lib/detect.js";
import { codeBlock, doc } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { textResult, type ToolTextResult } from "../lib/result.js";
import type { ProjectContextInput } from "../lib/schema.js";

export interface VisualSetupInput extends ProjectContextInput {
  tool?: "percy" | "chromatic" | "applitools";
}

export function visualRegressionSetup(input: VisualSetupInput): ToolTextResult {
  const stack = detectStack(input.projectRoot);
  const detected = stack.visualTools[0] as "percy" | "chromatic" | "applitools" | undefined;
  let tool = input.tool ?? detected;
  if (!tool) {
    tool = stack.hasStorybook ? "chromatic" : stack.e2eFrameworks.includes("playwright") || stack.e2eFrameworks.includes("cypress") ? "percy" : "percy";
  }

  const setups: Record<typeof tool, { why: string; snippet: string }> = {
    percy: {
      why: "Percy encaixa em snapshot de página no Playwright ou Cypress, sem exigir Storybook.",
      snippet: `import percySnapshot from "@percy/playwright";
import { test } from "@playwright/test";

test("home estável", async ({ page }) => {
  await page.goto("/");
  await percySnapshot(page, "home");
});`,
    },
    chromatic: {
      why: stack.hasStorybook
        ? "Storybook já está no projeto. Chromatic publica a story e compara o canvas."
        : "Chromatic vale a pena se o componente viver em Storybook. Sem stories, Percy ou Applitools no fluxo E2E é mais direto.",
      snippet: `{
  "scripts": { "chromatic": "chromatic --exit-zero-on-changes" }
}`,
    },
    applitools: {
      why: "Applitools compara layout com tolerância visual, útil quando o pixel exato muda entre fontes e antialiasing.",
      snippet: `import { Eyes, Target } from "@applitools/eyes-playwright";
import { test } from "@playwright/test";

test("checkout", async ({ page }) => {
  const eyes = new Eyes();
  await eyes.open(page, "app", "checkout");
  await eyes.check("passo", Target.window());
  await eyes.close();
});`,
    },
  };

  const chosen = setups[tool];
  return textResult(
    doc([
      `# Regressão visual — ${tool}`,
      "## Stack detectada",
      stackSummary(stack),
      chosen.why,
      "## Exemplo",
      codeBlock(tool === "chromatic" ? "json" : "ts", chosen.snippet),
      "## O que não snapshotar",
      "- Relógio, anúncio e avatar com foto aleatória. Mascarar ou congelar.",
      "- A suíte inteira. Escolha telas de layout caro: checkout, dashboard, design system.",
      input.sourceCode ? "O componente aberto é candidato a story ou a snapshot nomeado, não a um print da página logada com dados vivos." : undefined,
      citeKnowledge(["visual-regression", "e2e-testing"]),
    ]),
  );
}

export function registerVisualTools(server: McpServer): void {
  registerTool(
    server,
    "visual_regression_setup",
    "Setup de regressão visual",
    "Sugere Percy, Chromatic ou Applitools conforme Storybook e o runner E2E já usados no projeto.",
    {
      tool: z.enum(["percy", "chromatic", "applitools"]).optional(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
    },
    (args) => visualRegressionSetup(args as unknown as VisualSetupInput),
  );
}
