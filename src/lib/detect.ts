import fs from "node:fs";
import path from "node:path";

export type UnitFramework = "jest" | "vitest" | "pytest" | "junit" | "rspec" | "go";
export type E2eFramework = "playwright" | "cypress" | "selenium";
export type Language =
  | "typescript"
  | "javascript"
  | "python"
  | "java"
  | "ruby"
  | "go"
  | "php"
  | "unknown";

export interface DetectedStack {
  root?: string;
  found: boolean;
  languages: Language[];
  unitFrameworks: UnitFramework[];
  e2eFrameworks: E2eFramework[];
  apiTools: string[];
  mutationTools: string[];
  visualTools: string[];
  performanceTools: string[];
  mobileTools: string[];
  hasTestcontainers: boolean;
  hasDocker: boolean;
  hasStorybook: boolean;
  /** CI e deploy já presentes: github-actions, gitlab-ci, kubernetes, helm. */
  delivery: string[];
  /** Feature flag já referenciada no projeto. */
  flags: string[];
  /** Observabilidade ou synthetic já referenciados. */
  observability: string[];
  /** Bibliotecas já presentes: faker, fast-check, hypothesis, eslint, pact, allure. */
  libraries: string[];
  notes: string[];
}

function blankStack(): DetectedStack {
  return {
    found: false,
    languages: [],
    unitFrameworks: [],
    e2eFrameworks: [],
    apiTools: [],
    mutationTools: [],
    visualTools: [],
    performanceTools: [],
    mobileTools: [],
    hasTestcontainers: false,
    hasDocker: false,
    hasStorybook: false,
    delivery: [],
    flags: [],
    observability: [],
    libraries: [],
    notes: [],
  };
}

