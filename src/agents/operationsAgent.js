const BaseAgent = require("./baseAgent");

class OperationsAgent extends BaseAgent {
  constructor() {
    super("OPERATIONS_AGENT");
  }

  async execute(input) {
    const {
      workflow = "task_execution",
      incident = "",
      current_steps = [],
      task_items = [],
      task_owner = "ops-team"
    } = input || {};
    console.log(`[${this.name}] started`, { workflow });

    if (workflow === "incident_response") {
      const severity = /outage|critical|down/i.test(String(incident || "")) ? "critical" : "high";
      return {
        incident,
        severity,
        action_plan: ["assign_owner", "mitigate_impact", "communicate_status", "run_postmortem"]
      };
    }

    if (workflow === "task_execution") {
      const items = Array.isArray(task_items) ? task_items : [];
      return {
        task_owner,
        execution_plan: items.map((item, idx) => ({ step: idx + 1, task: item, status: "queued" })),
        total_tasks: items.length
      };
    }

    const steps = Array.isArray(current_steps) ? current_steps : [];
    return {
      optimized_steps: steps.filter(Boolean).map((s, i) => `${i + 1}. ${s}`),
      automation_opportunities: ["notification automation", "reporting automation", "handoff automation"]
    };
  }
}

module.exports = OperationsAgent;
