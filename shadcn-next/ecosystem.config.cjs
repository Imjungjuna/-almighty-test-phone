// eslint-disable-next-line @typescript-eslint/no-require-imports -- pm2 loads this file as CommonJS
const path = require("node:path");

module.exports = {
  apps: [
    {
      name: "test-phone",
      script: "npm",
      args: "start",
      cwd: __dirname,
      env: { NODE_ENV: "production", PORT: "3100" },
      autorestart: true,
      max_restarts: 10,
      out_file: path.join(__dirname, "logs", "out.log"),
      error_file: path.join(__dirname, "logs", "err.log"),
    },
  ],
};
