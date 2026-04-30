const pool = require("../db/pool");
const { validatePayload } = require("./workflowValidationService");

const mapTask = (row) => row;

const queryOne = async (sql, params = []) => (await pool.query(sql, params)).rows[0];
const queryMany = async (sql, params = []) => (await pool.query(sql, params)).rows;

const VALID_TYPES = new Set(["hr", "sales", "marketing", "finance", "developer", "operations"]);

async function createTask({ type, payload }) {
  const normalizedType = String(type || "").toLowerCase();
  if (!VALID_TYPES.has(normalizedType)) {
    const err = new Error("type must be one of: hr, sales, marketing, finance, developer, operations");
    err.statusCode = 400;
    throw err;
  }

  const safePayload = payload && typeof payload === "object" ? payload : {};
  try {
    validatePayload(normalizedType, safePayload);
  } catch (err) {
    err.statusCode = 400;
    throw err;
  }
  const title = `${normalizedType.toUpperCase()} task`;
  const description = JSON.stringify(safePayload);
  const sql = `
    INSERT INTO tasks (type, payload, title, description)
    VALUES ($1, $2::jsonb, $3, $4)
    RETURNING *;
  `;
  return mapTask(await queryOne(sql, [normalizedType, JSON.stringify(safePayload), title, description]));
}

async function getPendingTasks() {
  const sql = `SELECT * FROM tasks WHERE status = 'pending' AND type IN ('hr', 'sales', 'marketing', 'finance', 'developer', 'operations') ORDER BY created_at ASC;`;
  return (await queryMany(sql)).map(mapTask);
}

async function getTasks({ status, assignedTo, type, limit = 50 } = {}) {
  const clauses = [];
  const params = [];

  if (status) {
    params.push(status);
    clauses.push(`status = $${params.length}`);
  }

  if (assignedTo) {
    params.push(assignedTo);
    clauses.push(`assigned_to = $${params.length}`);
  }

  if (type) {
    params.push(String(type).toLowerCase());
    clauses.push(`type = $${params.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const sql = `SELECT * FROM tasks ${where} ORDER BY created_at DESC LIMIT ${safeLimit};`;
  return (await queryMany(sql, params)).map(mapTask);
}

async function updateTask(taskId, { status, assignedTo }) {
  const sql = `
    UPDATE tasks
    SET
      status = COALESCE($2, status),
      assigned_to = COALESCE($3, assigned_to),
      updated_at = NOW()
    WHERE id = $1
    RETURNING *;
  `;
  return mapTask(await queryOne(sql, [taskId, status || null, assignedTo || null]));
}

async function claimTaskIfPending(taskId) {
  const sql = `
    UPDATE tasks
    SET status = 'approved', updated_at = NOW()
    WHERE id = $1 AND status = 'pending'
    RETURNING *;
  `;
  return mapTask(await queryOne(sql, [taskId]));
}

module.exports = { createTask, getPendingTasks, getTasks, updateTask, claimTaskIfPending, VALID_TYPES };
