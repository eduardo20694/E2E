import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectStack, inferLanguage, stackSummary } from "../lib/detect.js";
import { codeBlock, doc } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";
import { extractSymbols } from "../lib/symbols.js";
import type { ProjectContextInput } from "../lib/schema.js";

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
  const name = input.functionName ?? symbols[0]?.name ?? "subject";

  const code =
    library === "hypothesis"
      ? `from hypothesis import given, strategies as st

@given(st.integers(), st.integers())
def test_${name}_comuta(a, b):
    assert ${name}(a, b) == ${name}(b, a)
`
      : library === "jqwik"
        ? `@Property
void ${name}MantemInvariante(@ForAll int a, @ForAll int b) {
    Assertions.assertEquals(${name}(a, b), ${name}(b, a));
}
`
        : `import fc from "fast-check";
import { ${name} } from "./module";

it("${name} aceita inteiros sem lançar e respeita a inversa", () => {
  fc.assert(
    fc.property(fc.integer(), fc.integer(), (a, b) => {
      expect(${name}(${name}(a, b), 0)).toBeDefined();
    }),
  );
});
`;

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

export function registerPropertyTools(server: McpServer): void {
  registerTool(
    server,
    "generate_property_based_test",
    "Teste baseado em propriedade",
    "Sugere invariantes de uma função e gera um teste fast-check, Hypothesis ou jqwik conforme a stack.",
    {
      sourceCode: z.string(),
      functionName: z.string().optional(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
    },
    (args) => generatePropertyBasedTest(args as unknown as PropertyInput),
  );

  registerTool(
    server,
    "generate_fuzz_test",
    "Estratégia de fuzz",
    "Define fuzz de parser, endpoint ou formulário no ambiente local, com a ferramenta da stack. Não aponta para produção.",
    {
      target: z.string(),
      kind: z.enum(["parser", "endpoint", "form"]).optional(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
    },
    (args) => generateFuzzTest(args as unknown as FuzzInput),
  );
}
