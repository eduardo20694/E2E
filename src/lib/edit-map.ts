import fs from "node:fs";
import path from "node:path";
import { detectStack, type DetectedStack } from "./detect.js";
import { extractSymbols } from "./symbols.js";
import { errorResult, textResult, type ToolTextResult } from "./result.js";
import { doc } from "./format.js";

/** Condição de uma tool na matriz. O resource e a resposta usam o mesmo texto. */
export type StepGate = "always" | "junit-log" | "report" | "boundary" | "lcov" | "visual" | "extra-function" | "pact" | "manifest";

export interface MapStep {
  tool: string;
  reason: string;
  gate: StepGate;
}

export interface MapAvoid {
  tool: string;
  reason: string;
}

export interface LayerGuide {
  id: "test" | "ui" | "api" | "deploy" | "sql" | "prompt" | "production";
  label: string;
  when: string;
  steps: MapStep[];
  avoid: MapAvoid[];
  note?: string;
}

export const GATE_TEXT: Record<StepGate, string> = {
  always: "sempre",
  "junit-log": "se houver log ou JUnit no projeto",
  report: "se não houver log nem JUnit e houver relatório",
  boundary: "se o fonte tiver \"entre N e M\" ou comparação com número",
  lcov: "se existir coverage/lcov.info ou lcov.info na raiz",
  visual: "se a stack tiver percy, chromatic, applitools ou Storybook",
  "extra-function": "se houver função além do handler",
  pact: "se a stack tiver pact",
  manifest: "se houver package.json, pyproject.toml, pom.xml ou go.mod na raiz",
};

export const SIBLING_RULE =
  "Teste irmão no mesmo diretório (`foo.test.ts`, `foo.spec.ts`, `test_foo.py`, `foo_test.py`, `FooTest.java`, `foo_test.go`, `foo_spec.rb`). Se o nome do símbolo já aparece nele, a primeira orientação é `read_workspace` nesse arquivo, sem gerar outro esqueleto por cima.";

const SKELETON_TOOLS = new Set([
  "generate_unit_test",
  "generate_e2e_test",
  "generate_api_test",
  "generate_integration_test",
  "generate_llm_prompt_test",
]);

