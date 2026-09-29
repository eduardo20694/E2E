import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPrompts } from "./prompts/templates.js";
import { registerKnowledgeResources } from "./resources/register.js";
import { registerAllTools } from "./tools/register.js";

export const SERVER_NAME = "E2E";
export const SERVER_VERSION = "3.0.0";

/** Monta o servidor sem acoplar ao transporte, para teste e para o stdio. */
export function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerAllTools(server);
  registerKnowledgeResources(server);
  registerPrompts(server);
  return server;
}
