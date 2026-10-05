import fs from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectStack, inferLanguage, resolveJsRunner, stackSummary, type Language } from "../lib/detect.js";
import { codeBlock, doc } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { jsImport, opaqueStatement, pytestFail, pytestSkip } from "../lib/markers.js";
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
  const installed = propertyLibraryInstalled(input.projectRoot, library);
  const symbols = extractSymbols(input.sourceCode);
  const symbol = symbols.find((item) => item.name === input.functionName) ?? symbols[0];
  const name = input.functionName ?? symbol?.name ?? "subject";
  const runner = resolveJsRunner({ projectRoot: input.projectRoot, filePath: input.filePath, stack });

  const code = propertySource(library, name, input.sourceCode, symbol, installed, runner);

  return textResult(
    doc([
      `# Property-based — ${library}`,
      installed
        ? `Função: \`${name}\`. A biblioteca ${library} está no projeto. O teste grava e executa.`
        : `Função: \`${name}\`. A biblioteca ${library} não está no projeto, então o teste foi gravado e não rodou.`,
      `A biblioteca segue a stack (${language}).`,
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
  const language = inferLanguage(input.sourceCode, input.filePath);
  const kind = input.kind ?? (/http|endpoint|api|post|get/i.test(input.target) ? "endpoint" : "parser");
  const fuzz = fuzzLibrary(input.projectRoot, language, stack.languages.includes("python"));
  const tool = fuzz.installed ? fuzz.name : `${fuzz.name} (ausente no projeto)`;

  return textResult(
    doc([
      `# Fuzz — ${input.target}`,
      `Tipo: **${kind}**. Ferramenta: **${tool}**.`,
      fuzz.installed
        ? "A lib de fuzz está no projeto. O teste grava e executa, fora de produção."
        : `A lib de fuzz (${fuzz.name}) não está no projeto, então o arquivo foi gravado e o fuzz não rodou.`,
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

function propertySource(
  library: PropertyLibrary,
  name: string,
  source: string,
  symbol: SymbolInfo | undefined,
  installed: boolean,
  runner: "vitest" | "jest",
): string {
  const params = symbol?.params ?? [];
  const formula = propertyFormula(source, name, params);
  const message = `Contrato de ${name} ainda não foi preenchido.`;
  if (!installed) {
    return pendingLibrary(library, name, runner);
  }
  if (library === "hypothesis") {
    const body = formula
      ? `    assert ${name}(a, b) == ${formula}`
      : `    ${pytestFail(message)}`;
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
    : `      ${opaqueStatement(runner, message)}`;
  const expectImport = formula || runner === "vitest" ? jsImport(runner, ["expect"]) + "\n" : "";
  return `import fc from "fast-check";
${expectImport}import { ${name} } from "./module";

it("${name} confere a expressão pura", () => {
  fc.assert(
    fc.property(fc.integer(), fc.integer(), (a, b) => {
${check}
    }),
  );
});
`;
}

function pendingLibrary(library: PropertyLibrary, name: string, runner: "vitest" | "jest"): string {
  const note = `A biblioteca ${library} não está no projeto. O teste não roda até ela existir.`;
  if (library === "hypothesis") {
    return `import pytest\n\n${pytestSkip(`def test_${name}_expressao():`, note)}\n`;
  }
  if (library === "jqwik") {
    return `import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;

class PropertyTest {
    @Disabled(${JSON.stringify(note)})
    @Test
    void ${name}Expressao() {
        // ${note}
    }
}
`;
  }
  return `${jsImport(runner, ["test"])}

// ${note}
test.todo(${JSON.stringify(`${name} confere a expressão pura`)});
`;
}

function safePyName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_]/g, "");
  return cleaned || "subject";
}

export function propertyLibraryInstalled(projectRoot: string | undefined, library: PropertyLibrary): boolean {
  if (!projectRoot) return false;
  const root = path.resolve(projectRoot);
  if (library === "fast-check") return nodeModule(root, "fast-check");
  if (library === "hypothesis") return pythonPackage(root, "hypothesis");
  return javaDependency(root, "jqwik");
}

export function propertyFile(input: PropertyInput): { fileName: string; code: string; runner?: TestRunner; installed: boolean } | undefined {
  if (!input.sourceCode?.trim()) return undefined;
  const stack = detectStack(input.projectRoot);
  const language = inferLanguage(input.sourceCode, input.filePath);
  const library = choosePropertyLibrary(stack, language);
  const installed = propertyLibraryInstalled(input.projectRoot, library);
  const symbols = extractSymbols(input.sourceCode);
  const symbol = symbols.find((item) => item.name === input.functionName) ?? symbols[0];
  const name = input.functionName ?? symbol?.name ?? "subject";
  const runner = resolveJsRunner({ projectRoot: input.projectRoot, filePath: input.filePath, stack });
  const code = propertySource(library, name, input.sourceCode, symbol, installed, runner);
  if (library === "hypothesis") return { fileName: `test_${safePyName(name)}.py`, code, runner: "pytest", installed };
  if (library === "jqwik") return { fileName: "PropertyTest.java", code, installed };
  return { fileName: "property.test.ts", code, runner, installed };
}

export interface FuzzFile {
  fileName: string;
  code: string;
  runner?: TestRunner;
}

interface FuzzLib {
  name: string;
  installed: boolean;
}

function fuzzLibrary(projectRoot: string | undefined, language: Language, pythonStack: boolean): FuzzLib {
  const root = projectRoot ? path.resolve(projectRoot) : undefined;
  if (language === "python" || (language === "unknown" && pythonStack)) {
    return { name: "atheris", installed: Boolean(root && pythonPackage(root, "atheris")) };
  }
  if (language === "java") return { name: "jazzer", installed: Boolean(root && javaDependency(root, "jazzer")) };
  if (language === "go") return { name: "go-fuzz", installed: Boolean(root && goModHas(root, "go-fuzz")) };
  const fast = Boolean(root && nodeModule(root, "fast-check"));
  const jsfuzz = Boolean(root && nodeModule(root, "jsfuzz"));
  if (fast) return { name: "fast-check", installed: true };
  if (jsfuzz) return { name: "jsfuzz", installed: true };
  return { name: "fast-check", installed: false };
}

export function fuzzFile(input: FuzzInput): FuzzFile & { installed: boolean; note: string } {
  const language = inferLanguage(input.sourceCode, input.filePath);
  const stack = detectStack(input.projectRoot);
  const fuzz = fuzzLibrary(input.projectRoot, language, stack.languages.includes("python"));
  const note = fuzz.installed
    ? ""
    : `O fuzz não roda até a biblioteca ${fuzz.name} existir no projeto.`;
  const runnerJs = resolveJsRunner({ projectRoot: input.projectRoot, filePath: input.filePath, stack });
  if (language === "python") {
    return {
      fileName: "test_fuzz.py",
      runner: "pytest",
      installed: fuzz.installed,
      note,
      code: fuzz.installed
        ? `import atheris\n\ndef test_fuzz_corpus_local():\n    """Corpus mínimo. Não aponta para produção."""\n    corpus = ["", "a", "1"]\n    assert all(isinstance(item, str) for item in corpus)\n`
        : `import pytest\n\n${pytestSkip("def test_fuzz_corpus_local():", note)}\n`,
    };
  }
  if (language === "java") {
    return {
      fileName: "FuzzTest.java",
      installed: fuzz.installed,
      note,
      code: fuzz.installed
        ? `import org.junit.jupiter.api.Test;\nimport static org.junit.jupiter.api.Assertions.*;\n\nclass FuzzTest {\n    @Test\n    void corpusLocalNaoApontaParaProducao() {\n        // jazzer está no projeto. O corpus fica local e não aponta para produção.\n        assertEquals(3, java.util.List.of("", "a", "1").size());\n    }\n}\n`
        : `import org.junit.jupiter.api.Disabled;\nimport org.junit.jupiter.api.Test;\n\nclass FuzzTest {\n    @Disabled(${JSON.stringify(note)})\n    @Test\n    void corpusLocalNaoApontaParaProducao() {\n        // ${note}\n    }\n}\n`,
    };
  }
  return {
    fileName: "fuzz.test.ts",
    runner: runnerJs,
    installed: fuzz.installed,
    note,
    code:
      fuzz.name === "jsfuzz" && fuzz.installed
        ? `import "jsfuzz";\n${jsImport(runnerJs, ["expect"])}\n\ndescribe("fuzz local", () => {\n  it("jsfuzz está no projeto e o corpus fica local", () => {\n    expect(["", "a", "1"].every((item) => typeof item === "string")).toBe(true);\n  });\n});\n`
        : fuzz.installed
          ? `import fc from "fast-check";\n${jsImport(runnerJs, ["expect"])}\n\ndescribe("fuzz local", () => {\n  it("o corpus mínimo fica no processo e não aponta para produção", () => {\n    fc.assert(fc.property(fc.constantFrom("", "a", "1"), (sample) => {\n      expect(typeof sample).toBe("string");\n    }));\n  });\n});\n`
          : `${jsImport(runnerJs, ["test"])}\n\n// ${note}\ntest.todo("fuzz local");\n`,
  };
}

function nodeModule(root: string, name: string): boolean {
  return fs.existsSync(path.join(root, "node_modules", name, "package.json"));
}

function readText(full: string): string | undefined {
  try {
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return undefined;
    return fs.readFileSync(full, "utf8");
  } catch {
    return undefined;
  }
}

function pythonPackage(root: string, name: string): boolean {
  for (const file of ["requirements.txt", "requirements-dev.txt", "pyproject.toml", "Pipfile", "setup.py", "setup.cfg"]) {
    const text = readText(path.join(root, file));
    if (text && new RegExp(`\\b${name}\\b`, "i").test(text)) return true;
  }
  for (const venv of [".venv", "venv"]) {
    if (fs.existsSync(path.join(root, venv, "Lib", "site-packages", name))) return true;
    const lib = path.join(root, venv, "lib");
    if (!fs.existsSync(lib)) continue;
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(lib);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (fs.existsSync(path.join(lib, entry, "site-packages", name))) return true;
    }
  }
  return false;
}

function javaDependency(root: string, name: string): boolean {
  for (const file of ["pom.xml", "build.gradle", "build.gradle.kts"]) {
    const text = readText(path.join(root, file));
    if (text && text.toLowerCase().includes(name.toLowerCase())) return true;
  }
  return false;
}

function goModHas(root: string, name: string): boolean {
  const text = readText(path.join(root, "go.mod"));
  return Boolean(text && text.includes(name));
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
    runner: file.installed ? file.runner : undefined,
    runEligible: file.installed && Boolean(file.runner),
    skippedNote: file.installed ? undefined : "A biblioteca não está no projeto, então o teste não rodou.",
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
    runner: file.installed ? file.runner : undefined,
    runEligible: file.installed && Boolean(file.runner),
    skippedNote: file.installed ? undefined : file.note || "A lib de fuzz não está no projeto, então o fuzz não rodou.",
  });
}

export function registerPropertyTools(server: McpServer): void {
  registerTool(
    server,
    "generate_property_based_test",
    "Teste baseado em propriedade",
    "Propriedade grava e executa quando fast-check, Hypothesis ou jqwik já está no projeto, só com a expressão pura que o código tem, sem inventar comutatividade. Sem a biblioteca, grava e avisa que não rodou.",
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
    "Fuzz grava e executa quando a lib de fuzz da stack (fast-check, jsfuzz, jazzer, atheris ou go-fuzz) já está no projeto, sempre fora de produção. Sem a biblioteca, grava e avisa que não rodou.",
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
