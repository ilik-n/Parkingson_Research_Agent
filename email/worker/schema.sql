-- D1 schema for the Parkinson's Advances email digest.
-- Apply with: wrangler d1 execute parkinsons-advances-subscribers --file=schema.sql --remote

CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  -- Comma-separated category list matching update_feed.py's ALLOWED_CATEGORIES, or "all".
  categories TEXT NOT NULL DEFAULT 'all',
  status TEXT NOT NULL DEFAULT 'pending', -- pending | confirmed | unsubscribed
  confirm_token TEXT NOT NULL,
  unsubscribe_token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Single-row table tracking the newest date_added already mailed out, so /send-digest only
-- sends entries added since the last successful run.
CREATE TABLE IF NOT EXISTS digest_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_date_added TEXT NOT NULL DEFAULT '1970-01-01'
);
INSERT OR IGNORE INTO digest_state (id, last_date_added) VALUES (1, '1970-01-01');
