export interface FlakySignal {
  id: string;
  title: string;
  evidence: string[];
  advice: string;
}

const SIGNALS: Array<{ id: string; title: string; pattern: RegExp; advice: string }> = [
  {
    id: "timing",
    title: "Dependência de tempo",
    pattern: /timeout|timed out|sleep|waitfor|settimeout|flake|race condition|animation/i,
    advice:
      "Troque sleeps fixos por espera de condição (locator, resposta de rede ou estado observável). Aumentar o timeout esconde a causa.",
  },
  {
    id: "selector",
    title: "Seletor frágil",
    pattern: /selector|locator|element not found|unable to locate|stale element|detached from dom|css=|xpath=/i,
    advice:
      "Prefira papel acessível ou data-testid estável. Evite XPath absoluto e classes geradas pelo CSS-in-JS.",
  },
  {
    id: "data",
    title: "Dados não isolados",
    pattern: /unique constraint|duplicate key|already exists|deadlock|fixture|foreign key| leftover/i,
    advice:
      "Cada teste deve criar e apagar os próprios dados, ou rodar dentro de transação revertida. Não dependa da ordem da suíte.",
  },
  {
    id: "network",
    title: "Rede ou serviço instável",
    pattern: /econnreset|econnrefused|socket hang up|etimedout|503|502|504|fetch failed/i,
    advice:
      "Isole dependências externas com stub ou Testcontainers. Falha de rede intermitente não deve falhar teste de regra de negócio.",
  },
  {
    id: "clock",
    title: "Relógio ou fuso",
    pattern: /timezone|date\.now|new date|midnight|locale|invalid time/i,
    advice:
      "Congele o relógio e fixe o fuso (UTC) no teste. Evite afirmar 'hoje' sem controlar o instante.",
  },
  {
    id: "order",
    title: "Estado compartilhado ou ordem",
    pattern: /beforeall|shared state|depends on|order of execution|leaked|not cleaned/i,
    advice:
      "Mova setup para beforeEach e limpe singletons, caches e módulos mockados depois de cada caso.",
  },
  {
    id: "random",
    title: "Aleatoriedade sem semente",
    pattern: /math\.random|uuid|faker|crypto\.random/i,
    advice:
      "Fixe a semente ou injete o gerador. Asserções não podem depender de um valor que muda a cada execução.",
  },
  {
    id: "retry",
    title: "Retry mascarando falha",
    pattern: /retry|retries|attempt \d+|flaky/i,
    advice:
      "Retry no CI é contenção, não correção. O caso que só passa na segunda tentativa continua instável.",
  },
];

export function analyzeFlakiness(logs: string): FlakySignal[] {
  const lines = logs.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return SIGNALS.flatMap((signal) => {
    const evidence = lines.filter((line) => signal.pattern.test(line)).slice(0, 5);
    if (evidence.length === 0 && !signal.pattern.test(logs)) return [];
    return [
      {
        id: signal.id,
        title: signal.title,
        evidence: evidence.length > 0 ? evidence : ["Padrão encontrado no texto informado."],
        advice: signal.advice,
      },
    ];
  });
}
