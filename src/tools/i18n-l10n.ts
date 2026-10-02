import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { codeBlock, doc, markdownTable } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";
import { runShape, writeShape } from "../lib/schema.js";
import { deliver, type LoopFlags } from "./loop.js";

const RTL = new Set(["ar", "he", "fa", "ur"]);

export interface I18nInput {
  locales: string[];
  sourceCode?: string;
  filePath?: string;
  projectRoot?: string;
}

export function generateI18nTest(input: I18nInput): ToolTextResult {
  if (!input.locales?.length) {
    return errorResult("generate_i18n_test exige locales, por exemplo pt-BR e ar.");
  }

  const rows = input.locales.map((locale) => {
    const language = locale.split("-")[0]?.toLowerCase() ?? locale;
    return [
      locale,
      RTL.has(language) ? "RTL" : "LTR",
      locale.toLowerCase().includes("us") ? "USD / MM/DD" : locale.toLowerCase().includes("br") ? "BRL / DD/MM" : "moeda e data do locale",
    ];
  });

  return textResult(
    doc([
      "# Testes de i18n",
      markdownTable(["Locale", "Direção", "Formato"], rows),
      codeBlock("ts", i18nSource(input.locales)),
      "- Chave faltante não pode cair em silêncio na chave crua (`checkout.title`) na tela.",
      "- Pseudo-locale (acentos alongados) revela texto estourando o layout antes da tradução chegar.",
      RTL.has(input.locales.map((locale) => locale.split("-")[0]?.toLowerCase()).find((code) => code && RTL.has(code)) ?? "")
        ? "- Há locale RTL na lista. O teste de layout confere `dir=rtl`, não só a tradução."
        : "- Nenhum locale RTL na lista. Se o produto prometer árabe ou hebraico, inclua um.",
      input.sourceCode ? "O código aberto entra como o catálogo ou o componente a cobrir." : undefined,
      citeKnowledge(["i18n-l10n-testing"]),
    ]),
  );
}

function i18nSource(locales: string[]): string {
  return `import { describe, it, expect } from "vitest";

const locales = ${JSON.stringify(locales)};

describe("catálogo de textos", () => {
  it.each(locales)("%s tem as chaves do idioma base", (locale) => {
    const catalog = loadCatalog(locale);
    expect(Object.keys(catalog).length).toBeGreaterThan(0);
  });

  it("data e moeda seguem o locale, não a string fixa em inglês", () => {
    expect(formatMoney(10, "${locales[0]}")).not.toBe("10");
  });
});`;
}

export async function handleGenerateI18nTest(input: I18nInput & LoopFlags, server?: McpServer): Promise<ToolTextResult> {
  const result = generateI18nTest(input);
  if (result.isError) return result;
  return deliver({
    server,
    input,
    preface: result,
    relativePath: "i18n.test.ts",
    contents: i18nSource(input.locales),
    runner: "vitest",
  });
}

export function registerI18nTools(server: McpServer): void {
  registerTool(
    server,
    "generate_i18n_test",
    "Testes de i18n",
    "Idioma grava e executa no runner local `i18n.test.ts` com checagens de catálogo, data, moeda e direção RTL.",
    {
      locales: z.array(z.string()).min(1),
      sourceCode: z.string().optional(),
      filePath: z.string().optional(),
      projectRoot: z.string().optional(),
      ...writeShape,
      ...runShape,
    },
    (args) => handleGenerateI18nTest(args as unknown as I18nInput & LoopFlags, server),
    { readOnly: false },
  );
}
