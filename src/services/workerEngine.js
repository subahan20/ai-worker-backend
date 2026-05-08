const supabase = require("../db/supabase");

class WorkerEngine {
  static async executeTask(taskId, steps) {
    // Default steps for simulation if none provided
    const executionSteps = (steps && steps.length > 0) ? steps : [
      "Initializing environment",
      "Analyzing requirements",
      "Executing primary objectives",
      "Validating results",
      "Finalizing documentation"
    ];

    await supabase
      .from("connected_tasks")
      .update({ status: "running", current_step: 0 })
      .eq("id", taskId);

    for (let i = 0; i < executionSteps.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const progress = Math.round(((i + 1) / executionSteps.length) * 100);
      
      await supabase
        .from("connected_tasks")
        .update({ 
          current_step: i, 
          status: "running",
          progress: progress
        })
        .eq("id", taskId);
        
      console.log(`[Worker] Task ${taskId} - Step ${i + 1}/${steps.length} (${progress}%)`);
    }

    await supabase
      .from("connected_tasks")
      .update({ status: "completed", progress: 100 })
      .eq("id", taskId);
      
    console.log(`[Worker] Task ${taskId} successfully completed.`);
  }
}

module.exports = WorkerEngine;
