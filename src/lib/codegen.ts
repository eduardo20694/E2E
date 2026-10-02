import type { UnitFramework } from "./detect.js";
import { analyzeFunction, formatValue, numericParamValues, parseSampleCode, type FunctionContract, type ValueLang } from "./oracle.js";
import type { SymbolInfo } from "./symbols.js";
import { moduleNameFromPath } from "./symbols.js";
import {
  exportedApp,
  extractRoutes,
  extractUi,
  screenComponent,
  type UiControl,
  type WebRoute,
} from "./web.js";

export function sampleArg(param: string, index: number): string {
  const name = param.toLowerCase();
  if (/id|uuid/.test(name)) return `"id-${index + 1}"`;
  if (/email/.test(name)) return `"user@example.com"`;
  if (/name|title|label/.test(name)) return `"exemplo"`;
  if (/count|qty|quantity|age|total|amount|price|limit|min|max|n\b/.test(name)) return "1";
  if (/enabled|active|flag|is[A-Z_]/.test(name)) return "true";
  if (/list|items|array/.test(name)) return "[]";
  if (/date|time/.test(name)) return "new Date('2026-01-15T00:00:00Z')";
  return `"valor"`;
}

function valueLang(framework: UnitFramework): ValueLang {
  if (framework === "pytest") return "py";
  if (framework === "junit") return "java";
  if (framework === "rspec") return "ruby";
  if (framework === "go") return "go";
  return "js";
}

function bindings(symbol: SymbolInfo, lang: ValueLang, source?: string): Array<{ name: string; value: unknown }> {
  const numeric = source ? numericParamValues(source, symbol.name, symbol.params) : new Map<string, number>();
  return symbol.params.map((name, index) => {
    if (numeric.has(name)) return { name, value: numeric.get(name) };
    let value = parseSampleCode(sampleArg(name, index));
    if (lang !== "js" && value instanceof Date) value = value.toISOString().replace(".000Z", "Z");
    return { name, value };
  });
}

function contractFor(source: string | undefined, symbol: SymbolInfo, lang: ValueLang): FunctionContract {
  const empty: FunctionContract = { pure: false, evaluated: false, rejectsMissing: false, deep: false, lang: lang === "py" ? "py" : "js" };
  if (!source?.trim()) return empty;
  return analyzeFunction(source, symbol.name, bindings(symbol, lang, source));
}

function argsLiteral(symbol: SymbolInfo, lang: ValueLang, source?: string): string {
  return bindings(symbol, lang, source)
    .map((item) => formatValue(item.value, lang))
    .join(", ");
}

function expectedLiteral(contract: FunctionContract, lang: ValueLang): string | undefined {
  if (!contract.pure || !contract.evaluated) return undefined;
  try {
    return formatValue(contract.value, lang);
  } catch {
    return undefined;
  }
}

function contractMessage(name: string): string {
  return `Contrato de ${name} ainda não foi preenchido.`;
}

export function renderUnitTest(options: {
  framework: UnitFramework;
  symbols: SymbolInfo[];
  moduleName: string;
  filePath?: string;
  externalImports: string[];
  sourceCode?: string;
}): { language: string; fileName: string; code: string } {
  const symbols = options.symbols.length
    ? options.symbols
    : [{ kind: "function" as const, name: "subject", params: [], async: false }];

  if ((options.framework === "jest" || options.framework === "vitest") && options.sourceCode) {
    const component = screenComponent(options.sourceCode, options.filePath);
    if (component) {
      return renderComponentTest(options.framework, component, options);
    }
  }

  switch (options.framework) {
    case "pytest":
      return { language: "python", fileName: `test_${options.moduleName}.py`, code: pytest(symbols, options.moduleName, options.sourceCode) };
    case "junit":
      return { language: "java", fileName: `${pascal(options.moduleName)}Test.java`, code: junit(symbols, options.moduleName, options.sourceCode) };
    case "rspec":
      return { language: "ruby", fileName: `${options.moduleName}_spec.rb`, code: rspec(symbols, options.moduleName, options.sourceCode) };
    case "go":
      return { language: "go", fileName: `${options.moduleName}_test.go`, code: goTest(symbols, options.sourceCode) };
    case "jest":
      return {
        language: "ts",
        fileName: `${options.moduleName}.test.ts`,
        code: jsTest("jest", symbols, options),
      };
    default:
      return {
        language: "ts",
        fileName: `${options.moduleName}.test.ts`,
        code: jsTest("vitest", symbols, options),
      };
  }
}

function renderComponentTest(
  framework: "jest" | "vitest",
  component: { name: string; defaultExport: boolean },
  options: { moduleName: string; filePath?: string; sourceCode?: string },
): { language: string; fileName: string; code: string } {
  const controls = extractUi(options.sourceCode ?? "");
  const specifier = options.filePath ? `./${moduleNameFromPath(options.filePath)}` : `./${options.moduleName}`;
  const importLine =
    framework === "vitest"
      ? `import { describe, it, expect } from "vitest";`
      : `import { describe, it, expect } from "@jest/globals";`;
  const componentImport = component.defaultExport
    ? `import ${component.name} from "${specifier}";`
    : `import { ${component.name} } from "${specifier}";`;
  const asserts = componentAssertions(controls);
  const fileRef = options.filePath ?? options.moduleName;
  const body = asserts.length
    ? asserts.join("\n")
    : `    expect.fail(${JSON.stringify(`Nenhum controle extraído de ${fileRef}.`)});`;
  const jsx = options.filePath?.toLowerCase().endsWith(".jsx");
  return {
    language: "tsx",
    fileName: `${options.moduleName}.test.${jsx ? "jsx" : "tsx"}`,
    code: `${importLine}
import { render, screen } from "@testing-library/react";
${componentImport}

describe("${component.name}", () => {
  it("mostra os controles da tela", () => {
    render(<${component.name} />);
${body}
  });
});
`,
  };
}