export const LAYER_GUIDE: LayerGuide[] = [
  {
    id: "test",
    label: "Teste já existente",
    when: "*.test.*, *.spec.*, *_test.go, test_*.py, *_test.py, *Test.java, *_spec.rb, *.feature",
    steps: [
      {
        tool: "read_workspace",
        reason: "O arquivo já é teste. Leia o que está no disco.",
        gate: "always",
      },
      {
        tool: "flakiness_analyzer",
        reason: "Há log ou JUnit no projeto.",
        gate: "junit-log",
      },
      {
        tool: "diagnose_test_report",
        reason: "Há relatório e não há log nem JUnit.",
        gate: "report",
      },
    ],
    avoid: [
      { tool: "generate_unit_test", reason: "o arquivo já é teste." },
      { tool: "generate_e2e_test", reason: "não é tela." },
      { tool: "setup_chaos_experiment", reason: "não é deploy." },
    ],
    note: "Sem log e sem relatório, use o prompt `e2e-review-test` com o código do teste. Não invente tool.",
  },
  {
    id: "ui",
    label: "UI",
    when: ".tsx, .jsx, ou pasta components, pages, views, screens",
    steps: [
      { tool: "generate_unit_test", reason: "Teste do componente com os controles da tela.", gate: "always" },
      { tool: "generate_e2e_test", reason: "Fluxo da tela com a rota e os controles do arquivo.", gate: "always" },
      { tool: "suggest_accessibility_audit", reason: "Auditoria de acessibilidade na rota da página.", gate: "always" },
      { tool: "suggest_security_checklist", reason: "Segurança da tela no localhost: cabeçalho, cookie, CSRF e escape.", gate: "always" },
      { tool: "suggest_sast_setup", reason: "SAST da stack. Roda o scanner local se o binário já está instalado.", gate: "always" },
      { tool: "visual_regression_setup", reason: "Regressão visual.", gate: "visual" },
    ],
    avoid: [
      { tool: "generate_api_test", reason: "não é contrato de API." },
      { tool: "setup_chaos_experiment", reason: "não é deploy." },
      { tool: "generate_mobile_test", reason: "não é app nativo." },
    ],
  },
  {
    id: "api",
    label: "API",
    when: "caminho com route, handler, controller, api, graphql, ou arquivo .proto",
    steps: [
      { tool: "generate_api_test", reason: "Contrato com método, path e status do handler.", gate: "always" },
      { tool: "generate_integration_test", reason: "Integração do endpoint com o sistema.", gate: "always" },
      { tool: "suggest_security_checklist", reason: "Checklist OWASP. No localhost: 401/403, cabeçalho, CORS se o fonte tem CORS, e falha se a rota com id não compara dono.", gate: "always" },
      { tool: "suggest_sast_setup", reason: "SAST da stack. Roda o scanner local se o binário já está instalado.", gate: "always" },
      { tool: "generate_unit_test", reason: "Há função além do handler.", gate: "extra-function" },
      { tool: "setup_consumer_driven_contracts", reason: "Contrato dirigido pelo consumidor.", gate: "pact" },
    ],
    avoid: [
      { tool: "generate_e2e_test", reason: "não é tela." },
      { tool: "setup_chaos_experiment", reason: "não é deploy." },
      { tool: "generate_mobile_test", reason: "não é app nativo." },
    ],
  },
  {
    id: "deploy",
    label: "Deploy",
    when: "caminho com k8s, helm, deploy, chart, rollout ou flagger",
    steps: [
      { tool: "setup_canary_release", reason: "Canário. Grava e não aplica.", gate: "always" },
      { tool: "generate_smoke_test_prod", reason: "Smoke pós-deploy. Grava e não aplica.", gate: "always" },
      { tool: "setup_chaos_experiment", reason: "Chaos. Grava e não aplica.", gate: "always" },
    ],
    avoid: [
      { tool: "generate_unit_test", reason: "não é função de produção." },
      { tool: "generate_e2e_test", reason: "não é tela." },
      { tool: "generate_api_test", reason: "não é contrato HTTP do código." },
    ],
    note: "Essas três gravam e não aplicam (sem kubectl, sem HTTP de produção, sem chaos no cluster).",
  },
  {
    id: "sql",
    label: "SQL",
    when: "arquivo .sql ou pasta migration/migrations",
    steps: [
      { tool: "generate_integration_test", reason: "Integração contra o banco isolado.", gate: "always" },
      { tool: "suggest_seeding_strategy", reason: "Seed da tabela ou da migração.", gate: "always" },
    ],
    avoid: [
      { tool: "generate_e2e_test", reason: "não é tela." },
      { tool: "setup_chaos_experiment", reason: "não é deploy." },
      { tool: "generate_api_test", reason: "não é contrato HTTP." },
    ],
  },
  {
    id: "prompt",
    label: "Prompt",
    when: "pasta prompt/prompts, ou o fonte traz um system prompt longo",
    steps: [
      { tool: "generate_llm_prompt_test", reason: "Casos do prompt.", gate: "always" },
      { tool: "suggest_model_testing_plan", reason: "Plano de teste do modelo.", gate: "always" },
    ],
    avoid: [
      { tool: "generate_e2e_test", reason: "não é tela." },
      { tool: "setup_chaos_experiment", reason: "não é deploy." },
      { tool: "generate_api_test", reason: "não é contrato HTTP." },
    ],
  },
  {
    id: "production",
    label: "Código de produção",
    when: ".ts, .js, .py, .go, .java, .rb, .php que não caiu nas camadas anteriores",
    steps: [
      { tool: "generate_unit_test", reason: "Grava e roda o unitário.", gate: "always" },
      {
        tool: "boundary_value_analysis",
        reason: "O fonte traz intervalo ou comparação com número.",
        gate: "boundary",
      },
      { tool: "code_coverage_advisor", reason: "Há lcov no projeto.", gate: "lcov" },
      { tool: "suggest_sca_setup", reason: "SCA do manifesto. Roda npm audit ou pip-audit se a ferramenta já está instalada.", gate: "manifest" },
    ],
    avoid: [
      { tool: "generate_e2e_test", reason: "não é tela." },
      { tool: "setup_chaos_experiment", reason: "não é deploy." },
    ],
  },
];

