const express = require("express");
const router = express.Router();
const Groq = require("groq-sdk");
const supabase = require("../db/supabase");

const getGroq = () => new Groq({ apiKey: process.env.GROQ_API_KEY || process.env.GROQ_API });

// POST /api/v2/sales/analyze
router.post("/analyze", async (req, res) => {
  try {
    const { formData } = req.body;

    const groq = getGroq();
    const prompt = `Analyze this sales deal and generate a strategic closing plan.
    Deal Data: ${JSON.stringify(formData)}
    
    Respond in valid JSON format.
    JSON Structure:
    {
      "deal_name": "Deal Name",
      "risk_analysis": "Summary of risks",
      "next_steps": ["Step 1", "Step 2"],
      "probability": "0.75"
    }`;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" }
    });

    const aiOutput = JSON.parse(completion.choices[0].message.content);

    // Insert into connected_tasks as a new sales analysis mission
    const { data, error } = await supabase
      .from("connected_tasks")
      .insert([{
        title: `Sales Analysis: ${aiOutput.deal_name || 'New Deal'}`,
        description: aiOutput.risk_analysis || "AI-driven sales opportunity analysis",
        department: "Sales",
        status: "waiting_for_ceo",
        priority: "HIGH",
        progress: 0,
        analysis: aiOutput
      }])
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, analysis: data });

  } catch (err) {
    console.error(`[Sales Analysis] Error:`, err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
