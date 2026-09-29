import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectStack, stackSummary } from "../lib/detect.js";
import { codeBlock, doc, markdownTable } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";
import type { ProjectContextInput } from "../lib/schema.js";

export interface PerformancePlanInput extends ProjectContextInput {
  target: string;
  tool?: "k6" | "jmeter" | "gatling";
  expectedRps?: number;
}

export function suggestPerformanceTestPlan(input: PerformancePlanInput): ToolTextResult {
  if (!input.target?.trim()) {
    return errorResult("suggest_performance_test_plan exige target (endpoint ou fluxo).");
  }

  const stack = detectStack(input.projectRoot);
  const detected = stack.performanceTools.includes("gatling")
    ? "gatling"
    : stack.performanceTools.includes("k6")
      ? "k6"
      : undefined;
  const tool = input.tool ?? detected ?? "k6";
  const rps = input.expectedRps && input.expectedRps > 0 ? input.expectedRps : 20;

  return textResult(
    doc([
      `# Plano de performance — ${tool}`,
      `Alvo: ${input.target}`,
      "Rode somente contra ambiente que você tem autorização para carregar. Não aponte o script para produção sem acordo de janela e teto.",
      "## Stack detectada",
      stackSummary(stack),
      "## Cenários",
      markdownTable(
        ["Cenário", "Perfil", "O que observa"],
        [
          ["Carga", `${rps} iterações/s por 5 min`, "latência p95 e taxa de erro estáveis"],
          ["Stress", `sobe até ${rps * 5}/s`, "ponto em que erro ou latência dispara"],
          ["Volume", "poucos usuários, massa grande", "tempo de consulta e crescimento de armazenamento"],
          ["Resistência", `${Math.max(1, Math.round(rps / 2))}/s por 1 h`, "vazamento de memória e conexão"],
        ],
      ),
      "## Critério de saída sugerido",
      `- p95 < 500 ms no cenário de carga e taxa de erro < 1% em ${input.target}. Ajuste o número ao SLO real.`,
      "## Script",
      codeBlock(tool === "gatling" ? "scala" : tool === "jmeter" ? "xml" : "js", scriptFor(tool, input.target, rps)),
      citeKnowledge(["functional-vs-non-functional", "test-environments"]),
    ]),
  );
}

function scriptFor(tool: string, target: string, rps: number): string {
  if (tool === "jmeter") {
    return `<ThreadGroup>
  <stringProp name="ThreadGroup.num_threads">${rps}</stringProp>
  <stringProp name="ThreadGroup.ramp_time">30</stringProp>
  <HTTPSamplerProxy>
    <stringProp name="HTTPSampler.path">${target}</stringProp>
  </HTTPSamplerProxy>
</ThreadGroup>`;
  }
  if (tool === "gatling") {
    return `setUp(
  scenario("${target}")
    .exec(http("alvo").get("${target}"))
    .inject(constantUsersPerSec(${rps}).during(300))
)`;
  }
  return `import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  scenarios: {
    carga: { executor: "constant-arrival-rate", rate: ${rps}, timeUnit: "1s", duration: "5m", preAllocatedVUs: 20 },
  },
  thresholds: { http_req_failed: ["rate<0.01"], http_req_duration: ["p(95)<500"] },
};

export default function () {
  const response = http.get("${target.startsWith("http") ? target : "http://127.0.0.1:3000"}");
  check(response, { "status 2xx": (res) => res.status >= 200 && res.status < 300 });
  sleep(1);
}`;
}

const OWASP = [
  ["A01", "Broken Access Control", "auth|permission|role|admin|idor", "Usuário A não lê nem altera recurso do usuário B. Perfil sem papel recebe 403."],
  ["A02", "Cryptographic Failures", "password|token|secret|jwt|tls", "Segredo não aparece em log, fixture versionada nem resposta de erro. Senha não é comparada em texto puro."],
  ["A03", "Injection", "sql|query|graphql|command|template", "Consulta parametrizada. Entrada com aspas e operadores não altera o resultado além da validação."],
  ["A04", "Insecure Design", "flow|checkout|limit|quota", "Limite de tentativa, cota e regra de negócio existem no servidor, não só na tela."],
  ["A05", "Security Misconfiguration", "cors|header|debug|env", "Debug desligado fora de dev. CORS não reflete origem arbitrária com credencial."],
  ["A06", "Vulnerable Components", "package|dependency|pom|requirements", "Dependência com CVE crítico bloqueia o pipeline. Não é um teste de tela."],
  ["A07", "Identification and Authentication Failures", "login|session|oauth|mfa", "Sessão expira, logout invalida o token e a mensagem de login não revela se o e-mail existe."],
  ["A08", "Software and Data Integrity Failures", "webhook|deserial|yaml|pickle", "Payload externo é validado antes de virar objeto. Atualização de artefato tem origem conferida."],
  ["A09", "Security Logging and Monitoring Failures", "log|audit|metric", "Falha de login e negação de acesso geram evento sem gravar senha ou token."],
  ["A10", "SSRF", "url|webhook|fetch|redirect", "URL informada pelo usuário não alcança rede interna nem metadados de nuvem."],
] as const;

export interface SecurityChecklistInput extends ProjectContextInput {
  context?: string;
}

export function suggestSecurityChecklist(input: SecurityChecklistInput): ToolTextResult {
  const blob = `${input.context ?? ""}\n${input.sourceCode ?? ""}\n${input.filePath ?? ""}`;
  if (!blob.trim()) {
    return errorResult("suggest_security_checklist exige context ou sourceCode do que será auditado.");
  }

  const rows = OWASP.map(([id, name, pattern, test]) => {
    const applies = new RegExp(pattern, "i").test(blob);
    return [id, name, applies ? "prioritário neste contexto" : "revisar mesmo assim", test];
  });

  return textResult(
    doc([
      "# Checklist OWASP Top 10 (2021) para teste",
      "Itens de verificação. Não são passos de ataque.",
      markdownTable(["ID", "Risco", "No contexto", "Teste"], rows),
      citeKnowledge(["functional-vs-non-functional"]),
    ]),
  );
}

