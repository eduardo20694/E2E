/**
 * Avaliador de retorno puro. Não usa eval, Function nem vm:
 * só um parser da gramática fechada (literal, parâmetro, aritmética,
 * comparação, lógica, ternário, array e objeto simples).
 */

export interface SampleBinding {
  name: string;
  value: unknown;
}

export interface FunctionContract {
  /** O return cabe na gramática fechada. */
  pure: boolean;
  expression?: string;
  value?: unknown;
  /** O valor foi calculado com os argumentos de exemplo. */
  evaluated: boolean;
  rejectsMissing: boolean;
  deep: boolean;
  lang: "js" | "py";
}

type Lang = "js" | "py";

type Ast =
  | { k: "lit"; v: unknown }
  | { k: "id"; name: string }
  | { k: "un"; op: "!" | "not" | "+" | "-"; a: Ast }
  | { k: "bin"; op: string; l: Ast; r: Ast }
  | { k: "tern"; c: Ast; a: Ast; b: Ast }
  | { k: "arr"; items: Ast[] }
  | { k: "obj"; fields: Array<{ key: string; value: Ast }> };

class Opaque extends Error {}

export function analyzeFunction(source: string, name: string, bindings: SampleBinding[]): FunctionContract {
  const empty: FunctionContract = {
    pure: false,
    evaluated: false,
    rejectsMissing: false,
    deep: false,
    lang: "js",
  };
  const extracted = extractExpression(source, name, bindings.map((item) => item.name));
  if (!extracted) return empty;
  const names = new Set(bindings.map((item) => item.name));
  let ast: Ast;
  try {
    ast = parseExpression(extracted.expression ?? "", extracted.lang, names);
  } catch {
    return { ...empty, lang: extracted.lang, rejectsMissing: extracted.rejectsMissing };
  }
  if (!extracted.expression) {
    return { ...empty, lang: extracted.lang, rejectsMissing: extracted.rejectsMissing };
  }
  const env = new Map(bindings.map((item) => [item.name, item.value]));
  try {
    const value = evalAst(ast, env, extracted.lang);
    if (typeof value === "number" && !Number.isFinite(value)) {
      return {
        pure: true,
        expression: extracted.expression,
        evaluated: false,
        rejectsMissing: extracted.rejectsMissing,
        deep: false,
        lang: extracted.lang,
      };
    }
    return {
      pure: true,
      expression: extracted.expression,
      value,
      evaluated: true,
      rejectsMissing: extracted.rejectsMissing,
      deep: isDeep(value),
      lang: extracted.lang,
    };
  } catch {
    return {
      pure: true,
      expression: extracted.expression,
      evaluated: false,
      rejectsMissing: extracted.rejectsMissing,
      deep: false,
      lang: extracted.lang,
    };
  }
}

/**
 * Parâmetros genéricos somados com `+` viram 1, 2, 3… na ordem da assinatura.
 * Nome semântico (name, title, email) não entra: a soma continua concatenação.
 * `return a` sozinho não é soma e não muda o exemplo.
 */
export function numericParamValues(source: string, name: string, params: string[]): Map<string, number> {
  const extracted = extractExpression(source, name, params);
  if (!extracted?.expression) return new Map();
  let ast: Ast;
  try {
    ast = parseExpression(extracted.expression, extracted.lang, new Set(params));
  } catch {
    return new Map();
  }
  const used = new Set<string>();
  walkAdditive(ast, (node) => collectGenericIds(node, used));
  const values = new Map<string, number>();
  let next = 1;
  for (const param of params) {
    if (!used.has(param)) continue;
    values.set(param, next);
    next += 1;
  }
  return values;
}

function parameterClass(param: string): "string" | "number" | "bool" | "list" | "date" | "generic" {
  const name = param.toLowerCase();
  if (/id|uuid/.test(name)) return "string";
  if (/email/.test(name)) return "string";
  if (/name|title|label/.test(name)) return "string";
  if (/count|qty|quantity|age|total|amount|price|limit|min|max|n\b/.test(name)) return "number";
  if (/enabled|active|flag|is[A-Z_]/.test(name)) return "bool";
  if (/list|items|array/.test(name)) return "list";
  if (/date|time/.test(name)) return "date";
  return "generic";
}

