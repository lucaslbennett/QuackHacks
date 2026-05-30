import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import express from "express";
import cors from "cors";

import { config, missingKeys } from "./config.js";
import { createLogger } from "./lib/logger.js";
import { migrate } from "./db/migrate.js";
import { startRunner } from "./jobs/runner.js";
import { startScheduler } from "./jobs/scheduler.js";

import systemRoutes from "./routes/system.js";
import influencerRoutes from "./routes/influencers.js";
import authRoutes from "./routes/auth.js";

const log = createLogger("server");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Health checks (kept from the original Railway app).
app.get("/health", (req, res) => res.json({ status: "ok" }));

// Serve generated media (audio/video/images).
app.use("/media", express.static(path.resolve(config.mediaDir)));

// API.
app.use("/api", systemRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/influencers", influencerRoutes);

// Serve the built dashboard if present; otherwise a minimal landing page.
const webDist = path.join(rootDir, "web", "dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api|media|health).*/, (req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
} else {
  app.get("/", (req, res) => {
    res.type("html").send(
      `<!doctype html><html><head><meta charset="utf-8"><title>AI Influencer OS</title>
      <style>body{font-family:system-ui;background:#0b0b12;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
      .c{text-align:center}a{color:#a78bfa}</style></head>
      <body><div class="c"><h1>AI Influencer OS</h1>
      <p>API is live. Dashboard build not found.</p>
      <p>API status: <a href="/api/status">/api/status</a></p></div></body></html>`
    );
  });
}

async function boot() {
  const missing = missingKeys();
  if (missing.length) log.warn("Missing env keys:", missing.join(", "));

  if (config.databaseUrl) {
    try {
      await migrate();
    } catch (err) {
      log.error("Migration failed on boot:", err.message);
    }
  }

  app.listen(config.port, () => {
    log.info(`AI Influencer OS listening on port ${config.port}`);
  });

  startRunner();
  startScheduler();
}

boot().catch((err) => {
  log.error("Fatal boot error", err);
  process.exit(1);
});

export default app;
