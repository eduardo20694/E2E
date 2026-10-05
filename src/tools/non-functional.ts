import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectStack, stackSummary } from "../lib/detect.js";
import { codeBlock, doc, markdownTable } from "../lib/format.js";
import { classifyLayer } from "../lib/edit-map.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";
import { writeShape, runShape, type ProjectContextInput } from "../lib/schema.js";
import { deliver, hydrateSource, isLocalHost, resolveToolRoot, resultText, type LoopFlags } from "./loop.js";
import { runClosed, runnerInstalled, type TestRunner } from "../lib/runner.js";
import { extractRoutes, routeFromPage, screenComponent, type WebRoute } from "../lib/web.js";

export interface PerformancePlanInput extends ProjectContextInput {
  target: string;
  tool?: "k6" | "jmeter" | "gatling";
  expectedRps?: number;
}

export function suggestPerformanceTestPlan(input: PerformancePlanInput): ToolTextResult {
  if (!input.target?.trim()) {
    return errorResult("suggest_performance_test_plan exige target (endpoint ou fluxo).");
  }

  const stack = detectStack(input.projectRoot);
  const { tool, rps } = performanceSelection(input, stack);

  return textResult(
    doc([
      `# Plano de performance — ${tool}`,
      `Alvo: ${input.target}`,
      "Rode somente contra ambiente que você tem autorização para carregar. Não aponte o script para produção sem acordo de janela e teto.",
      "## Stack detectada",
      stackSummary(stack),
      "## Cenários",
      markdownTable(
        ["Cenário", "Perfil", "O que observa"],
        [
          ["Carga", `${rps} iterações/s por 5 min`, "latência p95 e taxa de erro estáveis"],
          ["Stress", `sobe até ${rps * 5}/s`, "ponto em que erro ou latência dispara"],
          ["Volume", "poucos usuários, massa grande", "tempo de consulta e crescimento de armazenamento"],
          ["Resistência", `${Math.max(1, Math.round(rps / 2))}/s por 1 h`, "vazamento de memória e conexão"],
        ],
      ),
      "## Critério de saída sugerido",
      `- p95 < 500 ms no cenário de carga e taxa de erro < 1% em ${input.target}. Ajuste o número ao SLO real.`,
      "## Script",
      codeBlock(tool === "gatling" ? "scala" : tool === "jmeter" ? "xml" : "js", scriptFor(tool, input.target, rps)),
      citeKnowledge(["functional-vs-non-functional", "test-environments"]),
    ]),
  );
}

function performanceSelection(
  input: PerformancePlanInput,
  stack: ReturnType<typeof detectStack>,
): { tool: string; rps: number } {
  const detected = stack.performanceTools.includes("gatling")
    ? "gatling"
    : stack.performanceTools.includes("k6")
      ? "k6"
      : undefined;
  const tool = input.tool ?? detected ?? "k6";
  const rps = input.expectedRps && input.expectedRps > 0 ? input.expectedRps : 20;
  return { tool, rps };
}

