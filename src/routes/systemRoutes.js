const express = require("express");
const supabase = require("../db/supabase");
const WorkerEngine = require("../services/workerEngine");

const router = express.Router();

// POST /api/v2/system/run
router.post("/run", async (_req, res) => {
  try {
    const { data: pendingTasks, error } = await supabase
      .from("connected_tasks")
      .select("id, steps")
      .in("status", ["waiting_for_ceo", "pending", "Pending"]);

    if (error) throw error;

    if (!pendingTasks || pendingTasks.length === 0) {
      return res.json({ success: true, message: "No tasks to run" });
    }

    await supabase
      .from("connected_tasks")
      .update({ status: "running" })
      .in("id", pendingTasks.map((t) => t.id));

    pendingTasks.forEach((task) => {
      WorkerEngine.executeTask(task.id, task.steps || []).catch((workerErr) =>
        console.error(`[Worker Error] Task ${task.id}:`, workerErr)
      );
    });

    return res.json({ success: true, message: `Running ${pendingTasks.length} tasks` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/v2/system/seed
router.post("/seed", async (_req, res) => {
  try {
    const sampleTasks = [
      { title: "HR hiring sprint", description: "Screen incoming AI engineer profiles", department: "HR" },
      { title: "Sales outreach", description: "Prioritize enterprise leads for this week", department: "Sales" },
      { title: "Marketing content audit", description: "Analyze top-performing reels", department: "Marketing" },
    ];

    const { error } = await supabase.from("connected_tasks").insert(
      sampleTasks.map((task) => ({
        ...task,
        priority: "HIGH",
        status: "waiting_for_ceo",
        progress: 0,
        created_at: new Date().toISOString(),
      }))
    );

    if (error) throw error;
    return res.json({ success: true, message: "Sample tasks seeded" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
