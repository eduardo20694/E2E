import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { renderApiTest } from "../lib/codegen.js";
import { detectStack, inferLanguage, stackSummary } from "../lib/detect.js";
import { codeBlock, doc } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";
import type { ProjectContextInput } from "../lib/schema.js";

export interface GenerateApiTestInput extends ProjectContextInput {
  specification: string;
  protocol?: "rest" | "graphql" | "grpc";
  baseUrl?: string;
}

export function detectProtocol(specification: string, source?: string): "rest" | "graphql" | "grpc" {
  const blob = `${specification}\n${source ?? ""}`;
  if (/grpc|protobuf|\.proto\b|rpc\s+\w+/i.test(blob)) return "grpc";
  if (/graphql|query\s*\{|mutation\s/i.test(blob)) return "graphql";
  return "rest";
}

export function generateApiTest(input: GenerateApiTestInput): ToolTextResult {
  if (!input.specification?.trim()) {
    return errorResult("generate_api_test exige specification com o endpoint, schema ou proto.");
  }

  const stack = detectStack(input.projectRoot);
  const protocol = input.protocol ?? detectProtocol(input.specification, input.sourceCode);
  const language = inferLanguage(input.sourceCode, input.filePath);
  const rendered = renderApiTest({
    protocol,
    specification: input.specification,
    baseUrl: input.baseUrl ?? (protocol === "graphql" ? "http://127.0.0.1:4000/graphql" : "http://127.0.0.1:3000/resource"),
    language: language === "python" ? "python" : "ts",
  });

  const cases = [
    "Sucesso: status e corpo aderentes ao contrato.",
    "Validação: campo obrigatório ausente, tipo errado, string vazia e limite numérico.",
    "Autenticação e autorização: sem credencial e com credencial de outro recurso.",
    "Não encontrado e conflito: id inexistente e repetição do mesmo comando.",
    "Borda: unicode, payload grande e lista vazia.",
  ];

  return textResult(
    doc([
      `# Teste de contrato — ${protocol.toUpperCase()}`,
      "Contrato contra ambiente de teste ou staging. Terceiro instável fica stubado. Não é carga em produção.",
      stack.apiTools.length ? `Ferramentas já no projeto: ${stack.apiTools.join(", ")}.` : undefined,
      "## Stack detectada",
      stackSummary(stack),
      "## Casos",
      cases.map((item) => `- ${item}`).join("\n"),
      "## Código",
      codeBlock(rendered.language, rendered.code),
      protocol === "graphql"
        ? "GraphQL costuma responder HTTP 200 mesmo com erro de domínio. Afirme `errors` e `data`, não só o status."
        : undefined,
      protocol === "grpc"
        ? "Afirme o status canônico (OK, INVALID_ARGUMENT, NOT_FOUND, UNAUTHENTICATED, PERMISSION_DENIED), não um HTTP inventado."
        : undefined,
      citeKnowledge(["api-contract-testing", "integration-testing"]),
    ]),
  );
}

export function registerApiTools(server: McpServer): void {
  registerTool(
    server,
    "generate_api_test",
    "Gerar teste de API",
    "Gera testes de contrato para REST, GraphQL ou gRPC, com sucesso, erro e bordas. Detecta o protocolo pelo texto quando protocol não vem preenchido.",
    {
      specification: z.string().describe("Endpoint, operação, schema ou trecho de código da API."),
      protocol: z.enum(["rest", "graphql", "grpc"]).optional(),
      baseUrl: z.string().optional(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
    },
    (args) => generateApiTest(args as unknown as GenerateApiTestInput),
  );
}