function componentAssertions(controls: UiControl[]): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  const add = (line: string) => {
    if (seen.has(line)) return;
    seen.add(line);
    lines.push(`    ${line}`);
  };
  for (const control of controls) {
    if ((control.kind === "button" || control.kind === "link" || control.kind === "heading") && control.text) {
      const role = control.kind === "button" ? "button" : control.kind === "link" ? "link" : "heading";
      add(`expect(screen.getByRole("${role}", { name: ${JSON.stringify(control.text)} })).toBeInTheDocument();`);
    } else if (control.kind === "label" && control.text) {
      add(`expect(screen.getByLabelText(${JSON.stringify(control.text)})).toBeInTheDocument();`);
    } else if (control.kind === "placeholder" && control.text) {
      add(`expect(screen.getByPlaceholderText(${JSON.stringify(control.text)})).toBeInTheDocument();`);
    } else if (control.kind === "testid" && control.text) {
      add(`expect(screen.getByTestId(${JSON.stringify(control.text)})).toBeInTheDocument();`);
    } else if (control.kind === "role" && control.text) {
      const named = control.name ? `, { name: ${JSON.stringify(control.name)} }` : "";
      add(`expect(screen.getByRole(${JSON.stringify(control.text)}${named})).toBeInTheDocument();`);
    } else if (control.kind === "input") {
      add(`expect(screen.getByRole(${JSON.stringify(inputRole(control.type))})).toBeInTheDocument();`);
    }
  }
  return lines;
}

function inputRole(type?: string): string {
  if (type === "checkbox") return "checkbox";
  if (type === "radio") return "radio";
  if (type === "button" || type === "submit") return "button";
  return "textbox";
}

function jsTest(
  framework: "jest" | "vitest",
  symbols: SymbolInfo[],
  options: { moduleName: string; filePath?: string; externalImports: string[]; sourceCode?: string },
): string {
  const mockFn = framework === "vitest" ? "vi" : "jest";
  const importLine =
    framework === "vitest"
      ? `import { describe, it, expect, vi, beforeEach } from "vitest";`
      : `import { describe, it, expect, jest, beforeEach } from "@jest/globals";`;
  const specifier = options.filePath
    ? `./${moduleNameFromPath(options.filePath)}`
    : `./${options.moduleName}`;
  const names = symbols.filter((symbol) => symbol.kind !== "method").map((symbol) => symbol.name);
  const imported = names.length ? names.join(", ") : "subject";
  const mocks = options.externalImports
    .filter((source) => !source.startsWith("."))
    .slice(0, 5)
    .map((source) => `${mockFn}.mock("${source}", () => ({ default: ${mockFn}.fn() }));`);

  const blocks = symbols.map((symbol) => {
    const contract = contractFor(options.sourceCode, symbol, "js");
    const expected = expectedLiteral(contract, "js");
    const invocation = symbol.async
      ? `const result = await ${symbol.name}(${argsLiteral(symbol, "js", options.sourceCode)});`
      : `const result = ${symbol.name}(${argsLiteral(symbol, "js", options.sourceCode)});`;
    const happy = expected
      ? [
          `    it("retorna o resultado esperado para entrada válida", ${symbol.async ? "async " : ""}() => {`,
          `      ${invocation}`,
          `      expect(result).${contract.deep ? "toEqual" : "toBe"}(${expected});`,
          `    });`,
        ]
      : [
          `    it("retorna o resultado esperado para entrada válida", () => {`,
          `      expect.fail(${JSON.stringify(contractMessage(symbol.name))});`,
          `    });`,
        ];
    const invalid = contract.rejectsMissing
      ? [
          ``,
          `    it("rejeita parâmetro ausente", ${symbol.async ? "async " : ""}() => {`,
          symbol.async
            ? `      await expect(${symbol.name}(${symbol.params.map(() => "undefined").join(", ")})).rejects.toThrow();`
            : `      expect(() => ${symbol.name}(${symbol.params.map(() => "undefined").join(", ")})).toThrow();`,
          `    });`,
        ]
      : [];
    return [
      `  describe("${symbol.name}", () => {`,
      `    beforeEach(() => {`,
      `      ${mockFn}.clearAllMocks();`,
      `    });`,
      ``,
      ...happy,
      ...invalid,
      `  });`,
    ].join("\n");
  });

  return [
    importLine,
    `import { ${imported} } from "${specifier}";`,
    mocks.length ? `\n${mocks.join("\n")}\n` : "",
    `describe("${options.moduleName}", () => {`,
    blocks.join("\n\n"),
    `});`,
  ]
    .filter(Boolean)
    .join("\n");
}

function pytest(symbols: SymbolInfo[], moduleName: string, source?: string): string {
  const cases = symbols
    .map((symbol) => {
      const contract = contractFor(source, symbol, "py");
      const expected = expectedLiteral(contract, "py");
      const happy = expected
        ? [
            `def test_${symbol.name}_caminho_feliz():`,
            `    result = ${symbol.name}(${argsLiteral(symbol, "py", source)})`,
            `    assert result == ${expected}`,
          ]
        : [
            `def test_${symbol.name}_caminho_feliz():`,
            `    pytest.fail(${JSON.stringify(contractMessage(symbol.name))})`,
          ];
      const invalid = contract.rejectsMissing
        ? [
            ``,
            `def test_${symbol.name}_parametro_ausente():`,
            `    with pytest.raises(Exception):`,
            `        ${symbol.name}(${symbol.params.map(() => "None").join(", ")})`,
          ]
        : [];
      return [...happy, ...invalid].join("\n");
    })
    .join("\n\n");

  return [`import pytest`, `from ${moduleName} import ${symbols.map((symbol) => symbol.name).join(", ")}`, ``, cases].join(
    "\n",
  );
}

