# Global stats

Anonymous, aggregate-only totals from Station Designer: how many stations have
been built and how many passengers have been served worldwide.

The public numbers stay anonymous. The only thing retained about a submitter is a
**keyed, irreversible hash of the connection address** (`HMAC-SHA256(ip,
IP_HASH_SECRET)`) — never the raw IP — and it exists solely so a bad submission
can be traced and cleaned up, or a repeat offender blocked. It is not exposed by
any read endpoint. See [Abuse handling](#abuse-handling).

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

The game is the writer: a stable anonymous client id and a default-on
**分享匿名统计** opt-out in its gear menu, a five-minute production submission
(five seconds on localhost) plus a `pagehide` beacon, and a persisted retry
queue that keeps its `submitId`. See `game/src/app/globalStats.ts` and
`game/test/global-stats.test.mjs`.

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

## Bug reports and feature requests

The public feedback list lives at `/stats/report` (Chinese) and
`/stats/en/report` (English). Both use the stats shell and its `PAGE_COPY`
catalogue. The totals page links to it, including on mobile. The post-language filter is
client-side: it inspects title and details for Han characters and at least two
Latin words. Bilingual posts appear in both language filters; text with neither
signal appears only in all languages. Detection is approximate (Han also occurs
in other languages). Filtering applies to loaded pages; Load more remains available
when a page has no matches, and no language metadata is stored.

Reports persist in `reports`, votes in `report_votes`, and public save attachments in `report_saves` / `report_save_names` / `report_save_chunks`, in the same D1 database.
The idempotent `schema.sql` creates them; `npm run deploy:stats` applies the schema
before deploying. A CI deploy alone does not migrate these tables. No R2 binding
is needed. Local preview uses the separate dev D1 as usual.

* `GET /stats/api/v1/reports?sort=top&type=all&offset=0` returns up to 40 issues
  and `hasMore`. `sort=new` orders by report time; `top` orders by upvotes, then
  newest report time. Type may be `all`, `bug`, `feature`, or `share`.
* `POST /stats/api/v1/reports` accepts `{type, title, details, save?, saveName?}`. The optional
  save is a JSON string containing a `metro-save` envelope, up to 32 MiB; `share`
  requires one. `saveName` preserves the original download filename; the server records the UTF-8 byte size alongside it. Titles must be 3–160 characters and details 10–3,000 characters.
  Request bodies are limited to 64 MiB. Uploads are public and should not contain
  personal information. Basic envelope validation does not guarantee the game can
  load a save. D1 stores each save in bounded chunks in the same transaction as
  the report, avoiding its 2 MB row limit.
* `GET /stats/api/v1/reports/:id/save` downloads the public JSON attachment.
  List responses expose `hasSave`, `saveName`, and `saveSize` rather than embedding the file.
* `POST /stats/api/v1/reports/:id/vote` casts one upvote. Repeats are idempotent.

Anyone can read the list and post without an account. Writes use the existing
origin gate and ban list. Each address can create 5 reports and vote on 100 issues
per UTC day, with one lifetime vote per issue. Limits are enforced inside SQL
inserts, and vote counts are maintained by triggers to handle concurrent writes.
Only the existing HMAC of `CF-Connecting-IP` is stored; address hashes are excluded
from all public responses. Missing IP or `IP_HASH_SECRET` refuses writes with 503.
Limits are in `limits.js`; keep the bilingual privacy copy aligned when changing them.
`stats/test/reports.test.mjs` pins the UTC reset boundary for both limits, including
Retry-After, and exercises database concurrency with real SQLite. Run
`npm run check:stats:reports` to launch an isolated local Worker/D1 and check the
actual page in Chrome/Edge: create, text escaping, upvote persistence, both locales
and mobile/desktop widths. It uses a temporary database and removes it afterward;
it never clears the normal `dev:stats` data.

To remove abusive feedback, delete the corresponding `reports` row through the
existing D1 admin command (below). Vote and save rows cascade on deletion. To remove an
abusive vote, delete its `report_votes` row; triggers update the public count.

## Local preview

```powershell
npm install            # root deps, including wrangler
npm run dev:stats      # http://localhost:5176/
npm run dev:game       # http://localhost:5174/ (in another terminal, or npm start)
```

The local database is **empty by default** and is filled by the real game at
`localhost:5174`: opening the game submits the current built station once, then
the dev collector submits every five seconds, so building a station or running
the sim makes the numbers appear on `localhost:5176` without waiting for the
production five-minute interval. Both addresses serve the same page (`/` and
`/stats/`).

```powershell
npm run dev:stats -- --seed           # add the sample rows for a UI pass
npm run dev:stats -- --reset          # clear the local D1 first
npm run dev:stats -- --port 5179      # another port
npm run preview:stats                 # alias for dev:stats
```

The first run applies [`schema.sql`](schema.sql) to the persistent local D1 under
`stats/.wrangler/state`. `--seed` additionally applies [`seed.sql`](seed.sql) and
is idempotent, so restarting does not duplicate rows; without it the sample rows
are never inserted.

`npm start` / `npm run dev:all` start the site, game, model viewer and stats
together, so the game → stats path is live on one command.

The local state lives in `stats/.wrangler/state` and is ignored by git. Use
`--reset` or delete that directory for a clean database. Workerd's per-run temp
files are kept in `stats/.wrangler/tmp/miniflare` because some Windows profiles
deny writes to the OS temp directory even when the repository is writable.

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

`IP_HASH_SECRET` is not applied by the script — set it once with
`npx wrangler secret put IP_HASH_SECRET --config stats/wrangler.jsonc --env=`
(see [Abuse handling](#abuse-handling)). The deploy prints the health
`ipHash` state so an unset secret is visible rather than silent.

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

A small index: `{ ok, environment, endpoints: { global, lease, submit, health } }`.

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
  "lease": "64 hex characters from /v1/lease",
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

Each accepted submit also records `HMAC-SHA256(CF-Connecting-IP, IP_HASH_SECRET)`
in `submit_ips` for abuse handling. The address itself is never stored, the client
never sends it, and the hash is not reversible without the secret. With no secret
configured the column is `NULL` and no ban can match.

The write endpoint is **origin-gated**: only `https://stationdesigner.com` (and
`localhost` / `127.0.0.1` for the dev flow) may POST. Any other `Origin`, and any
request that carries neither `Origin` nor `Sec-Fetch-Site: same-origin` — a bare
script or `curl` — is refused with `403 { "ok": false, "error": "forbidden" }`
before it touches the database. The page and the `GET` endpoints stay public, so
the totals page and the game keep working unchanged.

Origin headers are defence in depth and can be forged by scripts. Do not put
Cloudflare Access on anonymous writes: SSO blocks the game and browser service
tokens are public. Configure WAF/rate rules on both write paths. Turnstile with
server-side Siteverify is a further option, **not implemented** here.
Workers.dev and version preview URLs are disabled to prevent host bypasses.
The game automatically enables only the apex production host, matching CORS.

### `POST /stats/api/v1/lease`

Send `{ "clientId": "uuid" }`. The response is
`{ ok, token, expiresAt, environment }`. The token has 32 random bytes, expires
in six minutes and is bound to the client id. Only its SHA-256 enters D1; the
browser holds the raw token in memory. Send `lease` in the submit JSON or use
`X-Stats-Lease`. An atomic delete consumes it. Missing/expired/spent tokens
return 401. Mint a new token after a lost response and keep the same submitId.

Issuance is limited to 60 mints per address hash per fixed 60-second window.
Without a secret or connection address, all callers share a fallback bucket.
Limiter failures refuse issuance. 429 includes Retry-After seconds. Successful
issuance sweeps expired leases and rate buckets older than two windows.
The client preserves 403/408/429 and server failures, uses backoff and honors
Retry-After. Pagehide uses a standby lease; tokens never enter local storage.

Leases bound writes but do not prove a simulation ran. Rotating client ids/names
still inflates station totals, and absolute delta caps still permit fabricated
passenger/time values. Relational validation, Turnstile, client bans and historical
delta/IP retention remain follow-up work. Existing bad rows are not repaired.

### `GET /stats/api/v1/health`

```json
{ "ok": true, "environment": "production", "database": "bound", "schema": "ready", "ipHash": "enabled", "now": "..." }
```

`ipHash` is `"unconfigured"` when `IP_HASH_SECRET` is unset: submits still work,
but no address hash is stored and no ban can be enforced.

Returns `503` with `schema: "missing"` until `schema.sql` has been applied, and
`503` with `stats storage not configured` if the `STATS_DB` binding is absent.

## Storage

[`schema.sql`](schema.sql) creates eight tables:

| Table | Holds |
|---|---|
| `submit_leases` | token digest, client id, address hash and expiry |
| `rate_limits` | fixed-window issuance counters |
| `clients` | anonymous client id, first/last seen |
| `stations` | one row per `(client_id, station_name)` with the latest counts and submission count |
| `passenger_deltas` | one row per accepted `submit_id` |
| `submit_ips` | keyed address hash per accepted `submit_id`, for abuse handling only |
| `blocked_ips` | the ban list, keyed by address hash |
| `global_counters` | running totals maintained by triggers |

`submit_ips` is its own table rather than a column on `passenger_deltas` because
this file is re-applied by every deploy and preview, and D1 has no
`ADD COLUMN IF NOT EXISTS`; a new table keeps the file idempotent.

A known `(client_id, submit_id)` retry returns success without changing metadata.
The D1 batch conditionally upserts the client, inserts the delta with
`INSERT OR IGNORE`, then upserts the station only if that insert changed a row
(`changes() = 1`). This also gates concurrent retries; station submissions are
derived from accepted deltas. The IP insert is `INSERT OR IGNORE`.
Lease consumption is separate: a failed write requires a fresh lease on retry.
Station reads still use `COUNT(*)`; the legacy stations counter remains.
Bodies are checked against Content-Length first, then read with an 8 KiB
byte-counted stream bound even for missing or inaccurate lengths.

## Abuse handling

The secret is a Worker **secret**, not a var:

```powershell
npx wrangler secret put IP_HASH_SECRET --config stats/wrangler.jsonc --env=
```

Rotating it re-keys every future hash, so existing `submit_ips` and `blocked_ips`
rows stop matching new submissions — rotate only alongside a re-seed of the ban
list. The `dev` environment carries its own committed throwaway value in
`wrangler.jsonc` so local hashes are stable across restarts.

**Trace a bad submitter** (find every client behind one address; note that
addresses rotate, so `client_id` is usually the better key):

```powershell
npx wrangler d1 execute STATS_DB --remote --config stats/wrangler.jsonc --yes \
  --command "SELECT client_id, COUNT(*) n, MIN(created_at), MAX(created_at) FROM submit_ips WHERE ip_hash = '<hash>' GROUP BY client_id"
```

**Clean up** the rows a client left behind — the counters are trigger-maintained,
so delete the rows and then re-derive `global_counters`, or fix the values in
place:

```powershell
npx wrangler d1 execute STATS_DB --remote --config stats/wrangler.jsonc --yes \
  --command "DELETE FROM passenger_deltas WHERE client_id = '<client_id>'"
```

**Ban** an address (permanent; add `expires_at` for a timed block):

```powershell
npx wrangler d1 execute STATS_DB --remote --config stats/wrangler.jsonc --yes \
  --command "INSERT OR REPLACE INTO blocked_ips (ip_hash, reason, created_at) VALUES ('<hash>', 'spam', datetime('now'))"
```

A banned hash is refused with `403 { "ok": false, "error": "forbidden" }` before
any row is written. The ban check **fails open**: if `blocked_ips` is missing the
submit is allowed (and the error is logged), so a database whose schema predates
the table cannot 500 every writer.

This is the same layer as the origin gate: it stops the casual caller. The
stronger block is a Cloudflare WAF rule on `ip.src`, which acts before the Worker
runs and stores nothing — worth pairing, because an `ip_hash` ban is only as good
as the header it hashes. A shared NAT or CGNAT address will collide, so prefer
`client_id` scoping when you can.

## Tests

```powershell
npm run test:stats
```

The suite drives the real Worker entry with a fake D1 binding. It covers the
`/stats` → `/stats/` redirect, the page's development badge, health and schema
failure, missing-binding `503`s, totals mapping, the batched submit SQL,
idempotent submission, the address-hash derivation and its null/unconfigured
path, the ban list, validation limits, CORS and 4xx routing.

Development sample data is not a test fixture: it is only applied by
`npm run dev:stats -- --seed`, never by the deploy script or the default preview.
