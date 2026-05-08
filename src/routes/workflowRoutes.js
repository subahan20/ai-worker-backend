const express = require("express");
const router = express.Router();
const supabase = require("../db/supabase");
const WorkerEngine = require("../services/workerEngine");

// POST /api/v2/workflow/:dept/run
router.post("/:dept/run", async (req, res) => {
  const { dept } = req.params;
  const deptName = dept.charAt(0).toUpperCase() + dept.slice(1);

  try {
    const { data: tasks, error } = await supabase
      .from("connected_tasks")
      .select("*")
      .eq("department", deptName)
      .eq("status", "PENDING");

    if (error) throw error;

    if (!tasks || tasks.length === 0) {
      return res.json({ success: true, message: `No pending tasks for ${deptName}.` });
    }

    tasks.forEach(task => {
      WorkerEngine.executeTask(task.id, task.steps || []).catch(err => 
        console.error(`[Worker] Failed for task ${task.id}:`, err)
      );
    });

    res.json({ success: true, message: `Started ${tasks.length} tasks for ${deptName}.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/v2/workflow/start
router.post("/start", async (req, res) => {
  try {
    const department = req.body?.department;
    if (!department) {
      return res.status(400).json({ error: "department is required" });
    }

    const deptName = String(department);
    const { data: tasks, error } = await supabase
      .from("connected_tasks")
      .select("id, steps")
      .eq("department", deptName)
      .in("status", ["waiting_for_ceo", "pending", "Pending"]);

    if (error) throw error;

    if (!tasks || tasks.length === 0) {
      return res.json({ success: true, message: `No tasks to start for ${deptName}.` });
    }

    await supabase
      .from("connected_tasks")
      .update({ status: "running" })
      .in("id", tasks.map((t) => t.id));

    tasks.forEach((task) => {
      WorkerEngine.executeTask(task.id, task.steps || []).catch((err) =>
        console.error(`[Worker] Failed for task ${task.id}:`, err)
      );
    });

    return res.json({ success: true, message: `Started ${tasks.length} tasks for ${deptName}.` });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
