const HrAgent = require("./hrAgent");
const SalesAgent = require("./salesAgent");
const MarketingAgent = require("./marketingAgent");
const FinanceAgent = require("./financeAgent");
const DeveloperAgent = require("./developerAgent");
const OperationsAgent = require("./operationsAgent");

const AGENT_MAP = {
  hr: new HrAgent(),
  sales: new SalesAgent(),
  marketing: new MarketingAgent(),
  finance: new FinanceAgent(),
  developer: new DeveloperAgent(),
  operations: new OperationsAgent()
};

function getAgentByType(type) {
  return AGENT_MAP[String(type || "").toLowerCase()];
}

module.exports = { getAgentByType };