function numericTree(node: Ast): boolean {
  if (node.k === "lit") return typeof node.v === "number";
  if (node.k === "id") {
    const kind = parameterClass(node.name);
    return kind === "generic" || kind === "number";
  }
  if (node.k === "un") return (node.op === "+" || node.op === "-") && numericTree(node.a);
  if (node.k === "bin" && ["+", "-", "*", "/", "%"].includes(node.op)) {
    return numericTree(node.l) && numericTree(node.r);
  }
  return false;
}

function walkAdditive(node: Ast, visit: (node: Ast) => void): void {
  if (node.k === "bin") {
    if (node.op === "+" && numericTree(node.l) && numericTree(node.r)) {
      visit(node);
      return;
    }
    walkAdditive(node.l, visit);
    walkAdditive(node.r, visit);
    return;
  }
  if (node.k === "un") walkAdditive(node.a, visit);
  if (node.k === "tern") {
    walkAdditive(node.c, visit);
    walkAdditive(node.a, visit);
    walkAdditive(node.b, visit);
  }
  if (node.k === "arr") node.items.forEach((item) => walkAdditive(item, visit));
  if (node.k === "obj") node.fields.forEach((field) => walkAdditive(field.value, visit));
}

function collectGenericIds(node: Ast, into: Set<string>): void {
  if (node.k === "id") {
    if (parameterClass(node.name) === "generic") into.add(node.name);
    return;
  }
  if (node.k === "un") collectGenericIds(node.a, into);
  if (node.k === "bin") {
    collectGenericIds(node.l, into);
    collectGenericIds(node.r, into);
  }
  if (node.k === "tern") {
    collectGenericIds(node.c, into);
    collectGenericIds(node.a, into);
    collectGenericIds(node.b, into);
  }
}

/** Expressão pura de exatamente dois parâmetros, reescrita com `a` e `b`. */
export function propertyFormula(source: string, name: string, params: string[]): string | undefined {
  if (params.length !== 2) return undefined;
  const extracted = extractExpression(source, name, params);
  if (!extracted?.expression) return undefined;
  try {
    const ast = parseExpression(extracted.expression, extracted.lang, new Set(params));
    const rename = new Map(params.map((param, index) => [param, index === 0 ? "a" : "b"]));
    return printAst(ast, extracted.lang, rename);
  } catch {
    return undefined;
  }
}

export function parseSampleCode(code: string): unknown {
  if (code === "true") return true;
  if (code === "false") return false;
  if (code === "[]") return [];
  if (code === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(code)) return Number(code);
  if (code.startsWith('"') && code.endsWith('"')) return JSON.parse(code);
  const date = code.match(/^new Date\('([^']+)'\)$/);
  if (date) return new Date(date[1]);
  return code;
}

export type ValueLang = "js" | "py" | "java" | "ruby" | "go";

export function formatValue(value: unknown, lang: ValueLang): string {
  if (value === null || value === undefined) {
    if (lang === "py") return "None";
    if (lang === "ruby" || lang === "go") return "nil";
    if (lang === "js" && value === undefined) return "undefined";
    return "null";
  }
  if (typeof value === "boolean") {
    if (lang === "py") return value ? "True" : "False";
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Opaque("número não finito");
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (value instanceof Date) {
    const iso = value.toISOString();
    if (lang === "js") return `new Date(${JSON.stringify(iso)})`;
    return JSON.stringify(iso);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => formatValue(item, lang)).join(", ")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const body = entries.map(([key, item]) => `${JSON.stringify(key)}: ${formatValue(item, lang)}`).join(", ");
    if (lang === "py") return `{${body}}`;
    return `{ ${body} }`;
  }
  throw new Opaque("valor fora da gramática");
}

function isDeep(value: unknown): boolean {
  return value instanceof Date || Array.isArray(value) || (typeof value === "object" && value !== null);
}

