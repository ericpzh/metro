---
name: metro-stats
description: Work on the stats/ Cloudflare Worker and D1 service for anonymous global station statistics and the public bug, feature, and save-share board. Use when editing stats/, its D1 schema or deploy/preview scripts, tools/check-stats-reports.mjs, or the game client collector in game/src/app/globalStats.ts.
---

# Metro Global Stats & Feedback Service (`stats/`)

`stats/` is a standalone Cloudflare Worker (`metro-stats`,
[`stats/wrangler.jsonc`](../../../stats/wrangler.jsonc)) backed by one D1
database (`STATS_DB`), with no bundler, asset binding, or R2 bucket. It owns
`stationdesigner.com/stats` and `stationdesigner.com/stats/*` (both patterns
are required because `/stats/*` does not match bare `/stats`; never collapse to
`/stats*`).

- **Totals pages**: `/stats/` (`zh-CN`) and `/stats/en/` (`en`) — one-shot
  snapshot calling `/stats/api/v1/global` once on load (no polling).
- **Public board**: `/stats/report` (`zh-CN`) and `/stats/en/report` (`en`) —
  bugs, feature requests, upvotes, and public `metro-save` JSON sharing.
- **Canonical `308` redirects**: `/stats` and `/stats/index.html` → `/stats/`;
  `/stats/en` and `/stats/en/index.html` → `/stats/en/`; `/stats/report/` →
  `/stats/report`; `/stats/en/report/` → `/stats/en/report`.

## File Map

| Path | Responsibility |
| --- | --- |
| `stats/worker.js` | Worker entry, routing, CORS, origin gate, IP hash, bans, leases, rate limits, stats API. |
| `stats/page.js` | HTML/CSS shell, bilingual `PAGE_COPY` (`zh`/`en`), totals snapshot script, dev badge. |
| `stats/report-page.js` | Board markup, `REPORT_STYLE`, literal `REPORT_CLIENT` script (language filter, save check). |
| `stats/reports.js` | `/v1/reports`, `/:id/vote`, `/:id/save` handlers, UTC daily SQL quotas, chunked saves. |
| `stats/limits.js` | Shared numeric limits for Worker and tests (never exported from `worker.js`). |
| `stats/favicon.js`, `brand-mark.js` | Generated PNG data URIs (64 px favicon, 96 px mask); regenerate via `tools/prepare-brand-icon.mjs`. |
| `stats/schema.sql`, `seed.sql` | Idempotent D1 schema and dev-only sample rows (`--seed`). |
| `stats/wrangler.jsonc` | Prod (`metro-stats`, `workers_dev`/`preview_urls: false`) and isolated `env.dev`. |
| `stats/scripts/preview.mjs`, `deploy.mjs` | Local `dev` runner and remote prod deploy + live smoke checks. |
| `stats/test/worker.test.mjs`, `reports.test.mjs` | Unit tests (fake D1 + `node:sqlite` concurrency, UTC resets, saves, `vm.Script`). |
| `stats/README.md` | Service overview, Workers Builds setup, and D1 admin queries. |

## Commands

Run from the repository root:

```powershell
npm run dev:stats                   # Local dev Worker + D1 at http://127.0.0.1:5176/ (empty DB)
npm run dev:stats -- --seed         # Apply idempotent stats/seed.sql (also --reset, --port, --migrate-only)
npm run build:stats                 # node --check on every JS module in stats/
npm run test:stats                  # node --test "stats/test/*.test.mjs"
npm run check:stats:reports         # Headless Chrome/Edge E2E against isolated temp D1
npm run deploy:stats                # build:stats + remote schema.sql + prod deploy + live checks
npm run deploy:stats:ci             # Workers Builds prod deploy (skips D1 SQL migration)
npm run version:stats               # Workers Builds non-main upload (never use dev:stats in CI)
node tools/prepare-brand-icon.mjs   # Regenerate favicon.js & brand-mark.js from design/icon/
```

- `npm run preview:stats` aliases `dev:stats`; `npm start` / `npm run dev:all`
  launches `stats` on port `5176` (running `--migrate-only` if already up).
- `preview.mjs` honors `STATS_STATE_DIR`, `STATS_RUNTIME_TEMP`, and `STATS_PORT`.
  `tools/check-stats-reports.mjs` runs in temporary dirs and cleans up afterward
  without touching `dev:stats` state.
