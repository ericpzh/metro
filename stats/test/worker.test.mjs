import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import worker from '../worker.js'
import { LEASE_RATE_LIMIT, LEASE_TTL_MS } from '../limits.js'
import { FAVICON } from '../favicon.js'
import { BRAND_MARK } from '../brand-mark.js'

const ORIGIN = 'https://stationdesigner.com'
const CLIENT = '11111111-1111-4111-8111-111111111111'
const OTHER_CLIENT = '33333333-3333-4333-8333-333333333333'
const SUBMIT = '22222222-2222-4222-8222-222222222222'
const SECRET = 'test-secret'

function ipHash(ip, secret = SECRET) {
  return createHmac('sha256', secret).update(ip).digest('hex')
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * A D1 stand-in: enough of `prepare().bind().all()/first()/run()` and `batch()`
 * to exercise routing, validation, the SQL shape, leases, the rate-limit
 * counter and the totals projection without a database. It records every
 * statement so a test can assert what was sent.
 *
 * `blocked` lists the `ip_hash` values the fake ban list contains. `duplicate`
 * makes the idempotency pre-check report an existing `(client_id, submit_id)`.
 * `schema` is the number of expected tables found (0 simulates an old database).
 */
function fakeDb({ counters = {}, stationCount = 0, latest = null, schema = true, blocked = [], duplicate = false } = {}) {
  const statements = []
  const leases = new Map()
  const rateCounts = new Map()
  const db = {
    statements,
    leases,
    rateCounts,
    batches: 0,
    prepare(sql) {
      const entry = { sql, args: [] }
      statements.push(entry)
      const statement = {
        __entry: entry,
        bind(...args) {
          entry.args = args
          return statement
        },
        async all() {
          if (/FROM global_counters/.test(sql)) {
            return { results: Object.entries(counters).map(([key, value]) => ({ key, value })) }
          }
          throw new Error(`unexpected all(): ${sql}`)
        },
        async first() {
          if (/sqlite_master/.test(sql)) return { n: schema ? 5 : 0 }
          if (/COUNT\(\*\) AS n FROM stations/.test(sql)) return { n: stationCount }
          if (/MAX\(t\) AS t/.test(sql)) return { t: latest }
          if (/FROM blocked_ips/.test(sql)) return blocked.includes(entry.args[0]) ? { blocked: 1 } : null
          if (/FROM passenger_deltas\s+WHERE client_id = \? AND submit_id = \?/.test(sql)) {
            return duplicate ? { seen: 1 } : null
          }
          throw new Error(`unexpected first(): ${sql}`)
        },
        async run() {
          if (/DELETE FROM submit_leases/.test(sql)) {
            const [hash, clientId, at] = entry.args
            const lease = leases.get(hash)
            if (!lease || lease.clientId !== clientId || lease.used || lease.expiresAt <= at) {
              return { success: true, meta: { changes: 0 } }
            }
            lease.used = true
            return { success: true, meta: { changes: 1 } }
          }
          return { success: true, meta: { changes: 1 } }
        },
      }
      return statement
    },
    async batch(batch) {
      db.batches += 1
      const results = []
      for (const statement of batch) {
        const { sql, args } = statement.__entry
        if (/INSERT INTO rate_limits/.test(sql)) {
          const next = (rateCounts.get(args[0]) ?? 0) + 1
          rateCounts.set(args[0], next)
          results.push({ success: true, meta: { changes: 1 } })
        } else if (/SELECT count FROM rate_limits/.test(sql)) {
          results.push({ success: true, results: [{ count: rateCounts.get(args[0]) ?? 0 }] })
        } else if (/INSERT INTO submit_leases/.test(sql)) {
          leases.set(args[0], { clientId: args[1], expiresAt: args[4], used: false })
          results.push({ success: true, meta: { changes: 1 } })
        } else {
          results.push({ success: true, meta: { changes: 1 } })
        }
      }
      return results
    },
  }
  return db
}

function request(path, init) {
  return new Request(`http://localhost${path}`, init)
}

function jsonPost(path, body) {
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: ORIGIN },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function leaseRequest(clientId = CLIENT) {
  return jsonPost('/stats/api/v1/lease', { clientId })
}

/** Mint a lease and return the raw token. */
async function mint(db, env = {}, clientId = CLIENT) {
  const response = await worker.fetch(leaseRequest(clientId), { STATS_DB: db, ...env })
  assert.equal(response.status, 200, 'the lease endpoint accepts our origin')
  const body = await response.json()
  assert.match(body.token, /^[0-9a-f]{64}$/)
  return body.token
}

/** Mint a lease, then submit `body` with it. */
async function leasedSubmit(db, body, env = {}) {
  const token = await mint(db, env, body.clientId)
  return worker.fetch(jsonPost('/stats/api/v1/submit', { ...body, lease: token }), { STATS_DB: db, ...env })
}

test('bare /stats redirects to /stats/', async () => {
  const response = await worker.fetch(request('/stats'), { STATS_DB: fakeDb() })
  assert.equal(response.status, 308)
  assert.equal(response.headers.get('location'), '/stats/')
})

test('bare /stats/en redirects to /stats/en/', async () => {
  const response = await worker.fetch(request('/stats/en'), { STATS_DB: fakeDb() })
  assert.equal(response.status, 308)
  assert.equal(response.headers.get('location'), '/stats/en/')
})

test('/stats/en/ serves the English page with its language switch', async () => {
  const response = await worker.fetch(request('/stats/en/'), {
    STATS_DB: fakeDb(),
    ENVIRONMENT: 'development',
  })
  assert.equal(response.status, 200)
  const html = await response.text()
  assert.match(html, /<html lang="en">/)
  assert.match(html, /<title>Global stats · Station Designer<\/title>/)
  assert.match(html, /<h1>Global stats<span class="accent">\.<\/span><\/h1>/)
  assert.match(html, /href="\/stats\/en\/" hreflang="en" lang="en" aria-current="page"/)
  assert.match(html, /<h2>Docs<\/h2>/)
  assert.match(html, /Game design <span>full spec<\/span>/)
  assert.match(html, /Main site <span>stationdesigner\.com<\/span>/)
  assert.match(html, /Development · local database/)
  assert.ok(html.includes('href="' + FAVICON + '"'), 'the page uses the site favicon')
  assert.doesNotMatch(html, /data:image\/svg\+xml/)
  assert.doesNotMatch(html, /setInterval/)
})

test('/stats/en/index.html also redirects to /stats/en/', async () => {
  const response = await worker.fetch(request('/stats/en/index.html'), { STATS_DB: fakeDb() })
  assert.equal(response.status, 308)
  assert.equal(response.headers.get('location'), '/stats/en/')
})

test('/stats/ serves the page with the dev environment and absolute API path', async () => {
  const response = await worker.fetch(request('/stats/'), {
    STATS_DB: fakeDb(),
    ENVIRONMENT: 'development',
  })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /text\/html/)
  const html = await response.text()
  assert.match(html, /<html lang="zh-CN">/)
  assert.match(html, /\/stats\/api\/v1\/global/)
  assert.match(html, /href="\/stats\/" hreflang="zh-CN" lang="zh-CN" aria-current="page"/)
  assert.match(html, /const environment = "development"/)
  assert.match(html, /开发预览 · 本地数据库/)
  assert.match(html, /\[hidden\] \{ display: none !important; \}/)
  assert.ok(html.includes('href="' + FAVICON + '"'), 'the page uses the site favicon')
  assert.ok(html.includes(BRAND_MARK), 'the top bar uses the site brand mark')
  assert.match(html, /class="brand__mark" aria-hidden="true"><\/span>/)
})

