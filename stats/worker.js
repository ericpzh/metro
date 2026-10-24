/**
 * Station Designer — global stats Worker.
 *
 * One Worker owns the whole stats surface:
 *
 *   https://stationdesigner.com/stats/                 the public totals page
 *   https://stationdesigner.com/stats/en/              the English totals page
 *   https://stationdesigner.com/stats/api/v1/global    read the totals
 *   https://stationdesigner.com/stats/api/v1/lease     mint one single-use write lease
 *   https://stationdesigner.com/stats/api/v1/submit    record one anonymous delta
 *   https://stationdesigner.com/stats/api/v1/health    deployment/schema check
 *
 * The page is rendered from page.js, which ships in the same Worker: there is
 * no build step, so the page, the API and the schema version ship together.
 * Local development runs the same Worker against a **local D1** through
 * `stats/wrangler.jsonc`'s `dev` environment; production runs it against the
 * `metro-stats` database on `stationdesigner.com/stats/*`.
 *
 * Requires a D1 binding named STATS_DB. Without it every endpoint returns 503.
 *
 * Only the write paths are gated. `submit` accepts a POST from our own origin
 * (or a same-origin fetch that omits `Origin`), and refuses everything else
 * with 403. It also needs a lease minted by `/v1/lease`: the Worker stores only
 * the lease's SHA-256, and a submit deletes that row before writing, so a token
 * works once and a replayed payload fails. The page and the reads stay public.
 * See `submitAllowed`, `consumeLease` and `takeRateLimit` below.
 *
 * Abuse handling: on submit the Worker stores `HMAC-SHA256(CF-Connecting-IP,
 * IP_HASH_SECRET)` in `submit_ips` so bad rows can be traced and a repeat
 * offender blocked via `blocked_ips`. The raw address is never stored, and the
 * hash is not reversible without the secret. With no secret configured the hash
 * is NULL and no ban can be enforced (health reports this). Lease issuance is
 * rate-limited per address, so accepting a submit costs a minted lease.
 *
 * Collected totals:
 *   - stations            distinct (client_id, station_name)
 *   - passengers_boarded  已上车
 *   - passengers_alighted 已下车
 *   - passengers_exited   已出站
 *   - passengers_left_behind  滞留
 *   - sim_seconds         total SIM time
 *   - train_arrivals      total trains that reached a platform berth
 */
import { renderPage } from './page.js'
import {
  LEASE_RATE_LIMIT,
  LEASE_RATE_WINDOW_S,
  LEASE_TOKEN_HEX,
  LEASE_TTL_MS,
  MAX_BODY,
} from './limits.js'

const STATS_PREFIX = '/stats'
const ALLOWED_ORIGINS = new Set(['https://stationdesigner.com'])
const LOCAL_ORIGIN = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/
// Cloudflare sets this on every request that reaches the Worker; it is the real
// client address, unlike `X-Forwarded-For`, which a caller can pad or forge.
const IP_HEADER = 'CF-Connecting-IP'

function environmentOf(env) {
  return typeof env?.ENVIRONMENT === 'string' && env.ENVIRONMENT
    ? env.ENVIRONMENT
    : 'production'
}

function ipHashSecret(env) {
  return typeof env?.IP_HASH_SECRET === 'string' ? env.IP_HASH_SECRET : ''
}

const textEncoder = new TextEncoder()

function toHex(bytes) {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

/**
 * Pseudonymous abuse key: HMAC-SHA256 of the connection address under a Worker
 * secret, hex-encoded. A plain hash would be pointless — the IPv4 space is small
 * enough to enumerate — so the secret is what makes the column non-reversible.
 * Returns null when the secret is unset or the header is absent, in which case
 * no hash is recorded and no ban can match.
 */
async function clientIpHash(request, env) {
  const secret = ipHashSecret(env)
  const ip = (request.headers.get(IP_HEADER) || '').trim()
  if (!secret || !ip) return null
  const key = await crypto.subtle.importKey(
    'raw', textEncoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, textEncoder.encode(ip)))
  return toHex(mac)
}

