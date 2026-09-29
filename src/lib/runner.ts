import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveInside } from "./workspace.js";

export type TestRunner = "vitest" | "jest" | "playwright" | "pytest";

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

export async function executeTests(options: {
  projectRoot: string;
  runner: TestRunner;
  testPath?: string;
  timeoutMs?: number;
}): Promise<RunReport> {
  const command = buildRunnerCommand(options.projectRoot, options.runner, options.testPath);
  const timeoutMs = Math.min(options.timeoutMs ?? 120_000, 300_000);
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command.command, command.args, {
        cwd: path.resolve(options.projectRoot),
        shell: false,
        env: process.env,
      });
    } catch (error) {
      reject(error);
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
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        runner: options.runner,
        exitCode,
        passed: exitCode === 0 && !timedOut,
        output,
        timedOut,
      });
    });
  });
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
  return path.relative(path.resolve(projectRoot), absolute);
}
