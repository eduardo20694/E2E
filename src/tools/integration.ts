import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { renderIntegrationTest } from "../lib/codegen.js";
import { detectStack, inferLanguage, stackSummary } from "../lib/detect.js";
import { codeBlock, doc } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";
import type { ProjectContextInput } from "../lib/schema.js";

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

  const rendered = renderIntegrationTest({
    description: input.description,
    modules,
    database: input.database,
    useTestcontainers,
    language: target,
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

export function registerIntegrationTools(server: McpServer): void {
  registerTool(
    server,
    "generate_integration_test",
    "Gerar teste de integração",
    "Gera um teste de integração entre módulos (API, serviço e banco). Sugere Testcontainers quando o cenário ou o projeto usa Docker/banco.",
    {
      description: z.string().describe("O que os módulos fazem juntos."),
      modules: z.array(z.string()).optional().describe("Nomes dos módulos envolvidos."),
      database: z.string().optional().describe("Banco ou broker, por exemplo postgres."),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional().describe("Código aberto no editor, se houver."),
    },
    (args) => generateIntegrationTest(args as unknown as GenerateIntegrationTestInput),
  );
}
