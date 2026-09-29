import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface KnowledgeArticle {
  slug: string;
  title: string;
  uri: string;
  body: string;
}

const URI_PREFIX = "e2e://knowledge/";

/** Localiza a pasta de markdown tanto via tsx (src) quanto via node (dist). */
export function knowledgeDirectory(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../resources/knowledge-base"),
    path.resolve(here, "../../src/resources/knowledge-base"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    "Base de conhecimento não encontrada. Esperada em src/resources/knowledge-base.",
  );
}

export function knowledgeUri(slug: string): string {
  return `${URI_PREFIX}${slug}`;
}

export function listKnowledge(): KnowledgeArticle[] {
  const directory = knowledgeDirectory();
  return fs
    .readdirSync(directory)
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file) => readKnowledge(file.replace(/\.md$/, "")));
}

export function readKnowledge(slug: string): KnowledgeArticle {
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`Slug de resource inválido: ${slug}`);
  }

  const filePath = path.join(knowledgeDirectory(), `${slug}.md`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Resource não encontrada: ${knowledgeUri(slug)}`);
  }

  const body = fs.readFileSync(filePath, "utf8");
  const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? slug;
  return { slug, title, uri: knowledgeUri(slug), body };
}

/** Trecho curto para a tool citar a resource que acabou de consultar. */
export function knowledgeExcerpt(slug: string, maxChars = 500): string {
  const article = readKnowledge(slug);
  const lines = article.body.split(/\r?\n/);
  const withoutTitle = (lines[0]?.startsWith("# ") ? lines.slice(1) : lines).join(" ");
  const collapsed = withoutTitle.replace(/\s+/g, " ").trim();
  const excerpt =
    collapsed.length > maxChars ? `${collapsed.slice(0, maxChars).trim()}…` : collapsed;
  return `Consultado \`${article.uri}\` (${article.title}): ${excerpt}`;
}

export function citeKnowledge(slugs: string[]): string {
  const lines = slugs.map((slug) => {
    try {
      return `- ${knowledgeExcerpt(slug)}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `- Não foi possível ler \`${knowledgeUri(slug)}\`: ${message}`;
    }
  });
  return ["## Base de conhecimento", ...lines].join("\n");
}
