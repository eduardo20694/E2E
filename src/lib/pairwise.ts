export interface Parameter {
  name: string;
  values: string[];
}

export interface PairwiseResult {
  rows: Array<Record<string, string>>;
  pairCount: number;
  covered: number;
}

function pairKey(leftIndex: number, leftValue: string, rightIndex: number, rightValue: string): string {
  return JSON.stringify([leftIndex, leftValue, rightIndex, rightValue]);
}

function scoreChoice(
  parameters: Parameter[],
  partial: Record<string, string>,
  index: number,
  value: string,
  uncovered: Set<string>,
): number {
  let score = 0;
  for (let other = 0; other < parameters.length; other++) {
    if (other === index) continue;
    const otherName = parameters[other].name;
    if (otherName in partial) {
      const left = Math.min(index, other);
      const right = Math.max(index, other);
      const leftValue = index < other ? value : partial[otherName];
      const rightValue = index < other ? partial[otherName] : value;
      if (uncovered.has(pairKey(left, leftValue, right, rightValue))) score += 1;
    } else {
      for (const candidate of parameters[other].values) {
        const left = Math.min(index, other);
        const right = Math.max(index, other);
        const leftValue = index < other ? value : candidate;
        const rightValue = index < other ? candidate : value;
        if (uncovered.has(pairKey(left, leftValue, right, rightValue))) score += 0.01;
      }
    }
  }
  return score;
}

function rowCovers(parameters: Parameter[], row: Record<string, string>, key: string): boolean {
  const [left, leftValue, right, rightValue] = JSON.parse(key) as [number, string, number, string];
  return row[parameters[left].name] === leftValue && row[parameters[right].name] === rightValue;
}

/**
 * Cobrimento pairwise guloso. Cada par de valores de fatores diferentes
 * aparece em pelo menos uma linha, sem o produto cartesiano completo.
 */
export function generatePairwise(parameters: Parameter[]): PairwiseResult {
  if (parameters.length === 0) return { rows: [], pairCount: 0, covered: 0 };
  if (parameters.some((parameter) => parameter.values.length === 0)) {
    throw new Error("Cada parâmetro precisa de ao menos um valor.");
  }
  if (new Set(parameters.map((parameter) => parameter.name)).size !== parameters.length) {
    throw new Error("Os nomes dos parâmetros precisam ser únicos.");
  }

  if (parameters.length === 1) {
    return {
      rows: parameters[0].values.map((value) => ({ [parameters[0].name]: value })),
      pairCount: 0,
      covered: 0,
    };
  }

  const uncovered = new Set<string>();
  for (let left = 0; left < parameters.length; left++) {
    for (let right = left + 1; right < parameters.length; right++) {
      for (const leftValue of parameters[left].values) {
        for (const rightValue of parameters[right].values) {
          uncovered.add(pairKey(left, leftValue, right, rightValue));
        }
      }
    }
  }

  const pairCount = uncovered.size;
  const rows: Array<Record<string, string>> = [];

  while (uncovered.size > 0 && rows.length < pairCount) {
    const row: Record<string, string> = {};
    for (let index = 0; index < parameters.length; index++) {
      let bestValue = parameters[index].values[0];
      let bestScore = -1;
      for (const value of parameters[index].values) {
        const score = scoreChoice(parameters, row, index, value, uncovered);
        if (score > bestScore) {
          bestScore = score;
          bestValue = value;
        }
      }
      row[parameters[index].name] = bestValue;
    }

    let newlyCovered = 0;
    for (const key of [...uncovered]) {
      if (rowCovers(parameters, row, key)) {
        uncovered.delete(key);
        newlyCovered += 1;
      }
    }
    rows.push(row);
    if (newlyCovered === 0) break;
  }

  return { rows, pairCount, covered: pairCount - uncovered.size };
}
