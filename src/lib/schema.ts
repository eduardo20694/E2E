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