function readIfExists(filePath: string): string | undefined {
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return fs.readFileSync(filePath, "utf8");
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function hasAny(text: string, needles: string[]): boolean {
  const lower = text.toLowerCase();
  return needles.some((needle) => lower.includes(needle.toLowerCase()));
}

function pushUnique<T>(list: T[], value: T): void {
  if (!list.includes(value)) list.push(value);
}

/** Infere a linguagem a partir do caminho e do código, sem depender do projeto. */
export function inferLanguage(source?: string, filePath?: string): Language {
  const ext = filePath ? path.extname(filePath).toLowerCase() : "";
  const byExt: Record<string, Language> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".py": "python",
    ".java": "java",
    ".kt": "java",
    ".rb": "ruby",
    ".go": "go",
    ".php": "php",
  };
  if (byExt[ext]) return byExt[ext];

  const code = source ?? "";
  if (/^\s*def\s+\w+\s*\(/m.test(code) || /^\s*import\s+\w+/m.test(code) && /:\s*$/m.test(code)) {
    return "python";
  }
  if (/^\s*public\s+class\s+\w+/m.test(code) || /System\.out\.println/.test(code)) return "java";
  if (/^\s*(?:class|module)\s+\w+/m.test(code) && /\bdo\b/.test(code) && /\bend\b/.test(code)) {
    return "ruby";
  }
  if (/^\s*func\s+\w+\s*\(/m.test(code) && /\bpackage\s+\w+/.test(code)) return "go";
  if (/<\?php/.test(code)) return "php";
  if (/^\s*(?:export\s+)?(?:async\s+)?function\s+/m.test(code) || /\bconst\s+\w+\s*=/.test(code)) {
    return code.includes(": ") || /:\s*(?:string|number|boolean)/.test(code)
      ? "typescript"
      : "javascript";
  }
  return "unknown";
}

export function defaultUnitFramework(language: Language): UnitFramework {
  switch (language) {
    case "python":
      return "pytest";
    case "java":
      return "junit";
    case "ruby":
      return "rspec";
    case "go":
      return "go";
    case "typescript":
    case "javascript":
    default:
      return "vitest";
  }
}

/**
 * Lê manifests na raiz informada. Não varre process.cwd() sozinho: o processo
 * do MCP é este servidor, e usar o cwd sugeriria Vitest para qualquer projeto.
 */
export function detectStack(projectRoot?: string): DetectedStack {
  if (!projectRoot) {
    const stack = blankStack();
    stack.notes.push(
      "projectRoot não informado. A sugestão de framework usa só a linguagem do código.",
    );
    return stack;
  }

  const root = path.resolve(projectRoot);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    const stack = blankStack();
    stack.root = root;
    stack.notes.push(`Diretório inexistente: ${root}. Framework inferido só pelo código.`);
    return stack;
  }

  const stack = blankStack();
  stack.root = root;
  stack.found = true;
  const packageJson = readIfExists(path.join(root, "package.json"));
  const requirements = readIfExists(path.join(root, "requirements.txt"));
  const pyproject = readIfExists(path.join(root, "pyproject.toml"));
  const pipfile = readIfExists(path.join(root, "Pipfile"));
  const pom = readIfExists(path.join(root, "pom.xml"));
  const gradle = [
    readIfExists(path.join(root, "build.gradle")),
    readIfExists(path.join(root, "build.gradle.kts")),
  ]
    .filter(Boolean)
    .join("\n");
  const gemfile = readIfExists(path.join(root, "Gemfile"));
  const goMod = readIfExists(path.join(root, "go.mod"));
  const composer = readIfExists(path.join(root, "composer.json"));

  if (packageJson) {
    pushUnique(stack.languages, "typescript");
    const deps = packageJson;
    if (hasAny(deps, ['"vitest"'])) pushUnique(stack.unitFrameworks, "vitest");
    if (hasAny(deps, ['"jest"', "@jest/"])) pushUnique(stack.unitFrameworks, "jest");
    if (hasAny(deps, ['"@playwright/test"', '"playwright"'])) {
      pushUnique(stack.e2eFrameworks, "playwright");
    }
    if (hasAny(deps, ['"cypress"'])) pushUnique(stack.e2eFrameworks, "cypress");
    if (hasAny(deps, ["selenium-webdriver"])) pushUnique(stack.e2eFrameworks, "selenium");
    if (hasAny(deps, ["supertest", '"pact"', "@pact-foundation"])) {
      stack.apiTools.push("supertest/pact");
    }
    if (hasAny(deps, ["@stryker-mutator", '"stryker"'])) stack.mutationTools.push("stryker");
    if (hasAny(deps, ["@percy/"])) stack.visualTools.push("percy");
    if (hasAny(deps, ["chromatic", "@chromatic-com"])) stack.visualTools.push("chromatic");
    if (hasAny(deps, ["@applitools/"])) stack.visualTools.push("applitools");
    if (hasAny(deps, ['"k6"', "artillery"])) stack.performanceTools.push("k6");
    if (hasAny(deps, ["webdriverio", "appium"])) stack.mobileTools.push("appium");
    if (hasAny(deps, ["testcontainers"])) stack.hasTestcontainers = true;
    if (hasAny(deps, ["@storybook/"])) stack.hasStorybook = true;
    if (hasAny(deps, ["launchdarkly"])) stack.flags.push("launchdarkly");
    if (hasAny(deps, ["unleash"])) stack.flags.push("unleash");
    if (hasAny(deps, ["growthbook"])) stack.flags.push("growthbook");
    if (hasAny(deps, ["dd-trace", "@datadog"])) stack.observability.push("datadog");
    if (hasAny(deps, ["checkly"])) stack.observability.push("checkly");
    if (hasAny(deps, ["@faker-js/faker", '"faker"'])) pushUnique(stack.libraries, "faker");
    if (hasAny(deps, ["fast-check"])) pushUnique(stack.libraries, "fast-check");
    if (hasAny(deps, ['"eslint"'])) pushUnique(stack.libraries, "eslint");
    if (hasAny(deps, ["snyk"])) pushUnique(stack.libraries, "snyk");
    if (hasAny(deps, ["allure"])) pushUnique(stack.libraries, "allure");
    if (hasAny(deps, ["wiremock", "hoverfly"])) pushUnique(stack.libraries, "wiremock");
    if (hasAny(deps, ["@pact-foundation", '"pact"'])) pushUnique(stack.libraries, "pact");
  }

  const pythonText = [requirements, pyproject, pipfile].filter(Boolean).join("\n");
  if (pythonText) {
    pushUnique(stack.languages, "python");
    if (hasAny(pythonText, ["pytest"])) pushUnique(stack.unitFrameworks, "pytest");
    if (hasAny(pythonText, ["mutmut"])) stack.mutationTools.push("mutmut");
    if (hasAny(pythonText, ["selenium"])) pushUnique(stack.e2eFrameworks, "selenium");
    if (hasAny(pythonText, ["appium"])) stack.mobileTools.push("appium");
    if (hasAny(pythonText, ["schemathesis", "requests"])) stack.apiTools.push("pytest-http");
    if (hasAny(pythonText, ["locust"])) stack.performanceTools.push("locust");
    if (hasAny(pythonText, ["hypothesis"])) pushUnique(stack.libraries, "hypothesis");
    if (hasAny(pythonText, ["faker", "factory_boy", "factory-boy"])) pushUnique(stack.libraries, "faker");
  }

  const javaText = [pom, gradle].filter(Boolean).join("\n");
  if (javaText) {
    pushUnique(stack.languages, "java");
    if (hasAny(javaText, ["junit"])) pushUnique(stack.unitFrameworks, "junit");
    if (hasAny(javaText, ["pitest", "pit:"])) stack.mutationTools.push("pit");
    if (hasAny(javaText, ["testcontainers"])) stack.hasTestcontainers = true;
    if (hasAny(javaText, ["selenium"])) pushUnique(stack.e2eFrameworks, "selenium");
    if (hasAny(javaText, ["gatling"])) stack.performanceTools.push("gatling");
    if (hasAny(javaText, ["rest-assured", "spring-boot-starter-test"])) {
      stack.apiTools.push("rest-assured");
    }
  }

  if (gemfile) {
    pushUnique(stack.languages, "ruby");
    if (hasAny(gemfile, ["rspec"])) pushUnique(stack.unitFrameworks, "rspec");
    if (hasAny(gemfile, ["capybara", "selenium"])) pushUnique(stack.e2eFrameworks, "selenium");
  }

  if (goMod) {
    pushUnique(stack.languages, "go");
    pushUnique(stack.unitFrameworks, "go");
  }

  if (composer) {
    pushUnique(stack.languages, "php");
    if (hasAny(composer, ["phpunit"])) stack.notes.push("PHPUnit detectado (fora dos geradores principais).");
  }

  const markers: Array<[string, () => void]> = [
    ["vitest.config.ts", () => pushUnique(stack.unitFrameworks, "vitest")],
    ["vitest.config.js", () => pushUnique(stack.unitFrameworks, "vitest")],
    ["jest.config.ts", () => pushUnique(stack.unitFrameworks, "jest")],
    ["jest.config.js", () => pushUnique(stack.unitFrameworks, "jest")],
    ["playwright.config.ts", () => pushUnique(stack.e2eFrameworks, "playwright")],
    ["cypress.config.ts", () => pushUnique(stack.e2eFrameworks, "cypress")],
    ["cypress.config.js", () => pushUnique(stack.e2eFrameworks, "cypress")],
    ["pytest.ini", () => pushUnique(stack.unitFrameworks, "pytest")],
    ["phpunit.xml", () => stack.notes.push("phpunit.xml presente.")],
    ["Dockerfile", () => { stack.hasDocker = true; }],
    ["docker-compose.yml", () => { stack.hasDocker = true; }],
    ["compose.yml", () => { stack.hasDocker = true; }],
  ];

  for (const [file, apply] of markers) {
    if (fs.existsSync(path.join(root, file))) apply();
  }

  scanDelivery(stack, root);

  if (stack.languages.length === 0) {
    stack.notes.push("Nenhum manifest reconhecido na raiz informada.");
  }

  return stack;
}

/** CI, Kubernetes e configs de deploy na raiz. Não varre o repositório inteiro. */
function scanDelivery(stack: DetectedStack, root: string): void {
  const fileMarkers: Array<[string, string, "delivery" | "flags" | "observability" | "libraries"]> = [
    [".gitlab-ci.yml", "gitlab-ci", "delivery"],
    ["Jenkinsfile", "jenkins", "delivery"],
    ["azure-pipelines.yml", "azure-pipelines", "delivery"],
    ["skaffold.yaml", "kubernetes", "delivery"],
    ["rollout.yaml", "argo-rollouts", "delivery"],
    ["flagger.yaml", "flagger", "delivery"],
    ["unleash.yaml", "unleash", "flags"],
    ["checkly.config.ts", "checkly", "observability"],
    [".github/dependabot.yml", "dependabot", "libraries"],
    ["sonar-project.properties", "sonar", "libraries"],
  ];

  for (const [file, label, bucket] of fileMarkers) {
    if (fs.existsSync(path.join(root, file))) pushUnique(stack[bucket], label);
  }

  if (fs.existsSync(path.join(root, ".github", "workflows"))) {
    pushUnique(stack.delivery, "github-actions");
  }

  for (const directory of ["k8s", "kubernetes", "deploy", "charts", "helm", ".k8s"]) {
    const full = path.join(root, directory);
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
      pushUnique(stack.delivery, directory === "charts" || directory === "helm" ? "helm" : "kubernetes");
    }
  }
}

