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
      out_file: "./logs/out.log",
      error_file: "./logs/err.log",
    },
  ],
};
