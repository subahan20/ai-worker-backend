const { createAgentLog } = require("./logService");
const { getPendingTasks, updateTask, claimTaskIfPending } = require("./taskService");
const { validatePayload } = require("./workflowValidationService");
const { getAgentByType } = require("../agents");
const logger = require("../utils/logger");

const EXECUTION_TIMEOUT_MS = Number(process.env.AGENT_EXEC_TIMEOUT_MS || 20000);
const EXECUTION_RETRIES = Number(process.env.AGENT_EXEC_RETRIES || 1);

function executeWithTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`agent execution timed out after ${timeoutMs}ms`)), timeoutMs))
  ]);
}

async function executeWithRetry(agent, payload, retries, timeoutMs) {
  let lastError;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      return await executeWithTimeout(agent.execute(payload), timeoutMs);
    } catch (err) {
      lastError = err;
      if (attempt <= retries) {
        logger.error("CEO", "agent_retry", { agent: agent.name, attempt, error: err.message });
      }
    }
  }
  throw lastError;
}

async function processTask(task) {
  const taskStartMs = Date.now();
  const selectedType = task.type;
  const agent = getAgentByType(selectedType);
  if (!agent) throw new Error(`Unsupported task type: ${selectedType}`);
  validatePayload(selectedType, task.payload || {});

  await createAgentLog({
    taskId: task.id,
    agentName: "CEO_AGENT",
    action: "APPROVED",
    response: { status: "approved", type: selectedType }
  });

  await updateTask(task.id, { status: "assigned", assignedTo: agent.name });
  await createAgentLog({
    taskId: task.id,
    agentName: "CEO_AGENT",
    action: "ASSIGNED",
    response: { assignedTo: agent.name }
  });

  await updateTask(task.id, { status: "working" });
  await createAgentLog({
    taskId: task.id,
    agentName: "CEO_AGENT",
    action: "WORKING",
    response: { status: "working" }
  });

  const execStartedMs = Date.now();
  const response = await executeWithRetry(agent, task.payload, EXECUTION_RETRIES, EXECUTION_TIMEOUT_MS);
  const executionMs = Date.now() - execStartedMs;
  await createAgentLog({
    taskId: task.id,
    agentName: agent.name,
    action: "EXECUTED",
    response: { ...response, executionMs }
  });

  await updateTask(task.id, { status: "completed" });
  await createAgentLog({
    taskId: task.id,
    agentName: "CEO_AGENT",
    action: "COMPLETED",
    response: { status: "completed", totalTaskMs: Date.now() - taskStartMs }
  });

  return { taskId: task.id, type: selectedType, assignedTo: agent.name, status: "completed" };
}

async function runPendingTaskCycle() {
  const pendingTasks = await getPendingTasks();
  logger.info("CEO", "cycle_started", { pending: pendingTasks.length });

  const results = [];
  for (const task of pendingTasks) {
    try {
      const claimedTask = await claimTaskIfPending(task.id);
      if (!claimedTask) {
        results.push({ taskId: task.id, status: "skipped", reason: "already_claimed" });
        continue;
      }
      results.push(await processTask(task));
    } catch (err) {
      logger.error("CEO", "task_failed", { taskId: task.id, error: err.message });
      await updateTask(task.id, { status: "failed" });
      await createAgentLog({
        taskId: task.id,
        agentName: "CEO_AGENT",
        action: "FAILED",
        response: { error: err.message }
      });
      results.push({ taskId: task.id, status: "failed", error: err.message });
    }
  }

  return { total: pendingTasks.length, processed: results.length, results };
}

module.exports = { runPendingTaskCycle };
