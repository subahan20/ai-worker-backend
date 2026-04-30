const logger = require("../utils/logger");

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const ALLOWED_AGENTS = [
  "HR_AGENT",
  "SALES_AGENT",
  "MARKETING_AGENT",
  "FINANCE_AGENT",
  "DEVELOPER_AGENT",
  "OPERATIONS_AGENT"
];

let client = null;

function getClient() {
  if (client) return client;
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    // Lazy import prevents app crash when package is not installed.
    const OpenAI = require("openai");
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return client;
  } catch (err) {
    logger.error("LLM", "openai_module_not_found_using_fallback", { error: err.message });
    return null;
  }
}

const canUseLlm = () => Boolean(getClient());

async function jsonCompletion(system, user) {
  if (!canUseLlm()) throw new Error("OPENAI_API_KEY is missing");
  const response = await getClient().responses.create({
    model: MODEL,
    input: [
      { role: "system", content: [{ type: "input_text", text: system }] },
      { role: "user", content: [{ type: "input_text", text: user }] }
    ],
    text: { format: { type: "json_object" } }
  });
  return JSON.parse(response.output_text || "{}");
}

async function decideAgentWithLlm(task, fallbackAgent) {
  if (!canUseLlm()) return fallbackAgent;
  try {
    const output = await jsonCompletion(
      "You are a task router. Return JSON: {\"agent\":\"<AGENT_NAME>\",\"reason\":\"short\"}.",
      `Pick one from ${ALLOWED_AGENTS.join(", ")}.\nTitle: ${task.title}\nDescription: ${task.description}`
    );
    const agent = output.agent;
    if (!ALLOWED_AGENTS.includes(agent)) return fallbackAgent;
    return agent;
  } catch (err) {
    logger.error("LLM_ROUTER", "fallback_to_rules", { error: err.message });
    return fallbackAgent;
  }
}

async function runDomainAgentWithLlm({ agentName, department, task, fallback }) {
  if (!canUseLlm()) return fallback;
  try {
    const output = await jsonCompletion(
      `You are the ${department} department agent. Return concise JSON: {"ok":true,"department":"${department}","message":"...","actions":["..."]}.`,
      `Task title: ${task.title}\nTask description: ${task.description}`
    );
    return {
      ok: output.ok !== false,
      department,
      message: output.message || fallback.message,
      actions: Array.isArray(output.actions) ? output.actions : fallback.actions || [],
      source: "llm",
      agent: agentName
    };
  } catch (err) {
    logger.error(agentName, "llm_execution_failed", { error: err.message });
    return fallback;
  }
}

module.exports = { canUseLlm, decideAgentWithLlm, runDomainAgentWithLlm };
