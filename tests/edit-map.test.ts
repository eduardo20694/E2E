import { describe, expect, it } from "vitest";
import { layerMatrixMarkdown, mapTestsForEdit } from "../src/lib/edit-map.js";
import { TOOL_NAMES } from "../src/tools/register.js";

function text(result: { content: Array<{ text: string }>; isError?: boolean }): string {
  expect(result.isError).toBeFalsy();
  return result.content[0].text;
}

function ordered(body: string): string {
  const start = body.indexOf("## Use nesta ordem");
  const end = body.indexOf("## Não use");
  return body.slice(start, end === -1 ? undefined : end);
}

function recommended(body: string): string[] {
  return [...ordered(body).matchAll(/^\d+\. `([^`]+)`/gm)].map((match) => match[1]);
}

describe("map_tests_for_edit", () => {
  it("começa o unitário de produção em generate_unit_test e não pede e2e", () => {
    const body = text(
      mapTestsForEdit({
        filePath: "src/pricing.ts",
        sourceCode: "export function price(amount) { return amount; }",
      }),
    );
    const tools = recommended(body);
    expect(tools[0]).toBe("generate_unit_test");
    expect(tools).not.toContain("generate_e2e_test");
    expect(ordered(body)).not.toContain("generate_e2e_test");
    expect(body).toContain("price");
    for (const name of tools) expect(TOOL_NAMES).toContain(name);
  });

  it("não inclui generate_unit_test na ordem quando o arquivo já é teste", () => {
    const body = text(mapTestsForEdit({ filePath: "src/pricing.test.ts" }));
    expect(ordered(body)).not.toContain("generate_unit_test");
    expect(recommended(body)[0]).toBe("read_workspace");
    expect(body).toContain("e2e-review-test");
    expect(body).toContain("e2e://knowledge/unit-testing");
    expect(body.slice(body.indexOf("## Não use"))).toContain("generate_unit_test");
  });

  it("aponta e2e e acessibilidade para uma tela", () => {
    const body = text(mapTestsForEdit({ filePath: "src/pages/Checkout.tsx" }));
    const tools = recommended(body);
    expect(tools).toContain("generate_e2e_test");
    expect(tools).toContain("suggest_accessibility_audit");
    expect(tools).toContain("suggest_security_checklist");
    expect(tools).toContain("suggest_sast_setup");
    expect(body).toContain("e2e://map");
    expect(body).toContain("e2e://knowledge/e2e-testing");
    expect(tools.indexOf("generate_e2e_test")).toBeLessThan(tools.indexOf("suggest_accessibility_audit"));
    expect(tools.indexOf("suggest_accessibility_audit")).toBeLessThan(tools.indexOf("suggest_security_checklist"));
    expect(tools.indexOf("suggest_security_checklist")).toBeLessThan(tools.indexOf("suggest_sast_setup"));
  });

  it("no core deixa canário, smoke e chaos fora do perfil", () => {
    const body = text(mapTestsForEdit({ filePath: "deploy/rollout.yaml" }));
    expect(recommended(body)).toEqual([]);
    expect(ordered(body)).toContain("Nenhuma tool desta matriz está neste perfil.");
    expect(body).toContain("`setup_canary_release` disponível com E2E_TOOLSET=full.");
    expect(body).toContain("`generate_smoke_test_prod` disponível com E2E_TOOLSET=full.");
    expect(body).toContain("`setup_chaos_experiment` disponível com E2E_TOOLSET=full.");
    expect(body.toLowerCase()).toContain("não aplica");
    expect(body).toContain("kubectl");
  });

  it("no full aponta canário de deploy e diz que não aplica", () => {
    const body = text(mapTestsForEdit({ filePath: "deploy/rollout.yaml", profile: "full" }));
    expect(recommended(body)).toContain("setup_canary_release");
    expect(body).not.toContain("## Fora deste perfil");
    expect(body.toLowerCase()).toContain("não aplica");
  });

  it("no core mantém a integração de SQL e tira o seed do perfil", () => {
    const body = text(mapTestsForEdit({ filePath: "db/migrations/001_orders.sql" }));
    expect(recommended(body)).toEqual(["generate_integration_test"]);
    expect(body).toContain("`suggest_seeding_strategy` disponível com E2E_TOOLSET=full.");
  });

  it("no core deixa as tools de prompt fora do perfil", () => {
    const body = text(mapTestsForEdit({ filePath: "prompts/system.md" }));
    expect(recommended(body)).toEqual([]);
    expect(ordered(body)).toContain("Nenhuma tool desta matriz está neste perfil.");
    expect(body).toContain("`generate_llm_prompt_test` disponível com E2E_TOOLSET=full.");
    expect(body).toContain("`suggest_model_testing_plan` disponível com E2E_TOOLSET=full.");
  });

  it("omite o contrato quando o gate pact está fechado, e isso não é fora do perfil", () => {
    const body = text(
      mapTestsForEdit({
        filePath: "src/routes/orders.ts",
        sourceCode: "export async function GET() { return 1; }",
        profile: "core",
      }),
    );
    expect(recommended(body)).not.toContain("setup_consumer_driven_contracts");
    expect(body).not.toContain("`setup_consumer_driven_contracts` disponível com E2E_TOOLSET=full.");
  });

  it("escolhe o artigo da camada de teste pelo arquivo", () => {
    expect(text(mapTestsForEdit({ filePath: "features/checkout.feature" }))).toContain("e2e://knowledge/bdd");
    expect(text(mapTestsForEdit({ filePath: "e2e/checkout.spec.ts" }))).toContain("e2e://knowledge/e2e-testing");
    expect(text(mapTestsForEdit({ filePath: "tests/playwright/login.test.ts" }))).toContain("e2e://knowledge/e2e-testing");
    expect(text(mapTestsForEdit({ filePath: "src/api/orders.test.ts" }))).toContain("e2e://knowledge/api-contract-testing");
    expect(text(mapTestsForEdit({ filePath: "src/pricing.test.ts" }))).toContain("e2e://knowledge/unit-testing");
  });

  it("avisa que Go grava e não executa, e Python grava e roda", () => {
    const go = text(
      mapTestsForEdit({
        filePath: "internal/pricing.go",
        sourceCode: "package pricing\nfunc Price(n int) int { return n }\n",
      }),
    );
    expect(recommended(go)[0]).toBe("generate_unit_test");
    expect(go).toContain("Grava e não executa: o runner local não executa go test, JUnit nem RSpec.");
    const py = text(
      mapTestsForEdit({
        filePath: "app/pricing.py",
        sourceCode: "def price(n):\n    return n\n",
      }),
    );
    expect(py).toContain("Grava e roda o unitário.");
    expect(py).not.toContain("Grava e não executa");
  });

  it("pede o arquivo quando não há caminho nem fonte", () => {
    const result = mapTestsForEdit({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text.toLowerCase()).toContain("arquivo");
  });

  it("revisa o irmão quando o símbolo já aparece", () => {
    const body = text(
      mapTestsForEdit({
        filePath: "src/pricing.ts",
        sourceCode: "export function price(amount) { return amount; }",
        siblingChecked: true,
        siblingPath: "src/pricing.test.ts",
        siblingText: "it('price', () => { expect(price(1)).toBe(1); });",
      }),
    );
    expect(recommended(body)[0]).toBe("read_workspace");
    expect(recommended(body)).not.toContain("generate_unit_test");
  });
});

describe("e2e://map", () => {
  it("gera a matriz pelas mesmas camadas, sem tabela solta", () => {
    const matrix = layerMatrixMarkdown();
    expect(matrix).toContain("generate_unit_test");
    expect(matrix).toContain("setup_canary_release");
    expect(matrix).toContain("generate_e2e_test");
    expect(matrix).toContain("e2e-review-test");
    expect(matrix).toContain("A resposta de `map_tests_for_edit` corta pelo perfil ativo.");
    const named = [...matrix.matchAll(/`([a-z][a-z0-9_]+)`/g)].map((match) => match[1]);
    const tools = named.filter((name) => name !== "e2e");
    for (const name of tools) {
      if (name.startsWith("e2e")) continue;
      expect(TOOL_NAMES as readonly string[]).toContain(name);
    }
  });
});