test('the page reads once per load and does not poll', async () => {
  const response = await worker.fetch(request('/stats/'), { STATS_DB: fakeDb() })
  const html = await response.text()
  assert.doesNotMatch(html, /setInterval/)
  assert.match(html, /load\(\);\s*<\/script>/)
  assert.match(html, /页面加载时读取一次/)
})

test('the footer carries the site documentation links and main site', async () => {
  const response = await worker.fetch(request('/stats/'), { STATS_DB: fakeDb() })
  const html = await response.text()
  assert.match(html, /<h2>文档<\/h2>/)
  assert.match(html, /游戏设计 <span>详细说明<\/span>/)
  assert.match(html, /概念图 <span>SVG 原图<\/span>/)
  assert.match(html, /代码仓库 <span>项目源码<\/span>/)
  assert.match(html, /主站 <span>stationdesigner\.com<\/span>/)
  assert.match(html, /href="https:\/\/stationdesigner\.com\/"/)
})

test('production page resolves the environment to production', async () => {
  const response = await worker.fetch(request('/stats/'), { STATS_DB: fakeDb() })
  const html = await response.text()
  assert.match(html, /const environment = "production"/)
})

test('the API root lists its endpoints', async () => {
  const response = await worker.fetch(request('/stats/api'), {
    STATS_DB: fakeDb(),
    ENVIRONMENT: 'development',
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.environment, 'development')
  assert.equal(body.endpoints.global, '/stats/api/v1/global')
  assert.equal(body.endpoints.lease, '/stats/api/v1/lease')
  assert.equal(body.endpoints.submit, '/stats/api/v1/submit')
})

test('health reports the bound, migrated database', async () => {
  const response = await worker.fetch(request('/stats/api/v1/health'), {
    STATS_DB: fakeDb(),
    ENVIRONMENT: 'development',
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.environment, 'development')
  assert.equal(body.database, 'bound')
  assert.equal(body.schema, 'ready')
  assert.equal(body.lease, 'required')
  assert.equal(body.rateLimit, 'enabled')
})

test('health fails loudly when the schema has not been applied', async () => {
  const response = await worker.fetch(request('/stats/api/v1/health'), {
    STATS_DB: fakeDb({ schema: false }),
  })
  assert.equal(response.status, 503)
  const body = await response.json()
  assert.equal(body.ok, false)
  assert.equal(body.schema, 'missing')
})

test('missing STATS_DB returns 503, not a stack trace', async () => {
  const response = await worker.fetch(request('/stats/api/v1/global'), {})
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error, 'stats storage not configured')
})

test('global maps counters, the live station count and the latest timestamp', async () => {
  const response = await worker.fetch(request('/stats/api/v1/global'), {
    STATS_DB: fakeDb({
      counters: {
        passengers_boarded: 120,
        passengers_alighted: 100,
        passengers_exited: 90,
        passengers_left_behind: 3,
        sim_seconds: 3600,
        train_arrivals: 8,
      },
      stationCount: 4,
      latest: '2026-10-17T10:00:00.000Z',
    }),
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    stations: 4,
    passengersBoarded: 120,
    passengersAlighted: 100,
    passengersExited: 90,
    passengersLeftBehind: 3,
    simSeconds: 3600,
    trainArrivals: 8,
    updatedAt: '2026-10-17T10:00:00.000Z',
  })
})

test('a lease is returned once and only its SHA-256 is stored', async () => {
  const db = fakeDb()
  const response = await worker.fetch(leaseRequest(), { STATS_DB: db, IP_HASH_SECRET: SECRET })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.match(body.token, /^[0-9a-f]{64}$/, '32 random bytes, hex')
  const ttl = Date.parse(body.expiresAt) - Date.now()
  assert.ok(ttl > 0 && ttl <= LEASE_TTL_MS, `expires in at most ${LEASE_TTL_MS} ms`)

  const insert = db.statements.find(statement => statement.sql.includes('INSERT INTO submit_leases'))
  assert.ok(insert, 'the lease is written')
  assert.equal(insert.args[0], tokenHash(body.token), 'the row holds SHA-256, not the token')
  assert.notEqual(insert.args[0], body.token)
  assert.equal(insert.args[1], CLIENT)
  assert.equal(insert.args[2], null, 'no address hash without the header')

  const stored = JSON.stringify([...db.leases.entries()])
  assert.equal(stored.includes(body.token), false, 'the raw token never reaches storage')
})

test('a lease is bound to its client and works exactly once', async () => {
  const db = fakeDb()
  const token = await mint(db)

  const first = await worker.fetch(jsonPost('/stats/api/v1/submit', {
    clientId: CLIENT,
    submitId: SUBMIT,
    station: { name: 'Test Junction' },
    delta: { boarded: 1 },
    lease: token,
  }), { STATS_DB: db })
  assert.equal(first.status, 200)

  const replay = await worker.fetch(jsonPost('/stats/api/v1/submit', {
    clientId: CLIENT,
    submitId: SUBMIT,
    station: { name: 'Test Junction' },
    delta: { boarded: 1 },
    lease: token,
  }), { STATS_DB: db })
  assert.equal(replay.status, 401)
  assert.equal((await replay.json()).error, 'lease expired or already used')

  const otherClient = await worker.fetch(jsonPost('/stats/api/v1/submit', {
    clientId: OTHER_CLIENT,
    submitId: SUBMIT,
    station: { name: 'Test Junction' },
    delta: { boarded: 1 },
    lease: await mint(db, {}, OTHER_CLIENT),
  }), { STATS_DB: db })
  assert.equal(otherClient.status, 200, 'a fresh lease for that client is fine')

  const stolen = await worker.fetch(jsonPost('/stats/api/v1/submit', {
    clientId: OTHER_CLIENT,
    submitId: '44444444-4444-4444-8444-444444444444',
    station: { name: 'Test Junction' },
    delta: { boarded: 1 },
    lease: await mint(db, {}, CLIENT),
  }), { STATS_DB: db })
  assert.equal(stolen.status, 401, "another client's lease is refused")
})

test('submit without a lease, or with an unknown or expired one, writes nothing', async () => {
  const db = fakeDb()
  const payload = {
    clientId: CLIENT,
    submitId: SUBMIT,
    station: { name: 'Test Junction' },
    delta: { boarded: 1 },
  }

  const missing = await worker.fetch(jsonPost('/stats/api/v1/submit', payload), { STATS_DB: db })
  assert.equal(missing.status, 401)
  assert.equal((await missing.json()).error, 'lease required')

  const unknown = await worker.fetch(jsonPost('/stats/api/v1/submit', {
    ...payload,
    lease: 'd'.repeat(64),
  }), { STATS_DB: db })
  assert.equal(unknown.status, 401)
  assert.equal(db.batches, 0, 'a refused lease never reaches a batch')

  const expired = 'e'.repeat(64)
  db.leases.set(tokenHash(expired), {
    clientId: CLIENT,
    expiresAt: new Date(Date.now() - 1000).toISOString(),
    used: false,
  })
  const stale = await worker.fetch(jsonPost('/stats/api/v1/submit', {
    ...payload,
    lease: expired,
  }), { STATS_DB: db })
  assert.equal(stale.status, 401)
  assert.equal(db.batches, 0)
})

test('lease issuance is rate-limited per address', async () => {
  const db = fakeDb()
  const env = { STATS_DB: db, IP_HASH_SECRET: SECRET }
  const post = () => worker.fetch(request('/stats/api/v1/lease', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Origin: ORIGIN,
      'CF-Connecting-IP': '203.0.113.7',
    },
    body: JSON.stringify({ clientId: CLIENT }),
  }), env)

  for (let index = 0; index < LEASE_RATE_LIMIT; index += 1) {
    assert.equal((await post()).status, 200, `mint ${index + 1} is allowed`)
  }
  const limited = await post()
  assert.equal(limited.status, 429)
  assert.equal((await limited.json()).error, 'rate limited')
  assert.match(limited.headers.get('retry-after'), /^[1-9][0-9]*$/)
})

