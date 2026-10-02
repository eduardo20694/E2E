import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { TOOL_NAMES } from "../src/tools/register.js";

describe("servidor MCP E2E", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it("expõe as tools, as resources e os prompts", async () => {
    const server = createServer();
    const client = new Client({ name: "e2e-dogfood", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    close = async () => {
      await client.close();
      await server.close();
    };

    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name).sort();
    expect(names).toEqual([...TOOL_NAMES].sort());

    expect(client.getInstructions()).toContain("map_tests_for_edit");

    const resources = await client.listResources();
    expect(resources.resources).toHaveLength(33);
    expect(resources.resources.map((resource) => resource.uri)).toContain(
      "e2e://knowledge/shift-right",
    );
    expect(resources.resources.map((resource) => resource.uri)).toContain("e2e://map");
    const mapResource = resources.resources.find((resource) => resource.uri === "e2e://map");
    expect(mapResource?.title).toBe("Mapa de tools por arquivo editado");

    const article = await client.readResource({ uri: "e2e://knowledge/bdd" });
    expect(article.contents[0]).toMatchObject({ mimeType: "text/markdown" });
    const text = "text" in article.contents[0] ? article.contents[0].text : "";
    expect(text).toContain("Gherkin");

    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((prompt) => prompt.name).sort()).toEqual([
      "e2e-audit-suite",
      "e2e-automation-roi-check",
      "e2e-legacy-code-safety-net",
      "e2e-ml-test-plan",
      "e2e-pipeline-audit",
      "e2e-plan-feature",
      "e2e-production-readiness",
      "e2e-review-test",
    ]);

    const review = await client.getPrompt({
      name: "e2e-review-test",
      arguments: { code: "it('works', () => { expect(true).toBe(true); });" },
    });
    expect(review.messages[0].content).toMatchObject({ type: "text" });

    const call = await client.callTool({
      name: "boundary_value_analysis",
      arguments: { rule: "nota entre 0 e 10", variable: "nota" },
    });
    expect(call.isError).toBeFalsy();
    const payload = Array.isArray(call.content) ? call.content : [];
    expect(payload[0]).toMatchObject({ type: "text" });
  });
});
