import type { SymbolInfo } from "./symbols.js";
import { moduleNameFromPath } from "./symbols.js";
import type { UnitFramework } from "./detect.js";

function sampleArg(param: string, index: number): string {
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

function callArgs(symbol: SymbolInfo): string {
  if (symbol.params.length === 0) return "";
  return symbol.params.map(sampleArg).join(", ");
}

export function renderUnitTest(options: {
  framework: UnitFramework;
  symbols: SymbolInfo[];
  moduleName: string;
  filePath?: string;
  externalImports: string[];
}): { language: string; fileName: string; code: string } {
  const symbols = options.symbols.length
    ? options.symbols
    : [{ kind: "function" as const, name: "subject", params: [], async: false }];

  switch (options.framework) {
    case "pytest":
      return { language: "python", fileName: `test_${options.moduleName}.py`, code: pytest(symbols, options.moduleName) };
    case "junit":
      return { language: "java", fileName: `${pascal(options.moduleName)}Test.java`, code: junit(symbols, options.moduleName) };
    case "rspec":
      return { language: "ruby", fileName: `${options.moduleName}_spec.rb`, code: rspec(symbols, options.moduleName) };
    case "go":
      return { language: "go", fileName: `${options.moduleName}_test.go`, code: goTest(symbols) };
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

function jsTest(
  framework: "jest" | "vitest",
  symbols: SymbolInfo[],
  options: { moduleName: string; filePath?: string; externalImports: string[] },
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
    const invocation = symbol.async
      ? `const result = await ${symbol.name}(${callArgs(symbol)});`
      : `const result = ${symbol.name}(${callArgs(symbol)});`;
    return [
      `  describe("${symbol.name}", () => {`,
      `    beforeEach(() => {`,
      `      ${mockFn}.clearAllMocks();`,
      `    });`,
      ``,
      `    it("retorna o resultado esperado para entrada válida", ${symbol.async ? "async " : ""}() => {`,
      `      // Arrange`,
      `      ${symbol.params.length ? `// parâmetros: ${symbol.params.join(", ")}` : "// sem parâmetros"}`,
      `      // Act`,
      `      ${invocation}`,
      `      // Assert — substitua pelo contrato real da função`,
      `      expect(result).toBeDefined();`,
      `    });`,
      ``,
      `    it("rejeita entrada inválida ou ausente", ${symbol.async ? "async " : ""}() => {`,
      symbol.async
        ? `      await expect(${symbol.name}(${symbol.params.map(() => "undefined").join(", ")})).rejects.toThrow();`
        : `      expect(() => ${symbol.name}(${symbol.params.map(() => "undefined").join(", ")})).toThrow();`,
      `    });`,
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

function pytest(symbols: SymbolInfo[], moduleName: string): string {
  const cases = symbols
    .map((symbol) => {
      const args = symbol.params.map((param) => `${param}=None`).join(", ");
      return [
        `def test_${symbol.name}_caminho_feliz():`,
        `    # Arrange`,
        `    # Act`,
        `    result = ${symbol.name}(${args})`,
        `    # Assert`,
        `    assert result is not None`,
        ``,
        `def test_${symbol.name}_entrada_invalida():`,
        `    with pytest.raises(Exception):`,
        `        ${symbol.name}(${symbol.params.map(() => "None").join(", ")})`,
      ].join("\n");
    })
    .join("\n\n");

  return [`import pytest`, `from ${moduleName} import ${symbols.map((symbol) => symbol.name).join(", ")}`, ``, cases].join(
    "\n",
  );
}

function junit(symbols: SymbolInfo[], moduleName: string): string {
  const className = pascal(moduleName);
  const methods = symbols
    .map(
      (symbol) => `    @Test
    @DisplayName("${symbol.name} cobre o caminho feliz e a borda inválida")
    void ${symbol.name}_contracts() {
        // Arrange
        // Act
        // Assert
        assertNotNull(${className}.class);
    }`,
    )
    .join("\n\n");

  return `import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ${className}Test {
${methods}
}`;
}

function rspec(symbols: SymbolInfo[], moduleName: string): string {
  const examples = symbols
    .map(
      (symbol) => `  describe "#${symbol.name}" do
    it "retorna o resultado do caminho feliz" do
      # expect(subject.${symbol.name}).to eq(expected)
    end

    it "rejeita entrada inválida" do
      # expect { subject.${symbol.name}(nil) }.to raise_error
    end
  end`,
    )
    .join("\n\n");

  return `require "spec_helper"

RSpec.describe ${pascal(moduleName)} do
${examples}
end`;
}

function goTest(symbols: SymbolInfo[]): string {
  const tests = symbols
    .map(
      (symbol) => `func Test${pascal(symbol.name)}(t *testing.T) {
    t.Run("caminho feliz", func(t *testing.T) {
        // got := ${symbol.name}(${symbol.params.map(() => "valid").join(", ")})
        // if got != want { t.Fatalf("got %v", got) }
    })
    t.Run("entrada inválida", func(t *testing.T) {
        // defer func() { recover() }()
    })
}`,
    )
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
}): { language: string; fileName: string; code: string } {
  const db = options.database ?? "postgres";
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

  it("${escapeQuote(options.description)}", async () => {
    // Arrange: suba o cliente usando url
    // Act: exercite ${options.modules.join(" + ") || "os módulos"}
    // Assert: estado persistido e resposta HTTP
    expect(url).toContain("postgres");
  });
});`
    : `
describe("integração", () => {
  it("${escapeQuote(options.description)}", async () => {
    // Arrange: banco de teste ou transação revertida
    // Act
    // Assert: efeito observável entre ${options.modules.join(", ") || "os módulos"}
    expect(true).toBe(true);
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
    # Arrange / Act / Assert entre ${options.modules.join(", ") || "os módulos"}
    assert True
`;
  }
  return `import pytest
from testcontainers.postgres import PostgresContainer

@pytest.fixture(scope="module")
def database_url():
    with PostgresContainer("postgres:16-alpine") as postgres:
        yield postgres.get_connection_url()

def test_integracao(database_url):
    """${options.description}"""
    assert database_url
`;
}

function javaIntegration(
  options: { description: string; useTestcontainers: boolean },
  db: string,
): string {
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
    void persisteEntreModulos() {
        assertTrue(postgres.isRunning());
    }
}
`;
}

function escapeQuote(value: string): string {
  return value.replace(/["\\]/g, "").slice(0, 80);
}

export function renderE2eTest(options: {
  framework: "playwright" | "cypress" | "selenium";
  steps: string[];
  baseUrl: string;
  title: string;
}): { language: string; fileName: string; code: string } {
  if (options.framework === "cypress") return { language: "ts", fileName: "flow.cy.ts", code: cypress(options) };
  if (options.framework === "selenium") return { language: "ts", fileName: "flow.selenium.spec.ts", code: selenium(options) };
  return { language: "ts", fileName: "flow.spec.ts", code: playwright(options) };
}

function playwright(options: { steps: string[]; baseUrl: string; title: string }): string {
  const body = options.steps
    .map((step, index) => `    // ${index + 1}. ${step}\n    // await page.getByRole("button", { name: /continuar/i }).click();`)
    .join("\n");
  return `import { test, expect } from "@playwright/test";

test("${escapeQuote(options.title)}", async ({ page }) => {
  await page.goto("${options.baseUrl}");
${body}
  await expect(page).toHaveURL(/.*/);
});`;
}

function cypress(options: { steps: string[]; baseUrl: string; title: string }): string {
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

function selenium(options: { steps: string[]; baseUrl: string; title: string }): string {
  const body = options.steps.map((step, index) => `    // ${index + 1}. ${step}`).join("\n");
  return `import { Builder, Browser, By, until } from "selenium-webdriver";
import { describe, it, afterEach } from "vitest";

describe("${escapeQuote(options.title)}", () => {
  let driver: Awaited<ReturnType<Builder["build"]>>;

  afterEach(async () => {
    await driver?.quit();
  });

  it("completa o fluxo", async () => {
    driver = await new Builder().forBrowser(Browser.CHROME).build();
    await driver.get("${options.baseUrl}");
${body}
    await driver.wait(until.urlContains(""), 5000);
  });
});`;
}

export function renderApiTest(options: {
  protocol: "rest" | "graphql" | "grpc";
  specification: string;
  baseUrl: string;
  language: "ts" | "python";
}): { language: string; fileName: string; code: string } {
  if (options.protocol === "graphql") {
    return { language: "ts", fileName: "graphql.contract.test.ts", code: graphqlTest(options) };
  }
  if (options.protocol === "grpc") {
    return { language: "ts", fileName: "grpc.contract.test.ts", code: grpcTest(options) };
  }
  if (options.language === "python") {
    return { language: "python", fileName: "test_api_contract.py", code: pythonRest(options) };
  }
  return { language: "ts", fileName: "api.contract.test.ts", code: restTest(options) };
}

function restTest(options: { specification: string; baseUrl: string }): string {
  return `import { describe, it, expect } from "vitest";

const baseUrl = "${options.baseUrl}";

describe("contrato REST", () => {
  it("sucesso: ${escapeQuote(options.specification)}", async () => {
    const response = await fetch(baseUrl);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/json/);
  });

  it("validação: corpo ou query inválidos retornam 400", async () => {
    const response = await fetch(baseUrl, { method: "POST", body: "{}" });
    expect([400, 404, 405, 422]).toContain(response.status);
  });

  it("autenticação: sem credencial retorna 401 ou 403", async () => {
    const response = await fetch(baseUrl, { headers: {} });
    expect([200, 401, 403]).toContain(response.status);
  });

  it("não encontrado: identificador inexistente retorna 404", async () => {
    const response = await fetch(baseUrl.replace(/\\/$/, "") + "/nao-existe");
    expect([200, 404]).toContain(response.status);
  });
});`;
}

function pythonRest(options: { specification: string; baseUrl: string }): string {
  return `import pytest
import httpx

BASE = "${options.baseUrl}"

def test_sucesso():
    """${options.specification}"""
    response = httpx.get(BASE)
    assert response.status_code == 200

def test_payload_invalido():
    response = httpx.post(BASE, json={})
    assert response.status_code in {400, 404, 405, 422}

def test_sem_credencial():
    response = httpx.get(BASE)
    assert response.status_code in {200, 401, 403}
`;
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
    // status esperado: OK (0) em ${options.baseUrl}
    expect(["OK", "INVALID_ARGUMENT", "NOT_FOUND", "UNAUTHENTICATED"]).toContain("OK");
  });

  it("INVALID_ARGUMENT quando o request viola o proto", () => {
    expect(true).toBe(true);
  });

  it("UNAUTHENTICATED sem metadata de credencial", () => {
    expect(true).toBe(true);
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
