import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, SERVER_INSTRUCTIONS } from "../src/server.js";
import { CORE_TOOL_NAMES, TOOL_NAMES } from "../src/tools/register.js";

describe("servidor MCP E2E", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it("no perfil core registra as 20 tools, nesta ordem", async () => {
    const previous = process.env.E2E_TOOLSET;
    delete process.env.E2E_TOOLSET;
    const server = createServer();
    const client = new Client({ name: "e2e-dogfood", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    close = async () => {
      await client.close();
      await server.close();
      if (previous === undefined) delete process.env.E2E_TOOLSET;
      else process.env.E2E_TOOLSET = previous;
    };

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([...CORE_TOOL_NAMES]);
    expect(CORE_TOOL_NAMES).toHaveLength(20);
    expect(CORE_TOOL_NAMES).toContain("setup_consumer_driven_contracts");
    expect(CORE_TOOL_NAMES as readonly string[]).not.toContain("generate_bug_report");
    expect(client.getInstructions()).toContain("E2E_TOOLSET=full");
    expect(client.getInstructions()).toContain("perfil ativo");
    expect(SERVER_INSTRUCTIONS).toContain("perfil core");

    const prompts = await client.listPrompts();
    expect(prompts.prompts).toHaveLength(3);
    expect(prompts.prompts.map((prompt) => prompt.name).sort()).toEqual([
      "e2e-audit-suite",
      "e2e-pipeline-audit",
      "e2e-review-test",
    ]);
    const hidden = [
      "e2e-production-readiness",
      "e2e-ml-test-plan",
      "e2e-automation-roi-check",
      "e2e-plan-feature",
      "e2e-legacy-code-safety-net",
    ];
    for (const name of hidden) {
      expect(prompts.prompts.map((prompt) => prompt.name)).not.toContain(name);
    }
    const pipeline = await client.getPrompt({
      name: "e2e-pipeline-audit",
      arguments: { projectRoot: "C:/app" },
    });
    const pipelineBody = pipeline.messages[0]?.content;
    const pipelineText = pipelineBody && "text" in pipelineBody ? pipelineBody.text : "";
    expect(pipelineText).toContain("suggest_test_impact_analysis");
    expect(pipelineText).not.toContain("suggest_test_parallelization");
    expect(pipelineText).not.toContain("suggest_flaky_test_quarantine");
    expect(pipelineText).toContain("Paralelismo e quarentena estão disponíveis com E2E_TOOLSET=full.");
  });

  it("valor desconhecido de E2E_TOOLSET cai no core", async () => {
    const previous = process.env.E2E_TOOLSET;
    process.env.E2E_TOOLSET = "banana";
    const server = createServer();
    const client = new Client({ name: "e2e-dogfood", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    close = async () => {
      await client.close();
      await server.close();
      if (previous === undefined) delete process.env.E2E_TOOLSET;
      else process.env.E2E_TOOLSET = previous;
    };
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([...CORE_TOOL_NAMES]);
  });

  it("expõe as tools, as resources e os prompts no perfil full", async () => {
    const previous = process.env.E2E_TOOLSET;
    process.env.E2E_TOOLSET = "full";
    const server = createServer();
    const client = new Client({ name: "e2e-dogfood", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    close = async () => {
      await client.close();
      await server.close();
      if (previous === undefined) delete process.env.E2E_TOOLSET;
      else process.env.E2E_TOOLSET = previous;
    };

    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name).sort();
    expect(names).toEqual([...TOOL_NAMES].sort());
    expect(TOOL_NAMES).toHaveLength(55);
    const removed = [
      "suggest_test_management_tool",
      "suggest_reporting_setup",
      "suggest_compliance_checklist",
      "shift_left_right_recommendations",
      "environment_strategy_advisor",
      "boundary_value_analysis",
      "equivalence_partitioning",
      "decision_table",
      "state_transition_test",
      "pairwise_test_generator",
    ];
    for (const name of removed) {
      expect(names).not.toContain(name);
      expect(TOOL_NAMES as readonly string[]).not.toContain(name);
    }

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
    expect(prompts.prompts).toHaveLength(8);
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

    const pipeline = await client.getPrompt({
      name: "e2e-pipeline-audit",
      arguments: { projectRoot: "C:/app" },
    });
    const pipelineBody = pipeline.messages[0]?.content;
    const pipelineText = pipelineBody && "text" in pipelineBody ? pipelineBody.text : "";
    expect(pipelineText).toContain("suggest_test_impact_analysis");
    expect(pipelineText).toContain("suggest_test_parallelization");
    expect(pipelineText).toContain("suggest_flaky_test_quarantine");

    const call = await client.callTool({
      name: "design_test_cases",
      arguments: { technique: "boundary", rule: "idade entre 18 e 65" },
    });
    expect(call.isError).toBeFalsy();
    const payload = Array.isArray(call.content) ? call.content : [];
    expect(payload[0]).toMatchObject({ type: "text" });
    const design = "text" in payload[0] ? payload[0].text : "";
    expect(design).toContain("17");
    expect(design).toContain("18");
    expect(design).toContain("65");
    expect(design).toContain("66");
  });
});
