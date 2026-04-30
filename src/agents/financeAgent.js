const BaseAgent = require("./baseAgent");

class FinanceAgent extends BaseAgent {
  constructor() {
    super("FINANCE_AGENT");
  }

  async execute(input) {
    const {
      workflow = "revenue_expense_summary",
      revenue = 0,
      expenses = 0,
      monthly_budget = 0,
      spent = 0,
      invoices_due = []
    } = input || {};
    console.log(`[${this.name}] started`, { workflow });

    if (workflow === "invoice_followup") {
      const due = Array.isArray(invoices_due) ? invoices_due : [];
      const followupList = due.map((invoice) => ({
        invoice_id: invoice.invoice_id,
        reminder: `Reminder for invoice ${invoice.invoice_id} due on ${invoice.due_date || "upcoming date"}`
      }));
      return { pending_invoices: followupList.length, followups: followupList };
    }

    if (workflow === "budget_review") {
      const remaining = Number(monthly_budget || 0) - Number(spent || 0);
      const status = remaining >= 0 ? "within_budget" : "over_budget";
      return {
        budget_status: status,
        monthly_budget: Number(monthly_budget || 0),
        spent: Number(spent || 0),
        remaining
      };
    }

    // Default finance workflow: revenue/expense tracking + basic summary.
    const totalRevenue = Number(revenue || 0);
    const totalExpenses = Number(expenses || 0);
    const netProfit = totalRevenue - totalExpenses;
    const marginPercent = totalRevenue > 0 ? Number(((netProfit / totalRevenue) * 100).toFixed(2)) : 0;
    const summary = netProfit >= 0 ? "Profitable period" : "Loss-making period";

    return {
      revenue: totalRevenue,
      expenses: totalExpenses,
      net_profit: netProfit,
      margin_percent: marginPercent,
      summary
    };
  }
}

module.exports = FinanceAgent;
