const BaseAgent = require("./baseAgent");

class SalesAgent extends BaseAgent {
  constructor() {
    super("SALES_AGENT");
  }

  generateLeads(targetAudience = "") {
    const slug = targetAudience.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return [`${slug}1@company.com`, `${slug}2@company.com`, `${slug}3@company.com`];
  }

  getViralityScore(reel) {
    const views = Number(reel?.views || 0);
    const likes = Number(reel?.likes || 0);
    const comments = Number(reel?.comments || 0);
    const shares = Number(reel?.shares || 0);
    return views * 0.35 + likes * 0.25 + comments * 0.2 + shares * 0.2;
  }

  buildEmail(targetAudience, topReels) {
    const topTitles = topReels.slice(0, 3).map((r) => r.caption || r.reel_id || "Top reel").join(", ");
    return `Hi, we analyzed the top viral reels in ${targetAudience}. The strongest performing content patterns were found in: ${topTitles}. We can help you replicate these patterns and convert them into predictable revenue growth.`;
  }

  async execute(input) {
    const {
      workflow = "instagram_viral_leads",
      target_audience = "business teams",
      instagram_reels = [],
      max_top_reels = 5
    } = input || {};
    console.log(`[${this.name}] started`, { workflow, target_audience });

    const reels = Array.isArray(instagram_reels) ? instagram_reels : [];
    const scoredReels = reels
      .map((reel) => ({ ...reel, virality_score: Number(this.getViralityScore(reel).toFixed(2)) }))
      .sort((a, b) => b.virality_score - a.virality_score);
    const topReels = scoredReels.slice(0, Math.max(1, Number(max_top_reels) || 5));

    const leads = this.generateLeads(target_audience);
    const outreach_email = this.buildEmail(target_audience, topReels);
    const followups = [
      "Quick follow-up: I can send a breakdown of the top-performing reel hooks and CTA styles.",
      "Final follow-up: if useful, I can share a one-week content-to-outreach plan based on these viral patterns."
    ];

    if (workflow === "instagram_viral_leads") {
      return { top_viral_reels: topReels, leads, outreach_email, followups };
    }

    return { leads, outreach_email, followups };
  }
}

module.exports = SalesAgent;