export interface EditMapInput {
  filePath?: string;
  projectRoot?: string;
  sourceCode?: string;
  /** true depois que o handler procurou o irmão no disco. */
  siblingChecked?: boolean;
  siblingPath?: string;
  siblingText?: string;
  hasLogOrJunit?: boolean;
  hasReport?: boolean;
  hasLcov?: boolean;
}

/** Markdown da matriz. O resource `e2e://map` devolve este texto, sem tabela escrita à parte. */
export function layerMatrixMarkdown(): string {
  const rows = LAYER_GUIDE.map((layer) => [
    layer.label,
    layer.when,
    layer.steps
      .map((step) => `\`${step.tool}\` (${GATE_TEXT[step.gate]})`)
      .join("; "),
    layer.avoid.map((item) => `\`${item.tool}\``).join(", "),
  ]);
  const notes = LAYER_GUIDE.filter((layer) => layer.note).map((layer) => `**${layer.label}.** ${layer.note}`);
  return doc([
    "# Mapa de tools por arquivo editado",
    "Caminho em minúsculas, com barra normal. Sem filePath e sem sourceCode o mapa pede o arquivo e não chuta a camada. Arquivo que já é teste não entra em `generate_unit_test`.",
    SIBLING_RULE,
    markdownRows(rows),
    ...notes,
  ]);
}

export function mapTestsForEdit(input: EditMapInput): ToolTextResult {
  const filePath = input.filePath?.trim();
  const sourceCode = input.sourceCode;
  if (!filePath && !sourceCode?.trim()) {
    return errorResult(
      "Informe o filePath do arquivo que foi editado ou aberto. Sem o arquivo não escolho a camada.",
    );
  }
  if (!filePath) {
    return errorResult(
      "Informe o filePath do arquivo que foi editado ou aberto. O fonte sozinho não define a camada.",
    );
  }

  const layer = classifyLayer(filePath, sourceCode);
  const guide = LAYER_GUIDE.find((item) => item.id === layer);
  const covered = siblingCoversSymbols(sourceCode, input.siblingText);
  const steps = guide ? activeSteps(guide, input, covered) : [];
  const avoid = guide ? avoidFor(guide, covered) : FALLBACK_AVOID;

  const lines = steps.map((step, index) => {
    const target = step.tool === "read_workspace" && covered && input.siblingPath ? input.siblingPath : filePath;
    return `${index + 1}. \`${step.tool}\` — ${argumentPhrase(target, input.projectRoot)}. ${step.reason}`;
  });

  const promptNote =
    layer === "test" && !input.hasLogOrJunit && !input.hasReport ? guide?.note : undefined;
  const deployNote = layer === "deploy" ? guide?.note : undefined;

  const body = doc([
    `# Mapa — ${filePath}`,
    opening(filePath, layer, sourceCode, input, covered),
    "## Use nesta ordem",
    lines.length ? lines.join("\n") : "Nenhuma tool desta matriz cabe neste arquivo.",
    promptNote,
    deployNote,
    "## Não use",
    avoid.map((item) => `- \`${item.tool}\` — ${item.reason}`).join("\n"),
  ]);
  return textResult(body);
}

const FALLBACK_AVOID: MapAvoid[] = [
  { tool: "generate_unit_test", reason: "a camada não é código de produção reconhecido." },
  { tool: "generate_e2e_test", reason: "não é tela." },
  { tool: "setup_chaos_experiment", reason: "não é deploy." },
];