test('a valid submit batches clients, the delta, the station and one submit_ips row', async () => {
  const db = fakeDb({ stationCount: 1 })
  const response = await leasedSubmit(db, {
    clientId: CLIENT,
    submitId: SUBMIT,
    station: { name: 'Test Junction', cells: 10, modules: 2, lines: 1, platforms: 2, tracks: 2 },
    delta: { boarded: 5, alighted: 4, exited: 3, leftBehind: 1, simSeconds: 120.5, trainArrivals: 2 },
  }, { ENVIRONMENT: 'development' })

  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.submitId, SUBMIT)
  assert.equal(body.environment, 'development')
  assert.equal(body.global.stations, 1)

  const sql = db.statements.map(statement => statement.sql).join('\n')
  assert.match(sql, /INSERT INTO clients/)
  assert.match(sql, /INSERT INTO stations/)
  assert.match(sql, /ON CONFLICT\(client_id, station_name\) DO UPDATE/)
  assert.match(sql, /INSERT OR IGNORE INTO passenger_deltas/)
  assert.match(sql, /INSERT OR IGNORE INTO submit_ips/)
  assert.equal(db.batches, 3, 'a lease rate-limit read, the lease write, then the submit')

  const delta = db.statements.find(statement => statement.sql.includes('INSERT OR IGNORE INTO passenger_deltas'))
  const station = db.statements.find(statement => statement.sql.includes('INSERT INTO stations'))
  assert.ok(delta && station)
  assert.ok(
    db.statements.indexOf(delta) < db.statements.indexOf(station),
    'the delta is written before the station derives its submission count',
  )
  assert.match(station.sql, /SELECT COUNT\(\*\) FROM passenger_deltas/)
  assert.doesNotMatch(station.sql, /submissions \+ 1/)
})

