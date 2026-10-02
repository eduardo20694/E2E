import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generatePairwise } from "../src/lib/pairwise.js";
import { generateApiTest } from "../src/tools/api.js";
import { generateGherkinScenario } from "../src/tools/bdd.js";
import {
  boundaryValueAnalysis,
  equivalencePartitioning,
  buildDecisionTable,
  pairwiseTestGenerator,
  stateTransitionTest,
} from "../src/tools/design-techniques.js";
import { generateE2eTest } from "../src/tools/e2e.js";
import { generateIntegrationTest } from "../src/tools/integration.js";
import { codeCoverageAdvisor, defectDensityReport, flakinessAnalyzer, mttrReport } from "../src/tools/metrics.js";
import {
  generateSmokeTestProd,
  productionIncidentTestReview,
  setupCanaryRelease,
  setupChaosExperiment,
} from "../src/tools/production-testing.js";
import { generateMobileTest } from "../src/tools/mobile.js";
import { mutationTestingReport } from "../src/tools/mutation.js";
import {
  suggestAccessibilityAudit,
  suggestCompatibilityMatrix,
  suggestPerformanceTestPlan,
  suggestSecurityChecklist,
} from "../src/tools/non-functional.js";
import {
  environmentStrategyAdvisor,
  riskBasedPrioritization,
  shiftLeftRightRecommendations,
  suggestTestPyramidBalance,
} from "../src/tools/strategy.js";
import {
  generateBugReport,
  generateTestPlan,
  generateTraceabilityMatrix,
} from "../src/tools/test-plan.js";
import { generateUnitTest } from "../src/tools/unit.js";
import { visualRegressionSetup } from "../src/tools/visual-regression.js";

function text(result: { content: Array<{ text: string }>; isError?: boolean }): string {
  expect(result.isError).toBeFalsy();
  return result.content[0].text;
}

describe("generate_unit_test", () => {
  it("gera Vitest para TypeScript quando o projeto não é informado", () => {
    const body = text(
      generateUnitTest({
        sourceCode: "export function add(a: number, b: number) { return a + b; }",
        filePath: "src/add.ts",
      }),
    );
    expect(body).toContain("vitest");
    expect(body).toContain("add");
    expect(body).toContain("e2e://knowledge/unit-testing");
  });

  it("não sugere Jest para código Python", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-py-"));
    fs.writeFileSync(path.join(root, "requirements.txt"), "pytest==8.0.0\n");
    const body = text(
      generateUnitTest({
        sourceCode: "def add(a, b):\n    return a + b\n",
        filePath: "app/add.py",
        projectRoot: root,
      }),
    );
    expect(body).toContain("pytest");
    expect(body).not.toContain("from \"vitest\"");
  });
});

describe("generate_integration_test", () => {
  it("sugere Testcontainers quando há Postgres", () => {
    const body = text(
      generateIntegrationTest({
        description: "A API grava o pedido no postgres",
        modules: ["orders-api", "orders-db"],
        database: "postgres",
      }),
    );
    expect(body.toLowerCase()).toContain("testcontainers");
  });
});

