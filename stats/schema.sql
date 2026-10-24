-- Global stats for Station Designer. Apply with:
--   Production:  npm run deploy:stats
--   Local dev:   npm run dev:stats   (applies this file to the local D1)
-- Both paths are idempotent, so they can be re-run safely.

CREATE TABLE IF NOT EXISTS clients (
  client_id TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL,
  last_seen  TEXT NOT NULL
);

-- A station is identified by (client_id, station_name): "distinct user +
-- distinct station name", as agreed. Counts are refreshed on every submit.
CREATE TABLE IF NOT EXISTS stations (
  client_id    TEXT NOT NULL,
  station_name TEXT NOT NULL,
  cells        INTEGER NOT NULL DEFAULT 0,
  modules      INTEGER NOT NULL DEFAULT 0,
  lines        INTEGER NOT NULL DEFAULT 0,
  platforms    INTEGER NOT NULL DEFAULT 0,
  tracks       INTEGER NOT NULL DEFAULT 0,
  first_seen   TEXT NOT NULL,
  last_seen    TEXT NOT NULL,
  submissions  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, station_name),
  FOREIGN KEY (client_id) REFERENCES clients(client_id)
);

CREATE TABLE IF NOT EXISTS passenger_deltas (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id      TEXT NOT NULL,
  session_id     TEXT NOT NULL,
  submit_id      TEXT NOT NULL,
  station_name   TEXT,
  boarded        INTEGER NOT NULL DEFAULT 0,
  alighted       INTEGER NOT NULL DEFAULT 0,
  exited         INTEGER NOT NULL DEFAULT 0,
  left_behind    INTEGER NOT NULL DEFAULT 0,
  sim_seconds    REAL    NOT NULL DEFAULT 0,
  train_arrivals INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  UNIQUE (client_id, submit_id),
  FOREIGN KEY (client_id) REFERENCES clients(client_id)
);

-- Abuse-only: one row per accepted submit, holding a **keyed hash** of the
-- connection address (`HMAC-SHA256(ip, IP_HASH_SECRET)`), never the raw IP.
-- This exists so a bad submission can be traced and cleaned up, and a repeat
-- offender blocked. It is deliberately not part of the public totals and is not
-- exposed by any read endpoint.
--
-- It is its own table, not a column on `passenger_deltas`, because this file is
-- re-applied by every deploy and preview: D1 has no `ADD COLUMN IF NOT EXISTS`,
-- so an added column would break the second run. `ip_hash` is nullable: a NULL
-- row means the deploy had no `IP_HASH_SECRET` and hashing was skipped.
CREATE TABLE IF NOT EXISTS submit_ips (
  client_id  TEXT NOT NULL,
  submit_id  TEXT NOT NULL,
  ip_hash    TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (client_id, submit_id),
  FOREIGN KEY (client_id) REFERENCES clients(client_id)
);

-- The ban list. `expires_at` is optional: NULL is a permanent block. Populate by
-- hand from a `submit_ips` lookup (see stats/README.md), never from the client.
CREATE TABLE IF NOT EXISTS blocked_ips (
  ip_hash    TEXT PRIMARY KEY,
  reason     TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT
);

-- Short-lived, single-use write leases. The Worker mints a random token and
-- stores **only its SHA-256**, so a database dump cannot be replayed. A submit
-- deletes its row (`token_hash + client_id + expires_at`) before writing, which
-- makes a replayed payload fail with 401 even if it carries a fresh `submit_id`.
--
-- No foreign key to `clients`: a lease is issued before the first submit, and a
-- client row is only written when a submission is actually accepted.
CREATE TABLE IF NOT EXISTS submit_leases (
  token_hash TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL,
  ip_hash    TEXT,
  issued_at  TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Fixed-window counters for the lease endpoint. The lease is the submit budget:
-- every accepted submit needs one, so limiting issuance limits the write path.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket     TEXT PRIMARY KEY,
  count      INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS global_counters (
  key   TEXT PRIMARY KEY,
  value REAL NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO global_counters (key, value) VALUES
  ('stations', 0),
  ('passengers_boarded', 0),
  ('passengers_alighted', 0),
  ('passengers_exited', 0),
  ('passengers_left_behind', 0),
  ('sim_seconds', 0),
  ('train_arrivals', 0);

-- Counters are maintained by triggers so a submit is a single batched
-- transaction and concurrent writers can't drift the totals.
CREATE TRIGGER IF NOT EXISTS stations_insert_counter
AFTER INSERT ON stations
BEGIN
  UPDATE global_counters SET value = value + 1 WHERE key = 'stations';
END;

CREATE TRIGGER IF NOT EXISTS passenger_delta_insert_counter
AFTER INSERT ON passenger_deltas
BEGIN
  UPDATE global_counters SET value = value + NEW.boarded WHERE key = 'passengers_boarded';
  UPDATE global_counters SET value = value + NEW.alighted WHERE key = 'passengers_alighted';
  UPDATE global_counters SET value = value + NEW.exited WHERE key = 'passengers_exited';
  UPDATE global_counters SET value = value + NEW.left_behind WHERE key = 'passengers_left_behind';
  UPDATE global_counters SET value = value + NEW.sim_seconds WHERE key = 'sim_seconds';
  UPDATE global_counters SET value = value + NEW.train_arrivals WHERE key = 'train_arrivals';
END;

CREATE INDEX IF NOT EXISTS idx_stations_client ON stations (client_id);
CREATE INDEX IF NOT EXISTS idx_deltas_client ON passenger_deltas (client_id);
CREATE INDEX IF NOT EXISTS idx_deltas_created ON passenger_deltas (created_at);
CREATE INDEX IF NOT EXISTS idx_submit_ips_hash ON submit_ips (ip_hash);
CREATE INDEX IF NOT EXISTS idx_submit_ips_client ON submit_ips (client_id);
CREATE INDEX IF NOT EXISTS idx_leases_expiry ON submit_leases (expires_at);
CREATE INDEX IF NOT EXISTS idx_leases_client ON submit_leases (client_id);
CREATE INDEX IF NOT EXISTS idx_rate_limits_updated ON rate_limits (updated_at);