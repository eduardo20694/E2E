/**
 * Controles de tela e rotas HTTP extraídos do fonte.
 * Sem eval: só varredura de tags e de literais no handler.
 */

import fs from "node:fs";
import path from "node:path";

export type UiKind = "button" | "link" | "heading" | "label" | "input" | "placeholder" | "testid" | "role";

export interface UiControl {
  kind: UiKind;
  /** Texto visível, aria-label, placeholder, testid ou valor de role. */
  text?: string;
  /** Nome acessível quando o controle também tem role explícito. */
  name?: string;
  type?: string;
  level?: 1 | 2 | 3;
  /** href literal de <a> ou <Link>. */
  href?: string;
  /** Dentro de cond &&, ternário ou .map(. Não entra na asserção do estado inicial. */
  conditional?: boolean;
  /** i18n sem locale, e sem data-testid. */
  missingStaticText?: boolean;
}

export interface ExtractUiOptions {
  projectRoot?: string;
  locales?: Record<string, unknown>;
}

export interface WebRoute {
  method: string;
  path: string;
  status: number;
  returnsJson?: boolean;
  /** 400 quando o handler mostra 400 ou zod/schema. */
  validationStatus?: number;
  /** 401 ou 403 quando o handler mostra esse literal. */
  authStatus?: number;
  /** Guarda, middleware de auth, ou 401/403 no próprio handler. */
  requiresAuth?: boolean;
}

export interface ScreenComponent {
  name: string;
  defaultExport: boolean;
}

const ELEMENT_TAGS = ["button", "Button", "a", "Link", "h1", "h2", "h3", "label", "input", "textarea", "Input", "Textarea"];

const DESTRUCTIVE_CLICK =
  /\b(excluir|deletar|apagar|remover|sair|logout|pagar|cancelar|delete|remove|pay|sign out|log out)\b/i;

const SKIP_PAGE_NAMES = new Set(["_app", "_document", "_error", "404", "500", "middleware"]);

export function extractUi(source: string, options?: ExtractUiOptions): UiControl[] {
  const cleaned = stripNoise(source);
  const locales = options?.locales ?? loadProjectLocales(options?.projectRoot);
  const controls: UiControl[] = [];
  for (const tag of ELEMENT_TAGS) {
    for (const element of findElements(cleaned, tag)) {
      const extra = extraAt(cleaned, element.start);
      pushElement(controls, tag, element.attrs, element.inner, extra, locales);
    }
  }
  walkTags(cleaned, (tag, attrs, start) => {
    if (ELEMENT_TAGS.includes(tag)) return;
    const extra = extraAt(cleaned, start);
    pushAttributes(controls, attrs, extra);
  });
  return controls;
}

export function isUnsafeClick(text?: string): boolean {
  if (!text?.trim()) return false;
  return DESTRUCTIVE_CLICK.test(text);
}

