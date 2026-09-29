import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectStack, inferLanguage, stackSummary } from "../lib/detect.js";
import { codeBlock, doc } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { textResult, type ToolTextResult } from "../lib/result.js";
import type { ProjectContextInput } from "../lib/schema.js";

export function suggestSastSetup(input: ProjectContextInput): ToolTextResult {
  const stack = detectStack(input.projectRoot);
  const language = inferLanguage(input.sourceCode, input.filePath);
  const eslint = stack.libraries.includes("eslint") || language === "typescript" || language === "javascript";
  const sonar = stack.libraries.includes("sonar");

  return textResult(
    doc([
      "# SAST",
      "## Stack detectada",
      stackSummary(stack),
      sonar
        ? "Já existe sonar-project.properties. Aponte o quality gate para código novo, não para zerar o legado num sprint."
        : "SonarQube entra como gate do CI. No dia a dia, a regra tem que falhar no editor.",
      eslint
        ? "ESLint já cabe nesta stack. Acrescente eslint-plugin-security nas regras de injeção, eval e caminho de arquivo."
        : `Para ${language}, use o analisador idiomático (SpotBugs/Error Prone em Java, Bandit em Python) além do Sonar.`,
      codeBlock(
        "json",
        `{
  "plugins": ["security"],
  "extends": ["plugin:security/recommended-legacy"]
}`,
      ),
      "SAST acha padrão perigoso no código. Não substitui o checklist de teste do fluxo de autorização.",
      citeKnowledge(["sast-sca"]),
    ]),
  );
}

export function suggestScaSetup(input: ProjectContextInput): ToolTextResult {
  const stack = detectStack(input.projectRoot);
  const dependabot = stack.libraries.includes("dependabot") || stack.delivery.includes("github-actions");
  const snyk = stack.libraries.includes("snyk");

  return textResult(
    doc([
      "# SCA",
      "## Stack detectada",
      stackSummary(stack),
      dependabot
        ? "GitHub Actions ou Dependabot já aparecem. O dependabot.yml cobre o pull request de dependência. Não empilhe outra ferramenta igual sem um motivo."
        : "Sem Dependabot detectado. Num repositório GitHub, ele é o caminho mais curto.",
      snyk
        ? "Snyk já está referenciado. Use-o como o gate de CVE crítico, alinhado à mesma política do Dependabot para não ter dois bloqueios contraditórios."
        : "Snyk entra se a política da empresa exigir licença e CVE fora do ecossistema GitHub.",
      codeBlock(
        "yaml",
        `version: 2
updates:
  - package-ecosystem: npm
    directory: "/"
    schedule:
      interval: weekly
`,
      ),
      "Bloqueie CVE crítico no merge. Não transforme aviso baixo em falha vermelha: o time passa a ignorar o gate.",
      citeKnowledge(["sast-sca"]),
    ]),
  );
}

export function registerStaticTools(server: McpServer): void {
  registerTool(
    server,
    "suggest_sast_setup",
    "Configurar SAST",
    "Sugere SonarQube e regras de segurança do ESLint, ou o analisador da linguagem, conforme a stack.",
    {
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
    },
    (args) => suggestSastSetup(args as ProjectContextInput),
  );

  registerTool(
    server,
    "suggest_sca_setup",
    "Configurar SCA",
    "Sugere Dependabot ou Snyk para vulnerabilidade de dependência, sem duplicar o que o repositório já tem.",
    {
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
    },
    (args) => suggestScaSetup(args as ProjectContextInput),
  );
}