test('a retried submit is a no-op that returns the totals', async () => {
  const db = fakeDb({ duplicate: true })
  const response = await leasedSubmit(db, {
    clientId: CLIENT,
    submitId: SUBMIT,
    station: { name: 'Test Junction' },
    delta: { boarded: 1 },
  })

  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.duplicate, true)
  assert.equal(db.batches, 2, 'the rate-limit counter and the lease write, no submit')
  assert.equal(
    db.statements.some(statement => statement.sql.includes('INSERT OR IGNORE INTO passenger_deltas')),
    false,
    'the retry writes no delta',
  )
  assert.equal(
    db.statements.some(statement => statement.sql.includes('INSERT INTO stations')),
    false,
    'the retry does not bump the station row',
  )
})

test('a retried submit keeps the same submission idempotency key', async () => {
  const db = fakeDb()
  const payload = {
    clientId: CLIENT,
    submitId: SUBMIT,
    station: { name: 'Test Junction' },
    delta: { boarded: 1 },
  }
  await leasedSubmit(db, payload)
  const delta = db.statements.find(statement => statement.sql.includes('INSERT OR IGNORE INTO passenger_deltas'))
  assert.ok(delta)
  assert.equal(delta.args[2], SUBMIT)
  assert.match(delta.sql, /UNIQUE|IGNORE/)
})

