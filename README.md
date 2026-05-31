# AI Influencer OS

Spawn an army of fully-autonomous AI influencers. Clone a real creator's style from
their public Instagram, generate a brand-new persona, auto-create a fresh Instagram
account, and let it produce + post commentary-style reels on a randomized schedule
while reporting its daily views and growth.

Built for the hackathon on **Node.js + Express + Railway**, integrating
**Google Gemini**, **ElevenLabs**, and **Browserbase Stagehand**.

## What it does

1. **Create** – describe the influencer and optionally add existing accounts to model from.
2. **Clone** – Stagehand scrapes the source profile(s); Gemini synthesizes a distinct
   persona (bio, voice style, visual style, content pillars) and an ElevenLabs voice is matched.
3. **Spawn** – Stagehand auto-creates a fresh Instagram account, clearing email + SMS
   verification via pluggable providers (or manual code entry from the dashboard).
4. **Generate** – Gemini writes a commentary script → ElevenLabs voices it → Gemini
   Nano Banana generates B-roll stills → FFmpeg assembles a 9:16 reel with captions.
5. **Post** – Stagehand logs in and publishes the reel with caption + hashtags at
   randomized human-like times.
6. **Report** – Stagehand scrapes per-post views/likes and follower count into Postgres;
   the dashboard charts daily performance.

## Architecture

```
web/ (React + Vite + Tailwind dashboard)  ─┐
                                            │ served statically by
server/ (Express API + cron + job runner) ─┘
  ├─ routes/        REST API
  ├─ services/      gemini, elevenlabs, video (ffmpeg), verification
  │   └─ browser/   Stagehand flows: scrape / create account / post / metrics
  ├─ jobs/          DB-backed queue (runner) + node-cron (scheduler) + pipeline
  └─ db/            Postgres pool, schema, repo
```

Long-running work (browser automation, rendering) runs as background **jobs** so HTTP
stays fast. A `jobs` table is polled by the runner; `node-cron` plans daily content and
metrics scraping for every active influencer.

## Local development

```bash
# 1. Install
npm install
npm --prefix web install

# 2. Configure
cp .env.example .env   # fill in keys + a local DATABASE_URL

# 3. Migrate the schema
npm run migrate

# 4. Start everything (backend :3000 + Vite :5173) with one command:
./dev.sh               # or: npm run dev:all
```

`./dev.sh` clears stale caches, starts the backend, waits until it's actually up,
then starts the Vite dev server with a forced-fresh build and health-checks the
proxy. Press **Ctrl+C** once to stop both. Useful flags:

```bash
./dev.sh --install     # run npm installs first (fresh clone)
./dev.sh --no-clean    # faster restart, keep caches
./dev.sh --backend     # API only       ./dev.sh --frontend   # web only
./dev.sh --help        # all options
```

> Prefer two terminals? Run `npm run dev` (backend) and `npm run web:dev`
> (frontend) separately instead.

Open **http://localhost:5173** — the Vite dev server proxies `/api` and `/media`
to the backend, so always use this URL (not `:3000`) to avoid the stale
production bundle. The app degrades gracefully: `/api/status` shows which
integrations are configured, and unconfigured services simply error on use.

### Reloading while you work

- **Frontend (`web/src/**`)** hot-reloads automatically via Vite — no restart needed.
- **Backend (`server/**`)** does not auto-reload. After editing a server file
  (prompts, routes, services), restart it: **Ctrl+C in the backend terminal, then
  run `npm run dev` again.** `npm run dev` first frees port 3000 (via
  `server/scripts/freePort.js`) so re-running it always works cleanly and never
  hits `EADDRINUSE`, even if a previous server is still lingering.

> Note: `node --watch` is intentionally not used here — it crashes with
> `EMFILE: too many open files` in some local environments. `npm run dev` uses
> plain `node` plus the port-free step instead.

## Deploy to Railway

1. Add a **Postgres** plugin to the project.
2. Set service variables (see `.env.example`). Reference Postgres as
   `DATABASE_URL=${{Postgres.DATABASE_URL}}`.
3. `nixpacks.toml` installs **ffmpeg** and builds the dashboard; `npm start` serves the
   API + built frontend on `$PORT`. The schema auto-migrates on boot.
4. (Optional) Mount a Railway volume at `media/` to persist generated media across deploys.

## API quick reference

- `GET  /api/status` – integration health
- `POST /api/influencers` – create from the onboarding wizard
- `GET  /api/influencers/:id` – full state (persona, content, posts, metrics, jobs)
- `POST /api/influencers/:id/actions/:action` – `clone | spawn | generate | post | schedule | metrics`
- `POST /api/influencers/:id/postiz` – link the influencer to a Postiz channel (`{ integrationId, platform }`)
- `GET  /api/postiz/status` – verify the Postiz API key is connected
- `GET  /api/postiz/integrations` – list connected Postiz channels (id + platform)
- `POST /api/verification/:id/:kind` – submit a manual `email` / `sms` code

## Posting via Postiz

Posts can be scheduled through [Postiz](https://docs.postiz.com/public-api/introduction)
instead of (or alongside) the Stagehand IG poster.

1. Set `POSTIZ_API_KEY` (Settings → Developers → Public API). Optionally
   `POSTIZ_API_BASE` for a self-hosted instance.
2. Set `PUBLIC_BASE_URL` (or rely on Railway's `RAILWAY_PUBLIC_DOMAIN`) so Postiz
   can fetch the rendered `/media` reel.
3. List channels with `GET /api/postiz/integrations`, then link one to an
   influencer: `POST /api/influencers/:id/postiz` with
   `{ "integrationId": "<id>", "platform": "<identifier>" }` (use the channel's
   `identifier`, e.g. `instagram-standalone`).
4. Schedule a ready reel on demand:
   `POST /api/influencers/:id/actions/schedule` (optional body:
   `{ contentId, runAt, type }` where `type` is `schedule | now | draft`).
5. To make the daily planner route posts through Postiz automatically for linked
   influencers, set `SCHEDULER_USE_POSTIZ=true`.

## Notes & responsible use

Instagram account creation and posting are automated against the live site and are
sensitive to anti-bot defenses; flows include retries and a manual-verification fallback.
Personas are modeled on a creator's *style*, not their identity. Use within Instagram's
terms and applicable laws.