export interface AccessibilityInput extends ProjectContextInput {
  screen?: string;
  level?: "A" | "AA" | "AAA";
}

export function suggestAccessibilityAudit(input: AccessibilityInput): ToolTextResult {
  const level = input.level ?? "AA";
  const screen = input.screen ?? input.filePath ?? "a tela informada";
  return textResult(
    doc([
      `# Auditoria de acessibilidade — WCAG 2.2 ${level}`,
      `Alvo: ${screen}`,
      "## Checagens",
      "- Nome acessível em botão, link e campo. Placeholder não substitui rótulo.",
      "- Contraste de texto e de componente no nível pedido.",
      "- Foco visível e ordem de tabulação igual à ordem visual.",
      "- Erro de formulário ligado ao campo, em texto, não só pela cor.",
      "- Alternativa para conteúdo que não é texto.",
      input.sourceCode ? "Há código de UI no contexto. Procure `div` clicável sem role e `img` sem alt." : undefined,
      "## Exemplo com axe-core e Playwright",
      codeBlock(
        "ts",
        `import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("não introduz violação grave", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});`,
      ),
      "axe cobre uma fatia automática. Teclado, leitor de tela e zoom continuam manuais.",
      citeKnowledge(["functional-vs-non-functional", "e2e-testing"]),
    ]),
  );
}

export interface CompatibilityInput {
  audience: string;
  platforms?: string[];
  sourceCode?: string;
}

export function suggestCompatibilityMatrix(input: CompatibilityInput): ToolTextResult {
  if (!input.audience?.trim()) {
    return errorResult("suggest_compatibility_matrix exige audience descrevendo o público.");
  }

  const audience = input.audience.toLowerCase();
  const mobileFirst = /mobile|celular|app|brasil|b2c/.test(audience);
  const enterprise = /empresa|b2b|corporativ|desktop|interno/.test(audience);
  const apple = /ios|iphone|mac|apple/.test(audience);

  const rows = [
    ["Chrome atual", "Android e desktop", "sim", "base"],
    ["Safari atual", apple || !enterprise ? "iOS" : "macOS", apple || mobileFirst ? "sim" : "amostra", "webkit diverge em data e scroll"],
    ["Firefox atual", "desktop", enterprise ? "sim" : "amostra", "empresas ainda padronizam Firefox"],
    ["Edge atual", "desktop", enterprise ? "sim" : "não", "motor Chromium; só se o público for corporativo"],
    ["Chrome - 1", "Android", mobileFirst ? "sim" : "amostra", "aparelho intermediário não atualiza no dia do release"],
    ["Viewport 360px", "telefone", mobileFirst ? "sim" : "amostra", "layout que só existe no desktop quebra aqui"],
  ];

  return textResult(
    doc([
      "# Matriz de compatibilidade",
      `Público: ${input.audience}`,
      input.platforms?.length ? `Plataformas pedidas: ${input.platforms.join(", ")}.` : undefined,
      markdownTable(["Alvo", "Onde", "Entrar na suíte", "Por quê"], rows),
      "Três combinações bem escolhidas acham mais defeito do que doze browsers iguais. Pairwise cabe se a lista crescer.",
      citeKnowledge(["functional-vs-non-functional", "mobile-testing", "test-design-techniques"]),
    ]),
  );
}

export function registerNonFunctionalTools(server: McpServer): void {
  registerTool(
    server,
    "suggest_performance_test_plan",
    "Plano de teste de performance",
    "Sugere cenários de carga, stress, volume e resistência, com script de exemplo em k6, JMeter ou Gatling.",
    {
      target: z.string().describe("URL ou nome do fluxo sob carga."),
      tool: z.enum(["k6", "jmeter", "gatling"]).optional(),
      expectedRps: z.number().optional().describe("Taxa esperada no cenário de carga."),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
    },
    (args) => suggestPerformanceTestPlan(args as unknown as PerformancePlanInput),
  );

  registerTool(
    server,
    "suggest_security_checklist",
    "Checklist de segurança",
    "Devolve o OWASP Top 10 (2021) como checklist de teste, marcando o que o código ou o contexto torna prioritário.",
    {
      context: z.string().optional().describe("Descrição do sistema ou da mudança."),
      sourceCode: z.string().optional(),
      filePath: z.string().optional(),
      projectRoot: z.string().optional(),
    },
    (args) => suggestSecurityChecklist(args as unknown as SecurityChecklistInput),
  );

  registerTool(
    server,
    "suggest_accessibility_audit",
    "Auditoria de acessibilidade",
    "Sugere checagens WCAG e um exemplo de axe-core no Playwright para a tela informada.",
    {
      screen: z.string().optional(),
      level: z.enum(["A", "AA", "AAA"]).optional(),
      sourceCode: z.string().optional(),
      filePath: z.string().optional(),
      projectRoot: z.string().optional(),
    },
    (args) => suggestAccessibilityAudit(args as unknown as AccessibilityInput),
  );

  registerTool(
    server,
    "suggest_compatibility_matrix",
    "Matriz de compatibilidade",
    "Sugere browsers e dispositivos a cobrir a partir do público-alvo, em vez de uma grade genérica.",
    {
      audience: z.string().describe("Quem usa o produto."),
      platforms: z.array(z.string()).optional(),
      sourceCode: z.string().optional(),
    },
    (args) => suggestCompatibilityMatrix(args as unknown as CompatibilityInput),
  );
}