export function chooseUnitFramework(
  requested: UnitFramework | undefined,
  stack: DetectedStack,
  language: Language,
): { framework: UnitFramework; warning?: string } {
  const detected = stack.unitFrameworks[0];
  if (requested) {
    if (detected && detected !== requested && requested !== "go") {
      return {
        framework: requested,
        warning: `O projeto indica \`${detected}\`, mas o framework pedido foi \`${requested}\`. O teste abaixo segue o pedido.`,
      };
    }
    if (language === "python" && (requested === "jest" || requested === "vitest")) {
      return {
        framework: requested,
        warning:
          "O código parece Python e o framework pedido é JavaScript. Confira se o arquivo analisado é mesmo esse.",
      };
    }
    return { framework: requested };
  }

  if (detected) return { framework: detected };
  return { framework: defaultUnitFramework(language) };
}

export function chooseE2eFramework(
  requested: E2eFramework | undefined,
  stack: DetectedStack,
): { framework: E2eFramework; warning?: string } {
  const detected = stack.e2eFrameworks[0];
  if (requested) {
    if (detected && detected !== requested) {
      return {
        framework: requested,
        warning: `O projeto já usa \`${detected}\`. O script abaixo segue o framework pedido (\`${requested}\`).`,
      };
    }
    return { framework: requested };
  }
  return { framework: detected ?? "playwright" };
}

