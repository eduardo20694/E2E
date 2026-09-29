import fs from "node:fs";
import path from "node:path";

export interface PyramidCounts {
  unit: number;
  integration: number;
  e2e: number;
  files: { unit: string[]; integration: string[]; e2e: string[] };
}

const SKIP = new Set([
  "node_modules",
  "dist",
  ".git",
  "coverage",
  "vendor",
  "venv",
  ".venv",
  "target",
  "build",
  ".next",
  ".turbo",
]);

const TEST_FILE = /\.(test|spec)\.(tsx?|jsx?|py|java|rb|go)$|(_test\.go|Test\.php|\.feature)$/i;

export function scanPyramid(projectRoot: string, maxDepth = 6): PyramidCounts {
  const root = path.resolve(projectRoot);
  const counts: PyramidCounts = {
    unit: 0,
    integration: 0,
    e2e: 0,
    files: { unit: [], integration: [], e2e: [] },
  };

  if (!fs.existsSync(root)) {
    throw new Error(`Diretório inexistente: ${root}`);
  }

  walk(root, root, 0, maxDepth, counts);
  return counts;
}

function walk(root: string, current: string, depth: number, maxDepth: number, counts: PyramidCounts): void {
  if (depth > maxDepth) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      walk(root, full, depth + 1, maxDepth, counts);
      continue;
    }
    if (!entry.isFile() || !TEST_FILE.test(entry.name)) continue;

    const relative = path.relative(root, full).split(path.sep).join("/");
    const bucket = classify(relative);
    counts[bucket] += 1;
    if (counts.files[bucket].length < 20) counts.files[bucket].push(relative);
  }
}

function classify(relative: string): "unit" | "integration" | "e2e" {
  const value = relative.toLowerCase();
  if (/e2e|cypress|playwright|selenium|acceptance|features\/.+\\.feature/.test(value) || value.endsWith(".feature")) {
    return "e2e";
  }
  if (/integration|contract|testcontainers|api[-_].*spec|supertest/.test(value)) return "integration";
  return "unit";
}

export function pyramidBalance(counts: Pick<PyramidCounts, "unit" | "integration" | "e2e">): {
  total: number;
  shares: { unit: number; integration: number; e2e: number };
  ideal: { unit: number; integration: number; e2e: number };
  advice: string[];
} {
  const total = counts.unit + counts.integration + counts.e2e;
  const share = (value: number) => (total === 0 ? 0 : Math.round((value / total) * 100));
  const shares = {
    unit: share(counts.unit),
    integration: share(counts.integration),
    e2e: share(counts.e2e),
  };
  const advice: string[] = [];
  if (total === 0) {
    advice.push("Nenhum arquivo de teste encontrado. Comece pela base: testes unitários da regra de negócio.");
  } else {
    if (shares.e2e > 30) {
      advice.push("A ponta E2E está pesada. Desça verificações de regra para unitário e de contrato para integração.");
    }
    if (shares.unit < 50 && total > 5) {
      advice.push("A base unitária está fina para uma pirâmide clássica (cerca de 70%).");
    }
    if (shares.integration === 0 && total > 3) {
      advice.push("Não há faixa de integração/contrato. APIs e banco ficam descobertos entre o unitário e o E2E.");
    }
    if (advice.length === 0) {
      advice.push("A distribuição está próxima da pirâmide 70/20/10. Mantenha E2E só nos fluxos de maior risco.");
    }
  }
  return {
    total,
    shares,
    ideal: { unit: 70, integration: 20, e2e: 10 },
    advice,
  };
}
