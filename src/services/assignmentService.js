const rules = [
  { agent: "HR_AGENT", pattern: /(hire|hiring|recruit|candidate|employee|onboarding|hr)/i },
  { agent: "SALES_AGENT", pattern: /(sales|lead|prospect|client|deal|pipeline|revenue)/i },
  { agent: "MARKETING_AGENT", pattern: /(marketing|campaign|seo|content|brand|ads)/i },
  { agent: "FINANCE_AGENT", pattern: /(finance|invoice|budget|expense|tax|cashflow)/i },
  { agent: "DEVELOPER_AGENT", pattern: /(bug|api|backend|frontend|deploy|code|dev)/i },
  { agent: "OPERATIONS_AGENT", pattern: /(ops|operation|logistics|sla|incident|process)/i }
];

const { decideAgentWithLlm } = require("./llmService");

function decideAgentByRules(task) {
  const haystack = `${task.title} ${task.description}`;
  return rules.find((r) => r.pattern.test(haystack))?.agent || "OPERATIONS_AGENT";
}

async function decideAgent(task) {
  return decideAgentWithLlm(task, decideAgentByRules(task));
}

module.exports = { decideAgent, decideAgentByRules };
