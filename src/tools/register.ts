import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAiMlTools } from "./ai-ml-testing.js";
import { registerApiTools } from "./api.js";
import { registerBddTools } from "./bdd.js";
import { registerCiTools } from "./ci-cd-optimization.js";
import { registerContractAdvancedTools } from "./contract-testing-advanced.js";
import { registerDesignTools } from "./design-techniques.js";
import { registerDisasterTools } from "./disaster-recovery.js";
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
import { registerVisualTools } from "./visual-regression.js";

export const TOOL_NAMES = [
  "generate_unit_test",
  "generate_integration_test",
  "generate_e2e_test",
  "generate_api_test",
  "generate_mobile_test",
  "boundary_value_analysis",
  "equivalence_partitioning",
  "decision_table",
  "state_transition_test",
  "pairwise_test_generator",
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
  "shift_left_right_recommendations",
  "environment_strategy_advisor",
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
  "suggest_compliance_checklist",
  "suggest_model_testing_plan",
  "suggest_ab_test_design",
  "generate_llm_prompt_test",
  "suggest_test_impact_analysis",
  "suggest_test_parallelization",
  "suggest_flaky_test_quarantine",
  "suggest_test_management_tool",
  "suggest_reporting_setup",
  "setup_consumer_driven_contracts",
  "calculate_cost_of_quality",
  "suggest_automation_roi",
  "read_workspace",
  "write_test_file",
  "run_project_tests",
  "diagnose_test_report",
] as const;

export function registerAllTools(server: McpServer): void {
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
}
