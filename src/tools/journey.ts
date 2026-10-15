import fs from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectStack, stackSummary } from "../lib/detect.js";
import { bulletList, codeBlock, doc } from "../lib/format.js";
import { nodeModuleExists, readDevScript, readPlaywrightMeta } from "../lib/front-spec.js";
import {
  authSteps,
  describeTarget,
  journeyTargets,
  renderJourneyConfig,
  renderJourneySpec,
  renderJourneyWorkflow,
  type ApiCall,
  type JourneyAuth,
  type JourneyStep,
  type JourneyTarget,
} from "../lib/journey.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";
import { runnerInstalled } from "../lib/runner.js";
import { extractUi, type UiControl } from "../lib/web.js";
import { readProjectFile, writeProjectFile } from "../lib/workspace.js";
import { discoverProjectPort } from "./e2e.js";
import { persistGenerated } from "./execution.js";
import { isLocalHost, resolveToolRoot, shouldRun, shouldWrite } from "./loop.js";

export const JOURNEY_CONFIG = "playwright.journeys.config.ts";
const JOURNEY_TIMEOUT_MS = 600_000;

const target = z
  .object({
    testId: z.string().optional(),
    role: z.string().optional().describe("Papel ARIA: button, link, textbox, heading, combobox, row, dialog..."),
    name: z.string().optional().describe("Nome acessível, junto com role."),
    label: z.string().optional(),
    placeholder: z.string().optional(),
    text: z.string().optional(),
    css: z.string().optional().describe("Último recurso. Prefira testId, role ou label."),
    exact: z.boolean().optional(),
    nth: z.number().int().min(0).optional(),
  })
  .describe("Como achar o elemento. Ordem de preferência: testId, role+name, label, placeholder, text, css.");

const saveAs = z
  .record(z.string())
  .optional()
  .describe('Variáveis tiradas do JSON da resposta: { "pedidoId": "data.id" }. Use depois como {{pedidoId}}.');

const textMatch = z
  .object({
    from: z.string().optional().describe("Caminho no JSON. Sem ele, o corpo inteiro."),
    pattern: z.string().describe("Regex; o primeiro grupo vira o valor."),
    saveAs: z.string(),
  })
  .optional();

const awaitResponse = z
  .object({
    method: z.string().optional(),
    url: z.string().describe("Trecho ou glob da URL da chamada, ex.: /api/orders ou */api/orders/*"),
    status: z.number().int().optional(),
    saveAs,
  })
  .optional()
  .describe("Espera a chamada de API que a ação dispara e confere o status real do backend.");

const common = {
  label: z.string().optional().describe("Título do passo no relatório."),
  as: z.string().optional().describe("Ator (de actors) ou aba (de opensTab) onde o passo roda. Padrão: usuário principal."),
};

