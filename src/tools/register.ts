import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAiMlTools } from "./ai-ml-testing.js";
import { registerApiTools } from "./api.js";
import { registerBddTools } from "./bdd.js";
import { registerCiTools } from "./ci-cd-optimization.js";
import { registerContractAdvancedTools } from "./contract-testing-advanced.js";
import { registerDesignTools } from "./design-techniques.js";
import { registerDisasterTools } from "./disaster-recovery.js";
import { registerEditMapTools } from "./edit-map.js";
import { registerE2eTools } from "./e2e.js";
import { registerExecutionTools } from "./execution.js";
import { registerEconomicsTools } from "./quality-economics.js";
import { registerI18nTools } from "./i18n-l10n.js";
import { registerIntegrationTools } from "./integration.js";
import { registerManagementTools } from "./test-management-tooling.js";
import { registerMetricsTools } from "./metrics.js";
import { registerMobileTools } from "./mobile.js";
import { registerMutationTools } from "./mutation.js";
import { registerNonFunctionalTools } from "./non-functional.js";
import { registerProductionTools } from "./production-testing.js";
import { registerPropertyTools } from "./property-based.js";
import { registerSnapshotTools } from "./snapshot-golden-master.js";
import { registerStaticTools } from "./static-analysis.js";
import { registerStrategyTools } from "./strategy.js";
import { registerTestDataTools } from "./test-data.js";
import { registerTestPlanTools } from "./test-plan.js";
import { registerUnitTools } from "./unit.js";
import { beginToolRegistration, endToolRegistration } from "../lib/register-tool.js";
import { registerVisualTools } from "./visual-regression.js";

export const TOOL_NAMES = [
  "map_tests_for_edit",
  "generate_unit_test",
  "generate_integration_test",
  "generate_e2e_test",
  "generate_api_test",
  "generate_mobile_test",
  "design_test_cases",
  "suggest_performance_test_plan",
  "suggest_security_checklist",
  "suggest_accessibility_audit",
  "suggest_compatibility_matrix",
  "mutation_testing_report",
  "visual_regression_setup",
  "generate_smoke_test_prod",
  "setup_canary_release",
  "setup_feature_flag_testing",
  "setup_chaos_experiment",
  "setup_synthetic_monitoring",
  "setup_dark_launch",
  "production_incident_test_review",
  "flakiness_analyzer",
  "code_coverage_advisor",
  "defect_density_report",
  "mttr_report",
  "generate_test_plan",
  "generate_bug_report",
  "generate_gherkin_scenario",
  "generate_traceability_matrix",
  "suggest_test_pyramid_balance",
  "risk_based_prioritization",
  "generate_synthetic_data",
  "suggest_data_masking_strategy",
  "suggest_seeding_strategy",
  "setup_service_virtualization",
  "generate_property_based_test",
  "generate_fuzz_test",
  "generate_snapshot_test",
  "generate_golden_master_test",
  "suggest_sast_setup",
  "suggest_sca_setup",
  "generate_i18n_test",
  "setup_disaster_recovery_test",
  "suggest_model_testing_plan",
  "suggest_ab_test_design",
  "generate_llm_prompt_test",
  "suggest_test_impact_analysis",
  "suggest_test_parallelization",
  "suggest_flaky_test_quarantine",
  "setup_consumer_driven_contracts",
  "calculate_cost_of_quality",
  "suggest_automation_roi",
  "read_workspace",
  "write_test_file",
  "run_project_tests",
  "diagnose_test_report",
] as const;

/** Perfil padrão: quem edita um arquivo e pede teste. */
export const CORE_TOOL_NAMES = [
  "map_tests_for_edit",
  "read_workspace",
  "generate_unit_test",
  "generate_integration_test",
  "generate_e2e_test",
  "generate_api_test",
  "setup_consumer_driven_contracts",
  "design_test_cases",
  "suggest_security_checklist",
  "suggest_accessibility_audit",
  "suggest_sast_setup",
  "suggest_sca_setup",
  "code_coverage_advisor",
  "flakiness_analyzer",
  "diagnose_test_report",
  "suggest_test_pyramid_balance",
  "suggest_test_impact_analysis",
  "write_test_file",
  "run_project_tests",
  "visual_regression_setup",
] as const;

export function toolsetProfile(): "core" | "full" {
  return process.env.E2E_TOOLSET?.trim().toLowerCase() === "full" ? "full" : "core";
}

export function registerAllTools(server: McpServer): void {
  const full = toolsetProfile() === "full";
  beginToolRegistration(full ? null : CORE_TOOL_NAMES, !full);
  try {
  registerEditMapTools(server);
  registerUnitTools(server);
  registerIntegrationTools(server);
  registerE2eTools(server);
  registerApiTools(server);
  registerMobileTools(server);
  registerDesignTools(server);
  registerNonFunctionalTools(server);
  registerMutationTools(server);
  registerVisualTools(server);
  registerProductionTools(server);
  registerBddTools(server);
  registerTestPlanTools(server);
  registerMetricsTools(server);
  registerStrategyTools(server);
  registerTestDataTools(server);
  registerPropertyTools(server);
  registerSnapshotTools(server);
  registerStaticTools(server);
  registerI18nTools(server);
  registerDisasterTools(server);
  registerAiMlTools(server);
  registerCiTools(server);
  registerManagementTools(server);
  registerContractAdvancedTools(server);
  registerEconomicsTools(server);
  registerExecutionTools(server);
  } finally {
    endToolRegistration();
  }
}
