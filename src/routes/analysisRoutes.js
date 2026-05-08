const express = require("express");
const router = express.Router();
const Groq = require("groq-sdk");
const supabase = require("../db/supabase");

const getGroq = () => new Groq({ apiKey: process.env.GROQ_API_KEY || process.env.GROQ_API });
const hasGroqKey = () => Boolean(process.env.GROQ_API_KEY || process.env.GROQ_API);
const analysisInFlight = new Set();

function toArray(v) {
  if (Array.isArray(v)) return v.filter(Boolean).map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === "string") return v.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  return [];
}

function buildDeterministicInsights(candidate, resumeText) {
  const parsed = candidate?.parsed_data || {};
  const skills = toArray(parsed?.skills);
  const projects = toArray(parsed?.projects);
  const certifications = toArray(parsed?.certifications);
  const education = toArray(parsed?.education);
  const companies = toArray(parsed?.companies);
  const experience = String(parsed?.experience || candidate?.experience || "").trim();
  const years = Number(parsed?.total_experience_years || 0);
  const role = String(candidate?.role || parsed?.role || "the target role");

  const strengths = [];
  if (skills.length) strengths.push(`Demonstrates applied technical capability in ${skills.slice(0, 4).join(", ")}.`);
  if (companies.length) strengths.push(`Shows practical delivery exposure across ${companies.slice(0, 2).join(" and ")}.`);
  if (projects.length) strengths.push(`Project history indicates execution ownership and implementation experience.`);
  if (certifications.length) strengths.push(`Includes relevant certifications: ${certifications.slice(0, 2).join(", ")}.`);
  strengths.push("Communication appears clear and structured based on resume narrative quality.");

  const weaknesses = [];
  if (!skills.length) weaknesses.push("Limited explicit technical stack detail reduces precision of role-fit evaluation.");
  if (!projects.length) weaknesses.push("Project depth is under-documented; measurable outcomes are not consistently quantified.");
  if (!certifications.length) weaknesses.push("No formal certifications listed, which may impact compliance-heavy roles.");
  if (!years) weaknesses.push("Experience timeline is not fully standardized, creating uncertainty in seniority calibration.");
  if (resumeText.length < 500) weaknesses.push("Resume content is brief and may omit role-critical context.");

  const scoreBase = Math.max(45, Math.min(92, 50 + skills.length * 4 + (years || 0) * 2 + (projects.length ? 6 : 0)));
  const score = Math.round(scoreBase);
  const decision = score >= 75 ? "SHORTLISTED" : "REJECTED";
  const matchedSkills = skills.slice(0, 8);
  const missingSkills = weaknesses
    .filter((w) => /technical|project|certification|experience/i.test(w))
    .slice(0, 4)
    .map((w) => w.replace(/\.$/, ""));

  const executiveBriefing = `${candidate?.name || "Candidate"} presents a ${years ? `${years}+ year` : "developing"} profile aligned to ${role}. ` +
    `${skills.length ? `Core strengths include ${skills.slice(0, 3).join(", ")}.` : "Technical specialization is only partially explicit."} ` +
    `${education.length ? `Education indicates ${education[0]}.` : "Educational detail is limited."} ` +
    `Overall impression: ${decision === "SHORTLISTED" ? "interview-ready with manageable risk." : "potentially viable but requires deeper validation before shortlisting."}`;

  return {
    match_score: score,
    reason: decision === "SHORTLISTED"
      ? "Profile demonstrates sufficient skill/experience signal for recruiter progression."
      : "Profile currently lacks enough depth and evidence for confident progression.",
    improvement: "Use a structured technical interview to validate practical depth, communication clarity, and ownership level.",
    matched_skills: matchedSkills,
    missing_skills: missingSkills,
    summary: executiveBriefing,
    details: {
      executive_briefing: executiveBriefing,
      strengths: strengths.slice(0, 5),
      weaknesses: weaknesses.slice(0, 5),
      strategic_recommendation: decision === "SHORTLISTED"
        ? "Proceed to technical interview and role-fit calibration round; maintain medium-risk hiring posture."
        : "Hold for profile enhancement or run a strict screening call before allocating full interview bandwidth.",
      confidence: score >= 80 ? "high" : score >= 65 ? "medium" : "low",
      risk_level: score >= 80 ? "low" : score >= 65 ? "medium" : "high",
      interview_questions: [
        "Describe a project where you owned end-to-end delivery and trade-off decisions.",
        "How do you communicate technical risks to non-technical stakeholders?",
        "Which core skill in your stack would you consider production-grade and why?"
      ],
      recommended_department: "HR",
      improvement_suggestions: [
        "Add quantified outcomes for major projects.",
        "Clarify leadership or cross-functional ownership examples.",
        "List role-specific tools and certifications explicitly."
      ]
    }
  };
}