interface Extracted {
  lang: Lang;
  expression?: string;
  rejectsMissing: boolean;
}

function extractExpression(source: string, name: string, params: string[]): Extracted | undefined {
  const js = findJs(source, name);
  if (js) {
    const classified = js.kind === "expr"
      ? { expression: js.body.trim().replace(/;$/, ""), rejectsMissing: false }
      : classifyBlock(js.body, "js", params);
    if (classified.expression && !safeToParse(classified.expression)) {
      return { lang: "js", rejectsMissing: classified.rejectsMissing };
    }
    return { lang: "js", ...classified };
  }
  const py = findPy(source, name);
  if (!py) return undefined;
  const classified = classifyBlock(py, "py", params);
  if (classified.expression && !safeToParse(classified.expression)) {
    return { lang: "py", rejectsMissing: classified.rejectsMissing };
  }
  return { lang: "py", ...classified };
}

function safeToParse(expression: string): boolean {
  if (/\bawait\b|\bthis\b|\bthrow\b|\braise\b|\bnew\b|\byield\b|\bimport\b/.test(expression)) return false;
  if (/=>|\?\?|\?\./.test(expression)) return false;
  if (/\.\s*[A-Za-z_$]/.test(expression)) return false;
  return true;
}

function findJs(source: string, name: string): { body: string; kind: "block" | "expr" } | undefined {
  const decl = new RegExp(`\\bfunction\\s+${escapeReg(name)}\\b`);
  const declared = decl.exec(source);
  if (declared) {
    let i = skipWs(source, declared.index + declared[0].length);
    if (source[i] === "<") {
      const end = skipBalanced(source, i, "<", ">");
      if (end < 0) return undefined;
      i = skipWs(source, end + 1);
    }
    if (source[i] !== "(") return undefined;
    const paramsEnd = skipBalanced(source, i, "(", ")");
    if (paramsEnd < 0) return undefined;
    const brace = indexOfCode(source, "{", paramsEnd + 1);
    if (brace < 0) return undefined;
    const end = skipBalanced(source, brace, "{", "}");
    if (end < 0) return undefined;
    return { body: source.slice(brace + 1, end), kind: "block" };
  }

  const assign = new RegExp(`\\b${escapeReg(name)}\\s*=\\s*`);
  const assigned = assign.exec(source);
  if (!assigned) return undefined;
  let i = skipWs(source, assigned.index + assigned[0].length);
  if (source.startsWith("async", i) && /\s|\(/.test(source[i + 5] ?? "")) i = skipWs(source, i + 5);
  if (source.startsWith("function", i)) {
    const paren = indexOfCode(source, "(", i);
    if (paren < 0) return undefined;
    const paramsEnd = skipBalanced(source, paren, "(", ")");
    if (paramsEnd < 0) return undefined;
    const brace = indexOfCode(source, "{", paramsEnd + 1);
    if (brace < 0) return undefined;
    const end = skipBalanced(source, brace, "{", "}");
    if (end < 0) return undefined;
    return { body: source.slice(brace + 1, end), kind: "block" };
  }
  if (source[i] === "(") {
    const paramsEnd = skipBalanced(source, i, "(", ")");
    if (paramsEnd < 0) return undefined;
    const arrow = indexOfCode(source, "=>", paramsEnd + 1);
    if (arrow < 0) return undefined;
    i = skipWs(source, arrow + 2);
  } else if (/^[A-Za-z_$]/.test(source[i] ?? "")) {
    const ident = /^[A-Za-z_$][\w$]*/.exec(source.slice(i));
    if (!ident) return undefined;
    i = skipWs(source, i + ident[0].length);
    if (!source.startsWith("=>", i)) return undefined;
    i = skipWs(source, i + 2);
  } else {
    return undefined;
  }
  if (source[i] === "{") {
    const end = skipBalanced(source, i, "{", "}");
    if (end < 0) return undefined;
    return { body: source.slice(i + 1, end), kind: "block" };
  }
  return { body: readUntilSemicolon(source, i), kind: "expr" };
}

function findPy(source: string, name: string): string | undefined {
  const re = new RegExp(`^([ \\t]*)(?:async\\s+)?def\\s+${escapeReg(name)}\\s*\\([^)]*\\)\\s*(?:->\\s*[^:]+)?\\s*:\\s*(?:#.*)?$`, "m");
  const match = re.exec(source);
  if (!match) return undefined;
  const base = match[1].length;
  const lines = source.slice(match.index + match[0].length).split(/\r?\n/);
  const body: string[] = [];
  for (const line of lines) {
    if (!line.trim()) {
      body.push(line);
      continue;
    }
    const indent = line.match(/^[ \t]*/)?.[0].length ?? 0;
    if (indent <= base) break;
    body.push(line);
  }
  return body.join("\n");
}

function classifyBlock(body: string, lang: Lang, params: string[]): { expression?: string; rejectsMissing: boolean } {
  const stmts = lang === "py" ? pythonStatements(body) : jsStatements(stripJsComments(body));
  let expression: string | undefined;
  let rejectsMissing = false;
  let opaque = false;
  for (const stmt of stmts) {
    if (isGuard(stmt, params, lang)) {
      rejectsMissing = true;
      continue;
    }
    const returned = extractReturn(stmt);
    if (returned !== undefined && expression === undefined) {
      expression = returned;
      continue;
    }
    opaque = true;
  }
  if (opaque || expression === undefined) return { rejectsMissing };
  return { expression, rejectsMissing };
}

function extractReturn(stmt: string): string | undefined {
  const match = stmt.trim().match(/^return\s+([\s\S]+)$/);
  if (!match) return undefined;
  const expr = match[1].trim().replace(/;$/, "").trim();
  return expr || undefined;
}

function isGuard(stmt: string, params: string[], lang: Lang): boolean {
  const keyword = lang === "py" ? stmt.search(/\braise\b/) : stmt.search(/\bthrow\b/);
  if (keyword < 0) return false;
  const head = stmt.slice(0, keyword);
  if (!/\bif\b/.test(head)) return false;
  return params.some((param) => mentionsAbsence(head, param, lang));
}

function mentionsAbsence(head: string, param: string, lang: Lang): boolean {
  const p = escapeReg(param);
  if (lang === "py") {
    return new RegExp(`\\b${p}\\s+is\\s+None\\b`).test(head) || new RegExp(`\\bnot\\s+${p}\\b`).test(head);
  }
  return (
    new RegExp(`\\b${p}\\s*===?\\s*(?:undefined|null)\\b`).test(head) ||
    new RegExp(`\\b${p}\\s*!==?\\s*(?:undefined|null)\\b`).test(head) ||
    new RegExp(`\\b(?:undefined|null)\\s*===?\\s*${p}\\b`).test(head) ||
    new RegExp(`(?<![!=])!\\s*${p}\\b`).test(head) ||
    new RegExp(`typeof\\s+${p}\\s*===?\\s*["']undefined["']`).test(head)
  );
}

function jsStatements(body: string): string[] {
  const stmts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  const push = (end: number) => {
    const piece = body.slice(start, end).trim();
    if (piece) stmts.push(piece);
    start = end + 1;
  };
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (quote) {
      if (c === "\\") {
        i += 1;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) {
        push(i);
        return stmts;
      }
      depth -= 1;
      if (depth === 0 && c === "}") push(i);
    } else if (c === ";" && depth === 0) {
      push(i);
    }
  }
  const tail = body.slice(start).trim();
  if (tail) stmts.push(tail);
  return stmts;
}

