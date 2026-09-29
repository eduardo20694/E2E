# E2E — servidor MCP de testes

Servidor [MCP](https://modelcontextprotocol.io) local para o Cursor atuar como especialista de teste full-stack. Transporte stdio, SDK `@modelcontextprotocol/sdk`, schemas com Zod.

São **63 tools**, **32 resources** e **8 prompts**. Cada tool cobre um domínio. A tabela no final deste arquivo diz se o resultado é mock, ambiente real isolado ou produção real. A partir da versão 3 o servidor também lê o workspace, grava o teste, executa o runner do projeto e lê JUnit ou Allure.

## Requisitos

- Node.js 20 ou superior

## Build e execução

```bash
npm install
npm run build
npm start
```

`npm start` sobe o servidor em stdio e fica parado de propósito: o Cursor é quem escreve no stdin. A linha `Servidor MCP E2E em stdio.` sai em stderr.

```bash
npm test
```

Roda a suíte do próprio servidor (geradores e um cliente MCP em memória).

## Configurar no Cursor

O projeto já inclui [`.cursor/mcp.json`](.cursor/mcp.json) apontando para o build desta máquina:

```json
{
  "mcpServers": {
    "E2E": {
      "command": "node",
      "args": ["c:/Github/E2E/dist/index.js"]
    }
  }
}
```

Para outro diretório, copie [`mcp.example.json`](mcp.example.json) e troque o caminho absoluto de `dist/index.js`. O mesmo bloco vale no MCP global do Cursor (`%USERPROFILE%\.cursor\mcp.json`).

Depois de salvar, recarregue os MCP servers nas configurações do Cursor. O servidor aparece como **E2E**. As resources entram como contexto (`e2e://knowledge/...`). Os prompts aparecem como:

- `/e2e-review-test`
- `/e2e-plan-feature`
- `/e2e-audit-suite`
- `/e2e-production-readiness`

O nome usa hífen. Dois-pontos quebram o identificador do protocolo e o nome de arquivo no Windows.

Passe `projectRoot` com a raiz do repositório aberto quando quiser detecção de stack. O processo do MCP não varre o próprio cwd: esse diretório é o servidor, e usar o cwd sugeriria Vitest para qualquer projeto.

## Tools

Peça em linguagem natural. O agente do Cursor chama a tool. Quando houver arquivo aberto, encaminhe o conteúdo em `sourceCode` e o caminho em `filePath`.

### Geração por camada

| Tool | O que faz | Exemplo de pedido |
| --- | --- | --- |
| `generate_unit_test` | Teste unitário em Jest, Vitest, pytest, JUnit ou RSpec, com mock se houver dependência externa | "Gera o unitário desta função em `src/pricing.ts`. projectRoot é o workspace." |
| `generate_integration_test` | Integração em ambiente real isolado. Diz o que mockar (terceiro) e o que não mockar (banco e fila do sistema) | "Teste de integração da API de pedidos com Postgres." |
| `generate_e2e_test` | Fluxo em Playwright, Cypress ou Selenium para staging, com setup e teardown de dado fake | "E2E: abrir a home, entrar e ver o painel." |
| `generate_api_test` | Contrato REST, GraphQL ou gRPC, com sucesso, erro e borda | "Contrato do `POST /orders`, incluindo 400 e 401." |
| `generate_mobile_test` | Fluxo Appium (Android, iOS ou ambos) | "Teste Appium do login no Android." |

### Design de casos

| Tool | Exemplo de pedido |
| --- | --- |
| `boundary_value_analysis` | "Valor limite da idade entre 18 e 65." |
| `equivalence_partitioning` | "Partições para um CEP brasileiro." |
| `decision_table` | "Tabela: logado sim/não, estoque sim/não, ação vender ou recusar." |
| `state_transition_test` | "Transições do pedido: criado -> pago -> enviado." |
| `pairwise_test_generator` | "Pairwise de SO, browser e resolução." |

### Não funcionais

| Tool | Exemplo de pedido |
| --- | --- |
| `suggest_performance_test_plan` | "Plano k6 para `GET /health`, 20 req/s." Só contra ambiente autorizado. |
| `suggest_security_checklist` | "Checklist OWASP deste handler de login." Verificação, sem passo de ataque. |
| `suggest_accessibility_audit` | "Auditoria WCAG AA do checkout, com axe-core." |
| `suggest_compatibility_matrix` | "Matriz para consumidor mobile no Brasil." |

### Qualidade da suíte

| Tool | Exemplo de pedido |
| --- | --- |
| `mutation_testing_report` | "Como ligar Stryker/PIT/mutmut aqui e o que significa score 70?" |
| `visual_regression_setup` | "Configura Percy, Chromatic ou Applitools conforme o repo." |
| `flakiness_analyzer` | "Este log de timeout e seletor, o que está instável?" |
| `code_coverage_advisor` | "Lê este LCOV e aponta arquivo de risco sem execução." |
| `defect_density_report` | "10 defeitos em 2 KLOC neste mês." |
| `mttr_report` | "INC-1 das 10:00 às 10:30 e INC-2 das 10:00 às 11:00. Qual o MTTR?" |

### Produção (shift-right)

Estas tools descrevem execução real em produção. A resposta traz dados sintéticos, blast radius, rollback e a diferença para o shift-left.

| Tool | Exemplo de pedido |
| --- | --- |
| `generate_smoke_test_prod` | "Smoke pós-deploy: health, login sintético, checkout sem cobrar." |
| `setup_canary_release` | "Canário de 5% da API de pedidos, com abort." |
| `setup_feature_flag_testing` | "Rollout da flag checkout-novo: equipe, 1%, 10%, 100%." |
| `setup_chaos_experiment` | "Hipótese: cair um pod da API e o erro ficar abaixo de 1%." |
| `setup_synthetic_monitoring` | "Robô 24/7 do login sintético em produção." |
| `setup_dark_launch` | "Rodar o cálculo novo em paralelo sem mostrar ao usuário e sem gravar." |
| `production_incident_test_review` | "Timeout quando a fila passou de mil. Que teste deveria ter pego?" |

### Processo

| Tool | Exemplo de pedido |
| --- | --- |
| `generate_test_plan` | "Plano de teste do checkout, entrega na sexta." |
| `generate_bug_report` | "A tela de pagamento dá crash ao confirmar. Formaliza o bug." |
| `generate_gherkin_scenario` | "Requisito: cliente de 17 anos pede assinatura e o sistema recusa." |
| `generate_traceability_matrix` | "Cruza estes requisitos com estes casos e mostra a lacuna." |

### Estratégia

| Tool | Exemplo de pedido |
| --- | --- |
| `suggest_test_pyramid_balance` | "Conta os testes neste projectRoot e compara com 70/20/10." |
| `risk_based_prioritization` | "Prioriza pagamento (4×5) e tema (1×1)." |
| `shift_left_right_recommendations` | "O que testar no PR e o que observar em produção. Um não substitui o outro." |
| `environment_strategy_advisor` | "O que é mock, o que é isolado e o que roda em produção neste pipeline." |

## Resources

Cada arquivo em `src/resources/knowledge-base/` é uma resource `e2e://knowledge/<slug>`:

| URI | Tema |
| --- | --- |
| `e2e://knowledge/unit-testing` | Teste unitário |
| `e2e://knowledge/integration-testing` | Integração e Testcontainers |
| `e2e://knowledge/e2e-testing` | Cypress, Playwright, Selenium |
| `e2e://knowledge/black-white-gray-box` | Caixa-preta, branca e cinza |
| `e2e://knowledge/functional-vs-non-functional` | Funcional e não funcional |
| `e2e://knowledge/test-design-techniques` | Partição, limite, decisão, estado, pairwise |
| `e2e://knowledge/mutation-testing` | Stryker, PIT, mutmut |
| `e2e://knowledge/visual-regression` | Percy, Chromatic, Applitools |
| `e2e://knowledge/tdd` | Vermelho, verde, refatorar |
| `e2e://knowledge/bdd` | Gherkin |
| `e2e://knowledge/shift-left-right` | Mapa entre as duas faixas |
| `e2e://knowledge/shift-left` | Antes do deploy |
| `e2e://knowledge/shift-right` | Canário, flag, chaos, sintético, dark launch |
| `e2e://knowledge/test-environments` | Local, CI, staging, produção |
| `e2e://knowledge/qa-metrics` | Cobertura, escape, flakiness |
| `e2e://knowledge/mobile-testing` | Appium |
| `e2e://knowledge/api-contract-testing` | REST, GraphQL, gRPC |
| `e2e://knowledge/ai-in-testing` | Onde o modelo ajuda e onde não decide |

As tools leem esses arquivos e devolvem o URI mais um trecho, para o agente puxar o texto completo se precisar.

## Prompts

| Prompt | Argumentos | Uso |
| --- | --- | --- |
| `e2e-review-test` | `code`, `filePath?` | Revisa assert fraco, sleep, seletor e dado compartilhado |
| `e2e-plan-feature` | `requirement`, `projectRoot?` | Plano da feature, do mock ao que roda em produção depois do deploy |
| `e2e-audit-suite` | `projectRoot`, `notes?` | Pirâmide, lacunas e se há shift-right configurado |
| `e2e-production-readiness` | `change`, `projectRoot?` | Smoke, canário, sintético e rollback antes de ir para produção |

## Layout

```
src/
  index.ts                 # stdio
  server.ts                # fábrica usada pelos testes
  tools/                   # um módulo por domínio, inclusive production-testing.ts
  resources/knowledge-base/
  prompts/templates.ts
  lib/                     # detecção de stack, pairwise, cobertura, pirâmide
tests/                     # dogfooding
```

## Detecção de stack

Com `projectRoot`, o servidor lê `package.json`, `requirements.txt`, `pyproject.toml`, `pom.xml`, `build.gradle`, `Gemfile`, `go.mod`, configs de teste, Dockerfile, CI (`.github/workflows`, GitLab, Jenkins) e pastas de deploy (`k8s`, `helm`, `deploy`). A sugestão segue o que já está instalado: pytest num projeto Python, Flagger se o manifesto já existe, a flag que o repositório já usa. Framework pedido na tool ganha do detectado, com um aviso quando os dois divergem.

## Mock, ambiente real isolado, produção real

| Tool | Onde vive |
| --- | --- |
| `generate_unit_test` | Mock. Sem rede, sem banco, sem produção. |
| `boundary_value_analysis`, `equivalence_partitioning`, `decision_table`, `state_transition_test`, `pairwise_test_generator` | Design. Não executa ambiente nenhum. |
| `generate_integration_test` | Real isolado. Banco e fila do sistema de verdade, descartáveis. Terceiro com custo fica mockado. |
| `generate_api_test` | Contrato em teste ou staging. Não é carga em produção. |
| `generate_e2e_test` | Staging, dado fake, setup e teardown. Não é produção. |
| `generate_mobile_test` | Emulador ou device de teste. |
| `suggest_performance_test_plan` | Ambiente autorizado para carga. Não é produção sem acordo de janela. |
| `suggest_security_checklist`, `suggest_accessibility_audit`, `suggest_compatibility_matrix` | Plano. A execução de acessibilidade pode ser staging. |
| `mutation_testing_report`, `visual_regression_setup`, `flakiness_analyzer`, `code_coverage_advisor`, `defect_density_report`, `mttr_report` | Diagnóstico da suíte ou dos incidentes. Não disparam produção. |
| `generate_test_plan`, `generate_bug_report`, `generate_gherkin_scenario`, `generate_traceability_matrix` | Documento. |
| `suggest_test_pyramid_balance`, `risk_based_prioritization`, `shift_left_right_recommendations`, `environment_strategy_advisor` | Estratégia. A última nomeia a natureza de cada ambiente. |
| `generate_smoke_test_prod`, `setup_canary_release`, `setup_feature_flag_testing`, `setup_chaos_experiment`, `setup_synthetic_monitoring`, `setup_dark_launch`, `production_incident_test_review` | Produção real. Sem mock do caminho crítico. Exigem dado sintético, blast radius e rollback. Não substituem o shift-left. |
| `generate_synthetic_data`, `suggest_data_masking_strategy` | Dado falso ou token. Não é cópia de produção. |
| `suggest_seeding_strategy` | Real isolado. O seed nasce e morre com o banco de teste. |
| `setup_service_virtualization` | Mock de terceiro. O banco do sistema continua real isolado. |
| `generate_property_based_test`, `generate_snapshot_test`, `generate_golden_master_test` | Mock. Sem rede e sem produção. |
| `generate_fuzz_test` | Local ou isolado. Não aponta para produção. |
| `suggest_sast_setup`, `suggest_sca_setup` | Análise estática no CI. Não executa o produto. |
| `generate_i18n_test` | Mock ou componente. Não é produção. |
| `setup_disaster_recovery_test` | Restore real numa cópia. Não é o banco que serve o cliente. |
| `suggest_compliance_checklist` | Roteiro. Não é parecer jurídico. |
| `suggest_model_testing_plan`, `suggest_ab_test_design`, `generate_llm_prompt_test` | Avaliação offline ou experimento desenhado antes de olhar o resultado. |
| `suggest_test_impact_analysis`, `suggest_test_parallelization`, `suggest_flaky_test_quarantine` | Pipeline. A suíte inteira continua no merge. |
| `suggest_test_management_tool`, `suggest_reporting_setup` | Ferramenta de processo. A automação segue no repositório. |
| `setup_consumer_driven_contracts` | Contrato no CI. Não substitui o smoke em produção. |
| `calculate_cost_of_quality`, `suggest_automation_roi` | Conta de planejamento. Não executa teste. |
| `read_workspace` | Diagnóstico local. Lê a pasta aberta no Cursor, sem colar o fonte. |
| `write_test_file` | Grava no repositório, só dentro da raiz e só extensão de teste. |
| `run_project_tests` | Execução local ou staging do Vitest, Jest, Playwright ou pytest já instalados. Não é carga em produção e não aceita comando livre. |
| `diagnose_test_report` | Lê o relatório real (JUnit XML ou Allure) e aponta a falha. |

## v2 — Módulos avançados

Extensão sobre a base. O registro continua em `src/tools/register.ts`. Nada da base foi removido.

### Dados de teste

| Tool | Exemplo de pedido |
| --- | --- |
| `generate_synthetic_data` | "Gera 5 usuários sintéticos com e-mail, semente 1." |
| `suggest_data_masking_strategy` | "Quais campos deste payload mascarar para a LGPD?" |
| `suggest_seeding_strategy` | "Como semear usuário e pedido de forma reproduzível?" |
| `setup_service_virtualization` | "WireMock para o serviço de pagamentos." |

### Propriedade, snapshot e legado

| Tool | Exemplo de pedido |
| --- | --- |
| `generate_property_based_test` | "Propriedades para esta função, na biblioteca da stack." |
| `generate_fuzz_test` | "Fuzz do parser local, sem apontar para produção." |
| `generate_snapshot_test` | "Snapshot do resumo do carrinho, pequeno." |
| `generate_golden_master_test` | "Golden master deste legado antes de refatorar." |

### Estático, i18n, recuperação, IA

| Tool | Exemplo de pedido |
| --- | --- |
| `suggest_sast_setup` | "SAST para este repositório." |
| `suggest_sca_setup` | "SCA sem duplicar o Dependabot." |
| `generate_i18n_test` | "Testes para pt-BR e ar." |
| `setup_disaster_recovery_test` | "Ensaio de restore do Postgres, RPO 15, RTO 60." |
| `suggest_compliance_checklist` | "Checklist de teste para checkout com cartão." |
| `suggest_model_testing_plan` | "Plano de teste do modelo de risco." |
| `suggest_ab_test_design` | "Amostra para conversão 10% com efeito de 2 pontos." |
| `generate_llm_prompt_test` | "Casos para este prompt responder só JSON." |

### Pipeline, gestão, contrato, custo

| Tool | Exemplo de pedido |
| --- | --- |
| `suggest_test_impact_analysis` | "O que rodar se mudou `src/pricing.ts`?" |
| `suggest_test_parallelization` | "Como fatiar 40 arquivos em 4 workers?" |
| `suggest_flaky_test_quarantine` | "Quarentena do `checkout.spec.ts`." |
| `suggest_test_management_tool` | "O time usa Jira. Onde guardar o caso manual?" |
| `suggest_reporting_setup` | "Relatório da suíte no CI." |
| `setup_consumer_driven_contracts` | "Pact entre web e orders." |
| `calculate_cost_of_quality` | "2 defeitos em produção, o resto zero." |
| `suggest_automation_roi` | "Vale automatizar este fluxo que roda 20 vezes por mês?" |

Prompts novos: `/e2e-legacy-code-safety-net`, `/e2e-ml-test-plan`, `/e2e-pipeline-audit`, `/e2e-automation-roi-check`.

## Ciclo fechado

A raiz sai, nesta ordem, de `projectRoot`, de `E2E_PROJECT_ROOT`, das pastas que o Cursor expõe, ou subindo a partir de `filePath` até um `package.json` (ou equivalente). Sem raiz, o servidor não adivinha o diretório de trabalho do processo.

| Tool | Exemplo de pedido |
| --- | --- |
| `read_workspace` | "Lê `src/pricing.ts` do projeto aberto." |
| `write_test_file` | "Grava este spec em `e2e/checkout.spec.ts`." |
| `run_project_tests` | "Roda o Vitest deste arquivo." |
| `diagnose_test_report` | "Diagnostica o `junit.xml` do CI." |

`generate_unit_test` e `generate_e2e_test` aceitam `writeToProject` e `run`. Sem os dois, o comportamento continua sendo devolver o código no chat.

## Contagem

| Categoria | Tools |
| --- | --- |
| Geração por camada | 5 |
| Design de casos | 5 |
| Não funcionais | 4 |
| Qualidade da suíte e métricas | 6 |
| Produção | 7 |
| Processo | 4 |
| Estratégia | 4 |
| Dados de teste | 4 |
| Propriedade e fuzz | 2 |
| Snapshot e golden master | 2 |
| SAST e SCA | 2 |
| i18n | 1 |
| Disaster recovery e compliance | 2 |
| IA e ML | 3 |
| Pipeline | 3 |
| Gestão e relatório | 2 |
| Contrato dirigido pelo consumidor | 1 |
| Economia | 2 |
| Ciclo fechado | 4 |
| **Total** | **63** |

Resources: 32. Prompts: 8.