/** O script de k6 só pode rodar quando todo host citado é localhost ou 127.0.0.1. */
export function k6ExecutionAllowed(target: string): boolean {
  const script = scriptFor("k6", target, 1);
  const urls = [...script.matchAll(/https?:\/\/[^\s"'`]+/g)].map((match) => match[0]);
  return urls.length > 0 && urls.every((url) => isLocalHost(url));
}

function scriptFor(tool: string, target: string, rps: number): string {
  if (tool === "jmeter") {
    return `<ThreadGroup>
  <stringProp name="ThreadGroup.num_threads">${rps}</stringProp>
  <stringProp name="ThreadGroup.ramp_time">30</stringProp>
  <HTTPSamplerProxy>
    <stringProp name="HTTPSampler.path">${target}</stringProp>
  </HTTPSamplerProxy>
</ThreadGroup>`;
  }
  if (tool === "gatling") {
    return `setUp(
  scenario("${target}")
    .exec(http("alvo").get("${target}"))
    .inject(constantUsersPerSec(${rps}).during(300))
)`;
  }
  return `import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  scenarios: {
    carga: { executor: "constant-arrival-rate", rate: ${rps}, timeUnit: "1s", duration: "5m", preAllocatedVUs: 20 },
  },
  thresholds: { http_req_failed: ["rate<0.01"], http_req_duration: ["p(95)<500"] },
};

export default function () {
  const response = http.get("${target.startsWith("http") ? target : "http://127.0.0.1:3000"}");
  check(response, { "status 2xx": (res) => res.status >= 200 && res.status < 300 });
  sleep(1);
}`;
}

const OWASP = [
  ["A01", "Broken Access Control", "auth|permission|role|admin|idor", "Usuário A não lê nem altera recurso do usuário B. Perfil sem papel recebe 403."],
  ["A02", "Cryptographic Failures", "password|token|secret|jwt|tls", "Segredo não aparece em log, fixture versionada nem resposta de erro. Senha não é comparada em texto puro."],
  ["A03", "Injection", "sql|query|graphql|command|template", "Consulta parametrizada. Entrada com aspas e operadores não altera o resultado além da validação."],
  ["A04", "Insecure Design", "flow|checkout|limit|quota", "Limite de tentativa, cota e regra de negócio existem no servidor, não só na tela."],
  ["A05", "Security Misconfiguration", "cors|header|debug|env", "Debug desligado fora de dev. CORS não reflete origem arbitrária com credencial."],
  ["A06", "Vulnerable Components", "package|dependency|pom|requirements", "Dependência com CVE crítico bloqueia o pipeline. Não é um teste de tela."],
  ["A07", "Identification and Authentication Failures", "login|session|oauth|mfa", "Sessão expira, logout invalida o token e a mensagem de login não revela se o e-mail existe."],
  ["A08", "Software and Data Integrity Failures", "webhook|deserial|yaml|pickle", "Payload externo é validado antes de virar objeto. Atualização de artefato tem origem conferida."],
  ["A09", "Security Logging and Monitoring Failures", "log|audit|metric", "Falha de login e negação de acesso geram evento sem gravar senha ou token."],
  ["A10", "SSRF", "url|webhook|fetch|redirect", "URL informada pelo usuário não alcança rede interna nem metadados de nuvem."],
] as const;

export interface SecurityChecklistInput extends ProjectContextInput {
  context?: string;
}

const OWNER_GAP =
  "A rota tem id e o handler não mostra comparação de dono. A checagem pode estar no middleware. O teste não falha por isso.";

export function suggestSecurityChecklist(input: SecurityChecklistInput): ToolTextResult {
  const blob = `${input.context ?? ""}\n${input.sourceCode ?? ""}\n${input.filePath ?? ""}`;
  if (!blob.trim()) {
    return errorResult("suggest_security_checklist exige context ou sourceCode do que será auditado.");
  }

  const rows = OWASP.map(([id, name, pattern, test]) => {
    const applies = new RegExp(pattern, "i").test(blob);
    return [id, name, applies ? "prioritário neste contexto" : "revisar mesmo assim", test];
  });
  const source = input.sourceCode ?? "";
  const ownerGap = extractRoutes(source).some((route) => routeHasId(route.path)) && !comparesOwner(source);

  return textResult(
    doc([
      "# Checklist OWASP Top 10 (2021) para teste",
      "Itens de verificação. Não são passos de ataque.",
      ownerGap ? `> ${OWNER_GAP}` : undefined,
      markdownTable(["ID", "Risco", "No contexto", "Teste"], rows),
      citeKnowledge(["functional-vs-non-functional"]),
    ]),
  );
}

export interface AccessibilityInput extends ProjectContextInput {
  screen?: string;
  level?: "A" | "AA" | "AAA";
  baseUrl?: string;
}

export function suggestAccessibilityAudit(input: AccessibilityInput): ToolTextResult {
  const level = input.level ?? "AA";
  const screen = input.screen ?? input.filePath ?? "a tela informada";
  return textResult(
    doc([
      `# Auditoria de acessibilidade — WCAG 2.2 ${level}`,
      `Alvo: ${screen}`,
      "## Checagens",
      "- Nome acessível em botão, link e campo. Placeholder não substitui rótulo.",
      "- Contraste de texto e de componente no nível pedido.",
      "- Foco visível e ordem de tabulação igual à ordem visual.",
      "- Erro de formulário ligado ao campo, em texto, não só pela cor.",
      "- Alternativa para conteúdo que não é texto.",
      input.sourceCode ? "Há código de UI no contexto. Procure `div` clicável sem role e `img` sem alt." : undefined,
      "## Exemplo com axe-core e Playwright",
      codeBlock("ts", a11ySpec(input.filePath, input.baseUrl)),
      "axe cobre uma fatia automática. Teclado, leitor de tela e zoom continuam manuais.",
      citeKnowledge(["functional-vs-non-functional", "e2e-testing"]),
    ]),
  );
}

export interface CompatibilityInput {
  audience: string;
  platforms?: string[];
  sourceCode?: string;
}

export function suggestCompatibilityMatrix(input: CompatibilityInput): ToolTextResult {
  if (!input.audience?.trim()) {
    return errorResult("suggest_compatibility_matrix exige audience descrevendo o público.");
  }

  const audience = input.audience.toLowerCase();
  const mobileFirst = /mobile|celular|app|brasil|b2c/.test(audience);
  const enterprise = /empresa|b2b|corporativ|desktop|interno/.test(audience);
  const apple = /ios|iphone|mac|apple/.test(audience);

  const rows = [
    ["Chrome atual", "Android e desktop", "sim", "base"],
    ["Safari atual", apple || !enterprise ? "iOS" : "macOS", apple || mobileFirst ? "sim" : "amostra", "webkit diverge em data e scroll"],
    ["Firefox atual", "desktop", enterprise ? "sim" : "amostra", "empresas ainda padronizam Firefox"],
    ["Edge atual", "desktop", enterprise ? "sim" : "não", "motor Chromium; só se o público for corporativo"],
    ["Chrome - 1", "Android", mobileFirst ? "sim" : "amostra", "aparelho intermediário não atualiza no dia do release"],
    ["Viewport 360px", "telefone", mobileFirst ? "sim" : "amostra", "layout que só existe no desktop quebra aqui"],
  ];

  return textResult(
    doc([
      "# Matriz de compatibilidade",
      `Público: ${input.audience}`,
      input.platforms?.length ? `Plataformas pedidas: ${input.platforms.join(", ")}.` : undefined,
      markdownTable(["Alvo", "Onde", "Entrar na suíte", "Por quê"], rows),
      "Três combinações bem escolhidas acham mais defeito do que doze browsers iguais. Pairwise cabe se a lista crescer.",
      citeKnowledge(["functional-vs-non-functional", "mobile-testing", "test-design-techniques"]),
    ]),
  );
}

const LOCAL_ORIGIN = "http://127.0.0.1:3000";
const TEXT_PROPS = ["children", "label", "title", "text", "name"] as const;

export function buildSecurityApiTest(source: string, runner: "vitest" | "jest" = "vitest"): string | undefined {
  const routes = extractRoutes(source).filter((route) => safeApiPath(route.path));
  if (routes.length === 0) return undefined;

  const target = routes.find((route) => route.method === "GET") ?? routes[0];
  const blocks: string[] = [];
  for (const route of routes) {
    const status = declaredAuth(route);
    if (!status) continue;
    const url = localUrl(route.path);
    blocks.push(`test(${JSON.stringify(`${route.method} ${route.path}`)}, async () => {
  const response = await fetch(${JSON.stringify(url)});
  expect(response.status).toBe(${status});
});`);
  }
  blocks.push(fetchHeaderTest(localUrl(target.path)));
  if (mentionsCors(source)) blocks.push(fetchCorsTest(localUrl(target.path), allowsCredentials(source)));
  const ownerGap = routes.some((route) => routeHasId(route.path)) && !comparesOwner(source);
  const imported = runner === "jest" ? "@jest/globals" : "vitest";
  const note = ownerGap ? `// ${OWNER_GAP}\n\n` : "";
  return `import { expect, test } from ${JSON.stringify(imported)};\n\n${note}${blocks.join("\n\n")}\n`;
}

/** Spec Playwright da tela. A rota vem de `routeFromPage`. */
export function buildSecurityFrontSpec(filePath: string | undefined, source: string): string {
  const route = (filePath ? routeFromPage(filePath) : undefined) ?? "/";
  const url = localUrl(route);
  const blocks = [playwrightHeaderTest(url)];
  if (touchesCookie(source)) blocks.push(playwrightCookieTest(url));
  if (hasPostForm(source)) blocks.push(playwrightCsrfTest(url));
  return `import { expect, test } from "@playwright/test";\n\n${blocks.join("\n\n")}\n`;
}

/** Teste de componente. Só sai se houver prop de texto óbvia. */
export function buildSecurityUiTest(source: string, filePath?: string): string | undefined {
  const component = screenComponent(source, filePath);
  if (!component) return undefined;
  const prop = obviousTextProp(source, component.name);
  if (!prop) return undefined;
  const specifier = moduleSpecifier(filePath, component.name);
  const importLine = component.defaultExport
    ? `import ${component.name} from ${JSON.stringify(specifier)};`
    : `import { ${component.name} } from ${JSON.stringify(specifier)};`;
  return `import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
${importLine}

test("texto não vira elemento", () => {
  const { container } = render(createElement(${component.name}, { ${prop}: "<b>x</b>" }));
  expect(screen.getByText("<b>x</b>")).toBeTruthy();
  expect(container.querySelector("b")).toBeNull();
});
`;
}

function declaredAuth(route: WebRoute): 401 | 403 | undefined {
  if (route.status === 401 || route.status === 403) return route.status;
  if (route.authStatus === 401 || route.authStatus === 403) return route.authStatus;
  return undefined;
}

function safeApiPath(routePath: string): boolean {
  if (!routePath.startsWith("/") || routePath.includes("..") || routePath.includes("169.254.169.254")) return false;
  return /^\/[A-Za-z0-9._~/:{}-]*$/.test(routePath);
}

function localUrl(routePath: string): string {
  return `${LOCAL_ORIGIN}${routePath.startsWith("/") ? routePath : `/${routePath}`}`;
}

function routeHasId(routePath: string): boolean {
  return /(?:^|\/):id(?:\/|$)/.test(routePath) || routePath.includes("{id}");
}

function mentionsCors(source: string): boolean {
  return /\bcors\b|Access-Control-Allow-Origin/i.test(source);
}

function allowsCredentials(source: string): boolean {
  return /credentials\s*:\s*true|Access-Control-Allow-Credentials/i.test(source);
}

function comparesOwner(source: string): boolean {
  const user = /\breq\.user\b|\bsession\.user\b|\bcurrentUser\b/g;
  const routeId = /params\s*(?:\.\s*id|\[\s*["']id["']\s*\])|(?:req|request|c)\.param\(\s*["']id["']\s*\)/;
  let match: RegExpExecArray | null;
  while ((match = user.exec(source))) {
    const window = source.slice(Math.max(0, match.index - 200), Math.min(source.length, match.index + 200));
    if (/(?:===|!==|==|!=)/.test(window) && routeId.test(window)) return true;
  }
  return false;
}

function touchesCookie(source: string): boolean {
  return /setCookie|\bres\.cookie\b|cookies\(\)\.set|Set-Cookie/.test(source);
}

function hasPostForm(source: string): boolean {
  const forms = source.match(/<form\b[^>]*>/gi) ?? [];
  return forms.some((tag) => /\bmethod\s*=\s*(?:["']post["']|\{\s*["']post["']\s*\})/i.test(tag));
}

function isFrontTarget(filePath: string | undefined, source: string): boolean {
  if (filePath?.trim()) return classifyLayer(filePath, source) === "ui";
  return Boolean(screenComponent(source, filePath));
}

function obviousTextProp(source: string, componentName: string): (typeof TEXT_PROPS)[number] | undefined {
  const signature = componentParams(source, componentName);
  if (!signature) return undefined;
  return TEXT_PROPS.find((prop) => new RegExp(`\\b${prop}\\b`).test(signature));
}

function componentParams(source: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fn = new RegExp(`function\\s+${escaped}\\s*(?:<[^>()]*>)?\\s*\\(([^)]*)\\)`).exec(source);
  if (fn) return fn[1];
  const arrow = new RegExp(
    `(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:async\\s*)?(?:<[^>()]*>)?\\s*\\(([^)]*)\\)\\s*=>`,
  ).exec(source);
  if (arrow) return arrow[1];
  const anon = /export\s+default\s+(?:async\s+)?function\s*(?:<[^>()]*>)?\s*\(([^)]*)\)/.exec(source);
  return anon?.[1];
}

function moduleSpecifier(filePath: string | undefined, fallback: string): string {
  if (!filePath?.trim()) return `./${fallback}`;
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\.(tsx|jsx|ts|js)$/i, "");
  return `./${normalized}`;
}

function fetchHeaderTest(url: string): string {
  return `test("cabeçalhos de segurança", async () => {
  const response = await fetch(${JSON.stringify(url)});
  const csp = response.headers.get("content-security-policy") ?? response.headers.get("content-security-policy-report-only") ?? "";
  expect(csp).not.toBe("");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  const frame = response.headers.get("x-frame-options") ?? "";
  expect(frame.length > 0 || csp.includes("frame-ancestors")).toBe(true);
});`;
}

function fetchCorsTest(url: string, credentials: boolean): string {
  const init = `{ headers: { Origin: "https://exemplo-externo.test" } }`;
  if (credentials) {
    return `test("CORS com credencial não reflete origem externa", async () => {
  const response = await fetch(${JSON.stringify(url)}, ${init});
  expect(response.headers.get("access-control-allow-origin")).not.toBe("https://exemplo-externo.test");
});`;
  }
  return `test("CORS não devolve origem externa com credencial", async () => {
  const response = await fetch(${JSON.stringify(url)}, ${init});
  const origin = response.headers.get("access-control-allow-origin");
  const credentialsHeader = response.headers.get("access-control-allow-credentials");
  expect(origin === "https://exemplo-externo.test" && credentialsHeader === "true").toBe(false);
});`;
}

function playwrightHeaderTest(url: string): string {
  return `test("cabeçalhos de segurança", async ({ request }) => {
  const response = await request.get(${JSON.stringify(url)});
  const headers = response.headers();
  const csp = headers["content-security-policy"] || headers["content-security-policy-report-only"] || "";
  expect(csp).not.toBe("");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  const frame = headers["x-frame-options"] || "";
  expect(frame.length > 0 || csp.includes("frame-ancestors")).toBe(true);
});`;
}

function playwrightCookieTest(url: string): string {
  return `test("cookie httponly e samesite", async ({ request }) => {
  const response = await request.get(${JSON.stringify(url)});
  const setCookie = (response.headers()["set-cookie"] ?? "").toLowerCase();
  expect(setCookie).toContain("httponly");
  expect(setCookie).toContain("samesite");
});`;
}

function playwrightCsrfTest(url: string): string {
  return `test("formulário post traz csrf", async ({ request }) => {
  const response = await request.get(${JSON.stringify(url)});
  const html = await response.text();
  const input = /<input\\b[^>]*name=["'](?:csrf|_csrf|csrfToken)["']/i.test(html);
  const meta = /<meta\\b[^>]*name=["']csrf-token["']/i.test(html);
  expect(input || meta).toBe(true);
});`;
}

function installedUnitRunner(projectRoot?: string): "vitest" | "jest" | undefined {
  if (!projectRoot) return undefined;
  if (runnerInstalled(projectRoot, "vitest")) return "vitest";
  if (runnerInstalled(projectRoot, "jest")) return "jest";
  return undefined;
}

function a11ySpec(filePath?: string, baseUrl?: string): string {
  const route = filePath ? routeFromPage(filePath) : undefined;
  const raw = (baseUrl?.trim() || "http://127.0.0.1:3000").replace(/\/$/, "");
  let origin = raw;
  try {
    const url = new URL(raw);
    origin = `${url.protocol}//${url.host}`;
  } catch {
    origin = raw;
  }
  const goto = route
    ? `const baseUrl = ${JSON.stringify(origin)};\n  await page.goto(baseUrl + ${JSON.stringify(route)});`
    : `await page.goto(${JSON.stringify(raw)});`;
  return `import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("não introduz violação grave", async ({ page }) => {
  ${goto}
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
`;
}

async function rooted<T extends LoopFlags>(server: McpServer, input: T): Promise<T> {
  const root = await resolveToolRoot(server, input.projectRoot, input.filePath);
  return { ...input, projectRoot: root ?? input.projectRoot };
}

export async function handleSuggestSecurityChecklist(
  input: SecurityChecklistInput & LoopFlags,
  server?: McpServer,
): Promise<ToolTextResult> {
  const rootedInput = await resolveToolRoot(server, input.projectRoot, input.filePath);
  const withRoot = { ...input, projectRoot: rootedInput ?? input.projectRoot };
  const hydrated = await hydrateSource(server, withRoot);
  if ("isError" in hydrated && hydrated.isError) return hydrated;
  const ready = hydrated as SecurityChecklistInput & LoopFlags;
  const result = suggestSecurityChecklist(ready);
  if (result.isError) return result;
  const checklist = await deliver({
    server,
    input: ready,
    preface: result,
    relativePath: "docs/qa/seguranca.md",
    contents: result.content[0]?.text ?? "",
    neverRun: true,
  });
  if (checklist.isError) return checklist;

  const source = ready.sourceCode ?? "";
  const front = isFrontTarget(ready.filePath, source);
  let preface = resultText(checklist);

  if (front) {
    const local = isLocalHost(LOCAL_ORIGIN);
    const playwright = Boolean(ready.projectRoot && local && runnerInstalled(ready.projectRoot, "playwright"));
    const spec = await deliver({
      server,
      input: ready,
      preface: textResult(preface),
      relativePath: "e2e/security-front.spec.ts",
      contents: buildSecurityFrontSpec(ready.filePath, source),
      runner: playwright ? "playwright" : undefined,
      runEligible: playwright,
      skippedNote: playwright
        ? undefined
        : local
          ? "Não foi executado. Playwright não está instalado."
          : "Não foi executado. A URL não é localhost nem 127.0.0.1.",
    });
    if (spec.isError) return spec;
    preface = resultText(spec);

    const ui = buildSecurityUiTest(source, ready.filePath);
    if (ui) {
      const uiFile = await deliver({
        server,
        input: ready,
        preface: textResult(preface),
        relativePath: "security.ui.test.ts",
        contents: ui,
        neverRun: true,
      });
      if (uiFile.isError) return uiFile;
      preface = resultText(uiFile);
    }
  }

  const runner = installedUnitRunner(ready.projectRoot);
  const code = buildSecurityApiTest(source, runner ?? "vitest");
  if (!code) {
    if (front) return textResult(preface);
    return textResult(
      [preface, "Nenhuma rota HTTP segura no fonte. Nenhum security.api.test.ts foi gerado."].join("\n\n"),
    );
  }
  return deliver({
    server,
    input: ready,
    preface: textResult(preface),
    relativePath: "security.api.test.ts",
    contents: code,
    runner,
    runEligible: Boolean(runner),
    skippedNote: runner ? undefined : "Não foi executado. Vitest ou Jest não está instalado.",
  });
}

export function registerNonFunctionalTools(server: McpServer): void {
  registerTool(
    server,
    "suggest_performance_test_plan",
    "Plano de teste de performance",
    "Carga grava `perf/carga.k6.js` e executa `k6 run` quando o script usa localhost ou 127.0.0.1 e o binário está no PATH; host externo, JMeter e Gatling gravam e não executam. Vitest, Jest, Playwright, ESLint, Stryker e Cucumber só rodam se já estão em `node_modules` (não baixam pacote). k6, npm, Bandit e Gosec são CLI de máquina, procurados no PATH. Não há `npx`.",
    {
      target: z.string().describe("URL ou nome do fluxo sob carga."),
      tool: z.enum(["k6", "jmeter", "gatling"]).optional(),
      expectedRps: z.number().optional().describe("Taxa esperada no cenário de carga."),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
      ...writeShape,
      ...runShape,
    },
    async (args) => {
      const ready = await rooted(server, args as unknown as PerformancePlanInput & LoopFlags);
      const result = suggestPerformanceTestPlan(ready);
      if (result.isError) return result;
      const stack = detectStack(ready.projectRoot);
      const selection = performanceSelection(ready, stack);
      if (selection.tool !== "k6") {
        return deliver({
          server,
          input: ready,
          preface: result,
          neverRun: true,
          skippedNote: "Não foi executado. O script de JMeter ou Gatling fica no chat: a gravação de carga aceita só perf/*.k6.js.",
        });
      }
      const local = k6ExecutionAllowed(ready.target);
      const delivered = await deliver({
        server,
        input: ready,
        preface: result,
        relativePath: "perf/carga.k6.js",
        contents: scriptFor("k6", ready.target, selection.rps),
        neverRun: true,
        skippedNote: local ? undefined : "Não foi executado. O alvo não é localhost nem 127.0.0.1.",
      });
      if (!local || delivered.isError || ready.run === false || !ready.projectRoot) {
        if (local && ready.run === false && !delivered.isError) {
          return textResult([resultText(delivered), "Não foi executado."].join("\n\n"));
        }
        return delivered;
      }
      const scan = await runClosed(ready.projectRoot, "k6");
      return textResult([resultText(delivered), scan].join("\n\n"));
    },
    { readOnly: false },
  );

  registerTool(
    server,
    "suggest_security_checklist",
    "Checklist de segurança",
    "Segurança grava o checklist OWASP em `docs/qa/seguranca.md`. No front, grava e executa cabeçalho, cookie, CSRF e escape no localhost. Na API, grava e executa 401/403, cabeçalho e CORS quando o fonte tem CORS. Se a rota tem id e o handler não mostra comparação de dono, o arquivo traz um aviso: a checagem pode estar no middleware. O teste não falha por isso. Sem binário, grava e não executa.",
    {
      context: z.string().optional().describe("Descrição do sistema ou da mudança."),
      sourceCode: z.string().optional(),
      filePath: z.string().optional(),
      projectRoot: z.string().optional(),
      ...writeShape,
      ...runShape,
    },
    (args) => handleSuggestSecurityChecklist(args as unknown as SecurityChecklistInput & LoopFlags, server),
    { readOnly: false },
  );

  registerTool(
    server,
    "suggest_accessibility_audit",
    "Auditoria de acessibilidade",
    "Acessibilidade grava `e2e/a11y.spec.ts` e executa no runner local só se baseUrl for localhost ou 127.0.0.1; caso contrário grava e não executa.",
    {
      screen: z.string().optional(),
      level: z.enum(["A", "AA", "AAA"]).optional(),
      baseUrl: z.string().optional().describe("Só executa se for localhost ou 127.0.0.1."),
      sourceCode: z.string().optional(),
      filePath: z.string().optional(),
      projectRoot: z.string().optional(),
      ...writeShape,
      ...runShape,
    },
    async (args) => {
      const ready = await rooted(server, args as unknown as AccessibilityInput & LoopFlags);
      const result = suggestAccessibilityAudit(ready);
      if (result.isError) return result;
      const base = ready.baseUrl?.trim() || "http://127.0.0.1:3000";
      const local = isLocalHost(base);
      const runner: TestRunner | undefined = local ? "playwright" : undefined;
      return deliver({
        server,
        input: ready,
        preface: result,
        relativePath: "e2e/a11y.spec.ts",
        contents: a11ySpec(ready.filePath, base),
        runner,
        runEligible: local,
        skippedNote: local ? undefined : "Não foi executado.",
      });
    },
    { readOnly: false },
  );

  registerTool(
    server,
    "suggest_compatibility_matrix",
    "Matriz de compatibilidade",
    "Compatibilidade grava e não executa `docs/qa/compatibilidade.md` com browsers e dispositivos do público-alvo.",
    {
      audience: z.string().describe("Quem usa o produto."),
      platforms: z.array(z.string()).optional(),
      sourceCode: z.string().optional(),
      projectRoot: z.string().optional(),
      ...writeShape,
    },
    async (args) => {
      const input = args as unknown as CompatibilityInput & LoopFlags;
      const result = suggestCompatibilityMatrix(input);
      if (result.isError) return result;
      return deliver({
        server,
        input,
        preface: result,
        relativePath: "docs/qa/compatibilidade.md",
        contents: result.content[0]?.text ?? "",
      });
    },
    { readOnly: false },
  );
}
