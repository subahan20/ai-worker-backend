class CeoAgent {
  constructor(orchestrationService) {
    this.name = "CEO_AGENT";
    this.orchestrationService = orchestrationService;
  }

  async executeCycle() {
    return this.orchestrationService.runPendingTaskCycle();
  }
}

module.exports = CeoAgent;
