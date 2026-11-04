// PM2 process list for the Contabo VPS. Start with: pm2 start ecosystem.config.cjs && pm2 save
// Background workers (search, crawler, email, WhatsApp) are added here in later build steps.
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
  ],
};
