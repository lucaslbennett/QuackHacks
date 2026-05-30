import { query, one, many } from "./pool.js";

export const influencers = {
  create: ({ name, niche, questionnaire, postsPerDay }) =>
    one(
      `INSERT INTO influencers (name, niche, questionnaire, posts_per_day, status)
       VALUES ($1,$2,$3,$4,'draft') RETURNING *`,
      [name, niche || null, questionnaire || {}, postsPerDay || 2]
    ),
  get: (id) => one(`SELECT * FROM influencers WHERE id=$1`, [id]),
  list: () => many(`SELECT * FROM influencers ORDER BY created_at DESC`),
  update: (id, fields) => {
    const keys = Object.keys(fields);
    if (!keys.length) return influencers.get(id);
    const sets = keys.map((k, i) => `${k}=$${i + 2}`);
    return one(
      `UPDATE influencers SET ${sets.join(", ")}, updated_at=now() WHERE id=$1 RETURNING *`,
      [id, ...keys.map((k) => fields[k])]
    );
  },
  remove: (id) => query(`DELETE FROM influencers WHERE id=$1`, [id]),
};

export const sourceAccounts = {
  create: ({ influencerId, url, handle }) =>
    one(
      `INSERT INTO source_accounts (influencer_id, url, handle) VALUES ($1,$2,$3) RETURNING *`,
      [influencerId, url, handle || null]
    ),
  listFor: (influencerId) =>
    many(`SELECT * FROM source_accounts WHERE influencer_id=$1`, [influencerId]),
  setScraped: (id, scraped, handle) =>
    one(
      `UPDATE source_accounts SET scraped=$2, handle=COALESCE($3, handle), scraped_at=now() WHERE id=$1 RETURNING *`,
      [id, scraped, handle || null]
    ),
};

export const igAccounts = {
  create: ({ influencerId, email, phone }) =>
    one(
      `INSERT INTO ig_accounts (influencer_id, email, phone, status) VALUES ($1,$2,$3,'pending') RETURNING *`,
      [influencerId, email || null, phone || null]
    ),
  forInfluencer: (influencerId) =>
    one(
      `SELECT * FROM ig_accounts WHERE influencer_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [influencerId]
    ),
  update: (id, fields) => {
    const keys = Object.keys(fields);
    const sets = keys.map((k, i) => `${k}=$${i + 2}`);
    return one(
      `UPDATE ig_accounts SET ${sets.join(", ")}, updated_at=now() WHERE id=$1 RETURNING *`,
      [id, ...keys.map((k) => fields[k])]
    );
  },
};

export const content = {
  create: ({ influencerId, topic, status = "queued" }) =>
    one(
      `INSERT INTO content_items (influencer_id, topic, status) VALUES ($1,$2,$3) RETURNING *`,
      [influencerId, topic || null, status]
    ),
  get: (id) => one(`SELECT * FROM content_items WHERE id=$1`, [id]),
  listFor: (influencerId) =>
    many(
      `SELECT * FROM content_items WHERE influencer_id=$1 ORDER BY created_at DESC LIMIT 100`,
      [influencerId]
    ),
  update: (id, fields) => {
    const keys = Object.keys(fields);
    const sets = keys.map((k, i) => `${k}=$${i + 2}`);
    return one(
      `UPDATE content_items SET ${sets.join(", ")}, updated_at=now() WHERE id=$1 RETURNING *`,
      [id, ...keys.map((k) => fields[k])]
    );
  },
};

export const posts = {
  create: ({ influencerId, contentId, url, shortcode, caption }) =>
    one(
      `INSERT INTO posts (influencer_id, content_id, ig_post_url, ig_shortcode, caption)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [influencerId, contentId || null, url || null, shortcode || null, caption || null]
    ),
  listFor: (influencerId) =>
    many(`SELECT * FROM posts WHERE influencer_id=$1 ORDER BY posted_at DESC`, [influencerId]),
};

export const metrics = {
  upsertDaily: ({ influencerId, postId, views, likes, comments, followers }) =>
    one(
      `INSERT INTO metrics_daily (influencer_id, post_id, date, views, likes, comments, followers)
       VALUES ($1,$2,CURRENT_DATE,$3,$4,$5,$6)
       ON CONFLICT (post_id, date) DO UPDATE SET
         views=EXCLUDED.views, likes=EXCLUDED.likes,
         comments=EXCLUDED.comments, followers=EXCLUDED.followers
       RETURNING *`,
      [influencerId, postId || null, views || 0, likes || 0, comments || 0, followers || 0]
    ),
  dailyTotals: (influencerId) =>
    many(
      `SELECT date,
              SUM(views) AS views,
              SUM(likes) AS likes,
              SUM(comments) AS comments,
              MAX(followers) AS followers
       FROM metrics_daily WHERE influencer_id=$1
       GROUP BY date ORDER BY date DESC LIMIT 30`,
      [influencerId]
    ),
};

export const jobs = {
  enqueue: ({ influencerId, type, payload = {}, runAt = new Date(), maxAttempts = 3 }) =>
    one(
      `INSERT INTO jobs (influencer_id, type, payload, run_at, max_attempts)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [influencerId || null, type, payload, runAt, maxAttempts]
    ),
  listFor: (influencerId) =>
    many(
      `SELECT * FROM jobs WHERE influencer_id=$1 ORDER BY created_at DESC LIMIT 50`,
      [influencerId]
    ),
  // Atomically claim the next due job.
  claimNext: async () =>
    one(
      `UPDATE jobs SET status='running', locked_at=now(), attempts=attempts+1, updated_at=now()
       WHERE id = (
         SELECT id FROM jobs
         WHERE status='pending' AND run_at <= now()
         ORDER BY run_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING *`
    ),
  complete: (id, result) =>
    query(`UPDATE jobs SET status='done', result=$2, updated_at=now() WHERE id=$1`, [
      id,
      result || {},
    ]),
  fail: (id, error, retry) =>
    query(
      `UPDATE jobs SET status=$3, last_error=$2,
         run_at = CASE WHEN $3='pending' THEN now() + interval '30 seconds' ELSE run_at END,
         updated_at=now()
       WHERE id=$1`,
      [id, String(error).slice(0, 1000), retry ? "pending" : "failed"]
    ),
};