function activeSteps(guide: LayerGuide, input: EditMapInput, covered: boolean): MapStep[] {
  const stack = detectStack(input.projectRoot);
  const selected = guide.steps.filter((step) => gateOpen(step.gate, input, stack));
  if (!covered || !input.siblingPath) return dedupe(selected).slice(0, 6);
  const review: MapStep = {
    tool: "read_workspace",
    reason: `Os símbolos já aparecem em \`${input.siblingPath}\`. Revise esse arquivo em vez de gerar outro esqueleto.`,
    gate: "always",
  };
  const rest = selected.filter((step) => !SKELETON_TOOLS.has(step.tool));
  return dedupe([review, ...rest]).slice(0, 6);
}

function gateOpen(gate: StepGate, input: EditMapInput, stack?: DetectedStack): boolean {
  if (gate === "always") return true;
  if (gate === "junit-log") return Boolean(input.hasLogOrJunit);
  if (gate === "report") return !input.hasLogOrJunit && Boolean(input.hasReport);
  if (gate === "boundary") return needsBoundary(input.sourceCode);
  if (gate === "lcov") return Boolean(input.hasLcov);
  if (gate === "visual") return hasVisual(stack);
  if (gate === "pact") return hasPact(stack);
  if (gate === "extra-function") return hasFunctionBeyondHandler(input.sourceCode);
  if (gate === "manifest") return hasDependencyManifest(input.projectRoot);
  return false;
}

const DEPENDENCY_MANIFESTS = ["package.json", "pyproject.toml", "pom.xml", "go.mod"];

function hasDependencyManifest(projectRoot?: string): boolean {
  if (!projectRoot) return false;
  try {
    if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) return false;
  } catch {
    return false;
  }
  return DEPENDENCY_MANIFESTS.some((name) => fs.existsSync(path.join(projectRoot, name)));
}

function hasVisual(stack: DetectedStack | undefined): boolean {
  if (!stack) return false;
  if (stack.hasStorybook) return true;
  return stack.visualTools.some((tool) => tool === "percy" || tool === "chromatic" || tool === "applitools");
}

function hasPact(stack: DetectedStack | undefined): boolean {
  return Boolean(stack?.libraries.includes("pact"));
}

function hasFunctionBeyondHandler(source: string | undefined): boolean {
  if (!source?.trim()) return false;
  const handlers = routeCallbackNames(source);
  return extractSymbols(source).some(
    (symbol) => (symbol.kind === "function" || symbol.kind === "method") && !handlers.has(symbol.name),
  );
}