test('submit stores a keyed hash of the connection address, never the raw IP', async () => {
  const db = fakeDb()
  const token = await mint(db, { IP_HASH_SECRET: SECRET })
  const response = await worker.fetch(request('/stats/api/v1/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': '203.0.113.7' },
    body: JSON.stringify({
      clientId: CLIENT, submitId: SUBMIT, station: { name: 'X' }, delta: { boarded: 1 }, lease: token,
    }),
  }), { STATS_DB: db, IP_HASH_SECRET: SECRET })

  assert.equal(response.status, 200)
  const row = db.statements.find(statement => statement.sql.includes('INSERT OR IGNORE INTO submit_ips'))
  assert.ok(row, 'the submit records the abuse key')
  assert.equal(row.args[0], CLIENT)
  assert.equal(row.args[1], SUBMIT)
  assert.equal(row.args[2], ipHash('203.0.113.7'), 'HMAC-SHA256 under the Worker secret')
  assert.match(row.args[2], /^[0-9a-f]{64}$/)
  assert.ok(!row.args[2].includes('203.0.113.7'), 'the address itself is never stored')
})

test('the same address hashes the same and a different one does not', async () => {
  async function hashOf(ip) {
    const db = fakeDb()
    const token = await mint(db, { IP_HASH_SECRET: SECRET })
    await worker.fetch(request('/stats/api/v1/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': ip },
      body: JSON.stringify({
        clientId: CLIENT, submitId: SUBMIT, station: { name: 'X' }, delta: { boarded: 1 }, lease: token,
      }),
    }), { STATS_DB: db, IP_HASH_SECRET: SECRET })
    return db.statements.find(statement => statement.sql.includes('INSERT OR IGNORE INTO submit_ips')).args[2]
  }
  assert.equal(await hashOf('198.51.100.4'), await hashOf('198.51.100.4'))
  assert.notEqual(await hashOf('198.51.100.4'), await hashOf('198.51.100.5'))
})

