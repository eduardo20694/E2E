import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectStack, stackSummary } from "../lib/detect.js";
import { doc, markdownTable } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { analyzeFlakiness } from "../lib/flakiness.js";
import { registerTool } from "../lib/register-tool.js";
import { loadReport, parseAllureResult, parseJunit, type ParsedReport } from "../lib/report.js";
import { executeTests, type TestRunner } from "../lib/runner.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";
import { scanPyramid } from "../lib/pyramid.js";
import {
  cursorRoots,
  readProjectFile,
  resolveProjectRoot,
  writeProjectFile,
} from "../lib/workspace.js";

async function rootOrError(
  server: McpServer,
  projectRoot?: string,
  filePath?: string,
): Promise<{ root: string; via: string } | ToolTextResult> {
  const resolved = await resolveProjectRoot({
    explicit: projectRoot,
    filePath,
    listRoots: () => cursorRoots(server),
  });
  if (!resolved.root) {
    return errorResult(
      "Não achei a raiz do projeto. Abra a pasta no Cursor, passe projectRoot, ou defina E2E_PROJECT_ROOT.",
    );
  }
  return { root: resolved.root, via: resolved.via };
}

export async function readWorkspace(
  server: McpServer,
  input: { projectRoot?: string; filePath?: string },
): Promise<ToolTextResult> {
  const resolved = await rootOrError(server, input.projectRoot, input.filePath);
  if ("content" in resolved) return resolved;

  const stack = detectStack(resolved.root);
  let source = "";
  if (input.filePath) {
    source = readProjectFile(resolved.root, input.filePath);
  }
  let pyramid = "";
  try {
    const counts = scanPyramid(resolved.root);
    pyramid = `Testes no disco: ${counts.unit} unitários, ${counts.integration} de integração, ${counts.e2e} E2E.`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pyramid = `Não contei a pirâmide: ${message}`;
  }

  return textResult(
    doc([
      "# Workspace",
      `Raiz: \`${resolved.root}\` (via ${resolved.via}).`,
      pyramid,
      "## Stack detectada",
      stackSummary(stack),
      source
        ? `## Arquivo\n\`${input.filePath}\`\n\n\`\`\`\n${source.slice(0, 12_000)}\n\`\`\``
        : "Nenhum filePath. A raiz já serve para detectar stack e gravar teste.",
      citeKnowledge(["test-environments"]),
    ]),
  );
}

export function writeTestFile(input: {
  projectRoot: string;
  relativePath: string;
  contents: string;
  overwrite?: boolean;
}): ToolTextResult {
  try {
    const destination = writeProjectFile(input.projectRoot, input.relativePath, input.contents, input.overwrite);
    return textResult(`Arquivo gravado em \`${destination}\`.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(message);
  }
}

export async function runProjectTests(input: {
  projectRoot: string;
  runner: TestRunner;
  testPath?: string;
}): Promise<ToolTextResult> {
  try {
    const report = await executeTests(input);
    const tail = report.output.trim().split(/\r?\n/).slice(-40).join("\n");
    return textResult(
      doc([
        `# Execução — ${input.runner}`,
        report.timedOut
          ? "Estourou o tempo limite de 2 minutos. O processo foi encerrado."
          : report.passed
            ? "Passou. Exit code 0."
            : `Falhou. Exit code ${report.exitCode ?? "nenhum"}.`,
        tail ? `## Saída\n\`\`\`\n${tail}\n\`\`\`` : "Sem saída.",
      ]),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(message);
  }
}

export async function persistGenerated(input: {
  projectRoot?: string;
  filePath?: string;
  fileName: string;
  code: string;
  folder?: string;
  runner?: TestRunner;
  write?: boolean;
  run?: boolean;
  preface: string;
}): Promise<ToolTextResult> {
  const parts = [input.preface];
  let written: string | undefined;

  if (input.write) {
    if (!input.projectRoot) return errorResult("writeToProject precisa da raiz. Passe projectRoot ou abra a pasta no Cursor.");
    const relative = input.folder
      ? path.join(input.folder, input.fileName)
      : beside(input.projectRoot, input.filePath, input.fileName);
    try {
      written = writeProjectFile(input.projectRoot, relative, input.code);
      parts.push(`## Gravado\n\`${written}\``);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResult(message);
    }
  }

  if (input.run) {
    if (!input.projectRoot) return errorResult("run precisa da raiz do projeto.");
    if (!input.runner) {
      parts.push("## Execução\nEste framework não entra na execução automática. Cobertos: Vitest, Jest, pytest e Playwright.");
    } else {
      const ran = await runProjectTests({
        projectRoot: input.projectRoot,
        runner: input.runner,
        testPath: written,
      });
      parts.push(ran.content[0]?.text ?? "");
      if (ran.isError) return errorResult(parts.filter(Boolean).join("\n\n"));
    }
  }

  return textResult(parts.filter(Boolean).join("\n\n"));
}