function routeCallbackNames(source: string): Set<string> {
  const names = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
  for (const match of source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(
    /\.(?:get|post|put|patch|delete|head|options|all)\s*\(\s*['"`][^'"`]+['"`]\s*,([^)]*)\)/g,
  )) {
    for (const id of match[1].matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
      const name = id[1];
      if (["async", "function", "req", "res", "request", "reply", "ctx", "next"].includes(name)) continue;
      names.add(name);
    }
  }
  return names;
}

function avoidFor(guide: LayerGuide, covered: boolean): MapAvoid[] {
  if (!covered) return guide.avoid.slice(0, 3);
  const dropped = guide.steps.find((step) => SKELETON_TOOLS.has(step.tool));
  const extra = dropped
    ? [{ tool: dropped.tool, reason: "os símbolos já aparecem no teste irmão." }]
    : [];
  const merged = [...extra, ...guide.avoid.filter((item) => item.tool !== extra[0]?.tool)];
  return merged.slice(0, 3);
}

function dedupe(steps: MapStep[]): MapStep[] {
  const seen = new Set<string>();
  return steps.filter((step) => {
    if (seen.has(step.tool)) return false;
    seen.add(step.tool);
    return true;
  });
}

export function classifyLayer(filePath: string, sourceCode?: string): LayerGuide["id"] | "unknown" {
  const normalized = normalizePath(filePath);
  if (isTestFile(filePath)) return "test";
  if (isUi(normalized, filePath)) return "ui";
  if (isApi(filePath)) return "api";
  if (isDeploy(filePath)) return "deploy";
  if (isSql(filePath)) return "sql";
  if (isPromptPath(filePath) || mentionsLongSystemPrompt(sourceCode)) return "prompt";
  if (isProduction(normalized)) return "production";
  return "unknown";
}

export function siblingCandidates(filePath: string): string[] {
  if (isTestFile(filePath)) return [];
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const slash = normalized.lastIndexOf("/");
  const dir = slash >= 0 ? normalized.slice(0, slash) : "";
  const base = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return [];
  const stem = base.slice(0, dot);
  const ext = base.slice(dot).toLowerCase();
  const join = (name: string) => (dir ? `${dir}/${name}` : name);

  if (ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx") {
    return [join(`${stem}.test${ext}`), join(`${stem}.spec${ext}`)];
  }
  if (ext === ".py") return [join(`test_${stem}.py`), join(`${stem}_test.py`)];
  if (ext === ".java") {
    const pascal = stem.charAt(0).toUpperCase() + stem.slice(1);
    return [join(`${pascal}Test.java`)];
  }
  if (ext === ".go") return [join(`${stem}_test.go`)];
  if (ext === ".rb") return [join(`${stem}_spec.rb`)];
  return [];
}

export function needsBoundary(source: string | undefined): boolean {
  if (!source) return false;
  if (/entre\s+\d+(?:[.,]\d+)?\s+e\s+\d+(?:[.,]\d+)?/i.test(source)) return true;
  if (/(?:<=|>=|===|==|!==|!=|<|>)\s*-?\d+(?:[.,]\d+)?/.test(source)) return true;
  if (/-?\d+(?:[.,]\d+)?\s*(?:<=|>=|===|==|!==|!=|<|>)/.test(source)) return true;
  return false;
}

export function mentionsLongSystemPrompt(source: string | undefined): boolean {
  if (!source) return false;
  const marker = /system[\s_-]*prompt|systemPrompt|system_prompt|role\s*[:=]\s*["']system["']/gi;
  for (const match of source.matchAll(marker)) {
    const at = match.index ?? 0;
    const window = source.slice(at, at + match[0].length + 600);
    if (/(["'`])(?:\\.|(?!\1)[\s\S]){80,}\1/.test(window)) return true;
  }
  return false;
}

function opening(
  filePath: string,
  layer: LayerGuide["id"] | "unknown",
  source: string | undefined,
  input: EditMapInput,
  covered: boolean,
): string {
  const language = languageName(filePath);
  const guide = LAYER_GUIDE.find((item) => item.id === layer);
  const kind = guide?.label ?? "Camada não reconhecida";
  const symbols = symbolClause(source);
  const sibling = siblingSentence(filePath, input, covered);
  const parts = [`${kind} ${language}.`];
  if (symbols) parts.push(`${symbols.charAt(0).toUpperCase()}${symbols.slice(1)}.`);
  if (sibling) parts.push(sibling);
  return parts.join(" ");
}

function siblingSentence(filePath: string, input: EditMapInput, covered: boolean): string | undefined {
  if (!input.siblingChecked || isTestFile(filePath)) return undefined;
  const expected = siblingCandidates(filePath);
  if (!input.siblingPath) {
    if (expected.length === 0) return undefined;
    const names = expected.map((candidate) => `\`${basename(candidate)}\``).join(" nem ");
    return `Não há ${names} ao lado.`;
  }
  if (covered) return `Há \`${input.siblingPath}\` ao lado e o nome do símbolo já aparece nele.`;
  if (input.siblingText && extractSymbols(input.sourceCode ?? "").length > 0) {
    return `Há \`${input.siblingPath}\` ao lado, sem o nome dos símbolos extraídos.`;
  }
  return `Há \`${input.siblingPath}\` ao lado.`;
}

