import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectStack, stackSummary } from "../lib/detect.js";
import { codeBlock, doc, markdownTable, splitSteps } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { productionNotice } from "../lib/production.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";
import type { ProjectContextInput } from "../lib/schema.js";

function chooseFlag(stack: ReturnType<typeof detectStack>): string {
  return stack.flags[0] ?? "unleash";
}

function chooseCanary(stack: ReturnType<typeof detectStack>): string {
  if (stack.delivery.includes("flagger")) return "flagger";
  if (stack.delivery.includes("argo-rollouts")) return "argo-rollouts";
  if (stack.delivery.includes("kubernetes") || stack.delivery.includes("helm")) return "argo-rollouts";
  return "argo-rollouts";
}

function chooseSynthetic(stack: ReturnType<typeof detectStack>): string {
  if (stack.observability.includes("checkly")) return "checkly";
  if (stack.observability.includes("datadog")) return "datadog";
  if (stack.e2eFrameworks.includes("playwright")) return "playwright-agendado";
  return "checkly";
}

export interface SmokeProdInput extends ProjectContextInput {
  flows?: string[];
  baseUrl?: string;
}

export function generateSmokeTestProd(input: SmokeProdInput): ToolTextResult {
  const stack = detectStack(input.projectRoot);
  const flows = input.flows?.filter(Boolean).length
    ? input.flows.filter(Boolean)
    : ["health-check", "login com conta sintética", "leitura do checkout sem cobrar"];
  const baseUrl = input.baseUrl ?? "https://app.example.com";
  const runner = stack.e2eFrameworks[0] ?? "playwright";

  return textResult(
    doc([
      "# Smoke pós-deploy em produção",
      productionNotice("O smoke dispara contra a URL de produção logo depois do deploy."),
      "## Stack detectada",
      stackSummary(stack),
      `Runner sugerido: **${runner}**. Passos curtos, leitura ou conta sintética, timeout baixo.`,
      "## Fluxos",
      flows.map((flow, index) => `${index + 1}. ${flow}`).join("\n"),
      "## Script",
      codeBlock(
        "ts",
        `import { test, expect } from "@playwright/test";

const baseUrl = process.env.PROD_BASE_URL ?? "${baseUrl}";
const user = process.env.SYNTHETIC_USER;
const password = process.env.SYNTHETIC_PASSWORD;

test("health responde", async ({ request }) => {
  const response = await request.get(baseUrl + "/health");
  expect(response.ok()).toBeTruthy();
});

test("login sintético enxerga a área logada", async ({ page }) => {
  test.skip(!user || !password, "Defina SYNTHETIC_USER e SYNTHETIC_PASSWORD");
  await page.goto(baseUrl + "/login");
  await page.getByLabel("E-mail").fill(user!);
  await page.getByLabel("Senha").fill(password!);
  await page.getByRole("button", { name: /entrar/i }).click();
  await expect(page.getByRole("heading", { name: /painel/i })).toBeVisible();
});

test("checkout sintético não cobra", async ({ page }) => {
  test.skip(!user, "Sem conta sintética o checkout em produção não roda");
  await page.goto(baseUrl + "/checkout?synthetic=1");
  await expect(page.getByText(/ambiente de teste|pedido sintético/i)).toBeVisible();
});`,
      ),
      "Se o produto não tem pedido sintético, o smoke para antes do pagamento. Criar cobrança real para 'ver se passa' não é smoke.",
      input.sourceCode ? "O código aberto ajuda a nomear a rota. A URL continua sendo a de produção, não a do teste local." : undefined,
      citeKnowledge(["shift-right", "e2e-testing", "test-environments"]),
    ]),
  );
}

export interface CanaryInput extends ProjectContextInput {
  service?: string;
  initialPercent?: number;
}

