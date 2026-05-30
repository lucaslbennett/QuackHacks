# AI Influencer OS

Spawn an army of fully-autonomous AI influencers. Clone a real creator's style from
their public Instagram, generate a brand-new persona, auto-create a fresh Instagram
account, and let it produce + post commentary-style reels on a randomized schedule
while reporting its daily views and growth.

Built for the hackathon on **Node.js + Express + Railway**, integrating
**Anthropic Claude**, **ElevenLabs**, **fal.ai**, and **Browserbase Stagehand**.

## What it does

1. **Onboard** – questionnaire + links to existing influencer accounts to model from.
2. **Clone** – Stagehand scrapes the source profile(s); Claude synthesizes a distinct
   persona (bio, voice style, visual style, content pillars) and an ElevenLabs voice is matched.
3. **Spawn** – Stagehand auto-creates a fresh Instagram account, clearing email + SMS
   verification via pluggable providers (or manual code entry from the dashboard).
4. **Generate** – Claude writes a commentary script → ElevenLabs voices it → fal.ai
   generates visuals → FFmpeg assembles a 9:16 reel with burned-in captions.
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
  ├─ services/      anthropic, elevenlabs, fal, video (ffmpeg), verification
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

# 4. Run API (port 3000) and the web dev server (port 5173, proxies /api)
npm run dev
npm run web:dev
```

Open http://localhost:5173. The app degrades gracefully: `/api/status` shows which
integrations are configured, and unconfigured services simply error on use.

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
- `POST /api/influencers/:id/actions/:action` – `clone | spawn | generate | post | metrics`
- `POST /api/verification/:id/:kind` – submit a manual `email` / `sms` code

## Notes & responsible use

Instagram account creation and posting are automated against the live site and are
sensitive to anti-bot defenses; flows include retries and a manual-verification fallback.
Personas are modeled on a creator's *style*, not their identity. Use within Instagram's
terms and applicable laws.