function pythonStatements(body: string): string[] {
  const lines = body.replace(/\t/g, "    ").split(/\n/);
  const stmts: string[] = [];
  let bucket: string[] = [];
  let blockIndent = -1;
  const flush = () => {
    if (bucket.length) stmts.push(bucket.join("\n"));
    bucket = [];
    blockIndent = -1;
  };
  for (const raw of lines) {
    const line = stripPyComment(raw);
    if (!line.trim()) continue;
    const indent = line.match(/^ */)?.[0].length ?? 0;
    if (bucket.length === 0) {
      bucket.push(line.trim());
      if (line.trim().endsWith(":")) blockIndent = indent;
      else flush();
      continue;
    }
    if (blockIndent >= 0 && indent > blockIndent) {
      bucket.push(line.trim());
      continue;
    }
    flush();
    bucket.push(line.trim());
    if (line.trim().endsWith(":")) blockIndent = indent;
    else flush();
  }
  flush();
  return stmts;
}

function stripPyComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote) {
      if (c === "\\") {
        i += 1;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === "#") return line.slice(0, i);
  }
  return line;
}

function stripJsComments(source: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += source[i + 1] ?? "";
        i += 1;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      out += c;
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 1;
      out += " ";
      continue;
    }
    out += c;
  }
  return out;
}

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "null" }
  | { t: "undef" }
  | { t: "id"; v: string }
  | { t: "op"; v: string }
  | { t: "punc"; v: string };

