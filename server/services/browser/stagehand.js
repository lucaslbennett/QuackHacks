import { Stagehand } from "@browserbasehq/stagehand";
import { config } from "../../config.js";
import { createLogger } from "../../lib/logger.js";

const log = createLogger("stagehand");

export function isConfigured() {
  return Boolean(config.browserbase.apiKey && config.browserbase.projectId);
}

// Builds the Browserbase dashboard URL for a session so it can be watched live.
export function sessionUrlFor(sessionId) {
  if (!sessionId) return null;
  return `https://www.browserbase.com/sessions/${sessionId}`;
}

// Creates an initialized Stagehand instance backed by Browserbase, using
// Gemini as the reasoning model for act()/extract(). Caller must close().
// `onSession` (if provided) is invoked once the session is live with
// { sessionId, sessionUrl } so callers can surface a watchable link early.
export async function createStagehand({ sessionData, onSession } = {}) {
  if (!isConfigured()) {
    throw new Error("BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID required");
  }
  const stagehand = new Stagehand({
    env: config.browserbase.env,
    apiKey: config.browserbase.apiKey,
    projectId: config.browserbase.projectId,
    model: {
      modelName: `google/${config.gemini.model}`,
      apiKey: config.gemini.apiKey,
    },
    verbose: process.env.DEBUG ? 2 : 1,
    browserbaseSessionCreateParams: {
      projectId: config.browserbase.projectId,
      browserSettings: {
        // Reuse a stored Browserbase context for persistent IG sessions.
        context: sessionData?.contextId
          ? { id: sessionData.contextId, persist: true }
          : undefined,
        solveCaptchas: true,
      },
    },
  });
  await stagehand.init();
  const sessionId = stagehand.browserbaseSessionID;
  log.info("Stagehand session initialized", sessionId || "");
  if (typeof onSession === "function") {
    try {
      onSession({ sessionId, sessionUrl: sessionUrlFor(sessionId) });
    } catch (err) {
      log.warn("onSession callback error", err?.message);
    }
  }
  return stagehand;
}

// Convenience: run a function with a Stagehand instance and always close it.
export async function withStagehand(fn, opts) {
  const stagehand = await createStagehand(opts);
  try {
    const page = stagehand.context.pages()[0] || (await stagehand.context.newPage());
    return await fn({ stagehand, page });
  } finally {
    await stagehand.close().catch((e) => log.warn("close error", e.message));
  }
}
