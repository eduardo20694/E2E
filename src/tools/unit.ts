import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { renderUnitTest } from "../lib/codegen.js";
import {
  chooseUnitFramework,
  detectStack,
  inferLanguage,
  stackSummary,
  type UnitFramework,
} from "../lib/detect.js";
import { doc, codeBlock } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";
import { extractImports, extractSymbols, moduleNameFromPath } from "../lib/symbols.js";
import { cursorRoots, readProjectFile, resolveProjectRoot } from "../lib/workspace.js";
import { persistGenerated } from "./execution.js";
import type { TestRunner } from "../lib/runner.js";

const frameworkEnum = z.enum(["jest", "vitest", "pytest", "junit", "rspec"]);

export interface GenerateUnitTestInput {
  sourceCode: string;
  framework?: UnitFramework;
  projectRoot?: string;
  filePath?: string;
  language?: string;
}

export interface BuiltUnitTest {
  result: ToolTextResult;
  code?: string;
  fileName?: string;
  framework?: UnitFramework;
}

export function buildUnitTest(input: GenerateUnitTestInput): BuiltUnitTest {
  if (!input.sourceCode?.trim()) {
    return { result: errorResult("generate_unit_test exige sourceCode com a função ou classe a testar, ou filePath de um arquivo no projeto.") };
  }

  const language = inferLanguage(input.sourceCode, input.filePath ?? input.language);
  const stack = detectStack(input.projectRoot);
  const choice = chooseUnitFramework(input.framework, stack, language);
  const symbols = extractSymbols(input.sourceCode);
  const imports = extractImports(input.sourceCode);
  const moduleName = moduleNameFromPath(input.filePath);
  const rendered = renderUnitTest({
    framework: choice.framework,
    symbols,
    moduleName,
    filePath: input.filePath,
    externalImports: imports.filter((item) => !item.local).map((item) => item.source),
  });

  const mockNote =
    imports.some((item) => !item.local)
      ? `Mocks sugeridos para dependências externas: ${imports
          .filter((item) => !item.local)
          .map((item) => `\`${item.source}\``)
          .join(", ")}.`
      : "Nenhuma dependência externa óbvia. Se a função chama I/O, injete a dependência e mocke só a borda.";

  return {
    result: textResult(
    doc([
      `# Teste unitário — \`${moduleName}\``,
      "Camada **mockada**. Sem rede, sem banco e sem produção. Dependência externa vira dublê.",
      choice.warning ? `> ${choice.warning}` : undefined,
      `**Framework:** ${choice.framework}`,
      `**Linguagem inferida:** ${language}`,
      `**Arquivo sugerido:** \`${rendered.fileName}\``,
      "## Stack detectada",
      stackSummary(stack),
      "## Símbolos",
      symbols.length
        ? symbols
            .map((symbol) => `- ${symbol.kind} \`${symbol.name}(${symbol.params.join(", ")})\`${symbol.async ? " async" : ""}`)
            .join("\n")
        : "- Nenhum símbolo extraído. O esqueleto usa `subject` para você apontar a unidade.",
      mockNote,
      "## Código",
      codeBlock(rendered.language, rendered.code),
      "## Casos que o esqueleto ainda não fecha",
      "- Substitua `toBeDefined` / `assert result is not None` pelo valor de negócio.",
      "- Acrescente partições de equivalência e limites se a função tiver números ou datas.",
      "- Um teste unitário não sobe banco, rede nem browser.",
      citeKnowledge(["unit-testing", "tdd", "black-white-gray-box"]),
    ]),
    ),
    code: rendered.code,
    fileName: rendered.fileName,
    framework: choice.framework,
  };
}

export function generateUnitTest(input: GenerateUnitTestInput): ToolTextResult {
  return buildUnitTest(input).result;
}

export function registerUnitTools(server: McpServer): void {
  registerTool(
    server,
    "generate_unit_test",
    "Gerar teste unitário",
    "Gera um teste unitário (Jest, Vitest, pytest, JUnit ou RSpec) a partir do código-fonte, com mocks quando há dependência externa. Detecta o framework do projeto antes de sugerir um.",
    {
      sourceCode: z.string().optional().describe("Código da função ou classe. Se vazio, lê filePath do disco."),
      framework: frameworkEnum.optional().describe("Framework pedido. Se omitido, usa o que estiver no projeto."),
      projectRoot: z.string().optional().describe("Raiz do projeto aberto no Cursor."),
      filePath: z.string().optional().describe("Caminho do arquivo de produção."),
      language: z.string().optional().describe("Dica de linguagem, se o arquivo ainda não tem extensão."),
      writeToProject: z.boolean().optional().describe("Grava o arquivo de teste ao lado do fonte."),
      run: z.boolean().optional().describe("Executa o teste gerado quando o runner é Vitest, Jest ou pytest."),
    },
    async (args) => {
      const input = args as unknown as GenerateUnitTestInput & { writeToProject?: boolean; run?: boolean };
      const hydrated = await hydrate(server, input);
      if ("isError" in hydrated && hydrated.isError) return hydrated;
      const ready = hydrated as GenerateUnitTestInput;
      const built = buildUnitTest(ready);
      if (built.result.isError || (!input.writeToProject && !input.run) || !built.code || !built.fileName) return built.result;
      return persistGenerated({
        projectRoot: ready.projectRoot,
        filePath: ready.filePath,
        fileName: built.fileName,
        code: built.code,
        runner: unitRunner(built.framework),
        write: input.writeToProject,
        run: input.run,
        preface: built.result.content[0]?.text ?? "",
      });
    },
    { readOnly: false },
  );
}

function unitRunner(framework?: UnitFramework): TestRunner | undefined {
  if (framework === "vitest" || framework === "jest" || framework === "pytest") return framework;
  return undefined;
}

async function hydrate(
  server: McpServer,
  input: GenerateUnitTestInput,
): Promise<GenerateUnitTestInput | ToolTextResult> {
  const resolved = await resolveProjectRoot({
    explicit: input.projectRoot,
    filePath: input.filePath,
    listRoots: () => cursorRoots(server),
  });
  const projectRoot = resolved.root ?? input.projectRoot;
  if (input.sourceCode?.trim() || !input.filePath || !projectRoot) {
    return { ...input, projectRoot };
  }
  try {
    return { ...input, projectRoot, sourceCode: readProjectFile(projectRoot, input.filePath) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(message);
  }
}