- **CI vs manual deploy**: Workers Builds' default token lacks `D1:Edit`, so
  `deploy:stats:ci` skips SQL; run `npm run deploy:stats` locally for schema
  changes (or grant `D1:Edit`).
- **Secrets & D1 admin**: `npx wrangler secret put IP_HASH_SECRET --config stats/wrangler.jsonc --env=`;
  remote SQL via `npx wrangler d1 execute STATS_DB --remote --config stats/wrangler.jsonc --yes --command "..."`
  (deleting `reports` cascades saves/votes; deleting `report_votes` decrements
  `reports.votes` via trigger).

## API & D1 Storage

All API responses set `Cache-Control: no-store` and return `503` if `STATS_DB`
is unbound.

| Endpoint | Contract |
| --- | --- |
| `GET /stats/api` | Lists `global`, `lease`, `submit`, `health`, and `reports`. |
| `GET /stats/api/v1/health` | Checks 5 core tables (`stations`, `submit_leases`, `rate_limits`, `reports`, `report_votes`); `503` until applied, else `200` with `ipHash` (`"enabled"` / `"unconfigured"`). |
| `GET /stats/api/v1/global` | Reads `global_counters`, live `COUNT(*)` on `stations`, and latest `updatedAt`. |
| `POST /stats/api/v1/lease` | `{ clientId }` → 64-hex token (`LEASE_TTL_MS = 6 min`); stores SHA-256 in `submit_leases`, sweeps expired leases/rate buckets. |
| `POST /stats/api/v1/submit` | `{ clientId, submitId, sessionId?, lease?, station, delta }` (or `X-Stats-Lease`). Consumes lease, deduplicates `(client_id, submit_id)`, batches `clients`, `passenger_deltas`, conditional `stations` (`changes() = 1`), `submit_ips`. |
| `GET /stats/api/v1/reports` | `sort=top\|new`, `type=all\|bug\|feature\|share`, `offset` (`REPORT_PAGE_SIZE = 40`, `hasMore`). Exposes `hasSave`, `saveName`, `saveSize`, `voted`; never `ip_hash` or save content. |
| `POST /stats/api/v1/reports` | `{ type, title (3–160), details (10–3000), save?, saveName? }`; `share` requires `save` (stored as `reports.type = 'feature'` + `report_saves.is_share = 1`). |
| `GET /stats/api/v1/reports/:id/save` | Reassembles `report_save_chunks` as `attachment` (`filename*=UTF-8''...`, `nosniff`). |
| `POST /stats/api/v1/reports/:id/vote` | Idempotent per `(report_id, ip_hash)` even after daily cap; triggers maintain `reports.votes`. |

**D1 tables (`stats/schema.sql`)**:
- **Stats**: `clients`, `stations` (PK `(client_id, station_name)`),
  `passenger_deltas`, `submit_ips`, `blocked_ips`, `submit_leases`,
  `rate_limits`, `global_counters` (+ insert triggers `stations_insert_counter`,
  `passenger_delta_insert_counter`).
- **Board**: `reports`, `report_saves`, `report_save_names`,
  `report_save_chunks`, `report_votes` (+ triggers `report_vote_insert`,
  `report_vote_delete`, `ON DELETE CASCADE`).

## Engineering Contracts

- **Prod vs `dev` isolation**: Top-level `wrangler.jsonc` targets remote
  `metro-stats` (`ENVIRONMENT=production`). `env.dev` targets `metro-stats-dev`
  (`ENVIRONMENT=development`, `routes: []`, separate local D1 id, throwaway
  `IP_HASH_SECRET`, state in `stats/.wrangler/state`, Workerd temp in
  `stats/.wrangler/runtime-tmp` to avoid Windows `%TEMP%` permission failures).
- **Idempotent schema rule**: Previews and manual deploys re-run all of
  `stats/schema.sql`. D1 lacks `ADD COLUMN IF NOT EXISTS`, so never alter
  existing tables with `ADD COLUMN` — add sidecar tables (`submit_ips`,
  `report_saves`, `report_save_names`, `report_save_chunks`) instead.
- **Worker & browser-script rules**: Keep numeric constants in `stats/limits.js`
  (plain numeric named exports on `worker.js` break Workers startup). Keep
  `REPORT_CLIENT` in `stats/report-page.js` as a `String.raw` literal so
  Wrangler instrumentation does not inject Worker-only helpers into browser JS.
