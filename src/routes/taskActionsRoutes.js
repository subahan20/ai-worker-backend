const express = require("express");
const router = express.Router();
const supabase = require("../db/supabase");
const { generateDepartmentOverview } = require("../services/aiGeneratorService");

// POST /api/v2/task-actions/approve
router.post("/approve", async (req, res) => {
  try {
    const { data: mTasks } = await supabase.from("tasks").select("id").in("status", ["waiting_for_ceo", "pending", "Pending"]);
    const { data: cTasks } = await supabase.from("connected_tasks").select("id").in("status", ["waiting_for_ceo", "pending", "Pending"]);

    const mIds = mTasks?.map(t => t.id) || [];
    const cIds = cTasks?.map(t => t.id) || [];

    if (mIds.length === 0 && cIds.length === 0) {
      return res.json({ message: "No tasks to approve", count: 0 });
    }

    if (mIds.length > 0) {
      await supabase.from("tasks").update({ status: "running" }).in("id", mIds);
      triggerSimulation("tasks", mIds);
    }
    if (cIds.length > 0) {
      await supabase.from("connected_tasks").update({ status: "running" }).in("id", cIds);
      triggerSimulation("connected_tasks", cIds);
    }

    res.json({ message: `Approved ${mIds.length + cIds.length} tasks` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function triggerSimulation(table, ids) {
  (async () => {
    for (let progress = 5; progress <= 100; progress += 5) {
      await new Promise(r => setTimeout(r, 1000));
      const isComplete = progress === 100;
      await supabase.from(table).update({ progress, status: isComplete ? "Completed" : "running" }).in("id", ids);

      if (isComplete) {
        for (const taskId of ids) {
          const { data: task } = await supabase.from(table).select("*").eq("id", taskId).single();
          if (task) {
            const aiData = await generateDepartmentOverview(task.department || "General", task.title, task);
            await supabase.from("ai_overviews").insert({ task_id: taskId, ...aiData, raw_input_data: task });
            await supabase.from(table).update({ analysis: aiData }).eq("id", taskId);
          }
        }
      }
    }
  })();
}

module.exports = router;
