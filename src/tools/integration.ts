import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { renderIntegrationTest } from "../lib/codegen.js";
import { detectStack, inferLanguage, resolveJsRunner, stackSummary } from "../lib/detect.js";
import { codeBlock, doc } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";
import { runShape, writeShape, type ProjectContextInput } from "../lib/schema.js";
import { deliver, hydrateSource, type LoopFlags } from "./loop.js";
import type { TestRunner } from "../lib/runner.js";

export interface GenerateIntegrationTestInput extends ProjectContextInput {
  description: string;
  modules?: string[];
  database?: string;
}

const DB_HINT = /postgres|mysql|mongo|redis|kafka|banco|database|sql/i;

export function generateIntegrationTest(input: GenerateIntegrationTestInput): ToolTextResult {
  if (!input.description?.trim()) {
    return errorResult("generate_integration_test exige description dos módulos e da colaboração esperada.");
  }

  const stack = detectStack(input.projectRoot);
  const language = inferLanguage(input.sourceCode, input.filePath);
  const target = language === "python" ? "python" : language === "java" ? "java" : "ts";
  const modules = input.modules?.filter(Boolean) ?? [];
  const blob = `${input.description} ${modules.join(" ")} ${input.database ?? ""} ${input.sourceCode ?? ""}`;
  const useTestcontainers = stack.hasTestcontainers || stack.hasDocker || DB_HINT.test(blob);

  const runner = resolveJsRunner({ projectRoot: input.projectRoot, filePath: input.filePath, stack });
  const rendered = renderIntegrationTest({
    description: input.description,
    modules,
    database: input.database,
    useTestcontainers,
    language: target,
    sourceCode: input.sourceCode,
    filePath: input.filePath,
    baseUrl: "http://127.0.0.1:3000",
    runner,
  });

  return textResult(
    doc([
      "# Teste de integração — ambiente real isolado",
      "Isto **não** é mock do banco ou da fila do próprio sistema, e **não** é produção. O ambiente sobe com o teste e morre com ele.",
      "## O que não mockar",
      "- Banco, fila e cache que pertencem a este sistema.",
      "## O que mockar",
      "- Pagamento, e-mail, SMS e qualquer API de terceiro com custo ou efeito fora do teste.",
      `**Alvo:** ${target}`,
      useTestcontainers
        ? "Testcontainers sugerido: há banco, Docker ou a dependência já no projeto. O container sobe e desce com o teste."
        : "Sem indício de banco. O teste integra módulos em processo, com transação revertida ou fixture local.",
      "## Stack detectada",
      stackSummary(stack),
      "## Código",
      codeBlock(rendered.language, rendered.code),
      "## O que afirmar",
      "- O efeito observável entre os módulos (linha gravada, evento publicado, status HTTP).",
      "- Uma falha de contrato (schema, timeout, constraint) com a mensagem esperada.",
      "- Isolamento: o teste não depende de linha deixada pela execução anterior.",
      citeKnowledge(["integration-testing", "test-environments", "api-contract-testing"]),
    ]),
  );
}

export async function handleGenerateIntegrationTest(
  input: GenerateIntegrationTestInput & LoopFlags,
  server?: McpServer,
): Promise<ToolTextResult> {
  const hydrated = await hydrateSource(server, input);
  if ("isError" in hydrated && hydrated.isError) return hydrated;
  const ready = hydrated as GenerateIntegrationTestInput & LoopFlags;
  const result = generateIntegrationTest(ready);
  if (result.isError) return result;

  const stack = detectStack(ready.projectRoot);
  const language = inferLanguage(ready.sourceCode, ready.filePath);
  const target = language === "python" ? "python" : language === "java" ? "java" : "ts";
  const modules = ready.modules?.filter(Boolean) ?? [];
  const blob = `${ready.description} ${modules.join(" ")} ${ready.database ?? ""} ${ready.sourceCode ?? ""}`;
  const jsRunner = resolveJsRunner({ projectRoot: ready.projectRoot, filePath: ready.filePath, stack });
  const rendered = renderIntegrationTest({
    description: ready.description,
    modules,
    database: ready.database,
    useTestcontainers: stack.hasTestcontainers || stack.hasDocker || DB_HINT.test(blob),
    language: target,
    sourceCode: ready.sourceCode,
    filePath: ready.filePath,
    baseUrl: "http://127.0.0.1:3000",
    runner: jsRunner,
  });
  const runner: TestRunner | undefined = target === "python" ? "pytest" : target === "ts" ? jsRunner : undefined;
  return deliver({
    server,
    input: ready,
    preface: result,
    relativePath: rendered.fileName,
    contents: rendered.code,
    runner,
    runEligible: Boolean(runner),
    skippedNote: runner ? undefined : "Não foi executado.",
  });
}

export function registerIntegrationTools(server: McpServer): void {
  registerTool(
    server,
    "generate_integration_test",
    "Gerar teste de integração",
    "Integração grava e executa no runner local o teste entre módulos (`integration.test.ts` ou equivalente). Com rota no fonte, chama o endpoint local e afirma o status do handler; sem rota, pede o efeito observável.",
    {
      description: z.string().describe("O que os módulos fazem juntos."),
      modules: z.array(z.string()).optional().describe("Nomes dos módulos envolvidos."),
      database: z.string().optional().describe("Banco ou broker, por exemplo postgres."),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional().describe("Código aberto no editor, se houver."),
      ...writeShape,
      ...runShape,
    },
    (args) => handleGenerateIntegrationTest(args as unknown as GenerateIntegrationTestInput & LoopFlags, server),
    { readOnly: false },
  );
}
