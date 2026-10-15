import fs from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { renderE2eTest } from "../lib/codegen.js";
import { chooseE2eFramework, detectStack, resolveJsRunner, stackSummary, type E2eFramework } from "../lib/detect.js";
import {
  playwrightClockSupported,
  readPlaywrightMeta,
  webServerSnippet,
  type RenderedFrontTest,
} from "../lib/front-spec.js";
import { codeBlock, doc, splitSteps } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";
import type { TestRunner } from "../lib/runner.js";
import type { ProjectContextInput } from "../lib/schema.js";
import { runShape, writeShape } from "../lib/schema.js";
import {
  detectsSsr,
  extractUi,
  resolvePageRoute,
  screenComponent,
  slugFor,
} from "../lib/web.js";
import { resolveInside, writeProjectFile } from "../lib/workspace.js";
import { persistGenerated } from "./execution.js";
import { hydrateSource, shouldRun, shouldWrite } from "./loop.js";

export interface GenerateE2eTestInput extends ProjectContextInput {
  userFlow?: string;
  framework?: E2eFramework;
  baseUrl?: string;
  writeToProject?: boolean;
  run?: boolean;
  overwrite?: boolean;
  route?: string;
  routeParams?: Record<string, string>;
  apiPattern?: string;
  mockNetwork?: boolean;
}

export interface BuiltE2eTest {
  result: ToolTextResult;
  code?: string;
  fileName?: string;
  folder?: string;
  framework?: E2eFramework;
  fixtures?: RenderedFrontTest["fixtures"];
  ctConfig?: string;
  updateSnapshots?: boolean;
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
  const pathName = route && route !== "/" ? route : "/";
  const url = `${base.replace(/\/$/, "")}${pathName.startsWith("/") ? pathName : `/${pathName}`}`;
  try {
    const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(PROBE_MS), redirect: "manual" });
    return response.status >= 200 && response.status < 300;
  } catch {
    return false;
  }
}

