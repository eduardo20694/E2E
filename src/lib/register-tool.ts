import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";
import { errorResult, type ToolTextResult } from "./result.js";

/**
 * Registra uma tool somente-leitura e converte exceções em resultado isError,
 * para o cliente MCP receber a falha em vez de derrubar o processo stdio.
 */
export function registerTool(
  server: McpServer,
  name: string,
  title: string,
  description: string,
  inputSchema: ZodRawShape,
  handler: (args: Record<string, unknown>) => Promise<ToolTextResult> | ToolTextResult,
  options?: { readOnly?: boolean },
): void {
  const readOnly = options?.readOnly !== false;
  server.registerTool(
    name,
    {
      title,
      description,
      inputSchema,
      annotations: {
        readOnlyHint: readOnly,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        return await handler(args as Record<string, unknown>);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(`Falha em \`${name}\`: ${message}`);
      }
    },
  );
}
