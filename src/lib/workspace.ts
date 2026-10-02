import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const MARKERS = [
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "pom.xml",
  "go.mod",
  "Gemfile",
  "composer.json",
  "Cargo.toml",
];

/** Manifesto, lock, compilação e segredo. Recusados mesmo com overwrite. */
const BLOCKED_BASENAMES = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "go.mod",
  "go.sum",
  "cargo.toml",
  "cargo.lock",
  "composer.json",
  "composer.lock",
  "gemfile",
  "gemfile.lock",
  "pyproject.toml",
  "tsconfig.json",
  "jsconfig.json",
]);

/** Config novo de SAST, mutação ou regressão visual. Não inclui manifesto já bloqueado. */
const EXTRA_FILES = new Set([
  ".eslintrc.security.json",
  "bandit.yaml",
  "spotbugs-security.xml",
  "gosec.json",
  ".rubocop.security.yml",
  "stryker.config.json",
  "mutmut.toml",
  "pitest-config.xml",
  ".percy.yml",
  "chromatic.config.json",
  "applitools.config.json",
  ".snyk",
  "checkly.config.ts",
]);

const TEST_FILE =
  /^(?:.+\.test\.(?:ts|tsx|js|jsx|mjs|cjs)|.+\.spec\.(?:ts|tsx|js|jsx|mjs|cjs)|test_.+\.py|.+_test\.py|.+Test\.java|.+_spec\.rb|.+_test\.rb|.+_test\.go|.+\.feature)$/;

export type RootVia = "argumento" | "env" | "cursor" | "arquivo" | "nenhuma";

export interface ResolvedRoot {
  root?: string;
  via: RootVia;
}

