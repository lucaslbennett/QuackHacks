// Client for the developer test-harness endpoints (server/routes/system.js).
// These power the Test Lab panel: agent (persona) generation, a raw
// Browserbase session check, and the full "launch session + generate user" run.

export interface IntegrationStatus {
  database: boolean;
  gemini: boolean;
  elevenlabs: boolean;
  browserbase: boolean;
  capsolver: boolean;
}

export interface StatusResponse {
  ok: boolean;
  env: string;
  integrations: IntegrationStatus;
  missingKeys: string[];
}

export interface Persona {
  displayName?: string;
  handleSuggestions?: string[];
  niche?: string;
  bio?: string;
  personality?: string;
  [key: string]: unknown;
}

export interface BrowserbaseResult {
  ok: boolean;
  title?: string;
  currentUrl?: string;
  sessionId?: string | null;
  sessionUrl?: string | null;
  error?: string;
}

export type StepState = "pending" | "running" | "done" | "error";

export interface SpawnRun {
  ok: boolean;
  runId: string;
  status: "running" | "done" | "error";
  steps: { persona: StepState; session: StepState; account: StepState };
  inputs: Record<string, unknown>;
  persona: Persona | null;
  sessionId: string | null;
  sessionUrl: string | null;
  account: {
    username: string;
    password: string;
    email: string;
    fullName: string;
    loggedIn: boolean;
    note?: string;
  } | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface TestInputs {
  name: string;
  niche: string;
  email: string;
  sources: string[];
}

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const testApi = {
  status: () => req<StatusResponse>("/status"),

  generatePersona: (inputs: TestInputs) =>
    req<{ ok: boolean; persona: Persona }>("/smoke/persona", {
      method: "POST",
      body: JSON.stringify({
        name: inputs.name,
        niche: inputs.niche,
        sources: inputs.sources,
      }),
    }),

  testBrowserbase: () =>
    req<BrowserbaseResult>("/smoke/browserbase", {
      method: "POST",
      body: JSON.stringify({}),
    }),

  startSpawn: (inputs: TestInputs) =>
    req<SpawnRun>("/smoke/spawn-user", {
      method: "POST",
      body: JSON.stringify({
        name: inputs.name,
        niche: inputs.niche,
        email: inputs.email,
        sources: inputs.sources,
      }),
    }),

  getSpawn: (runId: string) => req<SpawnRun>(`/smoke/spawn-user/${runId}`),
};

// Sample data used to auto-fill every input the test flow needs.
// Email is left blank so the server provisions a real inbox-backed address
// (via the configured email provider) that can receive the IG signup code.
export function autofillInputs(): TestInputs {
  return {
    name: "Nova Sterling",
    niche: "streetwear fashion",
    email: "",
    sources: ["https://www.instagram.com/instagram/"],
  };
}
