import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPrompts } from "./prompts/templates.js";
import { registerKnowledgeResources } from "./resources/register.js";
import { registerAllTools } from "./tools/register.js";

export const SERVER_NAME = "E2E";
export const SERVER_VERSION = "3.7.0";

export const SERVER_INSTRUCTIONS =
  "Quando for testar algo que você editou ou que está aberto, chame primeiro `map_tests_for_edit` com o filePath desse arquivo e o projectRoot. Siga a ordem que ela devolver. Não escolha outra tool no lugar. Segurança de tela e de API roda no localhost. SAST, SCA, k6 em localhost, mutação e pact rodam se a ferramenta já está instalada. Smoke de produção, chaos e restore gravam arquivo e não executam.";

/** Monta o servidor sem acoplar ao transporte, para teste e para o stdio. */
export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    { instructions: SERVER_INSTRUCTIONS },
  );

  registerAllTools(server);
  registerKnowledgeResources(server);
  registerPrompts(server);
  return server;
}