const step = z.discriminatedUnion("action", [
  z.object({ action: z.literal("goto"), path: z.string(), ...common }),
  z.object({ action: z.literal("reload"), ...common }),
  z.object({ action: z.literal("back"), ...common }),
  z.object({
    action: z.literal("click"),
    target,
    awaitResponse,
    opensTab: z.string().optional().describe("O clique abre nova aba/janela; ela ganha este nome para usar em `as`."),
    ...common,
  }),
  z.object({ action: z.literal("fill"), target, value: z.string(), ...common }),
  z.object({ action: z.literal("select"), target, value: z.string(), ...common }),
  z.object({ action: z.literal("check"), target, ...common }),
  z.object({ action: z.literal("uncheck"), target, ...common }),
  z.object({ action: z.literal("hover"), target, ...common }),
  z.object({ action: z.literal("dragTo"), target, to: target, ...common }),
  z.object({ action: z.literal("press"), key: z.string(), target: target.optional(), awaitResponse, ...common }),
  z.object({
    action: z.literal("upload"),
    target,
    files: z.array(z.string()).min(1).describe("Caminhos relativos à raiz do projeto, ex.: tests/fixtures/contrato.pdf"),
    ...common,
  }),
  z.object({
    action: z.literal("download"),
    target,
    expectFileName: z.string().optional().describe("Nome ou glob, ex.: relatorio-*.csv"),
    expectContains: z.string().optional().describe("Texto que o arquivo baixado precisa conter."),
    saveAs: z.string().optional(),
    ...common,
  }),
  z.object({
    action: z.literal("dialog"),
    accept: z.boolean().optional().describe("Padrão true. Vale para o próximo alert/confirm/prompt."),
    promptText: z.string().optional(),
    saveAs: z.string().optional().describe("Guarda a mensagem do diálogo."),
    ...common,
  }),
  z.object({ action: z.literal("expectVisible"), target, ...common }),
  z.object({ action: z.literal("expectHidden"), target, ...common }),
  z.object({ action: z.literal("expectText"), text: z.string(), target: target.optional(), ...common }),
  z.object({ action: z.literal("expectValue"), target, value: z.string(), ...common }),
  z.object({ action: z.literal("expectCount"), target, count: z.number().int().min(0), ...common }),
  z.object({ action: z.literal("expectEnabled"), target, ...common }),
  z.object({ action: z.literal("expectDisabled"), target, ...common }),
  z.object({ action: z.literal("expectChecked"), target, ...common }),
  z.object({ action: z.literal("expectUrl"), path: z.string().describe("Trecho ou glob da URL esperada."), ...common }),
  z.object({
    action: z.literal("capture"),
    target,
    saveAs: z.string(),
    pattern: z.string().optional().describe("Regex; o primeiro grupo vira o valor. Ex.: Pedido #(\\d+)"),
    ...common,
  }),
  z.object({
    action: z.literal("api"),
    method: z.string().optional(),
    path: z.string(),
    body: z.unknown().optional(),
    expectStatus: z.number().int().optional(),
    expectJson: z.record(z.unknown()).optional().describe('Caminho → valor esperado: { "status": "PAGO" }.'),
    saveAs,
    match: textMatch,
    ...common,
  }),
  z.object({
    action: z.literal("email"),
    to: z.string().describe("Destinatário. Use {{runId}} para isolar, ex.: ana+{{runId}}@teste.com"),
    subject: z.string().optional(),
    expectText: z.string().optional(),
    saveLink: z.string().optional().describe("Guarda o primeiro link do e-mail (ou o que casar com linkPattern)."),
    linkPattern: z.string().optional(),
    match: textMatch,
    timeoutSeconds: z.number().int().optional(),
    ...common,
  }),
  z.object({
    action: z.literal("expectScreenshot"),
    name: z.string(),
    target: target.optional(),
    mask: z.array(target).optional().describe("Partes que mudam a cada execução (data, id) e não entram na comparação."),
    maxDiffPixelRatio: z.number().optional(),
    ...common,
  }),
  z.object({
    action: z.literal("a11y"),
    target: target.optional().describe("Só css é usado para recortar a análise."),
    tags: z.array(z.string()).optional(),
    minImpact: z.enum(["minor", "moderate", "serious", "critical"]).optional().describe("Padrão serious."),
    ...common,
  }),
  z.object({ action: z.literal("screenshot"), name: z.string(), ...common }),
]);

const apiCall = z.object({
  method: z.string().optional(),
  path: z.string(),
  body: z.unknown().optional(),
  expectStatus: z.number().int().optional(),
  saveAs,
});

const authShape = z.object({
  loginPath: z.string(),
  userTarget: target,
  passwordTarget: target,
  submitTarget: target,
  userEnv: z.string().optional().describe("Padrão E2E_USER."),
  passwordEnv: z.string().optional().describe("Padrão E2E_PASSWORD."),
  successPath: z.string().optional(),
  successText: z.string().optional(),
});