function junit(symbols: SymbolInfo[], moduleName: string, source?: string): string {
  const className = pascal(moduleName);
  const methods = symbols
    .map((symbol) => {
      const contract = contractFor(source, symbol, "java");
      const expected = expectedLiteral(contract, "java");
      if (!expected) {
        return `    @Test
    @DisplayName("${symbol.name} ainda não teve o contrato preenchido")
    void ${symbol.name}_caminho_feliz() {
        fail(${JSON.stringify(contractMessage(symbol.name))});
    }`;
      }
      const invalid = contract.rejectsMissing
        ? `

    @Test
    @DisplayName("${symbol.name} rejeita parâmetro ausente")
    void ${symbol.name}_parametro_ausente() {
        assertThrows(Exception.class, () -> ${symbol.name}(${symbol.params.map(() => "null").join(", ")}));
    }`
        : "";
      return `    @Test
    @DisplayName("${symbol.name} confere o valor derivado")
    void ${symbol.name}_caminho_feliz() {
        var resultado = ${symbol.name}(${argsLiteral(symbol, "java", source)});
        assertEquals(${expected}, resultado);
    }${invalid}`;
    })
    .join("\n\n");

  return `import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ${className}Test {
${methods}
}`;
}

function rspec(symbols: SymbolInfo[], moduleName: string, source?: string): string {
  const examples = symbols
    .map((symbol) => {
      const contract = contractFor(source, symbol, "ruby");
      const expected = expectedLiteral(contract, "ruby");
      const happy = expected
        ? `    it "retorna o resultado do caminho feliz" do
      expect(subject.${symbol.name}(${argsLiteral(symbol, "ruby", source)})).to eq(${expected})
    end`
        : `    it "retorna o resultado do caminho feliz" do
      raise ${JSON.stringify(contractMessage(symbol.name))}
    end`;
      const invalid = contract.rejectsMissing
        ? `

    it "rejeita parâmetro ausente" do
      expect { subject.${symbol.name}(${symbol.params.map(() => "nil").join(", ")}) }.to raise_error
    end`
        : "";
      return `  describe "#${symbol.name}" do
${happy}${invalid}
  end`;
    })
    .join("\n\n");

  return `require "spec_helper"

RSpec.describe ${pascal(moduleName)} do
${examples}
end`;
}

function goTest(symbols: SymbolInfo[], source?: string): string {
  const tests = symbols
    .map((symbol) => {
      const contract = contractFor(source, symbol, "go");
      const expected = expectedLiteral(contract, "go");
      const call = `${pascal(symbol.name)}(${argsLiteral(symbol, "go", source)})`;
      const happy = expected
        ? `    t.Run("caminho feliz", func(t *testing.T) {
        got := ${call}
        want := ${expected}
        if got != want {
            t.Fatalf("got %v want %v", got, want)
        }
    })`
        : `    t.Run("caminho feliz", func(t *testing.T) {
        t.Fatal(${JSON.stringify(`contrato de ${symbol.name} ainda não foi preenchido`)})
    })`;
      const invalid = contract.rejectsMissing
        ? `

    t.Run("parâmetro ausente", func(t *testing.T) {
        defer func() {
            if recover() == nil {
                t.Fatal("esperava panic com parâmetro ausente")
            }
        }()
        ${pascal(symbol.name)}(${symbol.params.map(() => "nil").join(", ")})
    })`
        : "";
      return `func Test${pascal(symbol.name)}(t *testing.T) {
${happy}${invalid}
}`;
    })
    .join("\n\n");
  return `package main

import "testing"

${tests}`;
}

function pascal(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9]+/g, " ").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  const name = parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
  return name || "Subject";
}

export function renderIntegrationTest(options: {
  description: string;
  modules: string[];
  database?: string;
  useTestcontainers: boolean;
  language: "ts" | "python" | "java";
  sourceCode?: string;
  filePath?: string;
  baseUrl?: string;
}): { language: string; fileName: string; code: string } {
  const db = options.database ?? "postgres";
  const routes = options.sourceCode ? extractRoutes(options.sourceCode, options.filePath) : [];
  if (routes.length > 0) {
    if (options.language === "python") {
      return { language: "python", fileName: "test_integration.py", code: pythonRouteIntegration(options, routes, db) };
    }
    if (options.language === "java") {
      return { language: "java", fileName: "IntegrationTest.java", code: javaRouteIntegration(options, routes, db) };
    }
    return { language: "ts", fileName: "integration.test.ts", code: tsRouteIntegration(options, routes, db) };
  }
  if (options.language === "python") {
    return {
      language: "python",
      fileName: "test_integration.py",
      code: pythonIntegration(options, db),
    };
  }
  if (options.language === "java") {
    return { language: "java", fileName: "IntegrationTest.java", code: javaIntegration(options, db) };
  }
  return { language: "ts", fileName: "integration.test.ts", code: tsIntegration(options, db) };
}

function tsIntegration(
  options: { description: string; modules: string[]; useTestcontainers: boolean },
  db: string,
): string {
  const container = options.useTestcontainers
    ? `
import { PostgreSqlContainer } from "@testcontainers/postgresql";

describe("integração", () => {
  let url: string;
  beforeAll(async () => {
    const container = await new PostgreSqlContainer("${db === "postgres" ? "postgres:16-alpine" : "postgres:16-alpine"}").start();
    url = container.getConnectionUri();
  }, 60_000);

  it("sobe o container do banco", () => {
    expect(url).toContain("${db === "postgres" ? "postgres" : db}");
  });

  it("${escapeQuote(options.description)}", async () => {
    expect.fail("Afirme o efeito observável: linha gravada, evento ou HTTP.");
  });
});`
    : `
describe("integração", () => {
  it("${escapeQuote(options.description)}", async () => {
    expect.fail("Afirme o efeito observável: linha gravada, evento ou HTTP.");
  });
});`;

  return `import { describe, it, expect, beforeAll, afterAll } from "vitest";
${container}`;
}