test('with no IP_HASH_SECRET the submit still succeeds and stores a null hash', async () => {
  const db = fakeDb()
  const token = await mint(db)
  const response = await worker.fetch(request('/stats/api/v1/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': '203.0.113.7' },
    body: JSON.stringify({
      clientId: CLIENT, submitId: SUBMIT, station: { name: 'X' }, delta: { boarded: 1 }, lease: token,
    }),
  }), { STATS_DB: db })

  assert.equal(response.status, 200)
  const row = db.statements.find(statement => statement.sql.includes('INSERT OR IGNORE INTO submit_ips'))
  assert.equal(row.args[2], null)
})

test('a banned address is refused before any lease is used or any row is written', async () => {
  const ip = '198.51.100.9'
  const db = fakeDb({ blocked: [ipHash(ip)] })
  const response = await worker.fetch(request('/stats/api/v1/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': ip },
    body: JSON.stringify({
      clientId: CLIENT, submitId: SUBMIT, station: { name: 'X' }, delta: { boarded: 1 }, lease: 'f'.repeat(64),
    }),
  }), { STATS_DB: db, IP_HASH_SECRET: SECRET })

  assert.equal(response.status, 403)
  assert.equal((await response.json()).error, 'forbidden')
  assert.equal(db.batches, 0, 'a banned submit never reaches the batch')
  assert.ok(db.statements.every(statement => statement.sql.includes('blocked_ips')))
})

test('an unlisted address is not blocked, and a lookup failure fails open', async () => {
  const payload = { clientId: CLIENT, submitId: SUBMIT, station: { name: 'X' }, delta: { boarded: 1 } }
  async function post(env) {
    const token = await mint(env.STATS_DB, env)
    return worker.fetch(request('/stats/api/v1/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': '203.0.113.7' },
      body: JSON.stringify({ ...payload, lease: token }),
    }), env)
  }

  const listed = await post({ STATS_DB: fakeDb({ blocked: [ipHash('198.51.100.9')] }), IP_HASH_SECRET: SECRET })
  assert.equal(listed.status, 200)

  // A database whose schema predates `blocked_ips` must not 500 every writer.
  const oldSchema = fakeDb()
  const basePrepare = oldSchema.prepare.bind(oldSchema)
  oldSchema.prepare = sql => {
    if (/blocked_ips/.test(sql)) {
      const statement = {
        bind() { return statement },
        async first() { throw new Error('no such table: blocked_ips') },
      }
      return statement
    }
    return basePrepare(sql)
  }
  const failOpen = await withSilencedErrors(() => post({ STATS_DB: oldSchema, IP_HASH_SECRET: SECRET }))
  assert.equal(failOpen.status, 200)
})

/** Run `fn` with `console.error` muted: the fail-open paths log by design. */
async function withSilencedErrors(fn) {
  const original = console.error
  console.error = () => {}
  try {
    return await fn()
  } finally {
    console.error = original
  }
}

test('health reports whether IP hashing is configured', async () => {
  const configured = await worker.fetch(request('/stats/api/v1/health'), {
    STATS_DB: fakeDb(),
    IP_HASH_SECRET: SECRET,
  })
  assert.equal((await configured.json()).ipHash, 'enabled')

  const unconfigured = await worker.fetch(request('/stats/api/v1/health'), { STATS_DB: fakeDb() })
  assert.equal((await unconfigured.json()).ipHash, 'unconfigured')
})

test('submit rejects bad ids, bad counts, bad JSON and oversized bodies before any lease', async () => {
  const env = { STATS_DB: fakeDb() }
  const db = env.STATS_DB

  const badIds = await worker.fetch(jsonPost('/stats/api/v1/submit', { clientId: 'nope', submitId: SUBMIT }), env)
  assert.equal(badIds.status, 400)

  const badCounts = await worker.fetch(jsonPost('/stats/api/v1/submit', {
    clientId: CLIENT,
    submitId: SUBMIT,
    station: { cells: -1 },
  }), env)
  assert.equal(badCounts.status, 400)

  const badJson = await worker.fetch(jsonPost('/stats/api/v1/submit', '{not json'), env)
  assert.equal(badJson.status, 400)

  const oversized = await worker.fetch(jsonPost('/stats/api/v1/submit', 'x'.repeat(9 * 1024)), env)
  assert.equal(oversized.status, 413)
  assert.equal(db.batches, 0, 'nothing reached the database')
})

