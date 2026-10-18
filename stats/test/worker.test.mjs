import { test } from 'node:test'
import assert from 'node:assert/strict'
import worker from '../worker.js'
import { FAVICON } from '../favicon.js'
import { BRAND_MARK } from '../brand-mark.js'

const ORIGIN = 'https://stationdesigner.com'
const CLIENT = '11111111-1111-4111-8111-111111111111'
const SUBMIT = '22222222-2222-4222-8222-222222222222'

/**
 * A D1 stand-in: enough of `prepare().bind().all()/first()` and `batch()` to
 * exercise routing, validation, the SQL shape and the totals projection without
 * a database. It records every statement so a test can assert what was sent.
 */
function fakeDb({ counters = {}, stationCount = 0, latest = null, schema = true } = {}) {
  const statements = []
  return {
    statements,
    prepare(sql) {
      const entry = { sql, args: [] }
      statements.push(entry)
      const statement = {
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
          if (/sqlite_master/.test(sql)) return schema ? { name: 'stations' } : null
          if (/COUNT\(\*\) AS n FROM stations/.test(sql)) return { n: stationCount }
          if (/MAX\(t\) AS t/.test(sql)) return { t: latest }
          throw new Error(`unexpected first(): ${sql}`)
        },
      }
      return statement
    },
    async batch(batch) {
      return batch.map(() => ({ success: true }))
    },
  }
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

test('a valid submit batches clients, the station upsert and one idempotent delta', async () => {
  const db = fakeDb({ stationCount: 1 })
  const response = await worker.fetch(jsonPost('/stats/api/v1/submit', {
    clientId: CLIENT,
    submitId: SUBMIT,
    station: { name: 'Test Junction', cells: 10, modules: 2, lines: 1, platforms: 2, tracks: 2 },
    delta: { boarded: 5, alighted: 4, exited: 3, leftBehind: 1, simSeconds: 120.5, trainArrivals: 2 },
  }), { STATS_DB: db, ENVIRONMENT: 'development' })

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
  assert.match(sql, /submissions = submissions \+ 1/)
  assert.match(sql, /INSERT OR IGNORE INTO passenger_deltas/)
  assert.equal(db.statements.filter(statement => statement.sql.includes('passenger_deltas')).length, 2)
})

test('a retried submit keeps the same submission idempotency key', async () => {
  const db = fakeDb()
  const payload = {
    clientId: CLIENT,
    submitId: SUBMIT,
    station: { name: 'Test Junction' },
    delta: { boarded: 1 },
  }
  await worker.fetch(jsonPost('/stats/api/v1/submit', payload), { STATS_DB: db })
  const delta = db.statements.find(statement => statement.sql.includes('INSERT OR IGNORE INTO passenger_deltas'))
  assert.ok(delta)
  assert.equal(delta.args[2], SUBMIT)
  assert.match(delta.sql, /UNIQUE|IGNORE/)
})

test('submit rejects bad ids, bad counts, bad JSON and oversized bodies', async () => {
  const env = { STATS_DB: fakeDb() }

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
})

test('CORS echoes an allowed origin and omits a foreign one', async () => {
  const allowed = await worker.fetch(request('/stats/api/v1/health', { headers: { Origin: ORIGIN } }), {
    STATS_DB: fakeDb(),
  })
  assert.equal(allowed.headers.get('access-control-allow-origin'), ORIGIN)

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

test('submit refuses a foreign origin and a bare non-browser POST', async () => {
  const payload = {
    clientId: CLIENT,
    submitId: SUBMIT,
    station: { name: 'Test Junction' },
    delta: { boarded: 1 },
  }

  const foreignDb = fakeDb()
  const foreign = await worker.fetch(request('/stats/api/v1/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: 'https://example.com' },
    body: JSON.stringify(payload),
  }), { STATS_DB: foreignDb })
  assert.equal(foreign.status, 403)
  assert.equal((await foreign.json()).error, 'forbidden')
  assert.equal(foreignDb.statements.length, 0, 'a refused submit never reaches the database')

  // A script sends no Origin and no fetch metadata: the same refusal.
  const scriptDb = fakeDb()
  const script = await worker.fetch(request('/stats/api/v1/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }), { STATS_DB: scriptDb })
  assert.equal(script.status, 403)
  assert.equal(scriptDb.statements.length, 0)
})

test('submit accepts our own origin and the dev localhost origin', async () => {
  const payload = {
    clientId: CLIENT,
    submitId: SUBMIT,
    station: { name: 'Test Junction' },
    delta: { boarded: 1 },
  }

  const own = await worker.fetch(jsonPost('/stats/api/v1/submit', payload), { STATS_DB: fakeDb() })
  assert.equal(own.status, 200)

  const local = await worker.fetch(request('/stats/api/v1/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: 'http://localhost:5174' },
    body: JSON.stringify(payload),
  }), { STATS_DB: fakeDb() })
  assert.equal(local.status, 200)
})

test('submit accepts a same-origin POST that omits Origin', async () => {
  const response = await worker.fetch(request('/stats/api/v1/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
    body: JSON.stringify({
      clientId: CLIENT,
      submitId: SUBMIT,
      station: { name: 'Test Junction' },
      delta: { boarded: 1 },
    }),
  }), { STATS_DB: fakeDb() })
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

  const unknownApi = await worker.fetch(request('/stats/api/v1/nope'), env)
  assert.equal(unknownApi.status, 404)

  const unknownPage = await worker.fetch(request('/stats/nope'), env)
  assert.equal(unknownPage.status, 404)

  const unknownEnglishPage = await worker.fetch(request('/stats/en/nope'), env)
  assert.equal(unknownEnglishPage.status, 404)

  const otherPath = await worker.fetch(request('/elsewhere'), env)
  assert.equal(otherPath.status, 404)
})