function pythonIntegration(
  options: { description: string; modules: string[]; useTestcontainers: boolean },
  db: string,
): string {
  if (!options.useTestcontainers) {
    return `import pytest

def test_integracao():
    """${options.description}"""
    pytest.fail("Afirme o efeito observável: linha gravada, evento ou HTTP.")
`;
  }
  return `import pytest
from testcontainers.postgres import PostgresContainer

@pytest.fixture(scope="module")
def database_url():
    with PostgresContainer("postgres:16-alpine") as postgres:
        yield postgres.get_connection_url()

def test_container_sobe(database_url):
    assert "${db}" in database_url

def test_integracao(database_url):
    """${options.description}"""
    pytest.fail("Afirme o efeito observável: linha gravada, evento ou HTTP.")
`;
}

function javaIntegration(
  options: { description: string; useTestcontainers: boolean },
  db: string,
): string {
  if (!options.useTestcontainers) {
    return `import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class IntegrationTest {
    @Test
    void efeitoObservavel() {
        fail("Afirme o efeito observável: linha gravada, evento ou HTTP.");
    }
}
`;
  }
  return `import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import static org.junit.jupiter.api.Assertions.*;

@Testcontainers
class IntegrationTest {
    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

    @Test
    void containerSobe() {
        assertTrue(postgres.getJdbcUrl().contains("${db}"));
    }

    @Test
    void efeitoObservavel() {
        fail("Afirme o efeito observável: linha gravada, evento ou HTTP.");
    }
}
`;
}

function escapeQuote(value: string): string {
  return value.replace(/["\\]/g, "").slice(0, 80);
}

function localBase(baseUrl?: string): string {
  const raw = baseUrl?.trim() || "http://127.0.0.1:3000";
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    return raw.replace(/\/$/, "");
  }
}

function appSpecifier(filePath?: string): string {
  if (!filePath) return "./app";
  const normalized = filePath.replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(normalized) || normalized.startsWith("/")) {
    const base = normalized.split("/").pop() ?? "app";
    return `./${base.replace(/\.[^.]+$/, "")}`;
  }
  return `./${normalized.replace(/^\.\//, "").replace(/\.[^.]+$/, "")}`;
}

function tsRouteIntegration(
  options: { sourceCode?: string; filePath?: string; baseUrl?: string; useTestcontainers: boolean },
  routes: WebRoute[],
  db: string,
): string {
  const appKind = options.sourceCode ? exportedApp(options.sourceCode) : undefined;
  const imports = [`import { describe, it, expect${options.useTestcontainers ? ", beforeAll" : ""} } from "vitest";`];
  if (appKind) {
    imports.push(`import request from "supertest";`);
    imports.push(
      appKind === "default"
        ? `import app from "${appSpecifier(options.filePath)}";`
        : `import { app } from "${appSpecifier(options.filePath)}";`,
    );
  }
  if (options.useTestcontainers) {
    imports.push(`import { PostgreSqlContainer } from "@testcontainers/postgresql";`);
  }
  const image = db === "postgres" ? "postgres" : db;
  const container = options.useTestcontainers
    ? `
  let url: string;
  beforeAll(async () => {
    const container = await new PostgreSqlContainer("${db === "postgres" ? "postgres:16-alpine" : "postgres:16-alpine"}").start();
    url = container.getConnectionUri();
  }, 60_000);

  it("sobe o container do banco", () => {
    expect(url).toContain("${image}");
  });
`
    : "";
  const calls = routes
    .map((route) => {
      const call = appKind
        ? `const response = await request(app).${route.method.toLowerCase()}(${JSON.stringify(route.path)});`
        : `const response = await fetch(baseUrl + ${JSON.stringify(route.path)}, { method: ${JSON.stringify(route.method)} });`;
      return `  it(${JSON.stringify(`${route.method} ${route.path}`)}, async () => {
    ${call}
    expect(response.status).toBe(${route.status});
  });`;
    })
    .join("\n\n");
  const base = appKind ? "" : `const baseUrl = ${JSON.stringify(localBase(options.baseUrl))};\n\n`;
  return `${imports.join("\n")}\n\n${base}describe("integração", () => {${container}\n${calls}\n});\n`;
}

function pythonRouteIntegration(
  options: { baseUrl?: string; useTestcontainers: boolean },
  routes: WebRoute[],
  db: string,
): string {
  const base = localBase(options.baseUrl);
  const calls = routes
    .map(
      (route) => `def test_${route.method.toLowerCase()}_${route.path.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") || "rota"}():
    response = httpx.request(${JSON.stringify(route.method)}, BASE + ${JSON.stringify(route.path)})
    assert response.status_code == ${route.status}
`,
    )
    .join("\n");
  if (!options.useTestcontainers) {
    return `import httpx

BASE = ${JSON.stringify(base)}

${calls}`;
  }
  return `import httpx
import pytest
from testcontainers.postgres import PostgresContainer

BASE = ${JSON.stringify(base)}

@pytest.fixture(scope="module")
def database_url():
    with PostgresContainer("postgres:16-alpine") as postgres:
        yield postgres.get_connection_url()

def test_container_sobe(database_url):
    assert ${JSON.stringify(db)} in database_url

${calls}`;
}

