import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectStack, inferLanguage, stackSummary } from "../lib/detect.js";
import { codeBlock, doc, markdownTable } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";
import { writeShape, type ProjectContextInput } from "../lib/schema.js";
import { deliver, resolveToolRoot, slug, type LoopFlags } from "./loop.js";

const NAMES = ["Ana", "Bruno", "Carla", "Diego", "Elena", "Fabio"];
const SURNAMES = ["Silva", "Souza", "Costa", "Lima", "Rocha", "Nunes"];

export interface SyntheticField {
  name: string;
  type?: string;
}

export interface SyntheticDataInput extends ProjectContextInput {
  entity: string;
  fields?: SyntheticField[];
  count?: number;
  seed?: number;
}

/** Gerador local com semente, para o dado ser reproduzível sem baixar o Faker. */
export function synthesizeRows(fields: SyntheticField[], count: number, seed: number): Array<Record<string, string>> {
  const rand = seeded(seed);
  return Array.from({ length: count }, (_, index) => {
    const row: Record<string, string> = {};
    for (const field of fields) {
      row[field.name] = fakeValue(field, index, rand);
    }
    return row;
  });
}

function seeded(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function fakeValue(field: SyntheticField, index: number, rand: () => number): string {
  const kind = (field.type ?? field.name).toLowerCase();
  const first = NAMES[Math.floor(rand() * NAMES.length)];
  const last = SURNAMES[Math.floor(rand() * SURNAMES.length)];
  if (/email/.test(kind)) return `${first}.${last}.${index}@example.com`.toLowerCase();
  if (/name|nome/.test(kind)) return `${first} ${last}`;
  if (/phone|telefone|celular/.test(kind)) return `+55 11 90000-00${String(index).padStart(2, "0")}`;
  if (/date|data/.test(kind)) return `2026-0${(index % 9) + 1}-15`;
  if (/bool/.test(kind)) return index % 2 === 0 ? "true" : "false";
  if (/uuid|id/.test(kind)) return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  if (/cpf|ssn|cartao|card|senha|password/.test(kind)) return "REDACTED-FAKE";
  if (/number|idade|age|preco|price|qty/.test(kind)) return String(1 + Math.floor(rand() * 40));
  return `${field.name}-${index}`;
}

export function generateSyntheticData(input: SyntheticDataInput): ToolTextResult {
  if (!input.entity?.trim()) {
    return errorResult("generate_synthetic_data exige entity com o nome da entidade.");
  }

  const stack = detectStack(input.projectRoot);
  const count = Math.min(Math.max(input.count ?? 3, 1), 20);
  const fields = input.fields?.length
    ? input.fields
    : [
        { name: "id", type: "uuid" },
        { name: "name", type: "name" },
        { name: "email", type: "email" },
      ];
  const rows = synthesizeRows(fields, count, input.seed ?? 1);
  const lib = stack.libraries.includes("faker") ? "faker já está no projeto" : "Faker ou Mockaroo";

  return textResult(
    doc([
      `# Dados sintéticos — ${input.entity}`,
      "Isto é dado **falso**, gerado com semente. Não é cópia de produção e não serve como cliente real.",
      `${lib}. A amostra abaixo já sai pronta; o script repete o mesmo formato na suíte.`,
      "## Stack detectada",
      stackSummary(stack),
      markdownTable(
        fields.map((field) => field.name),
        rows.map((row) => fields.map((field) => row[field.name] ?? "")),
      ),
      codeBlock(
        "ts",
        `import { faker } from "@faker-js/faker";
faker.seed(${input.seed ?? 1});
export function build${pascal(input.entity)}() {
  return { ${fields.map((field) => `${field.name}: faker.lorem.word()`).join(", ")} };
}`,
      ),
      citeKnowledge(["test-data-management"]),
    ]),
  );
}

function pascal(value: string): string {
  const name = value.replace(/[^a-zA-Z0-9]+/g, " ").trim();
  return name
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("") || "Entity";
}

const SENSITIVE = /email|cpf|ssn|phone|telefone|cartao|card|senha|password|endereco|address|nome|name|nascimento|birth/i;

export interface MaskingInput extends ProjectContextInput {
  fields?: string[];
  sample?: string;
  regulation?: "LGPD" | "GDPR" | "ambas";
}

export function suggestDataMaskingStrategy(input: MaskingInput): ToolTextResult {
  const blob = `${(input.fields ?? []).join(" ")} ${input.sample ?? ""} ${input.sourceCode ?? ""}`;
  if (!blob.trim()) {
    return errorResult("suggest_data_masking_strategy exige fields, sample ou sourceCode.");
  }

  const names = input.fields?.length
    ? input.fields
    : [...blob.matchAll(/\b[a-zA-Z_][\w.]{2,}\b/g)].map((match) => match[0]).slice(0, 12);
  const unique = [...new Set(names)];
  const rows = unique.map((name) => {
    const sensitive = SENSITIVE.test(name);
    return [
      name,
      sensitive ? "mascarar" : "pode ir para teste",
      sensitive ? "substituir por sintético ou token irreversível" : "copiar",
    ];
  });

  return textResult(
    doc([
      `# Mascaramento — ${input.regulation ?? "LGPD e GDPR"}`,
      "Dado de produção não entra em teste com identificador de pessoa. O caminho seguro é sintético ou token que não volta para a pessoa.",
      markdownTable(["Campo", "Decisão", "Técnica"], rows),
      "- E-mail, telefone e documento: valor falso com formato, nunca o original truncado.",
      "- Livre texto (ticket, prontuário): não mascarar no olho. Não copiar, ou classificar com um processo à parte.",
      "- A chave que junta tabelas vira um token estável por ambiente de teste, para a relação sobreviver sem o id real.",
      citeKnowledge(["test-data-management", "compliance-testing"]),
    ]),
  );
}

export interface SeedingInput extends ProjectContextInput {
  entities?: string[];
}

export function suggestSeedingStrategy(input: SeedingInput): ToolTextResult {
  const stack = detectStack(input.projectRoot);
  const language = inferLanguage(input.sourceCode, input.filePath);
  const factory = language === "python" ? "factory_boy" : language === "ruby" ? "factory_bot" : "fishery ou factory.ts";
  const entities = input.entities?.filter(Boolean) ?? ["usuário", "pedido"];

  return textResult(
    doc([
      "# Seed reproduzível",
      "## Stack detectada",
      stackSummary(stack),
      `Ferramenta de factory para esta stack: **${factory}**.`,
      "- Fixture fixa só para o caso que precisa de um grafo grande e estável.",
      "- Factory para o resto: cada teste pede o mínimo e não herda linha do teste anterior.",
      "- Semente do Faker fixa no CI. Sem semente, o teste quebra quando o dado aleatório muda.",
      `- Ordem de criação: ${entities.join(" → ")}.`,
      "Ambiente real isolado (Testcontainers) aplica a migração e o seed no start. Produção não recebe esse seed.",
      citeKnowledge(["test-data-management", "integration-testing"]),
    ]),
  );
}

export interface VirtualizationInput extends ProjectContextInput {
  dependency: string;
}

export function setupServiceVirtualization(input: VirtualizationInput): ToolTextResult {
  if (!input.dependency?.trim()) {
    return errorResult("setup_service_virtualization exige dependency com o serviço externo.");
  }

  const stack = detectStack(input.projectRoot);
  const tool = stack.libraries.includes("wiremock") ? "wiremock" : "wiremock";

  return textResult(
    doc([
      `# Virtualização — ${input.dependency}`,
      `**${tool}** (Hoverfly é a alternativa se o contrato for mais de proxy do que de stub).`,
      "## Stack detectada",
      stackSummary(stack),
      "Virtualize terceiro caro, instável ou com efeito real (pagamento, antifraude, e-mail). Não virtualize o banco nem a fila deste sistema: isso é integração com Testcontainers.",
      codeBlock(
        "json",
        `{
  "request": { "method": "POST", "urlPath": "/${input.dependency}" },
  "response": { "status": 200, "jsonBody": { "id": "fake-1", "status": "accepted" } }
}`,
      ),
      "Grave também o caso de erro (timeout e 503). O teste de resiliência precisa do stub lento, não só do feliz.",
      citeKnowledge(["test-data-management", "integration-testing"]),
    ]),
  );
}

function syntheticFields(input: SyntheticDataInput): SyntheticField[] {
  return input.fields?.length
    ? input.fields
    : [
        { name: "id", type: "uuid" },
        { name: "name", type: "name" },
        { name: "email", type: "email" },
      ];
}

async function rooted<T extends LoopFlags>(server: McpServer, input: T): Promise<T> {
  const root = await resolveToolRoot(server, input.projectRoot, input.filePath);
  return { ...input, projectRoot: root ?? input.projectRoot };
}

export function registerTestDataTools(server: McpServer): void {
  registerTool(
    server,
    "generate_synthetic_data",
    "Gerar dado sintético",
    "Fábrica grava e não executa `tests/fixtures/*.json` com linhas falsas e reproduzíveis, sem copiar produção.",
    {
      entity: z.string(),
      fields: z.array(z.object({ name: z.string(), type: z.string().optional() })).optional(),
      count: z.number().int().min(1).max(20).optional(),
      seed: z.number().int().optional(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
      ...writeShape,
    },
    async (args) => {
      const ready = await rooted(server, args as unknown as SyntheticDataInput & LoopFlags);
      const result = generateSyntheticData(ready);
      if (result.isError) return result;
      const count = Math.min(Math.max(ready.count ?? 3, 1), 20);
      const rows = synthesizeRows(syntheticFields(ready), count, ready.seed ?? 1);
      return deliver({
        server,
        input: ready,
        preface: result,
        relativePath: `tests/fixtures/${slug(ready.entity)}.json`,
        contents: JSON.stringify(rows, null, 2),
        neverRun: true,
      });
    },
    { readOnly: false },
  );

  registerTool(
    server,
    "suggest_data_masking_strategy",
    "Estratégia de mascaramento",
    "Máscara grava e não executa `docs/qa/mascaramento.md` classificando campos antes de qualquer uso de dado real.",
    {
      fields: z.array(z.string()).optional(),
      sample: z.string().optional(),
      regulation: z.enum(["LGPD", "GDPR", "ambas"]).optional(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
      ...writeShape,
    },
    async (args) => {
      const ready = await rooted(server, args as unknown as MaskingInput & LoopFlags);
      const result = suggestDataMaskingStrategy(ready);
      if (result.isError) return result;
      return deliver({
        server,
        input: ready,
        preface: result,
        relativePath: "docs/qa/mascaramento.md",
        contents: result.content[0]?.text ?? "",
      });
    },
    { readOnly: false },
  );

  registerTool(
    server,
    "suggest_seeding_strategy",
    "Estratégia de seed",
    "Seed grava e não executa o teste de seed (`tests/seed/*.test.ts` ou `test_*.py`) com factories reproduzíveis.",
    {
      entities: z.array(z.string()).optional(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
      ...writeShape,
    },
    async (args) => {
      const ready = await rooted(server, args as unknown as SeedingInput & LoopFlags);
      const result = suggestSeedingStrategy(ready);
      if (result.isError) return result;
      const entities = ready.entities?.filter(Boolean) ?? ["usuário", "pedido"];
      const language = inferLanguage(ready.sourceCode, ready.filePath);
      const python = language === "python";
      const contents = python
        ? `def test_seed_ordem():\n    ordem = ${JSON.stringify(entities)}\n    assert ordem\n`
        : `import { describe, it, expect } from "vitest";\n\nconst ordem = ${JSON.stringify(entities)};\n\ndescribe("seed", () => {\n  it("cria as entidades na ordem combinada", () => {\n    expect(ordem.length).toBeGreaterThan(0);\n  });\n});\n`;
      return deliver({
        server,
        input: ready,
        preface: result,
        relativePath: python ? "tests/seed/test_seed.py" : "tests/seed/seed.test.ts",
        contents,
        neverRun: true,
      });
    },
    { readOnly: false },
  );

  registerTool(
    server,
    "setup_service_virtualization",
    "Virtualizar serviço",
    "Dublê grava e não executa `wiremock/mappings/*.json` para serviço externo, separado do banco do próprio sistema.",
    {
      dependency: z.string().describe("Nome do serviço externo."),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
      ...writeShape,
    },
    async (args) => {
      const ready = await rooted(server, args as unknown as VirtualizationInput & LoopFlags);
      const result = setupServiceVirtualization(ready);
      if (result.isError) return result;
      const mapping = {
        request: { method: "POST", urlPath: `/${ready.dependency}` },
        response: { status: 200, jsonBody: { id: "fake-1", status: "accepted" } },
      };
      return deliver({
        server,
        input: ready,
        preface: result,
        relativePath: `wiremock/mappings/${slug(ready.dependency)}.json`,
        contents: JSON.stringify(mapping, null, 2),
        neverRun: true,
      });
    },
    { readOnly: false },
  );
}