/** `/` → `home`; `/pedidos/:id` → `pedidos-id`; sem rota → nome do componente em kebab-case. */
export function slugFor(route?: string, componentName?: string, filePath?: string): string {
  if (route?.trim()) {
    if (route.trim() === "/") return "home";
    const fromRoute = route
      .trim()
      .replace(/^\//, "")
      .replace(/:[^/]+/g, (part) => part.slice(1))
      .replace(/[/\\]+/g, "-")
      .replace(/[^A-Za-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase();
    if (fromRoute) return fromRoute;
  }
  if (componentName?.trim()) {
    const fromName = kebab(componentName);
    if (fromName) return fromName;
  }
  if (filePath?.trim()) {
    const parts = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
    let stem = (parts.pop() ?? "").replace(/\.[^.]+$/, "");
    if (!stem || /^(index|page)$/i.test(stem)) stem = parts.pop() ?? "";
    const fromFile = kebab(stem);
    if (fromFile) return fromFile;
  }
  return "tela";
}

export function applyRouteParams(route: string, params?: Record<string, string>): {
  path: string;
  used: Record<string, string>;
} {
  const used: Record<string, string> = {};
  const pathValue = route.replace(/:([A-Za-z_][\w]*)/g, (_, name: string) => {
    const value = params?.[name] ?? "1";
    used[name] = value;
    return value;
  });
  return { path: pathValue, used };
}

export function hasNpmDependency(projectRoot: string | undefined, name: string): boolean {
  if (!projectRoot) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return Boolean(pkg.dependencies?.[name] || pkg.devDependencies?.[name]);
  } catch {
    return false;
  }
}

export function detectsSsr(source: string, filePath?: string): boolean {
  if (/\bgetServerSideProps\b|\bgetStaticProps\b/.test(source)) return true;
  const normalized = (filePath ?? "").replace(/\\/g, "/");
  if (!/(?:^|\/)app\/.+\/page\.[a-z0-9]+$/i.test(normalized)) return false;
  if (/['"]use client['"]/.test(source)) return false;
  if (/\basync\s+(?:function|\()/.test(source) || /export\s+default\s+async\b/.test(source)) return true;
  if (/\bfetch\s*\(/.test(source)) return true;
  return false;
}

export function resolvePageRoute(options: {
  filePath?: string;
  projectRoot?: string;
  route?: string;
  routeParams?: Record<string, string>;
  componentName?: string;
}): {
  pattern?: string;
  path?: string;
  assumed?: boolean;
  guessedFromPages?: boolean;
  paramsUsed?: Record<string, string>;
} {
  if (options.route?.trim()) {
    const applied = applyRouteParams(options.route.trim(), options.routeParams);
    return { pattern: options.route.trim(), path: applied.path, paramsUsed: applied.used };
  }
  const fromFile = options.filePath ? routeFromPage(options.filePath) : undefined;
  const pagesGuess =
    Boolean(fromFile) &&
    Boolean(options.filePath && /(?:^|\/)(?:src\/)?pages\//i.test(options.filePath.replace(/\\/g, "/")));
  const next = hasNpmDependency(options.projectRoot, "next");
  let pattern = fromFile;
  let assumed = false;
  let guessedFromPages = false;
  if (!next && pagesGuess && fromFile) {
    guessedFromPages = true;
    const declared =
      options.projectRoot && options.componentName
        ? findDeclaredRoute(options.projectRoot, options.componentName)
        : undefined;
    if (declared) pattern = declared;
    else {
      pattern = fromFile;
      assumed = true;
    }
  }
  if (!pattern) return {};
  const applied = applyRouteParams(pattern, options.routeParams);
  return { pattern, path: applied.path, assumed, guessedFromPages, paramsUsed: applied.used };
}

export function screenComponent(source: string, filePath?: string): ScreenComponent | undefined {
  if (!hasJsx(source)) return undefined;
  const defFn = /export\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(source);
  if (defFn && /^[A-Z]/.test(defFn[1])) return { name: defFn[1], defaultExport: true };
  const defClass = /export\s+default\s+class\s+([A-Z][\w$]*)/.exec(source);
  if (defClass) return { name: defClass[1], defaultExport: true };
  if (/export\s+default\s+(?:async\s+)?function\s*\(/.test(source) || /export\s+default\s+(?:async\s+)?\([^)]*\)\s*=>/.test(source)) {
    const name = fileComponentName(filePath);
    if (name) return { name, defaultExport: true };
  }
  const namedFn = /export\s+(?:async\s+)?function\s+([A-Z][\w$]*)/.exec(source);
  if (namedFn) return { name: namedFn[1], defaultExport: false };
  const namedConst = /export\s+const\s+([A-Z][\w$]*)\s*=/.exec(source);
  if (namedConst) return { name: namedConst[1], defaultExport: false };
  const defIdent = /export\s+default\s+([A-Z][\w$]*)\b/.exec(source);
  if (defIdent) return { name: defIdent[1], defaultExport: true };
  return undefined;
}

export function hasJsx(source: string): boolean {
  return /<[A-Za-z][\w.-]*(?=[\s>/])/.test(source);
}

/** `pages/checkout.tsx`, `app/checkout/page.tsx`, `src/pages/Checkout.tsx` → caminho com o caso original. `index` → `/`. */
export function routeFromPage(filePath: string): string | undefined {
  const normalized = normalizeRoute(filePath);
  const app = normalized.match(/(?:^|\/)app\/(.+)\/page\.[a-z0-9]+$/i);
  if (app) return toUrlPath(app[1]);
  const pages = normalized.match(/(?:^|\/)pages\/(.+)\.[a-z0-9]+$/i);
  if (!pages) return undefined;
  if (/^api(?:\/|$)/i.test(pages[1])) return undefined;
  return toUrlPath(pages[1]);
}

export function extractRoutes(source: string, filePath?: string): WebRoute[] {
  const cleaned = stripNoise(source);
  const fileAuth = hasAuthSignal(cleaned);
  return dedupeRoutes([
    ...expressRoutes(cleaned, fileAuth),
    ...nextRoutes(cleaned, filePath, fileAuth),
    ...clientRoutes(cleaned, fileAuth),
  ]);
}

/** Middleware ou guarda. 401 solto no arquivo, fora do handler, não conta. */
const AUTH_SIGNAL =
  /\b(?:authenticate|requireAuth|passport|jwt|isAuthenticated|getServerSession|withAuth|login_required)\b|\bauth\b|\bsession\b|\bguard\b|\bprotected\b|@login_required|Depends\s*\(\s*get_current_user\s*\)/i;

function hasAuthSignal(source: string): boolean {
  return AUTH_SIGNAL.test(source);
}

export function exportedApp(source: string): "named" | "default" | undefined {
  if (/export\s+default\s+(?:async\s+)?function\s+app\b/.test(source)) return "default";
  if (/export\s+default\s+app\b/.test(source)) return "default";
  if (/export\s+(?:const|let|var|function|async\s+function)\s+app\b/.test(source)) return "named";
  if (/export\s*\{[^}]*\bapp\b[^}]*\}/.test(source)) return "named";
  if (/module\.exports\s*=\s*app\b/.test(source)) return "named";
  return undefined;
}

function extraAt(source: string, start: number): Pick<UiControl, "conditional"> {
  return { conditional: isConditionalAt(source, start) || undefined };
}

function resolveControlText(
  inner: string,
  accessible: string | undefined,
  locales?: Record<string, unknown>,
): { text?: string; missingStaticText?: boolean } {
  if (accessible) return { text: accessible };
  const key = i18nKey(inner);
  if (key) {
    const resolved = resolveLocaleKey(locales, key);
    if (resolved) return { text: resolved };
    return { missingStaticText: true };
  }
  const text = literalText(inner);
  return text ? { text } : {};
}

function pushElement(
  controls: UiControl[],
  tag: string,
  attrs: string,
  inner: string,
  extra: Pick<UiControl, "conditional">,
  locales?: Record<string, unknown>,
): void {
  const lower = tag.toLowerCase();
  const accessible = attr(attrs, "aria-label");
  const resolved = resolveControlText(inner, accessible, locales);
  const text = resolved.text;
  const testid = attr(attrs, "data-testid");
  const missing = resolved.missingStaticText && !testid;
  const href = attr(attrs, "href");
  const flag = extra.conditional ? { conditional: true as const } : {};
  if (lower === "button") {
    if (text) pushControl(controls, { kind: "button", text, ...flag });
    else if (missing) pushControl(controls, { kind: "button", missingStaticText: true, ...flag });
    pushAttributes(controls, attrs, extra);
    return;
  }
  if (lower === "a" || tag === "Link") {
    if (text) pushControl(controls, { kind: "link", text, href, ...flag });
    else if (href) pushControl(controls, { kind: "link", href, missingStaticText: missing, ...flag });
    else if (missing) pushControl(controls, { kind: "link", missingStaticText: true, ...flag });
    pushAttributes(controls, attrs, extra);
    return;
  }
  if (lower === "h1" || lower === "h2" || lower === "h3") {
    if (text) pushControl(controls, { kind: "heading", text, level: Number(lower[1]) as 1 | 2 | 3, ...flag });
    else if (missing) pushControl(controls, { kind: "heading", missingStaticText: true, level: Number(lower[1]) as 1 | 2 | 3, ...flag });
    pushAttributes(controls, attrs, extra);
    return;
  }
  if (lower === "label") {
    if (text) pushControl(controls, { kind: "label", text, ...flag });
    else if (missing) pushControl(controls, { kind: "label", missingStaticText: true, ...flag });
    pushAttributes(controls, attrs, extra);
    return;
  }
  if (lower === "input" || lower === "textarea") {
    const type = lower === "textarea" ? "textarea" : attr(attrs, "type") ?? "text";
    const name = attr(attrs, "name");
    pushControl(controls, { kind: "input", type, name, text: name, ...flag });
    pushAttributes(controls, attrs, extra);
  }
}

function pushAttributes(controls: UiControl[], attrs: string, extra: Pick<UiControl, "conditional"> = {}): void {
  const flag = extra.conditional ? { conditional: true as const } : {};
  const placeholder = attr(attrs, "placeholder");
  if (placeholder) pushControl(controls, { kind: "placeholder", text: placeholder, ...flag });
  const testid = attr(attrs, "data-testid");
  if (testid) pushControl(controls, { kind: "testid", text: testid, ...flag });
  const role = attr(attrs, "role");
  if (role && role !== "button" && role !== "link") {
    pushControl(controls, { kind: "role", text: role, name: attr(attrs, "aria-label"), ...flag });
  }
}

function pushControl(controls: UiControl[], control: UiControl): void {
  const key = JSON.stringify(control);
  if (controls.some((item) => JSON.stringify(item) === key)) return;
  controls.push(control);
}

function literalText(inner: string): string {
  const withoutTags = inner.replace(/<[^>]*>/g, " ");
  const withoutExpr = stripExpressions(withoutTags);
  return withoutExpr.replace(/\s+/g, " ").trim();
}

function stripExpressions(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i += 1) {
    if (input[i] === "{") {
      const end = skipBalanced(input, i, "{", "}");
      if (end < 0) break;
      out += " ";
      i = end;
      continue;
    }
    out += input[i];
  }
  return out;
}

function attr(attrs: string, name: string): string | undefined {
  const re = new RegExp(
    `(?:^|\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{\\s*["']([^"']*)["']\\s*\\})`,
  );
  const match = attrs.match(re);
  const value = (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
  return value || undefined;
}

interface ElementHit {
  attrs: string;
  inner: string;
  start: number;
}

function findElements(source: string, tag: string): ElementHit[] {
  const hits: ElementHit[] = [];
  const open = new RegExp(`<${tag}(?=[\\s>/])`, "g");
  let match: RegExpExecArray | null;
  while ((match = open.exec(source))) {
    const tagEnd = endOfTag(source, match.index);
    if (tagEnd < 0) continue;
    const raw = source.slice(match.index, tagEnd + 1);
    const selfClosing = /\/\s*>$/.test(raw);
    const attrs = raw.slice(tag.length + 1, raw.length - (selfClosing ? 2 : 1)).trim();
    if (selfClosing) {
      hits.push({ attrs, inner: "", start: match.index });
      continue;
    }
    const closeAt = indexOfClose(source, tag, tagEnd + 1);
    if (closeAt < 0) continue;
    hits.push({ attrs, inner: source.slice(tagEnd + 1, closeAt), start: match.index });
    open.lastIndex = closeAt + tag.length + 3;
  }
  return hits;
}

function walkTags(source: string, visit: (tag: string, attrs: string, start: number) => void): void {
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] !== "<" || source[i + 1] === "/" || source[i + 1] === "!" || source[i + 1] === "?") continue;
    const name = /^<([A-Za-z][\w.-]*)/.exec(source.slice(i));
    if (!name) continue;
    const tagEnd = endOfTag(source, i);
    if (tagEnd < 0) continue;
    const raw = source.slice(i, tagEnd + 1);
    const selfClosing = /\/\s*>$/.test(raw);
    const attrs = raw.slice(name[0].length, raw.length - (selfClosing ? 2 : 1));
    visit(name[1], attrs, i);
    i = tagEnd;
  }
}

function expressRoutes(source: string, fileAuth: boolean): WebRoute[] {
  const routes: WebRoute[] = [];
  const re = /\.(get|post|put|patch|delete|head)\s*\(\s*(['"`])(\/[^'"`]*)\2/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    if (match[3].includes("${")) continue;
    const open = source.lastIndexOf("(", match.index + match[0].length);
    const close = skipBalanced(source, open, "(", ")");
    const handler = close < 0 ? source.slice(match.index + match[0].length) : source.slice(match.index + match[0].length, close);
    routes.push(buildRoute(match[1], match[3], handler, fileAuth));
  }
  return routes;
}

/** fetch e axios no mesmo arquivo da tela. Path literal; method do axios ou do init do fetch. */
function clientRoutes(source: string, fileAuth: boolean): WebRoute[] {
  const routes: WebRoute[] = [];
  const fetchRe = /\bfetch\s*\(\s*(['"`])([^'"`]+)\1/g;
  let match: RegExpExecArray | null;
  while ((match = fetchRe.exec(source))) {
    const path = clientPath(match[2]);
    if (!path) continue;
    const tail = source.slice(match.index + match[0].length, match.index + match[0].length + 240);
    const method = /\bmethod\s*:\s*['"`](GET|POST|PUT|PATCH|DELETE|HEAD)['"`]/i.exec(tail)?.[1] ?? "GET";
    routes.push({ method: method.toUpperCase(), path, status: 200, returnsJson: true, requiresAuth: fileAuth });
  }
  const axiosRe = /\baxios\.(get|post|put|patch|delete|head)\s*\(\s*(['"`])([^'"`]+)\2/gi;
  while ((match = axiosRe.exec(source))) {
    const path = clientPath(match[3]);
    if (!path) continue;
    routes.push({ method: match[1].toUpperCase(), path, status: 200, returnsJson: true, requiresAuth: fileAuth });
  }
  const axiosCall = /\baxios\s*\(\s*\{/g;
  while ((match = axiosCall.exec(source))) {
    const open = source.indexOf("{", match.index);
    const close = skipBalanced(source, open, "{", "}");
    if (close < 0) continue;
    const body = source.slice(open, close + 1);
    const url = /\burl\s*:\s*(['"`])([^'"`]+)\1/.exec(body);
    if (!url) continue;
    const path = clientPath(url[2]);
    if (!path) continue;
    const method = /\bmethod\s*:\s*['"`](GET|POST|PUT|PATCH|DELETE|HEAD)['"`]/i.exec(body)?.[1] ?? "GET";
    routes.push({ method: method.toUpperCase(), path, status: 200, returnsJson: true, requiresAuth: fileAuth });
  }
  return routes;
}

function clientPath(raw: string): string | undefined {
  const value = raw.trim();
  if (!value || value.includes("${")) return undefined;
  if (value.startsWith("/")) return value.split(/[?#]/)[0] || "/";
  try {
    return new URL(value).pathname || "/";
  } catch {
    return undefined;
  }
}

function nextRoutes(source: string, filePath: string | undefined, fileAuth: boolean): WebRoute[] {
  const path = routeFromApiFile(filePath);
  if (!path) return [];
  const routes: WebRoute[] = [];
  const re = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD)\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    routes.push(buildRoute(match[1], path, readFunctionBody(source, match.index + match[0].length), fileAuth));
  }
  return routes;
}

function routeFromApiFile(filePath?: string): string | undefined {
  if (!filePath) return undefined;
  const normalized = normalizeRoute(filePath);
  const app = normalized.match(/(?:^|\/)app\/(.+)\/route\.[a-z0-9]+$/i);
  if (app) return toUrlPath(app[1]);
  const pages = normalized.match(/(?:^|\/)pages\/(api(?:\/.+)?)\.[a-z0-9]+$/i);
  if (pages) return toUrlPath(pages[1].replace(/\/index$/i, ""));
  return undefined;
}

function buildRoute(methodRaw: string, path: string, handler: string, fileAuth: boolean): WebRoute {
  const method = methodRaw.toUpperCase();
  const literals = statusLiterals(handler);
  const success = literals.filter((code) => code >= 200 && code < 300);
  const status = success.at(-1) ?? literals.at(-1) ?? defaultStatus(method);
  const validationCandidates = [422, 400].filter((code) => literals.includes(code) && code !== status);
  const validationStatus = validationCandidates[0];
  let authStatus: number | undefined;
  if (literals.includes(401)) authStatus = 401;
  else if (literals.includes(403)) authStatus = 403;
  if (authStatus === status) authStatus = undefined;
  const handlerDeclaresAuth = literals.includes(401) || literals.includes(403);
  return {
    method,
    path,
    status,
    returnsJson: returnsJson(handler),
    validationStatus,
    authStatus,
    requiresAuth: handlerDeclaresAuth || hasAuthSignal(handler) || fileAuth,
  };
}

function statusLiterals(handler: string): number[] {
  const literals: number[] = [];
  const re = /\.status\s*\(\s*(\d{3})\s*\)|status\s*:\s*(\d{3})\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(handler))) {
    literals.push(Number(match[1] ?? match[2]));
  }
  return literals;
}

function returnsJson(handler: string): boolean {
  return /NextResponse\.json\s*\(/.test(handler) || /\bres\b[\s\S]{0,160}?\.json\s*\(/.test(handler);
}

function defaultStatus(method: string): number {
  if (method === "POST") return 201;
  if (method === "DELETE") return 204;
  return 200;
}

function dedupeRoutes(routes: WebRoute[]): WebRoute[] {
  const seen = new Set<string>();
  return routes.filter((route) => {
    const key = `${route.method} ${route.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toUrlPath(relative: string): string | undefined {
  const raw = relative.split("/").filter((segment) => segment && !segment.startsWith("(") && !segment.startsWith("@"));
  const mapped: string[] = [];
  for (const segment of raw) {
    if (SKIP_PAGE_NAMES.has(segment.toLowerCase()) || segment.startsWith("_")) return undefined;
    const dyn = dynamicSegment(segment);
    const value = dyn ?? segment;
    if (/^(index|page|route)$/i.test(value)) continue;
    mapped.push(value);
  }
  if (mapped.length === 0) return "/";
  return `/${mapped.join("/")}`;
}

function dynamicSegment(segment: string): string | undefined {
  const optionalCatch = segment.match(/^\[\[\.\.\.(.+)\]\]$/);
  if (optionalCatch) return `:${optionalCatch[1]}`;
  const catchAll = segment.match(/^\[\.\.\.(.+)\]$/);
  if (catchAll) return `:${catchAll[1]}`;
  const param = segment.match(/^\[(.+)\]$/);
  if (param) return `:${param[1]}`;
  return undefined;
}

function normalizeRoute(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function fileComponentName(filePath?: string): string | undefined {
  if (!filePath) return undefined;
  const parts = filePath.replace(/\\/g, "/").split("/");
  const base = parts.pop() ?? "";
  let stem = base.replace(/\.[^.]+$/, "");
  if (!stem || stem === "index" || stem === "page") stem = parts.pop() ?? "";
  if (!stem || stem === "pages" || stem === "app" || stem === "src" || stem.startsWith("(")) return undefined;
  const name = stem.charAt(0).toUpperCase() + stem.slice(1);
  return /^[A-Z]/.test(name) ? name : undefined;
}

function readFunctionBody(source: string, from: number): string {
  const brace = indexOfCode(source, "{", from);
  if (brace < 0) return source.slice(from);
  const end = skipBalanced(source, brace, "{", "}");
  if (end < 0) return source.slice(brace);
  return source.slice(brace, end + 1);
}

function endOfTag(source: string, start: number): number {
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
    if (c === ">") return i;
  }
  return -1;
}

function indexOfClose(source: string, tag: string, from: number): number {
  let depth = 1;
  let i = from;
  while (i < source.length) {
    const nextOpen = source.indexOf(`<${tag}`, i);
    const nextClose = source.indexOf(`</${tag}`, i);
    if (nextClose < 0) return -1;
    const openIsTag = nextOpen >= 0 && new RegExp(`^<${tag}(?=[\\s>/])`).test(source.slice(nextOpen));
    if (openIsTag && nextOpen < nextClose) {
      const tagEnd = endOfTag(source, nextOpen);
      if (tagEnd < 0) return -1;
      const raw = source.slice(nextOpen, tagEnd + 1);
      i = tagEnd + 1;
      if (!/\/\s*>$/.test(raw)) depth += 1;
      continue;
    }
    const closeEnd = source.indexOf(">", nextClose);
    if (closeEnd < 0) return -1;
    depth -= 1;
    if (depth === 0) return nextClose;
    i = closeEnd + 1;
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
  }
  return -1;
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

function kebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function i18nKey(inner: string): string | undefined {
  const trimmed = inner.replace(/\s+/g, " ").trim();
  const tCall = /^\{\s*t\s*\(\s*(["'])([^"'\\]+)\1\s*\)\s*\}$/.exec(trimmed);
  if (tCall) return tCall[2];
  const intl = /^\{\s*intl\.formatMessage\s*\(\s*\{\s*id\s*:\s*(["'])([^"'\\]+)\1/.exec(trimmed);
  if (intl) return intl[2];
  return undefined;
}

function loadProjectLocales(projectRoot?: string): Record<string, unknown> | undefined {
  if (!projectRoot) return undefined;
  const files = findLocaleFiles(projectRoot);
  const chosen = pickLocaleFile(files);
  if (!chosen) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(chosen, "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function findLocaleFiles(projectRoot: string): string[] {
  const found: string[] = [];
  for (const base of ["public/locales", "src/locales", "src/i18n", "locales"]) {
    const dir = path.join(projectRoot, base);
    if (!fs.existsSync(dir)) continue;
    collectJson(dir, found, 0);
  }
  return found;
}

function collectJson(current: string, found: string[], depth: number): void {
  if (depth > 6 || found.length >= 40) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (found.length >= 40) return;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) collectJson(full, found, depth + 1);
    else if (entry.isFile() && entry.name.endsWith(".json")) found.push(full);
  }
}

function pickLocaleFile(files: string[]): string | undefined {
  if (files.length === 0) return undefined;
  const posix = files.map((file) => ({ file, n: file.replace(/\\/g, "/") }));
  const ptBr = posix.find((item) => /\/pt-BR(?:\/|$)/i.test(item.n) || /pt-BR\.json$/i.test(item.n));
  if (ptBr) return ptBr.file;
  const pt = posix.find((item) => /\/pt(?:\/|$)/i.test(item.n) || /\/pt\.json$/i.test(item.n));
  if (pt) return pt.file;
  return files[0];
}

function resolveLocaleKey(locales: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!locales) return undefined;
  let current: unknown = locales;
  for (const part of key.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}

function isConditionalAt(source: string, start: number): boolean {
  const open = findEnclosingBrace(source, start);
  if (open < 0) return false;
  const head = source.slice(open + 1, start);
  return /\.map\s*\(/.test(head) || /&&/.test(head) || /\?/.test(head);
}

function findEnclosingBrace(source: string, pos: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = pos - 1; i >= 0; i -= 1) {
    const c = source[i];
    if (quote) {
      if (c === quote && source[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      continue;
    }
    if (c === "}") depth += 1;
    else if (c === "{") {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

export function findDeclaredRoute(projectRoot: string, componentName: string): string | undefined {
  const files: string[] = [];
  collectSource(projectRoot, projectRoot, 0, files);
  const nameRe = new RegExp(`\\b${componentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  for (const file of files) {
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!nameRe.test(text)) continue;
    const nearby = pathNearName(text, componentName);
    if (nearby) return nearby;
  }
  return undefined;
}

function pathNearName(source: string, componentName: string): string | undefined {
  const escaped = componentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<Route\\s+[^>]*path\\s*=\\s*["'\`]([^"'\`]+)["'\`][^>]*>[\\s\\S]{0,240}${escaped}`),
    new RegExp(`${escaped}[\\s\\S]{0,240}<Route\\s+[^>]*path\\s*=\\s*["'\`]([^"'\`]+)`),
    new RegExp(`path\\s*:\\s*["'\`]([^"'\`]+)["'\`][\\s\\S]{0,240}${escaped}`),
    new RegExp(`${escaped}[\\s\\S]{0,240}path\\s*:\\s*["'\`]([^"'\`]+)`),
  ];
  if (/createBrowserRouter/.test(source)) {
    for (const pattern of patterns) {
      const match = pattern.exec(source);
      if (match?.[1]) return match[1].startsWith("/") ? match[1] : `/${match[1]}`;
    }
  }
  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (match?.[1]) return match[1].startsWith("/") ? match[1] : `/${match[1]}`;
  }
  return undefined;
}

function collectSource(root: string, current: string, depth: number, found: string[]): void {
  if (depth > 6 || found.length >= 120) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (found.length >= 120) return;
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name.startsWith(".")) {
      continue;
    }
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      collectSource(root, full, depth + 1, found);
      continue;
    }
    if (entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name)) found.push(full);
  }
}

function stripNoise(source: string): string {
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
    if (source.startsWith("{/*", i)) {
      const end = source.indexOf("*/}", i + 3);
      if (end >= 0) {
        i = end + 2;
        out += " ";
        continue;
      }
    }
    out += c;
  }
  return out.replace(/<!--[\s\S]*?-->/g, " ");
}
