import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectStack, stackSummary } from "../lib/detect.js";
import { doc, markdownTable } from "../lib/format.js";
import { citeKnowledge } from "../lib/knowledge.js";
import { registerTool } from "../lib/register-tool.js";
import { errorResult, textResult, type ToolTextResult } from "../lib/result.js";
import type { ProjectContextInput } from "../lib/schema.js";

export interface DisasterInput extends ProjectContextInput {
  system?: string;
  rpoMinutes?: number;
  rtoMinutes?: number;
}

export function setupDisasterRecoveryTest(input: DisasterInput): ToolTextResult {
  const stack = detectStack(input.projectRoot);
  const system = input.system ?? "banco principal";
  const rpo = input.rpoMinutes ?? 15;
  const rto = input.rtoMinutes ?? 60;

  return textResult(
    doc([
      `# Simulado de recuperação — ${system}`,
      "O restore é real, contra uma réplica ou uma região de ensaio. Não é mock do backup e não é o primeiro ensaio em cima do tráfego de cliente.",
      "## Stack detectada",
      stackSummary(stack),
      markdownTable(
        ["Passo", "O que prova"],
        [
          ["Congelar um backup com hora conhecida", `RPO de ${rpo} min: o dado restaurado não pode ser mais velho que isso`],
          [`Restaurar ${system} num ambiente vazio`, `RTO de ${rto} min: do início ao serviço aceitando smoke`],
          ["Rodar o smoke sintético na cópia", "A aplicação sobe, não só o arquivo de backup existe"],
          ["Anotar o que faltou (segredo, DNS, fila)", "O plano escrito mente se o ensaio não anotar o buraco"],
        ],
      ),
      "Blast radius: uma cópia. Abortar se alguém apontar o ensaio para o banco que serve o cliente. Permissão de quem opera produção, com janela.",
      "Shift-left não vê região caída. Este ensaio também não substitui o teste de regra no pull request.",
      citeKnowledge(["disaster-recovery-testing", "shift-right"]),
    ]),
  );
}

const FRAMEWORKS = [
  {
    id: "LGPD",
    pattern: /lgpd|brasil|pessoais|cpf/i,
    items: [
      "Base legal registrada para o dado usado em teste.",
      "Dado de pessoa em teste é sintético ou tokenizado.",
      "Há registro de quem acessa o ambiente que ainda tem dado real.",
    ],
  },
  {
    id: "GDPR",
    pattern: /gdpr|europa|eu\b|personal data/i,
    items: [
      "Finalidade do tratamento cabe no teste, não num dump indefinido.",
      "Direito de apagar chega no ambiente de teste se ele guardou identificador.",
      "Transferência para fora da região do teste está descrita.",
    ],
  },
  {
    id: "PCI-DSS",
    pattern: /pci|cartao|cartão|pan\b|pagamento|cardholder/i,
    items: [
      "PAN completo não aparece em log, fixture nem snapshot.",
      "Ambiente de teste de pagamento usa cartão de teste do adquirente, não cartão real.",
      "Acesso ao componente de cartão é separado do resto da suíte.",
    ],
  },
  {
    id: "HIPAA",
    pattern: /hipaa|saúde|saude|paciente|phi|prontuario|prontuário/i,
    items: [
      "Prontuário não vai para fixture de desenvolvedor.",
      "O ensaio usa dado sintético de paciente.",
      "Acesso ao ambiente é nominal e auditável.",
    ],
  },
] as const;

export interface ComplianceInput extends ProjectContextInput {
  context?: string;
  frameworks?: Array<"LGPD" | "GDPR" | "PCI-DSS" | "HIPAA">;
}

export function suggestComplianceChecklist(input: ComplianceInput): ToolTextResult {
  const blob = `${input.context ?? ""} ${input.sourceCode ?? ""} ${(input.frameworks ?? []).join(" ")}`;
  if (!blob.trim()) {
    return errorResult("suggest_compliance_checklist exige context, frameworks ou sourceCode.");
  }

  const chosen = FRAMEWORKS.filter(
    (item) => input.frameworks?.includes(item.id) || item.pattern.test(blob),
  );
  const list = chosen.length ? chosen : FRAMEWORKS.filter((item) => item.id === "LGPD" || item.id === "GDPR");

  return textResult(
    doc([
      "# Checklist de compliance para teste",
      "Isto é roteiro de verificação do ambiente de teste, não parecer jurídico.",
      ...list.flatMap((item) => [`## ${item.id}`, ...item.items.map((line) => `- ${line}`)]),
      citeKnowledge(["compliance-testing", "test-data-management"]),
    ]),
  );
}

export function registerDisasterTools(server: McpServer): void {
  registerTool(
    server,
    "setup_disaster_recovery_test",
    "Teste de disaster recovery",
    "Desenha um ensaio de restore com RPO e RTO, numa cópia, sem apontar o ensaio para o tráfego de cliente.",
    {
      system: z.string().optional(),
      rpoMinutes: z.number().positive().optional(),
      rtoMinutes: z.number().positive().optional(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
    },
    (args) => setupDisasterRecoveryTest(args as unknown as DisasterInput),
  );

  registerTool(
    server,
    "suggest_compliance_checklist",
    "Checklist de compliance",
    "Monta checagens de LGPD, GDPR, PCI-DSS ou HIPAA aplicadas ao uso de dado no teste.",
    {
      context: z.string().optional(),
      frameworks: z.array(z.enum(["LGPD", "GDPR", "PCI-DSS", "HIPAA"])).optional(),
      projectRoot: z.string().optional(),
      filePath: z.string().optional(),
      sourceCode: z.string().optional(),
    },
    (args) => suggestComplianceChecklist(args as unknown as ComplianceInput),
  );
}
