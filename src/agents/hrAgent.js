const BaseAgent = require("./baseAgent");

class HrAgent extends BaseAgent {
  constructor() {
    super("HR_AGENT");
  }

  extractSkills(candidateDescription = "") {
    const dictionary = [
      "javascript",
      "node",
      "node.js",
      "express",
      "postgresql",
      "sql",
      "react",
      "python",
      "aws",
      "docker",
      "kubernetes",
      "rest api",
      "communication",
      "leadership"
    ];
    const normalized = candidateDescription.toLowerCase();
    return dictionary.filter((skill) => normalized.includes(skill));
  }

  getRoleSkills(jobRole = "") {
    const role = jobRole.toLowerCase();
    if (role.includes("backend")) return ["node.js", "express", "postgresql", "sql", "rest api"];
    if (role.includes("frontend")) return ["javascript", "react"];
    if (role.includes("devops")) return ["aws", "docker", "kubernetes"];
    return ["javascript", "communication"];
  }

  async execute(input) {
    const {
      workflow = "screen_candidate",
      candidate_description = "",
      job_role = "",
      headcount = 1,
      hiring_timeline_weeks = 6
    } = input || {};
    console.log(`[${this.name}] started`, { workflow, job_role });

    if (workflow === "hiring_plan") {
      return {
        hiring_plan: {
          job_role,
          headcount,
          hiring_timeline_weeks,
          stages: ["resume_screen", "technical_interview", "culture_interview", "final_decision"]
        },
        jd_summary: `Hiring ${headcount} ${job_role} role(s) with strong ownership and team collaboration expectations.`
      };
    }

    const extractedSkills = this.extractSkills(candidate_description);
    const roleSkills = this.getRoleSkills(job_role);
    const matchedSkills = roleSkills.filter((s) => extractedSkills.includes(s));
    const score = Math.round((matchedSkills.length / roleSkills.length) * 100);
    const decision = score >= 60 ? "shortlisted" : "rejected";
    const reason = `${matchedSkills.length}/${roleSkills.length} required skills matched`;

    return { score, decision, reason };
  }
}

module.exports = HrAgent;
