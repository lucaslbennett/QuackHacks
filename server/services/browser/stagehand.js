import { Stagehand } from "@browserbasehq/stagehand";
import { config } from "../../config.js";
import { createLogger } from "../../lib/logger.js";

const log = createLogger("stagehand");

export function isConfigured() {
  return Boolean(config.browserbase.apiKey && config.browserbase.projectId);
}

// Creates an initialized Stagehand instance backed by Browserbase, using
// Anthropic as the reasoning model for act()/extract(). Caller must close().
export async function createStagehand({ sessionData } = {}) {
  if (!isConfigured()) {
    throw new Error("BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID required");
  }
  const stagehand = new Stagehand({
    env: config.browserbase.env,
    apiKey: config.browserbase.apiKey,
    projectId: config.browserbase.projectId,
    model: {
      modelName: `anthropic/${config.anthropic.model}`,
      apiKey: config.anthropic.apiKey,
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
  log.info("Stagehand session initialized");
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
