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
    expect(body.slice(body.indexOf("## Não use"))).toContain("generate_unit_test");
  });

  it("aponta e2e e acessibilidade para uma tela", () => {
    const body = text(mapTestsForEdit({ filePath: "src/pages/Checkout.tsx" }));
    const tools = recommended(body);
    expect(tools).toContain("generate_e2e_test");
    expect(tools).toContain("suggest_accessibility_audit");
    expect(tools).toContain("suggest_security_checklist");
    expect(tools).toContain("suggest_sast_setup");
    expect(tools.indexOf("generate_e2e_test")).toBeLessThan(tools.indexOf("suggest_accessibility_audit"));
    expect(tools.indexOf("suggest_accessibility_audit")).toBeLessThan(tools.indexOf("suggest_security_checklist"));
    expect(tools.indexOf("suggest_security_checklist")).toBeLessThan(tools.indexOf("suggest_sast_setup"));
  });

  it("aponta canário de deploy e diz que não aplica", () => {
    const body = text(mapTestsForEdit({ filePath: "deploy/rollout.yaml" }));
    expect(recommended(body)).toContain("setup_canary_release");
    expect(body.toLowerCase()).toContain("não aplica");
    expect(body).toContain("kubectl");
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
    const named = [...matrix.matchAll(/`([a-z][a-z0-9_]+)`/g)].map((match) => match[1]);
    const tools = named.filter((name) => name !== "e2e");
    for (const name of tools) {
      if (name.startsWith("e2e")) continue;
      expect(TOOL_NAMES as readonly string[]).toContain(name);
    }
  });
});
