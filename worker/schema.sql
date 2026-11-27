-- The owner's server (spec §4.4): accounts, invitations, and each user's own records.
-- Apply with: npx wrangler d1 execute wh40k --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Only a hash of each session token is kept; the device holds the token itself.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used INTEGER NOT NULL
);

-- One-time invitation codes, hashed like passwords' cousins.
CREATE TABLE IF NOT EXISTS invites (
  code_hash TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_by TEXT
);

-- Failed logins and sign-ups per name and per address, to slow down guessing.
CREATE TABLE IF NOT EXISTS attempts (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

-- Every record a user keeps (a roster, a game, a collection row, a setting…), newest copy only.
-- `seq` orders changes per user so a device can ask for "everything since I last looked".
CREATE TABLE IF NOT EXISTS records (
  user_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  data TEXT,
  seq INTEGER NOT NULL,
  PRIMARY KEY (user_id, collection, id)
);

CREATE INDEX IF NOT EXISTS records_by_seq ON records (user_id, seq);
