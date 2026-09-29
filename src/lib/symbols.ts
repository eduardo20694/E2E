export interface SymbolInfo {
  kind: "function" | "class" | "method";
  name: string;
  params: string[];
  async: boolean;
}

export interface ImportInfo {
  source: string;
  local: boolean;
}

function splitParams(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/=.*$/, "").replace(/:.+$/, "").replace(/^\*+/, "").trim())
    .filter((name) => name.length > 0 && name !== "self" && name !== "cls");
}

function pushSymbol(list: SymbolInfo[], symbol: SymbolInfo): void {
  if (!list.some((item) => item.kind === symbol.kind && item.name === symbol.name)) {
    list.push(symbol);
  }
}

/** Extrai símbolos testáveis sem um parser completo. Cobre TS/JS, Python, Java e Ruby. */
export function extractSymbols(source: string): SymbolInfo[] {
  const symbols: SymbolInfo[] = [];

  for (const match of source.matchAll(
    /export\s+(default\s+)?(async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g,
  )) {
    pushSymbol(symbols, {
      kind: "function",
      name: match[3],
      params: splitParams(match[4]),
      async: Boolean(match[2]),
    });
  }

  for (const match of source.matchAll(
    /export\s+(?:const|let|function)\s+(\w+)\s*=\s*(async\s+)?(?:function\s*)?\(([^)]*)\)\s*(?::\s*[\w<>,\s\[\]|]+)?\s*=>/g,
  )) {
    pushSymbol(symbols, {
      kind: "function",
      name: match[1],
      params: splitParams(match[3]),
      async: Boolean(match[2]),
    });
  }

  for (const match of source.matchAll(/^\s*(async\s+)?function\s+(\w+)\s*\(([^)]*)\)/gm)) {
    pushSymbol(symbols, {
      kind: "function",
      name: match[2],
      params: splitParams(match[3]),
      async: Boolean(match[1]),
    });
  }

  for (const match of source.matchAll(/^\s*(?:export\s+)?class\s+(\w+)/gm)) {
    pushSymbol(symbols, { kind: "class", name: match[1], params: [], async: false });
  }

  for (const match of source.matchAll(/^\s*(?:public|private|protected)?\s*(async\s+)?(\w+)\s*\(([^)]*)\)\s*\{/gm)) {
    const name = match[2];
    if (["if", "for", "while", "switch", "catch", "function", "constructor"].includes(name)) continue;
    if (symbols.some((item) => item.name === name)) continue;
    pushSymbol(symbols, {
      kind: "method",
      name,
      params: splitParams(match[3]),
      async: Boolean(match[1]),
    });
  }

  for (const match of source.matchAll(/^\s*(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/gm)) {
    if (match[1].startsWith("_") && match[1] !== "__init__") continue;
    pushSymbol(symbols, {
      kind: match[1] === "__init__" ? "method" : "function",
      name: match[1],
      params: splitParams(match[2]),
      async: /^\s*async\s+def/.test(match[0]),
    });
  }

  for (const match of source.matchAll(/^\s*def\s+(?:self\.)?(\w+)/gm)) {
    if (!symbols.some((item) => item.name === match[1])) {
      pushSymbol(symbols, { kind: "method", name: match[1], params: [], async: false });
    }
  }

  return symbols.slice(0, 12);
}

export function extractImports(source: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    imports.push({ source: match[1], local: match[1].startsWith(".") });
  }
  for (const match of source.matchAll(/^\s*import\s+([\w.]+)/gm)) {
    const sourceName = match[1];
    if (!imports.some((item) => item.source === sourceName)) {
      imports.push({ source: sourceName, local: sourceName.startsWith(".") });
    }
  }
  return imports.slice(0, 15);
}

export function moduleNameFromPath(filePath?: string): string {
  if (!filePath) return "module_under_test";
  const base = filePath.split(/[/\\]/).pop() ?? "module_under_test";
  return base.replace(/\.(test|spec)\./, ".").replace(/\.[^.]+$/, "") || "module_under_test";
}
