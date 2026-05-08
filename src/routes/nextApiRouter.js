const express = require("express");
const router = express.Router();

const tasksRoutes = require("./tasksMigrated");
const resumeRoutes = require("./resumeRoutes");
const analysisRoutes = require("./analysisRoutes");
const taskActionsRoutes = require("./taskActionsRoutes");
const workflowRoutes = require("./workflowRoutes");
const planRoutes = require("./planRoutes");
const salesRoutes = require("./salesRoutes");
const hrRoutes = require("./hrRoutes");
const applyRoutes = require("./applyRoutes");
const systemRoutes = require("./systemRoutes");

router.use("/tasks", tasksRoutes);
router.use("/resume", resumeRoutes);
router.use("/parse-resume", resumeRoutes);
router.use("/analysis", analysisRoutes);
router.use("/task-actions", taskActionsRoutes);
router.use("/workflow", workflowRoutes);
router.use("/plan", planRoutes);
router.use("/sales", salesRoutes);
router.use("/hr", hrRoutes);
router.use("/apply", applyRoutes);
router.use("/system", systemRoutes);

module.exports = router;
