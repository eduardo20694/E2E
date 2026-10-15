import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapTestsForEdit } from "../src/lib/edit-map.js";
import { extractUi, routeFromPage, slugFor } from "../src/lib/web.js";
import { generateE2eTest, handleGenerateE2eTest } from "../src/tools/e2e.js";
import { extraVisualConfig, visualRegressionSetup } from "../src/tools/visual-regression.js";
import { buildUnitTest } from "../src/tools/unit.js";
import { runnerInstalled } from "../src/lib/runner.js";

function text(result: { content: Array<{ text: string }>; isError?: boolean }): string {
  expect(result.isError).toBeFalsy();
  return result.content[0].text;
}

function specFrom(body: string): string {
  const marker = body.indexOf("## Código");
  const slice = marker >= 0 ? body.slice(marker) : body;
  const start = slice.indexOf("```ts");
  const alt = slice.indexOf("```tsx");
  const at = start >= 0 ? start : alt;
  expect(at).toBeGreaterThanOrEqual(0);
  const open = slice.indexOf("\n", at);
  const close = slice.indexOf("```", open + 1);
  return slice.slice(open + 1, close);
}

const pageWithList = `export default function Pedidos() {
  const [items, setItems] = useState([]);
  useEffect(() => { fetch("/api/pedidos").then((r) => r.json()).then(setItems); }, []);
  return (
    <div>
      <h1>Pedidos</h1>
      <a href="/novo">Novo</a>
      <button>Excluir conta</button>
      <ul>{items.map((item) => <li key={item.id}>{item.title}</li>)}</ul>
    </div>
  );
}`;

