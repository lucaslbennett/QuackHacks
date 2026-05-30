import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool } from "./pool.js";
import { config } from "../config.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("migrate");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function migrate() {
  if (!config.databaseUrl) {
    log.warn("DATABASE_URL not set - skipping migration");
    return false;
  }
  const sql = await readFile(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(sql);
  log.info("Schema applied");
  return true;
}

// Allow running directly: `npm run migrate`
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      log.error("Migration failed", err);
      process.exit(1);
    });
}
