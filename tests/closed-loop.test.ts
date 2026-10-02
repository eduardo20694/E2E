import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseAllureResult, parseJunit } from "../src/lib/report.js";
import { buildRunnerCommand } from "../src/lib/runner.js";
import { findProjectRoot, resolveInside, writeProjectFile } from "../src/lib/workspace.js";
import { diagnoseTestReport } from "../src/tools/execution.js";
import { handleGenerateIntegrationTest } from "../src/tools/integration.js";
import { handleCodeCoverageAdvisor } from "../src/tools/metrics.js";
import { buildUnitTest } from "../src/tools/unit.js";

describe("ciclo fechado", () => {
  it("recusa caminho fora da raiz", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-root-"));
    expect(() => resolveInside(root, path.join(root, "..", "fora.txt"))).toThrow(/fora da raiz/);
  });

  it("grava teste ao lado e não sobrescreve", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-write-"));
    const destination = writeProjectFile(root, path.join("src", "add.test.ts"), "test('ok', () => {})");
    expect(fs.readFileSync(destination, "utf8")).toContain("test(");
    expect(() => writeProjectFile(root, path.join("src", "add.test.ts"), "outro")).toThrow(/já existe/);
  });

  it("recusa manifesto e json solto", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-deny-"));
    expect(() => writeProjectFile(root, "package.json", "{}", true)).toThrow(/Recuso gravar/);
    expect(() => writeProjectFile(root, "pom.xml", "<project/>", true)).toThrow(/Recuso gravar/);
    expect(() => writeProjectFile(root, "data.json", "{}")).toThrow(/lista permitida/);
    const fixture = writeProjectFile(root, "tests/fixtures/user.json", "{}");
    expect(fs.existsSync(fixture)).toBe(true);
  });

  it("grava integração sem flag quando a raiz existe", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-int-"));
    const result = await handleGenerateIntegrationTest({
      description: "pedido grava estoque",
      projectRoot: root,
    });
    const destination = path.join(root, "integration.test.ts");
    expect(fs.existsSync(destination)).toBe(true);
    expect(fs.readFileSync(destination, "utf8")).toContain("integração");
    expect(result.content[0]?.text).toContain("Gravado");
  });

  it("lê lcov.info da raiz sem o argumento report", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-lcov-"));
    fs.mkdirSync(path.join(root, "coverage"));
    fs.writeFileSync(
      path.join(root, "coverage", "lcov.info"),
      "SF:src/payment.ts\nDA:10,0\nDA:11,1\nend_of_record\n",
    );
    const result = await handleCodeCoverageAdvisor({ projectRoot: root });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("payment.ts");
  });

  it("acha a raiz subindo até o package.json", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-walk-"));
    fs.writeFileSync(path.join(root, "package.json"), "{}");
    fs.mkdirSync(path.join(root, "src"));
    const file = path.join(root, "src", "add.ts");
    fs.writeFileSync(file, "export function add(a: number, b: number) { return a + b }");
    expect(findProjectRoot(file)).toBe(root);
    const built = buildUnitTest({ sourceCode: fs.readFileSync(file, "utf8"), filePath: file, projectRoot: root });
    expect(built.result.isError).toBeUndefined();
    expect(built.fileName).toBe("add.test.ts");
  });

  it("lê falha de JUnit e de Allure", () => {
    const junit = parseJunit(`<testsuite>
      <testcase classname="Pricing" name="desconto"/>
      <testcase classname="Pricing" name="limite"><failure message="expected 10">stack</failure></testcase>
    </testsuite>`);
    expect(junit.cases.find((item) => item.name.includes("limite"))?.status).toBe("failed");

    const allure = parseAllureResult(JSON.stringify({ name: "checkout", status: "failed", statusDetails: { message: "timeout" } }));
    const diagnosed = diagnoseTestReport({ report: JSON.stringify({ name: allure.name, status: "failed", statusDetails: { message: "timeout" } }) });
    expect(diagnosed.content[0]?.text).toContain("timeout");
  });

  it("monta o comando do Vitest sem shell", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-bin-"));
    const binDir = path.join(root, "node_modules", "vitest");
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, "vitest.mjs"), "");
    const command = buildRunnerCommand(root, "vitest", "src/add.test.ts");
    expect(command.command).toBe(process.execPath);
    expect(command.args[0]).toContain("vitest.mjs");
    expect(command.args).toContain("run");
    expect(command.args.some((arg) => arg.endsWith("add.test.ts"))).toBe(true);
  });
});
