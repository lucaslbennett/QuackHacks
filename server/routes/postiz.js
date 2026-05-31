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

// Generate a Postiz OAuth URL so the user can connect a new channel without
// leaving the app. Defaults to Instagram. The client opens the returned URL
// (popup/new tab), the user authorizes, and the new channel then shows up in
// GET /integrations. Pass ?refresh=<integrationId> to refresh an existing one.
router.get(
  "/connect-url",
  asyncH(async (req, res) => {
    if (!requireConfigured(res)) return;
    const platform = String(req.query.platform || "instagram").trim();
    const refresh = req.query.refresh ? String(req.query.refresh) : undefined;
    const url = await postiz.getConnectUrl(platform, { refresh });
    res.json({ ok: true, url, platform });
  })
);

export default router;
