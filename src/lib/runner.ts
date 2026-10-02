import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveInside } from "./workspace.js";

export type TestRunner = "vitest" | "jest" | "playwright" | "pytest";

/** Comandos com binário e argumentos fixos. Nada aqui aceita texto livre do usuário. */
export type ClosedCommandName =
  | "eslint"
  | "bandit"
  | "gosec"
  | "npm-audit"
  | "pip-audit"
  | "k6"
  | "stryker"
  | "cucumber";

export interface RunnerCommand {
  command: string;
  args: string[];
}

export interface RunReport {
  runner: TestRunner;
  exitCode: number | null;
  passed: boolean;
  output: string;
  timedOut: boolean;
}

export interface CommandReport {
  exitCode: number | null;
  passed: boolean;
  output: string;
  timedOut: boolean;
  spawnError: boolean;
}

export interface ClosedPlan {
  name: ClosedCommandName;
  label: string;
  available: boolean;
  command?: RunnerCommand;
  message: string;
}

const MAX_TIMEOUT_MS = 120_000;

export function buildRunnerCommand(projectRoot: string, runner: TestRunner, testPath?: string): RunnerCommand {
  const relative = testPath ? safeRelative(projectRoot, testPath) : undefined;
  if (runner === "pytest") {
    return { command: process.platform === "win32" ? "python" : "python3", args: ["-m", "pytest", "-q", ...(relative ? [relative] : [])] };
  }

  const bin = runnerBinary(projectRoot, runner);
  const args =
    runner === "playwright"
      ? [bin, "test", ...(relative ? [relative] : [])]
      : [bin, "run", ...(relative ? [relative] : [])];
  if (runner === "jest") {
    return { command: process.execPath, args: [bin, "--watchAll=false", ...(relative ? [relative] : [])] };
  }
  return { command: process.execPath, args };
}

export function runnerInstalled(projectRoot: string, runner: TestRunner): boolean {
  if (runner === "pytest") {
    return Boolean(commandOnPath(process.platform === "win32" ? "python" : "python3"));
  }
  try {
    runnerBinary(projectRoot, runner);
    return true;
  } catch {
    return false;
  }
}

export function appiumInstalled(projectRoot: string): boolean {
  return fs.existsSync(path.join(projectRoot, "node_modules", "appium", "package.json"));
}

export async function prepareClosedCommand(
  projectRoot: string,
  name: ClosedCommandName,
  filePath?: string,
): Promise<ClosedPlan> {
  if (name === "eslint") return eslintPlan(projectRoot);
  if (name === "bandit") return banditPlan();
  if (name === "gosec") return gosecPlan();
  if (name === "npm-audit") return npmAuditPlan(projectRoot);
  if (name === "pip-audit") return pipAuditPlan();
  if (name === "k6") return k6Plan(projectRoot);
  if (name === "stryker") return strykerPlan(projectRoot, filePath);
  return cucumberPlan(projectRoot, filePath);
}

export async function executeClosed(options: {
  projectRoot: string;
  command: RunnerCommand;
  timeoutMs?: number;
}): Promise<CommandReport> {
  return spawnCaptured(options.command.command, options.command.args, path.resolve(options.projectRoot), options.timeoutMs);
}

export async function runClosed(projectRoot: string, name: ClosedCommandName, filePath?: string): Promise<string> {
  try {
    const plan = await prepareClosedCommand(projectRoot, name, filePath);
    if (!plan.available || !plan.command) return plan.message;
    const report = await executeClosed({ projectRoot, command: plan.command });
    return formatClosedReport(plan.label, report);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `O comando não rodou: ${message}`;
  }
}

