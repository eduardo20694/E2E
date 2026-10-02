import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectStack, stackSummary } from "../lib/detect.js";
import { codeBlock, doc } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";
import { runShape, writeShape, type ProjectContextInput } from "../lib/schema.js";
import { deliver, hydrateSource, type LoopFlags } from "./loop.js";
import type { TestRunner } from "../lib/runner.js";

export interface SnapshotInput extends ProjectContextInput {
  component: string;
  output?: string;
}

export function generateSnapshotTest(input: SnapshotInput): ToolTextResult {
  if (!input.component?.trim()) {
    return errorResult("generate_snapshot_test exige component ou o nome da saída.");
  }

  const stack = detectStack(input.projectRoot);
  const runner = stack.unitFrameworks.includes("jest") ? "jest" : "vitest";

  return textResult(
    doc([
      `# Snapshot — ${runner}`,
      `Alvo: \`${input.component}\`. Camada mockada: renderiza em jsdom ou compara string, sem browser de produção.`,
      "## Stack detectada",
      stackSummary(stack),
      codeBlock("ts", snapshotSource(input.component, runner)),
      input.output ? `Saída informada para a primeira baseline:\n\n${input.output.slice(0, 500)}` : undefined,
      "Snapshot de árvore inteira quebra a cada classe CSS. Prefira um contrato pequeno: texto visível, papel acessível ou JSON estável. Atualizar o snapshot sem ler o diff apaga o teste.",
      citeKnowledge(["snapshot-testing"]),
    ]),
  );
}

export interface GoldenInput extends ProjectContextInput {
  sourceCode: string;
  entrypoint?: string;
}

export function generateGoldenMasterTest(input: GoldenInput): ToolTextResult {
  if (!input.sourceCode?.trim()) {
    return errorResult("generate_golden_master_test exige sourceCode do legado.");
  }

  const entry = input.entrypoint ?? "run";
  return textResult(
    doc([
      "# Golden master",
      `Antes de refatorar \`${entry}\`, grave o comportamento atual. O teste não diz se está certo. Diz se a refatoração mudou a saída.`,
      codeBlock("ts", goldenSource(entry)),
      "Congele relógio, semente e ordem de mapa. Saída com data de agora nunca estabiliza. Quando a mudança de comportamento for intencional, aprove o golden num commit separado do refactor.",
      input.filePath ? `Arquivo: \`${input.filePath}\`.` : undefined,
      citeKnowledge(["golden-master-testing", "unit-testing"]),
    ]),
  );
}

function snapshotSource(component: string, runner: "jest" | "vitest"): string {
  return `import { describe, it, expect } from "${runner === "jest" ? "@jest/globals" : "vitest"}";

it("a saída de ${component} permanece a combinada", () => {
  const output = render${pascal(component)}();
  expect(output).toMatchSnapshot();
});`;
}

function goldenSource(entry: string): string {
  return `import { readFileSync, writeFileSync, existsSync } from "node:fs";

const baseline = "golden/${entry}.json";
const inputs = ["", "a", "0", "caso-conhecido"];

it("a saída do legado permanece até a refatoração ser aprovada", () => {
  const actual = inputs.map((input) => ({ input, output: String(${entry}(input)) }));
  if (!existsSync(baseline)) {
    writeFileSync(baseline, JSON.stringify(actual, null, 2));
    return;
  }
  expect(actual).toEqual(JSON.parse(readFileSync(baseline, "utf8")));
});`;
}

export async function handleGenerateSnapshotTest(input: SnapshotInput & LoopFlags, server?: McpServer): Promise<ToolTextResult> {
  const hydrated = await hydrateSource(server, input);
  if ("isError" in hydrated && hydrated.isError) return hydrated;
  const ready = hydrated as SnapshotInput & LoopFlags;
  const result = generateSnapshotTest(ready);
  if (result.isError) return result;
  const stack = detectStack(ready.projectRoot);
  const runnerName = stack.unitFrameworks.includes("jest") ? "jest" : "vitest";
  const runner: TestRunner = runnerName;
  return deliver({
    server,
    input: ready,
    preface: result,
    relativePath: "snapshot.test.ts",
    contents: snapshotSource(ready.component, runnerName),
    runner,
  });
}

export async function handleGenerateGoldenMasterTest(input: GoldenInput & LoopFlags, server?: McpServer): Promise<ToolTextResult> {
  const hydrated = await hydrateSource(server, input);
  if ("isError" in hydrated && hydrated.isError) return hydrated;
  const ready = hydrated as GoldenInput & LoopFlags;
  const result = generateGoldenMasterTest(ready);
  if (result.isError) return result;
  return deliver({
    server,
    input: ready,
    preface: result,
    relativePath: "golden-master.test.ts",
    contents: goldenSource(ready.entrypoint ?? "run"),
    runner: "vitest",
  });
}

function pascal(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("") || "Subject";
}

export function registerSnapshotTools(server: McpServer): void {
  registerTool(
    server,
    "generate_snapshot_test",
    "Teste de snapshot",
    "Snapshot grava e executa no runner local `snapshot.test.ts` para uma saída, sem fotografar a árvore inteira.",
    {
      component: z.string(),
      output: z.string().optional(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
      ...writeShape,
      ...runShape,
    },
    (args) => handleGenerateSnapshotTest(args as unknown as SnapshotInput & LoopFlags, server),
    { readOnly: false },
  );

  registerTool(
    server,
    "generate_golden_master_test",
    "Golden master",
    "Caracterização grava e executa no runner local `golden-master.test.ts` com a saída atual do legado antes da refatoração.",
    {
      sourceCode: z.string(),
      entrypoint: z.string().optional(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      ...writeShape,
      ...runShape,
    },
    (args) => handleGenerateGoldenMasterTest(args as unknown as GoldenInput & LoopFlags, server),
    { readOnly: false },
  );
}
