const express = require("express");
const router = express.Router();
const supabase = require("../db/supabase");
const { decideAgentByRules } = require("../services/assignmentService");
const resumeTaskInFlight = new Set();

function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/[,\n]/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function mapApplicantFields(task, app) {
  const metadata = task?.metadata || {};
  const parsed = app?.parsed_data || {};
  const parsedResume = metadata?.parsed_resume && typeof metadata.parsed_resume === "object" ? metadata.parsed_resume : {};
  const sanitizeName = (v) => {
    const s = String(v || "").trim();
    if (!s) return null;
    const low = s.toLowerCase();
    if (low === "processing..." || low === "unknown candidate" || low === "null") return null;
    return s;
  };
  const sanitizeEmail = (v) => {
    const s = String(v || "").trim();
    if (!s) return null;
    const low = s.toLowerCase();
    if (low === "parsing@ai.com" || low === "noreply@example.com" || low === "null") return null;
    return s;
  };
  return {
    applicantName: sanitizeName(app?.name || parsed?.name || metadata?.candidate_name || parsedResume?.name),
    applicantEmail: sanitizeEmail(app?.email || parsed?.email || metadata?.candidate_email || parsedResume?.email),
    applicantPhone: parsed?.phone || metadata?.candidate_phone || parsedResume?.phone || null,
    skills: toArray(parsed?.skills || metadata?.candidate_skills || parsedResume?.skills),
    experience: app?.experience || parsed?.experience || metadata?.candidate_experience || parsedResume?.experience || null,
    education: toArray(parsed?.education || metadata?.candidate_education || parsedResume?.education),
    summary: parsed?.summary || metadata?.candidate_summary || parsedResume?.summary || null,
    resumeUrl: app?.resume_url || task?.resume_url || null,
    parsedText: app?.extracted_text || parsed?.fullText || metadata?.parsed_text || parsedResume?.fullText || null,
    aiScore: task?.analysis?.match_score ?? metadata?.ai_score ?? null,
    aiSummary: task?.analysis?.details?.summary || metadata?.ai_summary || null,
    matchedSkills: toArray(task?.analysis?.matched_skills || metadata?.matched_skills),
    missingSkills: toArray(task?.analysis?.missing_skills || metadata?.missing_skills),
    parserStatus: metadata?.parser_status || null,
    parserError: metadata?.parser_error || null,
    createdAt: task?.created_at || null,
    type: task?.type || task?.department || null,
  };
}

