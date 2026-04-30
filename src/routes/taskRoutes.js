const express = require("express");
const { createTask, getTasks, VALID_TYPES } = require("../services/taskService");

const router = express.Router();

router.post("/", async (req, res, next) => {
  try {
    const { type, payload } = req.body;
    if (!type || !payload || typeof payload !== "object") {
      return res.status(400).json({ message: "type and payload(object) are required" });
    }
    if (!VALID_TYPES.has(String(type).toLowerCase())) {
      return res.status(400).json({ message: "type must be one of: hr, sales, marketing, finance, developer, operations" });
    }
    const task = await createTask({ type, payload });
    return res.status(201).json(task);
  } catch (err) {
    return next(err);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const { status, assignedTo, type, limit } = req.query;
    const tasks = await getTasks({ status, assignedTo, type, limit });
    return res.status(200).json(tasks);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
