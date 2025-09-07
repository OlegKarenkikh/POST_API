// ecosystem.config.js
module.exports = {
  apps : [{
    name   : "pochta-tracker",
    script : "./server.js", // Path to your entry point
    instances: 1, // Start with 1, scale carefully if needed
    autorestart: true, // Restart on crash
    watch  : false, // Disable watch in production
    max_memory_restart: '250M', // Restart if memory exceeds limit
    // Define environment variables for production directly or ensure they are set
    // in the deployment environment (preferred for secrets).
    env: {
      NODE_ENV: "production",
      // --- IMPORTANT: Set these securely in your deployment environment ---
      // SESSION_SECRET: "your_production_secret_here", // Not strictly needed for this app version
      // POCHTA_LOGIN: "your_production_login",
      // POCHTA_PASSWORD: "your_production_password",
      // --- Optional overrides for production ---
      // PORT: 8080, // Or your desired production port
      // CACHE_DURATION_MINUTES: 60, // Not used in this version
      LOG_LEVEL: "warn", // Less verbose logging in prod
      API_TIMEOUT_MS: 45000, // Maybe increase timeout slightly for prod
    },
    log_date_format: "YYYY-MM-DD HH:mm:ss Z", // Add timezone Z
    error_file: "./logs/pm2-error.log", // pm2's error log for the app (relative to project root)
    out_file: "./logs/pm2-out.log",     // pm2's standard output log (relative to project root)
    merge_logs: true, // Merge logs from clustered instances if instances > 1
  }]
}