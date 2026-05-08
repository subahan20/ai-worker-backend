const express = require("express");
const router = express.Router();
const Groq = require("groq-sdk");
const supabase = require("../db/supabase");

const getGroq = () => new Groq({ apiKey: process.env.GROQ_API_KEY || process.env.GROQ_API });

// POST /api/v2/plan/generate
router.post("/generate", async (req, res) => {
  try {
    const { department, formData } = req.body;

    if (!department) {
      return res.status(400).json({ error: "Department is required" });
    }

    const groq = getGroq();
    const prompt = `Generate a high-level AI strategic plan for the ${department} department.
    Context: ${JSON.stringify(formData)}
    
    Respond in valid JSON format.
    JSON Structure:
    {
      "title": "Strategy Name",
      "summary": "Executive summary",
      "steps": ["Step 1", "Step 2"],
      "priority": "HIGH"
    }`;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" }
    });

    const aiOutput = JSON.parse(completion.choices[0].message.content);

    // Insert into connected_tasks as a new plan
    const { data, error } = await supabase
      .from("connected_tasks")
      .insert([{
        title: aiOutput.title || `${department} AI Strategy`,
        description: aiOutput.summary || `Strategic plan for ${department}`,
        department: department,
        status: "waiting_for_ceo",
        priority: aiOutput.priority || "MEDIUM",
        progress: 0,
        analysis: aiOutput
      }])
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, plan: data });

  } catch (err) {
    console.error(`[Plan Generation] Error:`, err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