export function setupCanaryRelease(input: CanaryInput): ToolTextResult {
  const stack = detectStack(input.projectRoot);
  const tool = chooseCanary(stack);
  const percent = input.initialPercent && input.initialPercent > 0 && input.initialPercent <= 20
    ? input.initialPercent
    : 5;
  const service = input.service ?? "api";

  return textResult(
    doc([
      `# Canary — ${tool}`,
      productionNotice(`Uma fração do tráfego real de \`${service}\` vai para a versão nova.`),
      "## Stack detectada",
      stackSummary(stack),
      stack.delivery.includes("flagger")
        ? "Flagger já aparece no repositório. O canário abaixo segue essa ferramenta."
        : `Ferramenta sugerida: **${tool}**. Spinnaker entra se o pipeline de vocês já for Spinnaker; não troque o deploy inteiro só pelo canário.`,
      markdownTable(
        ["Passo", "Tráfego", "Abort"],
        [
          ["1", `${percent}% por 10 min`, "erro > 1% ou p95 > 2× a linha de base"],
          ["2", "25%", "o mesmo limite"],
          ["3", "100%", "análise continua por mais 15 min"],
        ],
      ),
      "## Exemplo Argo Rollouts",
      codeBlock(
        "yaml",
        `apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: ${service}
spec:
  replicas: 4
  strategy:
    canary:
      steps:
        - setWeight: ${percent}
        - pause: { duration: 10m }
        - setWeight: 25
        - pause: { duration: 10m }
      analysis:
        templates:
          - templateName: ${service}-saude
        startingStep: 0
---
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: ${service}-saude
spec:
  metrics:
    - name: erro
      failureLimit: 1
      provider:
        prometheus:
          query: sum(rate(http_requests_total{app="${service}",code=~"5.."}[2m]))
    - name: latencia
      failureLimit: 1
      provider:
        prometheus:
          query: histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{app="${service}"}[2m])) by (le))`,
      ),
      "Flagger usa um Canary com a mesma ideia: analysis, webhook de métrica e rollback para o Deployment estável. Sem métrica de erro e latência, o canário é só um deploy lento.",
      citeKnowledge(["shift-right", "test-environments"]),
    ]),
  );
}

export interface FlagInput extends ProjectContextInput {
  feature?: string;
  successMetric?: string;
}

export function setupFeatureFlagTesting(input: FlagInput): ToolTextResult {
  const stack = detectStack(input.projectRoot);
  const tool = chooseFlag(stack);
  const feature = input.feature ?? "feature-nova";

  return textResult(
    doc([
      `# Feature flag em produção — ${tool}`,
      productionNotice(`A flag \`${feature}\` liga código novo para usuários reais, em fatias.`),
      "## Stack detectada",
      stackSummary(stack),
      stack.flags.length
        ? `O projeto já referencia ${stack.flags.join(", ")}. Não introduza um segundo sistema de flag.`
        : "Nenhuma flag detectada. Unleash é o padrão sugerido por ser auto-hospedável. LaunchDarkly e GrowthBook seguem o mesmo desenho de percentual e critério.",
      markdownTable(
        ["Fatia", "Quem", "Critério para avançar"],
        [
          ["equipe", "contas sintéticas e o time", input.successMetric ?? "fluxo feliz sem erro novo"],
          ["1%", "amostra aleatória", "erro e latência iguais ao controle"],
          ["10% e 50%", "aumenta só com o critério verde", "suporte não vê regressão do caminho antigo"],
          ["100%", "flag ainda existe", "remover a flag é outro pull request, depois da calma"],
        ],
      ),
      "## O que o teste prova",
      "- Flag desligada: comportamento antigo, byte a byte no que o usuário vê.",
      "- Flag ligada na conta sintética: caminho novo, em produção, sem esperar o percentual.",
      "- Os dois caminhos convivem. O teste de staging não enxerga a combinação de flag com dado real.",
      citeKnowledge(["shift-right", "shift-left"]),
    ]),
  );
}

export interface ChaosInput extends ProjectContextInput {
  hypothesis?: string;
  target?: string;
}

export function setupChaosExperiment(input: ChaosInput): ToolTextResult {
  const stack = detectStack(input.projectRoot);
  const target = input.target ?? "um pod da API";
  const tool = stack.delivery.includes("kubernetes") ? "litmus" : "experimento manual no canário";

  return textResult(
    doc([
      `# Chaos — ${tool}`,
      productionNotice(`O experimento mexe em infraestrutura real: ${target}.`),
      "## Stack detectada",
      stackSummary(stack),
      "Ferramentas comuns: Litmus ou Chaos Mesh no Kubernetes, Gremlin quando o contrato da empresa já é esse. O primeiro experimento não é 'derrubar a rede do cluster'.",
      "## Ficha do experimento",
      `- Hipótese: ${input.hypothesis ?? "se uma instância cair, o erro do serviço fica abaixo de 1% e o cliente repete com sucesso."}`,
      `- Estado estável: taxa de erro e p95 dos 15 min anteriores.`,
      `- Ação: encerrar ${target} por no máximo 2 minutos.`,
      "- Blast radius: um pod, um namespace, fora do pico. Nunca o cluster inteiro na primeira vez.",
      "- Abort: erro acima do limite, fila crescendo, ou uma pessoa no canal dizendo para parar.",
      "- Resultado: a hipótese segurou, ou virou item de correção com teste de integração da retry.",
      input.sourceCode
        ? "O código aberto mostra o cliente da dependência. O experimento observa esse caminho sob falha real, não um mock de timeout."
        : undefined,
      citeKnowledge(["shift-right", "test-environments"]),
    ]),
  );
}

