const Groq = require("groq-sdk");
const logger = require("../utils/logger");

const getGroq = () => new Groq({ apiKey: process.env.GROQ_API_KEY || process.env.GROQ_API || "" });

const ALLOWED_AGENTS = [
  "HR_AGENT",
  "SALES_AGENT",
  "MARKETING_AGENT",
  "FINANCE_AGENT",
  "DEVELOPER_AGENT",
  "OPERATIONS_AGENT"
];

const canUseLlm = () => Boolean(process.env.GROQ_API_KEY || process.env.GROQ_API);

async function jsonCompletion(system, user) {
  if (!canUseLlm()) throw new Error("GROQ_API_KEY is missing");
  
  const response = await getGroq().chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: system + " Respond in valid JSON format." },
      { role: "user", content: user }
    ],
    response_format: { type: "json_object" }
  });
  
  return JSON.parse(response.choices[0].message.content || "{}");
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