describe("generate_e2e_test", () => {
  it("mantém o erro sem controle e sem fluxo", () => {
    const result = generateE2eTest({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Sem controle e sem fluxo");
  });

  it("pede o arquivo da tela quando só há userFlow", () => {
    const result = generateE2eTest({
      userFlow: "Abrir a home. Entrar com o usuário. Ver o painel.",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text.toLowerCase()).toContain("arquivo da tela");
    expect(result.content[0].text).not.toContain("toHaveURL");
  });
});

describe("generate_api_test", () => {
  it("detecta GraphQL pelo texto", () => {
    const body = text(
      generateApiTest({
        specification: "mutation CreateOrder { createOrder(id: $id) { id } }",
      }),
    );
    expect(body).toContain("GRAPHQL");
    expect(body).toContain("errors");
  });
});

describe("generate_mobile_test", () => {
  it("gera sessão Appium", () => {
    const body = text(generateMobileTest({ flow: "Abrir o app e concluir o login." }));
    expect(body).toContain("4723");
    expect(body).toContain("Android");
  });
});

describe("técnicas de design", () => {
  it("cobre as bordas de 18 a 65", () => {
    const body = text(boundaryValueAnalysis({ rule: "idade entre 18 e 65", variable: "idade" }));
    expect(body).toContain("17");
    expect(body).toContain("66");
    expect(body).toContain("18");
  });

  it("devolve classes de equivalência", () => {
    const body = text(equivalencePartitioning({ domain: "idade entre 18 e 65" }));
    expect(body).toContain("abaixo de 18");
    expect(body).toContain("acima de 65");
  });

  it("monta tabela de decisão", () => {
    const body = text(
      buildDecisionTable({
        conditions: [
          { name: "logado", values: ["sim", "não"] },
          { name: "estoque", values: ["sim", "não"] },
        ],
        actions: ["vender", "recusar"],
        rules: [{ when: { logado: "sim", estoque: "sim" }, then: ["vender"] }],
      }),
    );
    expect(body).toContain("vender");
    expect(body).toContain("não");
  });

  it("gera transição válida e inválida", () => {
    const body = text(stateTransitionTest({ diagram: "criado -> pago -> enviado" }));
    expect(body).toContain("Estados: criado, pago, enviado");
    expect(body).toContain("inválida");
  });

  it("reduz o cartesiano no pairwise", () => {
    const parameters = [
      { name: "os", values: ["windows", "mac"] },
      { name: "browser", values: ["chrome", "firefox"] },
      { name: "tela", values: ["1080", "720"] },
    ];
    const math = generatePairwise(parameters);
    expect(math.rows.length).toBeLessThan(8);
    expect(math.covered).toBe(math.pairCount);

    const body = text(pairwiseTestGenerator({ parameters }));
    expect(body).toContain("windows");
    expect(body).toContain("firefox");
  });
});

describe("não funcionais", () => {
  it("inclui script k6", () => {
    const body = text(suggestPerformanceTestPlan({ target: "http://127.0.0.1:3000/health", expectedRps: 10 }));
    expect(body).toContain("k6");
    expect(body).toContain("thresholds");
  });

  it("marca criptografia quando o código fala de senha", () => {
    const body = text(suggestSecurityChecklist({ sourceCode: "function login(password: string) { return password; }" }));
    expect(body).toContain("Cryptographic Failures");
    expect(body).toContain("prioritário neste contexto");
  });

  it("cita axe-core", () => {
    const body = text(suggestAccessibilityAudit({ screen: "checkout" }));
    expect(body).toContain("axe-core");
    expect(body).toContain("WCAG");
  });

  it("prioriza mobile para público B2C", () => {
    const body = text(suggestCompatibilityMatrix({ audience: "consumidor mobile no Brasil" }));
    expect(body).toContain("360px");
  });
});

describe("mutation e visual", () => {
  it("explica score baixo do Stryker", () => {
    const body = text(mutationTestingReport({ currentScore: 40, language: "typescript" }));
    expect(body).toContain("Stryker");
    expect(body).toContain("40%");
  });

  it("usa mutmut em Python", () => {
    const body = text(mutationTestingReport({ language: "python" }));
    expect(body).toContain("mutmut");
  });

  it("sugere Percy por padrão", () => {
    const body = text(visualRegressionSetup({}));
    expect(body).toContain("percy");
  });
});

describe("plano, defeito e gherkin", () => {
  it("gera plano com critério de saída", () => {
    const body = text(generateTestPlan({ feature: "checkout", deadline: "sexta" }));
    expect(body).toContain("Critérios de saída");
    expect(body).toContain("sexta");
  });

  it("sobe severidade quando há crash", () => {
    const body = text(generateBugReport({ description: "A tela de pagamento dá crash ao confirmar." }));
    expect(body).toContain("critical");
  });

  it("escreve Dado Quando Então", () => {
    const body = text(
      generateGherkinScenario({
        requirement: "Cliente com 17 anos pede assinatura. O sistema recusa e explica a idade.",
      }),
    );
    expect(body).toContain("Dado");
    expect(body).toContain("Quando");
    expect(body).toContain("Então");
  });

  it("acusa requisito sem caso", () => {
    const body = text(
      generateTraceabilityMatrix({
        requirements: [
          { id: "R1", description: "Assinatura recusa menor de idade" },
          { id: "R2", description: "Nota fiscal em PDF" },
        ],
        testCases: [{ id: "CT-1", title: "recusa menor", covers: ["R1"] }],
      }),
    );
    expect(body).toContain("R2");
    expect(body).toContain("lacuna");
  });
});

describe("métricas", () => {
  it("aponta timeout como instabilidade", () => {
    const body = text(flakinessAnalyzer({ logs: "Error: Timeout 30000ms exceeded waiting for selector .pay" }));
    expect(body.toLowerCase()).toContain("tempo");
    expect(body.toLowerCase()).toContain("seletor");
  });

  it("destaca arquivo de pagamento no LCOV", () => {
    const body = text(
      codeCoverageAdvisor({
        report: "SF:src/payment.ts\nDA:10,0\nDA:11,1\nend_of_record\n",
      }),
    );
    expect(body).toContain("payment.ts");
    expect(body).toContain("10");
  });
});

describe("estratégia", () => {
  it("rebalanceia quando só existe E2E", () => {
    const body = text(suggestTestPyramidBalance({ counts: { unit: 0, integration: 0, e2e: 12 } }));
    expect(body).toContain("E2E");
    expect(body).toContain("12");
  });

  it("varre arquivos de teste do disco", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-suite-"));
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "sum.test.ts"), "test('a', () => {})");
    fs.mkdirSync(path.join(root, "e2e"), { recursive: true });
    fs.writeFileSync(path.join(root, "e2e", "buy.spec.ts"), "test('b', () => {})");
    const body = text(suggestTestPyramidBalance({ projectRoot: root }));
    expect(body).toContain("sum.test.ts");
    expect(body).toContain("buy.spec.ts");
  });

  it("ordena pelo produto probabilidade × impacto", () => {
    const body = text(
      riskBasedPrioritization({
        features: [
          { name: "tema", likelihood: 1, impact: 1 },
          { name: "pagamento", likelihood: 4, impact: 5 },
        ],
      }),
    );
    expect(body.indexOf("pagamento")).toBeLessThan(body.indexOf("tema"));
  });

  it("cita canário e separa as duas faixas", () => {
    const body = text(shiftLeftRightRecommendations({ context: "API de pedidos em Node" }));
    expect(body.toLowerCase()).toContain("canário");
    expect(body.toLowerCase()).toContain("não substitui");
  });

  it("separa mock, isolado e produção", () => {
    const body = text(environmentStrategyAdvisor({ pipeline: "dev → teste → staging → produção" }));
    expect(body).toContain("Mock");
    expect(body).toContain("Real isolado");
    expect(body).toContain("Produção");
  });
});

