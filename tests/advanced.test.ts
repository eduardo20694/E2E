import { describe, expect, it } from "vitest";
import { generateLlmPromptTest, sampleSizePerVariant, suggestAbTestDesign, suggestModelTestingPlan } from "../src/tools/ai-ml-testing.js";
import {
  suggestFlakyTestQuarantine,
  suggestTestImpactAnalysis,
  suggestTestParallelization,
} from "../src/tools/ci-cd-optimization.js";
import { setupConsumerDrivenContracts } from "../src/tools/contract-testing-advanced.js";
import { setupDisasterRecoveryTest, suggestComplianceChecklist } from "../src/tools/disaster-recovery.js";
import { generateI18nTest } from "../src/tools/i18n-l10n.js";
import { generateFuzzTest, generatePropertyBasedTest } from "../src/tools/property-based.js";
import { calculateCostOfQuality, suggestAutomationRoi } from "../src/tools/quality-economics.js";
import { generateGoldenMasterTest, generateSnapshotTest } from "../src/tools/snapshot-golden-master.js";
import { suggestSastSetup, suggestScaSetup } from "../src/tools/static-analysis.js";
import { suggestReportingSetup, suggestTestManagementTool } from "../src/tools/test-management-tooling.js";
import {
  generateSyntheticData,
  suggestDataMaskingStrategy,
  suggestSeedingStrategy,
  setupServiceVirtualization,
} from "../src/tools/test-data.js";

function text(result: { content: Array<{ text: string }>; isError?: boolean }): string {
  expect(result.isError).toBeFalsy();
  return result.content[0].text;
}

describe("dados de teste", () => {
  it("gera e-mail sintético com semente", () => {
    const body = text(generateSyntheticData({ entity: "usuário", seed: 1, count: 2 }));
    expect(body).toContain("@example.com");
    expect(body).toContain("falso");
  });

  it("mascara e-mail", () => {
    const body = text(suggestDataMaskingStrategy({ fields: ["email", "titulo"] }));
    expect(body).toContain("mascarar");
  });

  it("sugere factory", () => {
    const body = text(suggestSeedingStrategy({ entities: ["usuário", "pedido"], filePath: "app.py" }));
    expect(body).toContain("factory_boy");
  });

  it("virtualiza terceiro e preserva o banco", () => {
    const body = text(setupServiceVirtualization({ dependency: "pagamentos" }));
    expect(body).toContain("wiremock");
    expect(body.toLowerCase()).toContain("banco");
  });
});

describe("propriedade e fuzz", () => {
  it("escolhe Hypothesis para Python", () => {
    const body = text(
      generatePropertyBasedTest({
        sourceCode: "def total(a, b):\n    return a + b\n",
        filePath: "total.py",
      }),
    );
    expect(body).toContain("hypothesis");
  });

  it("não manda fuzz para produção", () => {
    const body = text(generateFuzzTest({ target: "POST /orders", kind: "endpoint" }));
    expect(body.toLowerCase()).toContain("produção");
  });
});

describe("snapshot e golden master", () => {
  it("gera snapshot", () => {
    const body = text(generateSnapshotTest({ component: "CartSummary" }));
    expect(body).toContain("toMatchSnapshot");
  });

  it("grava baseline do legado", () => {
    const body = text(generateGoldenMasterTest({ sourceCode: "function run(input) { return input; }", entrypoint: "run" }));
    expect(body).toContain("golden/run.json");
  });
});

describe("SAST e SCA", () => {
  it("cita ESLint quando não há projeto", () => {
    const body = text(suggestSastSetup({ sourceCode: "export const a = 1;", filePath: "a.ts" }));
    expect(body).toContain("ESLint");
  });

  it("cita Dependabot", () => {
    const body = text(suggestScaSetup({}));
    expect(body).toContain("Dependabot");
  });
});

describe("i18n", () => {
  it("marca árabe como RTL", () => {
    const body = text(generateI18nTest({ locales: ["pt-BR", "ar"] }));
    expect(body).toContain("RTL");
    expect(body).toContain("BRL");
  });
});

describe("disaster e compliance", () => {
  it("mede RPO e RTO numa cópia", () => {
    const body = text(setupDisasterRecoveryTest({ system: "postgres", rpoMinutes: 15, rtoMinutes: 60 }));
    expect(body).toContain("15");
    expect(body).toContain("cópia");
  });

  it("cobre PCI quando o contexto é cartão", () => {
    const body = text(suggestComplianceChecklist({ context: "checkout com cartão" }));
    expect(body).toContain("PCI-DSS");
  });
});

describe("IA e ML", () => {
  it("pede fatia, não só a média", () => {
    const body = text(suggestModelTestingPlan({ model: "risco", task: "classificar pedido" }));
    expect(body.toLowerCase()).toContain("fatia");
  });

  it("calcula amostra do A/B", () => {
    expect(sampleSizePerVariant(0.1, 0.02)).toBe(3528);
    const body = text(
      suggestAbTestDesign({ metric: "conversão", baselineRate: 0.1, minimumDetectableEffect: 0.02 }),
    );
    expect(body).toContain("3528");
  });

  it("cobre prompt vazio e fora de escopo", () => {
    const body = text(generateLlmPromptTest({ prompt: "Responda só com JSON.", expectedFormat: "JSON" }));
    expect(body).toContain("fora de escopo");
    expect(body).toContain("JSON");
  });
});

describe("pipeline", () => {
  it("aponta o teste vizinho do arquivo alterado", () => {
    const body = text(suggestTestImpactAnalysis({ changedFiles: ["src/pricing.ts"] }));
    expect(body).toContain("pricing.test");
  });

  it("sugere shard", () => {
    const body = text(suggestTestParallelization({ testFiles: 40, workers: 4 }));
    expect(body.toLowerCase()).toContain("shard");
  });

  it("dá prazo para a quarentena", () => {
    const body = text(suggestFlakyTestQuarantine({ tests: ["checkout.spec.ts"] }));
    expect(body).toContain("14");
    expect(body).toContain("checkout.spec.ts");
  });
});

describe("gestão e contrato", () => {
  it("fica no Jira quando o time já está lá", () => {
    const body = text(suggestTestManagementTool({ context: "o time usa Jira", usesJira: true }));
    expect(body).toContain("Xray");
  });

  it("publica Allure", () => {
    const body = text(suggestReportingSetup({}));
    expect(body).toContain("Allure");
  });

  it("exige broker", () => {
    const body = text(setupConsumerDrivenContracts({ consumer: "web", provider: "orders" }));
    expect(body).toContain("broker");
    expect(body).toContain("web");
  });
});

describe("economia", () => {
  it("pesa defeito em produção", () => {
    const body = text(calculateCostOfQuality({ defects: { producao: 2 } }));
    expect(body).toContain("100");
  });

  it("recusa automação de tela frágil", () => {
    const body = text(
      suggestAutomationRoi({
        name: "checkout visual",
        runsPerMonth: 2,
        manualMinutes: 5,
        automationMinutes: 400,
        stability: 1,
      }),
    );
    expect(body).toContain("Não automatize");
  });

  it("aceita fluxo estável que roda todo dia", () => {
    const body = text(
      suggestAutomationRoi({
        name: "recalcular frete",
        runsPerMonth: 20,
        manualMinutes: 10,
        automationMinutes: 60,
        stability: 4,
      }),
    );
    expect(body).toContain("Vale automatizar");
  });
});
