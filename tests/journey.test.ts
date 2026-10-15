import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { locatorFor, renderJourneyConfig, renderJourneySpec, renderJourneyWorkflow } from "../src/lib/journey.js";
import { buildRunnerCommand } from "../src/lib/runner.js";
import { scanPyramid } from "../src/lib/pyramid.js";
import { createServer } from "../src/server.js";
import { generateJourneyTest, setupE2eEnvironment } from "../src/tools/journey.js";

const base = {
  name: "cliente compra e vê o pedido",
  baseUrl: "http://127.0.0.1:4310",
  auth: {
    loginPath: "/login",
    userTarget: { label: "E-mail" },
    passwordTarget: { label: "Senha" },
    submitTarget: { role: "button", name: "Entrar" },
    successPath: "/produtos",
  },
  seed: [{ path: "/api/products", body: { name: "Caneca {{runId}}" }, saveAs: { produtoId: "data.id" } }],
  steps: [
    { action: "goto" as const, path: "/produtos/{{produtoId}}" },
    {
      action: "click" as const,
      target: { role: "button", name: "Comprar" },
      awaitResponse: { method: "POST", url: "/api/orders", status: 201, saveAs: { pedidoId: "data.id" } },
    },
    { action: "expectUrl" as const, path: "/pedidos/{{pedidoId}}" },
    { action: "api" as const, path: "/api/orders/{{pedidoId}}", expectJson: { status: "CRIADO" } },
  ],
  cleanup: [{ path: "/api/orders/{{pedidoId}}" }, { path: "/api/products/{{produtoId}}" }],
};

function tempProject(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "journey-"));
  for (const [name, contents] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), contents);
  }
  return root;
}

