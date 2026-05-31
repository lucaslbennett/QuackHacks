import { query, one, many } from "./pool.js";

export const users = {
  create: ({ email, passwordHash, name, role = "user" }) =>
    one(
      `INSERT INTO users (email, password_hash, name, role)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [email, passwordHash, name || null, role]
    ),
  getById: (id) => one(`SELECT * FROM users WHERE id=$1`, [id]),
  getByEmail: (email) =>
    one(`SELECT * FROM users WHERE lower(email)=lower($1)`, [email]),
  list: () =>
    many(`SELECT * FROM users ORDER BY created_at DESC LIMIT 200`),
  update: (id, fields) => {
    const keys = Object.keys(fields);
    if (!keys.length) return users.getById(id);
    const sets = keys.map((k, i) => `${k}=$${i + 2}`);
    return one(
      `UPDATE users SET ${sets.join(", ")}, updated_at=now() WHERE id=$1 RETURNING *`,
      [id, ...keys.map((k) => fields[k])]
    );
  },
  remove: (id) => query(`DELETE FROM users WHERE id=$1`, [id]),
};

export const sessions = {
  create: ({ userId, tokenHash, expiresAt }) =>
    one(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1,$2,$3) RETURNING *`,
      [userId, tokenHash, expiresAt]
    ),
  getValidByTokenHash: (tokenHash) =>
    one(
      `SELECT * FROM sessions WHERE token_hash=$1 AND expires_at > now()`,
      [tokenHash]
    ),
  deleteByTokenHash: (tokenHash) =>
    query(`DELETE FROM sessions WHERE token_hash=$1`, [tokenHash]),
  deleteForUser: (userId) =>
    query(`DELETE FROM sessions WHERE user_id=$1`, [userId]),
  purgeExpired: () => query(`DELETE FROM sessions WHERE expires_at <= now()`),
};

export const generations = {
  create: ({ userId, prompt, imageUrl, persona }) =>
    one(
      `INSERT INTO generations (user_id, prompt, image_url, persona)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [userId, prompt, imageUrl, persona || {}]
    ),
  listFor: (userId) =>
    many(
      `SELECT * FROM generations WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`,
      [userId]
    ),
};

export const influencers = {
  create: async ({
    userId,
    name,
    niche,
    handle,
    questionnaire,
    persona,
    imageUrl,
    postsPerDay,
    status = "draft",
  }) => {
    let sortOrder = 0;
    if (userId) {
      const row = await one(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM influencers WHERE user_id=$1`,
        [userId]
      );
      sortOrder = Number(row?.n ?? 0);
    }
    return one(
      `INSERT INTO influencers
         (user_id, name, niche, handle, questionnaire, persona, image_url, posts_per_day, sort_order, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        userId || null,
        name,
        niche || null,
        handle || null,
        questionnaire || {},
        persona || {},
        imageUrl || null,
        postsPerDay || 2,
        sortOrder,
        status,
      ]
    );
  },
  get: (id) => one(`SELECT * FROM influencers WHERE id=$1`, [id]),
  list: () => many(`SELECT * FROM influencers ORDER BY created_at DESC`),
  listForUser: (userId) =>
    many(
      `SELECT * FROM influencers WHERE user_id=$1 ORDER BY sort_order ASC, created_at DESC`,
      [userId]
    ),
  reorderForUser: async (userId, orderedIds) => {
    const owned = await many(`SELECT id FROM influencers WHERE user_id=$1`, [userId]);
    const ownedSet = new Set(owned.map((r) => r.id));
    for (const id of orderedIds) {
      if (!ownedSet.has(id)) throw new Error("forbidden");
    }
    for (let i = 0; i < orderedIds.length; i++) {
      await query(
        `UPDATE influencers SET sort_order=$1, updated_at=now() WHERE id=$2 AND user_id=$3`,
        [i, orderedIds[i], userId]
      );
    }
  },
  update: (id, fields) => {
    const keys = Object.keys(fields);
    if (!keys.length) return influencers.get(id);
    const sets = keys.map((k, i) => `${k}=$${i + 2}`);
    return one(
      `UPDATE influencers SET ${sets.join(", ")}, updated_at=now() WHERE id=$1 RETURNING *`,
      [id, ...keys.map((k) => fields[k])]
    );
  },
  unlinkPostizIntegration: (integrationId) =>
    query(
      `UPDATE influencers SET postiz_integration_id = NULL, updated_at = now() WHERE postiz_integration_id = $1`,
      [integrationId]
    ),
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
  create: ({ influencerId, email }) =>
    one(
      `INSERT INTO ig_accounts (influencer_id, email, status) VALUES ($1,$2,'pending') RETURNING *`,
      [influencerId, email || null]
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
  // Joins each content row with its posts record so the UI can show scheduled/posted times.
  listForWithPostTimes: async (influencerId) => {
    const [items, postRows] = await Promise.all([
      content.listFor(influencerId),
      posts.listFor(influencerId),
    ]);
    const byContent = new Map();
    for (const p of postRows) {
      if (!p.content_id) continue;
      const prev = byContent.get(p.content_id);
      if (!prev || new Date(p.posted_at).getTime() >= new Date(prev.posted_at).getTime()) {
        byContent.set(p.content_id, p);
      }
    }
    return items.map((item) => {
      const row = byContent.get(item.id);
      if (!row) return item;
      return {
        ...item,
        scheduled_at: row.scheduled_at || null,
        posted_at: row.posted_at || null,
      };
    });
  },
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
  // Records a post that was scheduled through Postiz (not yet published).
  createScheduled: ({ influencerId, contentId, postizPostId, caption, platform, scheduledAt }) =>
    one(
      `INSERT INTO posts (influencer_id, content_id, postiz_post_id, caption, platform, scheduled_at)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        influencerId,
        contentId || null,
        postizPostId || null,
        caption || null,
        platform || null,
        scheduledAt || null,
      ]
    ),
  // Records a post that was published immediately through Postiz. Stores the
  // Postiz post id + platform alongside a public profile/post URL so the
  // dashboard can deep-link to the live account.
  createPublished: ({ influencerId, contentId, postizPostId, caption, platform, url }) =>
    one(
      `INSERT INTO posts (influencer_id, content_id, postiz_post_id, caption, platform, ig_post_url)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        influencerId,
        contentId || null,
        postizPostId || null,
        caption || null,
        platform || null,
        url || null,
      ]
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
  cancelPending: (influencerId, types) =>
    query(
      `DELETE FROM jobs
       WHERE influencer_id=$1 AND status='pending' AND type = ANY($2::text[])`,
      [influencerId, types]
    ),
  hasActive: (influencerId, type) =>
    one(
      `SELECT id, status, run_at, last_error FROM jobs
       WHERE influencer_id=$1 AND type=$2 AND status IN ('pending', 'running')
       ORDER BY run_at ASC LIMIT 1`,
      [influencerId, type]
    ),
  lastOfType: (influencerId, type) =>
    one(
      `SELECT id, status, run_at, last_error, updated_at, result FROM jobs
       WHERE influencer_id=$1 AND type=$2
       ORDER BY updated_at DESC LIMIT 1`,
      [influencerId, type]
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
