import fs from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectStack, inferLanguage, stackSummary, type Language } from "../lib/detect.js";
import { codeBlock, doc } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { textResult, type ToolTextResult } from "../lib/result.js";
import { runShape, writeShape, type ProjectContextInput } from "../lib/schema.js";
import { runClosed } from "../lib/runner.js";
import { resolveInside } from "../lib/workspace.js";
import { deliver, resolveToolRoot, resultText, type LoopFlags } from "./loop.js";

export interface MutationReportInput extends ProjectContextInput {
  language?: string;
  currentScore?: number;
}

export function mutationTestingReport(input: MutationReportInput): ToolTextResult {
  const stack = detectStack(input.projectRoot);
  const language = (input.language as Language | undefined) ?? inferLanguage(input.sourceCode, input.filePath);
  const engine = pickEngine(stack, language);
  const score = input.currentScore;

  let interpretation = "Ainda não há score. Rode um módulo pequeno antes da suíte inteira.";
  if (score !== undefined) {
    if (score < 60) interpretation = `${score}% indica suíte que passa sem segurar regressão. Faltam asserts de resultado.`;
    else if (score < 80) interpretation = `${score}% é faixa utilizável. Olhe os mutantes sobreviventes em ramo de negócio, não persiga 100%.`;
    else interpretation = `${score}% é forte. Confira se os mutantes mortos não são equivalentes (mudança que não altera comportamento).`;
  }

  return textResult(
    doc([
      `# Mutation testing — ${engine.name}`,
      "## Stack detectada",
      stackSummary(stack),
      `Motor escolhido para ${language}: **${engine.name}**.`,
      engine.install,
      "## Configuração",
      codeBlock(engine.lang, engine.config),
      "## Como ler o score",
      interpretation,
      "- Mutante morto: algum teste falhou depois da alteração. A suíte viu a mudança.",
      "- Mutante sobrevivente: a suíte continuou verde. Falta assert ou o mutante é equivalente.",
      "- Timeout: o mutante pode ter criado laço. Trate como sinal, não como cobertura ganha.",
      citeKnowledge(["mutation-testing", "unit-testing", "qa-metrics"]),
    ]),
  );
}

function pickEngine(stack: ReturnType<typeof detectStack>, language: Language): {
  name: string;
  lang: string;
  install: string;
  config: string;
} {
  if (stack.mutationTools.includes("pit") || language === "java") {
    return {
      name: "PIT",
      lang: "xml",
      install: "No Maven, o goal `org.pitest:pitest-maven:mutationCoverage` usa os testes JUnit já existentes.",
      config: `<plugin>
  <groupId>org.pitest</groupId>
  <artifactId>pitest-maven</artifactId>
  <version>1.17.0</version>
  <configuration>
    <targetClasses><param>com.example.*</param></targetClasses>
  </configuration>
</plugin>`,
    };
  }
  if (stack.mutationTools.includes("mutmut") || language === "python") {
    return {
      name: "mutmut",
      lang: "toml",
      install: "Instale `mutmut` no mesmo ambiente do pytest. Ele altera o código e reroda a suíte.",
      config: `[tool.mutmut]
paths_to_mutate = "src/"
tests_dir = "tests/"
runner = "python -m pytest -x"`,
    };
  }
  return {
    name: "Stryker",
    lang: "json",
    install: stack.mutationTools.includes("stryker")
      ? "Stryker já está no projeto. Aponte `mutate` para o código de produção, não para o teste."
      : "Para TypeScript, `@stryker-mutator/core` com o runner do Vitest ou do Jest que o projeto já usa.",
    config: `{
  "packageManager": "npm",
  "testRunner": "${stack.unitFrameworks.includes("jest") ? "jest" : "vitest"}",
  "mutate": ["src/**/*.ts", "!src/**/*.test.ts"]
}`,
  };
}

function mutationConfigPath(name: string): string {
  if (name === "PIT") return "pitest-config.xml";
  if (name === "mutmut") return "mutmut.toml";
  return "stryker.config.json";
}

function readTextIfSmall(projectRoot: string, relative: string): string | undefined {
  try {
    const absolute = resolveInside(projectRoot, relative);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return undefined;
    if (fs.statSync(absolute).size > 500_000) return undefined;
    return fs.readFileSync(absolute, "utf8");
  } catch {
    return undefined;
  }
}