/** The only copy of a lease that reaches storage: SHA-256 of the token. */
async function tokenHash(token) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', textEncoder.encode(token)))
  return toHex(digest)
}

/** 32 random bytes, hex-encoded. Never logged and never stored in the clear. */
function mintToken() {
  const bytes = new Uint8Array(LEASE_TOKEN_HEX / 2)
  crypto.getRandomValues(bytes)
  return toHex(bytes)
}

function isLeaseToken(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

/**
 * A single-use capability: delete the row and report whether this call removed
 * it. SQLite serialises the delete, so two concurrent submits carrying the same
 * token cannot both succeed — one gets `changes: 0` and a 401.
 */
async function consumeLease(db, clientId, token) {
  const hash = await tokenHash(token)
  try {
    const result = await db.prepare(
      `DELETE FROM submit_leases
        WHERE token_hash = ? AND client_id = ? AND expires_at > ?`
    ).bind(hash, clientId, now()).run()
    return Number(result?.meta?.changes ?? 0) === 1
  } catch (error) {
    console.error('stats lease check failed', error)
    return false
  }
}

/** The lease travels in the JSON body so a `sendBeacon` pagehide can carry it. */
function leaseOf(request, body) {
  const fromBody = typeof body?.lease === 'string' ? body.lease.trim() : ''
  if (fromBody) return fromBody
  return (request.headers.get('X-Stats-Lease') || '').trim()
}

/**
 * Fixed-window counter. Returns `{ ok, retryAfter }`; fails closed on a store
 * error: an unavailable limiter must never grant unlimited leases. The key includes the address hash; unidentifiable callers share a
 * fallback bucket so rotating client ids cannot evade the limit.
 */
async function takeRateLimit(db, key, limit, windowSeconds) {
  const windowMs = windowSeconds * 1000
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs
  const bucket = `${key}:${windowStart}`
  const retryAfter = Math.max(1, Math.ceil((windowStart + windowMs - Date.now()) / 1000))
  try {
    const [, read] = await db.batch([
      db.prepare(
        `INSERT INTO rate_limits (bucket, count, updated_at) VALUES (?, 1, ?)
         ON CONFLICT(bucket) DO UPDATE SET count = count + 1, updated_at = excluded.updated_at`
      ).bind(bucket, now()),
      db.prepare(`SELECT count FROM rate_limits WHERE bucket = ?`).bind(bucket),
    ])
    const count = Number(read?.results?.[0]?.count)
    if (!Number.isFinite(count)) throw new Error('missing rate counter')
    return { ok: count <= limit, retryAfter }
  } catch (error) {
    console.error('stats rate limit failed', error)
    throw error
  }
}

/**
 * True when `ip_hash` is on the ban list (and not expired). Fails **open**: if the
 * lookup itself errors — a database whose schema predates `blocked_ips` — the
 * submit is allowed rather than 500-ing every writer. The failure is logged.
 */
async function isBlocked(db, ipHash) {
  if (!ipHash) return false
  try {
    const row = await db.prepare(
      `SELECT 1 AS blocked FROM blocked_ips
        WHERE ip_hash = ? AND (expires_at IS NULL OR expires_at > ?)`
    ).bind(ipHash, now()).first()
    return Boolean(row)
  } catch (error) {
    console.error('stats ban check skipped', error)
    return false
  }
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin')
  const allowed = origin && (ALLOWED_ORIGINS.has(origin) || LOCAL_ORIGIN.test(origin))
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Stats-Lease',
    'Access-Control-Expose-Headers': 'Retry-After',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
  if (allowed) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

/**
 * The write gate for `/v1/lease` and `/v1/submit`: only our own pages may POST.
 *
 * Browsers set `Origin` on a POST and a page cannot forge it, so a foreign site
 * and a bare script (which sends no `Origin` and no fetch metadata) are both
 * refused. When a browser omits `Origin` on a same-origin POST,
 * `Sec-Fetch-Site: same-origin` is the accepted fallback.
 *
 * This is defence in depth, not identity: a non-browser client can send either
 * header by hand. The controls that cost an attacker something are the
 * single-use lease, the per-address mint limit and the ban list; Cloudflare
 * Access is not usable here because the only writer is an anonymous browser.
 * The page and the reads stay public.
 */
function submitAllowed(request) {
  const origin = request.headers.get('Origin')
  if (origin) return ALLOWED_ORIGINS.has(origin) || LOCAL_ORIGIN.test(origin)
  return request.headers.get('Sec-Fetch-Site') === 'same-origin'
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(init.headers || {}),
    },
  })
}

