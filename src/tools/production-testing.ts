import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectStack, resolveJsRunner, type DetectedStack, stackSummary } from "../lib/detect.js";
import { jsImport, opaqueStatement } from "../lib/markers.js";
import { sampleArg } from "../lib/codegen.js";
import { codeBlock, doc, markdownTable, splitSteps } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { analyzeFunction, formatValue, parseSampleCode } from "../lib/oracle.js";
import { productionNotice } from "../lib/production.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";
import { runShape, writeShape, type ProjectContextInput } from "../lib/schema.js";
import { extractSymbols } from "../lib/symbols.js";
import type { TestRunner } from "../lib/runner.js";
import { deliver, resolveToolRoot, slug, type LoopFlags } from "./loop.js";

function chooseFlag(stack: ReturnType<typeof detectStack>): string {
  return stack.flags[0] ?? "unleash";
}

function chooseCanary(stack: ReturnType<typeof detectStack>): string {
  if (stack.delivery.includes("flagger")) return "flagger";
  if (stack.delivery.includes("argo-rollouts")) return "argo-rollouts";
  if (stack.delivery.includes("kubernetes") || stack.delivery.includes("helm")) return "argo-rollouts";
  return "argo-rollouts";
}

function canaryReason(stack: DetectedStack, tool: string): string {
  if (tool === "flagger") {
    return "O repositório referencia Flagger, então o controlador é o Flagger (flagger.app/v1beta1, kind: Canary), não o Argo Rollouts.";
  }
  if (stack.delivery.includes("argo-rollouts")) {
    return "O repositório referencia Argo Rollouts, então o controlador é o Argo Rollouts.";
  }
  if (stack.delivery.includes("kubernetes") || stack.delivery.includes("helm")) {
    return "Há Kubernetes ou Helm sem Flagger, então o controlador é o Argo Rollouts.";
  }
  return "Não há Flagger no repositório, então o controlador é o Argo Rollouts.";
}

