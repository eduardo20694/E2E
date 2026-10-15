import fs from "node:fs";
import path from "node:path";
import { extractRoutes, isUnsafeClick, slugFor, type UiControl, type WebRoute } from "./web.js";

export interface FrontRenderOptions {
  steps: string[];
  baseUrl: string;
  title: string;
  controls?: UiControl[];
  route?: string;
  sourceCode?: string;
  filePath?: string;
  mode?: "live" | "component" | "network";
  mockNetwork?: boolean;
  componentName?: string;
  componentDefaultExport?: boolean;
  ctPackage?: string;
  runner?: "vitest" | "jest";
  apiPattern?: string;
  projectRoot?: string;
  testDir?: string;
  slug?: string;
  hasClock?: boolean;
  framework?: "playwright" | "cypress" | "selenium";
}

export interface FrontFixtureFile {
  relativePath: string;
  contents: string;
}

export interface RenderedFrontTest {
  language: string;
  fileName: string;
  code: string;
  folder: string;
  fixtures: FrontFixtureFile[];
  notes: string[];
  skippedClicks: string[];
  conditionalControls: string[];
  missingStaticText: string[];
}

export function playwrightNetwork(options: FrontRenderOptions): string {
  return buildPlaywrightNetwork(options).code;
}

export function buildFrontTest(options: FrontRenderOptions): RenderedFrontTest {
  const slug = options.slug || slugFor(options.route, options.componentName, options.filePath);
  const folder = (options.testDir ?? "e2e").replace(/\\/g, "/").replace(/\/$/, "") || "e2e";
  const framework = options.framework ?? "playwright";
  const mode = options.mode ?? "network";
  if (mode === "component") {
    return buildComponentSpec(options, slug, folder);
  }
  if (framework === "cypress") {
    return buildCypressNetwork(options, slug, folder);
  }
  if (framework === "selenium") {
    return buildSeleniumLive(options, slug, folder);
  }
  if (mode === "live") {
    return buildPlaywrightLive(options, slug, folder);
  }
  return buildPlaywrightNetwork(options, slug, folder);
}

export function mockPayload(list: { noun: string } | undefined, hint?: string, empty?: boolean): unknown {
  if (empty) return [];
  const one = (id: number, name: string) => ({ id, title: name, name, mocked: true });
  if (list) return [one(1, `${list.noun} 1`), one(2, `${list.noun} 2`)];
  return one(1, hint?.trim() || "item");
}

