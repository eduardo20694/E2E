/** Resultado textual de uma tool MCP. A assinatura de índice casa com CallToolResult. */
export interface ToolTextResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export function textResult(text: string): ToolTextResult {
  return { content: [{ type: "text", text }] };
}

export function errorResult(message: string): ToolTextResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}