export function formatClosedReport(label: string, report: CommandReport): string {
  const tail = report.output.trim().split(/\r?\n/).slice(-40).join("\n");
  let status: string;
  if (report.timedOut) status = "Estourou o tempo de 120s. O processo foi encerrado.";
  else if (report.spawnError) status = "O processo não chegou a rodar.";
  else if (/No module named ['"]?bandit['"]?/i.test(report.output)) status = "O módulo bandit não está instalado.";
  else if (/No module named ['"]?pip_audit['"]?/i.test(report.output)) status = "pip-audit não está instalado.";
  else if (report.passed) status = "Concluiu. Exit code 0.";
  else status = `Falhou. Exit code ${report.exitCode ?? "nenhum"}.`;
  return [`## ${label}`, status, tail ? `## Saída\n\`\`\`\n${tail}\n\`\`\`` : "Sem saída."].join("\n\n");
}

export async function executeTests(options: {
  projectRoot: string;
  runner: TestRunner;
  testPath?: string;
  timeoutMs?: number;
}): Promise<RunReport> {
  const command = buildRunnerCommand(options.projectRoot, options.runner, options.testPath);
  const report = await spawnCaptured(command.command, command.args, path.resolve(options.projectRoot), options.timeoutMs);
  if (report.spawnError) throw new Error(report.output || "Falha ao iniciar o processo.");
  return {
    runner: options.runner,
    exitCode: report.exitCode,
    passed: report.passed,
    output: report.output,
    timedOut: report.timedOut,
  };
}

function eslintPlan(projectRoot: string): ClosedPlan {
  const label = "ESLint";
  const relativeBin = path.join("node_modules", "eslint", "bin", "eslint.js");
  const folder = path.join(projectRoot, "node_modules", "eslint");
  if (!fs.existsSync(folder)) {
    return {
      name: "eslint",
      label,
      available: false,
      message: "O binário não está instalado: não há `node_modules/eslint`. O config foi gravado e o scanner não rodou.",
    };
  }
  let bin: string;
  try {
    bin = resolveInside(projectRoot, relativeBin);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { name: "eslint", label, available: false, message };
  }
  if (!fs.existsSync(bin)) {
    return {
      name: "eslint",
      label,
      available: false,
      message: "O binário não está instalado: não há `node_modules/eslint/bin/eslint.js`. O config foi gravado e o scanner não rodou.",
    };
  }
  return {
    name: "eslint",
    label,
    available: true,
    command: { command: process.execPath, args: [bin, ".", "--max-warnings", "0"] },
    message: "",
  };
}

function banditPlan(): ClosedPlan {
  const label = "Bandit";
  const pythonName = process.platform === "win32" ? "python" : "python3";
  const python = commandOnPath(pythonName);
  if (!python) {
    return {
      name: "bandit",
      label,
      available: false,
      message: `O binário ${pythonName} não está no PATH. O config foi gravado e o scanner não rodou.`,
    };
  }
  return {
    name: "bandit",
    label,
    available: true,
    command: { command: python, args: ["-m", "bandit", "-r", ".", "-f", "txt"] },
    message: "",
  };
}

function gosecPlan(): ClosedPlan {
  const label = "gosec";
  const bin = commandOnPath("gosec");
  if (!bin) {
    return {
      name: "gosec",
      label,
      available: false,
      message: "O binário gosec não está no PATH. O config foi gravado e o scanner não rodou.",
    };
  }
  return {
    name: "gosec",
    label,
    available: true,
    command: { command: bin, args: ["./..."] },
    message: "",
  };
}

function npmAuditPlan(projectRoot: string): ClosedPlan {
  const label = "Resumo npm audit";
  if (!fs.existsSync(path.join(projectRoot, "package.json"))) {
    return {
      name: "npm-audit",
      label,
      available: false,
      message: "Não há package.json. O npm audit não rodou.",
    };
  }
  const npmName = process.platform === "win32" ? "npm.cmd" : "npm";
  const npm = commandOnPath(npmName);
  if (!npm) {
    return {
      name: "npm-audit",
      label,
      available: false,
      message: "O binário npm não está no PATH. O arquivo foi gravado e o audit não rodou.",
    };
  }
  return {
    name: "npm-audit",
    label,
    available: true,
    command: { command: npm, args: ["audit", "--audit-level=high"] },
    message: "",
  };
}

async function pipAuditPlan(): Promise<ClosedPlan> {
  const label = "Resumo pip-audit";
  const pythonName = process.platform === "win32" ? "python" : "python3";
  const python = commandOnPath(pythonName);
  if (!python) {
    return { name: "pip-audit", label, available: false, message: "pip-audit não está instalado." };
  }
  const check = await spawnCaptured(python, ["-c", "import pip_audit"], process.cwd(), 20_000);
  if (check.timedOut || check.spawnError || check.exitCode !== 0) {
    return { name: "pip-audit", label, available: false, message: "pip-audit não está instalado." };
  }
  return {
    name: "pip-audit",
    label,
    available: true,
    command: { command: python, args: ["-m", "pip_audit"] },
    message: "",
  };
}

function k6Plan(projectRoot: string): ClosedPlan {
  const label = "k6";
  const bin = commandOnPath("k6");
  if (!bin) {
    return {
      name: "k6",
      label,
      available: false,
      message: "O binário k6 não está no PATH. O script foi gravado e não executado.",
    };
  }
  let script: string;
  try {
    script = safeRelative(projectRoot, "perf/carga.k6.js");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { name: "k6", label, available: false, message };
  }
  if (script !== "perf/carga.k6.js") {
    return {
      name: "k6",
      label,
      available: false,
      message: "O comando de carga só aceita perf/carga.k6.js. Não foi executado.",
    };
  }
  return {
    name: "k6",
    label,
    available: true,
    command: { command: bin, args: ["run", script] },
    message: "",
  };
}

function strykerPlan(projectRoot: string, filePath?: string): ClosedPlan {
  const label = "Stryker";
  const bin = packageBin(
    projectRoot,
    ["@stryker-mutator", "core"],
    ["bin/stryker.js", "dist/src/stryker-cli.js", "dist/src/cli.js"],
  );
  if (!bin) {
    return {
      name: "stryker",
      label,
      available: false,
      message: "Não foi executado. @stryker-mutator/core não está em node_modules.",
    };
  }
  const args = [bin, "run"];
  if (filePath) {
    try {
      args.push("--mutate", safeRelative(projectRoot, filePath));
    } catch {
      return {
        name: "stryker",
        label,
        available: false,
        message: "O filePath ficou fora da raiz. A mutação não rodou.",
      };
    }
  }
  return {
    name: "stryker",
    label,
    available: true,
    command: { command: process.execPath, args },
    message: "",
  };
}

function cucumberPlan(projectRoot: string, filePath?: string): ClosedPlan {
  const label = "cucumber";
  const bin =
    packageBin(projectRoot, ["@cucumber", "cucumber"], ["bin/cucumber.js", "bin/cucumber-js"]) ??
    packageBin(projectRoot, ["cucumber"], ["bin/cucumber.js"]);
  if (!bin) {
    return {
      name: "cucumber",
      label,
      available: false,
      message: "Não foi executado. Não há runner: cucumber não está instalado em node_modules.",
    };
  }
  if (!filePath) {
    return {
      name: "cucumber",
      label,
      available: false,
      message: "Não foi executado. Não há arquivo .feature para o cucumber.",
    };
  }
  let relative: string;
  try {
    relative = safeRelative(projectRoot, filePath);
  } catch {
    return {
      name: "cucumber",
      label,
      available: false,
      message: "Não foi executado. O .feature ficou fora da raiz.",
    };
  }
  if (!relative.endsWith(".feature")) {
    return {
      name: "cucumber",
      label,
      available: false,
      message: "Não foi executado. O cucumber só recebe arquivo .feature dentro da raiz.",
    };
  }
  return {
    name: "cucumber",
    label,
    available: true,
    command: { command: process.execPath, args: [bin, relative] },
    message: "",
  };
}

function packageBin(projectRoot: string, packageDir: string[], fallbacks: string[]): string | undefined {
  const base = path.join(projectRoot, "node_modules", ...packageDir);
  if (!fs.existsSync(base)) return undefined;
  const candidates: string[] = [];
  const pkgJson = path.join(base, "package.json");
  if (fs.existsSync(pkgJson)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJson, "utf8")) as { bin?: string | Record<string, string> };
      if (typeof pkg.bin === "string") candidates.push(pkg.bin);
      else if (pkg.bin && typeof pkg.bin === "object") {
        for (const value of Object.values(pkg.bin)) {
          if (typeof value === "string") candidates.push(value);
        }
      }
    } catch {
      // O binário fixo abaixo ainda pode existir.
    }
  }
  candidates.push(...fallbacks);
  for (const rel of candidates) {
    if (!rel || rel.includes("..") || path.isAbsolute(rel)) continue;
    try {
      const absolute = resolveInside(projectRoot, path.join("node_modules", ...packageDir, rel));
      const relativeToPkg = path.relative(base, absolute);
      if (relativeToPkg.startsWith("..") || path.isAbsolute(relativeToPkg)) continue;
      if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) return absolute;
    } catch {
      continue;
    }
  }
  return undefined;
}

