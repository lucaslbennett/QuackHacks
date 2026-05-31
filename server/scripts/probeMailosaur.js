// Verifies the Mailosaur integration end to end: checks auth, lists recent
// messages in the configured server, and exercises the same search + retrieve
// path the signup flow uses. Run after a signup attempt to confirm whether IG
// actually delivered a verification email to the generated address.
//
// Usage:
//   node server/scripts/probeMailosaur.js                 # list recent messages
//   node server/scripts/probeMailosaur.js <full-address>  # search a specific address
import { config } from "../config.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("mailosaur-probe");

const { emailApiKey, mailosaurServerId, emailProvider } = config.verification;
const auth = "Basic " + Buffer.from(`api:${emailApiKey}`).toString("base64");

async function main() {
  log.info("config", { emailProvider, mailosaurServerId, apiKeySet: Boolean(emailApiKey) });
  if (!emailApiKey || !mailosaurServerId) {
    log.error("EMAIL_API_KEY and MAILOSAUR_SERVER_ID must be set");
    process.exit(2);
  }

  // 1. Account usage — confirms the API key is valid (401 here = bad key).
  try {
    const res = await fetch("https://mailosaur.com/api/usage/limits", { headers: { Authorization: auth } });
    log.info("usage/limits status", res.status);
    if (res.ok) log.info("usage", JSON.stringify(await res.json()));
  } catch (err) {
    log.warn("usage check failed", err.message);
  }

  // 2. List the most recent messages in the server.
  try {
    const res = await fetch(`https://mailosaur.com/api/messages?server=${mailosaurServerId}&itemsPerPage=10`, {
      headers: { Authorization: auth },
    });
    log.info("messages list status", res.status);
    if (res.ok) {
      const { items = [] } = await res.json();
      log.info(`server holds ${items.length} recent message(s)`);
      for (const m of items.slice(0, 10)) {
        log.info("  •", JSON.stringify({ to: m.to?.map((t) => t.email), subject: m.subject, received: m.received }));
      }
    } else {
      log.warn("list body", await res.text());
    }
  } catch (err) {
    log.warn("list failed", err.message);
  }

  // 3. Optional: search a specific address (same path as the signup flow).
  const target = process.argv[2];
  if (target) {
    try {
      const res = await fetch(`https://mailosaur.com/api/messages/search?server=${mailosaurServerId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth },
        body: JSON.stringify({ sentTo: target }),
      });
      log.info(`search(${target}) status`, res.status);
      if (res.ok) {
        const { items = [] } = await res.json();
        log.info(`matched ${items.length} message(s)`, JSON.stringify(items.map((i) => ({ subject: i.subject, id: i.id }))));
      }
    } catch (err) {
      log.warn("search failed", err.message);
    }
  }
}

main();
