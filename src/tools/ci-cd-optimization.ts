import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectStack, stackSummary } from "../lib/detect.js";
import { doc, markdownTable } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";
import { listTestFiles } from "../lib/pyramid.js";
import { writeShape, type ProjectContextInput } from "../lib/schema.js";
import { deliver, type LoopFlags } from "./loop.js";

export interface ImpactInput extends ProjectContextInput {
  changedFiles: string[];
}

export function suggestTestImpactAnalysis(input: ImpactInput): ToolTextResult {
  if (!input.changedFiles?.length) {
    return errorResult("suggest_test_impact_analysis exige changedFiles.");
  }

  const stack = detectStack(input.projectRoot);
  let onDisk: string[] = [];
  if (input.projectRoot) {
    try {
      onDisk = listTestFiles(input.projectRoot);
    } catch {
      onDisk = [];
    }
  }
  const rows = input.changedFiles.map((file) => {
    const normalized = file.replace(/\\/g, "/");
    if (/\.(test|spec)\./.test(normalized) || /(?:^|\/)test_.+\.py$/.test(normalized)) return [normalized, "rodar este arquivo", "já é teste"];
    if (/e2e|cypress|playwright/.test(normalized)) return [normalized, "suíte E2E da pasta", "mudança de fluxo"];
    const base = normalized.split("/").pop()?.replace(/\.[^.]+$/, "") ?? normalized;
    const related = onDisk.filter((test) => {
      const name = test.split("/").pop() ?? test;
      return name.includes(base);
    });
    if (related.length) return [normalized, related.join(", "), "teste encontrado no disco"];
    return [normalized, `${base}.test.* e ${base}.spec.*`, "impacto direto"];
  });

  const runner = stack.unitFrameworks[0] ?? "o runner da stack";

  return textResult(
    doc([
      "# Análise de impacto",
      `No pull request, ${runner} roda o conjunto afetado. A suíte inteira continua no merge da linha principal.`,
      "## Stack detectada",
      stackSummary(stack),
      markdownTable(["Arquivo alterado", "Rodar", "Motivo"], rows),
      "Impacto por nome de arquivo erra quando o teste mora longe da produção. Um mapa explícito (ou a cobertura da última execução) corrige isso. Sem mapa, não finja que o atalho é completo.",
      citeKnowledge(["ci-cd-test-optimization"]),
    ]),
  );
}

export interface ParallelInput extends ProjectContextInput {
  testFiles?: number;
  workers?: number;
}

export function suggestTestParallelization(input: ParallelInput): ToolTextResult {
  const stack = detectStack(input.projectRoot);
  let counted: number | undefined;
  if (!(input.testFiles && input.testFiles > 0) && input.projectRoot) {
    try {
      counted = listTestFiles(input.projectRoot).length;
    } catch {
      counted = undefined;
    }
  }
  const files = input.testFiles && input.testFiles > 0 ? input.testFiles : counted !== undefined ? counted : 40;
  const workers = input.workers && input.workers > 0 ? input.workers : 4;
  const shards = Math.min(workers, Math.max(1, Math.ceil(files / 15)));
  const runner = stack.unitFrameworks.includes("pytest")
    ? "pytest -n auto"
    : stack.unitFrameworks.includes("jest")
      ? "jest --maxWorkers"
      : "vitest --shard";

  return textResult(
    doc([
      "# Paralelização no CI",
      "## Stack detectada",
      stackSummary(stack),
      `- Cerca de ${files} arquivos e ${workers} workers disponíveis.`,
      `- Sugestão: **${shards} shards**, comando na família \`${runner}\`.`,
      "- Teste que divide estado global não paraleliza. Isole dado antes de aumentar o shard.",
      "- E2E pesado vai num shard separado do unitário, para o unitário não esperar o browser.",
      stack.delivery.includes("github-actions")
        ? "GitHub Actions detectado: uma matriz com shard index/total encaixa no workflow que já existe."
        : "Sem GitHub Actions na raiz. O mesmo shard vale em GitLab ou Jenkins, com um job por índice.",
      citeKnowledge(["ci-cd-test-optimization"]),
    ]),
  );
}

export interface QuarantineInput extends ProjectContextInput {
  tests?: string[];
}

export function suggestFlakyTestQuarantine(input: QuarantineInput): ToolTextResult {
  const names = input.tests?.filter(Boolean) ?? [];
  return textResult(
    doc([
      "# Quarentena de teste instável",
      names.length ? `Candidatos: ${names.join(", ")}.` : "Nenhum teste nomeado. O processo abaixo vale para o próximo que falhar sem mudança de código.",
      "- Tirar do job que bloqueia o merge no mesmo dia em que a falha é intermitente, com issue e dono.",
      "- O teste continua rodando num job que não bloqueia, todo dia. Sumir da suíte não é quarentena.",
      "- Prazo: 14 dias. Sem correção, apaga ou reescreve. Quarentena eterna vira cemitério.",
      "- Não aumente retry do pipeline para esconder o caso. Retry mascara; a quarentena registra.",
      "- A correção volta o teste para o job principal no mesmo pull request que remove a causa.",
      citeKnowledge(["ci-cd-test-optimization", "qa-metrics"]),
    ]),
  );
}

export function registerCiTools(server: McpServer): void {
  registerTool(
    server,
    "suggest_test_impact_analysis",
    "Análise de impacto de teste",
    "Impacto lê arquivo do disco e lista os testes dos arquivos alterados, sem gravar; a suíte inteira segue no merge.",
    {
      changedFiles: z.array(z.string()).min(1),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
    },
    (args) => suggestTestImpactAnalysis(args as unknown as ImpactInput),
  );

  registerTool(
    server,
    "suggest_test_parallelization",
    "Paralelizar a suíte",
    "Shards lê o runner do projeto e calcula, sem gravar, como fatiar a suíte no CI.",
    {
      testFiles: z.number().int().positive().optional(),
      workers: z.number().int().positive().optional(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
    },
    (args) => suggestTestParallelization(args as unknown as ParallelInput),
  );

  registerTool(
    server,
    "suggest_flaky_test_quarantine",
    "Quarentena de flaky",
    "Quarentena grava e não executa `docs/qa/quarentena.md` para isolar um teste instável sem apagá-lo e sem movê-lo.",
    {
      tests: z.array(z.string()).optional(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
      ...writeShape,
    },
    (args) => handleFlakyQuarantine(args as unknown as QuarantineInput & LoopFlags, server),
    { readOnly: false },
  );
}

async function handleFlakyQuarantine(input: QuarantineInput & LoopFlags, server: McpServer): Promise<ToolTextResult> {
  const result = suggestFlakyTestQuarantine(input);
  if (result.isError) return result;
  return deliver({
    server,
    input,
    preface: result,
    relativePath: "docs/qa/quarentena.md",
    contents: result.content[0]?.text ?? "",
  });
}
