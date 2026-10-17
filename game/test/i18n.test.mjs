import test from 'node:test'
import assert from 'node:assert/strict'
import { messages } from '../src/sim/i18n/messages.ts'
import { getLanguage, languageForPath, msg, setLanguage, subscribeLanguage, t, tForLanguage, translate } from '../src/sim/i18n.ts'
import worker from '../worker/index.js'

test('both catalogues cover the same copy and interpolation slots', () => {
  for (const [key, copy] of Object.entries(messages)) {
    assert.ok(copy.zh.trim(), `${key} needs Chinese copy`)
    assert.ok(copy.en.trim(), `${key} needs English copy`)
    const slots = (text) => [...text.matchAll(/\{(\d+)\}/g)].map(m => m[1]).sort()
    assert.deepEqual(slots(copy.en), slots(copy.zh), `${key} loses an interpolation argument`)
  }
})

test('explicit-language formatting leaves the active locale and authored arguments intact', () => {
  const initial = getLanguage()
  const events = []
  const unsubscribe = subscribeLanguage(() => events.push(getLanguage()))
  try {
    setLanguage('zh-CN')
    const count = events.length
    assert.equal(tForLanguage('en', 'move_value', '我的车站'), 'Move 我的车站')
    assert.equal(tForLanguage('en', 'compass_north'), 'N')
    assert.equal(t('compass_north'), '北', 'English captures cannot alter the Chinese game')
    assert.equal(getLanguage(), 'zh-CN')
    assert.equal(events.length, count, 'formatting emits no UI or renderer refresh')
    setLanguage('en')
    assert.equal(translate(msg('north')), 'North', 'the compact cube key does not replace canonical direction copy')
    assert.equal(tForLanguage('zh-CN', 'printed_exit'), 'EXIT', 'bilingual physical captions retain their printed English')
  } finally { unsubscribe(); setLanguage(initial) }
})

test('switching translates existing errors and catalogues while canonical data stays stable', () => {
  const initial = getLanguage()
  const events = []
  const unsubscribe = subscribeLanguage(() => events.push(getLanguage()))
  try {
    setLanguage('zh-CN')
    const error = msg('cannot_place_bridge_blocked_by_value', msg('fare_gate'))
    setLanguage('en')
    assert.equal(translate(error), 'Cannot place bridge: blocked by Fare gate')
    assert.equal(translate(msg('corrupt_file')), 'Corrupt file')
    assert.equal(translate('A 畅通'), 'A Free flow')
    assert.equal(translate('1月1日 周四'), '1/1 Thursday')
    assert.equal(translate(' / '), ' / ', 'punctuation and whitespace terminate normally')
    assert.equal(t('value_value', 2026, translate(msg('january'))), 'January 2026')
    assert.equal(t('opened_save_vvalue', 1), 'Opened save v1')
    assert.equal(t('move_value', '我的车站'), 'Move 我的车站', 'authored arguments remain intact')
    assert.equal(msg('fare_gate'), '闸机', 'catalogues and worker data remain canonical')
    const notified = events.length
    setLanguage('en')
    assert.equal(events.length, notified, 'the same language does not cause another rebuild')
    setLanguage('zh-CN')
    assert.equal(translate(error), error, 'a notice already stored also switches back')
    assert.equal(t('fare_gate'), '闸机')
  } finally { unsubscribe(); setLanguage(initial) }
})

test('English routes work under /game and at the workers.dev root', async () => {
  for (const path of ['/', '/game/', '/game/lab', '/gameplay/']) assert.equal(languageForPath(path), 'zh-CN')
  for (const path of ['/en', '/en/', '/game/en', '/game/en/', '/game/en/lab']) assert.equal(languageForPath(path), 'en')
  assert.equal(languageForPath('/engineering'), 'zh-CN')
  // The deployed host claims /game; the Worker's own workers.dev root has none.
  for (const { host, prefix } of [
    { host: 'stationdesigner.com', prefix: '/game' },
    { host: 'metro-game.example.workers.dev', prefix: '' },
  ]) {
    const fetched = []
    const env = { ASSET_PREFIX: prefix, ASSETS: { fetch: async (request) => {
      const path = new URL(request.url).pathname
      fetched.push(path)
      return new Response(path, { status: path === '/' || path === '/assets/game.js' ? 200 : 404 })
    } } }
    const base = `https://${host}${prefix}`
    const response = await worker.fetch(new Request(`${base}/en`), env)
    assert.equal(response.status, 308)
    assert.equal(response.headers.get('location'), `${base}/en/`)
    assert.equal((await worker.fetch(new Request(`${base}/en/`), env)).status, 200)
    assert.equal(fetched.at(-1), '/')
    assert.equal((await worker.fetch(new Request(`${base}/en/assets/game.js`), env)).status, 200)
    assert.equal(fetched.at(-1), '/assets/game.js', 'relative English-route bundles reach real assets')
    assert.equal((await worker.fetch(new Request(`${base}/en/assets/missing.js`), env)).status, 404)
    assert.equal((await worker.fetch(new Request(`${base}/en/lab`), env)).status, 200)
    assert.equal(fetched.at(-1), '/')
  }
})
