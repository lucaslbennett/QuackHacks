import { Router } from "express";
import * as repo from "../db/repo.js";
import {
  hashPassword,
  verifyPassword,
  hashToken,
  issueSession,
  requireAuth,
  publicUser,
} from "../lib/auth.js";

const router = Router();

const asyncH = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) =>
    res.status(500).json({ ok: false, error: err.message })
  );

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readBearer(req) {
  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

// Create an account and immediately return a session token.
router.post(
  "/register",
  asyncH(async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const name = req.body.name ? String(req.body.name).trim() : null;

    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ ok: false, error: "valid email is required" });
    }
    if (password.length < 8) {
      return res
        .status(400)
        .json({ ok: false, error: "password must be at least 8 characters" });
    }
    if (await repo.users.getByEmail(email)) {
      return res.status(409).json({ ok: false, error: "email already registered" });
    }

    const user = await repo.users.create({
      email,
      passwordHash: hashPassword(password),
      name,
    });
    const token = await issueSession(user.id);
    res.status(201).json({ ok: true, token, user: publicUser(user) });
  })
);

// Verify credentials and return a session token.
router.post(
  "/login",
  asyncH(async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    const user = await repo.users.getByEmail(email);
    // Same response whether the user is missing or the password is wrong.
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ ok: false, error: "invalid email or password" });
    }

    const token = await issueSession(user.id);
    res.json({ ok: true, token, user: publicUser(user) });
  })
);

// Invalidate the current session.
router.post(
  "/logout",
  asyncH(async (req, res) => {
    const token = readBearer(req);
    if (token) await repo.sessions.deleteByTokenHash(hashToken(token));
    res.json({ ok: true });
  })
);

// Return the currently authenticated user.
router.get(
  "/me",
  requireAuth,
  asyncH(async (req, res) => {
    res.json({ ok: true, user: publicUser(req.user) });
  })
);

export default router;
