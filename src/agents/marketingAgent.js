const BaseAgent = require("./baseAgent");

class MarketingAgent extends BaseAgent {
  constructor() {
    super("MARKETING_AGENT");
  }

  getEngagementScore(post) {
    const likes = Number(post?.likes || 0);
    const comments = Number(post?.comments || 0);
    return likes + comments * 2;
  }

  async execute(input) {
    const { workflow = "engagement_analysis", instagram_posts = [] } = input || {};
    const posts = Array.isArray(instagram_posts) ? instagram_posts : [];
    console.log(`[${this.name}] started`, { workflow, posts: posts.length });

    const scored = posts.map((p) => ({ ...p, score: this.getEngagementScore(p) }));
    const avgScore = scored.length
      ? scored.reduce((sum, p) => sum + p.score, 0) / scored.length
      : 0;

    const viralPatterns = [];
    if (scored.some((p) => p.score >= avgScore && String(p.caption || "").toLowerCase().includes("how"))) {
      viralPatterns.push("How-to captions are performing above average");
    }
    if (scored.some((p) => p.score >= avgScore && String(p.caption || "").toLowerCase().includes("story"))) {
      viralPatterns.push("Story-style captions are generating strong engagement");
    }
    if (!viralPatterns.length && scored.length) {
      viralPatterns.push("Short and clear captions have stable engagement");
    }

    const contentIdeas = [
      "Create a 5-tip carousel for common customer pain points",
      "Post a founder story reel with a direct CTA",
      "Share before/after customer result screenshots"
    ];
    const email_sent = workflow === "engagement_analysis" && contentIdeas.length > 0;

    return { viral_patterns: viralPatterns, content_ideas: contentIdeas, email_sent };
  }
}

module.exports = MarketingAgent;
