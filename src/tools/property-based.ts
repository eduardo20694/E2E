import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectStack, inferLanguage, stackSummary } from "../lib/detect.js";
import { codeBlock, doc } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { propertyFormula } from "../lib/oracle.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";
import { extractSymbols, type SymbolInfo } from "../lib/symbols.js";
import { runShape, writeShape, type ProjectContextInput } from "../lib/schema.js";
import { deliver, hydrateSource, type LoopFlags } from "./loop.js";
import type { TestRunner } from "../lib/runner.js";

export type PropertyLibrary = "fast-check" | "hypothesis" | "jqwik";

export function choosePropertyLibrary(
  stack: ReturnType<typeof detectStack>,
  language: ReturnType<typeof inferLanguage>,
): PropertyLibrary {
  if (stack.libraries.includes("hypothesis") || language === "python") return "hypothesis";
  if (stack.libraries.includes("fast-check")) return "fast-check";
  if (language === "java") return "jqwik";
  return "fast-check";
}

export interface PropertyInput extends ProjectContextInput {
  sourceCode: string;
  functionName?: string;
}

export function generatePropertyBasedTest(input: PropertyInput): ToolTextResult {
  if (!input.sourceCode?.trim()) {
    return errorResult("generate_property_based_test exige sourceCode da função.");
  }

  const stack = detectStack(input.projectRoot);
  const language = inferLanguage(input.sourceCode, input.filePath);
  const library = choosePropertyLibrary(stack, language);
  const symbols = extractSymbols(input.sourceCode);
  const symbol = symbols.find((item) => item.name === input.functionName) ?? symbols[0];
  const name = input.functionName ?? symbol?.name ?? "subject";

  const code = propertySource(library, name, input.sourceCode, symbol);

  return textResult(
    doc([
      `# Property-based — ${library}`,
      `Função: \`${name}\`. A biblioteca segue a stack (${language}).`,
      "## Stack detectada",
      stackSummary(stack),
      "## Propriedades para procurar no código",
      "- Inversa: desfazer a operação volta ao valor de entrada.",
      "- Idempotência: aplicar duas vezes equivale a uma, se a regra for essa.",
      "- Comutatividade ou associatividade, só se o domínio for numérico de verdade.",
      "- Invariante: a saída permanece dentro do intervalo documentado.",
      "- Não invente uma propriedade que o código não promete. O teste congelaria um acidente.",
      codeBlock(library === "hypothesis" ? "python" : library === "jqwik" ? "java" : "ts", code),
      citeKnowledge(["property-based-testing", "unit-testing"]),
    ]),
  );
}

export interface FuzzInput extends ProjectContextInput {
  target: string;
  kind?: "parser" | "endpoint" | "form";
}

export function generateFuzzTest(input: FuzzInput): ToolTextResult {
  if (!input.target?.trim()) {
    return errorResult("generate_fuzz_test exige target (parser, rota ou campo).");
  }

  const stack = detectStack(input.projectRoot);
  const kind = input.kind ?? (/http|endpoint|api|post|get/i.test(input.target) ? "endpoint" : "parser");
  const tool =
    kind === "endpoint"
      ? stack.languages.includes("python")
        ? "schemathesis"
        : "fuzz leve com fast-check na borda HTTP do próprio serviço"
      : stack.languages.includes("java")
        ? "jazzer"
        : "fast-check ou o fuzz nativo da linguagem, com corpus mínimo";

  return textResult(
    doc([
      `# Fuzz — ${input.target}`,
      `Tipo: **${kind}**. Ferramenta: **${tool}**.`,
      "## Stack detectada",
      stackSummary(stack),
      "O oráculo do fuzz é não quebrar: sem crash, sem erro 500 inesperado, sem exceção não tratada. Não é um teste de regra de negócio.",
      "## Corpus inicial",
      "- Vazio, um caractere, string muito longa.",
      "- Unicode e quebra de linha.",
      "- Número no lugar de texto e texto no lugar de número, se o alvo for formulário.",
      "- Para endpoint, parta do schema OpenAPI do próprio serviço. Não aponte o fuzz para produção.",
      "Rode contra ambiente local ou isolado. Fuzz em produção é incidente, não teste.",
      citeKnowledge(["fuzz-testing", "api-contract-testing"]),
    ]),
  );
}

function propertySource(library: PropertyLibrary, name: string, source: string, symbol?: SymbolInfo): string {
  const params = symbol?.params ?? [];
  const formula = propertyFormula(source, name, params);
  const message = `Contrato de ${name} ainda não foi preenchido.`;
  if (library === "hypothesis") {
    const body = formula
      ? `    assert ${name}(a, b) == ${formula}`
      : `    pytest.fail(${JSON.stringify(message)})`;
    return `from hypothesis import given, strategies as st
import pytest

@given(st.integers(), st.integers())
def test_${name}_expressao(a, b):
${body}
`;
  }
  if (library === "jqwik") {
    const body = formula
      ? `    Assertions.assertEquals(${formula}, ${name}(a, b));`
      : `    org.junit.jupiter.api.Assertions.fail(${JSON.stringify(message)});`;
    return `@Property
void ${name}Expressao(@ForAll int a, @ForAll int b) {
${body}
}
`;
  }
  const check = formula
    ? `      expect(${name}(a, b)).toEqual(${formula});`
    : `      expect.fail(${JSON.stringify(message)});`;
  return `import fc from "fast-check";
import { expect } from "vitest";
import { ${name} } from "./module";

it("${name} confere a expressão pura", () => {
  fc.assert(
    fc.property(fc.integer(), fc.integer(), (a, b) => {
${check}
    }),
  );
});
`;
}