function jsRunner(stack: DetectedStack): TestRunner | undefined {
  if (stack.unitFrameworks.includes("vitest")) return "vitest";
  if (stack.unitFrameworks.includes("jest")) return "jest";
  return undefined;
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
      codeBlock("ts", smokeScript(baseUrl)),
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
      `**Controlador:** ${tool}. ${canaryReason(stack, tool)}`,
      markdownTable(
        ["Passo", "Tráfego", "Abort"],
        [
          ["1", `${percent}% por 10 min`, "erro > 1% ou p95 > 2× a linha de base"],
          ["2", "25%", "o mesmo limite"],
          ["3", "100%", "análise continua por mais 15 min"],
        ],
      ),
      "## Manifesto",
      codeBlock("yaml", canaryManifest(tool, service, percent)),
      "Sem métrica de erro e latência, o canário é só um deploy lento. O manifesto não é aplicado.",
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
          ["equipe interna", "contas sintéticas e o time", input.successMetric ?? "fluxo feliz sem erro novo"],
          ["1", "amostra aleatória", "erro e latência iguais ao controle"],
          ["10 e 50", "aumenta só com o critério verde", "suporte não vê regressão do caminho antigo"],
          ["100", "flag ainda existe", "remover a flag é outro pull request, depois da calma"],
        ],
      ),
      "## Teste local das fatias",
      codeBlock("ts", flagTest(feature, stack).code),
      "O teste não chama o serviço de flag em produção.",
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

  return textResult(
    doc([
      "# Chaos — Chaos Mesh",
      productionNotice(`O experimento mexe em infraestrutura real: ${target}.`),
      "## Stack detectada",
      stackSummary(stack),
      "O artefato é um PodChaos do Chaos Mesh. Não é aplicado: sem kubectl e sem chaos no cluster.",
      codeBlock("yaml", chaosManifest(target)),
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
  const artifact = syntheticArtifact(stack, input.journey ?? "login sintético e leitura do painel", input.baseUrl ?? "https://app.example.com");
  const journey = input.journey ?? "login sintético e leitura do painel";
  const steps = splitSteps(journey);

  return textResult(
    doc([
      `# Monitoramento sintético — ${artifact.tool}`,
      productionNotice("Um robô executa a jornada em produção o dia inteiro, com a conta sintética."),
      "## Stack detectada",
      stackSummary(stack),
      `Jornada: ${journey}`,
      steps.map((step, index) => `${index + 1}. ${step}`).join("\n"),
      artifact.reason,
      codeBlock(artifact.language, artifact.contents),
      "O arquivo não é executado daqui.",
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
  const spec = darkLaunchTest(input);
  return textResult(
    doc([
      "# Dark launch",
      productionNotice(`${change} executa em paralelo ao caminho antigo, com o mesmo input real. O usuário continua vendo só o caminho antigo.`),
      "O spec compara localmente. Não executa contra produção.",
      codeBlock("ts", spec),
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

function smokeScript(baseUrl: string): string {
  return `import { test, expect } from "@playwright/test";

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
});`;
}

function canaryManifest(tool: string, service: string, percent: number): string {
  if (tool === "flagger") {
    return `apiVersion: flagger.app/v1beta1
kind: Canary
metadata:
  name: ${service}
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ${service}
  service:
    port: 80
  analysis:
    interval: 1m
    threshold: 5
    maxWeight: 100
    stepWeight: ${percent}
    metrics:
      - name: request-success-rate
        thresholdRange:
          min: 99
        interval: 1m
      - name: request-duration
        thresholdRange:
          max: 500
        interval: 1m
    webhooks:
      - name: rollback
        type: rollback
        url: http://flagger-loadtester/
`;
  }
  return `apiVersion: argoproj.io/v1alpha1
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
          query: histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{app="${service}"}[2m])) by (le))
  rollback: true`;
}

function flagTest(feature: string, stack: DetectedStack): { code: string; runner?: TestRunner } {
  const runner = jsRunner(stack);
  const sdk = stack.flags.find((flag) => flag === "unleash" || flag === "launchdarkly" || flag === "growthbook");
  const importLine = runner === "jest"
    ? `import { describe, it, expect } from "@jest/globals";`
    : `import { describe, it, expect } from "vitest";`;
  const sdkImport = sdk === "unleash"
    ? `import * as unleashSdk from "unleash-client";\n`
    : sdk === "launchdarkly"
      ? `import * as launchdarklySdk from "@launchdarkly/node-server-sdk";\n`
      : sdk === "growthbook"
        ? `import * as growthbookSdk from "@growthbook/growthbook";\n`
        : "";
  const sdkCheck = sdk === "unleash"
    ? `    expect(unleashSdk).toBeTruthy();\n`
    : sdk === "launchdarkly"
      ? `    expect(launchdarklySdk).toBeTruthy();\n`
      : sdk === "growthbook"
        ? `    expect(growthbookSdk).toBeTruthy();\n`
        : "";
  const code = `${importLine}
${sdkImport}
const fatias = ["equipe interna", 1, 10, 50, 100];

describe("flag ${feature.replace(/["\\]/g, "")}", () => {
  it("afirma o plano de fatias sem chamar o serviço de flag em produção", () => {
    expect(fatias).toEqual(["equipe interna", 1, 10, 50, 100]);
${sdkCheck}  });
});
`;
  return { code, runner };
}

function chaosManifest(target: string): string {
  const service = slug(target);
  return `apiVersion: chaos-mesh.org/v1alpha1
kind: PodChaos
metadata:
  name: ${service}-pod-failure
spec:
  action: pod-failure
  mode: one
  duration: 30s
  selector:
    labelSelectors:
      app: ${service}
`;
}

function syntheticArtifact(stack: DetectedStack, journey: string, baseUrl: string): {
  tool: string;
  reason: string;
  relativePath: string;
  contents: string;
  language: string;
} {
  if (stack.observability.includes("checkly")) {
    return {
      tool: "checkly",
      reason: "A stack já tem Checkly. O arquivo é checkly.config.ts com um browser check do fluxo.",
      relativePath: "checkly.config.ts",
      language: "ts",
      contents: checklyConfig(journey, baseUrl),
    };
  }
  if (stack.observability.includes("datadog")) {
    return {
      tool: "datadog",
      reason: "A stack já tem Datadog. O arquivo é um teste sintético com passos HTTP de health.",
      relativePath: "deploy/e2e/synthetic-datadog.yaml",
      language: "yaml",
      contents: datadogSynthetic(baseUrl),
    };
  }
  return {
    tool: "playwright",
    reason: "Não há Checkly nem Datadog. O spec reutiliza o smoke: health, conta sintética e test.skip sem segredo.",
    relativePath: "prod-tests/synthetic.spec.ts",
    language: "ts",
    contents: smokeScript(baseUrl),
  };
}

function checklyConfig(journey: string, baseUrl: string): string {
  const title = journey.replace(/["\\]/g, "").slice(0, 80);
  return `import { BrowserCheck } from "checkly/constructs";

new BrowserCheck("fluxo-sintetico", {
  name: "${title}",
  frequency: 10,
  locations: ["us-east-1"],
  code: {
    content: \`
      const { test, expect } = require("@playwright/test");
      test("fluxo sintético", async ({ page }) => {
        await page.goto(process.env.PROD_BASE_URL ?? "${baseUrl}");
      });
    \`,
  },
});
`;
}

function datadogSynthetic(baseUrl: string): string {
  return `apiVersion: datadoghq.com/v1
kind: SyntheticTest
metadata:
  name: synthetic-health
spec:
  type: api
  subtype: multi
  steps:
    - name: health
      subtype: http
      request:
        method: GET
        url: ${baseUrl.replace(/\/$/, "")}/health
      assertions:
        - type: statusCode
          operator: is
          target: 200
`;
}

function darkLaunchTest(input: DarkLaunchInput): string {
  const source = input.sourceCode ?? "";
  const functions = extractSymbols(source).filter((symbol) => symbol.kind === "function");
  const pure = functions.filter((symbol) => {
    const contract = analyzeFunction(
      source,
      symbol.name,
      symbol.params.map((name, index) => ({ name, value: parseSampleCode(sampleArg(name, index)) })),
    );
    return contract.pure && contract.evaluated;
  });
  if (pure.length >= 2) {
    const antigo = pure.find((symbol) => /antigo|old|legacy|atual/i.test(symbol.name)) ?? pure[0];
    const novo = pure.find((symbol) => symbol !== antigo && /novo|new|shadow/i.test(symbol.name)) ?? pure.find((symbol) => symbol !== antigo) ?? pure[1];
    const args = (symbol: typeof antigo) =>
      symbol.params.map((name, index) => formatValue(parseSampleCode(sampleArg(name, index)), "js")).join(", ");
    const specifier = input.filePath ? `../${input.filePath.replace(/\\/g, "/").replace(/\.[^.]+$/, "")}` : "./module";
    return `import { describe, it, expect } from "vitest";
import { ${antigo.name}, ${novo.name} } from "${specifier}";

describe("dark launch", () => {
  it("compara a sombra com o caminho antigo", () => {
    expect(${novo.name}(${args(novo)})).toEqual(${antigo.name}(${args(antigo)}));
  });
});
`;
  }
  const runner = resolveJsRunner({ projectRoot: input.projectRoot, filePath: input.filePath });
  const names = runner === "vitest" ? ["describe", "it", "expect"] : ["describe", "it"];
  return `${jsImport(runner, names)}

describe("dark launch", () => {
  it("a sombra não grava e não mostra ao usuário", () => {
    ${opaqueStatement(runner, "A sombra não grava e não mostra o resultado ao usuário.")}
  });
});
`;
}

async function rooted<T extends LoopFlags>(server: McpServer, input: T): Promise<T> {
  const root = await resolveToolRoot(server, input.projectRoot, input.filePath);
  return { ...input, projectRoot: root ?? input.projectRoot };
}

const NOT_RUN = "Não foi executado.";

export function registerProductionTools(server: McpServer): void {
  registerTool(
    server,
    "generate_smoke_test_prod",
    "Smoke em produção",
    "Smoke grava e não executa `prod-tests/smoke.spec.ts` com health-check e conta sintética, sem efeito colateral real em produção.",
    {
      flows: z.array(z.string()).optional().describe("Fluxos críticos. O padrão é health, login sintético e checkout sem cobrança."),
      baseUrl: z.string().optional(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
      ...writeShape,
    },
    async (args) => {
      const ready = await rooted(server, args as unknown as SmokeProdInput & LoopFlags);
      const result = generateSmokeTestProd(ready);
      if (result.isError) return result;
      return deliver({
        server,
        input: ready,
        preface: result,
        relativePath: "prod-tests/smoke.spec.ts",
        contents: smokeScript(ready.baseUrl ?? "https://app.example.com"),
        neverRun: true,
        skippedNote: NOT_RUN,
      });
    },
    { readOnly: false },
  );

  registerTool(
    server,
    "setup_canary_release",
    "Canary release",
    "Canário grava e não executa deploy/e2e/*-canary.yaml: Flagger se o repo tem Flagger, senão Argo Rollouts, com rollback e sem aplicar o manifesto.",
    {
      service: z.string().optional(),
      initialPercent: z.number().optional().describe("Percentual inicial, até 20."),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
      ...writeShape,
    },
    async (args) => {
      const ready = await rooted(server, args as unknown as CanaryInput & LoopFlags);
      const result = setupCanaryRelease(ready);
      if (result.isError) return result;
      const percent = ready.initialPercent && ready.initialPercent > 0 && ready.initialPercent <= 20 ? ready.initialPercent : 5;
      const service = ready.service ?? "api";
      const tool = chooseCanary(detectStack(ready.projectRoot));
      return deliver({
        server,
        input: ready,
        preface: result,
        relativePath: `deploy/e2e/${slug(service)}-canary.yaml`,
        contents: canaryManifest(tool, service, percent),
        neverRun: true,
        skippedNote: NOT_RUN,
      });
    },
    { readOnly: false },
  );

  registerTool(
    server,
    "setup_feature_flag_testing",
    "Teste com feature flag",
    "Flag grava e executa no runner local flags/*.test.ts com as fatias em toEqual, sem chamar serviço de flag em produção; sem Vitest ou Jest, grava e não executa.",
    {
      feature: z.string().optional(),
      successMetric: z.string().optional(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
      ...writeShape,
      ...runShape,
    },
    async (args) => {
      const ready = await rooted(server, args as unknown as FlagInput & LoopFlags);
      const result = setupFeatureFlagTesting(ready);
      if (result.isError) return result;
      const feature = ready.feature ?? "feature-nova";
      const file = flagTest(feature, detectStack(ready.projectRoot));
      return deliver({
        server,
        input: ready,
        preface: result,
        relativePath: `flags/${slug(feature)}.test.ts`,
        contents: file.code,
        runner: file.runner,
        runEligible: Boolean(file.runner),
        skippedNote: file.runner ? undefined : NOT_RUN,
      });
    },
    { readOnly: false },
  );

  registerTool(
    server,
    "setup_chaos_experiment",
    "Experimento de chaos",
    "Chaos grava e não executa deploy/e2e/chaos.yaml no formato Chaos Mesh (PodChaos); não aplica, não chama kubectl e não derruba o cluster.",
    {
      hypothesis: z.string().optional(),
      target: z.string().optional().describe("O que falha: um pod, uma dependência, latência."),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
      ...writeShape,
    },
    async (args) => {
      const ready = await rooted(server, args as unknown as ChaosInput & LoopFlags);
      const result = setupChaosExperiment(ready);
      if (result.isError) return result;
      return deliver({
        server,
        input: ready,
        preface: result,
        relativePath: "deploy/e2e/chaos.yaml",
        contents: chaosManifest(ready.target ?? "um pod da API"),
        neverRun: true,
        skippedNote: NOT_RUN,
      });
    },
    { readOnly: false },
  );

  registerTool(
    server,
    "setup_synthetic_monitoring",
    "Monitoramento sintético",
    "Sintético grava e não executa checkly.config.ts, deploy/e2e/synthetic-datadog.yaml ou prod-tests/synthetic.spec.ts, conforme a observabilidade do repo.",
    {
      journey: z.string().optional(),
      baseUrl: z.string().optional(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
      ...writeShape,
    },
    async (args) => {
      const ready = await rooted(server, args as unknown as SyntheticInput & LoopFlags);
      const result = setupSyntheticMonitoring(ready);
      if (result.isError) return result;
      const artifact = syntheticArtifact(
        detectStack(ready.projectRoot),
        ready.journey ?? "login sintético e leitura do painel",
        ready.baseUrl ?? "https://app.example.com",
      );
      return deliver({
        server,
        input: ready,
        preface: result,
        relativePath: artifact.relativePath,
        contents: artifact.contents,
        neverRun: true,
        skippedNote: NOT_RUN,
      });
    },
    { readOnly: false },
  );

  registerTool(
    server,
    "setup_dark_launch",
    "Dark launch",
    "Sombra grava e executa no runner local dark-launch/*.test.ts comparando duas funções puras, sem chamar produção; sem runner, grava e não executa.",
    {
      change: z.string().optional(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
      ...writeShape,
      ...runShape,
    },
    async (args) => {
      const ready = await rooted(server, args as unknown as DarkLaunchInput & LoopFlags);
      const result = setupDarkLaunch(ready);
      if (result.isError) return result;
      const runner = jsRunner(detectStack(ready.projectRoot));
      return deliver({
        server,
        input: ready,
        preface: result,
        relativePath: `dark-launch/${slug(ready.change ?? "dark-launch")}.test.ts`,
        contents: darkLaunchTest(ready),
        runner,
        runEligible: Boolean(runner),
        skippedNote: runner ? undefined : NOT_RUN,
      });
    },
    { readOnly: false },
  );

  registerTool(
    server,
    "production_incident_test_review",
    "Regressão a partir de incidente",
    "Incidente grava e não executa `docs/qa/incidente.md` apontando a camada que deveria ter pego o defeito de produção.",
    {
      incident: z.string().describe("O que aconteceu em produção, em linguagem natural."),
      detectedIn: z.string().optional(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
      ...writeShape,
    },
    async (args) => {
      const ready = await rooted(server, args as unknown as IncidentInput & LoopFlags);
      const result = productionIncidentTestReview(ready);
      if (result.isError) return result;
      return deliver({
        server,
        input: ready,
        preface: result,
        relativePath: "docs/qa/incidente.md",
        contents: result.content[0]?.text ?? "",
      });
    },
    { readOnly: false },
  );
}
