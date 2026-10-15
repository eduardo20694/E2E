import fs from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectStack, stackSummary } from "../lib/detect.js";
import { extractRoutes } from "../lib/web.js";
import {
  fixtureRelative,
  mockPayload,
  playwrightClockSupported,
  readPlaywrightMeta,
  renderedList,
} from "../lib/front-spec.js";
import { doc } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { runnerInstalled } from "../lib/runner.js";
import { textResult, type ToolTextResult } from "../lib/result.js";
import { runShape, writeShape, type ProjectContextInput } from "../lib/schema.js";
import {
  detectsSsr,
  extractUi,
  resolvePageRoute,
  screenComponent,
  slugFor,
} from "../lib/web.js";
import { resolveInside, writeProjectFile } from "../lib/workspace.js";
import { persistGenerated } from "./execution.js";
import { hydrateSource, isLocalHost, resolveToolRoot, shouldRun, shouldWrite, type LoopFlags } from "./loop.js";

export interface VisualSetupInput extends ProjectContextInput {
  tool?: "percy" | "chromatic" | "applitools";
  baseUrl?: string;
  route?: string;
  routeParams?: Record<string, string>;
  apiPattern?: string;
}

export function extraVisualConfig(
  input: VisualSetupInput,
): { path: string; contents: string } | undefined {
  const stack = detectStack(input.projectRoot);
  const detected = stack.visualTools[0] as "percy" | "chromatic" | "applitools" | undefined;
  const tool = input.tool ?? detected;
  if (!tool) return undefined;
  if (tool === "chromatic") {
    return { path: "chromatic.config.json", contents: "{\n  \"exitZeroOnChanges\": true\n}\n" };
  }
  if (tool === "applitools") {
    return { path: "applitools.config.json", contents: "{\n  \"testConcurrency\": 1\n}\n" };
  }
  return { path: ".percy.yml", contents: "version: 2\nsnapshot:\n  widths:\n    - 1280\n    - 375\n" };
}

export function visualRegressionSetup(input: VisualSetupInput): ToolTextResult {
  const stack = detectStack(input.projectRoot);
  const extra = extraVisualConfig(input);
  return textResult(
    doc([
      "# Regressão visual — screenshot local",
      "## Stack detectada",
      stackSummary(stack),
      "Screenshot da página real com a API mockada no estado sucesso. Viewport 1280x800, relógio fixo e fontes prontas.",
      extra ? `Config extra da ferramenta ${input.tool ?? stack.visualTools[0]} só porque ela está na stack ou veio no input.` : "Sem Percy, Chromatic ou Applitools na stack: nenhum config extra.",
      "## O que não snapshotar",
      "- Relógio, anúncio e avatar com foto aleatória. Mascarar ou congelar.",
      "- A suíte inteira. Escolha telas de layout caro: checkout, dashboard, design system.",
      input.sourceCode ? "O componente aberto é candidato a snapshot nomeado, não a um print da página logada com dados vivos." : undefined,
      citeKnowledge(["visual-regression", "e2e-testing"]),
    ]),
  );
}

