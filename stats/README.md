# Global stats

Anonymous, aggregate-only totals from Station Designer: how many stations have
been built and how many passengers have been served worldwide.

The whole service is one Cloudflare Worker plus one D1 database. The Worker
serves the totals page **and** the JSON API; D1 is the only persistence.

The page is rendered from [`page.js`](page.js) and bundled into the same Worker.
It is a one-shot snapshot: it calls `/stats/api/v1/global` once on load and does
not poll or auto-refresh. Its footer repeats the site's documentation links and
links back to the main site at <https://stationdesigner.com/>. Its favicon is the
site's own 64 px icon embedded from [`favicon.js`](favicon.js), so both apps show
the same brand mark; regenerate it with `node tools/prepare-brand-icon.mjs` when
the approved icon changes. The top bar mark is the site's silhouette from
[`brand-mark.js`](brand-mark.js), re-coloured amber with a CSS mask.

| | Production | Development |
|---|---|---|
| Worker | `metro-stats` | `metro-stats-dev` (local only) |
| Config | top level of [`wrangler.jsonc`](wrangler.jsonc) | `env.dev` in the same file |
| Page | <https://stationdesigner.com/stats/> (Chinese) | <http://127.0.0.1:5176/stats/> |
| English page | <https://stationdesigner.com/stats/en/> | <http://127.0.0.1:5176/stats/en/> |
| API | `https://stationdesigner.com/stats/api/v1/*` | `http://127.0.0.1:5176/stats/api/v1/*` |
| Database | remote D1 `metro-stats` | local D1 under `stats/.wrangler/state` |
| Routes | `stationdesigner.com/stats` + `/stats/*` | none |
| `ENVIRONMENT` | `production` | `development` |
| Page badge | none | `开发预览 · 本地数据库` |

The page is bilingual and URL-pinned, following the same rule as the rest of
the site: Chinese is the default at `/stats/`, English is pinned to
`/stats/en/`, and the nav switch links between them. `/stats/en` redirects to
`/stats/en/` with a `308` so the document always resolves at its canonical
directory.

The preview always runs the `dev` environment: a different Worker name, no
routes, a **separate local D1 database id**, and `ENVIRONMENT=development`. It
cannot read or write the production database. Production deploys always run the
top-level environment.

## Local preview

```powershell
npm install            # root deps, including wrangler
npm run dev:stats      # http://127.0.0.1:5176/stats/
```

The first run applies [`schema.sql`](schema.sql) to the persistent local D1 and
then inserts the development sample rows from [`seed.sql`](seed.sql). Both are
idempotent, so restarting the preview does not duplicate anything.

```powershell
npm run dev:stats -- --empty          # skip the sample rows
npm run dev:stats -- --port 5179      # another port
npm run preview:stats                 # alias for dev:stats
```

`npm start` / `npm run dev:all` also start it on port 5176 alongside the site,
game and model viewer.

The local state lives in `stats/.wrangler/state` and is ignored by git. Delete
that directory for a clean database. Workerd's per-run temp files are kept in
`stats/.wrangler/tmp/miniflare` because some Windows profiles deny writes to the
OS temp directory even when the repository is writable.

## Deploy

```powershell
npx wrangler login     # once
npm run deploy:stats
```

[`scripts/deploy.mjs`](scripts/deploy.mjs):

1. checks `stats/worker.js` syntax;
2. applies `schema.sql` to the **remote** `metro-stats` database (`--remote`,
   idempotent);
3. deploys the top-level environment, attaching both routes;
4. polls the live `/stats/api/v1/health`, then checks the page redirect, the
   page and `/stats/api/v1/global`.

The deployed database id is `045c02d3-c8cf-4ed5-87d1-16d749eb1734` in
[`wrangler.jsonc`](wrangler.jsonc). If the database is ever recreated, replace
that id with the output of `wrangler d1 create metro-stats`.

### Automatic deploys (Workers Builds)

The Cloudflare Workers Builds project for `metro-stats` should use:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Root directory | `/` — the root `package.json` and `stats/wrangler.jsonc` are addressed from the repo root |
| Build command | `npm run build:stats` |
| Deploy command | `npm run deploy:stats:ci` |
| Version / preview command | `npm run version:stats` (or disable version previews) |