export interface SyntheticInput extends ProjectContextInput {
  journey?: string;
  baseUrl?: string;
}

export function setupSyntheticMonitoring(input: SyntheticInput): ToolTextResult {
  const stack = detectStack(input.projectRoot);
  const tool = chooseSynthetic(stack);
  const journey = input.journey ?? "login sintético e leitura do painel";
  const steps = splitSteps(journey);

  return textResult(
    doc([
      `# Monitoramento sintético — ${tool}`,
      productionNotice("Um robô executa a jornada em produção o dia inteiro, com a conta sintética."),
      "## Stack detectada",
      stackSummary(stack),
      `Jornada: ${journey}`,
      steps.map((step, index) => `${index + 1}. ${step}`).join("\n"),
      tool === "playwright-agendado"
        ? "Playwright já está no projeto. Agende o mesmo spec do smoke a cada 5 minutos, com alerta. Não aumente o paralelismo: isto não é teste de carga."
        : `${tool} publica a jornada e alerta quando o passo quebra. Datadog Synthetics e Checkly fazem o mesmo papel.`,
      "## Alerta",
      "- Duas falhas seguidas, não uma. Uma falha isolada é rede do ponto de presença.",
      "- O alerta diz o passo, a região e o horário. Sem isso ninguém distingue produto de rota.",
      "- A conta sintética não pode expirar senha junto com a política de cliente real sem um dono.",
      citeKnowledge(["shift-right", "e2e-testing"]),
    ]),
  );
}

export interface DarkLaunchInput extends ProjectContextInput {
  change?: string;
}

export function setupDarkLaunch(input: DarkLaunchInput): ToolTextResult {
  const change = input.change ?? "a implementação nova";
  return textResult(
    doc([
      "# Dark launch",
      productionNotice(`${change} executa em paralelo ao caminho antigo, com o mesmo input real. O usuário continua vendo só o caminho antigo.`),
      "## Regras",
      "- O caminho novo não grava, não cobra e não envia mensagem. Se gravar, não é dark launch, é dupla escrita.",
      "- Compare status, corpo relevante e tempo. Guarde a diferença, não o payload com dado pessoal.",
      "- Orçamento de diferença: por exemplo, menos de 0,1% de divergência por uma hora antes de expor.",
      "- Quando a diferença for a esperada (bug corrigido), aí sim a flag ou o canário expõe o caminho novo.",
      input.sourceCode
        ? "O código aberto é o candidato a caminho sombra. A resposta servida ao usuário permanece a do código que já está em produção."
        : undefined,
      citeKnowledge(["shift-right", "api-contract-testing"]),
    ]),
  );
}

export interface IncidentInput extends ProjectContextInput {
  incident: string;
  detectedIn?: string;
}

