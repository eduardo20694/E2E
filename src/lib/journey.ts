/**
 * Jornada ponta a ponta: várias páginas, clique e envio reais, sistema inteiro de pé.
 * Nada de mock de rede. O spec semeia dado pela API, executa o fluxo no navegador
 * (um ou vários usuários, várias abas), confere o efeito no backend, no e-mail,
 * na tela e na acessibilidade, e limpa o que criou, mesmo quando falha.
 */

export interface JourneyTarget {
  testId?: string;
  role?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  text?: string;
  css?: string;
  exact?: boolean;
  nth?: number;
}

export interface AwaitResponse {
  method?: string;
  url: string;
  status?: number;
  /** Variáveis tiradas do JSON da resposta: { nomeDaVariavel: "caminho.no.json" }. */
  saveAs?: Record<string, string>;
}

export interface TextMatch {
  /** Caminho no JSON. Sem ele, o corpo inteiro. */
  from?: string;
  /** Regex. O primeiro grupo vira o valor. */
  pattern: string;
  saveAs: string;
}

interface Common {
  label?: string;
  /** Ator ou aba onde o passo roda. Padrão: o usuário principal. */
  as?: string;
}

export type JourneyStep = Common &
  (
    | { action: "goto"; path: string }
    | { action: "reload" }
    | { action: "back" }
    | { action: "click"; target: JourneyTarget; awaitResponse?: AwaitResponse; opensTab?: string }
    | { action: "fill"; target: JourneyTarget; value: string }
    | { action: "select"; target: JourneyTarget; value: string }
    | { action: "check"; target: JourneyTarget }
    | { action: "uncheck"; target: JourneyTarget }
    | { action: "hover"; target: JourneyTarget }
    | { action: "dragTo"; target: JourneyTarget; to: JourneyTarget }
    | { action: "press"; key: string; target?: JourneyTarget; awaitResponse?: AwaitResponse }
    | { action: "upload"; target: JourneyTarget; files: string[] }
    | {
        action: "download";
        target: JourneyTarget;
        expectFileName?: string;
        expectContains?: string;
        saveAs?: string;
      }
    | { action: "dialog"; accept?: boolean; promptText?: string; saveAs?: string }
    | { action: "expectVisible"; target: JourneyTarget }
    | { action: "expectHidden"; target: JourneyTarget }
    | { action: "expectText"; text: string; target?: JourneyTarget }
    | { action: "expectValue"; target: JourneyTarget; value: string }
    | { action: "expectCount"; target: JourneyTarget; count: number }
    | { action: "expectEnabled"; target: JourneyTarget }
    | { action: "expectDisabled"; target: JourneyTarget }
    | { action: "expectChecked"; target: JourneyTarget }
    | { action: "expectUrl"; path: string }
    | { action: "capture"; target: JourneyTarget; saveAs: string; pattern?: string }
    | {
        action: "api";
        method?: string;
        path: string;
        body?: unknown;
        expectStatus?: number;
        expectJson?: Record<string, unknown>;
        saveAs?: Record<string, string>;
        match?: TextMatch;
      }
    | {
        action: "email";
        to: string;
        subject?: string;
        expectText?: string;
        saveLink?: string;
        linkPattern?: string;
        match?: TextMatch;
        timeoutSeconds?: number;
      }
    | { action: "expectScreenshot"; name: string; target?: JourneyTarget; mask?: JourneyTarget[]; maxDiffPixelRatio?: number }
    | { action: "a11y"; target?: JourneyTarget; tags?: string[]; minImpact?: "minor" | "moderate" | "serious" | "critical" }
    | { action: "screenshot"; name: string }
  );

export interface ApiCall {
  method?: string;
  path: string;
  body?: unknown;
  expectStatus?: number;
  saveAs?: Record<string, string>;
}

export interface JourneyAuth {
  loginPath: string;
  userTarget: JourneyTarget;
  passwordTarget: JourneyTarget;
  submitTarget: JourneyTarget;
  /** Variável de ambiente com o usuário. Padrão E2E_USER. */
  userEnv?: string;
  /** Variável de ambiente com a senha. Padrão E2E_PASSWORD. */
  passwordEnv?: string;
  /** Caminho (ou trecho) da URL depois do login. */
  successPath?: string;
  /** Texto que aparece depois do login. */
  successText?: string;
}

export interface JourneyOptions {
  name: string;
  baseUrl: string;
  apiBaseUrl?: string;
  apiHeaders?: Record<string, string>;
  healthPath?: string;
  auth?: JourneyAuth;
  /** Outros usuários, cada um no próprio navegador: { admin: {...login...} }. */
  actors?: Record<string, JourneyAuth>;
  seed?: ApiCall[];
  steps: JourneyStep[];
  cleanup?: ApiCall[];
  stepTimeoutSeconds?: number;
  locale?: string;
  timezoneId?: string;
  colorScheme?: "light" | "dark";
  retries?: number;
  /** Caixa de e-mail local (Mailpit). Padrão http://127.0.0.1:8025. */
  mailUrl?: string;
}

export interface RenderedJourney {
  code: string;
  fileName: string;
  slug: string;
  envVars: string[];
  variables: string[];
  notes: string[];
  stepTitles: string[];
  /** Pacotes que o spec importa além do @playwright/test. */
  packages: string[];
  hasScreenshots: boolean;
}

const TEMPLATE = /\{\{\s*([\w.]+)\s*\}\}/g;
const MAIN = "main";

export function journeySlug(value: string): string {
  const cleaned = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return cleaned || "jornada";
}

