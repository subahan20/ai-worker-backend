const Groq = require("groq-sdk");

const getGroq = () => new Groq({
  apiKey: process.env.GROQ_API_KEY || process.env.GROQ_API || "",
});

async function generateDepartmentOverview(dept, taskTitle, inputData) {
  const prompt = `
    You are an elite AI Business Consultant. Analyze the following department task data and generate a professional executive overview. Respond in valid JSON format.
    
    DEPARTMENT: ${dept}
    TASK: ${taskTitle}
    CONTEXT DATA: ${JSON.stringify(inputData)}

    RETURN JSON STRUCTURE:
    {
      "ai_overview": "A detailed multi-paragraph executive briefing.",
      "ai_summary": "A concise 1-sentence summary.",
      "strengths": [], "weaknesses": [], "workflow_insights": [], "recommendations": [],
      "execution_summary": ""
    }
  `;

  try {
    const response = await getGroq().chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" }
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error("Groq Generation Error:", error);
    return { ai_overview: "Error generating overview.", ai_summary: "Error." };
  }
}

module.exports = { generateDepartmentOverview };
