import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { renderApiTest } from "../lib/codegen.js";
import { detectStack, inferLanguage, resolveJsRunner, stackSummary } from "../lib/detect.js";
import { markerName } from "../lib/markers.js";
import { codeBlock, doc } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";
import { runShape, writeShape, type ProjectContextInput } from "../lib/schema.js";
import { extractRoutes } from "../lib/web.js";
import { deliver, hydrateSource, type LoopFlags } from "./loop.js";
import type { TestRunner } from "../lib/runner.js";

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

function apiRender(input: GenerateApiTestInput) {
  const protocol = input.protocol ?? detectProtocol(input.specification, input.sourceCode);
  const language = inferLanguage(input.sourceCode, input.filePath);
  const stack = detectStack(input.projectRoot);
  const runner = resolveJsRunner({ projectRoot: input.projectRoot, filePath: input.filePath, stack });
  const source = [input.sourceCode, input.specification].filter((part) => part?.trim()).join("\n");
  const routes = protocol === "rest" ? extractRoutes(source, input.filePath) : [];
  const rendered = renderApiTest({
    protocol,
    specification: input.specification,
    baseUrl: input.baseUrl ?? (protocol === "graphql" ? "http://127.0.0.1:4000/graphql" : "http://127.0.0.1:3000"),
    language: language === "python" ? "python" : "ts",
    sourceCode: source,
    filePath: input.filePath,
    runner,
  });
  return { protocol, language, routes, rendered, runner };
}

export function generateApiTest(input: GenerateApiTestInput): ToolTextResult {
  if (!input.specification?.trim()) {
    return errorResult("generate_api_test exige specification com o endpoint, schema ou proto.");
  }

  const stack = detectStack(input.projectRoot);
  const { protocol, language, routes, rendered, runner } = apiRender(input);
  const gap = language === "python" ? "@pytest.mark.skip" : markerName(runner);

  const cases =
    protocol !== "rest"
      ? [
          "Sucesso: status e corpo aderentes ao contrato.",
          "Validação: campo obrigatório ausente, tipo errado, string vazia e limite numérico.",
          "Autenticação e autorização: sem credencial e com credencial de outro recurso.",
          "Não encontrado e conflito: id inexistente e repetição do mesmo comando.",
          "Borda: unicode, payload grande e lista vazia.",
        ]
      : routes.length
        ? [
            `O verde do caminho feliz não cobre entrada ruim nem anônimo. Lacuna é test.fixme no Playwright (com callback), test.todo só com a descrição, sem função, no Vitest e no Jest, e @pytest.mark.skip no pytest. Não é sucesso.`,
            ...routes.map((route) => `${route.method} ${route.path} responde ${route.status}.`),
            ...routes.map((route) =>
              route.validationStatus === 400 || route.validationStatus === 422
                ? `${route.method} ${route.path} recusa entrada inválida com ${route.validationStatus}.`
                : `${route.method} ${route.path}: entrada inválida fica em ${gap} porque o handler não declara 400 nem 422.`,
            ),
            ...routes.map((route) =>
              route.authStatus
                ? `${route.method} ${route.path} sem credencial responde ${route.authStatus}.`
                : route.requiresAuth
                  ? `${route.method} ${route.path}: anônimo fica em ${gap} porque há guarda, mas o handler não declara 401 nem 403.`
                  : `${route.method} ${route.path}: anônimo fica em ${gap} porque a rota não mostra guarda nem 401/403.`,
            ),
          ]
        : ["Nenhuma rota extraída. O teste falha até o handler mostrar método, path e status."];

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

export async function handleGenerateApiTest(input: GenerateApiTestInput & LoopFlags, server?: McpServer): Promise<ToolTextResult> {
  const hydrated = await hydrateSource(server, input);
  if ("isError" in hydrated && hydrated.isError) return hydrated;
  const ready = hydrated as GenerateApiTestInput & LoopFlags;
  const result = generateApiTest(ready);
  if (result.isError) return result;
  const { rendered, runner: jsRunner } = apiRender(ready);
  const runner: TestRunner | undefined = rendered.language === "python" ? "pytest" : jsRunner;
  return deliver({
    server,
    input: ready,
    preface: result,
    relativePath: rendered.fileName,
    contents: rendered.code,
    runner,
  });
}

export function registerApiTools(server: McpServer): void {
  registerTool(
    server,
    "generate_api_test",
    "Gerar teste de API",
    "Contrato grava e executa no runner local o teste de API (`*.test.ts` ou pytest) para REST, GraphQL ou gRPC; o gRPC falha até existir cliente. O verde do caminho feliz não cobre entrada ruim nem anônimo. Lacuna é test.fixme no Playwright (com callback), test.todo no Vitest e no Jest (só a descrição, sem função) e @pytest.mark.skip no pytest. Corpo opaco é expect.fail no Vitest, throw new Error no Jest e pytest.fail no pytest.",
    {
      specification: z.string().describe("Endpoint, operação, schema ou trecho de código da API."),
      protocol: z.enum(["rest", "graphql", "grpc"]).optional(),
      baseUrl: z.string().optional(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
      ...writeShape,
      ...runShape,
    },
    (args) => handleGenerateApiTest(args as unknown as GenerateApiTestInput & LoopFlags, server),
    { readOnly: false },
  );
}