export interface GenerateJourneyInput {
  name: string;
  steps: JourneyStep[];
  baseUrl?: string;
  apiBaseUrl?: string;
  apiHeaders?: Record<string, string>;
  healthPath?: string;
  auth?: JourneyAuth;
  actors?: Record<string, JourneyAuth>;
  seed?: ApiCall[];
  cleanup?: ApiCall[];
  pageFiles?: string[];
  allowRemote?: boolean;
  stepTimeoutSeconds?: number;
  locale?: string;
  timezoneId?: string;
  colorScheme?: "light" | "dark";
  retries?: number;
  mailUrl?: string;
  projectRoot?: string;
  writeToProject?: boolean;
  run?: boolean;
  overwrite?: boolean;
  updateSnapshots?: boolean;
}

function matches(control: UiControl, wanted: string): boolean {
  const needle = wanted.trim().toLowerCase();
  if (!needle || /\{\{/.test(wanted)) return true;
  return [control.text, control.name].some((value) => value?.toLowerCase().includes(needle) || (value && needle.includes(value.toLowerCase())));
}

function checkTargets(targets: JourneyTarget[], controls: UiControl[]): string[] {
  const missing: string[] = [];
  for (const item of targets) {
    if (item.css) continue;
    const wanted = item.testId ?? item.name ?? item.label ?? item.placeholder ?? item.text;
    if (!wanted) continue;
    if (!controls.some((control) => matches(control, wanted))) missing.push(describeTarget(item));
  }
  return [...new Set(missing)];
}

function journeyConfigExists(projectRoot?: string): boolean {
  return Boolean(projectRoot && fs.existsSync(path.join(projectRoot, JOURNEY_CONFIG)));
}

/** testDir do config de jornadas, sem o sufixo /journeys. */
function journeyTestDir(projectRoot?: string): string {
  if (projectRoot && journeyConfigExists(projectRoot)) {
    try {
      const text = fs.readFileSync(path.join(projectRoot, JOURNEY_CONFIG), "utf8");
      const dir = text.match(/testDir\s*:\s*["'`]([^"'`]+)["'`]/)?.[1];
      if (dir) return dir.replace(/\\/g, "/").replace(/\/journeys\/?$/, "");
    } catch {
      /* config ilegível */
    }
  }
  return readPlaywrightMeta(projectRoot, false).testDir;
}

export async function generateJourneyTest(server: McpServer | undefined, input: GenerateJourneyInput): Promise<ToolTextResult> {
  const projectRoot = (await resolveToolRoot(server, input.projectRoot)) ?? input.projectRoot;
  const port = discoverProjectPort(projectRoot) ?? 3000;
  const baseUrl = input.baseUrl?.trim() || `http://127.0.0.1:${port}`;
  const apiBaseUrl = input.apiBaseUrl?.trim() || undefined;
  try {
    new URL(baseUrl);
    if (apiBaseUrl) new URL(apiBaseUrl);
  } catch {
    return errorResult(`URL inválida: ${input.baseUrl ?? ""} ${input.apiBaseUrl ?? ""}`.trim());
  }

  let rendered;
  try {
    rendered = renderJourneySpec({
      name: input.name,
      baseUrl,
      apiBaseUrl,
      apiHeaders: input.apiHeaders,
      healthPath: input.healthPath,
      auth: input.auth,
      actors: input.actors,
      seed: input.seed,
      steps: input.steps,
      cleanup: input.cleanup,
      stepTimeoutSeconds: input.stepTimeoutSeconds,
      locale: input.locale,
      timezoneId: input.timezoneId,
      colorScheme: input.colorScheme,
      retries: input.retries,
      mailUrl: input.mailUrl,
    });
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }

  const notes = [...rendered.notes];

  // Confere os alvos contra os arquivos de tela informados.
  if (input.pageFiles?.length) {
    if (!projectRoot) {
      notes.push("pageFiles precisa da raiz do projeto. Não conferi os alvos.");
    } else {
      const controls: UiControl[] = [];
      for (const file of input.pageFiles) {
        try {
          controls.push(...extractUi(readProjectFile(projectRoot, file), { projectRoot }));
        } catch (error) {
          notes.push(`Não li \`${file}\`: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const all = [
        ...(input.auth ? authSteps(input.auth) : []),
        ...Object.entries(input.actors ?? {}).flatMap(([name, auth]) => authSteps(auth, name)),
        ...input.steps,
      ];
      const missing = checkTargets(journeyTargets(all), controls);
      if (missing.length) {
        notes.push(`Não achei nos arquivos de tela: ${missing.join(", ")}. Confira o texto ou use data-testid.`);
      } else {
        notes.push(`Todos os alvos aparecem nos ${input.pageFiles.length} arquivos de tela informados.`);
      }
    }
  }

  const remote = !isLocalHost(baseUrl) || (apiBaseUrl ? !isLocalHost(apiBaseUrl) : false);
  const stack = detectStack(projectRoot);
  const withConfig = journeyConfigExists(projectRoot);
  const testDir = journeyTestDir(projectRoot);
  const relativePath = `${testDir}/journeys/${rendered.fileName}`;
  const installed = projectRoot ? runnerInstalled(projectRoot, "playwright") : false;
  const write = shouldWrite(input.writeToProject, projectRoot);
  let run = shouldRun(input.run, true, projectRoot);
  if (run && remote && !input.allowRemote) {
    run = false;
    notes.push(
      "A URL não é localhost. Gravei e não executei. Para rodar contra staging ou homologação, passe `allowRemote: true`. Nunca aponte para produção: a jornada cria e apaga dados.",
    );
  }
  if (run && rendered.envVars.length) {
    const absent = rendered.envVars.filter((name) => process.env[name] === undefined);
    if (absent.length) {
      run = false;
      notes.push(`Faltam variáveis de ambiente no processo do MCP: ${absent.join(", ")}. Gravei e não executei. Defina no bloco \`env\` do mcp.json ou rode no terminal com elas.`);
    }
  }
  for (const pkg of rendered.packages) {
    if (projectRoot && !nodeModuleExists(projectRoot, ...pkg.split("/"))) {
      notes.push(`O spec importa \`${pkg}\`, que não está instalado. Instale com \`npm i -D ${pkg}\`.`);
      run = false;
    }
  }
  if (projectRoot && !installed) {
    notes.push("Não achei `@playwright/test` no projeto. Instale com `npm i -D @playwright/test && npx playwright install chromium`.");
  }
  if (!remote && !withConfig) {
    notes.push(
      "Sem `playwright.journeys.config.ts`: a jornada não sobe o sistema nem roda em vários navegadores. Chame `setup_e2e_environment` uma vez para ter navegadores, celular, webServer, trace, vídeo e relatórios. Até lá, deixe o sistema de pé antes de rodar.",
    );
  }
  const command = withConfig
    ? `npx playwright test -c ${JOURNEY_CONFIG} ${relativePath}`
    : `npx playwright test ${relativePath}`;

  const preface = doc([
    `# Jornada ponta a ponta — ${input.name}`,
    "Sistema real, sem mock de rede: navegador → frontend → API → banco. O spec semeia pela API, executa o fluxo com clique e envio, confere o efeito no backend e limpa no final, mesmo se falhar.",
    `**Arquivo:** \`${relativePath}\``,
    `**Alvo:** \`${baseUrl}\`${apiBaseUrl ? ` · API \`${apiBaseUrl}\`` : ""} (sobrescreva com E2E_BASE_URL e E2E_API_URL).`,
    input.actors && Object.keys(input.actors).length ? `**Atores:** principal, ${Object.keys(input.actors).join(", ")} (cada um no próprio navegador).` : undefined,
    rendered.envVars.length ? `**Variáveis de ambiente:** ${rendered.envVars.map((name) => `\`${name}\``).join(", ")}.` : undefined,
    "## Passos",
    rendered.stepTitles.map((title) => `- ${title}`).join("\n"),
    notes.length ? `## Notas\n${bulletList(notes)}` : undefined,
    "## Stack detectada",
    stackSummary(stack),
    "## Código",
    codeBlock("ts", rendered.code),
    "## Como rodar",
    `\`${command}\` · todas as jornadas: \`npx playwright test${withConfig ? ` -c ${JOURNEY_CONFIG}` : " --grep @journey"}\``,
    citeKnowledge(["e2e-testing", "test-environments"]),
  ]);

  if (!write && !run) return textResult([preface, "Não foi gravado nem executado."].join("\n\n"));
  const willRun = run && installed;
  return persistGenerated({
    projectRoot,
    fileName: rendered.fileName,
    relativePath,
    code: rendered.code,
    runner: installed ? "playwright" : undefined,
    write,
    run: willRun,
    overwrite: input.overwrite,
    configFile: withConfig ? JOURNEY_CONFIG : undefined,
    updateSnapshots: willRun && (input.updateSnapshots ?? false),
    timeoutMs: JOURNEY_TIMEOUT_MS,
    preface: willRun ? preface : `${preface}\n\nNão foi executado.`,
  });
}

export interface SetupEnvironmentInput {
  projectRoot?: string;
  baseUrl?: string;
  browsers?: Array<"chromium" | "firefox" | "webkit">;
  mobileDevices?: string[];
  servers?: Array<{ command: string; url: string; cwd?: string; timeoutSeconds?: number }>;
  compose?: boolean;
  composeUrl?: string;
  locale?: string;
  timezoneId?: string;
  retriesLocal?: number;
  retriesCi?: number;
  workers?: number;
  ci?: boolean;
  secrets?: string[];
  overwrite?: boolean;
  writeToProject?: boolean;
}

export async function setupE2eEnvironment(server: McpServer | undefined, input: SetupEnvironmentInput): Promise<ToolTextResult> {
  const projectRoot = (await resolveToolRoot(server, input.projectRoot)) ?? input.projectRoot;
  const port = discoverProjectPort(projectRoot) ?? 3000;
  const baseUrl = input.baseUrl?.trim() || `http://127.0.0.1:${port}`;
  const testDir = readPlaywrightMeta(projectRoot, false).testDir;
  const servers = [...(input.servers ?? [])];
  if (input.compose) {
    servers.unshift({ command: "docker compose up", url: input.composeUrl?.trim() || baseUrl, timeoutSeconds: 600 });
  }
  const notes: string[] = [];
  if (!servers.length) {
    servers.push({ command: readDevScript(projectRoot), url: baseUrl });
    notes.push(`Sem servers nem compose: o webServer usa \`${readDevScript(projectRoot)}\` em \`${baseUrl}\`. Se o backend roda separado, passe servers com um item por processo (frontend, API, worker).`);
  }
  const browsers = input.browsers?.length ? input.browsers : ["chromium" as const];
  const config = renderJourneyConfig({
    testDir,
    baseUrl,
    browsers,
    mobileDevices: input.mobileDevices,
    servers,
    locale: input.locale ?? "pt-BR",
    timezoneId: input.timezoneId ?? "America/Sao_Paulo",
    retriesLocal: input.retriesLocal,
    retriesCi: input.retriesCi,
    workers: input.workers,
  });
  const workflow = input.ci === false ? undefined : renderJourneyWorkflow({ browsers, secrets: input.secrets, compose: input.compose });

  const written: string[] = [];
  const write = shouldWrite(input.writeToProject, projectRoot);
  if (write) {
    if (!projectRoot) return errorResult("Gravar precisa da raiz. Passe projectRoot ou abra a pasta no Cursor.");
    for (const [relative, contents] of [
      [JOURNEY_CONFIG, config],
      ...(workflow ? [[".github/workflows/e2e-journeys.yml", workflow]] : []),
    ] as Array<[string, string]>) {
      try {
        if (fs.existsSync(path.join(projectRoot, relative)) && !input.overwrite) {
          written.push(`Já existe, não substituí: \`${relative}\` (passe overwrite: true).`);
          continue;
        }
        written.push(`Gravado: \`${writeProjectFile(projectRoot, relative, contents, input.overwrite)}\``);
      } catch (error) {
        written.push(`Não gravei \`${relative}\`: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const missing: string[] = [];
  if (projectRoot && !runnerInstalled(projectRoot, "playwright")) missing.push("@playwright/test");
  const install = [
    missing.length ? `npm i -D ${missing.join(" ")}` : undefined,
    `npx playwright install ${browsers.join(" ")}`,
  ].filter(Boolean);

  return textResult(
    doc([
      "# Ambiente de jornadas E2E",
      "Um config só para as jornadas ponta a ponta, separado dos testes de tela com API mockada.",
      bulletList([
        `Navegadores: ${browsers.join(", ")}${input.mobileDevices?.length ? `; celular: ${input.mobileDevices.join(", ")}` : ""}.`,
        `Sobe o sistema antes (webServer): ${servers.map((item) => `\`${item.command}\` → ${item.url}`).join("; ")}. Localmente reaproveita o que já está de pé.`,
        "Evidências na falha: trace (passo a passo), vídeo e screenshot. Relatórios HTML e JUnit.",
        `Novas tentativas: ${input.retriesLocal ?? 0} local, ${input.retriesCi ?? 2} no CI. Idioma ${input.locale ?? "pt-BR"}, fuso ${input.timezoneId ?? "America/Sao_Paulo"}.`,
        workflow ? "CI: GitHub Actions roda as jornadas em todo PR e guarda o relatório como artefato." : "Sem workflow de CI (ci: false).",
      ]),
      written.length ? `## Arquivos\n${bulletList(written)}` : undefined,
      notes.length ? `## Notas\n${bulletList(notes)}` : undefined,
      "## Instalar",
      codeBlock("bash", install.join("\n")),
      "## Rodar",
      codeBlock(
        "bash",
        [
          `npx playwright test -c ${JOURNEY_CONFIG}`,
          `npx playwright test -c ${JOURNEY_CONFIG} --project=chromium --headed   # vendo o navegador`,
          `npx playwright test -c ${JOURNEY_CONFIG} --ui                            # modo interativo`,
          "npx playwright show-report playwright-report/journeys",
        ].join("\n"),
      ),
      "Acrescente ao .gitignore: `test-results/`, `playwright-report/`.",
      "## Config",
      codeBlock("ts", config),
      workflow ? `## Workflow\n${codeBlock("yaml", workflow)}` : undefined,
      citeKnowledge(["e2e-testing", "test-environments"]),
    ]),
  );
}

export function registerJourneyTools(server: McpServer): void {
  registerTool(
    server,
    "generate_journey_test",
    "Gerar jornada ponta a ponta",
    "E2E de verdade: jornada de várias páginas contra o sistema inteiro rodando, sem mock de rede. Login pela tela com credencial de variável de ambiente, vários usuários ao mesmo tempo (actors), novas abas, upload, download, diálogos, seed pela API, espera da chamada de API com status, captura de valores ({{pedidoId}}), verificação no backend, e-mail (Mailpit), comparação visual, acessibilidade (axe) e limpeza no final. Grava `<testDir>/journeys/<slug>.journey.spec.ts` e executa no Playwright. Fora do localhost só executa com allowRemote.",
    {
      name: z.string().describe("Nome da jornada, ex.: 'cliente compra e acompanha o pedido'."),
      steps: z.array(step).min(1).describe("Passos em ordem. Valores aceitam {{runId}}, {{env.NOME}} e variáveis capturadas."),
      baseUrl: z.string().optional().describe("URL do frontend. Padrão http://127.0.0.1:<porta do projeto>."),
      apiBaseUrl: z.string().optional().describe("URL da API, se for outra. Padrão baseUrl."),
      apiHeaders: z.record(z.string()).optional().describe('Cabeçalhos do seed e da limpeza, ex.: { "Authorization": "Bearer {{env.API_TOKEN}}" }.'),
      healthPath: z.string().optional().describe("Caminho checado antes de começar. Padrão /."),
      auth: authShape.optional().describe("Login do usuário principal pela tela real. Credenciais vêm de variável de ambiente."),
      actors: z
        .record(authShape)
        .optional()
        .describe('Outros usuários, cada um no próprio navegador: { "admin": { loginPath, ..., userEnv: "E2E_ADMIN_USER", passwordEnv: "E2E_ADMIN_PASSWORD" } }. Use `as` no passo.'),
      seed: z.array(apiCall).optional().describe("Chamadas de API antes da jornada (POST padrão)."),
      cleanup: z.array(apiCall).optional().describe("Chamadas de API no final, em ordem reversa, mesmo com falha (DELETE padrão)."),
      pageFiles: z.array(z.string()).optional().describe("Arquivos das telas da jornada, para conferir se os alvos existem."),
      allowRemote: z.boolean().optional().describe("Permite executar contra host fora do localhost (staging). Nunca produção."),
      stepTimeoutSeconds: z.number().int().optional(),
      locale: z.string().optional().describe("Ex.: pt-BR, en-US."),
      timezoneId: z.string().optional().describe("Ex.: America/Sao_Paulo."),
      colorScheme: z.enum(["light", "dark"]).optional(),
      retries: z.number().int().min(0).max(5).optional().describe("Novas tentativas desta jornada. Prefira consertar a instabilidade."),
      mailUrl: z.string().optional().describe("Mailpit local. Padrão http://127.0.0.1:8025."),
      projectRoot: z.string().optional(),
      writeToProject: z.boolean().optional().describe("false não grava. Omitido, grava quando a raiz do projeto existe."),
      overwrite: z.boolean().optional(),
      run: z.boolean().optional().describe("false não executa. Omitido, executa com Playwright instalado."),
      updateSnapshots: z.boolean().optional().describe("Cria ou atualiza as referências de expectScreenshot."),
    },
    (args) => generateJourneyTest(server, args as unknown as GenerateJourneyInput),
    { readOnly: false },
  );

  registerTool(
    server,
    "setup_e2e_environment",
    "Preparar ambiente E2E",
    "Grava `playwright.journeys.config.ts` e o workflow de CI das jornadas: navegadores (chromium, firefox, webkit), celular emulado, webServer que sobe o sistema (comandos ou docker compose), trace, vídeo e screenshot na falha, novas tentativas, idioma e fuso, relatórios HTML e JUnit. Chame uma vez por projeto; depois `generate_journey_test` usa este config.",
    {
      projectRoot: z.string().optional(),
      baseUrl: z.string().optional().describe("URL do frontend. Padrão http://127.0.0.1:<porta do projeto>."),
      browsers: z.array(z.enum(["chromium", "firefox", "webkit"])).optional().describe("Padrão chromium."),
      mobileDevices: z.array(z.string()).optional().describe('Dispositivos do Playwright, ex.: ["Pixel 7", "iPhone 14"].'),
      servers: z
        .array(
          z.object({
            command: z.string().describe("Ex.: npm run dev, npm run start:api"),
            url: z.string().describe("URL que responde quando o processo está pronto."),
            cwd: z.string().optional(),
            timeoutSeconds: z.number().int().optional(),
          }),
        )
        .optional()
        .describe("Processos a subir antes das jornadas: frontend, API, worker."),
      compose: z.boolean().optional().describe("Sobe o sistema com docker compose up."),
      composeUrl: z.string().optional().describe("URL que indica que o compose está pronto. Padrão baseUrl."),
      locale: z.string().optional().describe("Padrão pt-BR."),
      timezoneId: z.string().optional().describe("Padrão America/Sao_Paulo."),
      retriesLocal: z.number().int().min(0).max(5).optional(),
      retriesCi: z.number().int().min(0).max(5).optional(),
      workers: z.number().int().min(1).max(16).optional(),
      ci: z.boolean().optional().describe("false não grava o workflow do GitHub Actions."),
      secrets: z.array(z.string()).optional().describe("Variáveis que o CI lê dos secrets, ex.: E2E_USER, E2E_PASSWORD."),
      overwrite: z.boolean().optional(),
      writeToProject: z.boolean().optional(),
    },
    (args) => setupE2eEnvironment(server, args as unknown as SetupEnvironmentInput),
    { readOnly: false },
  );
}
