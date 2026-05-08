const express = require("express");
const router = express.Router();
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const Groq = require("groq-sdk");
const supabase = require("../db/supabase");

const getGroq = () => new Groq({ apiKey: process.env.GROQ_API_KEY || process.env.GROQ_API });
const hasGroqKey = () => Boolean(process.env.GROQ_API_KEY || process.env.GROQ_API);

function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/[,\n]/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function firstEmail(text = "") {
  const match = String(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : "";
}

function firstPhone(text = "") {
  const match = String(text).match(/(\+?\d[\d\s\-()]{8,}\d)/);
  return match ? match[0].trim() : "";
}

function firstLikelyName(text = "") {
  const lines = String(text)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 8);
  const candidate = lines.find((line) => /^[A-Za-z][A-Za-z\s.'-]{2,60}$/.test(line) && !/@/.test(line));
  return candidate || "";
}

function parseFromTextHeuristics(extractedText = "") {
  const email = firstEmail(extractedText);
  const phone = firstPhone(extractedText);
  const name = firstLikelyName(extractedText);
  const profileSummary = extractedText.slice(0, 220).replace(/\s+/g, " ").trim();
  return {
    name: name || null,
    email: email || null,
    phone: phone || null,
    role: null,
    total_experience_years: null,
    experience: profileSummary || null,
    skills: [],
    education: [],
    companies: [],
    certifications: [],
    projects: [],
    summary: profileSummary || null,
    score: null,
    score_reason: "Heuristic parser output",
    raw_source: "heuristic_parser",
  };
}

function extractKeywords(text = "", limit = 20) {
  const stopWords = new Set([
    "the", "and", "for", "with", "that", "this", "from", "you", "your", "are", "was", "were", "have",
    "has", "had", "not", "but", "his", "her", "she", "him", "our", "their", "they", "them", "will",
    "would", "could", "should", "can", "into", "onto", "about", "over", "under", "after", "before",
    "email", "phone", "resume", "experience", "education", "skills", "work"
  ]);
  const words = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s+#.-]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 2 && !stopWords.has(w));
  const freq = new Map();
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word);
}

router.post("/", async (req, res) => {
  const reqId = Math.random().toString(36).substring(7);
  console.log(`[Parser:${reqId}] Starting autonomous extraction...`);

  try {
    const { resumeUrl, applicationId } = req.body;
    console.log(`[Parser:${reqId}] payload`, { applicationId, resumeUrl });

    if (!resumeUrl || !applicationId) {
      return res.status(400).json({ error: "resumeUrl and applicationId are required" });
    }

    // 1. Validate File Type
    const urlClean = resumeUrl.split("?")[0];
    const fileExt = urlClean.split(".").pop().toLowerCase();
    
    const supportedTypes = ["pdf", "docx", "doc"];
    if (!supportedTypes.includes(fileExt || "")) {
      return res.status(400).json({ 
        error: `Unsupported file type (.${fileExt}). Please upload a PDF or Word document.` 
      });
    }

    // 2. Download file
    let buffer;
    const response = await fetch(resumeUrl);
    if (!response.ok) throw new Error(`Status ${response.status}: ${response.statusText}`);
    const arrayBuffer = await response.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
    console.log(`[Parser:${reqId}] download`, {
      contentType: response.headers.get("content-type") || "unknown",
      contentLength: response.headers.get("content-length") || buffer.length,
      bufferLength: buffer.length,
      fileExt,
    });

    // 3. Extract Text
    let extractedText = "";
    try {
      if (fileExt === "pdf") {
        const result = await pdfParse(buffer);
        extractedText = result.text;
      } else {
        const result = await mammoth.extractRawText({ buffer });
        extractedText = result.value;
      }
    } catch (parseErr) {
      const parseMessage = String(parseErr?.message || parseErr || "Unknown parse error");
      const parserError = fileExt === "pdf"
        ? `Unsupported PDF format or malformed PDF (${parseMessage})`
        : `Document parsing failed (${parseMessage})`;
      throw new Error(parserError);
    }
    extractedText = String(extractedText || "").replace(/\u0000/g, "").trim();
    console.log(`[Parser:${reqId}] extracted`, {
      textLength: extractedText.length,
      preview: extractedText.slice(0, 180),
    });

    if (!extractedText || extractedText.length < 80) {
      const emptyReason = fileExt === "pdf"
        ? "Empty resume detected. PDF may be scanned/image-only or unsupported."
        : "Empty resume detected. Could not extract meaningful text.";
      throw new Error(emptyReason);
    }

    // 4. Structured parsing from extracted text
    let parsedData;
    if (hasGroqKey()) {
      try {
        const groq = getGroq();
        const prompt = `You are an ATS resume parser. Extract structured candidate profile details from the resume text.
Return ONLY valid JSON with this exact top-level schema:
{
  "name": "string|null",
  "email": "string|null",
  "phone": "string|null",
  "role": "string|null",
  "total_experience_years": "number|null",
  "experience": "string|null",
  "skills": ["string"],
  "education": ["string"],
  "companies": ["string"],
  "certifications": ["string"],
  "projects": ["string"],
  "summary": "string|null",
  "score": "number 0-100",
  "score_reason": "string"
}

Scoring guidance:
- 0-20: almost no usable data
- 21-50: partial/incomplete resume
- 51-75: good resume with clear skills/experience
- 76-100: strong detailed profile

Rules:
- Never hallucinate unknown facts.
- Use null for missing scalar values.
- Use [] for missing arrays.
- Keep summary concise (max 2 lines).

Resume Text:
${extractedText.substring(0, 6000)}`;

        const completion = await groq.chat.completions.create({
          messages: [{ role: "user", content: prompt }],
          model: "llama-3.3-70b-versatile",
          response_format: { type: "json_object" }
        });
        parsedData = JSON.parse(completion.choices[0].message.content);
      } catch (parseErr) {
        console.error(`[Parser] AI parse failed, using heuristic parser:`, parseErr?.message || parseErr);
        parsedData = parseFromTextHeuristics(extractedText);
      }
    } else {
      parsedData = parseFromTextHeuristics(extractedText);
    }

    // Normalize output for downstream consistency
    const normalizedParsed = {
      name: parsedData?.name ? String(parsedData.name).trim() : null,
      email: parsedData?.email ? String(parsedData.email).trim() : null,
      phone: parsedData?.phone ? String(parsedData.phone).trim() : null,
      role: parsedData?.role ? String(parsedData.role).trim() : null,
      total_experience_years: Number.isFinite(Number(parsedData?.total_experience_years))
        ? Number(parsedData.total_experience_years)
        : null,
      experience: parsedData?.experience ? String(parsedData.experience).trim() : null,
      skills: toArray(parsedData?.skills),
      education: toArray(parsedData?.education),
      companies: toArray(parsedData?.companies),
      certifications: toArray(parsedData?.certifications),
      projects: toArray(parsedData?.projects),
      summary: parsedData?.summary ? String(parsedData.summary).trim() : null,
      score: Number.isFinite(Number(parsedData?.score))
        ? Math.max(0, Math.min(100, Number(parsedData?.score)))
        : null,
      score_reason: parsedData?.score_reason ? String(parsedData.score_reason).trim() : "Resume parsed",
      raw_source: parsedData?.raw_source || "ai_parser",
      fullText: extractedText,
      extracted_keywords: extractKeywords(extractedText),
    };
    console.log(`[Parser:${reqId}] parser response`, {
      name: normalizedParsed.name,
      email: normalizedParsed.email,
      rawSource: normalizedParsed.raw_source,
      skills: normalizedParsed.skills?.length || 0,
      experiencePresent: Boolean(normalizedParsed.experience),
      summaryPresent: Boolean(normalizedParsed.summary),
      keywords: normalizedParsed.extracted_keywords?.length || 0,
    });

    // 5. Persist parsed candidate details in applications (source of truth)
    const parsedName = String(normalizedParsed?.name || "").trim();
    const parsedEmail = String(normalizedParsed?.email || "").trim();
    const parsedExperience = String(normalizedParsed?.experience || "").trim();
    const parsedSkills = normalizedParsed?.skills || [];

    await supabase
      .from("applications")
      .update({
        extracted_text: extractedText,
        parsed_data: normalizedParsed,
        name: parsedName || undefined,
        email: parsedEmail || undefined,
        role: normalizedParsed.role || undefined,
        experience: parsedExperience || undefined,
      })
      .eq("id", applicationId);

    // 6. Also store candidate identity in tasks metadata for direct /tasks rendering
    const { data: existingTask } = await supabase
      .from("connected_tasks")
      .select("id, metadata")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const mergedMetadata = {
      ...(existingTask?.metadata || {}),
      candidate_name: parsedName || null,
      candidate_email: parsedEmail || null,
      candidate_phone: normalizedParsed.phone || null,
      candidate_role: normalizedParsed.role || null,
      candidate_score: normalizedParsed.score,
      candidate_experience: parsedExperience || null,
      candidate_skills: parsedSkills,
      candidate_summary: normalizedParsed.summary || null,
      candidate_education: normalizedParsed.education || [],
      candidate_projects: normalizedParsed.projects || [],
      parsed_text: extractedText,
      extracted_keywords: normalizedParsed.extracted_keywords || [],
      parser_status: "success",
      parser_error: null,
      parser_debug: {
        source: normalizedParsed.raw_source,
        text_length: extractedText.length,
      },
    };

    await supabase
      .from("connected_tasks")
      .update({
        metadata: mergedMetadata,
      })
      .eq("application_id", applicationId);

    res.json({ success: true, data: normalizedParsed });

  } catch (err) {
    const { applicationId } = req.body || {};
    const parserError = String(err?.message || "Resume text extraction failed");
    if (applicationId) {
      const { data: existingTask } = await supabase
        .from("connected_tasks")
        .select("id, metadata")
        .eq("application_id", applicationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      await supabase
        .from("connected_tasks")
        .update({
          metadata: {
            ...(existingTask?.metadata || {}),
            parser_status: "failed",
            parser_error: parserError,
          },
        })
        .eq("application_id", applicationId);
    }
    console.error(`[Parser] Error:`, err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