/**
 * Read and parse a write body without buffering an oversized one.
 *
 * `request.text()` pulls the whole body into Worker memory before the length is
 * known, so the declared `Content-Length` is refused first. A byte-counted stream reader
 * also bounds requests with missing or inaccurate lengths.
 */
async function readPayload(request, cors) {
  const declared = request.headers.get('Content-Length')
  if (declared !== null) {
    const bytes = Number(declared)
    if (!Number.isFinite(bytes) || bytes < 0 || bytes > MAX_BODY) {
      return { response: json({ ok: false, error: 'payload too large' }, { status: 413, headers: cors }) }
    }
  }
  const reader = request.body?.getReader()
  const chunks = []
  let size = 0
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > MAX_BODY) {
          await reader.cancel()
          return { response: json({ ok: false, error: 'payload too large' }, { status: 413, headers: cors }) }
        }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  const text = new TextDecoder().decode(bytes)
  try {
    const body = JSON.parse(text)
    if (!body || typeof body !== 'object') throw new Error('not an object')
    return { body }
  } catch {
    return { response: json({ ok: false, error: 'invalid json' }, { status: 400, headers: cors }) }
  }
}

/**
 * Split a request path into what the Worker serves.
 *
 * In production only `/stats` and `/stats/*` reach this Worker, but the
 * Worker's own workers.dev root also answers `/` and `/api/*`, which keeps the
 * deployment useful without the custom route. `/stats` and `/stats/en` are
 * redirected to their trailing-slash forms so both language documents resolve
 * at a stable root, matching the site's `/en/` pin.
 */
function splitRoute(pathname) {
  if (pathname === '/' || pathname === '/index.html') {
    return { kind: 'page', path: '/', lang: 'zh' }
  }
  if (pathname === STATS_PREFIX || pathname === STATS_PREFIX + '/index.html') {
    return { kind: 'redirect', path: STATS_PREFIX + '/' }
  }
  if (pathname === STATS_PREFIX + '/en' || pathname === STATS_PREFIX + '/en/index.html') {
    return { kind: 'redirect', path: STATS_PREFIX + '/en/' }
  }

  let p = pathname
  if (p.startsWith(STATS_PREFIX + '/')) {
    p = p.slice(STATS_PREFIX.length) || '/'
  } else if (!(p === '/api' || p.startsWith('/api/'))) {
    return { kind: 'missing', path: pathname }
  }

  if (p === '/api' || p === '/api/') return { kind: 'api', path: '/' }
  if (p.startsWith('/api/')) return { kind: 'api', path: p.slice('/api'.length) }
  if (p === '/en' || p === '/en/') return { kind: 'page', path: '/', lang: 'en' }
  return { kind: 'page', path: p, lang: 'zh' }
}

function now() { return new Date().toISOString() }

function isUuid(v) {
  return typeof v === 'string' && /^[0-9a-f][0-9a-f-]{7,63}$/i.test(v)
}
function clampInt(v, min, max) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  const n = Math.trunc(v)
  return n < min || n > max ? null : n
}
function clampReal(v, min, max) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return v < min || v > max ? null : v
}

function stationNameOf(station) {
  const name = typeof station?.name === 'string' ? station.name.trim() : ''
  if (name) return name.slice(0, 128)
  if (typeof station?.hash === 'string' && station.hash) return station.hash.slice(0, 128)
  return 'unnamed'
}

