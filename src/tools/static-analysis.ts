import fs from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectStack, inferLanguage, stackSummary, type DetectedStack, type Language } from "../lib/detect.js";
import { codeBlock, doc } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { textResult, type ToolTextResult } from "../lib/result.js";
import { runShape, writeShape, type ProjectContextInput } from "../lib/schema.js";
import { runClosed, type ClosedCommandName } from "../lib/runner.js";
import { deliver, resolveToolRoot, resultText, type LoopFlags } from "./loop.js";

function sastLanguage(input: ProjectContextInput): Language {
  const stack = detectStack(input.projectRoot);
  return stack.languages[0] ?? inferLanguage(input.sourceCode, input.filePath);
}

export function suggestSastSetup(input: ProjectContextInput): ToolTextResult {
  const stack = detectStack(input.projectRoot);
  const language = sastLanguage(input);
  const eslint = stack.libraries.includes("eslint") || language === "typescript" || language === "javascript";
  const sonar = stack.libraries.includes("sonar");

  return textResult(
    doc([
      "# SAST",
      "## Stack detectada",
      stackSummary(stack),
      sonar
        ? "O quality gate é o sonar-project.properties existente. Nenhum outro config de SAST foi gravado."
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
  const dependabot = stack.libraries.includes("dependabot");
  const snyk = stack.libraries.includes("snyk");
  const ecosystem = packageEcosystem(input.projectRoot, stack);

  if (snyk && !dependabot) {
    return textResult(
      doc([
        "# SCA",
        "## Stack detectada",
        stackSummary(stack),
        "Snyk já está na stack e não há Dependabot. O gate continua o Snyk. Não invento outro gate: só `.snyk` com ignore vazio.",
        codeBlock("yaml", SNYK_POLICY),
        "Bloqueie CVE crítico no merge. Não transforme aviso baixo em falha vermelha: o time passa a ignorar o gate.",
        citeKnowledge(["sast-sca"]),
      ]),
    );
  }

  return textResult(
    doc([
      "# SCA",
      "## Stack detectada",
      stackSummary(stack),
      dependabot
        ? "Dependabot já está no repositório. O arquivo existente não é sobrescrito e nenhum outro gate é criado."
        : `Sem Dependabot detectado. O ecossistema do arquivo é \`${ecosystem}\`.`,
      snyk
        ? "Snyk também está referenciado. Não crio um segundo gate por cima do Dependabot."
        : "Snyk entra se a política da empresa exigir licença e CVE fora do ecossistema GitHub.",
      codeBlock("yaml", dependabotYaml(ecosystem)),
      "Bloqueie CVE crítico no merge. Não transforme aviso baixo em falha vermelha: o time passa a ignorar o gate.",
      citeKnowledge(["sast-sca"]),
    ]),
  );
}

function packageEcosystem(root: string | undefined, stack: DetectedStack): string {
  const has = (file: string) => Boolean(root && fs.existsSync(path.join(root, file)));
  if (has("package.json")) return "npm";
  if (stack.languages.includes("python") || has("requirements.txt") || has("pyproject.toml") || has("Pipfile")) return "pip";
  if (has("pom.xml") || has("build.gradle") || has("build.gradle.kts") || stack.languages.includes("java")) return "maven";
  if (has("go.mod") || stack.languages.includes("go")) return "gomod";
  if (has("Gemfile") || stack.languages.includes("ruby")) return "bundler";
  if (stack.languages.includes("typescript") || stack.languages.includes("javascript")) return "npm";
  return "npm";
}

function dependabotYaml(ecosystem: string): string {
  return `version: 2
updates:
  - package-ecosystem: ${ecosystem}
    directory: "/"
    schedule:
      interval: weekly
`;
}

const SNYK_POLICY = `version: v1.25.0
ignore: {}
`;

function sastFile(language: Language): { path: string; contents: string } {
  if (language === "python") {
    return {
      path: "bandit.yaml",
      contents: "skips: []\nexclude_dirs:\n  - tests\n  - .venv\n  - venv\n",
    };
  }
  if (language === "java") {
    return {
      path: "spotbugs-security.xml",
      contents: `<FindBugsFilter>
  <Match>
    <Bug category="SECURITY"/>
  </Match>
</FindBugsFilter>
`,
    };
  }
  if (language === "go") {
    return {
      path: "gosec.json",
      contents: "{\n  \"severity\": \"medium\",\n  \"confidence\": \"medium\"\n}\n",
    };
  }
  if (language === "ruby") {
    return {
      path: ".rubocop.security.yml",
      contents: "# Config novo. Não altera um RuboCop já existente.\nplugins:\n  - rubocop-performance\n",
    };
  }
  return {
    path: ".eslintrc.security.json",
    contents: "{\n  \"plugins\": [\"security\"],\n  \"extends\": [\"plugin:security/recommended-legacy\"]\n}\n",
  };
}

async function withRoot(server: McpServer, input: ProjectContextInput & LoopFlags): Promise<ProjectContextInput & LoopFlags> {
  const root = await resolveToolRoot(server, input.projectRoot, input.filePath);
  return { ...input, projectRoot: root ?? input.projectRoot };
}

async function handleSast(input: ProjectContextInput & LoopFlags, server: McpServer): Promise<ToolTextResult> {
  const ready = await withRoot(server, input);
  const stack = detectStack(ready.projectRoot);
  const result = suggestSastSetup(ready);
  const language = stack.languages[0] ?? inferLanguage(ready.sourceCode, ready.filePath);
  let delivered: ToolTextResult = result;
  if (!stack.libraries.includes("sonar")) {
    const file = sastFile(language);
    delivered = await deliver({
      server,
      input: ready,
      preface: result,
      relativePath: file.path,
      contents: file.contents,
      skipIfExists: true,
    });
  }
  if (delivered.isError || ready.run === false || !ready.projectRoot) {
    if (ready.run === false && !delivered.isError) {
      return textResult([resultText(delivered), "Não foi executado."].join("\n\n"));
    }
    return delivered;
  }
  const scan = await sastScan(ready.projectRoot, language);
  return textResult([resultText(delivered), scan].join("\n\n"));
}

async function sastScan(projectRoot: string, language: Language): Promise<string> {
  const command = sastCommand(language);
  if (command) return runClosed(projectRoot, command);
  if (language === "java") {
    return "Não há scanner local de Java neste projeto. O config foi gravado e o scanner não rodou.";
  }
  return "Não há scanner local para esta linguagem. O config foi gravado e o scanner não rodou.";
}

function sastCommand(language: Language): ClosedCommandName | undefined {
  if (language === "python") return "bandit";
  if (language === "go") return "gosec";
  if (language === "javascript" || language === "typescript") return "eslint";
  return undefined;
}

async function handleSca(input: ProjectContextInput & LoopFlags, server: McpServer): Promise<ToolTextResult> {
  const ready = await withRoot(server, input);
  const stack = detectStack(ready.projectRoot);
  const result = suggestScaSetup(ready);
  const ecosystem = packageEcosystem(ready.projectRoot, stack);
  const delivered =
    stack.libraries.includes("snyk") && !stack.libraries.includes("dependabot")
      ? await deliver({
          server,
          input: ready,
          preface: result,
          relativePath: ".snyk",
          contents: SNYK_POLICY,
          skipIfExists: true,
        })
      : await deliver({
          server,
          input: ready,
          preface: result,
          relativePath: ".github/dependabot.yml",
          contents: dependabotYaml(ecosystem),
          skipIfExists: true,
        });
  if (delivered.isError || ready.run === false || !ready.projectRoot) {
    if (ready.run === false && !delivered.isError) {
      return textResult([resultText(delivered), "Não foi executado."].join("\n\n"));
    }
    return delivered;
  }
  const scan = await scaScan(ready.projectRoot);
  return textResult([resultText(delivered), scan].join("\n\n"));
}

async function scaScan(projectRoot: string): Promise<string> {
  const parts: string[] = [];
  if (fs.existsSync(path.join(projectRoot, "package.json"))) {
    parts.push(await runClosed(projectRoot, "npm-audit"));
  }
  const pythonManifest = ["pyproject.toml", "requirements.txt", "Pipfile"].some((name) =>
    fs.existsSync(path.join(projectRoot, name)),
  );
  if (pythonManifest) parts.push(await runClosed(projectRoot, "pip-audit"));
  if (parts.length === 0) {
    return "Não há scanner local de SCA para este ecossistema. O arquivo foi gravado e o audit não rodou.";
  }
  return parts.join("\n\n");
}

export function registerStaticTools(server: McpServer): void {
  registerTool(
    server,
    "suggest_sast_setup",
    "Configurar SAST",
    "SAST grava o config da linguagem e executa eslint, bandit ou gosec quando o binário local já existe; sem binário, ou em Java sem scanner local, grava e não executa. Se já existe sonar-project.properties, não grava outro config. Vitest, Jest, Playwright, ESLint, Stryker e Cucumber só rodam se já estão em `node_modules` (não baixam pacote). k6, npm, Bandit e Gosec são CLI de máquina, procurados no PATH. Não há `npx`.",
    {
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
      ...writeShape,
      ...runShape,
    },
    (args) => handleSast(args as ProjectContextInput & LoopFlags, server),
    { readOnly: false },
  );

  registerTool(
    server,
    "suggest_sca_setup",
    "Configurar SCA",
    "SCA grava `.snyk` ou `.github/dependabot.yml` e executa `npm audit` ou `pip-audit` quando o binário já está instalado; sem binário, grava e não executa. Vitest, Jest, Playwright, ESLint, Stryker e Cucumber só rodam se já estão em `node_modules` (não baixam pacote). k6, npm, Bandit e Gosec são CLI de máquina, procurados no PATH. Não há `npx`.",
    {
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
      ...writeShape,
      ...runShape,
    },
    (args) => handleSca(args as ProjectContextInput & LoopFlags, server),
    { readOnly: false },
  );
}