export async function buildE2eTest(input: GenerateE2eTestInput): Promise<BuiltE2eTest> {
  const controls = extractUi(input.sourceCode ?? "", { projectRoot: input.projectRoot });
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
  const located = loopbackBase(input.baseUrl, input.projectRoot);
  const component = screenComponent(input.sourceCode ?? "", input.filePath);
  const resolved = resolvePageRoute({
    filePath: input.filePath,
    projectRoot: input.projectRoot,
    route: input.route,
    routeParams: input.routeParams,
    componentName: component?.name,
  });
  const isPage = Boolean(resolved.path || resolved.pattern);
  const mockNetwork = input.mockNetwork !== false;
  const ctMeta = readPlaywrightMeta(input.projectRoot, true);
  const pwMeta = readPlaywrightMeta(input.projectRoot, false);
  const mode = !isPage && stack.componentTesting && component
    ? "component"
    : isPage && mockNetwork
      ? "network"
      : isPage && !mockNetwork
        ? "live"
        : stack.componentTesting && component
          ? "component"
          : "network";
  const meta = mode === "component" ? ctMeta : pwMeta;
  const slug = slugFor(resolved.pattern ?? resolved.path, component?.name, input.filePath);
  const liveNow = isPage ? await serverResponds(located.base, resolved.path) : false;
  const jsRunner = resolveJsRunner({ projectRoot: input.projectRoot, filePath: input.filePath, stack });
  const framework = mode === "component" || mode === "live" ? "playwright" : choice.framework;
  const rendered = renderE2eTest({
    framework,
    steps,
    baseUrl: located.base,
    title: steps[0] ?? (resolved.path ? `tela ${resolved.path}` : "fluxo principal"),
    controls,
    route: resolved.path,
    sourceCode: input.sourceCode,
    filePath: input.filePath,
    mode,
    mockNetwork,
    componentName: component?.name,
    componentDefaultExport: component?.defaultExport,
    ctPackage: stack.componentTesting,
    runner: jsRunner,
    apiPattern: input.apiPattern,
    projectRoot: input.projectRoot,
    testDir: meta.testDir,
    slug,
    hasClock: playwrightClockSupported(input.projectRoot),
  });
  const ssr = detectsSsr(input.sourceCode ?? "", input.filePath);
  const heading =
    mode === "live"
      ? `# E2E local — ${framework}`
      : mode === "component"
        ? "# Component testing"
        : "# Página real, API mockada";
  const lead =
    mode === "live"
      ? "Spec contra o backend real, sem mock de rede. Sem clique em botão."
      : mode === "component"
        ? "Isto é component testing, não um browser contra o servidor. O teste monta o componente exportado com mount."
        : "Página real com a API mockada. O documento, o CSS e os scripts vêm do dev server. O teste falha quando o componente muda.";
  const notes = [
    ...rendered.notes,
    liveNow ? "O servidor responde agora no localhost." : "O servidor não respondeu agora. O teste só roda com o dev server no ar.",
    !meta.hasWebServer && mode !== "component"
      ? `Não achei webServer na config do Playwright. Acrescente:\n\n\`\`\`ts\n${webServerSnippet(input.projectRoot)}\n\`\`\`\n\nO teste só roda com o servidor de pé.`
      : undefined,
    resolved.assumed ? `A rota \`${resolved.path}\` foi suposta. Passe o input route se estiver errada.` : undefined,
    resolved.guessedFromPages && !resolved.assumed ? "A rota saiu de src/pages sem Next no package.json. Confira o roteador." : undefined,
    resolved.paramsUsed && Object.keys(resolved.paramsUsed).length
      ? `Parâmetros da rota: ${Object.entries(resolved.paramsUsed)
          .map(([key, value]) => `${key}=${value}`)
          .join(", ")}.`
      : undefined,
    ssr
      ? "page.route não intercepta fetch do servidor. A API precisa apontar para um mock local via variável de ambiente. No perfil full, use setup_service_virtualization."
      : undefined,
    rendered.skippedClicks.length
      ? `Cliques pulados (destrutivo ou saída): ${rendered.skippedClicks.map((item) => `"${item}"`).join(", ")}.`
      : undefined,
    rendered.conditionalControls.length
      ? `Aparecem só sob condição: ${rendered.conditionalControls.map((item) => `"${item}"`).join(", ")}.`
      : undefined,
    rendered.missingStaticText.length ? `Controles sem texto estático: ${rendered.missingStaticText.join(", ")}.` : undefined,
    "A fixture em tests/fixtures é para você editar. Se o arquivo já existir, reaproveito.",
  ].filter(Boolean);

  return {
    result: textResult(
      doc([
        heading,
        lead,
        input.filePath && !isPage
          ? "Este arquivo não é página (`pages/` ou `app/.../page`). Não invento URL e não uso o localhost como E2E live."
          : undefined,
        `**Arquivo:** \`${meta.testDir}/${rendered.fileName}\``,
        located.portNote ? `> ${located.portNote}` : undefined,
        choice.warning ? `> ${choice.warning}` : undefined,
        stack.e2eFrameworks.length
          ? `Framework detectado no projeto: ${stack.e2eFrameworks.join(", ")}.`
          : "Nenhum Cypress, Playwright ou Selenium detectado. O padrão adotado é Playwright.",
        "## Stack detectada",
        stackSummary(stack),
        "## Passos do fluxo",
        steps.map((step, index) => `${index + 1}. ${step}`).join("\n"),
        notes.length ? `## Notas\n${notes.map((note) => `- ${note}`).join("\n")}` : undefined,
        "## Código",
        codeBlock(rendered.language, rendered.code),
        "## Estabilidade",
        "- Um fluxo por teste, no caminho de maior risco.",
        "- Localizadores por papel acessível ou data-testid.",
        "- Espere estado, não um sleep fixo.",
        `O teste usa os controles e a rota do arquivo${resolved.path ? ` (\`${resolved.path}\`)` : ""}.${steps.length ? " O userFlow entra junto com esses controles." : ""}`,
        citeKnowledge(["e2e-testing", "black-white-gray-box"]),
      ]),
    ),
    code: rendered.code,
    fileName: rendered.fileName,
    folder: rendered.folder,
    framework,
    fixtures: rendered.fixtures,
    ctConfig: mode === "component" ? ctMeta.configFile : undefined,
  };
}

export async function generateE2eTest(input: GenerateE2eTestInput): Promise<ToolTextResult> {
  return handleGenerateE2eTest(input);
}

export async function handleGenerateE2eTest(input: GenerateE2eTestInput): Promise<ToolTextResult> {
  const built = await buildE2eTest(input);
  if (built.result.isError || !built.code || !built.fileName) return built.result;
  const runner = built.framework === "playwright" ? ("playwright" satisfies TestRunner) : undefined;
  const write = shouldWrite(input.writeToProject, input.projectRoot);
  const run = shouldRun(input.run, Boolean(runner), input.projectRoot);
  const extra: string[] = [];
  if (write && input.projectRoot && built.fixtures?.length) {
    extra.push(...writeFixtures(input.projectRoot, built.fixtures));
  }
  if (write && input.projectRoot) {
    const relative = path.join(built.folder ?? "e2e", built.fileName);
    try {
      const destination = resolveInside(input.projectRoot, relative);
      if (fs.existsSync(destination) && !input.overwrite) {
        return textResult(
          [built.result.content[0]?.text ?? "", ...extra, `O arquivo já existe em \`${destination}\`. Passe overwrite: true para substituir.`].join("\n\n"),
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResult([built.result.content[0]?.text ?? "", message].filter(Boolean).join("\n\n"));
    }
  }
  if (!write && !run) {
    return extra.length
      ? textResult([built.result.content[0]?.text ?? "", ...extra].join("\n\n"))
      : built.result;
  }
  return persistGenerated({
    projectRoot: input.projectRoot,
    fileName: built.fileName,
    code: built.code,
    folder: built.folder ?? "e2e",
    runner,
    write,
    run,
    overwrite: input.overwrite,
    configFile: built.ctConfig,
    preface: [built.result.content[0]?.text ?? "", ...extra, run ? undefined : "Não foi executado."].filter(Boolean).join("\n\n"),
  });
}

function writeFixtures(projectRoot: string, fixtures: RenderedFrontTest["fixtures"]): string[] {
  const notes: string[] = [];
  for (const fixture of fixtures) {
    try {
      const destination = resolveInside(projectRoot, fixture.relativePath);
      if (fs.existsSync(destination)) {
        notes.push(`Fixture reaproveitada: \`${destination}\``);
        continue;
      }
      const written = writeProjectFile(projectRoot, fixture.relativePath, fixture.contents, false);
      notes.push(`Fixture gravada: \`${written}\``);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notes.push(message);
    }
  }
  return notes;
}

export function registerE2eTools(server: McpServer): void {
  registerTool(
    server,
    "generate_e2e_test",
    "Gerar teste E2E",
    "Padrão: página real com a API mockada (`@network-mock`). mockNetwork false gera spec live sem mock e sem clique em botão. Component Testing monta o componente. Grava e executa o Playwright quando o runner está na lista fechada; Cypress e Selenium são gravados e ficam sem execução.",
    {
      userFlow: z.string().optional().describe("Fluxo em linguagem natural. Se o arquivo da tela foi passado, os controles e a rota dele entram no teste."),
      framework: z.enum(["playwright", "cypress", "selenium"]).optional(),
      baseUrl: z.string().optional().describe("Ignorada quando o host é de fora. O spec usa caminho relativo e o baseURL da config."),
      route: z.string().optional().describe("Rota da página. Ganha da dedução pelo arquivo."),
      routeParams: z.record(z.string()).optional().describe("Valores para segmentos dinâmicos. Sem isso, cada parâmetro vira 1."),
      apiPattern: z.string().optional().describe("Glob do catch-all da API. Padrão **/api/**."),
      mockNetwork: z.boolean().optional().describe("false gera spec contra o backend real, sem mock e sem clique em botão. Padrão true."),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
      ...writeShape,
      ...runShape,
    },
    async (args) => {
      const hydrated = await hydrateSource(server, args as unknown as GenerateE2eTestInput);
      if ("isError" in hydrated && hydrated.isError) return hydrated;
      return handleGenerateE2eTest(hydrated as GenerateE2eTestInput);
    },
    { readOnly: false },
  );
}
