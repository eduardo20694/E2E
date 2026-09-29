export interface CoverageGap {
  file: string;
  uncoveredLines: number[];
  coveredLines: number;
  reason: string;
}

const RISK_PATTERN =
  /auth|login|password|token|session|payment|checkout|billing|permission|admin|delete|crypto|sql|upload/i;

export function parseCoverage(report: string): CoverageGap[] {
  const trimmed = report.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseJsonCoverage(trimmed);
  }
  if (trimmed.includes("SF:") || trimmed.includes("end_of_record")) {
    return parseLcov(trimmed);
  }
  return parseTextCoverage(trimmed);
}

function parseLcov(report: string): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  for (const record of report.split("end_of_record")) {
    const file = record.match(/^SF:(.+)$/m)?.[1]?.trim();
    if (!file) continue;
    const uncovered: number[] = [];
    let covered = 0;
    for (const match of record.matchAll(/^DA:(\d+),(\d+)/gm)) {
      if (match[2] === "0") uncovered.push(Number(match[1]));
      else covered += 1;
    }
    if (uncovered.length === 0 && covered === 0) continue;
    gaps.push({
      file,
      uncoveredLines: uncovered.slice(0, 30),
      coveredLines: covered,
      reason: reasonFor(file, uncovered.length, covered),
    });
  }
  return gaps;
}

function parseJsonCoverage(report: string): CoverageGap[] {
  const data = JSON.parse(report) as unknown;
  const files = Array.isArray(data)
    ? data
    : data && typeof data === "object" && "files" in data
      ? (data as { files: unknown[] }).files
      : [];

  return files.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as {
      path?: string;
      file?: string;
      uncovered?: number[];
      uncoveredLines?: number[];
      pct?: number;
    };
    const file = record.path ?? record.file;
    if (!file) return [];
    const uncovered = record.uncovered ?? record.uncoveredLines ?? [];
    return [
      {
        file,
        uncoveredLines: uncovered.slice(0, 30),
        coveredLines: 0,
        reason: reasonFor(file, uncovered.length, record.pct ?? 0),
      },
    ];
  });
}

function parseTextCoverage(report: string): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  for (const line of report.split(/\r?\n/)) {
    const match = line.match(/(\S+\.\w+).{0,40}?(\d+(?:\.\d+)?)%/);
    if (!match) continue;
    const pct = Number(match[2]);
    gaps.push({
      file: match[1],
      uncoveredLines: [],
      coveredLines: 0,
      reason: pct < 80 ? `cobertura ${pct}% abaixo do piso usual de 80%` : `cobertura ${pct}%`,
    });
  }
  return gaps;
}

function reasonFor(file: string, uncovered: number, covered: number | string): string {
  const risky = RISK_PATTERN.test(file);
  if (risky && uncovered > 0) {
    return "arquivo de risco (auth, pagamento, permissão ou dados) com linhas sem execução";
  }
  if (uncovered > 0 && Number(covered) === 0) return "arquivo sem linhas executadas no relatório";
  if (uncovered > 10) return "muitas linhas sem execução";
  if (uncovered > 0) return "há linhas descobertas";
  return "coberto no relatório informado";
}

export function isRiskyPath(file: string): boolean {
  return RISK_PATTERN.test(file);
}
