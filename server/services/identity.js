// Pure, dependency-light identity generation for a fresh Instagram account.
//
// These helpers used to live inside services/browser/createAccount.js (the
// headless Browser Use signup flow). They're extracted here so the new
// USER-DRIVEN "build account" flow (server/routes/accounts.js) can mint the
// exact same kind of realistic credentials WITHOUT pulling in Stagehand /
// CapSolver / Gemini. createAccount.js now imports from this module too, so
// both paths stay in lockstep.

import { randomInt, pick } from "../lib/util.js";

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Small but varied name pools so a draft always has a plausible human name even
// when no persona/display name is supplied (e.g. the standalone Test Lab path).
const FIRST_NAMES = [
  "Ava", "Mia", "Liam", "Noah", "Emma", "Olivia", "Ethan", "Sofia", "Lucas",
  "Maya", "Leo", "Nora", "Kai", "Ivy", "Jonah", "Ruby", "Theo", "Luna",
  "Milo", "Eliza", "Owen", "Sienna", "Caleb", "Aria", "Felix", "Iris",
];
const LAST_NAMES = [
  "Carter", "Reyes", "Bennett", "Hayes", "Nguyen", "Sterling", "Brooks",
  "Patel", "Rivera", "Sloane", "Walsh", "Monroe", "Ellis", "Fox", "Khan",
  "Vance", "Cole", "Park", "Mercer", "Quinn", "Adler", "Frost",
];

// Builds a FRESH, realistic-looking username. Every call yields a NEW handle —
// even back-to-back on the same base — or Instagram rejects the signup as
// "username taken". Combines a cleaned base with a TIME-SEEDED suffix (tail of
// epoch-ms, can't collide) plus a small random spread, varying the join style
// so handles read like real people's rather than a templated sequence.
export function buildUsername(base) {
  const clean = (base || "creator")
    .toLowerCase()
    .replace(/[^a-z0-9._]/g, "")
    .replace(/[._]{2,}/g, ".") // collapse doubled separators
    .replace(/^[._]+|[._]+$/g, "") // trim leading/trailing separators
    .slice(0, 15) || "creator";
  const suffix = `${randomInt(1, 9)}${String(Date.now()).slice(-5)}`;
  const sep = pick(["", "", "", "_", "."]); // mostly none, occasionally _ or .
  return `${clean}${sep}${suffix}`.slice(0, 30);
}

// Picks a (randomized) persona handle base and builds a brand-new username from
// it. Randomizing WHICH suggestion we start from gives retries genuinely
// different-looking handles instead of the same stem twice.
export function freshUsername(persona) {
  const candidates = [
    ...(Array.isArray(persona?.handleSuggestions) ? persona.handleSuggestions : []),
    persona?.displayName,
  ].filter(Boolean);
  return buildUsername(candidates.length ? pick(candidates) : "creator");
}

export function randomPassword() {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let p = "";
  for (let i = 0; i < 14; i++) p += chars[Math.floor(Math.random() * chars.length)];
  return `${p}!7`;
}

export function randomFullName() {
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
}

// A plausible adult birthday. Day capped at 28 so it's always valid regardless
// of month/leap year.
export function pickBirthday({ minAge = 24, maxAge = 33 } = {}) {
  const now = new Date();
  const age = randomInt(minAge, maxAge);
  const year = now.getFullYear() - age;
  const monthIndex = randomInt(0, 11);
  const day = randomInt(1, 28);
  return {
    year,
    monthIndex,
    monthName: MONTH_NAMES[monthIndex],
    monthNumber: monthIndex + 1,
    day,
  };
}

// Bundles everything a brand-new account needs (minus the email, which is
// provisioned separately so it's inbox-backed). Accepts either a full persona
// (preferred — drives the handle from its suggestions) or a bare display name.
export function buildAccountIdentity({ persona, name } = {}) {
  const displayName = String(persona?.displayName || name || "").trim();
  const fullName = displayName || randomFullName();
  const personaForHandle = persona || (displayName ? { displayName } : null);
  return {
    fullName,
    username: freshUsername(personaForHandle),
    password: randomPassword(),
    dob: pickBirthday(),
  };
}
