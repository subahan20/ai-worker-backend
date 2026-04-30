const express = require("express");
const { getAgentLogs } = require("../services/logService");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const { taskId, agentName, limit } = req.query;
    const logs = await getAgentLogs({ taskId, agentName, limit });
    return res.status(200).json(logs);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