function findMutationReport(projectRoot: string): { path: string; text: string } | undefined {
  const named = [
    "reports/mutation/mutation.json",
    "reports/mutation/mutation-report.json",
    "mutation.json",
    "target/pit-reports/mutations.xml",
    "mutants/mutmut-results.json",
  ];
  for (const relative of named) {
    const text = readTextIfSmall(projectRoot, relative);
    if (text) return { path: relative, text };
  }

  const skip = new Set(["node_modules", ".git", "dist", "coverage", "vendor", "venv", ".venv"]);
  const root = path.resolve(projectRoot);
  const stack = [root];
  let seen = 0;
  while (stack.length && seen < 800) {
    seen += 1;
    const current = stack.pop() as string;
    if (path.relative(root, current).split(path.sep).filter(Boolean).length > 5) continue;
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
      if (!entry.isFile()) continue;
      if (!["mutation.json", "mutations.xml", "mutmut-results.json"].includes(entry.name)) continue;
      const relative = path.relative(root, full).split(path.sep).join("/");
      const text = readTextIfSmall(projectRoot, relative);
      if (text) return { path: relative, text };
    }
  }
  return undefined;
}

function interpretMutation(text: string): { score?: number; summary: string } {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const data = JSON.parse(trimmed) as {
      files?: Record<string, { mutants?: Array<{ status?: string }> }>;
      mutants?: Array<{ status?: string }>;
    };
    const mutants = data.mutants ?? Object.values(data.files ?? {}).flatMap((file) => file.mutants ?? []);
    if (!mutants.length) return { summary: "O JSON não trouxe mutantes reconhecíveis." };
    const killed = mutants.filter((item) => /killed|timeout/i.test(item.status ?? "")).length;
    const survived = mutants.filter((item) => /survived|no coverage|not covered/i.test(item.status ?? "")).length;
    const score = Math.round((killed / mutants.length) * 100);
    return { score, summary: `${killed} mortos, ${survived} sobreviventes, ${mutants.length} mutantes.` };
  }
  const detected = [...trimmed.matchAll(/detected=['"]true['"]/gi)].length;
  const missed = [...trimmed.matchAll(/detected=['"]false['"]/gi)].length;
  if (detected + missed > 0) {
    const score = Math.round((detected / (detected + missed)) * 100);
    return { score, summary: `${detected} mortos e ${missed} sobreviventes no PIT.` };
  }
  return { summary: "Achei um arquivo de mutação, mas o formato não é o JSON do Stryker nem o XML do PIT." };
}

export async function handleMutationTestingReport(input: MutationReportInput & LoopFlags, server?: McpServer): Promise<ToolTextResult> {
  const root = await resolveToolRoot(server, input.projectRoot, input.filePath);
  const ready = { ...input, projectRoot: root ?? input.projectRoot };
  const found = ready.projectRoot ? findMutationReport(ready.projectRoot) : undefined;
  let score = ready.currentScore;
  let lead = "";
  if (found) {
    try {
      const interpreted = interpretMutation(found.text);
      if (score === undefined && interpreted.score !== undefined) score = interpreted.score;
      lead = `Li \`${found.path}\`. ${interpreted.summary}`;
    } catch {
      lead = `Li \`${found.path}\`, mas não consegui interpretar o conteúdo.`;
    }
  }
  const result = mutationTestingReport({ ...ready, currentScore: score });
  const text = [lead, result.content[0]?.text ?? ""].filter(Boolean).join("\n\n");
  if (result.isError) return textResult(text);
  const stack = detectStack(ready.projectRoot);
  const language = (ready.language as Language | undefined) ?? inferLanguage(ready.sourceCode, ready.filePath);
  const engine = pickEngine(stack, language);
  const hasStryker = Boolean(
    ready.projectRoot && fs.existsSync(path.join(ready.projectRoot, "node_modules", "@stryker-mutator", "core", "package.json")),
  );
  const delivered = found
    ? textResult(text)
    : await deliver({
        server,
        input: ready,
        preface: textResult(text),
        relativePath: mutationConfigPath(engine.name),
        contents: engine.config,
        skipIfExists: true,
      });
  if (delivered.isError) return delivered;
  if (ready.run === false || !hasStryker || !ready.projectRoot) {
    const why =
      ready.run === false
        ? "Não foi executado."
        : "Não foi executado. @stryker-mutator/core não está em node_modules.";
    return textResult([resultText(delivered), why].join("\n\n"));
  }
  const scan = await runClosed(ready.projectRoot, "stryker", ready.filePath);
  return textResult([resultText(delivered), scan].join("\n\n"));
}

export function registerMutationTools(server: McpServer): void {
  registerTool(
    server,
    "mutation_testing_report",
    "Relatório de mutation testing",
    "Mutação lê relatório do disco e executa o Stryker local quando `@stryker-mutator/core` está em node_modules; sem o pacote, grava o config e não executa.",
    {
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
      language: z.string().optional(),
      currentScore: z.number().min(0).max(100).optional().describe("Score atual, se já houver uma execução."),
      ...writeShape,
      ...runShape,
    },
    (args) => handleMutationTestingReport(args as unknown as MutationReportInput & LoopFlags, server),
    { readOnly: false },
  );
}