test('the declared Content-Length is refused before the body is buffered', async () => {
  const db = fakeDb()
  const response = await worker.fetch(request('/stats/api/v1/submit', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Origin: ORIGIN,
      'content-length': String(64 * 1024),
    },
    body: '{}',
  }), { STATS_DB: db })

  assert.equal(response.status, 413)
  assert.equal(db.statements.length, 0, 'the oversized declaration is refused before any query')
})

test('CORS echoes an allowed origin and omits a foreign one', async () => {
  const allowed = await worker.fetch(request('/stats/api/v1/health', { headers: { Origin: ORIGIN } }), {
    STATS_DB: fakeDb(),
  })
  assert.equal(allowed.headers.get('access-control-allow-origin'), ORIGIN)
  assert.match(allowed.headers.get('access-control-allow-headers'), /X-Stats-Lease/)

  const local = await worker.fetch(request('/stats/api/v1/health', { headers: { Origin: 'http://localhost:5174' } }), {
    STATS_DB: fakeDb(),
  })
  assert.equal(local.headers.get('access-control-allow-origin'), 'http://localhost:5174')

  const foreign = await worker.fetch(request('/stats/api/v1/health', { headers: { Origin: 'https://example.com' } }), {
    STATS_DB: fakeDb(),
  })
  assert.equal(foreign.headers.get('access-control-allow-origin'), null)
})

test('OPTIONS preflight is answered before any database work', async () => {
  const response = await worker.fetch(request('/stats/api/v1/submit', {
    method: 'OPTIONS',
    headers: { Origin: ORIGIN },
  }), {})
  assert.equal(response.status, 204)
  assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN)
})

test('the write endpoints refuse a foreign origin and a bare non-browser POST', async () => {
  const payload = {
    clientId: CLIENT,
    submitId: SUBMIT,
    station: { name: 'Test Junction' },
    delta: { boarded: 1 },
  }

  for (const path of ['/stats/api/v1/lease', '/stats/api/v1/submit']) {
    const foreignDb = fakeDb()
    const foreign = await worker.fetch(request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Origin: 'https://example.com' },
      body: JSON.stringify(payload),
    }), { STATS_DB: foreignDb })
    assert.equal(foreign.status, 403)
    assert.equal((await foreign.json()).error, 'forbidden')
    assert.equal(foreignDb.statements.length, 0, 'a refused write never reaches the database')

    // A script sends no Origin and no fetch metadata: the same refusal.
    const scriptDb = fakeDb()
    const script = await worker.fetch(request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }), { STATS_DB: scriptDb })
    assert.equal(script.status, 403)
    assert.equal(scriptDb.statements.length, 0)
  }
})

test('the write endpoints accept our own origin and the dev localhost origin', async () => {
  const payload = {
    clientId: CLIENT,
    submitId: SUBMIT,
    station: { name: 'Test Junction' },
    delta: { boarded: 1 },
  }

  const own = await leasedSubmit(fakeDb(), payload)
  assert.equal(own.status, 200)

  const db = fakeDb()
  const token = await mint(db)
  const local = await worker.fetch(request('/stats/api/v1/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: 'http://localhost:5174' },
    body: JSON.stringify({ ...payload, lease: token }),
  }), { STATS_DB: db })
  assert.equal(local.status, 200)
})

test('submit accepts a same-origin POST that omits Origin', async () => {
  const db = fakeDb()
  const token = await mint(db)
  const response = await worker.fetch(request('/stats/api/v1/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
    body: JSON.stringify({
      clientId: CLIENT,
      submitId: SUBMIT,
      station: { name: 'Test Junction' },
      delta: { boarded: 1 },
      lease: token,
    }),
  }), { STATS_DB: db })
  assert.equal(response.status, 200)
})