export function renderedList(source: string): { noun: string } | undefined {
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

export function fixtureRelative(slug: string, estado: string): string {
  return `tests/fixtures/${slug}/${estado}.json`;
}

export function initialControls(controls: UiControl[]): UiControl[] {
  return controls.filter((control) => !control.conditional && !control.missingStaticText);
}

function listNoun(raw: string): string {
  const word = raw.replace(/[_$]+/g, " ").trim().split(/\s+/).pop() ?? "item";
  const stem = word.length > 2 && /s$/i.test(word) && !/ss$/i.test(word) ? word.slice(0, -1) : word;
  if (!stem) return "Item";
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

function titled(title: string, tag: "@network-mock" | "@mocked" | undefined): string {
  const base = escapeQuote(title);
  if (!tag) return base;
  if (tag === "@network-mock" && !/@network-mock\b/.test(base) && !/@mocked\b/.test(base)) {
    return `${base} @network-mock`;
  }
  if (tag === "@mocked" && !/@mocked\b/.test(base)) return `${base} @mocked`;
  return base;
}

function escapeQuote(value: string): string {
  return value.replace(/["\\]/g, "").slice(0, 80);
}

function apiGlob(routePath: string): string {
  const cleaned = routePath.startsWith("/") ? routePath : `/${routePath}`;
  return `**${cleaned}`;
}

function mutationStatus(method: string): number {
  if (method === "POST") return 201;
  if (method === "DELETE") return 204;
  return 200;
}

function hrefRegex(href: string): string {
  return `/${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`;
}

function relToFixture(testDir: string, slug: string): string {
  const from = testDir.replace(/\\/g, "/") || ".";
  const to = `tests/fixtures/${slug}`;
  let rel = path.posix.relative(from, to);
  if (!rel || rel === ".") rel = ".";
  return rel.startsWith(".") ? rel : `./${rel}`;
}

function controlNotes(controls: UiControl[]): Pick<RenderedFrontTest, "conditionalControls" | "missingStaticText"> {
  const conditionalControls = controls
    .filter((control) => control.conditional && (control.text || control.href))
    .map((control) => control.text || control.href || control.kind);
  const missingStaticText = controls
    .filter((control) => control.missingStaticText)
    .map((control) => control.kind);
  return { conditionalControls, missingStaticText };
}

function clickables(controls: UiControl[], buttons: boolean): { keep: UiControl[]; skipped: string[] } {
  const skipped: string[] = [];
  const keep: UiControl[] = [];
  for (const control of controls) {
    if (control.conditional) continue;
    if (control.kind === "link" && control.text) {
      if (isUnsafeClick(control.text)) skipped.push(control.text);
      else keep.push(control);
      continue;
    }
    if (buttons && control.kind === "button" && control.text) {
      if (isUnsafeClick(control.text)) skipped.push(control.text);
      else keep.push(control);
    }
  }
  return { keep, skipped };
}

function listLabels(payload: unknown, noun: string): string[] {
  if (!Array.isArray(payload)) return [];
  return payload.map((item, index) => {
    if (item && typeof item === "object") {
      const rec = item as Record<string, unknown>;
      if (typeof rec.title === "string") return rec.title;
      if (typeof rec.name === "string") return rec.name;
    }
    return `${noun} ${index + 1}`;
  });
}

function fixtureFiles(slug: string, sucesso: unknown, hasList: boolean): FrontFixtureFile[] {
  const files: FrontFixtureFile[] = [
    { relativePath: fixtureRelative(slug, "sucesso"), contents: `${JSON.stringify(sucesso, null, 2)}\n` },
  ];
  if (hasList) {
    files.push({ relativePath: fixtureRelative(slug, "vazio"), contents: "[]\n" });
  }
  return files;
}

function visibleLines(controls: UiControl[], pageVar: string): string[] {
  return initialControls(controls)
    .map((control) => playwrightVisible(control, pageVar))
    .filter((line): line is string => Boolean(line));
}

export function playwrightVisible(control: UiControl, pageVar = "page"): string | undefined {
  const target = pageVar;
  if (control.kind === "button" && control.text) {
    return `  await expect(${target}.getByRole("button", { name: ${JSON.stringify(control.text)} })).toBeVisible();`;
  }
  if (control.kind === "link" && control.text) {
    return `  await expect(${target}.getByRole("link", { name: ${JSON.stringify(control.text)} })).toBeVisible();`;
  }
  if (control.kind === "heading" && control.text) {
    return `  await expect(${target}.getByRole("heading", { name: ${JSON.stringify(control.text)} })).toBeVisible();`;
  }
  if (control.kind === "label" && control.text) {
    return `  await expect(${target}.getByLabel(${JSON.stringify(control.text)})).toBeVisible();`;
  }
  if (control.kind === "placeholder" && control.text) {
    return `  await expect(${target}.getByPlaceholder(${JSON.stringify(control.text)})).toBeVisible();`;
  }
  if (control.kind === "testid" && control.text) {
    return `  await expect(${target}.getByTestId(${JSON.stringify(control.text)})).toBeVisible();`;
  }
  if (control.kind === "role" && control.text) {
    const named = control.name ? `, { name: ${JSON.stringify(control.name)} }` : "";
    return `  await expect(${target}.getByRole(${JSON.stringify(control.text)}${named})).toBeVisible();`;
  }
  return undefined;
}

function screenshotLine(slug: string, estado: string, indent = "  "): string {
  return `${indent}await expect(page).toHaveScreenshot(${JSON.stringify(`${slug}-${estado}.png`)}, { animations: "disabled", fullPage: true });`;
}

function clockLine(hasClock: boolean | undefined, indent = "  "): string {
  if (hasClock === false) {
    return `${indent}// page.clock exige @playwright/test >= 1.45.`;
  }
  return `${indent}await page.clock.install({ time: new Date("2026-01-01T12:00:00Z") });`;
}

function fontsLine(indent = "  "): string {
  return `${indent}await page.evaluate(() => document.fonts.ready);`;
}

function interceptLines(routes: WebRoute[], apiPattern: string, bodyExpr: string, statusExpr: string, indent = "  "): string[] {
  const lines = [
    `${indent}await page.route(${JSON.stringify(apiPattern)}, (route) => route.fulfill({ status: 501, body: "sem mock" }));`,
  ];
  for (const route of routes) {
    const glob = apiGlob(route.path);
    const status = statusExpr === "erro" ? "500" : String(mutationStatus(route.method));
    const body = statusExpr === "erro" ? `JSON.stringify({ error: true })` : route.method === "DELETE" && statusExpr !== "erro" ? `""` : `JSON.stringify(${bodyExpr})`;
    lines.push(
      `${indent}await page.route(${JSON.stringify(glob)}, (route) => route.fulfill({ status: ${status}, contentType: "application/json", body: ${body} }));`,
    );
  }
  return lines;
}

function buildPlaywrightNetwork(
  options: FrontRenderOptions,
  slug = options.slug || slugFor(options.route, options.componentName, options.filePath),
  folder = (options.testDir ?? "e2e").replace(/\\/g, "/").replace(/\/$/, "") || "e2e",
): RenderedFrontTest {
  const controls = options.controls ?? [];
  const routes = options.sourceCode ? extractRoutes(options.sourceCode, options.filePath) : [];
  const list = options.sourceCode ? renderedList(options.sourceCode) : undefined;
  const hint = controls.find((control) => control.text)?.text;
  const sucesso = mockPayload(list, hint);
  const apiPattern = options.apiPattern?.trim() || "**/api/**";
  const gotoPath = options.route || "/";
  const { keep, skipped } = clickables(controls, true);
  const notes = [
    "A fixture em tests/fixtures é para você editar.",
    "O spec carrega a página real e intercepta só a API.",
  ];
  if (!controls.length) {
    return {
      language: "ts",
      fileName: `${slug}.spec.ts`,
      folder,
      fixtures: [],
      notes: ["Passe o arquivo da tela."],
      skippedClicks: [],
      ...controlNotes(controls),
      code: `import { test, expect } from "@playwright/test";

test(${JSON.stringify(titled(options.title, "@network-mock"))}, async () => {
  expect(false, "Passe o arquivo da tela.").toBe(true);
});
`,
    };
  }
  const fixtureRel = relToFixture(folder, slug);
  const labels = list ? listLabels(sucesso, list.noun) : [];
  const heading = initialControls(controls).find((control) => control.kind === "heading" && control.text);
  const steps = options.steps.map((step, index) => `    // ${index + 1}. ${step}`);
  const stateBlocks: string[] = [];
  stateBlocks.push(stateTest({
    name: "sucesso",
    slug,
    gotoPath,
    apiPattern,
    routes,
    bodyExpr: "sucesso",
    statusKind: "ok",
    hasClock: options.hasClock,
    visibles: [
      ...visibleLines(controls, "page").map((line) => line.replace(/^  /, "    ")),
      ...labels.map(
        (label) => `    await expect(page.getByText(${JSON.stringify(label)}, { exact: true })).toBeVisible();`,
      ),
      ...steps,
    ],
  }));
  if (list) {
    stateBlocks.push(stateTest({
      name: "vazio",
      slug,
      gotoPath,
      apiPattern,
      routes,
      bodyExpr: "vazio",
      statusKind: "ok",
      hasClock: options.hasClock,
      visibles: [
        ...(heading ? [playwrightVisible(heading, "page")?.replace(/^  /, "    ")].filter(Boolean) as string[] : []),
        ...labels.map(
          (label) => `    await expect(page.getByText(${JSON.stringify(label)}, { exact: true })).toHaveCount(0);`,
        ),
      ],
    }));
  }
  const errorVisibles = heading
    ? ([playwrightVisible(heading, "page")?.replace(/^  /, "    ")].filter(Boolean) as string[])
    : visibleLines(controls, "page").slice(0, 1).map((line) => line.replace(/^  /, "    "));
  stateBlocks.push(stateTest({
    name: "erro",
    slug,
    gotoPath,
    apiPattern,
    routes,
    bodyExpr: "sucesso",
    statusKind: "erro",
    hasClock: options.hasClock,
    visibles: errorVisibles,
  }));
  stateBlocks.push(`test.fixme("mensagem de erro visível nesta tela", async () => {
  // o texto de erro não é conhecido
});`);
  const clickBlocks = keep.map((control) => clickTest({
    control,
    slug,
    gotoPath,
    apiPattern,
    routes,
    hasClock: options.hasClock,
  }));
  const vazioImport = list
    ? `const vazio = JSON.parse(fs.readFileSync(path.join(fixtures, "vazio.json"), "utf8"));\n`
    : "";
  const code = `import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";

const fixtures = path.join(__dirname, ${JSON.stringify(fixtureRel)});
const sucesso = JSON.parse(fs.readFileSync(path.join(fixtures, "sucesso.json"), "utf8"));
${vazioImport}
test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });

${stateBlocks.join("\n\n")}
${clickBlocks.length ? `\n${clickBlocks.join("\n\n")}\n` : ""}`;
  return {
    language: "ts",
    fileName: `${slug}.spec.ts`,
    folder,
    fixtures: fixtureFiles(slug, sucesso, Boolean(list)),
    notes,
    skippedClicks: skipped,
    ...controlNotes(controls),
    code,
  };
}

function stateTest(input: {
  name: string;
  slug: string;
  gotoPath: string;
  apiPattern: string;
  routes: WebRoute[];
  bodyExpr: string;
  statusKind: "ok" | "erro";
  hasClock?: boolean;
  visibles: string[];
}): string {
  const intercepts = interceptLines(input.routes, input.apiPattern, input.bodyExpr, input.statusKind, "    ");
  return `test(${JSON.stringify(`${input.name} @network-mock`)}, async ({ page }) => {
${clockLine(input.hasClock, "    ")}
${intercepts.join("\n")}
    await page.goto(${JSON.stringify(input.gotoPath)});
${fontsLine("    ")}
${input.visibles.join("\n")}
${screenshotLine(input.slug, input.name, "    ")}
});`;
}

function clickTest(input: {
  control: UiControl;
  slug: string;
  gotoPath: string;
  apiPattern: string;
  routes: WebRoute[];
  hasClock?: boolean;
}): string {
  const intercepts = interceptLines(input.routes, input.apiPattern, "sucesso", "ok", "    ");
  const isLink = input.control.kind === "link";
  const role = isLink ? "link" : "button";
  const click = `    await page.getByRole(${JSON.stringify(role)}, { name: ${JSON.stringify(input.control.text)} }).click();`;
  const after = isLink && input.control.href
    ? `    await expect(page).toHaveURL(${hrefRegex(input.control.href)});`
    : "";
  const title = `clica em ${input.control.text} @network-mock`;
  const gap = isLink && input.control.href
    ? ""
    : `\n\ntest.fixme(${JSON.stringify(`defina o que muda na tela depois de clicar em ${input.control.text}`)}, async () => {
  // defina o que muda na tela depois de clicar em ${input.control.text}
});`;
  return `test(${JSON.stringify(title)}, async ({ page }) => {
${clockLine(input.hasClock, "    ")}
${intercepts.join("\n")}
    await page.goto(${JSON.stringify(input.gotoPath)});
${fontsLine("    ")}
${click}
${after}
});${gap}`;
}

function buildPlaywrightLive(
  options: FrontRenderOptions,
  slug: string,
  folder: string,
): RenderedFrontTest {
  const controls = options.controls ?? [];
  const { keep, skipped } = clickables(controls, false);
  const gotoPath = options.route || "/";
  const visibles = visibleLines(controls, "page");
  const steps = options.steps.map((step, index) => `    // ${index + 1}. ${step}`);
  const clickTests = keep.map((control) => {
    const after = control.href
      ? `    await expect(page).toHaveURL(${hrefRegex(control.href)});`
      : `    test.fixme(${JSON.stringify(`defina o que muda na tela depois de clicar em ${control.text}`)});`;
    return `test(${JSON.stringify(`clica em ${control.text}`)}, async ({ page }) => {
${clockLine(options.hasClock, "    ")}
    await page.goto(${JSON.stringify(gotoPath)});
${fontsLine("    ")}
    await page.getByRole("link", { name: ${JSON.stringify(control.text)} }).click();
${after}
});`;
  });
  const code = `import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });

test(${JSON.stringify(escapeQuote(options.title))}, async ({ page }) => {
${clockLine(options.hasClock, "    ")}
    await page.goto(${JSON.stringify(gotoPath)});
${fontsLine("    ")}
${steps.length ? `${steps.join("\n")}\n` : ""}${visibles.map((line) => line.replace(/^  /, "    ")).join("\n")}
${screenshotLine(slug, "live", "    ")}
});
${clickTests.length ? `\n${clickTests.join("\n\n")}\n` : ""}`;
  return {
    language: "ts",
    fileName: `${slug}.spec.ts`,
    folder,
    fixtures: [],
    notes: ["Spec contra o backend real, sem mock de rede. Sem clique em botão."],
    skippedClicks: skipped,
    ...controlNotes(controls),
    code,
  };
}

function componentPropNames(source: string | undefined, name: string): string[] {
  if (!source) return [];
  const fn = new RegExp(`function\\s+${name}\\s*\\(\\s*\\{([^}]+)\\}`).exec(source);
  const arrow = new RegExp(`(?:const|let)\\s+${name}\\s*=\\s*\\(\\s*\\{([^}]+)\\}`).exec(source);
  const raw = fn?.[1] ?? arrow?.[1];
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim().split(/[:=]/)[0]?.trim())
    .filter((part): part is string => Boolean(part) && /^[A-Za-z_$]/.test(part));
}

function specifierFrom(testDir: string, filePath: string | undefined, name: string): string {
  const to = (filePath ?? name).replace(/\\/g, "/").replace(/^\.\//, "").replace(/\.(tsx|jsx|ts|js)$/i, "");
  const from = testDir.replace(/\\/g, "/").replace(/\/$/, "") || ".";
  let rel = path.posix.relative(from, to);
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

function buildComponentSpec(options: FrontRenderOptions, slug: string, folder: string): RenderedFrontTest {
  const name = options.componentName ?? "Screen";
  const specifier = specifierFrom(folder, options.filePath, name);
  const imported =
    options.componentDefaultExport === false
      ? `import { ${name} } from ${JSON.stringify(specifier)};`
      : `import ${name} from ${JSON.stringify(specifier)};`;
  const pkg = options.ctPackage ?? "@playwright/experimental-ct-react";
  const controls = options.controls ?? [];
  const list = options.sourceCode ? renderedList(options.sourceCode) : undefined;
  const hint = controls.find((control) => control.text)?.text;
  const sucesso = mockPayload(list, hint);
  const props = componentPropNames(options.sourceCode, name);
  const prop = props[0];
  const mountWith = (expr: string) =>
    prop ? `  const component = await mount(<${name} ${prop}={${expr}} />);` : `  const component = await mount(<${name} />);`;
  const visibles = visibleLines(controls, "component");
  const labels = list ? listLabels(sucesso, list.noun) : [];
  const heading = initialControls(controls).find((control) => control.kind === "heading" && control.text);
  const fixtureRel = relToFixture(folder, slug);
  const { keep, skipped } = clickables(controls, true);
  const vazioImport = list
    ? `const vazio = JSON.parse(fs.readFileSync(path.join(fixtures, "vazio.json"), "utf8"));\n`
    : "";
  const states = [
    `test(${JSON.stringify("sucesso @network-mock")}, async ({ mount }) => {
${mountWith("sucesso")}
${visibles.join("\n")}
${labels.map((label) => `  await expect(component.getByText(${JSON.stringify(label)}, { exact: true })).toBeVisible();`).join("\n")}
});`,
  ];
  if (list) {
    states.push(`test(${JSON.stringify("vazio @network-mock")}, async ({ mount }) => {
${mountWith("vazio")}
${heading ? playwrightVisible(heading, "component") : ""}
${labels.map((label) => `  await expect(component.getByText(${JSON.stringify(label)}, { exact: true })).toHaveCount(0);`).join("\n")}
});`);
  }
  states.push(`test(${JSON.stringify("erro @network-mock")}, async ({ mount }) => {
${prop ? `  const component = await mount(<${name} ${prop}={undefined as never} />);` : `  const component = await mount(<${name} />);`}
${heading ? playwrightVisible(heading, "component") : visibles[0] ?? ""}
  test.fixme("defina a mensagem de erro visível nesta tela");
});`);
  const clicks = keep.map((control) => {
    const role = control.kind === "link" ? "link" : "button";
    const after = control.kind === "link" && control.href
      ? `  // URL: ${control.href}`
      : `  test.fixme(${JSON.stringify(`defina o que muda na tela depois de clicar em ${control.text}`)});`;
    return `test(${JSON.stringify(`clica em ${control.text} @network-mock`)}, async ({ mount }) => {
${mountWith("sucesso")}
  await component.getByRole(${JSON.stringify(role)}, { name: ${JSON.stringify(control.text)} }).click();
${after}
});`;
  });
  const code = `import fs from "node:fs";
import path from "node:path";
import { test, expect } from ${JSON.stringify(pkg)};
${imported}

const fixtures = path.join(__dirname, ${JSON.stringify(fixtureRel)});
const sucesso = JSON.parse(fs.readFileSync(path.join(fixtures, "sucesso.json"), "utf8"));
${vazioImport}
${states.join("\n\n")}
${clicks.length ? `\n${clicks.join("\n\n")}\n` : ""}`;
  return {
    language: "tsx",
    fileName: `${slug}.ct.spec.tsx`,
    folder,
    fixtures: fixtureFiles(slug, sucesso, Boolean(list)),
    notes: ["Component testing. Fixture em tests/fixtures é para você editar."],
    skippedClicks: skipped,
    ...controlNotes(controls),
    code,
  };
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

function cypressIntercepts(routes: WebRoute[], apiPattern: string, bodyExpr: string, erro: boolean): string[] {
  const lines: string[] = [];
  for (const route of routes) {
    const status = erro ? 500 : mutationStatus(route.method);
    const glob = apiGlob(route.path);
    const body = erro ? `{ error: true }` : bodyExpr;
    lines.push(
      `    cy.intercept(${JSON.stringify(route.method)}, ${JSON.stringify(glob)}, { statusCode: ${status}, body: ${body} });`,
    );
  }
  lines.push(`    cy.intercept(${JSON.stringify(apiPattern)}, { statusCode: 501, body: "sem mock" });`);
  return lines;
}

function buildCypressNetwork(options: FrontRenderOptions, slug: string, folder: string): RenderedFrontTest {
  const controls = options.controls ?? [];
  const routes = options.sourceCode ? extractRoutes(options.sourceCode, options.filePath) : [];
  const list = options.sourceCode ? renderedList(options.sourceCode) : undefined;
  const hint = controls.find((control) => control.text)?.text;
  const sucesso = mockPayload(list, hint);
  const apiPattern = options.apiPattern?.trim() || "**/api/**";
  const gotoPath = options.route || "/";
  const { keep, skipped } = clickables(controls, true);
  const visibles = initialControls(controls)
    .map((control) => cypressVisible(control))
    .filter((line): line is string => Boolean(line));
  const labels = list ? listLabels(sucesso, list.noun) : [];
  const heading = initialControls(controls).find((control) => control.kind === "heading" && control.text);
  const fixtureRel = relToFixture(folder, slug);
  const states = [
    `  it("sucesso", () => {
    const sucesso = require(${JSON.stringify(`${fixtureRel}/sucesso.json`)});
${cypressIntercepts(routes, apiPattern, "sucesso", false).join("\n")}
    cy.visit(${JSON.stringify(gotoPath)});
${visibles.join("\n")}
${labels.map((label) => `    cy.findByText(${JSON.stringify(label)}).should("be.visible");`).join("\n")}
    cy.screenshot(${JSON.stringify(`${slug}-sucesso`)});
  });`,
  ];
  if (list) {
    states.push(`  it("vazio", () => {
    const vazio = require(${JSON.stringify(`${fixtureRel}/vazio.json`)});
${cypressIntercepts(routes, apiPattern, "vazio", false).join("\n")}
    cy.visit(${JSON.stringify(gotoPath)});
${heading ? cypressVisible(heading) : ""}
${labels.map((label) => `    cy.findByText(${JSON.stringify(label)}).should("not.exist");`).join("\n")}
    cy.screenshot(${JSON.stringify(`${slug}-vazio`)});
  });`);
  }
  states.push(`  it("erro", () => {
    const sucesso = require(${JSON.stringify(`${fixtureRel}/sucesso.json`)});
${cypressIntercepts(routes, apiPattern, "sucesso", true).join("\n")}
    cy.visit(${JSON.stringify(gotoPath)});
${heading ? cypressVisible(heading) : visibles[0] ?? ""}
    // defina a mensagem de erro visível nesta tela
    cy.screenshot(${JSON.stringify(`${slug}-erro`)});
  });`);
  const clicks = keep.map((control) => {
    const role = control.kind === "link" ? "link" : "button";
    const after = control.kind === "link" && control.href
      ? `    cy.url().should("match", ${hrefRegex(control.href)});`
      : `    // defina o que muda na tela depois de clicar em ${control.text}`;
    return `  it(${JSON.stringify(`clica em ${control.text}`)}, () => {
    const sucesso = require(${JSON.stringify(`${fixtureRel}/sucesso.json`)});
${cypressIntercepts(routes, apiPattern, "sucesso", false).join("\n")}
    cy.visit(${JSON.stringify(gotoPath)});
    cy.findByRole(${JSON.stringify(role)}, { name: ${JSON.stringify(control.text)} }).click();
${after}
  });`;
  });
  const code = `describe(${JSON.stringify(titled(options.title, "@network-mock"))}, () => {
${states.join("\n\n")}
${clicks.length ? `\n${clicks.join("\n\n")}\n` : ""}
});
`;
  return {
    language: "ts",
    fileName: `${slug}.cy.ts`,
    folder,
    fixtures: fixtureFiles(slug, sucesso, Boolean(list)),
    notes: ["Cypress intercepta a API com cy.intercept. A fixture é para você editar."],
    skippedClicks: skipped,
    ...controlNotes(controls),
    code,
  };
}

function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat('${value.replace(/'/g, `', "'", '`)}')`;
}

function seleniumControl(control: UiControl, click: boolean): string | undefined {
  if (control.kind === "button" && control.text && click) {
    return `    await driver.findElement(By.xpath("//button[normalize-space()=${xpathLiteral(control.text)}]")).click();`;
  }
  if (control.kind === "heading" && control.text) {
    return `    await driver.findElement(By.xpath("//*[self::h1 or self::h2 or self::h3][normalize-space()=${xpathLiteral(control.text)}]"));`;
  }
  if (control.kind === "link" && control.text) {
    return click
      ? `    await driver.findElement(By.linkText(${JSON.stringify(control.text)})).click();`
      : `    await driver.findElement(By.linkText(${JSON.stringify(control.text)}));`;
  }
  return undefined;
}

function buildSeleniumLive(options: FrontRenderOptions, slug: string, folder: string): RenderedFrontTest {
  const controls = options.controls ?? [];
  const { keep, skipped } = clickables(controls, false);
  const origin = options.baseUrl.replace(/\/$/, "");
  const gotoPath = options.route && options.route !== "/" ? options.route : "/";
  const url = `${origin}${gotoPath.startsWith("/") ? gotoPath : `/${gotoPath}`}`;
  const visibles = initialControls(controls)
    .map((control) => seleniumControl(control, false))
    .filter((line): line is string => Boolean(line));
  const clicks = keep
    .map((control) => seleniumControl(control, true))
    .filter((line): line is string => Boolean(line));
  const runner = options.runner === "jest" ? "jest" : "vitest";
  const from = runner === "jest" ? "@jest/globals" : "vitest";
  const code = `import { Builder, Browser, By, until } from "selenium-webdriver";
import { describe, it, afterEach } from "${from}";

describe(${JSON.stringify(escapeQuote(options.title))}, () => {
  let driver: Awaited<ReturnType<Builder["build"]>>;

  afterEach(async () => {
    await driver?.quit();
  });

  it("completa o fluxo", async () => {
    driver = await new Builder().forBrowser(Browser.CHROME).build();
    await driver.get(${JSON.stringify(url)});
${visibles.join("\n")}
${clicks.join("\n")}
    await driver.wait(until.urlContains(""), 5000);
  });
});
`;
  return {
    language: "ts",
    fileName: `${slug}.selenium.spec.ts`,
    folder,
    fixtures: [],
    notes: ["Selenium não intercepta a rede de forma simples. Spec live, sem mock de API."],
    skippedClicks: skipped,
    ...controlNotes(controls),
    code,
  };
}

export function nodeModuleExists(projectRoot: string | undefined, ...parts: string[]): boolean {
  if (!projectRoot) return false;
  return fs.existsSync(path.join(projectRoot, "node_modules", ...parts, "package.json"));
}

export function playwrightClockSupported(projectRoot?: string): boolean {
  if (!projectRoot) return true;
  const pkgPath = path.join(projectRoot, "node_modules", "@playwright", "test", "package.json");
  try {
    if (!fs.existsSync(pkgPath)) return true;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: string };
    const version = pkg.version ?? "";
    const [maj, min] = version.replace(/^v/, "").split(".").map((part) => Number(part));
    if (!Number.isFinite(maj)) return true;
    if (maj > 1) return true;
    if (maj === 1 && (min ?? 0) >= 45) return true;
    return false;
  } catch {
    return true;
  }
}

export function readPlaywrightMeta(
  projectRoot: string | undefined,
  ct = false,
): { testDir: string; hasWebServer: boolean; configFile?: string; text?: string } {
  const names = ct
    ? ["playwright-ct.config.ts", "playwright-ct.config.js", "playwright-ct.config.mjs"]
    : ["playwright.config.ts", "playwright.config.js", "playwright.config.mjs"];
  if (!projectRoot) return { testDir: ct ? "e2e" : "e2e", hasWebServer: false };
  for (const name of names) {
    const full = path.join(projectRoot, name);
    try {
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
      const text = fs.readFileSync(full, "utf8");
      const testDir = text.match(/testDir\s*:\s*["'`]([^"'`]+)["'`]/)?.[1];
      return {
        testDir: (testDir ?? (ct ? "e2e" : "e2e")).replace(/\\/g, "/").replace(/\/$/, "") || "e2e",
        hasWebServer: /webServer\s*:/.test(text),
        configFile: name,
        text,
      };
    } catch {
      continue;
    }
  }
  return { testDir: "e2e", hasWebServer: false };
}

export function readDevScript(projectRoot?: string): string {
  if (!projectRoot) return "npm run dev";
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    if (pkg.scripts?.dev) return "npm run dev";
    if (pkg.scripts?.start) return "npm start";
  } catch {
    /* manifesto ilegível */
  }
  return "npm run dev";
}

export function webServerSnippet(projectRoot?: string): string {
  const command = readDevScript(projectRoot);
  return `webServer: {
    command: ${JSON.stringify(command)},
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
  }`;
}