function javaRouteIntegration(
  options: { baseUrl?: string; useTestcontainers: boolean },
  routes: WebRoute[],
  db: string,
): string {
  const base = localBase(options.baseUrl);
  const calls = routes
    .map((route) => {
      const builder =
        route.method === "GET"
          ? `HttpRequest.newBuilder(URI.create(${JSON.stringify(base + route.path)})).GET().build()`
          : `HttpRequest.newBuilder(URI.create(${JSON.stringify(base + route.path)})).method(${JSON.stringify(route.method)}, HttpRequest.BodyPublishers.noBody()).build()`;
      return `    @Test
    void ${route.method.toLowerCase()}${pascal(route.path)}() throws Exception {
        var client = HttpClient.newHttpClient();
        var response = client.send(${builder}, HttpResponse.BodyHandlers.discarding());
        assertEquals(${route.status}, response.statusCode());
    }`;
    })
    .join("\n\n");
  if (!options.useTestcontainers) {
    return `import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class IntegrationTest {
${calls}
}
`;
  }
  return `import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import static org.junit.jupiter.api.Assertions.*;

@Testcontainers
class IntegrationTest {
    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

    @Test
    void containerSobe() {
        assertTrue(postgres.getJdbcUrl().contains(${JSON.stringify(db)}));
    }

${calls}
}
`;
}

interface E2eRenderOptions {
  steps: string[];
  baseUrl: string;
  title: string;
  controls?: UiControl[];
  route?: string;
  sourceCode?: string;
  filePath?: string;
}

const E2E_ORIGIN = "http://127.0.0.1:3000";

export function renderE2eTest(options: E2eRenderOptions & {
  framework: "playwright" | "cypress" | "selenium";
}): { language: string; fileName: string; code: string } {
  if (options.framework === "cypress") return { language: "ts", fileName: "flow.cy.spec.ts", code: cypress(options) };
  if (options.framework === "selenium") return { language: "ts", fileName: "flow.selenium.spec.ts", code: selenium(options) };
  return { language: "ts", fileName: "flow.spec.ts", code: playwright(options) };
}

function playwright(options: E2eRenderOptions): string {
  if (!options.controls?.length) {
    return `import { test, expect } from "@playwright/test";

test("${escapeQuote(options.title)}", async () => {
  expect(false, "Passe o arquivo da tela.").toBe(true);
});
`;
  }
  const fixture = screenFixture(options);
  const steps = options.steps.map((step, index) => `  // ${index + 1}. ${step}`);
  const visible = [
    ...options.controls.map((control) => playwrightVisible(control)).filter((line): line is string => Boolean(line)),
    ...fixture.listLabels.map(
      (label) => `  await expect(page.getByText(${JSON.stringify(label)}, { exact: true })).toBeVisible();`,
    ),
  ];
  const clicks = options.controls
    .map((control) => playwrightClick(control))
    .filter((line): line is string => Boolean(line));
  const route = options.route && options.route !== "/" ? options.route : "";
  const goto = route
    ? `  const baseUrl = ${JSON.stringify(E2E_ORIGIN)};\n  await page.goto(baseUrl + ${JSON.stringify(route)});`
    : `  await page.goto(${JSON.stringify(E2E_ORIGIN)});`;
  return `import { test, expect } from "@playwright/test";

test("${escapeQuote(options.title)}", async ({ page }) => {
  const html = ${JSON.stringify(fixture.html)};
  const json = ${JSON.stringify(fixture.json)};
  await page.route("**/*", async (route) => {
    const type = route.request().resourceType();
    if (type === "document") {
      await route.fulfill({ status: 200, contentType: "text/html", body: html });
      return;
    }
    if (type === "xhr" || type === "fetch") {
      await route.fulfill({ status: 200, contentType: "application/json", body: json });
      return;
    }
    if (type === "stylesheet" || type === "script" || type === "image" || type === "font") {
      await route.fulfill({ status: 200, body: "" });
      return;
    }
    await route.fulfill({ status: 200, body: "" });
  });
${goto}
${steps.length ? `${steps.join("\n")}\n` : ""}${visible.join("\n")}
${clicks.join("\n")}
});
`;
}

function playwrightVisible(control: UiControl): string | undefined {
  if (control.kind === "button" && control.text) {
    return `  await expect(page.getByRole("button", { name: ${JSON.stringify(control.text)} })).toBeVisible();`;
  }
  if (control.kind === "link" && control.text) {
    return `  await expect(page.getByRole("link", { name: ${JSON.stringify(control.text)} })).toBeVisible();`;
  }
  if (control.kind === "heading" && control.text) {
    return `  await expect(page.getByRole("heading", { name: ${JSON.stringify(control.text)} })).toBeVisible();`;
  }
  if (control.kind === "label" && control.text) {
    return `  await expect(page.getByLabel(${JSON.stringify(control.text)})).toBeVisible();`;
  }
  if (control.kind === "placeholder" && control.text) {
    return `  await expect(page.getByPlaceholder(${JSON.stringify(control.text)})).toBeVisible();`;
  }
  if (control.kind === "testid" && control.text) {
    return `  await expect(page.getByTestId(${JSON.stringify(control.text)})).toBeVisible();`;
  }
  if (control.kind === "role" && control.text) {
    const named = control.name ? `, { name: ${JSON.stringify(control.name)} }` : "";
    return `  await expect(page.getByRole(${JSON.stringify(control.text)}${named})).toBeVisible();`;
  }
  return undefined;
}

function playwrightClick(control: UiControl): string | undefined {
  if (control.kind === "button" && control.text) {
    return `  await page.getByRole("button", { name: ${JSON.stringify(control.text)} }).click();`;
  }
  if (control.kind === "link" && control.text) {
    return `  await page.getByRole("link", { name: ${JSON.stringify(control.text)} }).click();`;
  }
  return undefined;
}

interface ScreenFixture {
  html: string;
  json: string;
  listLabels: string[];
}

