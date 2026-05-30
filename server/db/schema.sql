-- AI Influencer OS schema. Safe to run repeatedly (idempotent).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- App users (authentication + arbitrary per-user data).
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT,
  role          TEXT NOT NULL DEFAULT 'user',
  -- user | admin
  data          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Opaque bearer sessions. We store only a hash of the token, never the token.
CREATE TABLE IF NOT EXISTS sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

-- Saved AI influencer image generations (Nano Banana Pro previews users keep).
CREATE TABLE IF NOT EXISTS generations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt      TEXT NOT NULL,
  image_url   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS generations_user_idx ON generations (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS influencers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  handle      TEXT,
  niche       TEXT,
  status      TEXT NOT NULL DEFAULT 'draft',
  -- draft | cloning | ready | spawning | active | paused | error
  persona     JSONB NOT NULL DEFAULT '{}'::jsonb,
  questionnaire JSONB NOT NULL DEFAULT '{}'::jsonb,
  voice_id    TEXT,
  posts_per_day INT NOT NULL DEFAULT 2,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  influencer_id UUID NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL DEFAULT 'instagram',
  url           TEXT NOT NULL,
  handle        TEXT,
  scraped       JSONB NOT NULL DEFAULT '{}'::jsonb,
  scraped_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ig_accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  influencer_id UUID NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
  username      TEXT,
  password_enc  TEXT,
  email         TEXT,
  phone         TEXT,
  full_name     TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  -- pending | creating | verifying | active | failed
  session       JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  influencer_id UUID NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
  title         TEXT,
  topic         TEXT,
  script        TEXT,
  caption       TEXT,
  hashtags      TEXT[],
  audio_path    TEXT,
  image_paths   TEXT[],
  video_path    TEXT,
  status        TEXT NOT NULL DEFAULT 'queued',
  -- queued | scripting | voicing | rendering | ready | posting | posted | failed
  error         TEXT,
  meta          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS posts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  influencer_id UUID NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
  content_id    UUID REFERENCES content_items(id) ON DELETE SET NULL,
  ig_post_url   TEXT,
  ig_shortcode  TEXT,
  caption       TEXT,
  posted_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS metrics_daily (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  influencer_id UUID NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
  post_id       UUID REFERENCES posts(id) ON DELETE CASCADE,
  date          DATE NOT NULL DEFAULT CURRENT_DATE,
  views         BIGINT NOT NULL DEFAULT 0,
  likes         BIGINT NOT NULL DEFAULT 0,
  comments      BIGINT NOT NULL DEFAULT 0,
  followers     BIGINT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_id, date)
);

CREATE TABLE IF NOT EXISTS jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  influencer_id UUID REFERENCES influencers(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  -- clone_persona | spawn_account | generate_content | post_content | scrape_metrics
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'pending',
  -- pending | running | done | failed
  run_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts      INT NOT NULL DEFAULT 0,
  max_attempts  INT NOT NULL DEFAULT 3,
  last_error    TEXT,
  result        JSONB,
  locked_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_pickup_idx ON jobs (status, run_at);
CREATE INDEX IF NOT EXISTS content_influencer_idx ON content_items (influencer_id, status);
CREATE INDEX IF NOT EXISTS metrics_influencer_date_idx ON metrics_daily (influencer_id, date);
CREATE INDEX IF NOT EXISTS posts_influencer_idx ON posts (influencer_id, posted_at);