`deploy:stats:ci` only checks the Worker syntax and runs
`wrangler deploy`; it does **not** apply SQL. Use `npm run deploy:stats` for a
schema change (or give the build token `D1:Edit` and use the full command in CI).

Cloudflare's automatically created Workers Builds token has Workers Scripts, KV
and R2 permissions, but **no D1 permission**. That is why the full
`deploy:stats` command fails in CI at the `wrangler d1 execute --remote` step
before it ever deploys the Worker. Either keep the CI deploy command on
`deploy:stats:ci`, or edit the build token (or select a custom token) with
`D1:Edit` and switch to `npm run deploy:stats`.

`npm run version:stats` uploads a Worker version without promoting it; it is a
one-shot command. **Do not use `npm run dev:stats` as the version/preview
command** — that starts a long-running local server and will hang the build.

Pushes to `main` run the production trigger. Pushes to other branches only run
the preview/version command, so they do not change the live Worker. The build
trigger's watch paths must include `stats/**` (the default of all paths is
simplest); otherwise a push that only edits the stats Worker will not start a
build.

Both routes are required: `/stats/*` does not match the bare `/stats`. The site
Worker owns `stationdesigner.com/*`; the more specific stats routes win. Do not
collapse them to `/stats*`, because `*` spans `/` and would swallow unrelated
paths.

`npm run build:stats` only runs `node --check` — the Worker and its page have no
bundling or build step.

## Endpoints

All responses are JSON with `Cache-Control: no-store`, except the HTML page.
Requests are capped at 8 KiB.

### `GET /stats/api`

A small index: `{ ok, environment, endpoints: { global, submit, health } }`.

### `GET /stats/api/v1/global`

```json
{
  "stations": 3,
  "passengersBoarded": 256000,
  "passengersAlighted": 244900,
  "passengersExited": 205000,
  "passengersLeftBehind": 3320,
  "simSeconds": 167000,
  "trainArrivals": 2910,
  "updatedAt": "2026-10-17T10:18:00.000Z"
}
```

`updatedAt` is the latest passenger delta or station sighting, and is `null`
before the first submission.

### `POST /stats/api/v1/submit`

```json
{
  "clientId": "uuid",
  "submitId": "uuid",
  "sessionId": "uuid (optional)",
  "station": {
    "name": "动物园",
    "cells": 18450,
    "modules": 2460,
    "lines": 1,
    "platforms": 2,
    "tracks": 2
  },
  "delta": {
    "boarded": 7,
    "alighted": 6,
    "exited": 5,
    "leftBehind": 2,
    "simSeconds": 60.5,
    "trainArrivals": 1
  }
}
```

Responds `{ ok, submitId, environment, global }` where `global` has the same
shape as the totals endpoint. `station.name` is the station's identity together
with `clientId`; when it is empty, a station `hash` is used, then `"unnamed"`.
No layout is stored.

### `GET /stats/api/v1/health`

```json
{ "ok": true, "environment": "production", "database": "bound", "schema": "ready", "now": "..." }
```

Returns `503` with `schema: "missing"` until `schema.sql` has been applied, and
`503` with `stats storage not configured` if the `STATS_DB` binding is absent.

## Storage

[`schema.sql`](schema.sql) creates four tables:

| Table | Holds |
|---|---|
| `clients` | anonymous client id, first/last seen |
| `stations` | one row per `(client_id, station_name)` with the latest counts and submission count |
| `passenger_deltas` | one row per accepted `submit_id` |
| `global_counters` | running totals maintained by triggers |

Idempotency is enforced in two places:

* `passenger_deltas` has `UNIQUE (client_id, submit_id)`, and the Worker inserts
  with `INSERT OR IGNORE`, so retrying the same submission never double-counts
  passengers.
* `stations` is upserted on `(client_id, station_name)`. Its insert trigger only
  bumps the station total on the first sighting; later submissions update the
  counts and `submissions`.

The submit is one D1 batch (transaction): client upsert, station upsert,
passenger-delta insert. Triggers keep `global_counters` consistent under
concurrent writers.

## Tests

```powershell
npm run test:stats
```

The suite drives the real Worker entry with a fake D1 binding. It covers the
`/stats` → `/stats/` redirect, the page's development badge, health and schema
failure, missing-binding `503`s, totals mapping, the batched submit SQL,
idempotent submission, validation limits, CORS and 4xx routing.

Development sample data is not a test fixture: it is only applied by the local
preview, never by the deploy script.
