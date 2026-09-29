/** Junta seções de markdown omitindo blocos vazios. */
export function doc(parts: Array<string | undefined | false>): string {
  return parts.filter((part): part is string => Boolean(part)).join("\n\n");
}

export function codeBlock(language: string, code: string): string {
  return `\`\`\`${language}\n${code.trim()}\n\`\`\``;
}

export function bulletList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

export function markdownTable(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
  return [head, sep, body].filter(Boolean).join("\n");
}

/** Quebra um fluxo em linguagem natural em passos acionáveis. */
export function splitSteps(text: string): string[] {
  const lines = text
    .split(/\r?\n+/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)\]])\s*/, "").trim())
    .filter(Boolean);

  if (lines.length > 1) return lines;

  return text
    .split(/(?<=[.!;])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}