function visualSpec(options: {
  route: string;
  slug: string;
  apiPattern: string;
  routes: ReturnType<typeof extractRoutes>;
  hasClock: boolean;
  testDir: string;
}): string {
  const apiPattern = options.apiPattern || "**/api/**";
  const fixtureRel = path.posix.relative(options.testDir.replace(/\\/g, "/") || ".", `tests/fixtures/${options.slug}`);
  const rel = fixtureRel.startsWith(".") ? fixtureRel : `./${fixtureRel}`;
  const intercepts = [
    `  await page.route(${JSON.stringify(apiPattern)}, (route) => route.fulfill({ status: 501, body: "sem mock" }));`,
    ...options.routes.map((route) => {
      const glob = route.path.startsWith("/") ? `**${route.path}` : `**/${route.path}`;
      return `  await page.route(${JSON.stringify(glob)}, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sucesso) }));`;
    }),
  ];
  const clock = options.hasClock
    ? `  await page.clock.install({ time: new Date("2026-01-01T12:00:00Z") });`
    : `  // page.clock exige @playwright/test >= 1.45.`;
  return `import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";

const sucesso = JSON.parse(fs.readFileSync(path.join(__dirname, ${JSON.stringify(rel)}, "sucesso.json"), "utf8"));

test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });

test(${JSON.stringify(`visual ${options.route} @network-mock`)}, async ({ page }) => {
${clock}
${intercepts.join("\n")}
  await page.goto(${JSON.stringify(options.route)});
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot(${JSON.stringify(`${options.slug}-sucesso.png`)}, { animations: "disabled", fullPage: true });
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

function snapshotMissing(projectRoot: string, relativeSpec: string): boolean {
  try {
    const spec = resolveInside(projectRoot, relativeSpec);
    const dir = `${spec}-snapshots`;
    return !fs.existsSync(dir);
  } catch {
    return true;
  }
}

async function handleVisual(input: VisualSetupInput & LoopFlags, server: McpServer): Promise<ToolTextResult> {
  const hydrated = await hydrateSource(server, input);
  if ("isError" in hydrated && hydrated.isError) return hydrated;
  const ready = hydrated as VisualSetupInput & LoopFlags;
  const root = ready.projectRoot ?? (await resolveToolRoot(server, input.projectRoot, input.filePath));
  const withRoot = { ...ready, projectRoot: root ?? ready.projectRoot };
  const result = visualRegressionSetup(withRoot);
  const file = extraVisualConfig(withRoot);
  const configNote = file
    ? writeConfigQuiet(withRoot.projectRoot, file.path, file.contents, shouldWrite(withRoot.writeToProject, withRoot.projectRoot))
    : undefined;
  const component = screenComponent(withRoot.sourceCode ?? "", withRoot.filePath);
  const resolved = resolvePageRoute({
    filePath: withRoot.filePath,
    projectRoot: withRoot.projectRoot,
    route: withRoot.route,
    routeParams: withRoot.routeParams,
    componentName: component?.name,
  });
  const route = resolved.path || "/";
  const slug = slugFor(resolved.pattern ?? route, component?.name, withRoot.filePath);
  const meta = readPlaywrightMeta(withRoot.projectRoot, false);
  const controls = extractUi(withRoot.sourceCode ?? "", { projectRoot: withRoot.projectRoot });
  const list = withRoot.sourceCode ? renderedList(withRoot.sourceCode) : undefined;
  const hint = controls.find((control) => control.text)?.text;
  const sucesso = mockPayload(list, hint);
  const fixturePath = fixtureRelative(slug, "sucesso");
  const fixtureNotes: string[] = [];
  if (shouldWrite(withRoot.writeToProject, withRoot.projectRoot) && withRoot.projectRoot) {
    try {
      const destination = resolveInside(withRoot.projectRoot, fixturePath);
      if (fs.existsSync(destination)) fixtureNotes.push(`Fixture reaproveitada: \`${destination}\``);
      else fixtureNotes.push(`Fixture gravada: \`${writeProjectFile(withRoot.projectRoot, fixturePath, `${JSON.stringify(sucesso, null, 2)}\n`)}\``);
    } catch (error) {
      fixtureNotes.push(error instanceof Error ? error.message : String(error));
    }
  }
  const ssr = detectsSsr(withRoot.sourceCode ?? "", withRoot.filePath);
  const spec = visualSpec({
    route,
    slug,
    apiPattern: withRoot.apiPattern || "**/api/**",
    routes: extractRoutes(withRoot.sourceCode ?? "", withRoot.filePath),
    hasClock: playwrightClockSupported(withRoot.projectRoot),
    testDir: meta.testDir,
  });
  const relativePath = `${meta.testDir}/${slug}.visual.spec.ts`;
  const playwright = Boolean(withRoot.projectRoot && runnerInstalled(withRoot.projectRoot, "playwright"));
  const local = !withRoot.baseUrl || isLocalHost(withRoot.baseUrl);
  const updateSnapshots = Boolean(withRoot.projectRoot && snapshotMissing(withRoot.projectRoot, relativePath));
  const preface = textResult(
    [
      result.content[0]?.text ?? "",
      configNote,
      ...fixtureNotes,
      ssr ? "page.route não intercepta fetch do servidor." : undefined,
      updateSnapshots ? "Não há baseline. A primeira execução usa --update-snapshots. Revise o PNG gerado." : undefined,
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
  const skipped = !local
    ? "Não foi executado. baseUrl não é localhost nem 127.0.0.1."
    : playwright
      ? undefined
      : "Não foi executado. Playwright não está instalado em node_modules.";
  const write = shouldWrite(withRoot.writeToProject, withRoot.projectRoot);
  const run = shouldRun(withRoot.run, local && playwright, withRoot.projectRoot);
  if (!write && !run) return preface;
  return persistGenerated({
    projectRoot: withRoot.projectRoot,
    fileName: `${slug}.visual.spec.ts`,
    folder: meta.testDir,
    code: spec,
    runner: local && playwright ? "playwright" : undefined,
    write,
    run,
    overwrite: withRoot.overwrite,
    skipIfExists: !withRoot.overwrite,
    updateSnapshots: run && updateSnapshots,
    preface: [preface.content[0]?.text ?? "", skipped].filter(Boolean).join("\n\n"),
  });
}

export function registerVisualTools(server: McpServer): void {
  registerTool(
    server,
    "visual_regression_setup",
    "Setup de regressão visual",
    "Visual grava `<slug>.visual.spec.ts` com a página real e a API mockada no estado sucesso. Executa no Playwright local quando o binário existe. Sem baseline, usa --update-snapshots na primeira vez. Percy, Chromatic e Applitools só ganham config se estiverem na stack ou no input tool.",
    {
      tool: z.enum(["percy", "chromatic", "applitools"]).optional(),
      baseUrl: z.string().optional().describe("Só executa se for localhost ou 127.0.0.1."),
      route: z.string().optional(),
      routeParams: z.record(z.string()).optional(),
      apiPattern: z.string().optional(),
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
