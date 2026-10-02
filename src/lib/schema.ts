import { z } from "zod";

/** Contexto opcional vindo de arquivos abertos no Cursor. */
export const contextShape = {
  projectRoot: z
    .string()
    .optional()
    .describe(
      "Raiz absoluta do projeto aberto no Cursor. Serve para detectar frameworks já instalados.",
    ),
  filePath: z
    .string()
    .optional()
    .describe("Caminho do arquivo aberto no editor, quando houver."),
  sourceCode: z
    .string()
    .optional()
    .describe("Conteúdo do arquivo ou trecho aberto no editor."),
};

export interface ProjectContextInput {
  projectRoot?: string;
  filePath?: string;
  sourceCode?: string;
}

export const writeShape = {
  writeToProject: z
    .boolean()
    .optional()
    .describe("false não grava. Omitido, grava quando a raiz do projeto existe."),
  overwrite: z.boolean().optional().describe("true substitui o arquivo se ele já existir."),
};

export const runShape = {
  run: z
    .boolean()
    .optional()
    .describe("false não executa. Omitido, executa só Vitest, Jest, Playwright ou pytest, se o binário estiver instalado."),
};
