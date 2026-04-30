const ts = () => new Date().toISOString();

const logger = {
  info(scope, message, meta) {
    console.log(`[${ts()}] [${scope}] ${message}`, meta || "");
  },
  error(scope, message, meta) {
    console.error(`[${ts()}] [${scope}] ${message}`, meta || "");
  }
};

module.exports = logger;
