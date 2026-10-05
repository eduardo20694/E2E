import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapTestsForEdit } from "../src/lib/edit-map.js";
import { prepareClosedCommand } from "../src/lib/runner.js";
import { isLocalHost } from "../src/tools/loop.js";
import {
  buildSecurityApiTest,
  buildSecurityFrontSpec,
  buildSecurityUiTest,
  handleSuggestSecurityChecklist,
  k6ExecutionAllowed,
} from "../src/tools/non-functional.js";

const handler401 = 'app.get("/admin", (_req, res) => { res.status(401).json({ error: "sem sessao" }); });';

describe("execução local fechada", () => {
  it("gera toBe(401) sem string de ataque", async () => {
    const code = buildSecurityApiTest(handler401);
    expect(code).toBeTruthy();
    expect(code).toContain("toBe(401)");
    expect(code).not.toContain("toBe(403)");
    expect(code).not.toContain("' OR 1=1");
    expect(code).not.toContain("<script>");
    expect(code).not.toContain("169.254.169.254");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-auth-"));
    const result = await handleSuggestSecurityChecklist({
      projectRoot: root,
      sourceCode: handler401,
      filePath: "src/routes/admin.ts",
    });
    expect(result.isError).toBeFalsy();
    const written = fs.readFileSync(path.join(root, "security.api.test.ts"), "utf8");
    expect(written).toContain("toBe(401)");
    expect(written).not.toContain("' OR 1=1");
    expect(written).not.toContain("<script>");
    expect(written).not.toContain("169.254.169.254");
    expect(written).toContain("http://127.0.0.1:3000/admin");
    expect(written).toContain("content-security-policy");
    expect(written).toContain("nosniff");
    expect(written).not.toContain("expect.fail");
  });

  it("não inventa 401 nem CORS nem dono quando a rota não declara isso", () => {
    const code = buildSecurityApiTest('app.get("/health", (_req, res) => res.status(200).json({ ok: true }))');
    expect(code).toBeTruthy();
    expect(code).not.toContain("toBe(401)");
    expect(code).not.toContain("toBe(403)");
    expect(code).not.toContain("expect.fail");
    expect(code).not.toContain("exemplo-externo.test");
    expect(code).toContain("content-security-policy");
    expect(code).toContain("nosniff");
    expect(code).toContain("frame-ancestors");
  });

  it("grava escape da tela e cabeçalhos do spec no localhost", async () => {
    const titulo = "export default function Titulo({ title }: { title: string }) { return <h1>{title}</h1>; }";
    const ui = buildSecurityUiTest(titulo, "src/pages/Home.tsx");
    expect(ui).toContain('"<b>x</b>"');
    expect(ui).toContain('querySelector("b")');
    const spec = buildSecurityFrontSpec("src/pages/Home.tsx", titulo);
    expect(spec).toContain("content-security-policy");
    expect(spec).toContain("nosniff");
    expect(spec).toContain("http://127.0.0.1:3000/home");
    expect(spec).not.toContain("httponly");
    expect(spec).not.toContain("csrf");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-front-"));
    const result = await handleSuggestSecurityChecklist({
      projectRoot: root,
      sourceCode: titulo,
      filePath: "src/pages/Home.tsx",
    });
    expect(result.isError).toBeFalsy();
    const writtenUi = fs.readFileSync(path.join(root, "security.ui.test.ts"), "utf8");
    const writtenSpec = fs.readFileSync(path.join(root, "e2e", "security-front.spec.ts"), "utf8");
    expect(writtenUi).toContain('"<b>x</b>"');
    expect(writtenUi).toContain('querySelector("b")');
    expect(writtenSpec).toContain("content-security-policy");
    expect(writtenSpec).toContain("nosniff");
    expect(writtenUi).not.toContain("<script>");
    expect(writtenSpec).not.toContain("OR 1=1");
  });

  it("avisa o dono sem falhar quando a rota com id não compara o usuário", async () => {
    const pedidos = 'app.get("/pedidos/:id", (_req, res) => { res.json({ ok: true }); });';
    const code = buildSecurityApiTest(pedidos);
    expect(code).not.toContain("expect.fail");
    expect(code).toContain("pode estar no middleware");
    expect(code).toContain("O teste não falha por isso.");
    expect(code).toContain("content-security-policy");
    expect(code).not.toContain("OR 1=1");
    expect(code).not.toContain("<script>");
    expect(code).not.toContain("169.254.169.254");
    expect(code).not.toContain("exemplo-externo.test");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-owner-"));
    const result = await handleSuggestSecurityChecklist({
      projectRoot: root,
      sourceCode: pedidos,
      filePath: "src/routes/pedidos.ts",
    });
    expect(result.isError).toBeFalsy();
    const written = fs.readFileSync(path.join(root, "security.api.test.ts"), "utf8");
    expect(written).not.toContain("expect.fail");
    expect(written).toContain("pode estar no middleware");
    expect(written).toContain("O teste não falha por isso.");
    expect(written).not.toContain("OR 1=1");
    expect(written).not.toContain("<script>");
    expect(written).not.toContain("169.254.169.254");
    expect(fs.existsSync(path.join(root, "e2e", "security-front.spec.ts"))).toBe(false);
  });

  it("não gera fail de dono quando o handler compara o id", () => {
    const source = `app.get("/pedidos/:id", (req, res) => {
      if (req.user.id !== req.params.id) return res.status(403).end();
      res.status(200).json({ ok: true });
    });`;
    const code = buildSecurityApiTest(source);
    expect(code).toContain("toBe(403)");
    expect(code).not.toContain("expect.fail");
    expect(code).not.toContain("pode estar no middleware");
  });

  it("inclui cookie, csrf e CORS só quando o fonte mostra isso", () => {
    const page = `export default function Pagamento() {
      res.cookie("sessao", "1");
      return <form method="post"><button>Enviar</button></form>;
    }`;
    const spec = buildSecurityFrontSpec("src/pages/Pagamento.tsx", page);
    expect(spec).toContain("httponly");
    expect(spec).toContain("samesite");
    expect(spec).toContain("csrf");
    expect(spec).toContain("csrf-token");

    const withCors = `const cors = require("cors");
app.use(cors({ credentials: true }));
app.get("/pedidos", (_req, res) => res.json({ ok: true }));`;
    const corsCode = buildSecurityApiTest(withCors);
    expect(corsCode).toContain("https://exemplo-externo.test");
    expect(corsCode).toContain("access-control-allow-origin");
    expect(corsCode).toContain('.not.toBe("https://exemplo-externo.test")');

    const reflected = `app.use((req, res, next) => { res.set("Access-Control-Allow-Origin", req.headers.origin); next(); });
app.get("/pedidos", (_req, res) => res.json({ ok: true }));`;
    const open = buildSecurityApiTest(reflected);
    expect(open).toContain("access-control-allow-credentials");
    expect(open).not.toContain('.not.toBe("https://exemplo-externo.test")');
  });

  it("não marca execução de k6 para host externo", () => {
    expect(k6ExecutionAllowed("https://app.example.com")).toBe(false);
    expect(k6ExecutionAllowed("http://127.0.0.1:3000/health")).toBe(true);
    expect(k6ExecutionAllowed("http://localhost:3000/health")).toBe(true);
    expect(isLocalHost("https://app.example.com")).toBe(false);
    expect(isLocalHost("http://127.0.0.1:3000")).toBe(true);
  });

  it("monta o eslint com argumentos fixos", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-eslint-"));
    const binDir = path.join(root, "node_modules", "eslint", "bin");
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, "eslint.js"), "");
    const plan = await prepareClosedCommand(root, "eslint");
    expect(plan.available).toBe(true);
    expect(plan.command?.command).toBe(process.execPath);
    expect(plan.command?.args.slice(1)).toEqual([".", "--max-warnings", "0"]);
    expect(plan.command?.args.join(" ")).not.toContain("example.com");
  });

  it("mantém o k6 num arquivo fixo quando o binário existe", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-k6-"));
    fs.mkdirSync(path.join(root, "perf"), { recursive: true });
    fs.writeFileSync(path.join(root, "perf", "carga.k6.js"), "export default function () {}\n");
    const plan = await prepareClosedCommand(root, "k6");
    if (!plan.available || !plan.command) {
      expect(plan.message.toLowerCase()).toContain("k6");
      return;
    }
    expect(plan.command.args).toEqual(["run", "perf/carga.k6.js"]);
    expect(plan.command.args.join(" ")).not.toContain("example.com");
  });

  it("inclui SCA no código de produção quando há package.json", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-sca-map-"));
    fs.writeFileSync(path.join(root, "package.json"), "{}");
    const result = mapTestsForEdit({
      filePath: "src/pricing.ts",
      projectRoot: root,
      sourceCode: "export function price(amount) { return amount; }",
    });
    const body = result.content[0]?.text ?? "";
    const start = body.indexOf("## Use nesta ordem");
    const end = body.indexOf("## Não use");
    const tools = [...body.slice(start, end).matchAll(/^\d+\. `([^`]+)`/gm)].map((match) => match[1]);
    expect(tools[0]).toBe("generate_unit_test");
    expect(tools).toContain("suggest_sca_setup");
  });
});