function screenFixture(options: E2eRenderOptions): ScreenFixture {
  const controls = options.controls ?? [];
  const routes = options.sourceCode ? extractRoutes(options.sourceCode, options.filePath) : [];
  const list = options.sourceCode ? renderedList(options.sourceCode) : undefined;
  const hint = controls.find((control) => control.text)?.text;
  const labels = list ? [`${list.noun} 1`, `${list.noun} 2`] : [];
  const parts = controls.map((control) => controlMarkup(control)).filter((part): part is string => Boolean(part));
  if (labels.length) {
    parts.push(`<ul>${labels.map((label) => `<li>${escapeHtml(label)}</li>`).join("")}</ul>`);
  }
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${parts.join("")}</body></html>`;
  return { html, json: JSON.stringify(mockPayload(routes, list, hint)), listLabels: labels };
}

function mockPayload(routes: WebRoute[], list: { noun: string } | undefined, hint?: string): unknown {
  const one = (id: number, name: string) => ({ id, title: name, name, mocked: true });
  if (list) {
    const items = [one(1, `${list.noun} 1`), one(2, `${list.noun} 2`)];
    if (routes.length === 0) return items;
    return Object.fromEntries(routes.map((route) => [`${route.method} ${route.path}`, items]));
  }
  const body = one(1, hint?.trim() || "item");
  if (routes.length === 0) return body;
  return Object.fromEntries(routes.map((route) => [`${route.method} ${route.path}`, { ...body }]));
}

function renderedList(source: string): { noun: string } | undefined {
  const named = /([A-Za-z_$][\w$]*)\s*\.\s*map\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = named.exec(source))) {
    const window = source.slice(Math.max(0, match.index - 80), match.index + 800);
    if (/<[A-Za-z]/.test(window)) return { noun: listNoun(match[1]) };
  }
  const bare = source.search(/\.map\s*\(|\bmap\s*\(/);
  if (bare >= 0) {
    const window = source.slice(Math.max(0, bare - 80), bare + 800);
    if (/<[A-Za-z]/.test(window)) return { noun: "Item" };
  }
  if (/<(?:ul|ol|table|tbody)\b/i.test(source)) {
    const arrayName = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\[/.exec(source);
    return { noun: listNoun(arrayName?.[1] ?? "item") };
  }
  return undefined;
}

function listNoun(raw: string): string {
  const word = raw.replace(/[_$]+/g, " ").trim().split(/\s+/).pop() ?? "item";
  const stem = word.length > 2 && /s$/i.test(word) && !/ss$/i.test(word) ? word.slice(0, -1) : word;
  if (!stem) return "Item";
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

function controlMarkup(control: UiControl): string | undefined {
  const text = control.text ? escapeHtml(control.text) : "";
  if (control.kind === "button" && control.text) return `<button>${text}</button>`;
  if (control.kind === "link" && control.text) return `<a href="#">${text}</a>`;
  if (control.kind === "heading" && control.text) {
    const level = control.level ?? 1;
    return `<h${level}>${text}</h${level}>`;
  }
  if (control.kind === "label" && control.text) return `<label>${text}<input></label>`;
  if (control.kind === "placeholder" && control.text) return `<input placeholder="${text}">`;
  if (control.kind === "testid" && control.text) return `<div data-testid="${text}">${text}</div>`;
  if (control.kind === "role" && control.text) {
    const name = control.name ? ` aria-label="${escapeHtml(control.name)}"` : "";
    const visible = escapeHtml(control.name || control.text);
    return `<div role="${text}"${name}>${visible}</div>`;
  }
  if (control.kind === "input") {
    if (control.type === "textarea") return `<textarea></textarea>`;
    const type = control.type ? ` type="${escapeHtml(control.type)}"` : "";
    return `<input${type}>`;
  }
  return undefined;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function cypress(options: E2eRenderOptions): string {
  if (options.controls?.length) {
    const fixture = screenFixture(options);
    const route = options.route && options.route !== "/" ? options.route : "";
    const visit = route
      ? `    const baseUrl = ${JSON.stringify(E2E_ORIGIN)};\n    const pageUrl = baseUrl + ${JSON.stringify(route)};`
      : `    const pageUrl = ${JSON.stringify(E2E_ORIGIN)};`;
    const steps = options.steps.map((step, index) => `    // ${index + 1}. ${step}`);
    const visible = [
      ...options.controls.map((control) => cypressVisible(control)).filter((line): line is string => Boolean(line)),
      ...fixture.listLabels.map((label) => `    cy.findByText(${JSON.stringify(label)}).should("be.visible");`),
    ];
    const clicks = options.controls
      .map((control) => cypressClick(control))
      .filter((line): line is string => Boolean(line));
    return `describe("${escapeQuote(options.title)}", () => {
  it("completa o fluxo", () => {
    const html = ${JSON.stringify(fixture.html)};
    const json = ${JSON.stringify(fixture.json)};
${visit}
    cy.intercept("**/*", { statusCode: 200, headers: { "content-type": "application/json" }, body: json });
    cy.intercept("GET", pageUrl, { statusCode: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: html });
    cy.visit(pageUrl);
${steps.length ? `${steps.join("\n")}\n` : ""}${visible.join("\n")}
${clicks.join("\n")}
  });
});`;
  }
  const body = options.steps
    .map((step, index) => `    // ${index + 1}. ${step}\n    // cy.findByRole("button", { name: /continuar/i }).click();`)
    .join("\n");
  return `describe("${escapeQuote(options.title)}", () => {
  it("completa o fluxo", () => {
    cy.visit("${options.baseUrl}");
${body}
    cy.location("pathname").should("exist");
  });
});`;
}

