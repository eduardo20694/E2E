import fs from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectStack, stackSummary } from "../lib/detect.js";
import { codeBlock, doc } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { textResult, type ToolTextResult } from "../lib/result.js";
import { runnerInstalled } from "../lib/runner.js";
import { runShape, writeShape, type ProjectContextInput } from "../lib/schema.js";
import { resolveInside, writeProjectFile } from "../lib/workspace.js";
import { deliver, isLocalHost, resolveToolRoot, shouldWrite, type LoopFlags } from "./loop.js";

export interface VisualSetupInput extends ProjectContextInput {
  tool?: "percy" | "chromatic" | "applitools";
  baseUrl?: string;
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

function visualConfig(input: VisualSetupInput): { path: string; contents: string } {
  const stack = detectStack(input.projectRoot);
  const detected = stack.visualTools[0] as "percy" | "chromatic" | "applitools" | undefined;
  let tool = input.tool ?? detected;
  if (!tool) {
    tool = stack.hasStorybook ? "chromatic" : stack.e2eFrameworks.includes("playwright") || stack.e2eFrameworks.includes("cypress") ? "percy" : "percy";
  }
  if (tool === "chromatic") {
    return { path: "chromatic.config.json", contents: "{\n  \"exitZeroOnChanges\": true\n}\n" };
  }
  if (tool === "applitools") {
    return { path: "applitools.config.json", contents: "{\n  \"testConcurrency\": 1\n}\n" };
  }
  return { path: ".percy.yml", contents: "version: 2\nsnapshot:\n  widths:\n    - 1280\n    - 375\n" };
}

function visualSpec(baseUrl: string): string {
  const raw = baseUrl.trim() || "http://127.0.0.1:3000";
  let origin = raw;
  try {
    const url = new URL(raw);
    origin = `${url.protocol}//${url.host}`;
  } catch {
    origin = raw;
  }
  return `import { test, expect } from "@playwright/test";

test("screenshot local", async ({ page }) => {
  await page.goto(${JSON.stringify(`${origin}/`)});
  await expect(page).toHaveScreenshot("visual.png");
});
`;
}

function writeConfigQuiet(projectRoot: string | undefined, relative: string, contents: string, write: boolean): string | undefined {
  if (!write || !projectRoot) return undefined;
  try {
    const destination = resolveInside(projectRoot, relative);
    if (fs.existsSync(destination)) return `Config já existe, não substituí: \`${destination}\``;
    const written = writeProjectFile(projectRoot, relative, contents);
    return `Config gravado: \`${written}\``;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function handleVisual(input: VisualSetupInput & LoopFlags, server: McpServer): Promise<ToolTextResult> {
  const root = await resolveToolRoot(server, input.projectRoot, input.filePath);
  const ready = { ...input, projectRoot: root ?? input.projectRoot };
  const result = visualRegressionSetup(ready);
  const file = visualConfig(ready);
  const base = ready.baseUrl?.trim() || "http://127.0.0.1:3000";
  const local = isLocalHost(base);
  const playwright = Boolean(ready.projectRoot && runnerInstalled(ready.projectRoot, "playwright"));
  const configNote = writeConfigQuiet(ready.projectRoot, file.path, file.contents, shouldWrite(ready.writeToProject, ready.projectRoot));
  const preface = textResult([result.content[0]?.text ?? "", configNote].filter(Boolean).join("\n\n"));
  const skipped = !local
    ? "Não foi executado. baseUrl não é localhost nem 127.0.0.1."
    : playwright
      ? undefined
      : "Não foi executado. Playwright não está instalado em node_modules.";
  return deliver({
    server,
    input: ready,
    preface,
    relativePath: "e2e/visual.spec.ts",
    contents: visualSpec(base),
    runner: local && playwright ? "playwright" : undefined,
    runEligible: local && playwright,
    skippedNote: skipped,
  });
}

export function registerVisualTools(server: McpServer): void {
  registerTool(
    server,
    "visual_regression_setup",
    "Setup de regressão visual",
    "Visual grava `e2e/visual.spec.ts` e executa no Playwright local quando o binário existe e baseUrl é localhost ou 127.0.0.1; sem Playwright ou com URL externa, grava e não executa. Percy e Chromatic não são chamados na rede.",
    {
      tool: z.enum(["percy", "chromatic", "applitools"]).optional(),
      baseUrl: z.string().optional().describe("Só executa se for localhost ou 127.0.0.1."),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
      ...writeShape,
      ...runShape,
    },
    (args) => handleVisual(args as unknown as VisualSetupInput & LoopFlags, server),
    { readOnly: false },
  );
}
