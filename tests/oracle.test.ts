import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeProjectFile } from "../src/lib/workspace.js";
import { buildUnitTest } from "../src/tools/unit.js";

describe("oracle da asserção", () => {
  it("soma pura vira toBe com o valor dos argumentos de exemplo", () => {
    const built = buildUnitTest({
      sourceCode: "export function add(a, b) { return a + b; }",
      framework: "vitest",
      filePath: "src/add.ts",
    });
    expect(built.code).toContain("add(1, 2)");
    expect(built.code).toContain("expect(result).toBe(3)");
    expect(built.code).not.toContain("valorvalor");
    expect(built.code).not.toContain("toBeDefined");
    expect(built.code).not.toContain("assert result is not None");
  });

  it("corpo opaco falha e o arquivo gerado não passa à toa", () => {
    const built = buildUnitTest({
      sourceCode: "export function load(url) { return fetch(url); }",
      framework: "vitest",
      filePath: "src/load.ts",
    });
    expect(built.code).toContain('expect.fail("Contrato de load ainda não foi preenchido.")');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-oracle-"));
    const destination = writeProjectFile(root, built.fileName ?? "load.test.ts", built.code ?? "");
    const generated = fs.readFileSync(destination, "utf8");
    expect(generated).not.toContain("toBeDefined");
    expect(generated).not.toContain("expect(true).toBe(true)");
  });

  it("nome e título continuam concatenação", () => {
    const built = buildUnitTest({
      sourceCode: "export function label(name, title) { return name + title; }",
      framework: "vitest",
      filePath: "src/label.ts",
    });
    expect(built.code).toContain('expect(result).toBe("exemploexemplo")');
  });

  it("retorno de um parâmetro genérico continua valor", () => {
    const built = buildUnitTest({
      sourceCode: "export function echo(a) { return a; }",
      framework: "vitest",
      filePath: "src/echo.ts",
    });
    expect(built.code).toContain('echo("valor")');
    expect(built.code).toContain('expect(result).toBe("valor")');
  });
});
