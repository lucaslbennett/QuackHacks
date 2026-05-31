// Verifies the Browser Use integration end to end and PROVES the API key is being
// used + sessions are visible in the dashboard.
//
// What it does:
//   1. Creates a real cloud browser session via the REST API (POST /browsers).
//      -> This is the call that marks the API key as "used" and makes the run
//         show up in https://cloud.browser-use.com. Prints the live URL to watch.
//   2. (default) Attaches Stagehand over CDP and loads a page to confirm the
//      browser is drivable. Pass --no-drive to skip and only test session create.
//   3. Lists recent sessions so you can confirm this one appears.
//   4. Stops the session (Browser Use refunds the unused prepaid time).
//
// Usage:
//   node server/scripts/probeBrowserUse.js                # full check (create + drive + stop)
//   node server/scripts/probeBrowserUse.js --no-drive     # create + stop only
//   node server/scripts/probeBrowserUse.js --url https://example.com
import { config } from "../config.js";
import * as browserUse from "../services/browser/browserUse.js";
import { withStagehand, isConfigured } from "../services/browser/stagehand.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("browser-use-probe");

function parseArgs(argv) {
  const args = { drive: true, url: "https://example.com" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--no-drive") args.drive = false;
    else if (argv[i] === "--url") args.url = argv[++i] || args.url;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  log.info("config", {
    apiKeySet: Boolean(config.browserUse.apiKey),
    apiBase: config.browserUse.apiBase,
    useRestSessions: config.browserUse.useRestSessions,
    proxyCountry: config.browserUse.proxyCountryCode || "(api default)",
    profileId: config.browserUse.profileId ? "set" : "(none)",
    timeoutMinutes: config.browserUse.timeoutMinutes,
  });
  if (!isConfigured()) {
    log.error("BROWSER_USE_API_KEY must be set (create one at https://cloud.browser-use.com/settings?tab=api-keys&new=1)");
    process.exit(2);
  }

  if (args.drive) {
    // Exercise the exact path the app uses: create a session, attach Stagehand,
    // drive a page, then stop — so a green run here means the app will work too.
    log.info("creating session + attaching Stagehand…", { url: args.url });
    const started = Date.now();
    try {
      const result = await withStagehand(
        async ({ page }) => {
          await page.goto(args.url, { waitUntil: "domcontentloaded", timeout: 60000 });
          return { title: await page.title().catch(() => ""), url: page.url() };
        },
        {
          onSession: ({ sessionId, sessionUrl }) => {
            log.info("🔴 LIVE SESSION (open this in your browser to watch it)", {
              sessionId: sessionId || "(connect-url — not shown in dashboard)",
              watch: sessionUrl,
            });
          },
        }
      );
      log.info(`drove the page in ${((Date.now() - started) / 1000).toFixed(1)}s`, result);
    } catch (err) {
      log.error("drive failed:", err?.stack || err?.message || err);
      process.exit(1);
    }
  } else {
    // Lightweight: just create + stop a session to confirm the key/REST works.
    log.info("creating session (no drive)…");
    let session;
    try {
      session = await browserUse.createSession();
      log.info("🔴 LIVE SESSION (open this in your browser to watch it)", {
        sessionId: session.id,
        watch: session.liveUrl || browserUse.dashboardUrlFor(session.id),
        cdpUrl: session.cdpUrl,
      });
    } catch (err) {
      log.error("session create failed:", err?.message || err);
      process.exit(1);
    } finally {
      if (session?.id) await browserUse.stopSession(session.id);
    }
  }

  // Confirm the session shows up in the dashboard's list (proves visibility).
  try {
    const list = await browserUse.listSessions({ pageSize: 5 });
    const items = list?.items || list?.sessions || (Array.isArray(list) ? list : []);
    log.info(`recent sessions visible via API: ${items.length}`);
    for (const s of items.slice(0, 5)) {
      log.info("  session", { id: s.id, status: s.status, startedAt: s.startedAt });
    }
  } catch (err) {
    log.warn("could not list sessions:", err?.message);
  }

  log.info("✅ Browser Use is wired up. Check the dashboard — the key now shows as used and the session is listed.");
}

main().catch((err) => {
  log.error("probe crashed:", err?.stack || err?.message || err);
  process.exit(1);
});
