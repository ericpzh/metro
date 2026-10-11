import test from 'node:test'
import assert from 'node:assert/strict'
import { messages } from '../src/sim/i18n/messages.ts'
import { getLanguage, languageForPath, msg, setLanguage, subscribeLanguage, t, translate } from '../src/sim/i18n.ts'
import worker from '../worker/index.js'

test('both catalogues cover the same copy and interpolation slots', () => {
  for (const [key, copy] of Object.entries(messages)) {
    assert.ok(copy.zh.trim(), `${key} needs Chinese copy`)
    assert.ok(copy.en.trim(), `${key} needs English copy`)
    const slots = (text) => [...text.matchAll(/\{(\d+)\}/g)].map(m => m[1]).sort()
    assert.deepEqual(slots(copy.en), slots(copy.zh), `${key} loses an interpolation argument`)
  }
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

test('English routes work at the root and under game hosting prefixes', async () => {
  for (const path of ['/', '/metro-game/', '/game/']) assert.equal(languageForPath(path), 'zh-CN')
  for (const path of ['/en', '/en/', '/metro-game/en/', '/game/en/']) assert.equal(languageForPath(path), 'en')
  assert.equal(languageForPath('/engineering'), 'zh-CN')
  for (const prefix of ['', '/metro-game']) {
    const fetched = []
    const env = { ASSET_PREFIX: prefix, ASSETS: { fetch: async (request) => {
      const path = new URL(request.url).pathname
      fetched.push(path)
      return new Response(path, { status: path === '/' || path === '/assets/game.js' ? 200 : 404 })
    } } }
    const response = await worker.fetch(new Request(`https://game.test${prefix}/en`), env)
    assert.equal(response.status, 308)
    assert.equal(response.headers.get('location'), `https://game.test${prefix}/en/`)
    assert.equal((await worker.fetch(new Request(`https://game.test${prefix}/en/`), env)).status, 200)
    assert.equal(fetched.at(-1), '/')
    assert.equal((await worker.fetch(new Request(`https://game.test${prefix}/en/assets/game.js`), env)).status, 200)
    assert.equal(fetched.at(-1), '/assets/game.js', 'relative English-route bundles reach real assets')
    assert.equal((await worker.fetch(new Request(`https://game.test${prefix}/en/assets/missing.js`), env)).status, 404)
    assert.equal((await worker.fetch(new Request(`https://game.test${prefix}/en/lab`), env)).status, 200)
    assert.equal(fetched.at(-1), '/')
  }
})