export function productionIncidentTestReview(input: IncidentInput): ToolTextResult {
  if (!input.incident?.trim()) {
    return errorResult("production_incident_test_review exige incident descrevendo o que quebrou em produção.");
  }

  const stack = detectStack(input.projectRoot);
  const blob = `${input.incident} ${input.detectedIn ?? ""} ${input.sourceCode ?? ""}`;
  const layer = /timeout|latência|latency|5\d\d|queda|pod|oom|escala/i.test(blob)
    ? "produção / resiliência"
    : /tela|botão|browser|usuário viu|layout/i.test(blob)
      ? "E2E em staging e smoke em produção"
      : /sql|banco|fila|evento|integra/i.test(blob)
        ? "integração com ambiente real isolado"
        : "unitário da regra";

  return textResult(
    doc([
      "# Regressão a partir do incidente",
      productionNotice("O defeito já aconteceu com tráfego real. O teste novo precisa falhar se a mesma condição voltar."),
      `Onde apareceu: ${input.detectedIn ?? "produção, detalhe não informado"}.`,
      `## Onde o teste deveria ter existido\n**${layer}.**`,
      layer.startsWith("unitário")
        ? "Shift-left teria pegado se a regra tivesse um caso com o dado que produção recebeu. Staging não vê esse dado."
        : "Parte do furo é pré-deploy (faltou o caso) e parte só aparece com escala ou integração real. Escreva os dois, não escolha um.",
      "## Caso de regressão",
      codeBlock(
        "gherkin",
        `# language: pt
Funcionalidade: regressão do incidente
  Cenário: a falha de produção não volta
    Dado o estado descrito no incidente
    Quando ${input.incident.split(/(?<=[.!;])\s+/)[0] ?? "a mesma ação ocorre"}
    Então o sistema responde como a regra exige
    E nenhum efeito colateral extra é cometido`,
      ),
      "## O que acrescentar além do caso",
      "- Unitário ou integração isolada com o input que produção teve, anonimizado.",
      "- Smoke ou sintético se o sintoma foi 'o caminho crítico ficou mudo'.",
      "- Alerta da métrica que teria encurtado o tempo até a restauração.",
      stack.found ? stackSummary(stack) : undefined,
      citeKnowledge(["shift-right", "shift-left", "qa-metrics"]),
    ]),
  );
}

export function registerProductionTools(server: McpServer): void {
  registerTool(
    server,
    "generate_smoke_test_prod",
    "Smoke em produção",
    "Gera um smoke curto para depois do deploy, contra produção, só com health-check e conta sintética, sem efeito colateral real.",
    {
      flows: z.array(z.string()).optional().describe("Fluxos críticos. O padrão é health, login sintético e checkout sem cobrança."),
      baseUrl: z.string().optional(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
    },
    (args) => generateSmokeTestProd(args as unknown as SmokeProdInput),
  );

  registerTool(
    server,
    "setup_canary_release",
    "Canary release",
    "Sugere canário com percentual, métrica de abort e rollback. Prefere Flagger ou Argo Rollouts se o repositório já tiver isso.",
    {
      service: z.string().optional(),
      initialPercent: z.number().optional().describe("Percentual inicial, até 20."),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
    },
    (args) => setupCanaryRelease(args as unknown as CanaryInput),
  );

  registerTool(
    server,
    "setup_feature_flag_testing",
    "Teste com feature flag",
    "Desenha o rollout gradual de uma flag em produção (LaunchDarkly, Unleash ou GrowthBook) e o critério para avançar cada fatia.",
    {
      feature: z.string().optional(),
      successMetric: z.string().optional(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
    },
    (args) => setupFeatureFlagTesting(args as unknown as FlagInput),
  );

  registerTool(
    server,
    "setup_chaos_experiment",
    "Experimento de chaos",
    "Monta um experimento de chaos com hipótese, blast radius e abort. Não propõe derrubar o cluster inteiro.",
    {
      hypothesis: z.string().optional(),
      target: z.string().optional().describe("O que falha: um pod, uma dependência, latência."),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
    },
    (args) => setupChaosExperiment(args as unknown as ChaosInput),
  );

  registerTool(
    server,
    "setup_synthetic_monitoring",
    "Monitoramento sintético",
    "Gera a jornada que um robô repete em produção o dia inteiro, com Checkly, Datadog Synthetics ou Playwright agendado.",
    {
      journey: z.string().optional(),
      baseUrl: z.string().optional(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
    },
    (args) => setupSyntheticMonitoring(args as unknown as SyntheticInput),
  );

  registerTool(
    server,
    "setup_dark_launch",
    "Dark launch",
    "Descreve como rodar código novo em paralelo ao antigo em produção, comparando saída sem expor o usuário e sem gravar duas vezes.",
    {
      change: z.string().optional(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
    },
    (args) => setupDarkLaunch(args as unknown as DarkLaunchInput),
  );

  registerTool(
    server,
    "production_incident_test_review",
    "Regressão a partir de incidente",
    "Lê um incidente de produção e aponta a camada que deveria ter pego o problema, com um caso de regressão.",
    {
      incident: z.string().describe("O que aconteceu em produção, em linguagem natural."),
      detectedIn: z.string().optional(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
    },
    (args) => productionIncidentTestReview(args as unknown as IncidentInput),
  );
}