function symbolClause(source: string | undefined): string | undefined {
  if (!source?.trim()) return undefined;
  const names = extractSymbols(source).map((symbol) => symbol.name);
  if (names.length === 0) return "nenhum símbolo extraído";
  if (names.length === 1) return `símbolo \`${names[0]}\``;
  return `símbolos ${names.map((name) => `\`${name}\``).join(", ")}`;
}

function siblingCoversSymbols(source: string | undefined, siblingText: string | undefined): boolean {
  if (!source?.trim() || !siblingText) return false;
  const names = extractSymbols(source)
    .map((symbol) => symbol.name)
    .filter((name) => name.length > 1);
  return names.some((name) => new RegExp(`\\b${escapeRegExp(name)}\\b`).test(siblingText));
}

function argumentPhrase(filePath: string, projectRoot?: string): string {
  const parts = [`filePath \`${filePath}\``];
  if (projectRoot?.trim()) parts.push(`projectRoot \`${projectRoot.trim()}\``);
  return parts.join(", ");
}

function isTestFile(filePath: string): boolean {
  const base = basename(filePath);
  const lower = base.toLowerCase();
  if (/\.test\./.test(lower) || /\.spec\./.test(lower)) return true;
  if (/_test\.go$/.test(lower)) return true;
  if (/^test_.+\.py$/.test(lower) || /_test\.py$/.test(lower)) return true;
  if (/Test\.java$/.test(base) || /_test\.java$/i.test(base)) return true;
  if (/_spec\.rb$/.test(lower)) return true;
  if (/\.feature$/.test(lower)) return true;
  return false;
}

function isUi(normalized: string, filePath: string): boolean {
  if (/\.(tsx|jsx)$/.test(normalized)) return true;
  return hasDirectory(filePath, ["components", "pages", "views", "screens"]);
}

function isApi(filePath: string): boolean {
  if (normalizePath(filePath).endsWith(".proto")) return true;
  return hasWord(filePath, ["route", "routes", "router", "handler", "handlers", "controller", "controllers", "api", "graphql"]);
}

function isDeploy(filePath: string): boolean {
  return hasWord(filePath, ["k8s", "helm", "deploy", "chart", "charts", "rollout", "flagger"]);
}

function isSql(filePath: string): boolean {
  if (normalizePath(filePath).endsWith(".sql")) return true;
  return hasDirectory(filePath, ["migration", "migrations"]);
}

function isPromptPath(filePath: string): boolean {
  return hasDirectory(filePath, ["prompt", "prompts"]);
}

function isProduction(normalized: string): boolean {
  return /\.(ts|js|py|go|java|rb|php)$/.test(normalized);
}

function hasDirectory(filePath: string, names: string[]): boolean {
  const parts = normalizePath(filePath).split("/");
  const dirs = parts.slice(0, -1);
  return dirs.some((dir) => names.includes(dir));
}

function hasWord(filePath: string, words: string[]): boolean {
  const prepared = filePath.replace(/\\/g, "/").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  const tokens = prepared
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return words.some((word) => tokens.includes(word));
}

function languageName(filePath: string): string {
  const ext = normalizePath(filePath).split(".").pop() ?? "";
  const names: Record<string, string> = {
    ts: "TypeScript",
    tsx: "TypeScript",
    js: "JavaScript",
    jsx: "JavaScript",
    mjs: "JavaScript",
    cjs: "JavaScript",
    py: "Python",
    go: "Go",
    java: "Java",
    rb: "Ruby",
    php: "PHP",
    sql: "SQL",
    proto: "Protocol Buffers",
    yaml: "YAML",
    yml: "YAML",
    feature: "Gherkin",
    md: "Markdown",
    json: "JSON",
  };
  return names[ext] ?? "de extensão desconhecida";
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function basename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function markdownRows(rows: string[][]): string {
  const headers = ["Camada", "Quando", "Nesta ordem", "Não use"];
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
  return [head, sep, body].join("\n");
}
