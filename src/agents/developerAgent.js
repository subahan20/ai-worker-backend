const BaseAgent = require("./baseAgent");

class DeveloperAgent extends BaseAgent {
  constructor() {
    super("DEVELOPER_AGENT");
  }

  async execute(input) {
    const { workflow = "feature_build", requirements = [], bug_report = "", component = "core-module" } = input || {};
    console.log(`[${this.name}] started`, { workflow });

    if (workflow === "bug_fix" || workflow === "bug_triage") {
      const severity = /critical|crash|down/i.test(String(bug_report || "")) ? "high" : "medium";
      return {
        bug_summary: String(bug_report || "").slice(0, 160),
        severity,
        next_steps: ["reproduce_issue", "identify_root_cause", "ship_fix", "verify_in_prod"]
      };
    }

    if (workflow === "maintenance_plan") {
      return {
        component,
        maintenance_actions: ["dependency_updates", "performance_review", "test_suite_stabilization"],
        expected_outcome: "improved_stability_and_maintainability"
      };
    }

    const items = Array.isArray(requirements) ? requirements : [];
    return {
      sprint_plan: items.map((item, idx) => ({ task: item, priority: idx < 2 ? "high" : "medium" })),
      estimated_days: Math.max(2, items.length * 2)
    };
  }
}

module.exports = DeveloperAgent;
