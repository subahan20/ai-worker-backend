const express = require("express");
const morgan = require("morgan");
const taskRoutes = require("./routes/taskRoutes");
const ceoRoutes = require("./routes/ceoRoutes");
const logRoutes = require("./routes/logRoutes");

const app = express();

app.use(express.json());
app.use(morgan("dev"));

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api/tasks", taskRoutes);
app.use("/api/ceo", ceoRoutes);
app.use("/api/logs", logRoutes);

app.use((err, _req, res, _next) => {
  console.error("[API_ERROR]", err);
  res.status(err.statusCode || 500).json({ message: err.message || "Internal server error" });
});

module.exports = app;
