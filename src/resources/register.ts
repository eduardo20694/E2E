import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { layerMatrixMarkdown } from "../lib/edit-map.js";
import { listKnowledge, readKnowledge } from "../lib/knowledge.js";

/** Publica cada markdown como resource `e2e://knowledge/<slug>`. */
export function registerKnowledgeResources(server: McpServer): void {
  for (const article of listKnowledge()) {
    const slug = article.slug;
    server.registerResource(
      slug,
      article.uri,
      {
        title: article.title,
        description: `Teoria e exemplo de ${article.title}. Citável no Cursor como contexto do servidor E2E.`,
        mimeType: "text/markdown",
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: readKnowledge(slug).body,
          },
        ],
      }),
    );
  }

  server.registerResource(
    "map",
    "e2e://map",
    {
      title: "Mapa de tools por arquivo editado",
      description: "Matriz de camadas gerada pelo mapa: qual tool chamar conforme o arquivo editado.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: layerMatrixMarkdown(),
        },
      ],
    }),
  );
}