test('the page and the read endpoints are not gated', async () => {
  const env = { STATS_DB: fakeDb() }
  const foreign = { headers: { Origin: 'https://example.com' } }

  const page = await worker.fetch(request('/stats/', foreign), env)
  assert.equal(page.status, 200)

  const english = await worker.fetch(request('/stats/en/', foreign), env)
  assert.equal(english.status, 200)

  const totals = await worker.fetch(request('/stats/api/v1/global', foreign), env)
  assert.equal(totals.status, 200)

  const health = await worker.fetch(request('/stats/api/v1/health', foreign), env)
  assert.equal(health.status, 200)
})

test('wrong methods and unknown paths are 4xx, not 500s', async () => {
  const env = { STATS_DB: fakeDb() }
  const wrongMethod = await worker.fetch(request('/stats/api/v1/global', { method: 'POST' }), env)
  assert.equal(wrongMethod.status, 405)
  assert.equal(wrongMethod.headers.get('allow'), 'GET')

  const leaseGet = await worker.fetch(request('/stats/api/v1/lease'), env)
  assert.equal(leaseGet.status, 405)
  assert.equal(leaseGet.headers.get('allow'), 'POST')

  const unknownApi = await worker.fetch(request('/stats/api/v1/nope'), env)
  assert.equal(unknownApi.status, 404)

  const unknownPage = await worker.fetch(request('/stats/nope'), env)
  assert.equal(unknownPage.status, 404)

  const unknownEnglishPage = await worker.fetch(request('/stats/en/nope'), env)
  assert.equal(unknownEnglishPage.status, 404)

  const otherPath = await worker.fetch(request('/elsewhere'), env)
  assert.equal(otherPath.status, 404)
})

test('stream limit counts UTF-8 bytes without Content-Length', async () => {
  const req = jsonPost('/stats/api/v1/lease', { clientId: CLIENT, padding: '界'.repeat(3000) })
  assert.equal(req.headers.has('Content-Length'), false)
  assert.equal((await worker.fetch(req, { STATS_DB: fakeDb() })).status, 413)
})

test('real SQLite batch gates station metadata when simultaneous retries miss the precheck', async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const { readFileSync } = await import('node:fs')
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'))
  const db = {
    prepare(sql) {
      let args = []
      const statement = {
        bind(...values) { args = values; return statement },
        async first() {
          // Force both attempts past the advisory precheck.
          if (/SELECT 1 AS seen/.test(sql)) return null
          return sqlite.prepare(sql).get(...args) ?? null
        },
        async all() { return { results: sqlite.prepare(sql).all(...args) } },
        async run() { return { meta: sqlite.prepare(sql).run(...args) } },
        execute() {
          const stmt = sqlite.prepare(sql)
          return /^\s*SELECT/.test(sql)
            ? { results: stmt.all(...args) } : { meta: stmt.run(...args) }
        },
      }
      return statement
    },
    async batch(statements) {
      sqlite.exec('BEGIN')
      try {
        const result = statements.map(statement => statement.execute())
        sqlite.exec('COMMIT')
        return result
      } catch (error) { sqlite.exec('ROLLBACK'); throw error }
    },
  }
  try {
    const payload = { clientId: CLIENT, submitId: SUBMIT, station: { name: 'Original', cells: 10 }, delta: { boarded: 5 } }
    assert.equal((await leasedSubmit(db, payload)).status, 200)
    const before = sqlite.prepare('SELECT * FROM stations').all()
    const clients = sqlite.prepare('SELECT * FROM clients').all()
    assert.equal((await leasedSubmit(db, { ...payload, station: { name: 'Forged retry', cells: 999 } })).status, 200)
    assert.deepEqual(sqlite.prepare('SELECT * FROM stations').all(), before)
    assert.deepEqual(sqlite.prepare('SELECT * FROM clients').all(), clients)
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM passenger_deltas').get().n, 1)
    assert.equal(sqlite.prepare("SELECT value FROM global_counters WHERE key='passengers_boarded'").get().value, 5)
  } finally { sqlite.close() }
})

test('limiter failure refuses issuance instead of granting unlimited tokens', async () => {
  const db = fakeDb()
  db.batch = async () => { throw new Error('limiter unavailable') }
  const previous = console.error
  console.error = () => {}
  try {
    const response = await worker.fetch(leaseRequest(), { STATS_DB: db })
    assert.equal(response.status, 500)
    assert.equal(db.leases.size, 0)
  } finally { console.error = previous }
})
