import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Prompts reutilizáveis. No Cursor eles aparecem pelo nome
 * (`/e2e-review-test`, `/e2e-plan-feature`, `/e2e-audit-suite`, `/e2e-production-readiness`,
 * `/e2e-legacy-code-safety-net`, `/e2e-ml-test-plan`, `/e2e-pipeline-audit`, `/e2e-automation-roi-check`).
 * Dois-pontos não entram no nome: o identificador MCP e o Windows rejeitam esse caractere.
 */
export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "e2e-review-test",
    {
      title: "Revisar teste",
      description:
        "Revisa um teste existente e aponta instabilidade, assert fraco e cobertura rasa. Use com /e2e-review-test.",
      argsSchema: {
        code: z.string().describe("Código do teste a revisar."),
        filePath: z.string().optional().describe("Caminho do arquivo, se houver."),
      },
    },
    ({ code, filePath }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Revise o teste abaixo como especialista de qualidade.",
              "Aponte, com trecho e correção sugerida:",
              "- assert que não confere o resultado de negócio",
              "- sleep, seletor frágil, dado compartilhado, relógio ou rede real sem isolamento",
              "- caso feliz sem o caso inválido correspondente, se a regra tiver borda",
              "- o que falta para o teste falhar se a regra quebrar",
              filePath ? `Arquivo: ${filePath}` : undefined,
              "Consulte as resources e2e://knowledge/unit-testing, e2e://knowledge/e2e-testing e e2e://knowledge/qa-metrics se precisar de critério.",
              "",
              code,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "e2e-plan-feature",
    {
      title: "Planejar testes da feature",
      description:
        "Gera um plano de testes da feature, do mock ao que roda em produção depois do deploy. Use com /e2e-plan-feature.",
      argsSchema: {
        requirement: z.string().describe("Requisito ou história."),
        projectRoot: z.string().optional().describe("Raiz do projeto aberto no Cursor."),
      },
    },
    ({ requirement, projectRoot }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Monte um plano de testes para o requisito abaixo.",
              "Cubra as camadas que o risco pede, separando o que é mockado, o que roda em ambiente real isolado, o que roda em staging e o que roda de verdade em produção depois do deploy.",
              "Inclua smoke sintético, canário ou flag se o risco chegar em produção. Diga que shift-left não substitui shift-right.",
              "Use as tools do servidor E2E (generate_test_plan, generate_gherkin_scenario, environment_strategy_advisor, generate_smoke_test_prod) quando forem produzir o artefato.",
              projectRoot ? `projectRoot: ${projectRoot}` : "Peça o projectRoot se for preciso detectar a stack.",
              "Resources: e2e://knowledge/shift-left, e2e://knowledge/shift-right e e2e://knowledge/test-environments.",
              "",
              requirement,
            ]
              .filter((line) => line !== undefined)
              .join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "e2e-audit-suite",
    {
      title: "Auditar suíte",
      description:
        "Diagnostica a suíte: pirâmide, lacunas e se há shift-right configurado. Use com /e2e-audit-suite.",
      argsSchema: {
        projectRoot: z.string().describe("Raiz do projeto a auditar."),
        notes: z.string().optional().describe("Contexto extra: dor atual, flakiness, cobertura."),
      },
    },
    ({ projectRoot, notes }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Audite a suíte de testes deste projeto e diga se existe estratégia de shift-right.",
              `projectRoot: ${projectRoot}`,
              "Chame suggest_test_pyramid_balance e environment_strategy_advisor com esse projectRoot.",
              "Procure CI, Kubernetes, feature flag e synthetic na stack detectada. Se não houver, diga que shift-right não está configurado.",
              "Se houver relatório de cobertura ou log de falha no contexto, chame code_coverage_advisor e flakiness_analyzer.",
              "Devolva: contagem por camada, desvio da referência 70/20/10, lacunas e três ações em ordem.",
              "Não invente arquivos que a tool não listou.",
              notes ? `Notas: ${notes}` : undefined,
              "Resources: e2e://knowledge/qa-metrics e e2e://knowledge/shift-right.",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "e2e-production-readiness",
    {
      title: "Prontidão para produção",
      description:
        "Checklist antes do deploy: smoke, canário, sintético e rollback. Use com /e2e-production-readiness.",
      argsSchema: {
        change: z.string().describe("O que vai para produção."),
        projectRoot: z.string().optional(),
      },
    },
    ({ change, projectRoot }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Faça o checklist de prontidão para produção da mudança abaixo.",
              "Responda sim ou não, com a evidência, para:",
              "- smoke de produção pronto, com conta sintética e sem efeito colateral",
              "- canário com métrica de rollback",
              "- monitoramento sintético da jornada crítica",
              "- plano de rollback com dono",
              "Use generate_smoke_test_prod, setup_canary_release, setup_synthetic_monitoring e environment_strategy_advisor.",
              "Deixe claro o que roda de verdade em produção e o que isso não substitui no shift-left.",
              projectRoot ? `projectRoot: ${projectRoot}` : undefined,
              "Resource: e2e://knowledge/shift-right.",
              "",
              change,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "e2e-legacy-code-safety-net",
    {
      title: "Rede de segurança do legado",
      description: "Gera golden master antes de refatorar código sem teste. Use com /e2e-legacy-code-safety-net.",
      argsSchema: {
        code: z.string().describe("Código legado."),
        entrypoint: z.string().optional(),
      },
    },
    ({ code, entrypoint }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Antes de refatorar, monte a rede de segurança deste código legado.",
              "Chame generate_golden_master_test. Não proponha mudança de comportamento no mesmo passo.",
              entrypoint ? `Ponto de entrada: ${entrypoint}` : undefined,
              "Resource: e2e://knowledge/golden-master-testing.",
              "",
              code,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "e2e-ml-test-plan",
    {
      title: "Plano de teste de ML",
      description: "Plano de teste para feature de modelo ou prompt. Use com /e2e-ml-test-plan.",
      argsSchema: {
        feature: z.string(),
        projectRoot: z.string().optional(),
      },
    },
    ({ feature, projectRoot }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Monte o plano de teste desta feature de IA ou ML.",
              "Cubra métrica, fatias, drift, fallback do sistema e, se houver experimento, o desenho A/B.",
              "Use suggest_model_testing_plan e, se a feature for prompt, generate_llm_prompt_test.",
              projectRoot ? `projectRoot: ${projectRoot}` : undefined,
              "Resource: e2e://knowledge/ai-ml-testing.",
              "",
              feature,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "e2e-pipeline-audit",
    {
      title: "Auditoria do pipeline",
      description: "Olha o CI e sugere impacto, paralelismo e quarentena. Use com /e2e-pipeline-audit.",
      argsSchema: {
        projectRoot: z.string(),
        changedFiles: z.string().optional().describe("Arquivos alterados, um por linha."),
      },
    },
    ({ projectRoot, changedFiles }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Audite o pipeline de testes deste projeto.",
              `projectRoot: ${projectRoot}`,
              "Use suggest_test_impact_analysis, suggest_test_parallelization e suggest_flaky_test_quarantine.",
              "Não invente workflow que a detecção de stack não viu.",
              changedFiles ? `Arquivos alterados:\n${changedFiles}` : "Se não houver diff, descreva a estratégia sem listar arquivo imaginário.",
              "Resource: e2e://knowledge/ci-cd-test-optimization.",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "e2e-automation-roi-check",
    {
      title: "Vale automatizar?",
      description: "Checagem rápida de ROI antes de automatizar um caso. Use com /e2e-automation-roi-check.",
      argsSchema: {
        name: z.string(),
        runsPerMonth: z.string(),
        manualMinutes: z.string(),
        automationMinutes: z.string(),
        stability: z.string().optional(),
      },
    },
    ({ name, runsPerMonth, manualMinutes, automationMinutes, stability }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Decida se este caso deve ser automatizado agora.",
              "Chame suggest_automation_roi com os números abaixo. Se faltar número, peça em vez de inventar.",
              `name: ${name}`,
              `runsPerMonth: ${runsPerMonth}`,
              `manualMinutes: ${manualMinutes}`,
              `automationMinutes: ${automationMinutes}`,
              stability ? `stability: ${stability}` : "stability não informada. Pergunte se a tela muda toda semana.",
              "Resource: e2e://knowledge/cost-of-quality.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}
