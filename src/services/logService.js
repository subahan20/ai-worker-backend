const pool = require("../db/pool");

async function createAgentLog({ taskId, agentName, action, response = {} }) {
  const sql = `
    INSERT INTO agent_logs (task_id, agent_name, action, response)
    VALUES ($1, $2, $3, $4::jsonb)
    RETURNING *;
  `;
  const { rows } = await pool.query(sql, [taskId, agentName, action, JSON.stringify(response)]);
  return rows[0];
}

async function getAgentLogs({ taskId, agentName, limit = 100 } = {}) {
  const clauses = [];
  const params = [];

  if (taskId) {
    params.push(taskId);
    clauses.push(`task_id = $${params.length}`);
  }

  if (agentName) {
    params.push(agentName);
    clauses.push(`agent_name = $${params.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const sql = `SELECT * FROM agent_logs ${where} ORDER BY created_at DESC LIMIT ${safeLimit};`;
  const { rows } = await pool.query(sql, params);
  return rows;
}

module.exports = { createAgentLog, getAgentLogs };