function parseExpression(input: string, lang: Lang, names: Set<string>): Ast {
  const tokens = tokenize(input, lang);
  let index = 0;
  const peek = () => tokens[index];
  const eat = (kind?: Tok["t"], value?: string): Tok => {
    const tok = tokens[index];
    if (!tok) throw new Opaque("fim");
    if (kind && tok.t !== kind) throw new Opaque("token");
    if (value && ("v" in tok ? tok.v !== value : true)) throw new Opaque("valor");
    index += 1;
    return tok;
  };

  const parseTernary = (): Ast => {
    const left = parseOr();
    if (lang === "py" && peek()?.t === "op" && peek()?.t === "op" && (peek() as { v: string }).v === "if") {
      eat("op", "if");
      const cond = parseOr();
      eat("op", "else");
      const right = parseTernary();
      return { k: "tern", c: cond, a: left, b: right };
    }
    if (lang === "js" && peek()?.t === "punc" && (peek() as { v: string }).v === "?") {
      eat("punc", "?");
      const yes = parseTernary();
      eat("punc", ":");
      const no = parseTernary();
      return { k: "tern", c: left, a: yes, b: no };
    }
    return left;
  };

  const parseOr = (): Ast => {
    let left = parseAnd();
    while (isOp(peek(), lang === "py" ? "or" : "||")) {
      const op = (eat() as { v: string }).v;
      const right = parseAnd();
      left = { k: "bin", op, l: left, r: right };
    }
    return left;
  };

  const parseAnd = (): Ast => {
    let left = parseEq();
    while (isOp(peek(), lang === "py" ? "and" : "&&")) {
      const op = (eat() as { v: string }).v;
      const right = parseEq();
      left = { k: "bin", op, l: left, r: right };
    }
    return left;
  };

  const parseEq = (): Ast => {
    let left = parseRel();
    while (peek()?.t === "op" && ["===", "!==", "==", "!="].includes((peek() as { v: string }).v)) {
      if (lang === "py" && ["===", "!=="].includes((peek() as { v: string }).v)) throw new Opaque("===");
      const op = (eat() as { v: string }).v;
      const right = parseRel();
      left = { k: "bin", op, l: left, r: right };
    }
    return left;
  };

  const parseRel = (): Ast => {
    let left = parseAdd();
    while (peek()?.t === "op" && [">", "<", ">=", "<="].includes((peek() as { v: string }).v)) {
      const op = (eat() as { v: string }).v;
      const right = parseAdd();
      left = { k: "bin", op, l: left, r: right };
    }
    return left;
  };

  const parseAdd = (): Ast => {
    let left = parseMul();
    while (isOp(peek(), "+") || isOp(peek(), "-")) {
      const op = (eat() as { v: string }).v;
      const right = parseMul();
      left = { k: "bin", op, l: left, r: right };
    }
    return left;
  };

  const parseMul = (): Ast => {
    let left = parseUnary();
    while (peek()?.t === "op" && ["*", "/", "%"].includes((peek() as { v: string }).v)) {
      const op = (eat() as { v: string }).v;
      const right = parseUnary();
      left = { k: "bin", op, l: left, r: right };
    }
    return left;
  };

  const parseUnary = (): Ast => {
    if (isOp(peek(), "!") || isOp(peek(), "not") || isOp(peek(), "+") || isOp(peek(), "-")) {
      const op = (eat() as { v: string }).v as "!" | "not" | "+" | "-";
      return { k: "un", op, a: parseUnary() };
    }
    return parsePrimary();
  };

  const parsePrimary = (): Ast => {
    const tok = peek();
    if (!tok) throw new Opaque("fim");
    if (tok.t === "num" || tok.t === "str" || tok.t === "bool") {
      eat();
      return { k: "lit", v: tok.v };
    }
    if (tok.t === "null") {
      eat();
      return { k: "lit", v: null };
    }
    if (tok.t === "undef") {
      eat();
      return { k: "lit", v: undefined };
    }
    if (tok.t === "id") {
      const name = tok.v;
      eat();
      if (peek()?.t === "punc" && (peek() as { v: string }).v === "(") throw new Opaque("chamada");
      if (!names.has(name)) throw new Opaque("nome");
      if (peek()?.t === "punc" && (peek() as { v: string }).v === ".") throw new Opaque("propriedade");
      return { k: "id", name };
    }
    if (tok.t === "punc" && tok.v === "(") {
      eat();
      const inner = parseTernary();
      eat("punc", ")");
      return inner;
    }
    if (tok.t === "punc" && tok.v === "[") {
      eat();
      const items: Ast[] = [];
      if (!(peek()?.t === "punc" && (peek() as { v: string }).v === "]")) {
        items.push(parseTernary());
        while (peek()?.t === "punc" && (peek() as { v: string }).v === ",") {
          eat();
          if (peek()?.t === "punc" && (peek() as { v: string }).v === "]") break;
          items.push(parseTernary());
        }
      }
      eat("punc", "]");
      return { k: "arr", items };
    }
    if (tok.t === "punc" && tok.v === "{") {
      eat();
      const fields: Array<{ key: string; value: Ast }> = [];
      if (!(peek()?.t === "punc" && (peek() as { v: string }).v === "}")) {
        const field = parseField();
        fields.push(field);
        while (peek()?.t === "punc" && (peek() as { v: string }).v === ",") {
          eat();
          if (peek()?.t === "punc" && (peek() as { v: string }).v === "}") break;
          fields.push(parseField());
        }
      }
      eat("punc", "}");
      return { k: "obj", fields };
    }
    throw new Opaque("primário");
  };

  const parseField = (): { key: string; value: Ast } => {
    const tok = peek();
    if (tok?.t === "str") {
      eat();
      eat("punc", ":");
      return { key: tok.v, value: parseTernary() };
    }
    if (tok?.t === "id") {
      eat();
      if (peek()?.t === "punc" && (peek() as { v: string }).v === ":") {
        eat();
        return { key: tok.v, value: parseTernary() };
      }
      if (!names.has(tok.v)) throw new Opaque("atalho");
      return { key: tok.v, value: { k: "id", name: tok.v } };
    }
    throw new Opaque("campo");
  };

  const ast = parseTernary();
  if (index !== tokens.length) throw new Opaque("sobra");
  return ast;
}

