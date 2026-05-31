export interface User {
  id: string;
  email: string;
  name: string | null;
  role: string;
  data?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

const TOKEN_KEY = "fastpost.token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

interface AuthResponse {
  ok: boolean;
  token?: string;
  user?: User;
  error?: string;
}

async function authRequest(
  path: string,
  body: Record<string, unknown>,
): Promise<{ token: string; user: User }> {
  const res = await fetch(`/api/auth${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: AuthResponse = await res.json().catch(() => ({ ok: false }));
  if (!res.ok || data.ok === false || !data.token || !data.user) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  setToken(data.token);
  return { token: data.token, user: data.user };
}

export function register(email: string, password: string, name?: string) {
  return authRequest("/register", { email, password, name });
}

export function login(email: string, password: string) {
  return authRequest("/login", { email, password });
}

// Fixed credentials used by the localhost-only dev sign-in shortcut.
const DEV_CREDENTIALS = {
  email: "dev@local.test",
  password: "devpassword123",
  name: "Dev User",
};

// True only when the app is served from a local development host.
export function isLocalhost(): boolean {
  if (typeof window === "undefined") return false;
  return /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(
    window.location.hostname,
  );
}

// One-click dev login: log in with the shared dev account, creating it on the
// first run if it doesn't exist yet.
export async function devLogin(): Promise<{ token: string; user: User }> {
  const { email, password, name } = DEV_CREDENTIALS;
  try {
    return await login(email, password);
  } catch {
    return await register(email, password, name);
  }
}

export async function logout(): Promise<void> {
  const token = getToken();
  setToken(null);
  if (!token) return;
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    /* best-effort; token already cleared locally */
  }
}

// Returns the current user if the stored token is still valid, else null.
export async function fetchMe(): Promise<User | null> {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      if (res.status === 401) setToken(null);
      return null;
    }
    const data: AuthResponse = await res.json();
    return data.user ?? null;
  } catch {
    return null;
  }
}
