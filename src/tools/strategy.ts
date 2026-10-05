import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectStack, stackSummary } from "../lib/detect.js";
import { doc, markdownTable } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { pyramidBalance, scanPyramid, type PyramidCounts } from "../lib/pyramid.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";
import type { ProjectContextInput } from "../lib/schema.js";

export interface PyramidInput extends ProjectContextInput {
  counts?: { unit: number; integration: number; e2e: number; mocked?: number };
}

export function suggestTestPyramidBalance(input: PyramidInput): ToolTextResult {
  let counts: Pick<PyramidCounts, "unit" | "integration" | "e2e">;
  let mocked = 0;
  let sample = "";

  if (input.counts) {
    counts = input.counts;
    mocked = input.counts.mocked ?? 0;
  } else if (input.projectRoot) {
    const scanned = scanPyramid(input.projectRoot);
    counts = scanned;
    mocked = scanned.mocked;
    sample = (["unit", "integration", "e2e", "mocked"] as const)
      .map((bucket) => {
        const files = scanned.files[bucket];
        return files.length ? `**${bucket}:** ${files.join(", ")}` : undefined;
      })
      .filter(Boolean)
      .join("\n");
  } else {
    return errorResult("suggest_test_pyramid_balance exige projectRoot ou counts com unit, integration e e2e.");
  }

  const balance = pyramidBalance(counts);
  return textResult(
    doc([
      "# Pirâmide de testes",
      markdownTable(
        ["Camada", "Arquivos", "Fatia", "Referência"],
        [
          ["Unitário", String(counts.unit), `${balance.shares.unit}%`, "70%"],
          ["Integração", String(counts.integration), `${balance.shares.integration}%`, "20%"],
          ["E2E", String(counts.e2e), `${balance.shares.e2e}%`, "10%"],
        ],
      ),
      `Total da pirâmide (unitário + integração + E2E): ${balance.total}.`,
      `Mockado, fora da pirâmide: ${mocked}. Não entra na fatia E2E nem nesse total.`,
      balance.advice.map((item) => `- ${item}`).join("\n"),
      sample ? `## Amostra\n${sample}` : undefined,
      input.sourceCode ? "O código aberto não entra na contagem; a contagem usa arquivos de teste no disco ou os números informados." : undefined,
      citeKnowledge(["unit-testing", "integration-testing", "e2e-testing"]),
    ]),
  );
}

export interface RiskFeature {
  name: string;
  likelihood: number;
  impact: number;
  notes?: string;
}

export interface RiskInput {
  features: RiskFeature[];
  sourceCode?: string;
}

export function riskBasedPrioritization(input: RiskInput): ToolTextResult {
  if (!input.features?.length) {
    return errorResult("risk_based_prioritization exige features com likelihood e impact de 1 a 5.");
  }

  const ranked = [...input.features]
    .map((feature) => ({
      ...feature,
      score: feature.likelihood * feature.impact,
    }))
    .sort((left, right) => right.score - left.score || right.impact - left.impact);

  return textResult(
    doc([
      "# Prioridade baseada em risco",
      "Score = probabilidade × impacto. Empate desempata pelo impacto.",
      markdownTable(
        ["Ordem", "Funcionalidade", "Probabilidade", "Impacto", "Score", "Profundidade"],
        ranked.map((feature, index) => [
          String(index + 1),
          feature.name.replace(/\|/g, "/"),
          String(feature.likelihood),
          String(feature.impact),
          String(feature.score),
          depthFor(feature.score),
        ]),
      ),
      ranked
        .filter((feature) => feature.notes)
        .map((feature) => `- ${feature.name}: ${feature.notes}`)
        .join("\n") || undefined,
      input.sourceCode
        ? "Se o código aberto implementa um item de score alto, a automação dessa regra vem antes do polimento visual."
        : undefined,
      citeKnowledge(["shift-left", "shift-right", "qa-metrics"]),
    ]),
  );
}

function depthFor(score: number): string {
  if (score >= 15) return "unitário + integração + E2E + não funcional";
  if (score >= 8) return "unitário + integração";
  return "unitário ou teste manual exploratório";
}

export interface ShiftInput extends ProjectContextInput {
  context: string;
}

