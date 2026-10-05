import fs from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { renderE2eTest } from "../lib/codegen.js";
import { chooseE2eFramework, detectStack, resolveJsRunner, stackSummary, type E2eFramework } from "../lib/detect.js";
import { codeBlock, doc, splitSteps } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";
import type { ProjectContextInput } from "../lib/schema.js";
import { runShape, writeShape } from "../lib/schema.js";
import { extractUi, routeFromPage, screenComponent } from "../lib/web.js";
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

const PROBE_MS = 800;

function portFromUrl(raw?: string): number | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const port = new URL(raw).port;
    if (!port) return undefined;
    const value = Number(port);
    return value > 0 && value < 65536 ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Porta do projeto: vite, next, scripts do package.json, baseURL do Playwright. */
export function discoverProjectPort(projectRoot?: string): number | undefined {
  if (!projectRoot) return undefined;
  const root = path.resolve(projectRoot);
  if (!fs.existsSync(root)) return undefined;
  const read = (name: string) => {
    try {
      const full = path.join(root, name);
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return undefined;
      return fs.readFileSync(full, "utf8");
    } catch {
      return undefined;
    }
  };
  for (const name of ["vite.config.ts", "vite.config.js", "vite.config.mjs", "vite.config.cjs"]) {
    const text = read(name);
    const server = text?.match(/server\s*:\s*\{[\s\S]{0,800}?port\s*:\s*(\d+)/);
    if (server) return Number(server[1]);
    const plain = text?.match(/\bport\s*:\s*(\d+)/);
    if (plain) return Number(plain[1]);
  }
  for (const name of ["next.config.ts", "next.config.js", "next.config.mjs", "next.config.cjs"]) {
    const plain = read(name)?.match(/\bport\s*:\s*(\d+)/);
    if (plain) return Number(plain[1]);
  }
  const scripts = read("package.json");
  if (scripts) {
    try {
      const pkg = JSON.parse(scripts) as { scripts?: Record<string, string> };
      const entries = pkg.scripts ?? {};
      const keys = ["dev", "start", "preview", ...Object.keys(entries)];
      const seen = new Set<string>();
      for (const key of keys) {
        if (seen.has(key)) continue;
        seen.add(key);
        const script = entries[key];
        if (!script) continue;
        const flag = script.match(/(?:^|\s)(?:--port|-p)\s+(\d+)/);
        if (flag) return Number(flag[1]);
        const env = script.match(/(?:^|\s)PORT=(\d+)/);
        if (env) return Number(env[1]);
      }
    } catch {
      /* manifesto ilegível */
    }
  }
  for (const name of ["playwright.config.ts", "playwright.config.js", "playwright.config.mjs"]) {
    const base = read(name)?.match(/baseURL\s*:\s*["'`]https?:\/\/[^"'`\s:]+:(\d+)/);
    if (base) return Number(base[1]);
  }
  return undefined;
}

function loopbackBase(raw: string | undefined, projectRoot?: string): { base: string; external: boolean; portNote?: string } {
  const configured = discoverProjectPort(projectRoot);
  const requested = portFromUrl(raw);
  const external = outsideBase(raw);
  const port = configured ?? requested ?? 3000;
  const base = `http://127.0.0.1:${port}`;
  if (configured && requested && configured !== requested) {
    return {
      base,
      external,
      portNote: `A URL pedia a porta ${requested}. O config do projeto usa ${configured}, então o teste abre \`${base}\`.`,
    };
  }
  if (external) {
    return { base, external: true, portNote: `A URL de fora foi ignorada. O teste abre só \`${base}\`.` };
  }
  return { base, external: false };
}

async function serverResponds(base: string, route?: string): Promise<boolean> {
  const path = route && route !== "/" ? route : "/";
  const url = `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  try {
    const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(PROBE_MS), redirect: "manual" });
    return response.status >= 200 && response.status < 300;
  } catch {
    return false;
  }
}

export async function buildE2eTest(input: GenerateE2eTestInput): Promise<BuiltE2eTest> {
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
  const located = loopbackBase(input.baseUrl, input.projectRoot);
  const component = screenComponent(input.sourceCode ?? "", input.filePath);
  const isPage = Boolean(route);
  const live = isPage ? await serverResponds(located.base, route) : false;
  const mode = !isPage
    ? stack.componentTesting && component
      ? "component"
      : "mocked"
    : live
      ? "live"
      : stack.componentTesting && component
        ? "component"
        : "mocked";
  const jsRunner = resolveJsRunner({ projectRoot: input.projectRoot, filePath: input.filePath, stack });
  const rendered = renderE2eTest({
    framework: mode === "mocked" ? choice.framework : "playwright",
    steps,
    baseUrl: located.base,
    title: steps[0] ?? (route ? `tela ${route}` : "fluxo principal"),
    controls,
    route: isPage ? route : undefined,
    sourceCode: input.sourceCode,
    filePath: input.filePath,
    mode,
    componentName: component?.name,
    componentDefaultExport: component?.defaultExport,
    ctPackage: stack.componentTesting,
    runner: jsRunner,
  });
  const heading =
    mode === "live"
      ? `# E2E local — ${choice.framework}`
      : mode === "component"
        ? "# Component testing"
        : "# Tela mockada";
  const lead =
    mode === "live"
      ? "E2E local. O Playwright faz page.goto na URL real e toBeVisible nos controles. O documento não passa por route.fulfill. A página não é mockada."
      : mode === "component"
        ? "Isto é component testing, não um browser contra o servidor. O teste monta o componente exportado com mount."
        : "Isto é tela mockada. Não passa por bundler, roteador, estado, CSS nem hidratação.";

  return {
    result: textResult(
    doc([
      heading,
      lead,
      input.filePath && !isPage
        ? "Este arquivo não é página (`pages/` ou `app/.../page`). Não invento URL e não uso o localhost como E2E live."
        : undefined,
      `**Arquivo:** \`${rendered.fileName}\``,
      located.portNote ? `> ${located.portNote}` : undefined,
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
      citeKnowledge(mode === "mocked" ? ["test-design-techniques"] : ["e2e-testing", "black-white-gray-box"]),
    ]),
    ),
    code: rendered.code,
    fileName: rendered.fileName,
    framework: mode === "mocked" ? choice.framework : "playwright",
  };
}

export async function generateE2eTest(input: GenerateE2eTestInput): Promise<ToolTextResult> {
  return (await buildE2eTest(input)).result;
}

export function registerE2eTools(server: McpServer): void {
  registerTool(
    server,
    "generate_e2e_test",
    "Gerar teste E2E",
    "E2E só quando o localhost responde ou há Component Testing; senão é tela mockada e não prova o app. Grava e executa o Playwright (`*.spec.ts`) quando esse runner está na lista fechada; Cypress e Selenium são gravados e ficam sem execução.",
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
      const built = await buildE2eTest(ready);
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
