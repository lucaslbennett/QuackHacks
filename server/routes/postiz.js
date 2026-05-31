import { Router } from "express";
import * as postiz from "../services/postiz.js";

const router = Router();

const asyncH = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) =>
    res.status(500).json({ ok: false, error: err.message })
  );

function requireConfigured(res) {
  if (!postiz.isConfigured()) {
    res.status(400).json({ ok: false, error: "POSTIZ_API_KEY not configured" });
    return false;
  }
  return true;
}

// Verify the API key is valid + connected.
router.get(
  "/status",
  asyncH(async (req, res) => {
    if (!requireConfigured(res)) return;
    const connected = await postiz.isConnected();
    res.json({ ok: true, connected });
  })
);

// List the connected channels so an influencer can be linked to one. Returns a
// trimmed shape with the id, platform identifier, name and profile.
router.get(
  "/integrations",
  asyncH(async (req, res) => {
    if (!requireConfigured(res)) return;
    const integrations = await postiz.listIntegrations();
    res.json({
      ok: true,
      integrations: integrations.map((i) => ({
        id: i.id,
        name: i.name,
        identifier: i.identifier,
        profile: i.profile,
        picture: i.picture,
        disabled: i.disabled,
      })),
    });
  })
);

// Next free posting slot for a channel.
router.get(
  "/integrations/:id/next-slot",
  asyncH(async (req, res) => {
    if (!requireConfigured(res)) return;
    const date = await postiz.findNextSlot(req.params.id);
    res.json({ ok: true, date });
  })
);

export default router;
