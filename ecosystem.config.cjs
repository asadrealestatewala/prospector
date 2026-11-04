// PM2 process list for the Contabo VPS. Start with: pm2 start ecosystem.config.cjs && pm2 save
// The workers process runs every background queue; later steps add the crawler, email and WhatsApp.
module.exports = {
  apps: [
    {
      name: "prospector-web",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000 -H 127.0.0.1",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_memory_restart: "1G",
      env: { NODE_ENV: "production", TZ: "Asia/Karachi" },
    },
    {
      name: "prospector-workers",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "--env-file=.env.local src/workers/index.ts",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      restart_delay: 5000,
      kill_timeout: 30000,
      max_memory_restart: "1G",
      env: { NODE_ENV: "production", TZ: "Asia/Karachi" },
    },
  ],
};