async function readGlobal(db) {
  const rows = await db.prepare(`SELECT key, value FROM global_counters`).all()
  const counters = Object.fromEntries((rows.results || []).map(row => [row.key, row.value]))
  const stationCount = await db.prepare(`SELECT COUNT(*) AS n FROM stations`).first()
  const updated = await db.prepare(
    `SELECT MAX(t) AS t FROM (
       SELECT MAX(created_at) AS t FROM passenger_deltas
       UNION ALL
       SELECT MAX(last_seen) AS t FROM stations
     )`
  ).first()
  return {
    stations: Number(stationCount?.n ?? counters.stations ?? 0),
    passengersBoarded: Number(counters.passengers_boarded || 0),
    passengersAlighted: Number(counters.passengers_alighted || 0),
    passengersExited: Number(counters.passengers_exited || 0),
    passengersLeftBehind: Number(counters.passengers_left_behind || 0),
    simSeconds: Number(counters.sim_seconds || 0),
    trainArrivals: Number(counters.train_arrivals || 0),
    updatedAt: updated?.t || null,
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const cors = corsHeaders(request)
    const environment = environmentOf(env)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    const { kind, path: route, lang } = splitRoute(url.pathname)

    if (kind === 'redirect') {
      return new Response(null, { status: 308, headers: { Location: route, ...cors } })
    }

    if (kind === 'page') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD', ...cors } })
      }
      if (route === '/') {
        return new Response(renderPage(environment, lang), {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            ...cors,
          },
        })
      }
      return new Response('Not found', { status: 404, headers: cors })
    }

    if (kind === 'missing') {
      return json({ ok: false, error: 'not found' }, { status: 404, headers: cors })
    }

    if (!env.STATS_DB) {
      return json(
        { ok: false, error: 'stats storage not configured', environment },
        { status: 503, headers: cors }
      )
    }

    const db = env.STATS_DB

    try {
      if (route === '/' || route === '') {
        if (request.method !== 'GET') {
          return json({ ok: false, error: 'method not allowed' }, { status: 405, headers: { Allow: 'GET', ...cors } })
        }
        return json({
          ok: true,
          environment,
          endpoints: {
            global: '/stats/api/v1/global',
            lease: '/stats/api/v1/lease',
            submit: '/stats/api/v1/submit',
            health: '/stats/api/v1/health',
          },
        }, { headers: cors })
      }

      if (route === '/v1/health') {
        if (request.method !== 'GET') {
          return json({ ok: false, error: 'method not allowed' }, { status: 405, headers: { Allow: 'GET', ...cors } })
        }
        const table = await db.prepare(
          `SELECT COUNT(*) AS n FROM sqlite_master
            WHERE type = 'table'
              AND name IN ('stations', 'submit_leases', 'rate_limits')`
        ).first()
        if (Number(table?.n ?? 0) < 3) {
          return json(
            { ok: false, environment, database: 'bound', schema: 'missing' },
            { status: 503, headers: cors }
          )
        }
        return json({
          ok: true,
          environment,
          database: 'bound',
          schema: 'ready',
          // A lease is required to write, and issuance is rate-limited. The
          // address hash is what both the ban list and the limiter key on.
          lease: 'required',
          rateLimit: 'enabled',
          // `unconfigured` means `IP_HASH_SECRET` is unset: submissions still
          // work, but no address hash is stored and no ban can be enforced.
          ipHash: ipHashSecret(env) ? 'enabled' : 'unconfigured',
          now: now(),
        }, { headers: cors })
      }

      if (route === '/v1/global') {
        if (request.method !== 'GET') {
          return json({ ok: false, error: 'method not allowed' }, { status: 405, headers: { Allow: 'GET', ...cors } })
        }
        const global = await readGlobal(db)
        return json(global, { headers: cors })
      }

      if (route === '/v1/lease') {
        if (request.method !== 'POST') {
          return json({ ok: false, error: 'method not allowed' }, { status: 405, headers: { Allow: 'POST', ...cors } })
        }
        if (!submitAllowed(request)) {
          return json({ ok: false, error: 'forbidden' }, { status: 403, headers: cors })
        }

        const payload = await readPayload(request, cors)
        if (payload.response) return payload.response
        const { clientId } = payload.body
        if (!isUuid(clientId)) {
          return json({ ok: false, error: 'clientId must be uuid-like' }, { status: 400, headers: cors })
        }

        const ipHash = await clientIpHash(request, env)
        if (await isBlocked(db, ipHash)) {
          return json({ ok: false, error: 'forbidden' }, { status: 403, headers: cors })
        }

        // Issuance is the write budget: every accepted submit needs one lease,
        // so limiting mints limits the write path. Key on the address when it
        // is available, otherwise on the client id.
        const limitKey = ipHash ? `ip:${ipHash}` : 'unattributed'
        const limit = await takeRateLimit(db, `lease:${limitKey}`, LEASE_RATE_LIMIT, LEASE_RATE_WINDOW_S)
        if (!limit.ok) {
          return json(
            { ok: false, error: 'rate limited' },
            { status: 429, headers: { 'Retry-After': String(limit.retryAfter), ...cors } }
          )
        }

        const token = mintToken()
        const hash = await tokenHash(token)
        const t = now()
        const expiresAt = new Date(Date.now() + LEASE_TTL_MS).toISOString()
        await db.batch([
          db.prepare(`DELETE FROM rate_limits WHERE updated_at < ?`).bind(new Date(Date.now() - 2 * LEASE_RATE_WINDOW_S * 1000).toISOString()),
          // Piggyback the sweep on the only path that creates rows, so an
          // unused or expired lease never accumulates.
          db.prepare(`DELETE FROM submit_leases WHERE expires_at < ?`).bind(t),
          db.prepare(
            `INSERT INTO submit_leases (token_hash, client_id, ip_hash, issued_at, expires_at)
             VALUES (?, ?, ?, ?, ?)`
          ).bind(hash, clientId, ipHash, t, expiresAt),
        ])

        // The raw token is returned once and never logged or stored.
        return json({ ok: true, token, expiresAt, environment }, { headers: cors })
      }

      if (route === '/v1/submit') {
        if (request.method !== 'POST') {
          return json({ ok: false, error: 'method not allowed' }, { status: 405, headers: { Allow: 'POST', ...cors } })
        }
        if (!submitAllowed(request)) {
          return json({ ok: false, error: 'forbidden' }, { status: 403, headers: cors })
        }

        const payload = await readPayload(request, cors)
        if (payload.response) return payload.response
        const body = payload.body

        const { clientId, submitId, sessionId, station, delta } = body
        if (!isUuid(clientId) || !isUuid(submitId)) {
          return json({ ok: false, error: 'clientId/submitId must be uuid-like' }, { status: 400, headers: cors })
        }

        const name = stationNameOf(station)
        const cells = clampInt(station?.cells ?? 0, 0, 10_000_000)
        const modules = clampInt(station?.modules ?? 0, 0, 10_000_000)
        const lines = clampInt(station?.lines ?? 0, 0, 10_000)
        const platforms = clampInt(station?.platforms ?? 0, 0, 10_000)
        const tracks = clampInt(station?.tracks ?? 0, 0, 10_000)
        if (cells === null || modules === null || lines === null || platforms === null || tracks === null) {
          return json({ ok: false, error: 'invalid station counts' }, { status: 400, headers: cors })
        }

        const d = delta || {}
        const boarded = clampInt(d.boarded ?? 0, 0, 1_000_000_000)
        const alighted = clampInt(d.alighted ?? 0, 0, 1_000_000_000)
        const exited = clampInt(d.exited ?? 0, 0, 1_000_000_000)
        const leftBehind = clampInt(d.leftBehind ?? 0, 0, 1_000_000_000)
        const trainArrivals = clampInt(d.trainArrivals ?? 0, 0, 1_000_000_000)
        const simSeconds = clampReal(d.simSeconds ?? 0, 0, 1e9)
        if (boarded === null || alighted === null || exited === null || leftBehind === null
            || trainArrivals === null || simSeconds === null) {
          return json({ ok: false, error: 'invalid passenger delta' }, { status: 400, headers: cors })
        }

        // The abuse key is derived here, never sent by the client, and checked
        // against the ban list before any row is written.
        const ipHash = await clientIpHash(request, env)
        if (await isBlocked(db, ipHash)) {
          return json({ ok: false, error: 'forbidden' }, { status: 403, headers: cors })
        }

        // Single-use capability. It is consumed before the duplicate check so
        // every accepted request costs one mint, and a captured payload cannot
        // use a repeated response as a free oracle.
        const leaseToken = leaseOf(request, body)
        if (!isLeaseToken(leaseToken)) {
          return json({ ok: false, error: 'lease required' }, { status: 401, headers: cors })
        }
        if (!(await consumeLease(db, clientId, leaseToken))) {
          return json({ ok: false, error: 'lease expired or already used' }, { status: 401, headers: cors })
        }

        // A retried payload keeps its submit id. The delta insert ignores a
        // duplicate, but the station row must not count the retry either, so
        // a known submit id returns the totals without writing anything.
        const duplicate = await db.prepare(
          `SELECT 1 AS seen FROM passenger_deltas WHERE client_id = ? AND submit_id = ?`
        ).bind(clientId, submitId).first()
        if (duplicate) {
          return json(
            { ok: true, submitId, duplicate: true, environment, global: await readGlobal(db) },
            { headers: cors }
          )
        }

        const t = now()
        const sid = isUuid(sessionId) ? sessionId : crypto.randomUUID()

        // One batched transaction. The delta insert comes **before** the station
        // upsert so the station's submission count can be derived from the
        // accepted deltas rather than incremented; a retry therefore changes
        // nothing, and `global_counters.stations` still fires only once.
        await db.batch([
          db.prepare(
            `INSERT INTO clients (client_id, first_seen, last_seen)
             SELECT ?, ?, ? WHERE NOT EXISTS (
               SELECT 1 FROM passenger_deltas WHERE client_id = ? AND submit_id = ?)
             ON CONFLICT(client_id) DO UPDATE SET last_seen = excluded.last_seen`
          ).bind(clientId, t, t, clientId, submitId),
          db.prepare(
            `INSERT OR IGNORE INTO passenger_deltas
               (client_id, session_id, submit_id, station_name, boarded, alighted, exited,
                left_behind, sim_seconds, train_arrivals, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(clientId, sid, submitId, name, boarded, alighted, exited, leftBehind, simSeconds, trainArrivals, t),
          db.prepare(
            `INSERT INTO stations
               (client_id, station_name, cells, modules, lines, platforms, tracks, first_seen, last_seen, submissions)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?,
               (SELECT COUNT(*) FROM passenger_deltas WHERE client_id = ? AND station_name = ?)
             WHERE changes() = 1
             ON CONFLICT(client_id, station_name) DO UPDATE SET
               cells = excluded.cells,
               modules = excluded.modules,
               lines = excluded.lines,
               platforms = excluded.platforms,
               tracks = excluded.tracks,
               last_seen = excluded.last_seen,
               submissions = (SELECT COUNT(*) FROM passenger_deltas
                               WHERE client_id = excluded.client_id AND station_name = excluded.station_name)`
          ).bind(clientId, name, cells, modules, lines, platforms, tracks, t, t, clientId, name),
          db.prepare(
            `INSERT OR IGNORE INTO submit_ips (client_id, submit_id, ip_hash, created_at)
             VALUES (?, ?, ?, ?)`
          ).bind(clientId, submitId, ipHash, t),
        ])

        const global = await readGlobal(db)
        return json({ ok: true, submitId, environment, global }, { headers: cors })
      }

      return json({ ok: false, error: 'not found' }, { status: 404, headers: cors })
    } catch (error) {
      console.error('stats worker error', error)
      return json({ ok: false, error: 'internal error' }, { status: 500, headers: cors })
    }
  },
}