function isOp(tok: Tok | undefined, value: string): boolean {
  return tok?.t === "op" && tok.v === value;
}

function tokenize(input: string, lang: Lang): Tok[] {
  const tokens: Tok[] = [];
  let i = 0;
  const two = ["===", "!==", "==", "!=", ">=", "<=", "&&", "||"];
  while (i < input.length) {
    const c = input[i];
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (c === "'" || c === '"') {
      const q = c;
      let s = "";
      i += 1;
      while (i < input.length && input[i] !== q) {
        if (input[i] === "\\") {
          s += input[i + 1] ?? "";
          i += 2;
          continue;
        }
        s += input[i];
        i += 1;
      }
      if (input[i] !== q) throw new Opaque("string");
      i += 1;
      tokens.push({ t: "str", v: s });
      continue;
    }
    if (c === "`") throw new Opaque("template");
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(input[i + 1] ?? ""))) {
      const num = /^(\d+(?:\.\d+)?)/.exec(input.slice(i));
      if (!num) throw new Opaque("número");
      tokens.push({ t: "num", v: Number(num[1]) });
      i += num[1].length;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const id = /^[A-Za-z_$][\w$]*/.exec(input.slice(i));
      if (!id) throw new Opaque("id");
      i += id[0].length;
      const word = id[0];
      if (word === "true" || word === "True") tokens.push({ t: "bool", v: true });
      else if (word === "false" || word === "False") tokens.push({ t: "bool", v: false });
      else if (word === "null" || word === "None") tokens.push({ t: "null" });
      else if (word === "undefined") tokens.push({ t: "undef" });
      else if (lang === "py" && (word === "and" || word === "or" || word === "not" || word === "if" || word === "else")) {
        tokens.push({ t: "op", v: word });
      } else if (["await", "this", "new", "throw", "raise", "typeof", "instanceof", "void", "function", "return"].includes(word)) {
        throw new Opaque(word);
      } else tokens.push({ t: "id", v: word });
      continue;
    }
    const op3 = two.find((op) => input.startsWith(op, i));
    if (op3) {
      tokens.push({ t: "op", v: op3 });
      i += op3.length;
      continue;
    }
    if ("+-*/%!<>".includes(c)) {
      if ((c === "/" || c === "*") && input[i + 1] === c) throw new Opaque("operador");
      tokens.push({ t: "op", v: c });
      i += 1;
      continue;
    }
    if ("()[]{},?:".includes(c)) {
      if (c === "?" && input[i + 1] === "." ) throw new Opaque("propriedade");
      if (c === "?" && input[i + 1] === "?") throw new Opaque("??");
      tokens.push({ t: "punc", v: c });
      i += 1;
      continue;
    }
    throw new Opaque(c);
  }
  return tokens;
}