function cypressVisible(control: UiControl): string | undefined {
  if (control.kind === "button" && control.text) {
    return `    cy.findByRole("button", { name: ${JSON.stringify(control.text)} }).should("be.visible");`;
  }
  if (control.kind === "link" && control.text) {
    return `    cy.findByRole("link", { name: ${JSON.stringify(control.text)} }).should("be.visible");`;
  }
  if (control.kind === "heading" && control.text) {
    return `    cy.findByRole("heading", { name: ${JSON.stringify(control.text)} }).should("be.visible");`;
  }
  if (control.kind === "label" && control.text) {
    return `    cy.findByLabelText(${JSON.stringify(control.text)}).should("be.visible");`;
  }
  if (control.kind === "placeholder" && control.text) {
    return `    cy.findByPlaceholderText(${JSON.stringify(control.text)}).should("be.visible");`;
  }
  if (control.kind === "testid" && control.text) {
    return `    cy.findByTestId(${JSON.stringify(control.text)}).should("be.visible");`;
  }
  if (control.kind === "role" && control.text) {
    const named = control.name ? `, { name: ${JSON.stringify(control.name)} }` : "";
    return `    cy.findByRole(${JSON.stringify(control.text)}${named}).should("be.visible");`;
  }
  return undefined;
}

function cypressClick(control: UiControl): string | undefined {
  if (control.kind === "button" && control.text) {
    return `    cy.findByRole("button", { name: ${JSON.stringify(control.text)} }).click();`;
  }
  if (control.kind === "link" && control.text) {
    return `    cy.findByRole("link", { name: ${JSON.stringify(control.text)} }).click();`;
  }
  return undefined;
}

function selenium(options: { steps: string[]; baseUrl: string; title: string; controls?: UiControl[]; route?: string }): string {
  const fromScreen = Boolean(options.controls?.length);
  const body = fromScreen
    ? [
        ...gotoLines("selenium", options.baseUrl, options.route),
        ...options.steps.map((step, index) => `    // ${index + 1}. ${step}`),
        ...options.controls!.map((control) => seleniumControl(control)).filter((line): line is string => Boolean(line)),
      ].join("\n")
    : options.steps.map((step, index) => `    // ${index + 1}. ${step}`).join("\n");
  const opener = fromScreen ? "" : `\n    await driver.get("${options.baseUrl}");`;
  const tail = fromScreen ? "" : `\n    await driver.wait(until.urlContains(""), 5000);`;
  return `import { Builder, Browser, By, until } from "selenium-webdriver";
import { describe, it, afterEach } from "vitest";

describe("${escapeQuote(options.title)}", () => {
  let driver: Awaited<ReturnType<Builder["build"]>>;

  afterEach(async () => {
    await driver?.quit();
  });

  it("completa o fluxo", async () => {
    driver = await new Builder().forBrowser(Browser.CHROME).build();${opener}
${body}${tail}
  });
});`;
}

function seleniumControl(control: UiControl): string | undefined {
  if (control.kind === "button" && control.text) {
    return `    await driver.findElement(By.xpath("//button[normalize-space()=${xpathLiteral(control.text)}]")).click();`;
  }
  if (control.kind === "heading" && control.text) {
    return `    await driver.findElement(By.xpath("//*[self::h1 or self::h2 or self::h3][normalize-space()=${xpathLiteral(control.text)}]"));`;
  }
  if (control.kind === "link" && control.text) {
    return `    await driver.findElement(By.linkText(${JSON.stringify(control.text)})).click();`;
  }
  return undefined;
}

function gotoLines(framework: "playwright" | "cypress" | "selenium", baseUrl: string, route?: string): string[] {
  const base = JSON.stringify(localBase(baseUrl));
  if (framework === "cypress") {
    if (!route) return [`    cy.visit(${base});`];
    return [`    const baseUrl = ${base};`, `    cy.visit(baseUrl + ${JSON.stringify(route)});`];
  }
  if (framework === "selenium") {
    if (!route) return [`    await driver.get(${base});`];
    return [`    const baseUrl = ${base};`, `    await driver.get(baseUrl + ${JSON.stringify(route)});`];
  }
  if (!route) return [`  await page.goto(${base});`];
  return [`  const baseUrl = ${base};`, `  await page.goto(baseUrl + ${JSON.stringify(route)});`];
}

function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat('${value.replace(/'/g, `', "'", '`)}')`;
}

export function renderApiTest(options: {
  protocol: "rest" | "graphql" | "grpc";
  specification: string;
  baseUrl: string;
  language: "ts" | "python";
  sourceCode?: string;
  filePath?: string;
}): { language: string; fileName: string; code: string } {
  if (options.protocol === "graphql") {
    return { language: "ts", fileName: "graphql.contract.test.ts", code: graphqlTest(options) };
  }
  if (options.protocol === "grpc") {
    return { language: "ts", fileName: "grpc.contract.test.ts", code: grpcTest(options) };
  }
  const routes = extractRoutes(options.sourceCode || options.specification, options.filePath);
  if (options.language === "python") {
    return { language: "python", fileName: "test_api_contract.py", code: pythonRest(options, routes) };
  }
  return { language: "ts", fileName: "api.contract.test.ts", code: restTest(options, routes) };
}

function restTest(options: { specification: string; baseUrl: string }, routes: WebRoute[]): string {
  if (routes.length === 0) {
    return `import { describe, it, expect } from "vitest";

describe("contrato REST", () => {
  it(${JSON.stringify(escapeQuote(options.specification) || "rota do handler")}, () => {
    expect.fail("Nenhuma rota extraída do handler. Passe o arquivo com o método, o path e o status.");
  });
});`;
  }
  const base = localBase(options.baseUrl);
  const cases = routes.flatMap((route) => restCases(route)).join("\n\n");
  return `import { describe, it, expect } from "vitest";

const baseUrl = ${JSON.stringify(base)};

describe("contrato REST", () => {
${cases}
});`;
}

