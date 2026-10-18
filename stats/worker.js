/**
 * Station Designer — global stats Worker.
 *
 * One Worker owns the whole stats surface:
 *
 *   https://stationdesigner.com/stats/                 the public totals page
 *   https://stationdesigner.com/stats/en/              the English totals page
 *   https://stationdesigner.com/stats/api/v1/global    read the totals
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
 * Only `/v1/submit` is gated: it accepts a POST from our own origin (or a
 * same-origin fetch that omits `Origin`), and refuses everything else with 403.
 * The page and the reads stay public. See `submitAllowed` below.
 *
 * Abuse handling: on submit the Worker stores `HMAC-SHA256(CF-Connecting-IP,
 * IP_HASH_SECRET)` in `submit_ips` so bad rows can be traced and a repeat
 * offender blocked via `blocked_ips`. The raw address is never stored, and the
 * hash is not reversible without the secret. With no secret configured the hash
 * is NULL and no ban can be enforced (health reports this).
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

const MAX_BODY = 8 * 1024
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
  let hex = ''
  for (const byte of mac) hex += byte.toString(16).padStart(2, '0')
  return hex
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
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
  if (allowed) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

/**
 * The write gate for `/v1/submit`: only our own pages may POST a delta.
 *
 * Browsers set `Origin` on a POST and a page cannot forge it, so a foreign site
 * and a bare script (which sends no `Origin` and no fetch metadata) are both
 * refused. When a browser omits `Origin` on a same-origin POST,
 * `Sec-Fetch-Site: same-origin` is the accepted fallback.
 *
 * This is defence in depth, not identity: a non-browser client can send either
 * header by hand. It blocks the casual caller; the authoritative block is a
 * Cloudflare Access policy on the write path. The page and the reads stay public.
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
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'stations'`
        ).first()
        if (!table) {
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

      if (route === '/v1/submit') {
        if (request.method !== 'POST') {
          return json({ ok: false, error: 'method not allowed' }, { status: 405, headers: { Allow: 'POST', ...cors } })
        }
        if (!submitAllowed(request)) {
          return json({ ok: false, error: 'forbidden' }, { status: 403, headers: cors })
        }

        const text = await request.text()
        if (text.length > MAX_BODY) {
          return json({ ok: false, error: 'payload too large' }, { status: 413, headers: cors })
        }
        let body
        try {
          body = JSON.parse(text)
        } catch {
          return json({ ok: false, error: 'invalid json' }, { status: 400, headers: cors })
        }
        if (!body || typeof body !== 'object') {
          return json({ ok: false, error: 'invalid json' }, { status: 400, headers: cors })
        }

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

        const t = now()
        const sid = isUuid(sessionId) ? sessionId : crypto.randomUUID()

        // The abuse key is derived here, never sent by the client, and checked
        // against the ban list before any row is written.
        const ipHash = await clientIpHash(request, env)
        if (await isBlocked(db, ipHash)) {
          return json({ ok: false, error: 'forbidden' }, { status: 403, headers: cors })
        }

        // One batched transaction. The station upsert only fires the insert
        // trigger the first time a (client, station) pair is seen, and the
        // delta insert is idempotent on (client_id, submit_id), so a retry
        // cannot double-count either a station or its passengers. The
        // submit_ips row is idempotent on the same key.
        await db.batch([
          db.prepare(
            `INSERT INTO clients (client_id, first_seen, last_seen)
             VALUES (?, ?, ?)
             ON CONFLICT(client_id) DO UPDATE SET last_seen = excluded.last_seen`
          ).bind(clientId, t, t),
          db.prepare(
            `INSERT INTO stations
               (client_id, station_name, cells, modules, lines, platforms, tracks, first_seen, last_seen, submissions)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
             ON CONFLICT(client_id, station_name) DO UPDATE SET
               cells = excluded.cells,
               modules = excluded.modules,
               lines = excluded.lines,
               platforms = excluded.platforms,
               tracks = excluded.tracks,
               last_seen = excluded.last_seen,
               submissions = submissions + 1`
          ).bind(clientId, name, cells, modules, lines, platforms, tracks, t, t),
          db.prepare(
            `INSERT OR IGNORE INTO passenger_deltas
               (client_id, session_id, submit_id, station_name, boarded, alighted, exited,
                left_behind, sim_seconds, train_arrivals, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(clientId, sid, submitId, name, boarded, alighted, exited, leftBehind, simSeconds, trainArrivals, t),
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