- **Bilingual UI & filtering**: Copy lives in `PAGE_COPY` (`stats/page.js`).
  Keep privacy/label copy and the `32 * 1024 * 1024` check in `report-page.js`
  aligned with `limits.js`. Post-language filtering runs client-side (Han
  script vs >=2 `[A-Za-z]{2,}` words) over loaded pages while Load more advances
  by unfiltered offsets.
- **Origin gate & bounded reads**: `submitAllowed` allows
  `https://stationdesigner.com`, `localhost`/`127.0.0.1`, or omitted `Origin`
  with `Sec-Fetch-Site: same-origin` (else `403` before body/DB work).
  `readPayload` checks `Content-Length` plus a UTF-8 byte-counted stream cap
  (`MAX_BODY = 8 KiB` for stats, `REPORT_MAX_BODY = 64 MiB` for reports; `413`).
- **IP hashing, bans, leases & quotas**:
  - `clientIpHash` stores `HMAC-SHA256(CF-Connecting-IP, IP_HASH_SECRET)` only.
    Missing secret/IP degrades stats writes (`NULL` hash + shared `unattributed`
    bucket) but refuses report/vote writes with `503`.
  - `blocked_ips` refuses with `403` before writes and **fails open** on SQL
    error (logged) so a schema missing `blocked_ips` cannot 500 writers.
  - Lease minting caps at `LEASE_RATE_LIMIT = 60` per `LEASE_RATE_WINDOW_S = 60`
    s (`rate_limits`, fails closed → `500`, `429` + `Retry-After`); consumption
    atomically deletes `submit_leases` (`401` on replay/expiry/mismatch).
  - Board quotas (`REPORTS_PER_DAY = 5`, `REPORT_VOTES_PER_DAY = 100` per UTC
    day) are enforced inside SQL `INSERT ... SELECT ... WHERE` (`429` +
    `Retry-After` to UTC midnight).
  - Save uploads validate the `metro-save` envelope (`format`, integer
    `formatVersion`, `static.{cells,modules,lines}` arrays), UTF-8 cap
    `REPORT_SAVE_MAX_BYTES = 32 MiB`, and safe `saveName`, then split on UTF-8
    boundaries into `<= 1,500,000`-byte rows in `report_save_chunks` in one
    `db.batch` (below D1's 2 MB row limit).

## Game Client Integration

Spanning [`game/src/app/globalStats.ts`](../../../game/src/app/globalStats.ts)
(collector), [`game/src/sim/globalStats.ts`](../../../game/src/sim/globalStats.ts)
(pure delta/count math), [`game/src/app/statsSettings.ts`](../../../game/src/app/statsSettings.ts)
(storage keys), and [`game/test/global-stats.test.mjs`](../../../game/test/global-stats.test.mjs):

- **API resolution (`resolveStatsApiUrl`)**: `VITE_STATS_API_URL` → dev
  `http://127.0.0.1:5176/stats/api` → prod apex `stationdesigner.com`
  (`/stats/api`) → `null` elsewhere (matches Worker CORS).
- **Cadence & queue**: Default-on opt-out (`metro-game.share-stats.v1`),
  anonymous UUID (`metro-game.stats-client-id.v1`), persisted queue
  (`metro-game.stats-queue.v1`, max 20) keeping `submitId`. Posts every
  `300_000 ms` (5 min) in prod or `5_000 ms` (+ initial submit) in dev; skips
  unbuilt stations and resets baseline on `stationEpoch` switch/backwards tick.
- **Leases & retries**: Leases stay memory-only (`STATS_LEASE_MARGIN_MS = 30_000 ms`),
  refreshed between ticks so `pagehide` can `sendBeacon` `{ ...submission, lease }`.
  Retries once on `401` with a fresh lease, drops permanent 4xx (except
  `401/403/408/429`), and honors `Retry-After` + exponential backoff (up to
  5 min) on `403/408/429/5xx`.

## Related Skills

- [`metro-repo`](../metro-repo/SKILL.md) — Top-level layout, root commands, and Cloudflare deploys.
- [`metro-game`](../metro-game/SKILL.md) — Game app shell, `StatsSlice`, and `metro-save` format.
- [`metro-web`](../metro-web/SKILL.md) — Main `stationdesigner.com` Worker and shared brand assets.
