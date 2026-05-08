const express = require("express");

const router = express.Router();

// POST /api/v2/apply/process
router.post("/process", async (req, res) => {
  const applicationId = req.body?.applicationId;
  if (!applicationId) {
    return res.status(400).json({ error: "applicationId is required" });
  }

  // Compatibility endpoint: frontend fire-and-forget path.
  // Current backend processing is done via /parse-resume and /analysis/hr.
  return res.json({
    success: true,
    queued: true,
    message: "Application processing accepted. Use /parse-resume and /analysis/hr for full pipeline.",
  });
});

module.exports = router;
