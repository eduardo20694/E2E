import fs from "node:fs";
import http from "node:http";
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
  it("usa o botão Pagar e a rota /checkout", async () => {
    const unit = buildUnitTest({ sourceCode: checkout, filePath: checkoutPath, framework: "vitest" });
    expect(unit.code).toContain('getByRole("button", { name: "Pagar" })');
    expect(unit.code).not.toContain("toBeDefined");
    expect(unit.code).not.toContain("expect.fail");

    const e2e = text(
      await generateE2eTest({ sourceCode: checkout, filePath: checkoutPath, baseUrl: "https://app.example.com" }),
    );
    expect(e2e).toContain("/checkout");
    expect(e2e).toContain("Pagar");
    expect(e2e).toContain("tela mockada");
    expect(e2e).toContain("flow.mocked.spec.ts");
    expect(e2e).toContain("@mocked");
    expect(e2e).not.toContain("flow.spec.ts");
    expect(e2e).not.toMatch(/Teste E2E/);
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
    expect(built.result.content[0].text).toContain("caracterização");
  });

  it("afirma 400 e 401 quando o handler declara, e todo quando não declara", () => {
    const declared = `app.post("/orders", (req, res) => {
      if (!req.body.name) return res.status(400).json({ error: "nome" });
      if (!req.headers.authorization) return res.status(401).end();
      res.status(201).json({ id: 1 });
    });`;
    const withStatus = text(generateApiTest({ specification: "POST /orders", sourceCode: declared }));
    expect(withStatus).toContain("toBe(400)");
    expect(withStatus).toContain("toBe(401)");
    expect(withStatus).toContain("toBe(201)");

    const plain = 'app.get("/health", (_req, res) => res.status(200).json({ ok: true }))';
    const gap = text(generateApiTest({ specification: plain, sourceCode: plain }));
    expect(gap).toContain("test.todo");
    const gapCode = gap.slice(gap.indexOf("```"));
    expect(gapCode).not.toContain("test.fixme");
    expect(gapCode).not.toMatch(/test\.todo\([\s\S]*?,\s*(?:async\s*)?\(/);
    expect(gapCode).not.toMatch(/test\.todo[\s\S]*await fetch/);
    expect(gap).toContain("O handler não declara 400 nem 422.");
    expect(gap).toContain("não mostra guarda");
    expect(gap).not.toContain("expect.fail(\"Rota com id sem comparação de dono no handler.\")");
    expect(gap).not.toContain("toBe(400)");
    expect(gap).not.toContain("toBe(401)");
  });
});

describe("componente sem rota de página", () => {
  it("não trata o localhost como E2E live", async () => {
    const button = "export function Button(){ return <button>Salvar</button>; }";
    const body = text(
      await generateE2eTest({ sourceCode: button, filePath: "src/components/Button.tsx", baseUrl: "http://127.0.0.1:3000" }),
    );
    expect(body).toContain("não uso o localhost como E2E live");
    expect(body).toContain("flow.mocked.spec.ts");
    expect(body).toContain("@mocked");
    expect(body).not.toContain("page.goto na URL real");
    expect(body).not.toContain("flow.spec.ts");
  });

  it("só trata a página como live quando o GET da rota responde 2xx", async () => {
    const probe = async (status: number) => {
      const server = http.createServer((req, res) => {
        res.statusCode = req.url === "/checkout" ? status : 404;
        res.end("ok");
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      try {
        return text(
          await generateE2eTest({
            sourceCode: checkout,
            filePath: checkoutPath,
            baseUrl: `http://127.0.0.1:${port}`,
          }),
        );
      } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      }
    };

    expect(await probe(404)).not.toContain("page.goto na URL real");
    expect(await probe(302)).not.toContain("page.goto na URL real");
    expect(await probe(200)).toContain("page.goto na URL real");
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
    const body = text(mapTestsForEdit({ filePath: "src/routes/health.ts", sourceCode: health }));
    const tools = recommended(body);
    expect(body).toContain("e2e://knowledge/api-contract-testing");
    expect(body).toContain("e2e://map");
    expect(body).toContain("aviso se a rota com id não compara dono");
    expect(body).not.toContain("falha se a rota com id");
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

describe("test.todo", () => {
  it("não recebe função em nenhum gerador", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts")) files.push(full);
      }
    };
    walk(path.resolve("src"));
    const pattern = /test\.todo\([\s\S]{0,240},\s*(?:async\s*)?\(/;
    for (const file of files) {
      expect(pattern.test(fs.readFileSync(file, "utf8")), file).toBe(false);
    }
  });
});