const q = (value: string) => JSON.stringify(value);
const tick = (value: string) => value.replace(/[`\\$]/g, "\\$&");

/** Literal com interpolação em tempo de execução, só quando há {{...}}. */
function str(value: string): string {
  return /\{\{/.test(value) ? `fill(${q(value)})` : q(value);
}

function templateKeys(value: unknown, into: Set<string>): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(TEMPLATE)) into.add(match[1]);
  } else if (Array.isArray(value)) {
    for (const item of value) templateKeys(item, into);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) templateKeys(item, into);
  }
}

export function locatorFor(target: JourneyTarget, scope = "page"): string {
  let base: string;
  const exact = target.exact ? ", exact: true" : "";
  if (target.testId) base = `${scope}.getByTestId(${str(target.testId)})`;
  else if (target.role) {
    base = target.name
      ? `${scope}.getByRole(${q(target.role)}, { name: ${str(target.name)}${exact} })`
      : `${scope}.getByRole(${q(target.role)})`;
  } else if (target.label) base = `${scope}.getByLabel(${str(target.label)}${target.exact ? ", { exact: true }" : ""})`;
  else if (target.placeholder) base = `${scope}.getByPlaceholder(${str(target.placeholder)}${target.exact ? ", { exact: true }" : ""})`;
  else if (target.text) base = `${scope}.getByText(${str(target.text)}${target.exact ? ", { exact: true }" : ""})`;
  else if (target.css) base = `${scope}.locator(${str(target.css)})`;
  else throw new Error("Alvo vazio: informe testId, role, label, placeholder, text ou css.");
  if (typeof target.nth === "number") return `${base}.nth(${Math.trunc(target.nth)})`;
  return base;
}

export function describeTarget(target: JourneyTarget): string {
  if (target.testId) return `[data-testid=${target.testId}]`;
  if (target.role) return target.name ? `${target.role} "${target.name}"` : target.role;
  if (target.label) return `campo "${target.label}"`;
  if (target.placeholder) return `campo "${target.placeholder}"`;
  if (target.text) return `"${target.text}"`;
  return target.css ?? "?";
}

function stepTitle(step: JourneyStep, index: number): string {
  if (step.label?.trim()) return step.label.trim();
  const who = step.as && step.as !== MAIN ? `[${step.as}] ` : "";
  const n = `${index + 1}. ${who}`;
  switch (step.action) {
    case "goto":
      return `${n}abre ${step.path}`;
    case "reload":
      return `${n}recarrega a página`;
    case "back":
      return `${n}volta uma página`;
    case "click":
      return `${n}clica em ${describeTarget(step.target)}${step.opensTab ? ` (abre a aba ${step.opensTab})` : ""}`;
    case "fill":
      return `${n}preenche ${describeTarget(step.target)}`;
    case "select":
      return `${n}escolhe "${step.value}" em ${describeTarget(step.target)}`;
    case "check":
      return `${n}marca ${describeTarget(step.target)}`;
    case "uncheck":
      return `${n}desmarca ${describeTarget(step.target)}`;
    case "hover":
      return `${n}passa o mouse em ${describeTarget(step.target)}`;
    case "dragTo":
      return `${n}arrasta ${describeTarget(step.target)} até ${describeTarget(step.to)}`;
    case "press":
      return `${n}tecla ${step.key}`;
    case "upload":
      return `${n}envia ${step.files.join(", ")} em ${describeTarget(step.target)}`;
    case "download":
      return `${n}baixa arquivo por ${describeTarget(step.target)}`;
    case "dialog":
      return `${n}${step.accept === false ? "recusa" : "aceita"} o próximo diálogo`;
    case "expectVisible":
      return `${n}vê ${describeTarget(step.target)}`;
    case "expectHidden":
      return `${n}não vê ${describeTarget(step.target)}`;
    case "expectText":
      return `${n}vê o texto "${step.text}"`;
    case "expectValue":
      return `${n}${describeTarget(step.target)} vale "${step.value}"`;
    case "expectCount":
      return `${n}vê ${step.count}× ${describeTarget(step.target)}`;
    case "expectEnabled":
      return `${n}${describeTarget(step.target)} habilitado`;
    case "expectDisabled":
      return `${n}${describeTarget(step.target)} desabilitado`;
    case "expectChecked":
      return `${n}${describeTarget(step.target)} marcado`;
    case "expectUrl":
      return `${n}está em ${step.path}`;
    case "capture":
      return `${n}guarda {{${step.saveAs}}} de ${describeTarget(step.target)}`;
    case "api":
      return `${n}confere no backend ${(step.method ?? "GET").toUpperCase()} ${step.path}`;
    case "email":
      return `${n}recebe e-mail em ${step.to}${step.subject ? ` ("${step.subject}")` : ""}`;
    case "expectScreenshot":
      return `${n}tela igual à referência ${step.name}`;
    case "a11y":
      return `${n}sem violação de acessibilidade${step.target ? ` em ${describeTarget(step.target)}` : ""}`;
    case "screenshot":
      return `${n}screenshot ${step.name}`;
  }
}

function saveLines(saveAs: Record<string, string> | undefined, source: string, indent: string): string[] {
  if (!saveAs || !Object.keys(saveAs).length) return [];
  const lines = [`${indent}const json = await ${source}.json();`];
  for (const [name, jsonPath] of Object.entries(saveAs)) {
    lines.push(`${indent}save(${q(name)}, pick(json, ${q(jsonPath)}));`);
  }
  return lines;
}

function actionWithResponse(action: string, wait: AwaitResponse | undefined, indent: string): string[] {
  if (!wait) return [`${indent}await ${action};`];
  const method = (wait.method ?? "").toUpperCase();
  const lines = [
    `${indent}const captured = captureResponse(page, ${q(method)}, ${str(wait.url)});`,
    `${indent}await ${action};`,
    `${indent}const response = await captured;`,
  ];
  if (typeof wait.status === "number") {
    lines.push(`${indent}expect(response.status, response.summary).toBe(${Math.trunc(wait.status)});`);
  } else {
    lines.push(`${indent}expect(response.status < 400, response.summary).toBeTruthy();`);
  }
  if (wait.saveAs && Object.keys(wait.saveAs).length) {
    lines.push(`${indent}const json = parse(response.text);`);
    for (const [name, jsonPath] of Object.entries(wait.saveAs)) lines.push(`${indent}save(${q(name)}, pick(json, ${q(jsonPath)}));`);
  }
  return lines;
}

function matchLines(match: TextMatch | undefined, textVar: string, jsonVar: string | undefined, indent: string): string[] {
  if (!match) return [];
  const source = match.from && jsonVar ? `String(pick(${jsonVar}, ${q(match.from)}) ?? "")` : textVar;
  return [
    `${indent}const found = ${source}.match(new RegExp(${q(match.pattern)}));`,
    `${indent}expect(found, \`Nada casou com ${tick(match.pattern)}\`).not.toBeNull();`,
    `${indent}save(${q(match.saveAs)}, found![1] ?? found![0]);`,
  ];
}

const IMPACT_ORDER = ["minor", "moderate", "serious", "critical"];

function renderStep(step: JourneyStep, indent: string): string[] {
  switch (step.action) {
    case "goto":
      return [`${indent}await page.goto(join(BASE_URL, ${str(step.path)}));`];
    case "reload":
      return [`${indent}await page.reload();`];
    case "back":
      return [`${indent}await page.goBack();`];
    case "click": {
      if (step.opensTab) {
        return [
          `${indent}const [tab] = await Promise.all([page.context().waitForEvent("page"), ${locatorFor(step.target)}.click()]);`,
          `${indent}await tab.waitForLoadState();`,
          `${indent}pages[${q(step.opensTab)}] = tab;`,
        ];
      }
      return actionWithResponse(`${locatorFor(step.target)}.click()`, step.awaitResponse, indent);
    }
    case "fill":
      return [`${indent}await ${locatorFor(step.target)}.fill(${str(step.value)});`];
    case "select":
      return [`${indent}await ${locatorFor(step.target)}.selectOption(${str(step.value)});`];
    case "check":
      return [`${indent}await ${locatorFor(step.target)}.check();`];
    case "uncheck":
      return [`${indent}await ${locatorFor(step.target)}.uncheck();`];
    case "hover":
      return [`${indent}await ${locatorFor(step.target)}.hover();`];
    case "dragTo":
      return [`${indent}await ${locatorFor(step.target)}.dragTo(${locatorFor(step.to)});`];
    case "press": {
      const action = step.target
        ? `${locatorFor(step.target)}.press(${q(step.key)})`
        : `page.keyboard.press(${q(step.key)})`;
      return actionWithResponse(action, step.awaitResponse, indent);
    }
    case "upload":
      return [`${indent}await ${locatorFor(step.target)}.setInputFiles([${step.files.map((file) => str(file)).join(", ")}]);`];
    case "download": {
      const lines = [
        `${indent}const [download] = await Promise.all([page.waitForEvent("download"), ${locatorFor(step.target)}.click()]);`,
        `${indent}const file = test.info().outputPath(download.suggestedFilename());`,
        `${indent}await download.saveAs(file);`,
      ];
      if (step.expectFileName) lines.push(`${indent}expect(download.suggestedFilename()).toMatch(pattern(${str(step.expectFileName)}));`);
      if (step.expectContains) lines.push(`${indent}expect(fs.readFileSync(file, "utf8")).toContain(${str(step.expectContains)});`);
      if (step.saveAs) lines.push(`${indent}save(${q(step.saveAs)}, file);`);
      return lines;
    }
    case "dialog": {
      const accept = step.accept !== false;
      const answer = accept ? `dialog.accept(${step.promptText !== undefined ? str(step.promptText) : ""})` : "dialog.dismiss()";
      const store = step.saveAs ? ` vars[${q(step.saveAs)}] = dialog.message();` : "";
      return [`${indent}page.once("dialog", async (dialog) => {${store} await ${answer}; });`];
    }
    case "expectVisible":
      return [`${indent}await expect(${locatorFor(step.target)}).toBeVisible();`];
    case "expectHidden":
      return [`${indent}await expect(${locatorFor(step.target)}).toBeHidden();`];
    case "expectText":
      return step.target
        ? [`${indent}await expect(${locatorFor(step.target)}).toContainText(${str(step.text)});`]
        : [`${indent}await expect(page.getByText(${str(step.text)}).first()).toBeVisible();`];
    case "expectValue":
      return [`${indent}await expect(${locatorFor(step.target)}).toHaveValue(${str(step.value)});`];
    case "expectCount":
      return [`${indent}await expect(${locatorFor(step.target)}).toHaveCount(${Math.trunc(step.count)});`];
    case "expectEnabled":
      return [`${indent}await expect(${locatorFor(step.target)}).toBeEnabled();`];
    case "expectDisabled":
      return [`${indent}await expect(${locatorFor(step.target)}).toBeDisabled();`];
    case "expectChecked":
      return [`${indent}await expect(${locatorFor(step.target)}).toBeChecked();`];
    case "expectUrl":
      return [`${indent}await expect(page).toHaveURL(pattern(${str(step.path)}));`];
    case "capture": {
      const lines = [
        `${indent}const target = ${locatorFor(step.target)};`,
        `${indent}await expect(target).toBeVisible();`,
        `${indent}const raw = ((await target.inputValue({ timeout: 1000 }).catch(() => null)) ?? (await target.innerText())).trim();`,
      ];
      if (step.pattern) {
        lines.push(
          `${indent}const match = raw.match(new RegExp(${q(step.pattern)}));`,
          `${indent}expect(match, \`O texto "\${raw}" não casou com ${tick(step.pattern)}\`).not.toBeNull();`,
          `${indent}save(${q(step.saveAs)}, match![1] ?? match![0]);`,
        );
      } else {
        lines.push(`${indent}save(${q(step.saveAs)}, raw);`);
      }
      return lines;
    }
    case "api": {
      const method = (step.method ?? "GET").toUpperCase();
      const data = step.body === undefined ? "" : `, data: fillDeep(${JSON.stringify(step.body)})`;
      const lines = [
        `${indent}const response = await page.request.fetch(join(API_URL, ${str(step.path)}), { method: ${q(method)}, headers: API_HEADERS${data} });`,
      ];
      if (typeof step.expectStatus === "number") {
        lines.push(`${indent}expect(response.status(), await describe(response)).toBe(${Math.trunc(step.expectStatus)});`);
      } else {
        lines.push(`${indent}expect(response.ok(), await describe(response)).toBeTruthy();`);
      }
      const checks = Object.entries(step.expectJson ?? {});
      const saves = Object.entries(step.saveAs ?? {});
      if (checks.length || saves.length || step.match) {
        lines.push(`${indent}const text = await response.text();`, `${indent}const json = parse(text);`);
        for (const [jsonPath, expected] of checks) {
          lines.push(`${indent}expect(pick(json, ${q(jsonPath)}), ${q(`campo ${jsonPath}`)}).toEqual(fillDeep(${JSON.stringify(expected)}));`);
        }
        for (const [name, jsonPath] of saves) lines.push(`${indent}save(${q(name)}, pick(json, ${q(jsonPath)}));`);
        lines.push(...matchLines(step.match, "text", "json", indent));
      }
      return lines;
    }
    case "email": {
      const timeout = Math.max(5, Math.min(300, step.timeoutSeconds ?? 30)) * 1000;
      const query = step.subject
        ? `\`to:"\${${str(step.to)}}" subject:"\${${str(step.subject)}}"\``
        : `\`to:"\${${str(step.to)}}"\``;
      const lines = [
        `${indent}const mail = await waitForEmail(${query}, ${timeout});`,
      ];
      if (step.expectText) lines.push(`${indent}expect(mail.body, "conteúdo do e-mail").toContain(${str(step.expectText)});`);
      if (step.saveLink) {
        const linkRe = step.linkPattern ?? "https?://[^\\s\"'<>]+";
        lines.push(
          `${indent}const link = mail.body.match(new RegExp(${q(linkRe)}));`,
          `${indent}expect(link, "link no e-mail").not.toBeNull();`,
          `${indent}save(${q(step.saveLink)}, (link![1] ?? link![0]).replace(/&amp;/g, "&"));`,
        );
      }
      lines.push(...matchLines(step.match, "mail.body", undefined, indent));
      return lines;
    }
    case "expectScreenshot": {
      const subject = step.target ? locatorFor(step.target) : "page";
      const opts = [
        step.target ? undefined : "fullPage: true",
        'animations: "disabled"',
        step.maxDiffPixelRatio !== undefined ? `maxDiffPixelRatio: ${step.maxDiffPixelRatio}` : undefined,
        step.mask?.length ? `mask: [${step.mask.map((item) => locatorFor(item)).join(", ")}]` : undefined,
      ].filter(Boolean);
      return [`${indent}await expect(${subject}).toHaveScreenshot(${q(`${journeySlug(step.name)}.png`)}, { ${opts.join(", ")} });`];
    }
    case "a11y": {
      const tags = step.tags?.length ? step.tags : ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
      const min = IMPACT_ORDER.indexOf(step.minImpact ?? "serious");
      const allowed = IMPACT_ORDER.slice(Math.max(0, min));
      const include = step.target?.css ? `.include(${q(step.target.css)})` : "";
      return [
        `${indent}const results = await new AxeBuilder({ page }).withTags(${JSON.stringify(tags)})${include}.analyze();`,
        `${indent}const violations = results.violations.filter((item) => ${JSON.stringify(allowed)}.includes(item.impact ?? ""));`,
        `${indent}expect(violations.map((item) => \`\${item.impact} \${item.id}: \${item.help} (\${item.nodes.length}×)\`), "violações de acessibilidade").toEqual([]);`,
      ];
    }
    case "screenshot":
      return [
        `${indent}await test.info().attach(${q(step.name)}, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });`,
      ];
  }
}

function renderApiCall(call: ApiCall, indent: string, mode: "seed" | "cleanup"): string[] {
  const method = (call.method ?? (mode === "cleanup" ? "DELETE" : "POST")).toUpperCase();
  const data = call.body === undefined ? "" : `, data: fillDeep(${JSON.stringify(call.body)})`;
  const label = tick(`${method} ${call.path}`);
  if (mode === "cleanup") {
    return [
      `${indent}try {`,
      `${indent}  const response = await api.fetch(join(API_URL, fill(${q(call.path)})), { method: ${q(method)}${data} });`,
      `${indent}  if (!response.ok() && response.status() !== 404) console.warn(\`[limpeza] ${label} devolveu \${response.status()}\`);`,
      `${indent}} catch (error) {`,
      `${indent}  console.warn(\`[limpeza] ${label} pulada: \${(error as Error).message}\`);`,
      `${indent}}`,
    ];
  }
  const lines = [
    `${indent}{`,
    `${indent}  const response = await api.fetch(join(API_URL, ${str(call.path)}), { method: ${q(method)}${data} });`,
  ];
  if (typeof call.expectStatus === "number") {
    lines.push(`${indent}  expect(response.status(), await describe(response)).toBe(${Math.trunc(call.expectStatus)});`);
  } else {
    lines.push(`${indent}  expect(response.ok(), await describe(response)).toBeTruthy();`);
  }
  lines.push(...saveLines(call.saveAs, "response", `${indent}  `), `${indent}}`);
  return lines;
}

export function authSteps(auth: JourneyAuth, who?: string): JourneyStep[] {
  const userEnv = auth.userEnv?.trim() || "E2E_USER";
  const passwordEnv = auth.passwordEnv?.trim() || "E2E_PASSWORD";
  const prefix = who ? `${who}: login` : "login";
  const steps: JourneyStep[] = [
    { action: "goto", path: auth.loginPath, label: `${prefix}: abre a tela` },
    { action: "fill", target: auth.userTarget, value: `{{env.${userEnv}}}`, label: `${prefix}: usuário` },
    { action: "fill", target: auth.passwordTarget, value: `{{env.${passwordEnv}}}`, label: `${prefix}: senha` },
    { action: "click", target: auth.submitTarget, label: `${prefix}: entra` },
  ];
  if (auth.successPath) steps.push({ action: "expectUrl", path: auth.successPath, label: `${prefix}: chegou na área logada` });
  if (auth.successText) steps.push({ action: "expectText", text: auth.successText, label: `${prefix}: vê a área logada` });
  return steps;
}

const SECRET_TARGET = /senha|password|passwd|secret|token/i;
const ACTOR_NAME = /^[A-Za-z_][\w-]*$/;

function stepBlock(title: string, step: JourneyStep, indent: string): string[] {
  const inner = `${indent}  `;
  const lines = [`${indent}await test.step(${q(title)}, async () => {`];
  if (step.as && step.as !== MAIN) lines.push(`${inner}const page = await actor(${q(step.as)});`);
  lines.push(...renderStep(step, inner), `${indent}});`);
  return lines;
}

export function renderJourneySpec(options: JourneyOptions): RenderedJourney {
  if (!options.steps.length) throw new Error("A jornada precisa de pelo menos um passo.");
  const slug = journeySlug(options.name);
  const notes: string[] = [];
  const actors = options.actors ?? {};
  for (const name of Object.keys(actors)) {
    if (!ACTOR_NAME.test(name) || name === MAIN) throw new Error(`Nome de ator inválido: "${name}". Use letras, números, _ ou -, e não "main".`);
  }
  const steps: JourneyStep[] = [...(options.auth ? authSteps(options.auth) : []), ...options.steps];
  const offset = steps.length - options.steps.length;
  if (steps[0]?.action !== "goto") {
    notes.push("O primeiro passo não é `goto`. A jornada começa em `about:blank`; abra uma página antes de interagir.");
  }

  // Atores e abas: precisa existir antes do uso.
  const known = new Set<string>([MAIN, ...Object.keys(actors)]);
  steps.forEach((step, index) => {
    if (step.as && !known.has(step.as)) {
      throw new Error(`"${stepTitle(step, index - offset)}" roda em "${step.as}", que não é ator declarado nem aba aberta antes com opensTab.`);
    }
    if (step.action === "click" && step.opensTab) {
      if (!ACTOR_NAME.test(step.opensTab) || known.has(step.opensTab)) throw new Error(`Nome de aba inválido ou repetido: "${step.opensTab}".`);
      known.add(step.opensTab);
    }
  });

  // Variáveis: o que é produzido antes de ser usado.
  const produced = new Set<string>(["runId"]);
  const envVars = new Set<string>();
  const ordered: Array<{ uses: unknown; makes: string[]; where: string }> = [];
  for (const call of options.seed ?? []) {
    ordered.push({ uses: [call.path, call.body], makes: Object.keys(call.saveAs ?? {}), where: `seed ${call.path}` });
  }
  // Login dos atores roda quando o ator aparece; as credenciais são só env.
  for (const [name, auth] of Object.entries(actors)) {
    ordered.push({ uses: authSteps(auth, name), makes: [], where: `login de ${name}` });
  }
  steps.forEach((step, index) => {
    const makes: string[] = [];
    if (step.action === "capture") makes.push(step.saveAs);
    if ((step.action === "click" || step.action === "press") && step.awaitResponse?.saveAs) makes.push(...Object.keys(step.awaitResponse.saveAs));
    if (step.action === "api" && step.saveAs) makes.push(...Object.keys(step.saveAs));
    if ((step.action === "api" || step.action === "email") && step.match) makes.push(step.match.saveAs);
    if (step.action === "email" && step.saveLink) makes.push(step.saveLink);
    if ((step.action === "download" || step.action === "dialog") && step.saveAs) makes.push(step.saveAs);
    ordered.push({ uses: { ...step, label: undefined }, makes, where: stepTitle(step, index - offset) });
  });
  for (const item of ordered) {
    const keys = new Set<string>();
    templateKeys(item.uses, keys);
    for (const key of keys) {
      if (key.startsWith("env.")) envVars.add(key.slice(4));
      else if (!produced.has(key)) {
        throw new Error(`{{${key}}} é usado em "${item.where}" antes de ser capturado. Capture com saveAs num passo anterior ou no seed.`);
      }
    }
    for (const name of item.makes) produced.add(name);
  }
  const cleanupKeys = new Set<string>();
  templateKeys(options.cleanup ?? [], cleanupKeys);
  for (const key of cleanupKeys) {
    if (key.startsWith("env.")) envVars.add(key.slice(4));
    else if (!produced.has(key)) throw new Error(`{{${key}}} é usado na limpeza e nunca é capturado.`);
  }
  const headerKeys = new Set<string>();
  templateKeys(options.apiHeaders ?? {}, headerKeys);
  for (const key of headerKeys) {
    if (key.startsWith("env.")) envVars.add(key.slice(4));
    else if (key !== "runId") throw new Error(`apiHeaders só aceita {{env.NOME}} ou {{runId}}; {{${key}}} não existe quando o seed roda.`);
  }

  for (const step of steps) {
    if (step.action !== "fill") continue;
    const t = step.target;
    const hint = [t.label, t.placeholder, t.name, t.testId, t.css].filter(Boolean).join(" ");
    if (SECRET_TARGET.test(hint) && !/\{\{\s*env\./.test(step.value)) {
      notes.push(`O campo ${describeTarget(t)} parece segredo e recebeu valor literal. Use \`{{env.NOME}}\` para a senha não ficar no repositório.`);
    }
  }

  const usesA11y = steps.some((step) => step.action === "a11y");
  const usesEmail = steps.some((step) => step.action === "email");
  const usesFs = steps.some((step) => step.action === "download");
  const hasScreenshots = steps.some((step) => step.action === "expectScreenshot");
  const actorCount = Object.keys(actors).length;
  const perStep = Math.max(5, Math.min(120, options.stepTimeoutSeconds ?? 15));
  const loginSteps = Object.values(actors).reduce((sum, auth) => sum + authSteps(auth).length, 0);
  const emailExtra = steps.filter((step) => step.action === "email").reduce((sum, step) => sum + Math.min(300, (step as { timeoutSeconds?: number }).timeoutSeconds ?? 30), 0);
  const totalSeconds = Math.min(
    900,
    30 + emailExtra + perStep * (steps.length + loginSteps + (options.seed?.length ?? 0) + (options.cleanup?.length ?? 0)),
  );
  const health = options.healthPath?.trim() || "/";
  const headers = options.apiHeaders && Object.keys(options.apiHeaders).length ? options.apiHeaders : undefined;
  const titles = steps.map((step, index) => stepTitle(step, index - offset));
  const contextOverrides = Object.fromEntries(
    Object.entries({ locale: options.locale, timezoneId: options.timezoneId, colorScheme: options.colorScheme }).filter(([, value]) => value),
  );
  const retries = Math.max(0, Math.min(5, Math.trunc(options.retries ?? 0)));

  const body: string[] = [];
  steps.forEach((step, index) => body.push(...stepBlock(titles[index], step, "      ")));

  const actorLogins = Object.entries(actors).map(([name, auth]) => {
    const lines = [`  ${q(name)}: async (page) => {`];
    for (const step of authSteps(auth, name)) {
      lines.push(...stepBlock(step.label ?? "", step, "    "));
    }
    lines.push("  },");
    return lines.join("\n");
  });

  const imports = [
    'import { test, expect, request as playwrightRequest, type APIRequestContext, type APIResponse, type BrowserContext, type Page, type Response, type Route } from "@playwright/test";',
    usesA11y ? 'import AxeBuilder from "@axe-core/playwright";' : undefined,
    usesFs ? 'import fs from "node:fs";' : undefined,
  ].filter(Boolean);

  const code = `// @journey — jornada ponta a ponta contra o sistema real. Sem mock de rede.
// Gerado pelo MCP E2E (generate_journey_test). Edite à vontade.
//
// Pré-requisito: frontend, backend, banco e filas de pé (docker compose up, npm run dev...),
// ou o webServer do playwright.journeys.config.ts (setup_e2e_environment) subindo tudo.
// Variáveis: E2E_BASE_URL, E2E_API_URL${usesEmail ? ", E2E_MAIL_URL" : ""}${envVars.size ? `, ${[...envVars].join(", ")}` : ""}.
${imports.join("\n")}

const BASE_URL = process.env.E2E_BASE_URL ?? ${q(options.baseUrl)};
const API_URL = process.env.E2E_API_URL ?? ${q(options.apiBaseUrl ?? options.baseUrl)};
${usesEmail ? `const MAIL_URL = process.env.E2E_MAIL_URL ?? ${q(options.mailUrl ?? "http://127.0.0.1:8025")};\n` : ""}const RUN_ID = \`\${Date.now().toString(36)}\${Math.random().toString(36).slice(2, 6)}\`;
const vars: Record<string, string> = { runId: RUN_ID };

function fill(template: string): string {
  return template.replace(/\\{\\{\\s*([\\w.]+)\\s*\\}\\}/g, (_, key: string) => {
    if (key.startsWith("env.")) {
      const value = process.env[key.slice(4)];
      if (value === undefined) throw new Error(\`Defina a variável de ambiente \${key.slice(4)}.\`);
      return value;
    }
    if (!(key in vars)) throw new Error(\`{{\${key}}} ainda não foi capturada.\`);
    return vars[key];
  });
}

function fillDeep<T>(value: T): T {
  if (typeof value === "string") return fill(value) as T;
  if (Array.isArray(value)) return value.map((item) => fillDeep(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fillDeep(item)])) as T;
  }
  return value;
}

function join(base: string, path: string): string {
  if (/^https?:\\/\\//i.test(path)) return path;
  return \`\${base.replace(/\\/+$/, "")}/\${path.replace(/^\\/+/, "")}\`;
}

function pick(json: unknown, path: string): unknown {
  return path.split(".").filter(Boolean).reduce<unknown>((value, key) => {
    if (value === null || value === undefined) return undefined;
    return (value as Record<string, unknown>)[key];
  }, json);
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function save(name: string, value: unknown): void {
  if (value === undefined || value === null || value === "") throw new Error(\`Não consegui capturar {{\${name}}}: valor vazio.\`);
  vars[name] = typeof value === "string" ? value : JSON.stringify(value);
}

function pattern(text: string): RegExp {
  return new RegExp(text.split("*").map((part) => part.replace(/[.+?^\${}()|[\\]\\\\]/g, "\\\\$&")).join(".*"));
}

/**
 * Deixa a chamada passar para o backend real e guarda o corpo antes de devolver à página.
 * Não é mock: a resposta é a do servidor. Assim o corpo não se perde quando a página navega.
 */
function captureResponse(page: Page, method: string, url: string, timeout = 30_000): Promise<{ status: number; text: string; summary: string }> {
  const matcher = (target: URL) => pattern(url).test(target.toString());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      page.unroute(matcher, handler).catch(() => undefined);
      reject(new Error(\`A ação não disparou \${method || "a chamada"} \${url} em \${timeout / 1000}s.\`));
    }, timeout);
    let done = false;
    const handler = async (route: Route) => {
      if (done || (method && route.request().method() !== method)) return route.fallback();
      done = true;
      try {
        const response = await route.fetch();
        const text = await response.text();
        await route.fulfill({ response, body: text });
        clearTimeout(timer);
        // Sem await: unroute espera os handlers em curso, inclusive este.
        void page.unroute(matcher, handler).catch(() => undefined);
        resolve({ status: response.status(), text, summary: \`\${route.request().method()} \${route.request().url()} → \${response.status()} \${text.slice(0, 500)}\` });
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    };
    page.route(matcher, handler).catch(reject);
  });
}

async function describe(response: APIResponse | Response): Promise<string> {
  let text = "";
  try {
    text = (await response.text()).slice(0, 500);
  } catch {
    /* corpo indisponível */
  }
  const method = "request" in response && typeof response.request === "function" ? \`\${response.request().method()} \` : "";
  return \`\${method}\${response.url()} → \${response.status()} \${text}\`;
}
${usesEmail ? `
/** Caixa local Mailpit (docker run -p 8025:8025 -p 1025:1025 axllent/mailpit). */
async function waitForEmail(query: string, timeout: number): Promise<{ subject: string; body: string }> {
  let id = "";
  await expect
    .poll(
      async () => {
        const response = await api.get(join(MAIL_URL, \`/api/v1/search?query=\${encodeURIComponent(query)}\`)).catch(() => undefined);
        if (!response?.ok()) return 0;
        const list = ((await response.json()) as { messages?: Array<{ ID: string }> }).messages ?? [];
        id = list[0]?.ID ?? "";
        return list.length;
      },
      { message: \`Nenhum e-mail com \${query} em \${MAIL_URL}\`, timeout },
    )
    .toBeGreaterThan(0);
  const message = (await (await api.get(join(MAIL_URL, \`/api/v1/message/\${id}\`))).json()) as { Subject?: string; Text?: string; HTML?: string };
  return { subject: message.Subject ?? "", body: \`\${message.Subject ?? ""}\\n\${message.Text ?? ""}\\n\${message.HTML ?? ""}\` };
}
` : ""}
const API_HEADERS: Record<string, string> = ${headers ? `fillDeep(${JSON.stringify(headers)})` : "{}"};
const CONTEXT_OPTIONS = ${JSON.stringify(contextOverrides)};
${actorCount ? `
/** Login de cada ator, no próprio navegador. */
const LOGINS: Record<string, (page: Page) => Promise<void>> = {
${actorLogins.join("\n")}
};
` : ""}
/** Opções de contexto do projeto (dispositivo, idioma) para atores extras. */
function contextOptions(): Record<string, unknown> {
  const use = test.info().project.use as Record<string, unknown>;
  const keys = ["viewport", "userAgent", "deviceScaleFactor", "isMobile", "hasTouch", "locale", "timezoneId", "colorScheme", "ignoreHTTPSErrors"];
  return { ...Object.fromEntries(keys.filter((key) => use[key] !== undefined).map((key) => [key, use[key]])), ...CONTEXT_OPTIONS };
}

let api: APIRequestContext;

test.describe.configure({ mode: "serial"${retries ? `, retries: ${retries}` : ""} });
${Object.keys(contextOverrides).length ? "test.use(CONTEXT_OPTIONS);\n" : ""}
test.describe(${q(`${options.name} @journey`)}, () => {
  test.beforeAll(async () => {
    api = await playwrightRequest.newContext({ extraHTTPHeaders: API_HEADERS });
    const probe = await api.get(join(BASE_URL, ${q(health)})).catch((error: Error) => error);
    if (probe instanceof Error || probe.status() >= 500) {
      throw new Error(
        \`O sistema não respondeu em \${join(BASE_URL, ${q(health)})}. Suba frontend, backend e banco antes da jornada. \${probe instanceof Error ? probe.message : \`Status \${probe.status()}.\`}\`,
      );
    }
${(options.seed ?? []).length ? (options.seed ?? []).flatMap((call) => renderApiCall(call, "    ", "seed")).join("\n") : "    // Sem seed: a jornada usa o que já existe no ambiente."}
  });

  test.afterAll(async () => {
    if (!api) return;
${(options.cleanup ?? []).length ? [...(options.cleanup ?? [])].reverse().flatMap((call) => renderApiCall(call, "    ", "cleanup")).join("\n") : "    // Sem limpeza declarada. Dado criado pela jornada fica no ambiente."}
    await api.dispose();
  });

  test(${q(options.name)}, async ({ page, browser }) => {
    test.setTimeout(${totalSeconds * 1000});
    const pages: Record<string, Page> = { ${MAIN}: page };
    const contexts: BrowserContext[] = [];
    async function actor(name: string): Promise<Page> {
      if (pages[name]) return pages[name];
      ${actorCount ? "const login = LOGINS[name];" : "const login = undefined as ((page: Page) => Promise<void>) | undefined;"}
      if (!login) throw new Error(\`"\${name}" não é ator nem aba aberta.\`);
      const context = await browser.newContext(contextOptions());
      contexts.push(context);
      const created = await context.newPage();
      pages[name] = created;
      await login(created);
      return created;
    }
    try {
${body.join("\n")}
    } finally {
      for (const context of contexts) await context.close();
    }
  });
});
`;

  if (!(options.cleanup ?? []).length && ((options.seed ?? []).length || steps.some((s) => s.action === "click" || s.action === "api"))) {
    notes.push("Sem `cleanup`: o que a jornada criar fica no ambiente. Use `{{runId}}` nos dados para não colidir entre execuções.");
  }
  if (usesEmail) {
    notes.push("Os passos `email` leem uma caixa local Mailpit (`docker run -d -p 8025:8025 -p 1025:1025 axllent/mailpit`). Aponte o SMTP do sistema para a porta 1025 e use `{{runId}}` no destinatário.");
  }
  if (hasScreenshots) {
    notes.push("`expectScreenshot` compara com a referência gravada. A primeira execução cria a referência (`--update-snapshots`); revise a imagem antes de commitar.");
  }

  return {
    code,
    fileName: `${slug}.journey.spec.ts`,
    slug,
    envVars: [...envVars],
    variables: [...produced],
    notes,
    stepTitles: titles,
    packages: usesA11y ? ["@axe-core/playwright"] : [],
    hasScreenshots,
  };
}

/** Alvos que a jornada procura na tela, para conferir contra os arquivos de tela. */
export function journeyTargets(steps: JourneyStep[]): JourneyTarget[] {
  const found: JourneyTarget[] = [];
  for (const step of steps) {
    if ("target" in step && step.target) found.push(step.target);
    if (step.action === "dragTo") found.push(step.to);
  }
  return found;
}

export interface EnvironmentOptions {
  testDir: string;
  baseUrl: string;
  browsers?: Array<"chromium" | "firefox" | "webkit">;
  mobileDevices?: string[];
  servers?: Array<{ command: string; url: string; cwd?: string; timeoutSeconds?: number }>;
  locale?: string;
  timezoneId?: string;
  retriesLocal?: number;
  retriesCi?: number;
  workers?: number;
}

const DESKTOP: Record<string, string> = { chromium: "Desktop Chrome", firefox: "Desktop Firefox", webkit: "Desktop Safari" };

export function renderJourneyConfig(options: EnvironmentOptions): string {
  const browsers = options.browsers?.length ? options.browsers : ["chromium"];
  const projects = [
    ...browsers.map((name) => `    { name: ${q(name)}, use: { ...devices[${q(DESKTOP[name])}] } },`),
    ...(options.mobileDevices ?? []).map(
      (device) => `    { name: ${q(journeySlug(device))}, use: { ...devices[${q(device)}] } },`,
    ),
  ];
  const servers = (options.servers ?? []).map(
    (server) => `    {
      command: ${q(server.command)},
      url: ${q(server.url)},${server.cwd ? `\n      cwd: ${q(server.cwd)},` : ""}
      reuseExistingServer: !process.env.CI,
      timeout: ${Math.max(10, Math.min(900, server.timeoutSeconds ?? 180)) * 1000},
      stdout: "pipe",
    },`,
  );
  const use = [
    "    baseURL: BASE_URL,",
    '    trace: "retain-on-failure",',
    '    video: "retain-on-failure",',
    '    screenshot: "only-on-failure",',
    "    actionTimeout: 15_000,",
    "    navigationTimeout: 30_000,",
    options.locale ? `    locale: ${q(options.locale)},` : undefined,
    options.timezoneId ? `    timezoneId: ${q(options.timezoneId)},` : undefined,
  ].filter(Boolean);
  return `// Config das jornadas ponta a ponta. Gerado pelo MCP E2E (setup_e2e_environment).
// Rode: npx playwright test -c playwright.journeys.config.ts
// Relatório: npx playwright show-report playwright-report/journeys
import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL ?? ${q(options.baseUrl)};

export default defineConfig({
  testDir: ${q(`${options.testDir}/journeys`)},
  testMatch: /.*\\.journey\\.spec\\.(ts|js|mjs)$/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  workers: process.env.CI ? ${Math.max(1, options.workers ?? 2)} : 1,
  retries: process.env.CI ? ${Math.max(0, options.retriesCi ?? 2)} : ${Math.max(0, options.retriesLocal ?? 0)},
  timeout: 120_000,
  // Comparação visual estrita por padrão. Para tolerar ruído: toHaveScreenshot: { maxDiffPixels: 50 }.
  expect: { timeout: 10_000 },
  outputDir: "test-results/journeys",
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}",
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report/journeys" }],
    ["junit", { outputFile: "test-results/journeys/junit.xml" }],
  ],
  use: {
${use.join("\n")}
  },
  projects: [
${projects.join("\n")}
  ],${servers.length ? `\n  // Sobe o sistema antes das jornadas e derruba no final. Localmente reaproveita o que já está de pé.\n  webServer: [\n${servers.join("\n")}\n  ],` : ""}
});
`;
}

export function renderJourneyWorkflow(options: {
  browsers?: Array<"chromium" | "firefox" | "webkit">;
  secrets?: string[];
  nodeVersion?: string;
  compose?: boolean;
}): string {
  const browsers = options.browsers?.length ? options.browsers : ["chromium"];
  const env = (options.secrets ?? []).map((name) => `      ${name}: \${{ secrets.${name} }}`);
  return `# Jornadas ponta a ponta. Gerado pelo MCP E2E (setup_e2e_environment).
name: E2E jornadas

on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  journeys:
    runs-on: ubuntu-latest
    timeout-minutes: 30
${env.length ? `    env:\n${env.join("\n")}\n` : ""}    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${q(options.nodeVersion ?? "20")}
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps ${browsers.join(" ")}
${options.compose ? "      - run: docker compose up -d --wait\n" : ""}      - run: npx playwright test -c playwright.journeys.config.ts
      - uses: actions/upload-artifact@v4
        if: \${{ !cancelled() }}
        with:
          name: relatorio-jornadas
          path: |
            playwright-report/journeys
            test-results/journeys
          retention-days: 14
${options.compose ? "      - if: always()\n        run: docker compose logs --no-color > compose.log; docker compose down -v\n" : ""}`;
}