function evalAst(ast: Ast, env: Map<string, unknown>, lang: Lang): unknown {
  switch (ast.k) {
    case "lit":
      return ast.v;
    case "id":
      if (!env.has(ast.name)) throw new Opaque("livre");
      return env.get(ast.name);
    case "un": {
      const value = evalAst(ast.a, env, lang);
      if (ast.op === "!" || ast.op === "not") return !truthy(value, lang);
      if (typeof value !== "number") throw new Opaque("unário");
      return ast.op === "-" ? -value : value;
    }
    case "bin":
      return evalBin(ast.op, evalAst(ast.l, env, lang), evalAst(ast.r, env, lang), lang);
    case "tern":
      return truthy(evalAst(ast.c, env, lang), lang) ? evalAst(ast.a, env, lang) : evalAst(ast.b, env, lang);
    case "arr":
      return ast.items.map((item) => evalAst(item, env, lang));
    case "obj": {
      const obj: Record<string, unknown> = {};
      for (const field of ast.fields) obj[field.key] = evalAst(field.value, env, lang);
      return obj;
    }
    default:
      throw new Opaque("ast");
  }
}

function evalBin(op: string, left: unknown, right: unknown, lang: Lang): unknown {
  if (op === "&&" || op === "and") return truthy(left, lang) ? right : left;
  if (op === "||" || op === "or") return truthy(left, lang) ? left : right;
  if (op === "+") return addValues(left, right, lang);
  if (op === "-" || op === "*" || op === "/" || op === "%") {
    if (typeof left !== "number" || typeof right !== "number") throw new Opaque("aritmética");
    if ((op === "/" || op === "%") && right === 0) throw new Opaque("divisão");
    if (op === "-") return left - right;
    if (op === "*") return left * right;
    if (op === "/") return left / right;
    return left % right;
  }
  if (op === "===") return left === right;
  if (op === "!==") return left !== right;
  if (op === "==") return lang === "py" ? left === right : left == right;
  if (op === "!=") return lang === "py" ? left !== right : left != right;
  if (typeof left === "number" && typeof right === "number") {
    if (op === ">") return left > right;
    if (op === "<") return left < right;
    if (op === ">=") return left >= right;
    if (op === "<=") return left <= right;
  }
  if (typeof left === "string" && typeof right === "string") {
    if (op === ">") return left > right;
    if (op === "<") return left < right;
    if (op === ">=") return left >= right;
    if (op === "<=") return left <= right;
  }
  throw new Opaque("comparação");
}