// GET /api/tasks
router.get("/", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("connected_tasks")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    const tasks = data || [];

    const candidateIds = Array.from(
      new Set(
        tasks
          .map((task) => task.application_id || task?.analysis?.candidate_id)
          .filter(Boolean)
      )
    );

    let applicationsById = {};
    if (candidateIds.length > 0) {
      const { data: applications } = await supabase
        .from("applications")
        .select("id, name, email, role, experience, resume_url, extracted_text, parsed_data")
        .in("id", candidateIds);

      applicationsById = (applications || []).reduce((acc, app) => {
        acc[app.id] = app;
        return acc;
      }, {});
    }

    const enriched = tasks.map((task) => {
      const candidateId = task.application_id || task?.analysis?.candidate_id || null;
      const app = candidateId ? applicationsById[candidateId] : null;
      if (!app) {
        const applicant = mapApplicantFields(task, null);
        return {
          ...task,
          name: applicant.applicantName,
          email: applicant.applicantEmail,
          ...applicant,
        };
      }

      const applicant = mapApplicantFields(task, app);
      return {
        ...task,
        application_id: candidateId,
        name: applicant.applicantName,
        email: applicant.applicantEmail,
        ...applicant,
        candidate_profile: {
          id: app.id,
          name: app.name || app?.parsed_data?.name || null,
          email: app.email || app?.parsed_data?.email || null,
          role: app.role || null,
          experience: app.experience || app?.parsed_data?.experience || null,
          resume_url: app.resume_url || null,
          parsed_data: app.parsed_data || {},
        },
      };
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks
router.post("/", async (req, res) => {
  try {
    const { title, description, department, priority, tasks, details } = req.body;

    // Legacy payload support: { department, tasks: [], details }
    if (department && Array.isArray(tasks) && tasks.length > 0) {
      const insertRows = tasks
        .filter((t) => String(t || "").trim().length > 0)
        .map((taskTitle) => ({
          title: String(taskTitle).trim(),
          description: `Manual assignment: ${department} workflow`,
          department,
          priority: priority || "HIGH",
          status: "waiting_for_ceo",
          progress: 0,
          metadata: details || {},
          steps: [String(taskTitle).trim()],
          created_at: new Date().toISOString(),
        }));

      if (insertRows.length === 0) {
        return res.status(400).json({ error: "No valid tasks provided" });
      }

      const { data, error } = await supabase
        .from("connected_tasks")
        .insert(insertRows)
        .select("*");

      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ success: true, data: data.map(toLegacyTaskShape) });
    }

    if (!title || !description || !department || !priority) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const { data, error } = await supabase
      .from("connected_tasks")
      .insert([{ 
        title, 
        description, 
        department, 
        priority, 
        status: "waiting_for_ceo", 
        progress: 0,
        created_at: new Date().toISOString() 
      }])
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const WorkerEngine = require("../services/workerEngine");

function toLegacyTaskShape(task) {
  return {
    _id: task.id,
    id: task.id,
    department: task.department,
    tasks: Array.isArray(task.steps) && task.steps.length > 0 ? task.steps : [task.title || task.description || "Task"],
    status: task.status || "pending",
    createdAt: task.created_at,
    workflow: (task.steps || []).map((step, index) => ({
      step,
      status: index <= (task.current_step || 0) ? "in_progress" : "pending",
      progress: task.progress || 0,
    })),
    details: task.metadata || {},
  };
}

// POST /api/tasks/approve
router.post("/approve", async (req, res) => {
  try {
    // 1. Get all pending tasks
    const { data: pendingTasks, error: fetchError } = await supabase
      .from("connected_tasks")
      .select("id, steps")
      .eq("status", "waiting_for_ceo");

    if (fetchError) throw fetchError;

    if (!pendingTasks || pendingTasks.length === 0) {
      return res.json({ success: true, message: "No tasks to approve" });
    }

    // 2. Approve them in the DB
    const { error: updateError } = await supabase
      .from("connected_tasks")
      .update({ status: "running" })
      .eq("status", "waiting_for_ceo");

    if (updateError) throw updateError;

    // 3. Start simulation for each task in the background
    pendingTasks.forEach(task => {
      WorkerEngine.executeTask(task.id, task.steps || []).catch(err => 
        console.error(`[Worker Error] Task ${task.id}:`, err)
      );
    });

    res.json({ success: true, message: `Approved ${pendingTasks.length} tasks and started simulation.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks/assign
router.post("/assign", async (req, res) => {
  try {
    const { description = "" } = req.body || {};
    if (!description.trim()) {
      return res.status(400).json({ error: "description is required" });
    }

    const agent = decideAgentByRules({ title: description, description });
    const departmentMap = {
      HR_AGENT: "HR",
      SALES_AGENT: "Sales",
      MARKETING_AGENT: "Marketing",
      FINANCE_AGENT: "Finance",
      DEVELOPER_AGENT: "Developer",
      OPERATIONS_AGENT: "Operations",
    };
    const department = departmentMap[agent] || "Operations";

    return res.json({
      success: true,
      department,
      task_title: description.slice(0, 80),
      priority: "HIGH",
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks/from-resume
router.post("/from-resume", async (req, res) => {
  try {
    const { applicationId, resumeUrl, parsedData, department = "HR", title, description } = req.body || {};
    if (!applicationId || !parsedData || typeof parsedData !== "object") {
      return res.status(400).json({ error: "applicationId and parsedData are required" });
    }
    if (resumeTaskInFlight.has(applicationId)) {
      console.log("[tasks/from-resume] duplicate attempt blocked", { applicationId });
      return res.status(202).json({ success: true, duplicate: true, message: "Task sync already in progress" });
    }
    resumeTaskInFlight.add(applicationId);

    const parsedText = String(parsedData?.fullText || "").trim();
    if (!parsedText || parsedText.length < 80) {
      return res.status(422).json({
        error: "Resume text extraction failed. Task creation aborted.",
        parserStatus: "failed",
      });
    }

    const applicantName = String(parsedData?.name || "").trim();
    const applicantEmail = String(parsedData?.email || "").trim();
    const applicantPhone = String(parsedData?.phone || "").trim();
    const applicantExperience = String(parsedData?.experience || "").trim();
    const applicantSkills = toArray(parsedData?.skills);
    const applicantEducation = toArray(parsedData?.education);
    const applicantSummary = String(parsedData?.summary || "").trim();

    if (!applicantName && !applicantEmail) {
      return res.status(422).json({
        error: "Parsed resume is missing candidate name/email. Task creation aborted.",
        parserStatus: "failed",
      });
    }

    const metadata = {
      candidate_name: applicantName || null,
      candidate_email: applicantEmail || null,
      candidate_phone: applicantPhone || null,
      candidate_experience: applicantExperience || null,
      candidate_skills: applicantSkills,
      candidate_education: applicantEducation,
      candidate_summary: applicantSummary || null,
      candidate_score: Number.isFinite(Number(parsedData?.score)) ? Number(parsedData?.score) : null,
      parsed_resume: parsedData,
      parsed_text: parsedText,
      extracted_keywords: toArray(parsedData?.extracted_keywords),
      parser_status: "success",
      parser_error: null,
      ai_score: null,
      ai_summary: null,
      matched_skills: [],
      missing_skills: [],
    };
    console.log("[tasks/from-resume] task payload", {
      applicationId,
      department,
      applicantName,
      applicantEmail,
      parsedTextLength: parsedText.length,
      skillsCount: applicantSkills.length,
    });

    const { data: existingTasks } = await supabase
      .from("connected_tasks")
      .select("*")
      .eq("application_id", applicationId)
      .eq("department", department)
      .order("created_at", { ascending: false })
      .limit(20);
    const taskRows = existingTasks || [];
    const existingTask = taskRows.find((t) =>
      String(t?.title || "").toLowerCase().startsWith("resume review:") ||
      Boolean(t?.metadata?.parsed_text)
    ) || taskRows[0];

    if (existingTask) {
      const { data: updated, error: updateError } = await supabase
        .from("connected_tasks")
        .update({
          title: title || existingTask.title || `Resume Review: ${applicantName || "Candidate"}`,
          description: description || existingTask.description || "Parsed resume details synced from parser.",
          metadata,
        })
        .eq("id", existingTask.id)
        .select("*")
        .single();
      if (updateError) throw updateError;
      resumeTaskInFlight.delete(applicationId);
      return res.json({ success: true, mode: "updated", task: updated });
    }

    const { data: inserted, error: insertError } = await supabase
      .from("connected_tasks")
      .insert([{
        title: title || `Resume Review: ${applicantName || "Candidate"}`,
        description: description || "Parsed resume details synced from parser.",
        department,
        status: "waiting_for_ceo",
        priority: "HIGH",
        progress: 0,
        application_id: applicationId,
        metadata,
        created_at: new Date().toISOString(),
      }])
      .select("*")
      .single();
    if (insertError) throw insertError;
    resumeTaskInFlight.delete(applicationId);
    return res.status(201).json({ success: true, mode: "created", task: inserted });
  } catch (err) {
    const applicationId = req?.body?.applicationId;
    if (applicationId) resumeTaskInFlight.delete(applicationId);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks/execute
router.post("/execute", async (_req, res) => {
  try {
    const { data: pendingTasks, error } = await supabase
      .from("connected_tasks")
      .select("id, steps")
      .in("status", ["waiting_for_ceo", "pending", "Pending"]);

    if (error) throw error;

    if (!pendingTasks || pendingTasks.length === 0) {
      return res.json({ success: true, message: "No tasks to execute" });
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

    return res.json({ success: true, message: `Started ${pendingTasks.length} tasks` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tasks/reset
router.delete("/reset", async (_req, res) => {
  try {
    const { error } = await supabase.from("connected_tasks").delete().neq("id", "");
    if (error) throw error;
    return res.json({ success: true, message: "System reset complete" });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/tasks/:id/execute
router.post("/:id/execute", async (req, res) => {
  try {
    const { id } = req.params;
    const { data: task, error } = await supabase
      .from("connected_tasks")
      .select("id, steps")
      .eq("id", id)
      .single();

    if (error || !task) {
      return res.status(404).json({ error: "Task not found" });
    }

    WorkerEngine.executeTask(task.id, task.steps || []).catch((workerErr) =>
      console.error(`[Worker Error] Task ${task.id}:`, workerErr)
    );

    return res.json({ success: true, message: "Task execution started" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/tasks/:id
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { data: task, error } = await supabase
      .from("connected_tasks")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !task) {
      return res.status(404).json({ success: false, error: "Task not found" });
    }

    return res.json({ success: true, data: toLegacyTaskShape(task) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/tasks/:id
router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, stepIndex, stepStatus } = req.body || {};

    const { data: task, error } = await supabase
      .from("connected_tasks")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !task) {
      return res.status(404).json({ success: false, error: "Task not found" });
    }

    const nextStatus = status || task.status;
    let nextProgress = task.progress || 0;
    let nextCurrentStep = task.current_step || 0;

    if (typeof stepIndex === "number" && stepStatus === "completed") {
      nextCurrentStep = stepIndex;
      const totalSteps = Array.isArray(task.steps) && task.steps.length > 0 ? task.steps.length : 1;
      nextProgress = Math.min(100, Math.round(((stepIndex + 1) / totalSteps) * 100));
    }

    const { data: updated, updateError } = await supabase
      .from("connected_tasks")
      .update({
        status: nextStatus,
        progress: nextProgress,
        current_step: nextCurrentStep,
      })
      .eq("id", id)
      .select("*")
      .single();

    if (updateError || !updated) {
      return res.status(500).json({ success: false, error: updateError?.message || "Update failed" });
    }

    return res.json({ success: true, data: toLegacyTaskShape(updated) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
