import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import vm from 'node:vm'
import worker from '../worker.js'

const origin = 'https://stationdesigner.com'
const secret = 'report-test-secret'
const address = '203.0.113.8'
const hash = ip => createHmac('sha256', secret).update(ip).digest('hex')
const payload = { type: 'bug', title: 'Escalator issue', details: 'Steps to reproduce the problem.' }

function database(t) {
  const sql = new DatabaseSync(':memory:')
  const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
  sql.exec(schema)
  sql.exec(schema) // Production migrations reapply the entire file.
  t.after(() => sql.close())
  const db = {
    prepare(query) {
      let args = []
      const statement = {
        bind(...values) { args = values; return statement },
        async first() { return sql.prepare(query).get(...args) ?? null },
        async all() { return { results: sql.prepare(query).all(...args) } },
        async run() { return { meta: sql.prepare(query).run(...args) } },
      }
      return statement
    },
  }
  return { sql, env: { STATS_DB: db, IP_HASH_SECRET: secret } }
}

function call(env, path = '', body, ip = address, headers = {}) {
  return worker.fetch(new Request(origin + '/stats/api/v1/reports' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: origin, 'CF-Connecting-IP': ip, ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env)
}

async function create(env, body = payload, ip = address) {
  const response = await call(env, '', body, ip)
  assert.equal(response.status, 201)
  return (await response.json()).issue
}

test('reports persist public fields, keep hashes private, and do not change game totals', async t => {
  const { env, sql } = database(t)
  const issue = await create(env)
  assert.equal(issue.title, payload.title)
  assert.equal(issue.votes, 0)
  assert.equal(sql.prepare('SELECT ip_hash FROM reports').get().ip_hash, hash(address))
  const text = await (await call(env)).text()
  assert.ok(!text.includes(hash(address)))
  assert.ok(!text.includes(address))
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM clients').get().n, 0)
  assert.equal(sql.prepare('SELECT SUM(value) n FROM global_counters').get().n, 0)
})

test('simultaneous submissions cannot exceed the daily IP budget; another IP has its own budget', async t => {
  const { env, sql } = database(t)
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-24T23:59:59.000Z') })
  const responses = await Promise.all(Array.from({ length: 12 }, () => call(env, '', payload)))
  assert.equal(responses.filter(r => r.status === 201).length, 5)
  assert.equal(responses.filter(r => r.status === 429).length, 7)
  assert.ok(Number(responses.find(r => r.status === 429).headers.get('Retry-After')) > 0)
  await create(env, payload, '203.0.113.9')
  assert.equal(responses.find(r => r.status === 429).headers.get('Retry-After'), '1')
  t.mock.timers.tick(1000)
  assert.equal(new Date().toISOString(), '2026-10-25T00:00:00.000Z')
  await create(env)
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM reports WHERE ip_hash = ?').get(hash(address)).n, 6)
})

test('simultaneous repeated votes increment once and persist across reads', async t => {
  const { env, sql } = database(t)
  const issue = await create(env)
  const responses = await Promise.all(Array.from({ length: 10 }, () => call(env, '/' + issue.id + '/vote', {})))
  assert.ok(responses.every(r => r.status === 200))
  assert.equal(sql.prepare('SELECT votes FROM reports').get().votes, 1)
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM report_votes').get().n, 1)
  const own = await (await call(env)).json()
  assert.equal(own.issues[0].voted, true)
  const other = await (await call(env, '', undefined, '203.0.113.10')).json()
  assert.equal(other.issues[0].voted, false)
  await call(env, '/' + issue.id + '/vote', {}, '203.0.113.10')
  assert.equal(sql.prepare('SELECT votes FROM reports').get().votes, 2)
  sql.prepare('DELETE FROM report_votes WHERE ip_hash = ?').run(hash(address))
  assert.equal(sql.prepare('SELECT votes FROM reports').get().votes, 1)
  sql.prepare('DELETE FROM reports').run()
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM report_votes').get().n, 0)
})

test('vote budget limits new votes while allowing idempotent retries', async t => {
  const { env, sql } = database(t)
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-24T23:59:59.000Z') })
  const insert = sql.prepare('INSERT INTO reports (id,type,title,details,ip_hash,created_at) VALUES (?, ?, ?, ?, ?, ?)')
  const ids = Array.from({ length: 101 }, () => crypto.randomUUID())
  for (const id of ids) insert.run(id, 'feature', 'A new feature', 'Detailed feature request.', 'author', new Date().toISOString())
  for (const id of ids.slice(0, 100)) assert.equal((await call(env, '/' + id + '/vote', {})).status, 200)
  assert.equal((await call(env, '/' + ids[100] + '/vote', {})).status, 429)
  assert.equal((await call(env, '/' + ids[100] + '/vote', {})).headers.get('Retry-After'), '1')
  assert.equal((await call(env, '/' + ids[0] + '/vote', {})).status, 200)
  assert.equal((await call(env, '/' + ids[100] + '/vote', {}, '203.0.113.9')).status, 200)
  t.mock.timers.tick(1000)
  assert.equal(new Date().toISOString(), '2026-10-25T00:00:00.000Z')
  assert.equal((await call(env, '/' + ids[100] + '/vote', {})).status, 200)
  assert.equal((await call(env, '/' + ids[0] + '/vote', {})).status, 200, 'existing votes remain idempotent after midnight')
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM report_votes WHERE ip_hash = ?').get(hash(address)).n, 101)
})

test('reads sort by votes then date and provide filtered bounded pages', async t => {
  const { env, sql } = database(t)
  const insert = sql.prepare('INSERT INTO reports (id,type,title,details,ip_hash,created_at,votes) VALUES (?, ?, ?, ?, ?, ?, ?)')
  for (let i = 0; i < 45; i++) insert.run(crypto.randomUUID(), i % 2 ? 'bug' : 'feature', 'Report ' + i, payload.details, 'seed', new Date(1700000000000 + i * 1000).toISOString(), i === 0 ? 5 : 0)
  const top = await (await call(env)).json()
  assert.equal(top.issues.length, 40)
  assert.equal(top.hasMore, true)
  assert.equal(top.issues[0].title, 'Report 0')
  assert.equal(top.issues[1].title, 'Report 44')
  const next = await (await call(env, '?offset=40')).json()
  assert.equal(next.issues.length, 5)
  assert.equal(next.hasMore, false)
  const newest = await (await call(env, '?sort=new&type=bug')).json()
  assert.equal(newest.issues[0].title, 'Report 43')
  assert.ok(newest.issues.every(i => i.type === 'bug'))
  for (const query of ['?sort=sql', '?type=wrong', '?offset=-1', '?offset=NaN']) assert.equal((await call(env, query)).status, 400)
})

test('invalid, oversized, foreign, unidentified and banned writes create no reports', async t => {
  const { env, sql } = database(t)
  for (const body of [{}, { ...payload, type: 'other' }, { ...payload, title: '  ' }, { ...payload, details: 'tiny' }, { ...payload, title: 'x'.repeat(161) }]) {
    assert.equal((await call(env, '', body)).status, 400)
  }
  assert.equal((await call(env, '', payload, address, { Origin: 'https://evil.example' })).status, 403)
  assert.equal((await call({ ...env, IP_HASH_SECRET: '' }, '', payload)).status, 503)
  assert.equal((await call(env, '', payload, '')).status, 503)
  assert.equal((await call(env, '', { ...payload, details: 'x'.repeat(17000) })).status, 413)
  sql.prepare('INSERT INTO blocked_ips (ip_hash,created_at) VALUES (?,?)').run(hash(address), new Date().toISOString())
  assert.equal((await call(env, '', payload)).status, 403)
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM reports').get().n, 0)
})

test('Chinese details fit the byte limit, and unknown votes and unsupported methods are rejected', async t => {
  const { env } = database(t)
  await create(env, { ...payload, details: '中文内容'.repeat(750) })
  assert.equal((await call(env, '/' + crypto.randomUUID() + '/vote', {})).status, 404)
  const response = await worker.fetch(new Request(origin + '/stats/api/v1/reports', { method: 'DELETE' }), env)
  assert.equal(response.status, 405)
  assert.equal(response.headers.get('Allow'), 'GET, POST')
})

test('both report routes keep the language switch and executable browser scripts', async () => {
  for (const [path, lang, other] of [['/stats/report', 'zh-CN', '/stats/en/report'], ['/stats/en/report', 'en', '/stats/report']]) {
    const response = await worker.fetch(new Request(origin + path), {})
    assert.equal(response.status, 200)
    const page = await response.text()
    assert.ok(page.includes('<html lang="' + lang + '">'))
    assert.ok(page.includes('href="' + other + '"'))
    assert.ok(page.includes('report-form'))
    new vm.Script(page.match(/<script>([\s\S]*?)<\/script>/)[1])
    const head = await worker.fetch(new Request(origin + path, { method: 'HEAD' }), {})
    assert.equal(await head.text(), '')
    const redirect = await worker.fetch(new Request(origin + path + '/'), {})
    assert.equal(redirect.status, 308)
    assert.equal(redirect.headers.get('Location'), path)
  }
})
