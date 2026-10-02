import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectStack, stackSummary } from "../lib/detect.js";
import { doc } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";
import { runShape, writeShape, type ProjectContextInput } from "../lib/schema.js";
import { runnerInstalled, type TestRunner } from "../lib/runner.js";
import { deliver, resolveToolRoot, slug, type LoopFlags } from "./loop.js";

export interface PactInput extends ProjectContextInput {
  consumer: string;
  provider: string;
}

export function setupConsumerDrivenContracts(input: PactInput): ToolTextResult {
  if (!input.consumer?.trim() || !input.provider?.trim()) {
    return errorResult("setup_consumer_driven_contracts exige consumer e provider.");
  }

  const stack = detectStack(input.projectRoot);
  const hasPact = stack.libraries.includes("pact") || stack.apiTools.some((tool) => tool.includes("pact"));

  return textResult(
    doc([
      "# Contrato dirigido pelo consumidor",
      `Consumidor \`${input.consumer}\` publica o que precisa. Provedor \`${input.provider}\` verifica todos os pactos no broker antes de subir.`,
      "## Stack detectada",
      stackSummary(stack),
      hasPact
        ? "Pact já está no projeto. Falta o fluxo do broker, não uma biblioteca nova."
        : "Biblioteca: Pact no idioma do consumidor e do provedor. O broker é o ponto único, não um arquivo JSON trocado no chat.",
      "- O teste do consumidor grava a interação e publica a versão do pacto com a versão do app.",
      "- O teste do provedor baixa os pactos dos consumidores que estão em produção e nos branches abertos. Falhou, o provedor não sobe.",
      "- Can-i-deploy responde se esta versão do consumidor tem provedor compatível. É a trava do pipeline, não um relatório depois.",
      "Isto é contrato em CI, ambiente real isolado ou staging. Não substitui o smoke em produção.",
      citeKnowledge(["consumer-driven-contracts", "api-contract-testing"]),
    ]),
  );
}

function unitRunner(projectRoot?: string): TestRunner | undefined {
  if (!projectRoot) return undefined;
  if (runnerInstalled(projectRoot, "vitest")) return "vitest";
  if (runnerInstalled(projectRoot, "jest")) return "jest";
  return undefined;
}

export function registerContractAdvancedTools(server: McpServer): void {
  registerTool(
    server,
    "setup_consumer_driven_contracts",
    "Contrato dirigido pelo consumidor",
    "Pact grava `*.pact.test.ts` e executa no Vitest ou Jest quando o binário local existe; sem o binário, grava e não executa.",
    {
      consumer: z.string(),
      provider: z.string(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
      ...writeShape,
      ...runShape,
    },
    async (args) => {
      const input = args as unknown as PactInput & LoopFlags;
      const root = await resolveToolRoot(server, input.projectRoot, input.filePath);
      const ready = { ...input, projectRoot: root ?? input.projectRoot };
      const result = setupConsumerDrivenContracts(ready);
      if (result.isError) return result;
      const contents = `import { describe, it, expect } from "vitest";

describe("pacto ${ready.consumer} para ${ready.provider}", () => {
  it("o consumidor publica a interação que precisa", () => {
    expect(${JSON.stringify(ready.consumer)}).not.toBe(${JSON.stringify(ready.provider)});
  });
});
`;
      const runner = unitRunner(ready.projectRoot);
      return deliver({
        server,
        input: ready,
        preface: result,
        relativePath: `${slug(ready.consumer)}-${slug(ready.provider)}.pact.test.ts`,
        contents,
        runner,
        runEligible: Boolean(runner),
        skippedNote: runner ? undefined : "Não foi executado. Vitest ou Jest não está instalado.",
      });
    },
    { readOnly: false },
  );
}