describe("produção", () => {
  it("gera smoke sintético, não cobrança real", () => {
    const body = text(generateSmokeTestProd({ baseUrl: "https://app.example.com" }));
    expect(body).toContain("Isto roda de verdade em produção");
    expect(body.toLowerCase()).toContain("sintét");
    expect(body).toContain("Shift-left");
  });

  it("exige abort no canário", () => {
    const body = text(setupCanaryRelease({ service: "pedidos", initialPercent: 5 }));
    expect(body.toLowerCase()).toContain("rollback");
    expect(body).toContain("5");
  });

  it("limita o blast radius do chaos", () => {
    const body = text(setupChaosExperiment({ target: "um pod da API" }));
    expect(body.toLowerCase()).toContain("blast radius");
    expect(body).toContain("um pod da API");
  });

  it("deriva regressão de incidente de latência", () => {
    const body = text(
      productionIncidentTestReview({
        incident: "Timeout em produção quando a fila passou de mil mensagens.",
      }),
    );
    expect(body.toLowerCase()).toContain("resiliência");
  });
});

describe("métricas de confiabilidade", () => {
  it("calcula densidade", () => {
    const body = text(defectDensityReport({ defects: 10, size: 2, unit: "kloc" }));
    expect(body).toContain("5");
  });

  it("calcula MTTR médio", () => {
    const body = text(
      mttrReport({
        incidents: [
          { id: "INC-1", startedAt: "2026-09-01T10:00:00Z", restoredAt: "2026-09-01T10:30:00Z" },
          { id: "INC-2", startedAt: "2026-09-02T10:00:00Z", restoredAt: "2026-09-02T11:00:00Z" },
        ],
      }),
    );
    expect(body).toContain("45");
  });
});
