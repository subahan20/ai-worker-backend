const express = require("express");
const Groq = require("groq-sdk");
const supabase = require("../db/supabase");

const router = express.Router();
const hrAnalyzeInFlight = new Set();

const getGroq = () => new Groq({ apiKey: process.env.GROQ_API_KEY || process.env.GROQ_API });
const hasGroqKey = () => Boolean(process.env.GROQ_API_KEY || process.env.GROQ_API);

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
  const experience = String(parsed?.experience || candidate?.experience || "").trim();
  const years = Number(parsed?.total_experience_years || 0);
  const role = String(candidate?.role || parsed?.role || "the target role");
  const score = Math.round(Math.max(45, Math.min(90, 50 + skills.length * 4 + (years || 0) * 2 + (projects.length ? 6 : 0))));
  const decision = score >= 75 ? "SHORTLISTED" : "REJECTED";
  const summary = `${candidate?.name || "Candidate"} shows ${years ? `${years}+ years of` : "early-stage"} experience aligned to ${role}. ` +
    `${skills.length ? `Core stack includes ${skills.slice(0, 3).join(", ")}.` : "Technical stack detail is limited in the resume."} ` +
    `${experience ? "Experience narrative is present and can be validated in interview." : "Experience narrative is under-documented."}`;

  return {
    match_score: score,
    reason: decision === "SHORTLISTED" ? "Candidate demonstrates sufficient baseline signal for progression." : "Candidate profile needs deeper validation before progression.",
    improvement: "Run a structured technical + behavioral interview to validate delivery depth and communication quality.",
    matched_skills: skills.slice(0, 8),
    missing_skills: [
      ...(!skills.length ? ["Role-specific technical stack"] : []),
      ...(!projects.length ? ["Documented project outcomes"] : []),
      ...(!certifications.length ? ["Relevant certifications"] : [])
    ].slice(0, 4),
    summary,
    details: {
      executive_briefing: summary,
      strengths: [
        skills.length ? `Technical strengths: ${skills.slice(0, 4).join(", ")}.` : "Resume structure is clear and readable for screening.",
        experience ? "Experience section provides role continuity signal." : "Candidate has identifiable role intent.",
        education.length ? `Education context available: ${education[0]}.` : "Baseline qualification context present."
      ],
      weaknesses: [
        !projects.length ? "Project depth lacks measurable outcomes and impact metrics." : "Project complexity needs interview validation.",
        !certifications.length ? "No certifications listed for additional credibility." : "Certifications should be mapped to role requirements."
      ],
      strategic_recommendation: decision === "SHORTLISTED"
        ? "Proceed to technical round with moderate-risk posture and competency-focused evaluation."
        : "Run a short screening interview first; proceed only if role-critical depth is demonstrated.",
      confidence: score >= 80 ? "high" : score >= 65 ? "medium" : "low",
      risk_level: score >= 80 ? "low" : score >= 65 ? "medium" : "high",
      interview_questions: [
        "Which project best demonstrates your ownership and measurable impact?",
        "How do you prioritize quality vs delivery speed under tight timelines?",
        "What technical decision did you make recently and why?"
      ],
      recommended_department: "HR",
      improvement_suggestions: [
        "Add quantified outcomes for top projects.",
        "Expand technology/tool depth per role.",
        "Clarify leadership and cross-functional collaboration examples."
      ]
    }
  };
}

