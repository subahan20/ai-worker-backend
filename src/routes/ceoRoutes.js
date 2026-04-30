const express = require("express");
const CeoAgent = require("../agents/ceoAgent");
const orchestrationService = require("../services/ceoOrchestrationService");

const router = express.Router();
const ceo = new CeoAgent(orchestrationService);

router.post("/run", async (_req, res, next) => {
  try {
    const result = await ceo.executeCycle();
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
