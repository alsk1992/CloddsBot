-- Clodds Worker D1 Schema

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  username TEXT,
  settings TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  UNIQUE(platform, platform_user_id)
);

-- Alerts table
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  market_id TEXT NOT NULL,
  market_name TEXT,
  condition_type TEXT NOT NULL,
  threshold REAL NOT NULL,
  triggered INTEGER DEFAULT 0,
  triggered_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_market ON alerts(platform, market_id);

-- Positions table (manual tracking)
CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  market_id TEXT NOT NULL,
  market_question TEXT,
  outcome TEXT NOT NULL,
  side TEXT NOT NULL,
  shares REAL NOT NULL,
  avg_price REAL NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_positions_user ON positions(user_id);

-- Arbitrage history table
CREATE TABLE IF NOT EXISTS arbitrage_history (
  id TEXT PRIMARY KEY,
  found_at INTEGER NOT NULL,
  platform TEXT NOT NULL,
  market_id TEXT NOT NULL,
  market_question TEXT,
  yes_price REAL,
  no_price REAL,
  edge_pct REAL NOT NULL,
  mode TEXT NOT NULL,
  notified_users TEXT DEFAULT '[]',
  expired INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_arb_found ON arbitrage_history(found_at DESC);
CREATE INDEX IF NOT EXISTS idx_arb_market ON arbitrage_history(platform, market_id);

-- Watched wallets table
CREATE TABLE IF NOT EXISTS watched_wallets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  address TEXT NOT NULL,
  nickname TEXT,
  auto_copy INTEGER DEFAULT 0,
  copy_settings TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(user_id, platform, address)
);

CREATE INDEX IF NOT EXISTS idx_watched_user ON watched_wallets(user_id);
