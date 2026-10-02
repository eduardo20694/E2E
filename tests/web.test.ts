import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { layerMatrixMarkdown, mapTestsForEdit } from "../src/lib/edit-map.js";
import { generateApiTest } from "../src/tools/api.js";
import { generateE2eTest } from "../src/tools/e2e.js";
import { generateIntegrationTest } from "../src/tools/integration.js";
import { suggestAccessibilityAudit } from "../src/tools/non-functional.js";
import { buildUnitTest } from "../src/tools/unit.js";

const checkout = "export default function Checkout(){ return <button>Pagar</button>; }";
const checkoutPath = "src/pages/Checkout.tsx";
const health = 'app.get("/health", (_req, res) => res.status(200).json({ ok: true }))';

function text(result: { content: Array<{ text: string }>; isError?: boolean }): string {
  expect(result.isError).toBeFalsy();
  return result.content[0].text;
}

function recommended(body: string): string[] {
  const start = body.indexOf("## Use nesta ordem");
  const end = body.indexOf("## Não use");
  const slice = body.slice(start, end === -1 ? undefined : end);
  return [...slice.matchAll(/^\d+\. `([^`]+)`/gm)].map((match) => match[1]);
}

describe("teste de site a partir do arquivo", () => {
  it("usa o botão Pagar e a rota /checkout", () => {
    const unit = buildUnitTest({ sourceCode: checkout, filePath: checkoutPath, framework: "vitest" });
    expect(unit.code).toContain('getByRole("button", { name: "Pagar" })');
    expect(unit.code).not.toContain("toBeDefined");
    expect(unit.code).not.toContain("expect.fail");

    const e2e = text(
      generateE2eTest({ sourceCode: checkout, filePath: checkoutPath, baseUrl: "https://app.example.com" }),
    );
    expect(e2e).toContain("/checkout");
    expect(e2e).toContain("Pagar");
    expect(e2e).toContain("route.fulfill");
    expect(e2e).toContain("<button>Pagar</button>");
    expect(e2e).toContain('await expect(page.getByRole("button", { name: "Pagar" })).toBeVisible();');
    expect(e2e).toContain("mocked");
    expect(e2e).not.toContain("route.continue");
    expect(e2e).not.toContain("https://app.example.com");
    expect(e2e).toContain("http://127.0.0.1:3000");
    expect(e2e.toLowerCase()).not.toContain("painel");
    expect(e2e.toLowerCase()).not.toContain("staging");

    const audit = text(
      suggestAccessibilityAudit({ filePath: checkoutPath, sourceCode: checkout, baseUrl: "http://127.0.0.1:3000" }),
    );
    expect(audit).toContain("/checkout");
  });

  it("afirma o status 200 de GET /health e não uma lista", () => {
    const body = text(generateApiTest({ specification: health, sourceCode: health }));
    expect(body).toContain('"/health"');
    expect(body).toContain("toBe(200)");
    expect(body).not.toContain("toContain(response.status)");

    const integration = text(
      generateIntegrationTest({
        description: "o health responde",
        sourceCode: health,
        filePath: "src/routes/health.ts",
      }),
    );
    expect(integration).toContain('"/health"');
    expect(integration).toContain("toBe(200)");
    expect(integration).not.toContain("expect.fail");
  });

  it("soma a e b como números", () => {
    const built = buildUnitTest({
      sourceCode: "export function add(a, b) { return a + b; }",
      framework: "vitest",
      filePath: "src/add.ts",
    });
    expect(built.code).toContain("add(1, 2)");
    expect(built.code).toContain("toBe(3)");
  });
});

describe("mapa da tela e do handler", () => {
  it("ordena o componente e omite regressão visual sem a stack", () => {
    const tools = recommended(text(mapTestsForEdit({ filePath: checkoutPath })));
    expect(tools).toEqual([
      "generate_unit_test",
      "generate_e2e_test",
      "suggest_accessibility_audit",
      "suggest_security_checklist",
      "suggest_sast_setup",
    ]);
  });

  it("ordena o handler e omite pact e unitário sem função extra", () => {
    const tools = recommended(
      text(mapTestsForEdit({ filePath: "src/routes/health.ts", sourceCode: health })),
    );
    expect(tools).toEqual([
      "generate_api_test",
      "generate_integration_test",
      "suggest_security_checklist",
      "suggest_sast_setup",
    ]);
  });

  it("inclui visual e pact quando a stack tem, e unitário se houver função além do handler", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-web-map-"));
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ dependencies: { "@storybook/react": "1.0.0", "@pact-foundation/pact": "1.0.0" } }),
    );
    const ui = recommended(text(mapTestsForEdit({ filePath: checkoutPath, projectRoot: root })));
    expect(ui).toEqual([
      "generate_unit_test",
      "generate_e2e_test",
      "suggest_accessibility_audit",
      "suggest_security_checklist",
      "suggest_sast_setup",
      "visual_regression_setup",
    ]);
    const api = recommended(
      text(
        mapTestsForEdit({
          filePath: "src/routes/orders.ts",
          projectRoot: root,
          sourceCode: "export function price(n) { return n; }\nexport async function GET() { return 1; }",
        }),
      ),
    );
    expect(api).toEqual([
      "generate_api_test",
      "generate_integration_test",
      "suggest_security_checklist",
      "suggest_sast_setup",
      "generate_unit_test",
      "setup_consumer_driven_contracts",
    ]);
  });

  it("descreve os gates na matriz gerada pelas camadas", () => {
    const matrix = layerMatrixMarkdown();
    const ui = matrix.split("\n").find((line) => line.startsWith("| UI |"));
    const api = matrix.split("\n").find((line) => line.startsWith("| API |"));
    expect(ui).toBeTruthy();
    expect(api).toBeTruthy();
    expect(ui!.indexOf("generate_unit_test")).toBeLessThan(ui!.indexOf("generate_e2e_test"));
    expect(ui!.indexOf("suggest_accessibility_audit")).toBeLessThan(ui!.indexOf("suggest_security_checklist"));
    expect(ui!.indexOf("suggest_security_checklist")).toBeLessThan(ui!.indexOf("suggest_sast_setup"));
    expect(ui!).toContain("percy, chromatic, applitools ou Storybook");
    expect(api!.indexOf("generate_api_test")).toBeLessThan(api!.indexOf("generate_integration_test"));
    expect(api!.indexOf("generate_integration_test")).toBeLessThan(api!.indexOf("suggest_security_checklist"));
    expect(api!.indexOf("suggest_security_checklist")).toBeLessThan(api!.indexOf("suggest_sast_setup"));
    expect(api!).toContain("se houver função além do handler");
    expect(api!).toContain("se a stack tiver pact");
    const production = matrix.split("\n").find((line) => line.startsWith("| Código de produção |"));
    expect(production).toContain("suggest_sca_setup");
    expect(production).toContain("package.json");
  });
});
