// Local Chrome launcher for the signup flow's LOCAL-BROWSER escape hatch.
//
// Launches a real, headful Chrome (Playwright's "Chrome for Testing" by default)
// on THIS machine with a CDP endpoint, so Stagehand can drive it exactly like a
// Browser Use cloud browser — except the traffic egresses from the host's own
// residential IP. Instagram trusts a residential consumer IP far more than the
// shared datacenter/automation proxy pools (whose ranges Meta integrity-flags),
// so this is the highest-trust egress available without a paid dedicated proxy.
//
// Lifecycle mirrors browserUse.openBrowserUseSession(): returns { cdpUrl,
// sessionId, sessionUrl, stop }. stop() kills the Chrome process and removes its
// throwaway user-data dir.

import { spawn } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, rmSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../../config.js";
import { sleep } from "../../lib/util.js";
import { createLogger } from "../../lib/logger.js";

const log = createLogger("local-browser");

export function isConfigured() {
  return Boolean(resolveChromeExecutable());
}

// Finds a launchable Chrome/Chromium binary: explicit override → Playwright's
// downloaded "Chrome for Testing" (the most predictable, real-Chrome build) →
// common macOS system browsers.
export function resolveChromeExecutable() {
  if (config.browserUse.localChromeExecutable && existsSync(config.browserUse.localChromeExecutable)) {
    return config.browserUse.localChromeExecutable;
  }
  // Playwright cache: ~/Library/Caches/ms-playwright/chromium-XXXX/chrome-mac*/...
  try {
    const cache = path.join(os.homedir(), "Library", "Caches", "ms-playwright");
    if (existsSync(cache)) {
      const builds = readdirSync(cache)
        .filter((d) => /^chromium-\d+$/.test(d))
        .sort()
        .reverse();
      for (const b of builds) {
        const candidates = [
          path.join(cache, b, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
          path.join(cache, b, "chrome-mac", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
          path.join(cache, b, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
          path.join(cache, b, "chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium"),
        ];
        for (const c of candidates) if (existsSync(c)) return c;
      }
    }
  } catch {
    /* ignore and fall through */
  }
  const system = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ];
  for (const p of system) if (existsSync(p)) return p;
  return "";
}

// Reads the CDP port Chrome wrote to <userDataDir>/DevToolsActivePort after it
// finished binding the debug socket (line 1 = port). Polls because the file
// appears a beat after spawn.
async function waitForDevToolsPort(userDataDir, { timeoutMs = 20000 } = {}) {
  const file = path.join(userDataDir, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      try {
        const port = parseInt(readFileSync(file, "utf8").split("\n")[0].trim(), 10);
        if (port > 0) return port;
      } catch {
        /* not fully written yet */
      }
    }
    await sleep(200);
  }
  throw new Error("Chrome did not expose a DevTools port in time");
}

// Resolves the raw CDP WebSocket endpoint Stagehand attaches to.
async function discoverWsEndpoint(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/version`);
  if (!res.ok) throw new Error(`CDP /json/version HTTP ${res.status}`);
  const info = await res.json();
  const ws = info?.webSocketDebuggerUrl;
  if (!ws) throw new Error("CDP /json/version returned no webSocketDebuggerUrl");
  return ws;
}

// Launches a local Chrome and returns the handle Stagehand needs. The flags keep
// it looking like a normal consumer Chrome: no automation banner / webdriver
// flag, a fresh profile, a real window size, and the throwaway profile dir.
export async function launchLocalSession() {
  const exe = resolveChromeExecutable();
  if (!exe) {
    throw new Error(
      "No local Chrome found. Install one (npx playwright install chromium) or set CHROME_EXECUTABLE."
    );
  }
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), "ig-signup-chrome-"));
  const viewport = (() => {
    const { screenWidth, screenHeight } = config.browserUse;
    if (screenWidth && screenHeight) return { width: screenWidth, height: screenHeight };
    const pool = [
      { width: 1512, height: 982 },
      { width: 1440, height: 900 },
      { width: 1680, height: 1050 },
      { width: 1366, height: 768 },
    ];
    return pool[Math.floor(Math.random() * pool.length)];
  })();

  const args = [
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-blink-features=AutomationControlled",
    "--disable-features=Translate,AutomationControlled",
    "--disable-infobars",
    "--password-store=basic",
    "--use-mock-keychain",
    `--window-size=${viewport.width},${viewport.height}`,
    "about:blank",
  ];
  if (config.browserUse.localHeadless) args.unshift("--headless=new");

  log.info("Launching local Chrome", {
    exe: path.basename(exe),
    headless: config.browserUse.localHeadless,
    viewport: `${viewport.width}x${viewport.height}`,
  });

  // detached:true makes the child its own process-group leader so we can SIGKILL
  // the ENTIRE Chrome tree (main + renderer/GPU helpers) at once — otherwise the
  // helper processes linger after the main process dies and pile up across runs,
  // contending for resources (the cause of a warm-up that mysteriously hangs).
  const child = spawn(exe, args, { stdio: "ignore", detached: true });
  let exited = false;
  child.on("exit", () => {
    exited = true;
  });

  const stop = async () => {
    if (!exited && child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL"); // whole process group
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }
    }
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  };

  try {
    const port = await waitForDevToolsPort(userDataDir);
    const cdpUrl = await discoverWsEndpoint(port);
    log.info("Local Chrome ready (CDP attached)", { port });
    return {
      cdpUrl,
      sessionId: "local",
      sessionUrl: `local-chrome://127.0.0.1:${port}`,
      stop,
    };
  } catch (err) {
    await stop();
    throw err;
  }
}
