import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TestRunner } from "../lib/runner.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";
import { cursorRoots, readProjectFile, resolveProjectRoot } from "../lib/workspace.js";
import { persistGenerated } from "./execution.js";

export interface LoopFlags {
  projectRoot?: string;
  filePath?: string;
  sourceCode?: string;
  writeToProject?: boolean;
  run?: boolean;
  overwrite?: boolean;
}

export function shouldWrite(flag: boolean | undefined, projectRoot?: string): boolean {
  if (flag === false) return false;
  if (flag === true) return true;
  return Boolean(projectRoot);
}

export function shouldRun(flag: boolean | undefined, eligible: boolean, projectRoot?: string): boolean {
  if (flag === false || !eligible) return false;
  if (flag === true) return true;
  return Boolean(projectRoot);
}

export function isLocalHost(url?: string): boolean {
  if (!url?.trim()) return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return /^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(url.trim());
  }
}

export function slug(value: string): string {
  const cleaned = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return cleaned || "artefato";
}

export async function resolveToolRoot(server: McpServer | undefined, explicit?: string, filePath?: string): Promise<string | undefined> {
  const resolved = await resolveProjectRoot({
    explicit,
    filePath,
    listRoots: server ? () => cursorRoots(server) : undefined,
  });
  return resolved.root;
}

export async function hydrateSource<T extends LoopFlags>(server: McpServer | undefined, input: T): Promise<T | ToolTextResult> {
  const projectRoot = (await resolveToolRoot(server, input.projectRoot, input.filePath)) ?? input.projectRoot;
  const next = { ...input, projectRoot };
  if (next.sourceCode?.trim() || !next.filePath || !projectRoot) return next;
  try {
    return { ...next, sourceCode: readProjectFile(projectRoot, next.filePath) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(message);
  }
}

export async function deliver(options: {
  server?: McpServer;
  input: LoopFlags;
  preface: ToolTextResult;
  relativePath?: string;
  contents?: string;
  runner?: TestRunner;
  /** Quando false, grava e não chama o runner. */
  runEligible?: boolean;
  neverRun?: boolean;
  skipIfExists?: boolean;
  hydrate?: boolean;
  skippedNote?: string;
}): Promise<ToolTextResult> {
  if (options.preface.isError) return options.preface;

  const hydrated = options.hydrate ? await hydrateSource(options.server, options.input) : await attachRoot(options.server, options.input);
  if ("content" in hydrated && hydrated.isError) return hydrated;
  const ready = hydrated as LoopFlags;
  const text = options.preface.content[0]?.text ?? "";
  const hasFile = Boolean(options.relativePath && options.contents !== undefined);
  const write = hasFile && shouldWrite(ready.writeToProject, ready.projectRoot);
  const eligible = Boolean(options.runner) && options.runEligible !== false && !options.neverRun;
  const run = hasFile && shouldRun(ready.run, eligible, ready.projectRoot);
  const note = !run ? options.skippedNote : undefined;
  const preface = [text, note].filter(Boolean).join("\n\n");

  if (!write && !run) return textResult(preface);

  return persistGenerated({
    projectRoot: ready.projectRoot,
    filePath: ready.filePath,
    fileName: options.relativePath?.split(/[/\\]/).pop() ?? "artefato",
    relativePath: options.relativePath,
    code: options.contents ?? "",
    runner: run ? options.runner : undefined,
    write,
    run,
    overwrite: ready.overwrite,
    skipIfExists: options.skipIfExists,
    preface,
  });
}

async function attachRoot<T extends LoopFlags>(server: McpServer | undefined, input: T): Promise<T | ToolTextResult> {
  const projectRoot = (await resolveToolRoot(server, input.projectRoot, input.filePath)) ?? input.projectRoot;
  return { ...input, projectRoot };
}

export function resultText(result: ToolTextResult): string {
  return result.content[0]?.text ?? "";
}