function restCases(route: WebRoute): string[] {
  const json =
    (route.method === "GET" || route.method === "HEAD") && route.returnsJson
      ? `\n    expect(response.headers.get("content-type")).toMatch(/json/);`
      : "";
  const cases = [
    `  it(${JSON.stringify(`${route.method} ${route.path}`)}, async () => {
    const response = await fetch(baseUrl + ${JSON.stringify(route.path)}, { method: ${JSON.stringify(route.method)} });
    expect(response.status).toBe(${route.status});${json}
  });`,
  ];
  if (route.validationStatus) {
    cases.push(`  it(${JSON.stringify(`validação ${route.method} ${route.path}`)}, async () => {
    const response = await fetch(baseUrl + ${JSON.stringify(route.path)}, {
      method: ${JSON.stringify(route.method)},
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(${route.validationStatus});
  });`);
  }
  if (route.authStatus) {
    cases.push(`  it(${JSON.stringify(`autenticação ${route.method} ${route.path}`)}, async () => {
    const response = await fetch(baseUrl + ${JSON.stringify(route.path)}, {
      method: ${JSON.stringify(route.method)},
      headers: {},
    });
    expect(response.status).toBe(${route.authStatus});
  });`);
  }
  return cases;
}

function pythonRest(options: { specification: string; baseUrl: string }, routes: WebRoute[]): string {
  if (routes.length === 0) {
    return `import pytest

def test_rota_do_handler():
    """${options.specification.replace(/"""/g, "")}"""
    pytest.fail("Nenhuma rota extraída do handler. Passe o arquivo com o método, o path e o status.")
`;
  }
  const base = localBase(options.baseUrl);
  const cases = routes
    .map((route) => {
      const json =
        (route.method === "GET" || route.method === "HEAD") && route.returnsJson
          ? `\n    assert "json" in response.headers.get("content-type", "")`
          : "";
      const extra = [
        route.validationStatus
          ? `\ndef test_validacao_${slugRoute(route)}():
    response = httpx.request(${JSON.stringify(route.method)}, BASE + ${JSON.stringify(route.path)}, json={})
    assert response.status_code == ${route.validationStatus}
`
          : "",
        route.authStatus
          ? `\ndef test_autenticacao_${slugRoute(route)}():
    response = httpx.request(${JSON.stringify(route.method)}, BASE + ${JSON.stringify(route.path)})
    assert response.status_code == ${route.authStatus}
`
          : "",
      ].join("");
      return `def test_${slugRoute(route)}():
    response = httpx.request(${JSON.stringify(route.method)}, BASE + ${JSON.stringify(route.path)})
    assert response.status_code == ${route.status}${json}
${extra}`;
    })
    .join("\n");
  return `import httpx

BASE = ${JSON.stringify(base)}

${cases}`;
}

function slugRoute(route: WebRoute): string {
  const path = route.path.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `${route.method.toLowerCase()}_${path || "rota"}`;
}

function graphqlTest(options: { specification: string; baseUrl: string }): string {
  return `import { describe, it, expect } from "vitest";

describe("contrato GraphQL", () => {
  it("query feliz não traz errors", async () => {
    const response = await fetch("${options.baseUrl}", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "{ __typename }" }),
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.errors).toBeUndefined();
  });

  it("campo obrigatório ausente volta em errors, com HTTP 200", async () => {
    const response = await fetch("${options.baseUrl}", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "mutation { __typename }" }),
    });
    expect(response.status).toBe(200);
  });
});
// Especificação: ${options.specification}`;
}

function grpcTest(options: { specification: string; baseUrl: string }): string {
  return `import { describe, it, expect } from "vitest";

describe("contrato gRPC", () => {
  it("OK no caminho feliz", () => {
    expect.fail("Sem cliente gRPC em ${options.baseUrl} não dá para afirmar status OK.");
  });

  it("INVALID_ARGUMENT quando o request viola o proto", () => {
    expect.fail("Sem cliente gRPC não dá para afirmar status INVALID_ARGUMENT.");
  });

  it("UNAUTHENTICATED sem metadata de credencial", () => {
    expect.fail("Sem cliente gRPC não dá para afirmar status UNAUTHENTICATED.");
  });
});
// ${options.specification}`;
}

export function renderMobileTest(options: {
  flow: string;
  platform: "android" | "ios" | "both";
  steps: string[];
  language: "ts" | "python";
}): { language: string; fileName: string; code: string } {
  const caps =
    options.platform === "ios"
      ? `{ platformName: "iOS", "appium:automationName": "XCUITest", "appium:bundleId": "com.example.app" }`
      : `{ platformName: "Android", "appium:automationName": "UiAutomator2", "appium:appPackage": "com.example.app", "appium:appActivity": ".MainActivity" }`;

  const steps = options.steps.map((step, index) => `    // ${index + 1}. ${step}`).join("\n");

  if (options.language === "python") {
    return {
      language: "python",
      fileName: "test_mobile.py",
      code: `from appium import webdriver
from appium.options.android import UiAutomator2Options

def test_fluxo_mobile():
    """${options.flow}"""
    options = UiAutomator2Options()
    options.platform_name = "${options.platform === "ios" ? "iOS" : "Android"}"
    driver = webdriver.Remote("http://127.0.0.1:4723", options=options)
    try:
        assert driver.session_id
    finally:
        driver.quit()
`,
    };
  }

  return {
    language: "ts",
    fileName: "mobile.spec.ts",
    code: `import { remote } from "webdriverio";
import { describe, it, afterEach } from "vitest";

describe("fluxo mobile", () => {
  let driver: WebdriverIO.Browser;

  afterEach(async () => {
    await driver?.deleteSession();
  });

  it("${escapeQuote(options.flow)}", async () => {
    driver = await remote({
      hostname: "127.0.0.1",
      port: 4723,
      capabilities: ${caps},
    });
${steps}
    expect(await driver.sessionId).toBeTruthy();
  });
});`,
  };
}