export function stackSummary(stack: DetectedStack): string {
  if (!stack.found) return stack.notes.join(" ");
  const lines = [
    stack.root ? `Raiz: \`${stack.root}\`` : undefined,
    stack.languages.length ? `Linguagens: ${stack.languages.join(", ")}` : "Linguagens: não detectadas",
    stack.unitFrameworks.length
      ? `Unitário: ${stack.unitFrameworks.join(", ")}`
      : "Unitário: não detectado",
    stack.e2eFrameworks.length
      ? `E2E: ${stack.e2eFrameworks.join(", ")}`
      : "E2E: não detectado",
    stack.mutationTools.length ? `Mutation: ${stack.mutationTools.join(", ")}` : undefined,
    stack.visualTools.length ? `Visual: ${stack.visualTools.join(", ")}` : undefined,
    stack.mobileTools.length ? `Mobile: ${stack.mobileTools.join(", ")}` : undefined,
    stack.hasTestcontainers ? "Testcontainers: sim" : undefined,
    stack.hasDocker ? "Docker: sim" : undefined,
    stack.hasStorybook ? "Storybook: sim" : undefined,
    stack.delivery.length ? `Entrega: ${stack.delivery.join(", ")}` : undefined,
    stack.flags.length ? `Feature flag: ${stack.flags.join(", ")}` : undefined,
    stack.observability.length ? `Observabilidade: ${stack.observability.join(", ")}` : undefined,
    stack.libraries.length ? `Bibliotecas: ${stack.libraries.join(", ")}` : undefined,
    ...stack.notes,
  ].filter((line): line is string => Boolean(line));
  return lines.map((line) => `- ${line}`).join("\n");
}
