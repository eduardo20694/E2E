/** Marcadores que o runner realmente tem. Vitest não tem test.fixme. Jest não tem test.fixme nem expect.fail. */

export type MarkerRunner = "playwright" | "vitest" | "jest";

/**
 * Lacuna: o teste não roda.
 * Playwright usa test.fixme com callback. Vitest e Jest usam test.todo só com a descrição, sem função.
 * O rascunho fica comentado na linha de baixo.
 */
export function gapTest(runner: MarkerRunner, title: string, comment: string): string {
  const quoted = JSON.stringify(title);
  if (runner === "playwright") {
    return `  test.fixme(${quoted}, async () => {\n    // ${comment}\n  });`;
  }
  return `  test.todo(${quoted});\n  // ${comment}`;
}

/** Corpo opaco. Vitest: expect.fail. Jest, Playwright e runner desconhecido: throw new Error. */
export function opaqueStatement(runner: MarkerRunner | "unknown", message: string): string {
  const quoted = JSON.stringify(message);
  if (runner === "vitest") return `expect.fail(${quoted});`;
  return `throw new Error(${quoted});`;
}

/** Corpo opaco em pytest. O teste roda e falha com esta mensagem. */
export function pytestFail(message: string): string {
  return `pytest.fail(${JSON.stringify(message)})`;
}

/**
 * Lacuna em pytest. @pytest.mark.skip na função, sem xfail e sem corpo que falha por outro motivo.
 * O rascunho fica só no comentário.
 */
export function pytestSkip(signature: string, reason: string): string {
  return `@pytest.mark.skip(reason=${JSON.stringify(reason)})\n${signature}\n    # ${reason}\n    pass`;
}

export function jsImport(runner: "vitest" | "jest", names: string[]): string {
  const from = runner === "jest" ? "@jest/globals" : "vitest";
  return `import { ${names.join(", ")} } from "${from}";`;
}

export function markerName(runner: MarkerRunner): string {
  return runner === "playwright" ? "test.fixme" : "test.todo";
}
