import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";
import { errorResult, type ToolTextResult } from "./result.js";

interface DeferredTool {
  name: string;
  register: () => void;
}

let allowlist: ReadonlySet<string> | null = null;
let deferred: DeferredTool[] | null = null;

/** `names` null registra tudo na hora. Com lista e ordem, segura e solta na ordem da lista. */
export function beginToolRegistration(names: readonly string[] | null, preserveOrder: boolean): void {
  allowlist = names ? new Set(names) : null;
  deferred = preserveOrder ? [] : null;
}

export function endToolRegistration(): void {
  const pending = deferred;
  const allowed = allowlist;
  deferred = null;
  allowlist = null;
  if (!pending || !allowed) return;
  const rank = new Map([...allowed].map((name, index) => [name, index]));
  pending.sort((left, right) => (rank.get(left.name) ?? 0) - (rank.get(right.name) ?? 0));
  for (const item of pending) item.register();
}

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
  if (allowlist && !allowlist.has(name)) return;
  const readOnly = options?.readOnly !== false;
  const register = () => server.registerTool(
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
  if (deferred) {
    deferred.push({ name, register });
    return;
  }
  register();
}
