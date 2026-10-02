import fs from "node:fs";
import path from "node:path";
import { resolveInside } from "./workspace.js";

export interface ReportedCase {
  name: string;
  status: "passed" | "failed" | "skipped";
  message?: string;
}

export interface ParsedReport {
  format: "junit" | "allure";
  cases: ReportedCase[];
}

export function parseJunit(xml: string): ParsedReport {
  const cases: ReportedCase[] = [];
  const pattern = /<testcase\b([^>]*?)\/>|<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/g;
  for (const match of xml.matchAll(pattern)) {
    const attrs = match[1] ?? match[2] ?? "";
    const body = match[3] ?? "";
    const name = attr(attrs, "name") ?? "caso";
    const classname = attr(attrs, "classname");
    const failure = body.match(/<failure\b([^>]*)>([\s\S]*?)<\/failure>/);
    const error = body.match(/<error\b([^>]*)>([\s\S]*?)<\/error>/);
    const skipped = /<skipped\b/.test(body);
    const problem = failure ?? error;
    cases.push({
      name: classname ? `${classname} ${name}` : name,
      status: problem ? "failed" : skipped ? "skipped" : "passed",
      message: problem ? decode(attr(problem[1], "message") ?? problem[2].trim().slice(0, 500)) : undefined,
    });
  }
  if (cases.length === 0 && !xml.includes("<testsuite") && !xml.includes("<testsuites")) {
    throw new Error("XML sem testsuite JUnit.");
  }
  return { format: "junit", cases };
}

export function parseAllureResult(json: string): ReportedCase {
  const data = JSON.parse(json) as { name?: string; status?: string; statusDetails?: { message?: string } };
  const status = data.status === "failed" || data.status === "broken" ? "failed" : data.status === "skipped" ? "skipped" : "passed";
  return {
    name: data.name ?? "caso",
    status,
    message: data.statusDetails?.message?.slice(0, 500),
  };
}

const EVIDENCE_LIMIT = 100_000;

export function readFirstExisting(projectRoot: string, relatives: string[]): { path: string; text: string } | undefined {
  for (const relative of relatives) {
    const absolute = resolveInside(projectRoot, relative);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
    const stat = fs.statSync(absolute);
    if (stat.size > 500_000) continue;
    return { path: relative, text: fs.readFileSync(absolute, "utf8").slice(0, EVIDENCE_LIMIT) };
  }
  return undefined;
}

/** JUnit, Allure ou um log pequeno já gerado na raiz. */
export function readSuiteEvidence(projectRoot: string): { path: string; text: string } | undefined {
  const direct = readFirstExisting(projectRoot, ["junit.xml", "test-results/junit.xml"]);
  if (direct) return direct;

  for (const folder of ["test-results", "allure-results"]) {
    const absolute = resolveInside(projectRoot, folder);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) continue;
    const chunks: string[] = [];
    for (const file of fs.readdirSync(absolute).slice(0, 40)) {
      if (!file.endsWith(".xml") && !file.endsWith("-result.json") && !file.endsWith(".json")) continue;
      const full = path.join(absolute, file);
      if (!fs.statSync(full).isFile() || fs.statSync(full).size > EVIDENCE_LIMIT) continue;
      chunks.push(fs.readFileSync(full, "utf8"));
      if (chunks.join("\n").length > EVIDENCE_LIMIT) break;
    }
    if (chunks.length) return { path: folder, text: chunks.join("\n").slice(0, EVIDENCE_LIMIT) };
  }

  const log = findSmallLog(projectRoot);
  return log;
}

function findSmallLog(projectRoot: string): { path: string; text: string } | undefined {
  const root = path.resolve(projectRoot);
  const skip = new Set(["node_modules", ".git", "dist", "coverage", "vendor", "venv", ".venv", "target", "build"]);
  const stack = [root];
  let depthGuard = 0;
  while (stack.length && depthGuard < 800) {
    depthGuard += 1;
    const current = stack.pop() as string;
    const depth = path.relative(root, current).split(path.sep).filter(Boolean).length;
    if (depth > 4) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (skip.has(entry.name) || entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      if (!entry.isFile() || !entry.name.endsWith(".log")) continue;
      const stat = fs.statSync(full);
      if (stat.size === 0 || stat.size > EVIDENCE_LIMIT) continue;
      return { path: path.relative(root, full).split(path.sep).join("/"), text: fs.readFileSync(full, "utf8") };
    }
  }
  return undefined;
}

export function loadReport(reportPath: string, projectRoot?: string): ParsedReport {
  const absolute = projectRoot ? resolveInside(projectRoot, reportPath) : path.resolve(reportPath);
  if (!fs.existsSync(absolute)) throw new Error(`Relatório não encontrado: ${absolute}`);
  const stat = fs.statSync(absolute);
  if (stat.isDirectory()) {
    const cases: ReportedCase[] = [];
    for (const file of fs.readdirSync(absolute).slice(0, 200)) {
      const full = path.join(absolute, file);
      if (file.endsWith("-result.json")) cases.push(parseAllureResult(fs.readFileSync(full, "utf8")));
      if (file.endsWith(".xml")) cases.push(...parseJunit(fs.readFileSync(full, "utf8")).cases);
    }
    return { format: cases.some(() => true) && absolute.includes("allure") ? "allure" : "junit", cases };
  }
  const text = fs.readFileSync(absolute, "utf8");
  if (absolute.endsWith(".json")) return { format: "allure", cases: [parseAllureResult(text)] };
  return parseJunit(text);
}

function attr(source: string, name: string): string | undefined {
  const match = source.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return match ? decode(match[1]) : undefined;
}

function decode(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}
