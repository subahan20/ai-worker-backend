class BaseAgent {
  constructor(name) {
    this.name = name;
  }

  async execute() {
    throw new Error(`execute(task) is required for ${this.name}`);
  }
}

module.exports = BaseAgent;
