import fs from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mapTestsForEdit, siblingCandidates, type EditMapInput } from "../lib/edit-map.js";
import { registerTool } from "../lib/register-tool.js";
import { readFirstExisting, readSuiteEvidence } from "../lib/report.js";
import { errorResult } from "../lib/result.js";
import { toolsetProfile } from "./register.js";
import { cursorRoots, readProjectFile, resolveInside, resolveProjectRoot } from "../lib/workspace.js";

export function registerEditMapTools(server: McpServer): void {
  registerTool(
    server,
    "map_tests_for_edit",
    "Mapear testes do arquivo editado",
    "Chame primeiro, com o filePath do arquivo editado ou aberto e o projectRoot. Diz a camada e devolve no máximo seis tools do perfil ativo, nesta ordem. O que falta aparece como disponível com E2E_TOOLSET=full. Somente leitura: não grava e não executa.",
    {
      filePath: z.string().optional().describe("Caminho do arquivo editado ou aberto."),
      projectRoot: z.string().optional().describe("Raiz do projeto aberto no Cursor."),
      sourceCode: z
        .string()
        .optional()
        .describe("Conteúdo. Se vazio e houver raiz e filePath, o servidor lê o arquivo."),
    },
    async (args) => {
      const input = args as { filePath?: string; projectRoot?: string; sourceCode?: string };
      const resolved = await resolveProjectRoot({
        explicit: input.projectRoot,
        filePath: input.filePath,
        listRoots: () => cursorRoots(server),
      });
      const projectRoot = resolved.root ?? input.projectRoot;
      let sourceCode = input.sourceCode;
      if (!sourceCode?.trim() && input.filePath && projectRoot) {
        try {
          sourceCode = readProjectFile(projectRoot, input.filePath);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return errorResult(message);
        }
      }
      const facts = projectRoot ? loadFacts(projectRoot, input.filePath) : {};
      return mapTestsForEdit({
        filePath: input.filePath,
        projectRoot,
        sourceCode,
        profile: toolsetProfile(),
        ...facts,
      });
    },
  );
}

function loadFacts(projectRoot: string, filePath?: string): Pick<
  EditMapInput,
  "siblingChecked" | "siblingPath" | "siblingText" | "hasLogOrJunit" | "hasReport" | "hasLcov"
> {
  const sibling = filePath ? readSibling(projectRoot, filePath) : undefined;
  let hasLogOrJunit = false;
  let hasReport = false;
  let hasLcov = false;
  try {
    const evidence = readSuiteEvidence(projectRoot);
    if (evidence && isLogOrJunit(evidence.path)) hasLogOrJunit = true;
    else if (evidence) hasReport = true;
    hasLcov = Boolean(readFirstExisting(projectRoot, ["coverage/lcov.info", "lcov.info"]));
  } catch {
    // Raiz ilegível: o mapa segue só com o caminho e o fonte.
  }
  return {
    siblingChecked: true,
    siblingPath: sibling?.path,
    siblingText: sibling?.text,
    hasLogOrJunit,
    hasReport,
    hasLcov,
  };
}

function readSibling(projectRoot: string, filePath: string): { path: string; text?: string } | undefined {
  for (const candidate of siblingCandidates(filePath)) {
    try {
      const absolute = resolveInside(projectRoot, candidate);
      if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
      if (fs.statSync(absolute).size > 200_000) return { path: candidate };
      return { path: candidate, text: fs.readFileSync(absolute, "utf8") };
    } catch {
      continue;
    }
  }
  return undefined;
}

function isLogOrJunit(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  if (normalized.includes("allure")) return false;
  return (
    normalized.endsWith(".log") ||
    normalized.endsWith(".xml") ||
    normalized.includes("junit") ||
    normalized === "test-results" ||
    normalized.startsWith("test-results/")
  );
}