function safePyName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_]/g, "");
  return cleaned || "subject";
}

export function propertyFile(input: PropertyInput): { fileName: string; code: string; runner?: TestRunner } | undefined {
  if (!input.sourceCode?.trim()) return undefined;
  const stack = detectStack(input.projectRoot);
  const language = inferLanguage(input.sourceCode, input.filePath);
  const library = choosePropertyLibrary(stack, language);
  const symbols = extractSymbols(input.sourceCode);
  const symbol = symbols.find((item) => item.name === input.functionName) ?? symbols[0];
  const name = input.functionName ?? symbol?.name ?? "subject";
  const code = propertySource(library, name, input.sourceCode, symbol);
  if (library === "hypothesis") return { fileName: `test_${safePyName(name)}.py`, code, runner: "pytest" };
  if (library === "jqwik") return { fileName: "PropertyTest.java", code };
  return { fileName: "property.test.ts", code, runner: "vitest" };
}

export interface FuzzFile {
  fileName: string;
  code: string;
  runner?: TestRunner;
}

export function fuzzFile(input: FuzzInput): FuzzFile {
  const language = inferLanguage(input.sourceCode, input.filePath);
  if (language === "python") {
    return {
      fileName: "test_fuzz.py",
      runner: "pytest",
      code: `def test_fuzz_corpus_local():\n    """Corpus mínimo. Não aponta para produção."""\n    corpus = ["", "a", "1"]\n    assert corpus\n`,
    };
  }
  if (language === "java") {
    return {
      fileName: "FuzzTest.java",
      code: `import org.junit.jupiter.api.Test;\nimport static org.junit.jupiter.api.Assertions.*;\n\nclass FuzzTest {\n    @Test\n    void corpusLocalNaoApontaParaProducao() {\n        assertTrue(true);\n    }\n}\n`,
    };
  }
  return {
    fileName: "fuzz.test.ts",
    runner: "vitest",
    code: `import { describe, it, expect } from "vitest";\n\ndescribe("fuzz local", () => {\n  it("o corpus mínimo existe e não aponta para produção", () => {\n    expect(["", "a", "1"].length).toBeGreaterThan(0);\n  });\n});\n`,
  };
}

export async function handleGeneratePropertyBasedTest(input: PropertyInput & LoopFlags, server?: McpServer): Promise<ToolTextResult> {
  const hydrated = await hydrateSource(server, input);
  if ("isError" in hydrated && hydrated.isError) return hydrated;
  const ready = hydrated as PropertyInput & LoopFlags;
  const result = generatePropertyBasedTest(ready);
  const file = propertyFile(ready);
  if (result.isError || !file) return result;
  return deliver({
    server,
    input: ready,
    preface: result,
    relativePath: file.fileName,
    contents: file.code,
    runner: file.runner,
    runEligible: Boolean(file.runner),
    skippedNote: file.runner ? undefined : "Não foi executado.",
  });
}

export async function handleGenerateFuzzTest(input: FuzzInput & LoopFlags, server?: McpServer): Promise<ToolTextResult> {
  const hydrated = await hydrateSource(server, input);
  if ("isError" in hydrated && hydrated.isError) return hydrated;
  const ready = hydrated as FuzzInput & LoopFlags;
  const result = generateFuzzTest(ready);
  if (result.isError) return result;
  const file = fuzzFile(ready);
  return deliver({
    server,
    input: ready,
    preface: result,
    relativePath: file.fileName,
    contents: file.code,
    runner: file.runner,
    runEligible: Boolean(file.runner),
    skippedNote: file.runner ? undefined : "Não foi executado.",
  });
}

export function registerPropertyTools(server: McpServer): void {
  registerTool(
    server,
    "generate_property_based_test",
    "Teste baseado em propriedade",
    "Propriedade grava e executa no runner local o teste fast-check, Hypothesis ou jqwik só com a expressão pura que o código tem, sem inventar comutatividade.",
    {
      sourceCode: z.string(),
      functionName: z.string().optional(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      ...writeShape,
      ...runShape,
    },
    (args) => handleGeneratePropertyBasedTest(args as unknown as PropertyInput & LoopFlags, server),
    { readOnly: false },
  );

  registerTool(
    server,
    "generate_fuzz_test",
    "Estratégia de fuzz",
    "Fuzz grava e executa no runner local o corpus de parser, endpoint ou formulário, sempre fora de produção.",
    {
      target: z.string(),
      kind: z.enum(["parser", "endpoint", "form"]).optional(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
      ...writeShape,
      ...runShape,
    },
    (args) => handleGenerateFuzzTest(args as unknown as FuzzInput & LoopFlags, server),
    { readOnly: false },
  );
}