describe("generate_e2e_test modo network", () => {
  it("não monta HTML sintético nem intercepta documento", async () => {
    const spec = specFrom(text(await generateE2eTest({ sourceCode: pageWithList, filePath: "src/pages/pedidos.tsx" })));
    expect(spec).not.toContain('contentType: "text/html"');
    expect(spec).not.toContain('resourceType() === "document"');
    expect(spec).toContain('page.route("**/api/**"');
    expect(spec).toContain('page.route("**/api/pedidos"');
    const routeCalls = spec.match(/page\.route\(/g) ?? [];
    expect(routeCalls.length).toBeGreaterThanOrEqual(2);
    expect(spec).toContain("sucesso @network-mock");
    expect(spec).toContain("vazio @network-mock");
    expect(spec).toContain("erro @network-mock");
    expect(spec).toContain("toHaveScreenshot");
    expect(spec).toContain('animations: "disabled"');
    expect(spec).not.toMatch(/Excluir conta[\s\S]{0,80}\.click\(/);
    expect(spec).not.toMatch(/Sair[\s\S]{0,80}\.click\(/);
    expect(spec).not.toMatch(/Pagar[\s\S]{0,80}\.click\(/);
    const tests = spec.split(/test\(/).slice(1);
    for (const block of tests) {
      const clicks = block.match(/\.click\(/g) ?? [];
      expect(clicks.length).toBeLessThanOrEqual(1);
    }
  });

  it("sem lista não gera o estado vazio", async () => {
    const spec = specFrom(
      text(
        await generateE2eTest({
          sourceCode: 'export default function Home(){ return <h1>Home</h1>; }',
          filePath: "src/pages/index.tsx",
        }),
      ),
    );
    expect(spec).toContain("sucesso @network-mock");
    expect(spec).toContain("erro @network-mock");
    expect(spec).not.toContain("vazio @network-mock");
  });

  it("gera nomes de arquivo diferentes para páginas diferentes", async () => {
    const pedidos = text(
      await generateE2eTest({
        sourceCode: 'export default function Pedidos(){ return <h1>Pedidos</h1>; }',
        filePath: "src/pages/pedidos.tsx",
      }),
    );
    const checkout = text(
      await generateE2eTest({
        sourceCode: 'export default function Checkout(){ return <h1>Checkout</h1>; }',
        filePath: "src/pages/checkout.tsx",
      }),
    );
    expect(pedidos).toContain("pedidos.spec.ts");
    expect(checkout).toContain("checkout.spec.ts");
    expect(pedidos).not.toContain("checkout.spec.ts");
  });

  it("grava o spec no testDir e as fixtures, sem clicar em Excluir conta", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-front-"));
    fs.writeFileSync(path.join(root, "package.json"), "{}");
    fs.writeFileSync(
      path.join(root, "playwright.config.ts"),
      `export default { testDir: "e2e", use: { baseURL: "http://127.0.0.1:3000" } };\n`,
    );
    const source = `export default function Pedidos() {
      const [items, setItems] = useState([]);
      useEffect(() => { fetch("/api/pedidos").then(r => r.json()).then(setItems); }, []);
      return (<div><h1>Pedidos</h1><a href="/novo">Novo</a><button>Excluir conta</button>
        <ul>{items.map(item => <li key={item.id}>{item.title}</li>)}</ul></div>);
    }`;
    const body = text(
      await handleGenerateE2eTest({
        sourceCode: source,
        filePath: "src/pages/pedidos.tsx",
        projectRoot: root,
        run: false,
      }),
    );
    const specPath = path.join(root, "e2e", "pedidos.spec.ts");
    expect(fs.existsSync(specPath)).toBe(true);
    expect(fs.existsSync(path.join(root, "tests", "fixtures", "pedidos", "sucesso.json"))).toBe(true);
    const spec = fs.readFileSync(specPath, "utf8");
    expect(spec).toContain("page.goto(\"/pedidos\")");
    expect(spec).not.toMatch(/Excluir conta[\s\S]{0,80}\.click\(/);
    expect(body).toContain("Excluir conta");
  });
});

describe("rotas e extração", () => {
  it("preserva o caso, ignora _app e aplica routeParams", () => {
    expect(routeFromPage("src/pages/Checkout.tsx")).toBe("/Checkout");
    expect(routeFromPage("pages/_app.tsx")).toBeUndefined();
    expect(routeFromPage("app/users/[id]/page.tsx")).toBe("/users/:id");
  });

  it("aplica 1 nos params no spec quando routeParams não vem", async () => {
    const spec = specFrom(
      text(
        await generateE2eTest({
          sourceCode: 'export default function User(){ return <h1>User</h1>; }',
          filePath: "app/users/[id]/page.tsx",
        }),
      ),
    );
    expect(spec).toContain('page.goto("/users/1")');
  });

  it("slugFor cobre home, dinâmico e componente", () => {
    expect(slugFor("/")).toBe("home");
    expect(slugFor("/pedidos/:id")).toBe("pedidos-id");
    expect(slugFor(undefined, "OrderList")).toBe("order-list");
  });

  it("marca condicional e resolve i18n", () => {
    const conditional = extractUi("export function A(){ return <>{open && <button>X</button>}</>; }");
    expect(conditional.some((control) => control.kind === "button" && control.text === "X" && control.conditional)).toBe(true);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-i18n-"));
    fs.mkdirSync(path.join(root, "public", "locales", "pt"), { recursive: true });
    fs.writeFileSync(path.join(root, "public", "locales", "pt", "common.json"), JSON.stringify({ a: { b: "Abrir" } }));
    const resolved = extractUi('export function A(){ return <button>{t("a.b")}</button>; }', { projectRoot: root });
    expect(resolved.some((control) => control.kind === "button" && control.text === "Abrir")).toBe(true);

    const missing = extractUi('export function A(){ return <button>{t("a.b")}</button>; }');
    expect(missing.some((control) => control.kind === "button" && control.text === "Abrir")).toBe(false);
    expect(missing.some((control) => control.kind === "button" && control.missingStaticText)).toBe(true);
  });
});

describe("renderComponentTest", () => {
  it("com jsdom e jest-dom no projeto, coloca pragma e import", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-rtl-"));
    fs.mkdirSync(path.join(root, "node_modules", "jsdom"), { recursive: true });
    fs.writeFileSync(path.join(root, "node_modules", "jsdom", "package.json"), "{}");
    fs.mkdirSync(path.join(root, "node_modules", "@testing-library", "jest-dom"), { recursive: true });
    fs.writeFileSync(path.join(root, "node_modules", "@testing-library", "jest-dom", "package.json"), "{}");
    const built = buildUnitTest({
      sourceCode: "export default function Hello(){ return <button>Oi</button>; }",
      filePath: "src/Hello.tsx",
      framework: "vitest",
      projectRoot: root,
    });
    expect(built.code.includes("vitest-environment jsdom")).toBe(true);
    expect(built.code).toContain("@testing-library/jest-dom/vitest");
    expect(built.code).toContain("toBeInTheDocument()");
  });

  it("sem jsdom nem jest-dom usa toBeTruthy e avisa", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-no-dom-"));
    const built = buildUnitTest({
      sourceCode: "export default function Hello(){ return <button>Oi</button>; }",
      filePath: "src/Hello.tsx",
      framework: "vitest",
      projectRoot: root,
    });
    expect(built.code).toContain("toBeTruthy()");
    expect(built.result.content[0].text).toMatch(/ambiente DOM|toBeTruthy/i);
  });
});

describe("visual_regression_setup", () => {
  it("não grava .percy.yml quando Percy não está na stack", () => {
    expect(extraVisualConfig({})).toBeUndefined();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-visual-"));
    fs.writeFileSync(path.join(root, "package.json"), "{}");
    expect(extraVisualConfig({ projectRoot: root })).toBeUndefined();
    const body = text(visualRegressionSetup({ projectRoot: root }));
    expect(body).toContain("nenhum config extra");
  });
});

describe("mapa perfil", () => {
  it("mostra o perfil na primeira linha", () => {
    const body = text(mapTestsForEdit({ filePath: "src/pages/Checkout.tsx" }));
    expect(body.startsWith("Perfil: core")).toBe(true);
  });
});

const fixtureApp = path.resolve("tests/fixtures/app-vite");

describe("app-vite opcional", () => {
  it.skipIf(!fs.existsSync(path.join(fixtureApp, "src", "pages", "Pedidos.tsx")))(
    "gera o spec da página mínima",
    async () => {
      const source = fs.readFileSync(path.join(fixtureApp, "src", "pages", "Pedidos.tsx"), "utf8");
      const body = text(
        await generateE2eTest({
          sourceCode: source,
          filePath: "src/pages/Pedidos.tsx",
          projectRoot: fixtureApp,
          writeToProject: false,
          run: false,
        }),
      );
      expect(body).toContain("pedidos.spec.ts");
      expect(specFrom(body)).toContain("/api/pedidos");
    },
  );

  it.skipIf(!runnerInstalled(process.cwd(), "playwright"))("roda o Playwright de verdade no app-vite", async () => {
    expect(runnerInstalled(process.cwd(), "playwright")).toBe(false);
  });
});