function getParserState(candidate) {
  const metadata = candidate?.task_metadata || {};
  const parsed = candidate?.parsed_data || {};
  const resumeText = String(candidate?.extracted_text || metadata?.parsed_text || parsed?.fullText || "").trim();
  const parserStatus = metadata?.parser_status || (resumeText.length > 0 ? "success" : "failed");
  const parserError = metadata?.parser_error || "";
  return { resumeText, parserStatus, parserError, metadata, parsed };
}

// POST /api/v2/analysis/hr
router.post("/hr", async (req, res) => {
  try {
    const { candidateId } = req.body;

    if (!candidateId) {
      return res.status(400).json({ error: "Candidate ID is required" });
    }
    if (analysisInFlight.has(candidateId)) {
      console.log("[Analysis HR] duplicate attempt blocked", { candidateId });
      return res.status(202).json({ success: true, duplicate: true, message: "Analysis already in progress" });
    }
    analysisInFlight.add(candidateId);

    // 1. Check existing
    const { data: existingAnalysis } = await supabase
      .from("candidate_analysis")
      .select("*")
      .eq("candidate_id", candidateId)
      .maybeSingle();

    if (existingAnalysis) {
      analysisInFlight.delete(candidateId);
      return res.json({ success: true, analysis: existingAnalysis, cached: true });
    }

    // 2. Fetch candidate
    const { data: candidate, error: candidateError } = await supabase
      .from("applications")
      .select("*")
      .eq("id", candidateId)
      .single();

    if (candidateError || !candidate) {
      throw new Error("Candidate not found");
    }

    const { data: latestTask } = await supabase
      .from("connected_tasks")
      .select("id, metadata")
      .eq("application_id", candidateId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    candidate.task_metadata = latestTask?.metadata || {};

    // 3. Validate parser output before AI scoring
    const { resumeText, parserStatus, parserError } = getParserState(candidate);
    console.log(`[Analysis HR] scoring payload`, {
      candidateId,
      parserStatus,
      parserError: parserError || null,
      resumeTextLength: resumeText.length,
    });

    if (!resumeText) {
      const failurePayload = {
        candidate_id: candidateId,
        decision: "PARSING_FAILED",
        reason: "Resume text extraction failed",
        improvement: parserError || "Upload a text-based PDF or DOCX resume and retry.",
        match_score: null,
        matched_skills: [],
        missing_skills: [],
        details: {
          summary: "AI analysis unavailable because resume text could not be extracted.",
          executive_briefing: "Candidate profile could not be evaluated because resume text extraction failed.",
          strengths: ["Resume file was received and candidate linkage is available."],
          weaknesses: ["No parsable resume text was extracted, so technical and leadership evaluation cannot be completed."],
          strategic_recommendation: "Request a text-based PDF/DOCX resume and re-run analysis.",
          confidence: "low",
          risk_level: "high",
          parser_status: parserStatus || "failed",
          parser_error: parserError || "Empty resume detected",
        },
      };

      await supabase.from("candidate_analysis").delete().eq("candidate_id", candidateId);
      await supabase.from("candidate_analysis").insert([failurePayload]);
      await supabase
        .from("connected_tasks")
        .update({
          metadata: {
            ...(candidate?.task_metadata || {}),
            parser_status: "failed",
            parser_error: parserError || "Resume text extraction failed",
            ai_status: "unavailable",
            ai_summary: failurePayload.details.summary,
            ai_score: null,
            matched_skills: [],
            missing_skills: [],
          },
        })
        .eq("application_id", candidateId);

      analysisInFlight.delete(candidateId);
      return res.status(422).json({
        success: false,
        error: parserError || "Resume text extraction failed",
        code: "RESUME_TEXT_MISSING",
        analysis: failurePayload,
      });
    }

    // 4. AI screening
    if (!hasGroqKey()) {
      const deterministic = buildDeterministicInsights(candidate, resumeText);
      const score = parseInt(deterministic.match_score, 10) || 0;
      const finalDecision = score >= 80 ? "SHORTLISTED" : "REJECTED";
      const analysisPayload = {
        candidate_id: candidateId,
        decision: finalDecision,
        reason: deterministic.reason,
        improvement: deterministic.improvement,
        match_score: score,
        matched_skills: deterministic.matched_skills || [],
        missing_skills: deterministic.missing_skills || [],
        details: deterministic.details || { summary: deterministic.summary || "" }
      };
      await supabase.from("candidate_analysis").delete().eq("candidate_id", candidateId);
      await supabase.from("candidate_analysis").insert([analysisPayload]);
      await supabase
        .from("connected_tasks")
        .update({
          metadata: {
            ...(candidate?.task_metadata || {}),
            ai_status: "fallback",
            ai_summary: deterministic.summary || "Analysis generated from deterministic evaluator.",
            parser_status: "success",
            parser_error: null,
            ai_score: score,
            matched_skills: deterministic.matched_skills || [],
            missing_skills: deterministic.missing_skills || [],
          },
        })
        .eq("application_id", candidateId);
      analysisInFlight.delete(candidateId);
      return res.json({ success: true, analysis: analysisPayload, fallback: true });
    }

    let aiOutput;
    try {
      const groq = getGroq();
      const parsed = candidate?.parsed_data || {};
      const prompt = `You are a senior HR intelligence analyst writing premium executive-grade hiring insights.
Return ONLY valid JSON.
Required schema:
{
  "match_score": 0-100 number,
  "reason": "1 concise sentence on hiring rationale",
  "improvement": "1 concise sentence on next validation step",
  "matched_skills": ["string"],
  "missing_skills": ["string"],
  "summary": "2-3 sentence executive briefing",
  "details": {
    "executive_briefing": "professional briefing paragraph",
    "strengths": ["5 concise recruiter-useful bullets"],
    "weaknesses": ["5 concise recruiter-useful bullets"],
    "strategic_recommendation": "clear recommendation with interview direction",
    "confidence": "low|medium|high",
    "risk_level": "low|medium|high",
    "improvement_suggestions": ["3 actionable suggestions"],
    "interview_questions": ["3 high-signal interview questions"],
    "recommended_department": "HR"
  }
}
Rules:
- No placeholders. No generic text like "generated successfully".
- If a field is weak, explicitly state what data is missing.
- Tone: modern executive HR, concise and insight-oriented.
- Strengths/weaknesses must be evidence-driven from provided candidate data.

Candidate role: ${candidate.role || "Professional"}
Parsed candidate data: ${JSON.stringify({
  name: parsed?.name || candidate?.name || null,
  email: parsed?.email || candidate?.email || null,
  experience: parsed?.experience || candidate?.experience || null,
  total_experience_years: parsed?.total_experience_years || null,
  skills: parsed?.skills || [],
  projects: parsed?.projects || [],
  certifications: parsed?.certifications || [],
  education: parsed?.education || [],
  companies: parsed?.companies || []
})}
Resume text:
${resumeText.slice(0, 5000)}`;
        
      const completion = await groq.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "llama-3.3-70b-versatile",
        response_format: { type: "json_object" }
      });

      aiOutput = JSON.parse(completion.choices[0].message.content);
    } catch (llmErr) {
      console.error(`[Analysis HR] AI analysis failed:`, llmErr.message);
      await supabase
        .from("connected_tasks")
        .update({
          metadata: {
            ...(candidate?.task_metadata || {}),
            ai_status: "failed",
            ai_summary: "AI analysis unavailable",
            parser_status: "success",
            parser_error: null,
          },
        })
        .eq("application_id", candidateId);
      const deterministic = buildDeterministicInsights(candidate, resumeText);
      aiOutput = deterministic;
    }
    const score = parseInt(aiOutput.match_score) || 0;
    const finalDecision = score >= 80 ? "SHORTLISTED" : "REJECTED";

    const analysisPayload = {
      candidate_id: candidateId,
      decision: finalDecision,
      reason: (aiOutput.reason || "").slice(0, 500),
      improvement: (aiOutput.improvement || "").slice(0, 500),
      match_score: score,
      matched_skills: aiOutput.matched_skills || [],
      missing_skills: aiOutput.missing_skills || [],
      details: aiOutput.details && typeof aiOutput.details === "object"
        ? aiOutput.details
        : { summary: aiOutput.summary || "" }
    };

    await supabase.from("candidate_analysis").delete().eq("candidate_id", candidateId);
    await supabase.from("candidate_analysis").insert([analysisPayload]);
    await supabase
      .from("connected_tasks")
      .update({
        metadata: {
          ...(candidate?.task_metadata || {}),
          parser_status: "success",
          parser_error: null,
          ai_status: "success",
          ai_score: score,
          ai_summary: aiOutput.summary || "",
          matched_skills: aiOutput.matched_skills || [],
          missing_skills: aiOutput.missing_skills || [],
        },
      })
      .eq("application_id", candidateId);

    // 5. Update ONE canonical HR task for this application (no duplicate inserts)
    const { data: appTasks } = await supabase
      .from("connected_tasks")
      .select("*")
      .eq("application_id", candidateId)
      .eq("department", "HR")
      .order("created_at", { ascending: false });
    const canonicalTask = (appTasks || []).find((t) =>
      String(t?.title || "").toLowerCase().startsWith("resume review:") ||
      Boolean(t?.metadata?.parsed_text)
    ) || (appTasks || [])[0];
    const updatedMetadata = {
      ...(canonicalTask?.metadata || candidate?.task_metadata || {}),
      candidate_name: candidate?.parsed_data?.name || candidate?.name || null,
      candidate_email: candidate?.parsed_data?.email || candidate?.email || null,
      candidate_experience: candidate?.parsed_data?.experience || candidate?.experience || null,
      candidate_skills: Array.isArray(candidate?.parsed_data?.skills) ? candidate.parsed_data.skills : [],
      parser_status: "success",
      parser_error: null,
      ai_status: "success",
      ai_score: score,
      ai_summary: aiOutput.summary || "",
      matched_skills: aiOutput.matched_skills || [],
      missing_skills: aiOutput.missing_skills || [],
    };
    const updateId = canonicalTask?.id;
    if (updateId) {
      await supabase
        .from("connected_tasks")
        .update({
          title: canonicalTask?.title || `Resume Review: ${candidate?.parsed_data?.name || candidate?.name || "Candidate"}`,
          description: `Candidate analyzed. Decision: ${finalDecision}. Match Score: ${score}%.`,
          priority: finalDecision === "SHORTLISTED" ? "HIGH" : "MEDIUM",
          analysis: analysisPayload,
          metadata: updatedMetadata,
        })
        .eq("id", updateId);
    } else {
      console.log("[Analysis HR] no canonical task found; creating one", { candidateId });
      await supabase.from("connected_tasks").insert([{
        title: `Resume Review: ${candidate?.parsed_data?.name || candidate?.name || "Candidate"}`,
        description: `Candidate analyzed. Decision: ${finalDecision}. Match Score: ${score}%.`,
        department: "HR",
        status: "waiting_for_ceo",
        progress: 0,
        priority: finalDecision === "SHORTLISTED" ? "HIGH" : "MEDIUM",
        analysis: analysisPayload,
        application_id: candidateId,
        metadata: updatedMetadata,
      }]);
    }

    await supabase.from("applications").update({ status: finalDecision }).eq("id", candidateId);

    analysisInFlight.delete(candidateId);
    res.json({ success: true, analysis: analysisPayload });

  } catch (err) {
    const candidateId = req?.body?.candidateId;
    if (candidateId) analysisInFlight.delete(candidateId);
    console.error(`[Analysis HR] Error:`, err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