export function shiftLeftRightRecommendations(input: ShiftInput): ToolTextResult {
  if (!input.context?.trim()) {
    return errorResult("shift_left_right_recommendations exige context do projeto ou da mudança.");
  }

  const stack = detectStack(input.projectRoot);
  const unit = stack.unitFrameworks[0] ?? "o framework de unitário da linguagem";
  const e2e = stack.e2eFrameworks[0] ?? "Playwright";

  return textResult(
    doc([
      "# Shift-left e shift-right",
      `Contexto: ${input.context}`,
      "Shift-left previne antes do deploy. Shift-right detecta o que só o tráfego real mostra. Um não substitui o outro.",
      "## Stack detectada",
      stackSummary(stack),
      "## Antes do deploy (shift-left)",
      `- Regra de negócio em teste unitário com ${unit}, no mesmo pull request. Isso é mockado: sem rede e sem produção.`,
      "- Contrato e integração em ambiente real isolado (Testcontainers), ainda antes do merge.",
      `- E2E com ${e2e} em staging, dado fake, setup e teardown do próprio teste.`,
      input.sourceCode ? "- O arquivo aberto ganha o caso da ramificação que ele introduz, ainda no pull request." : undefined,
      "## Depois do deploy (shift-right)",
      "- Smoke em produção com conta sintética, logo após o deploy. Isso roda de verdade, sem mock do caminho crítico.",
      "- Canário ou feature flag com abort automático. Monitoramento sintético segue o caminho feliz o dia inteiro.",
      "- Dark launch compara a saída nova com a antiga sem expor o usuário e sem gravar duas vezes.",
      citeKnowledge(["shift-left", "shift-right", "test-environments"]),
    ]),
  );
}

export interface EnvironmentInput extends ProjectContextInput {
  pipeline?: string;
  context?: string;
}

export function environmentStrategyAdvisor(input: EnvironmentInput): ToolTextResult {
  const stack = detectStack(input.projectRoot);
  const pipeline = input.pipeline?.trim() || "dev → teste → staging → produção";
  const isolated = stack.hasTestcontainers || stack.hasDocker ? "Testcontainers" : "banco de teste descartável";

  return textResult(
    doc([
      "# O que roda em cada ambiente",
      input.context ? `Contexto: ${input.context}` : undefined,
      `Pipeline considerado: ${pipeline}.`,
      "Mock, ambiente real isolado e produção real respondem perguntas diferentes. Pular uma faixa deixa um tipo de defeito sem rede.",
      "## Stack detectada",
      stackSummary(stack),
      markdownTable(
        ["Ambiente", "O que executar", "Natureza"],
        [
          ["Dev", "Unitário e regra pura", "Mock. Sem rede, sem banco, sem produção."],
          ["Teste", `Integração e contrato com ${isolated}`, "Real isolado. Sobe e desce com o teste. Terceiros continuam mockados."],
          ["Staging", "E2E, acessibilidade da tela nova, smoke largo", "Ambiente real compartilhado, dado fake, setup e teardown."],
          ["Produção", "Smoke sintético, canário, flag, sintético 24/7, dark launch", "Real. Sem mock do caminho crítico. Blast radius e rollback obrigatórios."],
        ],
      ),
      stack.delivery.length
        ? `Entrega detectada (${stack.delivery.join(", ")}): o canário e o smoke pós-deploy encaixam nesse pipeline, não num servidor solto.`
        : "Nenhum CI ou manifesto Kubernetes detectado na raiz. O desenho acima continua válido; a automação do pós-deploy ainda não tem onde morar.",
      citeKnowledge(["test-environments", "shift-left", "shift-right"]),
    ]),
  );
}

export function registerStrategyTools(server: McpServer): void {
  registerTool(
    server,
    "suggest_test_pyramid_balance",
    "Equilíbrio da pirâmide",
    "Pirâmide lê arquivos de teste no disco, ou usa contagens informadas, e calcula sem gravar o rebalanceamento das camadas.",
    {
      projectRoot: z.string().optional(),
      counts: z
        .object({
          unit: z.number(),
          integration: z.number(),
          e2e: z.number(),
          mocked: z.number().optional(),
        })
        .optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
    },
    (args) => suggestTestPyramidBalance(args as unknown as PyramidInput),
  );

  registerTool(
    server,
    "risk_based_prioritization",
    "Priorização por risco",
    "Risco calcula e não grava a ordem das funcionalidades pelo produto de probabilidade e impacto.",
    {
      features: z
        .array(
          z.object({
            name: z.string(),
            likelihood: z.number().min(1).max(5),
            impact: z.number().min(1).max(5),
            notes: z.string().optional(),
          }),
        )
        .min(1),
      sourceCode: z.string().optional(),
    },
    (args) => riskBasedPrioritization(args as unknown as RiskInput),
  );

}
