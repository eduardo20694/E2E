import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectStack, stackSummary } from "../lib/detect.js";
import { doc } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";
import { writeShape, type ProjectContextInput } from "../lib/schema.js";
import { deliver, resolveToolRoot, type LoopFlags } from "./loop.js";

export interface ManagementInput extends ProjectContextInput {
  context?: string;
  usesJira?: boolean;
}

export function suggestTestManagementTool(input: ManagementInput): ToolTextResult {
  const blob = `${input.context ?? ""} ${input.sourceCode ?? ""}`;
  if (!blob.trim() && input.usesJira === undefined) {
    return errorResult("suggest_test_management_tool exige context ou usesJira.");
  }

  const stack = detectStack(input.projectRoot);
  const jira = input.usesJira || /jira|xray|zephyr/i.test(blob);
  const tool = /xray/i.test(blob) ? "Xray" : jira ? "Zephyr ou Xray, porque o caso fica no Jira" : "TestRail";

  return textResult(
    doc([
      `# Gestão de teste — ${tool}`,
      "## Stack detectada",
      stackSummary(stack),
      jira
        ? "O time já vive no Jira. Zephyr ou Xray evitam um segundo lugar para o caso manual. Xray se o ciclo de execução precisar de evidência colada no ticket."
        : "Sem Jira no contexto. TestRail guarda plano, execução e histórico sem obrigar o fluxo de issue.",
      "A ferramenta guarda o caso manual e o vínculo com o requisito. A automação continua no repositório. Duplicar o passo do Playwright dentro do TestRail cria dois lugares para mentir.",
      citeKnowledge(["test-management-tools"]),
    ]),
  );
}

export function suggestReportingSetup(input: ProjectContextInput): ToolTextResult {
  const stack = detectStack(input.projectRoot);
  const allure = stack.libraries.includes("allure") || stack.languages.includes("java") || stack.languages.includes("python");

  return textResult(
    doc([
      `# Relatório — ${allure ? "Allure" : "Allure"}`,
      "## Stack detectada",
      stackSummary(stack),
      allure
        ? "Allure encaixa no runner que o projeto já tem (JUnit, pytest, Vitest ou Jest) e publica o HTML no CI."
        : "Allure ainda é a opção padrão. ReportPortal entra se várias suítes e vários times precisarem de um histórico central com tendência.",
      "- Publique o relatório no job, não só na máquina de quem rodou local.",
      "- Falha com anexo (log, screenshot) no E2E. Unitário não precisa de screenshot.",
      "- Histórico de flaky mora no relatório. Sem histórico, cada falha parece a primeira.",
      citeKnowledge(["test-management-tools", "qa-metrics"]),
    ]),
  );
}

export function registerManagementTools(server: McpServer): void {
  registerTool(
    server,
    "suggest_test_management_tool",
    "Ferramenta de gestão de teste",
    "Gestão grava e não executa `docs/qa/gestao-de-teste.md` recomendando TestRail, Zephyr ou Xray conforme o uso de Jira.",
    {
      context: z.string().optional(),
      usesJira: z.boolean().optional(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
      ...writeShape,
    },
    async (args) => {
      const input = args as unknown as ManagementInput & LoopFlags;
      const root = await resolveToolRoot(server, input.projectRoot, input.filePath);
      const ready = { ...input, projectRoot: root ?? input.projectRoot };
      const result = suggestTestManagementTool(ready);
      if (result.isError) return result;
      return deliver({
        server,
        input: ready,
        preface: result,
        relativePath: "docs/qa/gestao-de-teste.md",
        contents: result.content[0]?.text ?? "",
      });
    },
    { readOnly: false },
  );

  registerTool(
    server,
    "suggest_reporting_setup",
    "Relatório de execução",
    "Relatório grava e não executa `docs/qa/relatorio.md` sugerindo Allure ou ReportPortal conforme a stack.",
    {
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
      ...writeShape,
    },
    async (args) => {
      const input = args as ProjectContextInput & LoopFlags;
      const root = await resolveToolRoot(server, input.projectRoot, input.filePath);
      const ready = { ...input, projectRoot: root ?? input.projectRoot };
      const result = suggestReportingSetup(ready);
      return deliver({
        server,
        input: ready,
        preface: result,
        relativePath: "docs/qa/relatorio.md",
        contents: result.content[0]?.text ?? "",
      });
    },
    { readOnly: false },
  );
}