function addValues(left: unknown, right: unknown, lang: Lang): unknown {
  if (lang === "py") {
    if (typeof left === "string" && typeof right === "string") return left + right;
    if (typeof left === "number" && typeof right === "number") return left + right;
    if (Array.isArray(left) && Array.isArray(right)) return [...left, ...right];
    throw new Opaque("soma");
  }
  if (typeof left === "string" || typeof right === "string") return String(left) + String(right);
  if (typeof left === "number" && typeof right === "number") return left + right;
  if ((typeof left === "number" || typeof left === "boolean") && (typeof right === "number" || typeof right === "boolean")) {
    return Number(left) + Number(right);
  }
  throw new Opaque("soma");
}

function truthy(value: unknown, lang: Lang): boolean {
  if (lang === "py") {
    if (value === null || value === undefined || value === false || value === 0 || value === "") return false;
    if (Array.isArray(value) && value.length === 0) return false;
    if (typeof value === "object" && value && !Array.isArray(value) && !(value instanceof Date) && Object.keys(value).length === 0) {
      return false;
    }
    return true;
  }
  return Boolean(value);
}

function printAst(ast: Ast, lang: Lang, rename: Map<string, string>): string {
  switch (ast.k) {
    case "lit":
      return formatValue(ast.v, lang === "py" ? "py" : "js");
    case "id":
      return rename.get(ast.name) ?? ast.name;
    case "un": {
      const inner = printAst(ast.a, lang, rename);
      if (ast.op === "not") return `(not ${inner})`;
      return `(${ast.op}${inner})`;
    }
    case "bin":
      return `(${printAst(ast.l, lang, rename)} ${ast.op} ${printAst(ast.r, lang, rename)})`;
    case "tern":
      if (lang === "py") {
        return `(${printAst(ast.a, lang, rename)} if ${printAst(ast.c, lang, rename)} else ${printAst(ast.b, lang, rename)})`;
      }
      return `(${printAst(ast.c, lang, rename)} ? ${printAst(ast.a, lang, rename)} : ${printAst(ast.b, lang, rename)})`;
    case "arr":
      return `[${ast.items.map((item) => printAst(item, lang, rename)).join(", ")}]`;
    case "obj":
      return `{ ${ast.fields.map((field) => `${JSON.stringify(field.key)}: ${printAst(field.value, lang, rename)}`).join(", ")} }`;
    default:
      return "";
  }
}

function skipWs(source: string, index: number): number {
  let i = index;
  while (i < source.length && /\s/.test(source[i])) i += 1;
  return i;
}

function skipBalanced(source: string, start: number, open: string, close: string): number {
  if (source[start] !== open) return -1;
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < source.length; i += 1) {
    const c = source[i];
    if (quote) {
      if (c === "\\") {
        i += 1;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      continue;
    }
    if (c === open) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function indexOfCode(source: string, needle: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < source.length; i += 1) {
    const c = source[i];
    if (quote) {
      if (c === "\\") {
        i += 1;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      continue;
    }
    if (source.startsWith(needle, i)) return i;
    if (c === ";" || c === "\n") {
      if (needle !== "=>") continue;
    }
  }
  return -1;
}

function readUntilSemicolon(source: string, start: number): string {
  let quote: string | null = null;
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const c = source[i];
    if (quote) {
      if (c === "\\") {
        i += 1;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) return source.slice(start, i).trim();
      depth -= 1;
    } else if (c === ";" && depth === 0) {
      return source.slice(start, i).trim();
    }
  }
  return source.slice(start).trim();
}

function escapeReg(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
