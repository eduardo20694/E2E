export interface BoundaryCase {
  value: number;
  expectation: "válido" | "inválido";
  reason: string;
}

export interface EquivalenceClass {
  name: string;
  valid: boolean;
  representatives: string[];
}

export interface DecisionCondition {
  name: string;
  values: string[];
}

export interface DecisionRule {
  when: Record<string, string>;
  then: string[];
}

export interface Transition {
  from: string;
  event: string;
  to: string;
  guard?: string;
}

export function parseBounds(rule: string): { min?: number; max?: number } {
  const between =
    rule.match(/entre\s+(-?\d+(?:\.\d+)?)\s+e\s+(-?\d+(?:\.\d+)?)/i) ??
    rule.match(/(-?\d+(?:\.\d+)?)\s*(?:até|to|a|-|–)\s*(-?\d+(?:\.\d+)?)/i) ??
    rule.match(/min(?:imo|imum)?\s*[:=]?\s*(-?\d+(?:\.\d+)?)\D+max(?:imo|imum)?\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i);

  if (!between) return {};
  return { min: Number(between[1]), max: Number(between[2]) };
}

export function boundaryCases(min: number, max: number): BoundaryCase[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error("min e max precisam ser números finitos.");
  }
  if (min > max) throw new Error("min não pode ser maior que max.");

  const step = Number.isInteger(min) && Number.isInteger(max) ? 1 : (max - min) / 10 || 0.1;
  const nominal = min + (max - min) / 2;
  const raw: BoundaryCase[] = [
    { value: min - step, expectation: "inválido", reason: "logo abaixo do mínimo" },
    { value: min, expectation: "válido", reason: "limite inferior inclusivo" },
    { value: round(min + step), expectation: "válido", reason: "logo acima do mínimo" },
    { value: round(nominal), expectation: "válido", reason: "valor nominal da partição válida" },
    { value: round(max - step), expectation: "válido", reason: "logo abaixo do máximo" },
    { value: max, expectation: "válido", reason: "limite superior inclusivo" },
    { value: round(max + step), expectation: "inválido", reason: "logo acima do máximo" },
  ];

  const seen = new Set<number>();
  return raw.filter((item) => {
    if (seen.has(item.value)) return false;
    seen.add(item.value);
    return true;
  });
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function inferEquivalenceClasses(domain: string): EquivalenceClass[] {
  const bounds = parseBounds(domain);
  if (bounds.min !== undefined && bounds.max !== undefined) {
    return [
      {
        name: `dentro de [${bounds.min}, ${bounds.max}]`,
        valid: true,
        representatives: [String(bounds.min), String((bounds.min + bounds.max) / 2), String(bounds.max)],
      },
      {
        name: `abaixo de ${bounds.min}`,
        valid: false,
        representatives: [String(bounds.min - 1)],
      },
      {
        name: `acima de ${bounds.max}`,
        valid: false,
        representatives: [String(bounds.max + 1)],
      },
    ];
  }

  const chunks = domain
    .split(/[;\n]|(?:\s+ou\s+)|(?:\s+or\s+)/i)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 1)
    .slice(0, 8);

  if (chunks.length >= 2) {
    return chunks.map((chunk, index) => ({
      name: chunk,
      valid: index === 0,
      representatives: [chunk],
    }));
  }

  return [
    { name: "entrada bem formada do domínio", valid: true, representatives: ["valor representativo válido"] },
    { name: "vazio ou ausente", valid: false, representatives: ["", "null"] },
    { name: "formato inválido", valid: false, representatives: ["???"] },
  ];
}

export function decisionTable(
  conditions: DecisionCondition[],
  rules?: DecisionRule[],
): Array<Record<string, string>> {
  if (conditions.length === 0) throw new Error("Informe ao menos uma condição.");
  if (conditions.some((condition) => condition.values.length === 0)) {
    throw new Error("Cada condição precisa de ao menos um valor.");
  }

  const combinations: Array<Record<string, string>> = [];
  const walk = (index: number, current: Record<string, string>): void => {
    if (combinations.length >= 64) return;
    if (index === conditions.length) {
      combinations.push({ ...current });
      return;
    }
    for (const value of conditions[index].values) {
      current[conditions[index].name] = value;
      walk(index + 1, current);
    }
  };
  walk(0, {});

  return combinations.map((combination) => {
    const matched = rules?.find((rule) =>
      Object.entries(rule.when).every(([key, value]) => combination[key] === value),
    );
    return {
      ...combination,
      acoes: matched ? matched.then.join("; ") : "a definir",
    };
  });
}

const ARROW = /\s*(?:→|->|—>)\s*/;

export function parseDiagram(diagram: string): Transition[] {
  const transitions: Transition[] = [];
  const chunks = diagram.split(/[;\n]+/).map((chunk) => chunk.trim()).filter(Boolean);

  for (const chunk of chunks) {
    // Forma com evento explícito: "criado - pagar -> pago".
    // Não pode casar a seta "->" , senão o estado do meio vira evento.
    const labeled = chunk.match(/^([^>-]+?)\s-\s+([^>]+?)\s*(?:→|->|—>)\s*([^>]+)$/);
    if (labeled) {
      transitions.push({
        from: cleanState(labeled[1]),
        event: cleanState(labeled[2]),
        to: cleanState(labeled[3]),
      });
      continue;
    }

    // Cadeia de estados: "criado -> pago -> enviado".
    const parts = chunk.split(ARROW).map(cleanState).filter(Boolean);
    for (let index = 0; index < parts.length - 1; index++) {
      transitions.push({
        from: parts[index],
        event: "avançar",
        to: parts[index + 1],
      });
    }
  }

  return transitions;
}

function cleanState(value: string): string {
  return value.replace(/^\[|\]$/g, "").trim();
}

export function collectStates(transitions: Transition[], explicit: string[] = []): string[] {
  const states: string[] = [];
  for (const state of [...explicit, ...transitions.flatMap((item) => [item.from, item.to])]) {
    if (state && !states.includes(state)) states.push(state);
  }
  return states;
}