// POST /api/v2/hr/analyze
router.post("/analyze", async (req, res) => {
  try {
    const candidateId = req.body?.candidateId || req.body?.applicationId;
    if (!candidateId) {
      return res.status(400).json({ error: "candidateId is required" });
    }
    if (hrAnalyzeInFlight.has(candidateId)) {
      console.log("[HR Analyze] duplicate attempt blocked", { candidateId });
      return res.status(202).json({ success: true, duplicate: true, message: "Analysis already in progress" });
    }
    hrAnalyzeInFlight.add(candidateId);

    const { data: existingAnalysis } = await supabase
      .from("candidate_analysis")
      .select("*")
      .eq("candidate_id", candidateId)
      .maybeSingle();

    if (existingAnalysis) {
      hrAnalyzeInFlight.delete(candidateId);
      return res.json({ success: true, analysis: existingAnalysis, cached: true });
    }

    const { data: candidate, error: candidateError } = await supabase
      .from("applications")
      .select("*")
      .eq("id", candidateId)
      .single();

    if (candidateError || !candidate) {
      return res.status(404).json({ error: "Candidate not found" });
    }

    const resumeText = String(candidate?.extracted_text || "").trim();
    if (!resumeText) {
      hrAnalyzeInFlight.delete(candidateId);
      return res.status(422).json({
        success: false,
        code: "RESUME_TEXT_MISSING",
        error: "Resume text extraction failed",
      });
    }
    if (!hasGroqKey()) {
      const aiOutput = buildDeterministicInsights(candidate, resumeText);
      const score = parseInt(aiOutput.match_score, 10) || 0;
      const decision = score >= 80 ? "SHORTLISTED" : "REJECTED";
      const analysisPayload = {
        candidate_id: candidateId,
        decision,
        reason: (aiOutput.reason || "").slice(0, 500),
        improvement: (aiOutput.improvement || "").slice(0, 500),
        match_score: score,
        matched_skills: aiOutput.matched_skills || [],
        missing_skills: aiOutput.missing_skills || [],
        details: aiOutput.details || { summary: aiOutput.summary || "" },
      };
      await supabase.from("candidate_analysis").delete().eq("candidate_id", candidateId);
      await supabase.from("candidate_analysis").insert([analysisPayload]);
      await supabase.from("applications").update({ status: decision }).eq("id", candidateId);
      hrAnalyzeInFlight.delete(candidateId);
      return res.json({ success: true, analysis: analysisPayload, fallback: true });
    }

    let aiOutput;
    try {
      const parsed = candidate?.parsed_data || {};
      const prompt = `You are an executive HR intelligence writer. Return ONLY valid JSON.
Schema:
{
  "match_score": 0-100,
  "reason": "short rationale",
  "improvement": "next best validation action",
  "matched_skills": ["string"],
  "missing_skills": ["string"],
  "summary": "executive briefing",
  "details": {
    "executive_briefing": "paragraph",
    "strengths": ["string"],
    "weaknesses": ["string"],
    "strategic_recommendation": "string",
    "confidence": "low|medium|high",
    "risk_level": "low|medium|high",
    "improvement_suggestions": ["string"],
    "interview_questions": ["string"],
    "recommended_department": "HR"
  }
}
Candidate metadata: ${JSON.stringify({
  role: candidate.role || null,
  skills: parsed?.skills || [],
  projects: parsed?.projects || [],
  experience: parsed?.experience || candidate?.experience || null,
  education: parsed?.education || [],
  certifications: parsed?.certifications || []
})}
Resume text:
${resumeText.slice(0, 4500)}`;

      const completion = await getGroq().chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "llama-3.3-70b-versatile",
        response_format: { type: "json_object" },
      });

      aiOutput = JSON.parse(completion.choices[0].message.content);
    } catch (llmErr) {
      console.error(`[HR Analyze] AI analysis failed:`, llmErr.message);
      aiOutput = buildDeterministicInsights(candidate, resumeText);
    }
    const score = parseInt(aiOutput.match_score, 10) || 0;
    const decision = score >= 80 ? "SHORTLISTED" : "REJECTED";

    const analysisPayload = {
      candidate_id: candidateId,
      decision,
      reason: (aiOutput.reason || "").slice(0, 500),
      improvement: (aiOutput.improvement || "").slice(0, 500),
      match_score: score,
      matched_skills: aiOutput.matched_skills || [],
      missing_skills: aiOutput.missing_skills || [],
      details: { summary: aiOutput.summary || "" },
    };

    await supabase.from("candidate_analysis").delete().eq("candidate_id", candidateId);
    await supabase.from("candidate_analysis").insert([analysisPayload]);
    await supabase.from("applications").update({ status: decision }).eq("id", candidateId);

    hrAnalyzeInFlight.delete(candidateId);
    return res.json({ success: true, analysis: analysisPayload });
  } catch (err) {
    const candidateId = req?.body?.candidateId || req?.body?.applicationId;
    if (candidateId) hrAnalyzeInFlight.delete(candidateId);
    return res.status(500).json({ error: err.message });
  }
});

// GET/POST /api/v2/hr/report/generate
async function generateHrReport(_req, res) {
  try {
    const { data: rows, error } = await supabase
      .from("candidate_analysis")
      .select("candidate_id, decision, match_score, reason, matched_skills, details, applications(name, role)")
      .in("decision", ["SHORTLISTED", "SELECTED", "HIRE"])
      .order("match_score", { ascending: false });

    if (error) throw error;

    const shortlisted = (rows || []).map((row) => ({
      id: row.candidate_id,
      name: row.applications?.name || "Candidate",
      role: row.applications?.role || "Unspecified",
      score: row.match_score || 0,
      strengths: row.matched_skills || [],
      reason: row.reason || "",
    }));

    if (shortlisted.length === 0) {
      return res.json({ success: true, report: null });
    }

    const subject = `AI HR Report: ${shortlisted.length} shortlisted candidate(s) ready`;
    const bullets = shortlisted
      .slice(0, 5)
      .map((c) => `- ${c.name} (${c.role}) - ${c.score}% match`)
      .join("\n");

    const report = {
      subject,
      shortlisted_candidates: shortlisted,
      email_body: `Hello CEO,\n\nTop AI-shortlisted candidates:\n${bullets}\n\nRegards,\nHR AI Agent`,
      details: {
        roadmap: [
          "Schedule technical interviews within 48 hours",
          "Run compensation benchmarking for top candidates",
          "Prepare offer packets for final approvals",
        ],
      },
      created_at: new Date().toISOString(),
    };

    return res.json({ success: true, report });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

router.get("/report/generate", generateHrReport);
router.post("/report/generate", generateHrReport);

module.exports = router;
