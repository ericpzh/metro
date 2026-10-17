-- Development-only sample data for the local stats preview.
--
-- `npm run dev:stats -- --seed` applies this after `schema.sql`; the default
-- local preview is empty and is filled by the real game at localhost:5174.
-- It is never run against the production D1 database. Every row is idempotent
-- (fixed primary keys plus `INSERT OR IGNORE`), so restarting the preview does
-- not duplicate stations or passenger deltas.

INSERT OR IGNORE INTO clients (client_id, first_seen, last_seen) VALUES
  ('11111111-1111-4111-8111-111111111111', '2026-10-14T08:12:00.000Z', '2026-10-17T09:42:00.000Z'),
  ('22222222-2222-4222-8222-222222222222', '2026-10-15T11:30:00.000Z', '2026-10-17T10:05:00.000Z'),
  ('33333333-3333-4333-8333-333333333333', '2026-10-16T18:45:00.000Z', '2026-10-17T10:18:00.000Z');

INSERT OR IGNORE INTO stations
  (client_id, station_name, cells, modules, lines, platforms, tracks, first_seen, last_seen, submissions)
VALUES
  ('11111111-1111-4111-8111-111111111111', '动物园', 18450, 2460, 1, 2, 2, '2026-10-14T08:12:00.000Z', '2026-10-17T09:42:00.000Z', 42),
  ('22222222-2222-4222-8222-222222222222', '坦尾', 27310, 3180, 2, 4, 4, '2026-10-15T11:30:00.000Z', '2026-10-17T10:05:00.000Z', 31),
  ('33333333-3333-4333-8333-333333333333', 'Sample Interchange', 9620, 1120, 2, 2, 2, '2026-10-16T18:45:00.000Z', '2026-10-17T10:18:00.000Z', 12);

INSERT OR IGNORE INTO passenger_deltas
  (client_id, session_id, submit_id, station_name, boarded, alighted, exited,
   left_behind, sim_seconds, train_arrivals, created_at)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a1111111-1111-4111-8111-111111111111', '动物园', 125000, 119400, 99000, 2300, 86000, 1420, '2026-10-17T09:42:00.000Z'),
  ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b2222222-2222-4222-8222-222222222222', '坦尾', 88000, 84000, 71000, 900, 54000, 980, '2026-10-17T10:05:00.000Z'),
  ('33333333-3333-4333-8333-333333333333', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'c3333333-3333-4333-8333-333333333333', 'Sample Interchange', 43000, 41500, 35000, 120, 27000, 510, '2026-10-17T10:18:00.000Z');
