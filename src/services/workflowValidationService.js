const allowedWorkflowsByType = {
  hr: new Set(["screen_candidate", "hiring_plan"]),
  sales: new Set(["instagram_viral_leads"]),
  marketing: new Set(["engagement_analysis"]),
  finance: new Set(["revenue_expense_summary", "budget_review", "invoice_followup"]),
  developer: new Set(["feature_build", "bug_fix", "bug_triage", "maintenance_plan"]),
  operations: new Set(["task_execution", "workflow_optimization", "incident_response"])
};

function ensureObject(payload) {
  return payload && typeof payload === "object" && !Array.isArray(payload);
}

function validatePayload(type, payload) {
  if (!ensureObject(payload)) {
    throw new Error("payload must be a JSON object");
  }

  const workflow = String(payload.workflow || "").toLowerCase();
  const allowed = allowedWorkflowsByType[type];
  if (!allowed) throw new Error(`unsupported task type: ${type}`);
  if (!allowed.has(workflow)) {
    throw new Error(`invalid workflow for ${type}: ${workflow || "missing workflow"}`);
  }

  if (type === "hr" && workflow === "screen_candidate") {
    if (!payload.candidate_description || !payload.job_role) {
      throw new Error("hr.screen_candidate requires candidate_description and job_role");
    }
  }

  if (type === "sales" && workflow === "instagram_viral_leads") {
    if (!payload.target_audience) {
      throw new Error("sales.instagram_viral_leads requires target_audience");
    }
  }

  if (type === "marketing" && workflow === "engagement_analysis") {
    if (!Array.isArray(payload.instagram_posts)) {
      throw new Error("marketing.engagement_analysis requires instagram_posts array");
    }
  }

  if (type === "finance" && workflow === "invoice_followup") {
    if (!Array.isArray(payload.invoices_due)) {
      throw new Error("finance.invoice_followup requires invoices_due array");
    }
  }

  if (type === "developer" && (workflow === "bug_fix" || workflow === "bug_triage")) {
    if (!payload.bug_report) {
      throw new Error("developer bug workflow requires bug_report");
    }
  }

  if (type === "operations" && workflow === "task_execution") {
    if (!Array.isArray(payload.task_items)) {
      throw new Error("operations.task_execution requires task_items array");
    }
  }
}

module.exports = { validatePayload };