function commandOnPath(name: string): string | undefined {
  const pathEnv = process.env.PATH ?? process.env.Path ?? "";
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  const hasExt = path.extname(name) !== "";
  const exts =
    process.platform === "win32" && !hasExt
      ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
      : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, hasExt ? name : `${name}${ext}`);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      } catch {
        continue;
      }
    }
  }
  return undefined;
}

function spawnCaptured(command: string, args: string[], cwd: string, timeoutMs?: number): Promise<CommandReport> {
  const limit = clampTimeout(timeoutMs);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        shell: false,
        env: process.env,
        windowsHide: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      resolve({ exitCode: null, passed: false, output: message, timedOut: false, spawnError: true });
      return;
    }

    let output = "";
    const append = (chunk: Buffer) => {
      output = `${output}${chunk.toString("utf8")}`.slice(-100_000);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, limit);

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        exitCode: null,
        passed: false,
        output: error.message,
        timedOut: false,
        spawnError: true,
      });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        passed: exitCode === 0 && !timedOut,
        output,
        timedOut,
        spawnError: false,
      });
    });
  });
}

function clampTimeout(timeoutMs?: number): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return MAX_TIMEOUT_MS;
  return Math.min(timeoutMs, MAX_TIMEOUT_MS);
}

function runnerBinary(projectRoot: string, runner: TestRunner): string {
  const candidates =
    runner === "vitest"
      ? [path.join(projectRoot, "node_modules", "vitest", "vitest.mjs")]
      : runner === "jest"
        ? [path.join(projectRoot, "node_modules", "jest", "bin", "jest.js")]
        : [path.join(projectRoot, "node_modules", "@playwright", "test", "cli.js")];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`${runner} não está instalado em ${projectRoot}.`);
  return found;
}

function safeRelative(projectRoot: string, testPath: string): string {
  const absolute = resolveInside(projectRoot, testPath);
  const relative = path.relative(path.resolve(projectRoot), absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Caminho fora da raiz do projeto.");
  }
  return relative.split(path.sep).join("/");
}
