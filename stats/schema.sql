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