import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPrompts } from "./prompts/templates.js";
import { registerKnowledgeResources } from "./resources/register.js";
import { registerAllTools } from "./tools/register.js";

export const SERVER_NAME = "E2E";
export const SERVER_VERSION = "3.13.0";

export const SERVER_INSTRUCTIONS =
  "Quando for testar algo que você editou ou que está aberto, chame primeiro `map_tests_for_edit` com o filePath desse arquivo e o projectRoot. Siga a ordem que ela devolver. Não escolha outra tool no lugar. O padrão de tela é página real com a API mockada; o teste falha quando o componente muda. Unitário de return puro é caracterização: trava o comportamento atual, inclusive bug, e não prova a regra de negócio. Jornada ponta a ponta contra o sistema inteiro rodando (várias páginas, clique e envio reais, seed, verificação no backend e limpeza) é `generate_journey_test`; `generate_e2e_test` é uma tela com a API mockada. Para o projeto ter navegadores, celular, sistema subindo sozinho, trace, vídeo e CI, chame `setup_e2e_environment` uma vez. Desenho de casos é `design_test_cases`. Gestão, relatório, compliance, shift e ambiente estão nas resources, não em tools. Segurança de tela e de API roda no localhost. SAST, SCA, k6 em localhost, mutação e pact rodam se a ferramenta já está instalada. Smoke de produção, chaos e restore gravam arquivo e não executam. O padrão é o perfil core, para quem edita um arquivo e pede teste. E2E_TOOLSET=full devolve o catálogo inteiro, inclusive métricas e deploy. O mapa só devolve tools do perfil ativo; o que falta aparece como \"disponível com E2E_TOOLSET=full\".";

/** Monta o servidor sem acoplar ao transporte, para teste e para o stdio. */
export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    { instructions: SERVER_INSTRUCTIONS },
  );

  registerAllTools(server);
  registerKnowledgeResources(server);
  registerPrompts(server);
  return server;
}