describe("jornada ponta a ponta", () => {
  it("gera spec sem mock de rede, com login por env, seed, espera da API, verificação e limpeza", () => {
    const out = renderJourneySpec(base);
    expect(out.fileName).toBe("cliente-compra-e-ve-o-pedido.journey.spec.ts");
    expect(out.code).toContain("@journey");
    // page.route só repassa ao backend real (route.fetch); nenhuma resposta inventada.
    expect(out.code).not.toMatch(/route\.fulfill\(\{\s*(json|status|body:\s*["'`{])/);
    expect(out.code).toContain("await route.fulfill({ response, body: text })");
    expect(out.code).not.toContain("@network-mock");
    expect(out.code).toContain('fill("{{env.E2E_PASSWORD}}")');
    expect(out.envVars).toEqual(expect.arrayContaining(["E2E_USER", "E2E_PASSWORD"]));
    expect(out.code).toContain('captureResponse(page, "POST", "/api/orders")');
    expect(out.code).toContain('save("pedidoId", pick(json, "data.id"))');
    expect(out.code).toContain("route.fetch()");
    expect(out.code).toContain("test.afterAll");
    expect(out.stepTitles[0]).toBe("login: abre a tela");
    expect(out.stepTitles).toContain("1. abre /produtos/{{produtoId}}");
  });

  it("recusa variável usada antes de ser capturada", () => {
    expect(() =>
      renderJourneySpec({ ...base, seed: [], steps: [{ action: "goto", path: "/pedidos/{{pedidoId}}" }], cleanup: [] }),
    ).toThrow(/pedidoId/);
  });

  it("avisa quando a senha vai literal no arquivo", () => {
    const out = renderJourneySpec({
      name: "login",
      baseUrl: "http://127.0.0.1:3000",
      steps: [
        { action: "goto", path: "/login" },
        { action: "fill", target: { label: "Senha" }, value: "123456" },
      ],
    });
    expect(out.notes.join(" ")).toMatch(/segredo/);
  });

  it("monta o localizador na ordem de preferência", () => {
    expect(locatorFor({ testId: "x", role: "button", name: "y" })).toBe('page.getByTestId("x")');
    expect(locatorFor({ role: "button", name: "Salvar", exact: true })).toBe('page.getByRole("button", { name: "Salvar", exact: true })');
    expect(locatorFor({ label: "E-mail", nth: 1 })).toBe('page.getByLabel("E-mail").nth(1)');
    expect(() => locatorFor({})).toThrow();
  });

  it("grava em <testDir>/journeys, confere alvos nas telas e não executa fora do localhost sem allowRemote", async () => {
    const root = tempProject({
      "package.json": JSON.stringify({ name: "app", devDependencies: {} }),
      "playwright.config.ts": 'export default { testDir: "tests/e2e" };',
      "src/pages/login.tsx": 'export default function Login() { return <form><label>E-mail<input /></label><label>Senha<input type="password" /></label><button>Entrar</button></form>; }',
      "src/pages/produto.tsx": "export default function Produto() { return <button>Comprar agora</button>; }",
    });
    const result = await generateJourneyTest(undefined, {
      ...base,
      baseUrl: "https://staging.exemplo.com",
      projectRoot: root,
      pageFiles: ["src/pages/login.tsx", "src/pages/produto.tsx"],
      steps: [...base.steps, { action: "click", target: { role: "button", name: "Cancelar pedido" } }],
    });
    const text = result.content[0]?.text ?? "";
    expect(result.isError).toBeFalsy();
    expect(text).toContain("tests/e2e/journeys/cliente-compra-e-ve-o-pedido.journey.spec.ts");
    expect(text).toContain("allowRemote");
    expect(text).toContain("Não foi executado");
    expect(text).toMatch(/Não achei nos arquivos de tela: button "Cancelar pedido"/);
    const written = path.join(root, "tests/e2e/journeys/cliente-compra-e-ve-o-pedido.journey.spec.ts");
    expect(fs.existsSync(written)).toBe(true);
    expect(fs.readFileSync(written, "utf8")).toContain('"https://staging.exemplo.com"');
    expect(scanPyramid(root).e2e).toBe(1);
  });

  it("vários usuários, nova aba, upload, download, diálogo, e-mail, visual e acessibilidade", () => {
    const admin = { ...base.auth, userEnv: "E2E_ADMIN_USER", passwordEnv: "E2E_ADMIN_PASSWORD", successPath: "/admin" };
    const out = renderJourneySpec({
      ...base,
      actors: { admin },
      steps: [
        ...base.steps,
        { action: "email", to: "ana+{{runId}}@x.com", subject: "Pedido #{{pedidoId}}", saveLink: "link" },
        { action: "goto", path: "{{link}}" },
        { action: "click", target: { role: "button", name: "Aprovar {{pedidoId}}" }, as: "admin" },
        { action: "download", target: { text: "CSV" }, as: "admin", expectContains: "{{pedidoId}}" },
        { action: "upload", target: { label: "Nota" }, files: ["tests/fixtures/nf.pdf"] },
        { action: "dialog", accept: false },
        { action: "click", target: { text: "Comprovante" }, opensTab: "recibo" },
        { action: "expectScreenshot", name: "Recibo", as: "recibo", mask: [{ testId: "data" }] },
        { action: "a11y" },
      ],
    });
    expect(out.envVars).toEqual(expect.arrayContaining(["E2E_ADMIN_USER", "E2E_ADMIN_PASSWORD"]));
    expect(out.code).toContain('const page = await actor("admin");');
    expect(out.code).toContain('"admin": async (page) => {');
    expect(out.code).toContain('waitForEmail(`to:"${fill("ana+{{runId}}@x.com")}" subject:"${fill("Pedido #{{pedidoId}}")}"`');
    expect(out.code).toContain('setInputFiles(["tests/fixtures/nf.pdf"])');
    expect(out.code).toContain('page.waitForEvent("download")');
    expect(out.code).toContain("dialog.dismiss()");
    expect(out.code).toContain('pages["recibo"] = tab;');
    expect(out.code).toContain('toHaveScreenshot("recibo.png"');
    expect(out.code).toContain('import AxeBuilder from "@axe-core/playwright";');
    expect(out.packages).toEqual(["@axe-core/playwright"]);
    expect(out.hasScreenshots).toBe(true);
  });

  it("recusa ator ou aba desconhecidos", () => {
    expect(() =>
      renderJourneySpec({ name: "x", baseUrl: "http://127.0.0.1:3000", steps: [{ action: "goto", path: "/", as: "gerente" }] }),
    ).toThrow(/gerente/);
    expect(() =>
      renderJourneySpec({
        name: "x",
        baseUrl: "http://127.0.0.1:3000",
        steps: [
          { action: "goto", path: "/" },
          { action: "expectText", text: "a", as: "aba" },
          { action: "click", target: { text: "abrir" }, opensTab: "aba" },
        ],
      }),
    ).toThrow(/aba/);
  });

  it("config de jornadas: navegadores, celular, webServer, evidências e CI", async () => {
    const config = renderJourneyConfig({
      testDir: "e2e",
      baseUrl: "http://127.0.0.1:3000",
      browsers: ["chromium", "firefox", "webkit"],
      mobileDevices: ["Pixel 7", "iPhone 14"],
      servers: [{ command: "npm run dev", url: "http://127.0.0.1:3000" }, { command: "npm run api", url: "http://127.0.0.1:4000/health" }],
      locale: "pt-BR",
    });
    for (const piece of ['devices["Desktop Firefox"]', 'devices["iPhone 14"]', '"npm run api"', 'trace: "retain-on-failure"', 'video: "retain-on-failure"', '["junit"', 'testDir: "e2e/journeys"']) {
      expect(config).toContain(piece);
    }
    const workflow = renderJourneyWorkflow({ browsers: ["chromium"], secrets: ["E2E_USER"], compose: true });
    expect(workflow).toContain("E2E_USER: ${{ secrets.E2E_USER }}");
    expect(workflow).toContain("docker compose up -d --wait");

    const root = tempProject({ "package.json": JSON.stringify({ name: "app", scripts: { dev: "vite --port 5173" } }) });
    const result = await setupE2eEnvironment(undefined, { projectRoot: root, browsers: ["chromium", "webkit"], secrets: ["E2E_USER"] });
    expect(result.isError).toBeFalsy();
    expect(fs.readFileSync(path.join(root, "playwright.journeys.config.ts"), "utf8")).toContain('url: "http://127.0.0.1:5173"');
    expect(fs.existsSync(path.join(root, ".github/workflows/e2e-journeys.yml"))).toBe(true);
    fs.mkdirSync(path.join(root, "node_modules/@playwright/test/node_modules/playwright"), { recursive: true });
    fs.writeFileSync(path.join(root, "node_modules/@playwright/test/cli.js"), "");
    expect(() => buildRunnerCommand(root, "playwright", undefined, { configFile: "playwright.journeys.config.ts" })).not.toThrow();
  });

  it("aparece no perfil core do servidor", async () => {
    const previous = process.env.E2E_TOOLSET;
    delete process.env.E2E_TOOLSET;
    const server = createServer();
    const client = new Client({ name: "t", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(a), server.connect(b)]);
    const tools = await client.listTools();
    const journey = tools.tools.find((tool) => tool.name === "generate_journey_test");
    expect(journey).toBeDefined();
    expect(tools.tools.some((tool) => tool.name === "setup_e2e_environment")).toBe(true);
    const call = await client.callTool({
      name: "generate_journey_test",
      arguments: { name: "x", writeToProject: false, run: false, steps: [{ action: "goto", path: "/" }, { action: "expectText", text: "Olá" }] },
    });
    expect(JSON.stringify(call.content)).toContain("Jornada ponta a ponta");
    await client.close();
    await server.close();
    if (previous !== undefined) process.env.E2E_TOOLSET = previous;
  });
});