function beside(projectRoot: string, filePath: string | undefined, fileName: string): string {
  if (!filePath) return fileName;
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(projectRoot, filePath);
  const relativeDir = path.relative(path.resolve(projectRoot), path.dirname(absolute));
  if (relativeDir.startsWith("..") || path.isAbsolute(relativeDir)) return fileName;
  return relativeDir ? path.join(relativeDir, fileName) : fileName;
}

export function diagnoseTestReport(input: { report?: string; reportPath?: string; projectRoot?: string }): ToolTextResult {
  if (!input.report?.trim() && !input.reportPath?.trim()) {
    return errorResult("diagnose_test_report exige report (XML ou JSON) ou reportPath.");
  }

  let parsed: ParsedReport;
  try {
    if (input.report?.trim()) {
      const text = input.report.trim();
      parsed = text.startsWith("<") ? parseJunit(text) : { format: "allure", cases: [parseAllureResult(text)] };
    } else {
      parsed = loadReport(input.reportPath as string, input.projectRoot);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Não li o relatório: ${message}`);
  }

  const failed = parsed.cases.filter((item) => item.status === "failed");
  const passed = parsed.cases.filter((item) => item.status === "passed").length;
  const logs = failed.map((item) => `${item.name}: ${item.message ?? ""}`).join("\n");
  const signals = logs ? analyzeFlakiness(logs) : [];

  return textResult(
    doc([
      `# Relatório ${parsed.format}`,
      `${parsed.cases.length} casos. ${passed} passaram. ${failed.length} falharam.`,
      failed.length
        ? markdownTable(
            ["Caso", "Mensagem"],
            failed.slice(0, 15).map((item) => [item.name.replace(/\|/g, "/"), (item.message ?? "").replace(/\|/g, "/").slice(0, 180)]),
          )
        : "Nenhuma falha no relatório.",
      signals.length ? signals.map((signal) => `- **${signal.title}.** ${signal.advice}`).join("\n") : undefined,
      citeKnowledge(["qa-metrics"]),
    ]),
  );
}

export function registerExecutionTools(server: McpServer): void {
  registerTool(
    server,
    "read_workspace",
    "Ler workspace",
    "Descobre a raiz pelo Cursor, por E2E_PROJECT_ROOT ou pelo arquivo, e lê o código do disco quando filePath vem sem o conteúdo.",
    {
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
    },
    (args) => readWorkspace(server, args as { projectRoot?: string; filePath?: string }),
  );

  registerTool(
    server,
    "write_test_file",
    "Gravar arquivo de teste",
    "Grava um arquivo de teste dentro da raiz do projeto. Recusa caminho fora da raiz e não sobrescreve sem overwrite.",
    {
      projectRoot: z.string(),
      relativePath: z.string(),
      contents: z.string(),
      overwrite: z.boolean().optional(),
    },
    (args) => writeTestFile(args as { projectRoot: string; relativePath: string; contents: string; overwrite?: boolean }),
    { readOnly: false },
  );

  registerTool(
    server,
    "run_project_tests",
    "Executar testes",
    "Roda Vitest, Jest, Playwright ou pytest já instalados no projeto e devolve pass ou fail. Não aceita comando livre.",
    {
      projectRoot: z.string(),
      runner: z.enum(["vitest", "jest", "playwright", "pytest"]),
      testPath: z.string().optional().describe("Arquivo ou pasta dentro da raiz."),
    },
    (args) => runProjectTests(args as { projectRoot: string; runner: TestRunner; testPath?: string }),
    { readOnly: false },
  );

  registerTool(
    server,
    "diagnose_test_report",
    "Diagnosticar relatório",
    "Lê JUnit XML ou resultado Allure do disco, ou o XML colado, e aponta as falhas reais.",
    {
      report: z.string().optional().describe("XML JUnit ou JSON Allure."),
      reportPath: z.string().optional().describe("Arquivo ou pasta do relatório, dentro do projeto se projectRoot vier."),
      projectRoot: z.string().optional(),
    },
    (args) => diagnoseTestReport(args as { report?: string; reportPath?: string; projectRoot?: string }),
  );
}