/** Sobe diretórios até achar um manifest de projeto. */
export function findProjectRoot(start: string): string | undefined {
  let current = start;
  try {
    if (fs.existsSync(current) && fs.statSync(current).isFile()) current = path.dirname(current);
  } catch {
    return undefined;
  }

  for (let depth = 0; depth < 8; depth += 1) {
    if (MARKERS.some((marker) => fs.existsSync(path.join(current, marker)))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

export async function resolveProjectRoot(options: {
  explicit?: string;
  filePath?: string;
  listRoots?: () => Promise<string[]>;
}): Promise<ResolvedRoot> {
  if (options.explicit && isDirectory(options.explicit)) {
    return { root: path.resolve(options.explicit), via: "argumento" };
  }

  const fromEnv = process.env.E2E_PROJECT_ROOT;
  if (fromEnv && isDirectory(fromEnv)) {
    return { root: path.resolve(fromEnv), via: "env" };
  }

  if (options.listRoots) {
    try {
      const roots = await options.listRoots();
      const existing = roots.filter((root) => isDirectory(root));
      const containing = options.filePath
        ? existing.find((root) => isInside(root, path.resolve(options.filePath as string)))
        : undefined;
      const chosen = containing ?? existing[0];
      if (chosen) return { root: path.resolve(chosen), via: "cursor" };
    } catch {
      // Cliente sem roots/list. Segue para o arquivo.
    }
  }

  if (options.filePath) {
    const walked = findProjectRoot(path.resolve(options.filePath));
    if (walked) return { root: walked, via: "arquivo" };
  }

  return { via: "nenhuma" };
}

export async function cursorRoots(server: McpServer): Promise<string[]> {
  const listed = await server.server.listRoots();
  return listed.roots.map((root) => fileURLToPath(root.uri));
}

export function readProjectFile(projectRoot: string, filePath: string): string {
  const absolute = resolveInside(projectRoot, filePath);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw new Error(`Arquivo não encontrado dentro do projeto: ${filePath}`);
  }
  const stat = fs.statSync(absolute);
  if (stat.size > 200_000) throw new Error("Arquivo grande demais para ler de uma vez (limite 200 KB).");
  return fs.readFileSync(absolute, "utf8");
}

export function writeProjectFile(projectRoot: string, relativePath: string, contents: string, overwrite = false): string {
  if (contents.length > 200_000) throw new Error("Conteúdo grande demais para gravar (limite 200 KB).");
  const relative = normalizeRelative(relativePath);
  assertWritable(relative);
  const destination = resolveInside(projectRoot, relative);
  if (destination.includes(`${path.sep}node_modules${path.sep}`) || destination.includes(`${path.sep}.git${path.sep}`)) {
    throw new Error("Não gravo arquivo em node_modules ou .git.");
  }
  assertNotBlocked(path.basename(destination));
  if (fs.existsSync(destination) && !overwrite) {
    throw new Error(`Arquivo já existe: ${destination}. Passe overwrite para substituir.`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents.endsWith("\n") ? contents : `${contents}\n`, "utf8");
  return destination;
}

function normalizeRelative(relativePath: string): string {
  const normalized = path.posix.normalize(relativePath.replace(/\\/g, "/")).replace(/^\.\//, "");
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized === ".." || path.posix.isAbsolute(normalized)) {
    throw new Error("Caminho fora da raiz do projeto.");
  }
  return normalized;
}

function assertNotBlocked(fileName: string): void {
  const base = path.posix.basename(fileName.replace(/\\/g, "/"));
  const lower = base.toLowerCase();
  if (lower.startsWith(".env") || BLOCKED_BASENAMES.has(lower)) {
    throw new Error(
      `Recuso gravar \`${base}\`: manifesto, lock, configuração de compilação ou arquivo de segredo não entra na gravação.`,
    );
  }
}

function assertWritable(relative: string): void {
  assertNotBlocked(relative);
  if (!isAllowedRelative(relative)) {
    throw new Error(
      `Caminho fora da lista permitida: \`${relative}\`. Posso gravar teste (*.test.ts, *.spec.ts, test_*.py, *Test.java, *.feature), markdown em docs/qa/, JSON em tests/fixtures/ ou wiremock/, YAML em .github/, deploy/e2e/ ou perf/, script de carga em perf/*.k6.js ou *.k6.ts, e o config novo de SAST ou de regressão visual.`,
    );
  }
}

function isAllowedRelative(normalized: string): boolean {
  const base = path.posix.basename(normalized);
  if (TEST_FILE.test(base) || EXTRA_FILES.has(normalized)) return true;
  if (normalized.startsWith("docs/qa/") && normalized.endsWith(".md")) return true;
  if ((normalized.startsWith("tests/fixtures/") || normalized.startsWith("wiremock/")) && normalized.endsWith(".json")) return true;
  if (isYamlRoot(normalized) && /\.ya?ml$/i.test(base)) return true;
  if (normalized.startsWith("perf/") && /\.k6\.(js|ts)$/i.test(base)) return true;
  return false;
}

function isYamlRoot(normalized: string): boolean {
  return normalized.startsWith(".github/") || normalized.startsWith("deploy/e2e/") || normalized.startsWith("perf/");
}

/** Garante que o alvo fica dentro da raiz, mesmo com `..` no caminho. */
export function resolveInside(projectRoot: string, target: string): string {
  if (!isDirectory(projectRoot)) throw new Error(`Raiz inexistente: ${projectRoot}`);
  const root = fs.realpathSync(path.resolve(projectRoot));
  const absoluteTarget = path.isAbsolute(target) ? path.resolve(target) : path.resolve(root, target);
  const parent = fs.existsSync(absoluteTarget) ? absoluteTarget : path.dirname(absoluteTarget);
  const realParent = fs.existsSync(parent) ? fs.realpathSync(parent) : parent;
  const leaf = path.basename(absoluteTarget);
  const resolved = fs.existsSync(absoluteTarget) ? fs.realpathSync(absoluteTarget) : path.join(realParent, leaf);
  if (!isInside(root, resolved) && resolved !== root) {
    throw new Error("Caminho fora da raiz do projeto.");
  }
  return resolved;
}

function isDirectory(value: string): boolean {
  try {
    return fs.existsSync(value) && fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
