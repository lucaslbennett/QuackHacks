import pg from "pg";
import { config } from "../config.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("db");

const needsSsl =
  /\bsslmode=require\b/.test(config.databaseUrl) ||
  (config.env === "production" && !/localhost|127\.0\.0\.1/.test(config.databaseUrl));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl || undefined,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

pool.on("error", (err) => {
  log.error("Unexpected idle client error", err.message);
});

export async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  log.debug(`query (${Date.now() - start}ms)`, text.split("\n")[0].trim());
  return res;
}

export async function one(text, params) {
  const res = await query(text, params);
  return res.rows[0] || null;
}

export async function many(text, params) {
  const res = await query(text, params);
  return res.rows;
}

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
