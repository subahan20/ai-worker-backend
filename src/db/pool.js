const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

pool.on("connect", () => console.log("[DB] connected"));
pool.on("error", (err) => console.error("[DB] pool error", err));

module.exports = pool;
