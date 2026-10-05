import { generateUnitTest } from "../src/tools/unit.js";
import { generateIntegrationTest } from "../src/tools/integration.js";
import { generateE2eTest } from "../src/tools/e2e.js";
import { generateApiTest } from "../src/tools/api.js";
import { boundaryValueAnalysis } from "../src/tools/design-techniques.js";
import { suggestPerformanceTestPlan } from "../src/tools/non-functional.js";
import { mutationTestingReport } from "../src/tools/mutation.js";
import { visualRegressionSetup } from "../src/tools/visual-regression.js";
import { generateTestPlan } from "../src/tools/test-plan.js";
import { generateGherkinScenario } from "../src/tools/bdd.js";
import { flakinessAnalyzer } from "../src/tools/metrics.js";
import { suggestTestPyramidBalance } from "../src/tools/strategy.js";

const samples = {
  unit: () =>
    generateUnitTest({
      sourceCode: "export function add(a: number, b: number) { return a + b; }",
    }),
  integration: () =>
    generateIntegrationTest({ description: "API e postgres gravam o pedido", database: "postgres" }),
  e2e: () =>
    generateE2eTest({
      sourceCode: "export default function Checkout(){ return <button>Pagar</button>; }",
      filePath: "src/pages/Checkout.tsx",
    }),
  api: () => generateApiTest({ specification: "GET /orders/{id}" }),
  design: () => boundaryValueAnalysis({ rule: "quantidade entre 1 e 10" }),
  performance: () => suggestPerformanceTestPlan({ target: "http://127.0.0.1:3000/orders" }),
  mutation: () => mutationTestingReport({ language: "typescript", currentScore: 70 }),
  visual: () => visualRegressionSetup({}),
  plan: () => generateTestPlan({ feature: "pedido" }),
  bdd: () => generateGherkinScenario({ requirement: "Cliente confirma o pedido e vê o número." }),
  metrics: () => flakinessAnalyzer({ logs: "Timeout 5000ms exceeded" }),
  strategy: () => suggestTestPyramidBalance({ counts: { unit: 10, integration: 3, e2e: 1 } }),
};

const name = process.argv[2] as keyof typeof samples | undefined;
if (!name || !samples[name]) {
  console.error(`Uso: tsx scripts/smoke.ts <${Object.keys(samples).join("|")}>`);
  process.exit(1);
}

const result = await samples[name]();
if (result.isError || !result.content[0]?.text.trim()) {
  console.error(result.content[0]?.text ?? "sem conteúdo");
  process.exit(1);
}

console.log(result.content[0].text.slice(0, 400));
console.log("\nOK", name);
