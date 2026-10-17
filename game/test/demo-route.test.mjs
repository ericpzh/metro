// Demo deep links: `/game/zoo`, `/game/tanwei` (and their `/game/en/…` twins)
// open the game on that example station, then leave the plain game URL behind so
// a reload restores the player's own autosave. The Worker serves those paths with
// no trailing slash; the app turns the segment into a document.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { demoStationForPath, gamePathFor } from '../src/app/demoRoute.ts'
import worker from '../worker/index.js'

test('a demo URL names its station in any game path', () => {
  for (const [path, id] of [
    ['/game/zoo', 'zoo'],
    ['/game/zoo/', 'zoo'],
    ['/game/tanwei', 'tanwei'],
    ['/game/en/zoo', 'zoo'],
    ['/game/en/tanwei/', 'tanwei'],
    ['/zoo', 'zoo'],
    ['/en/tanwei', 'tanwei'],
  ]) {
    assert.equal(demoStationForPath(path), id, path)
  }
  for (const path of ['/', '/game/', '/game/en/', '/game/lab', '/game/zoofoo', '/game/example-tanwei', '/']) {
    assert.equal(demoStationForPath(path), null, path)
  }
})

test('taking a demo link leaves the plain game path behind, keeping the language', () => {
  assert.equal(gamePathFor('/game/zoo'), '/game/')
  assert.equal(gamePathFor('/game/zoo/'), '/game/')
  assert.equal(gamePathFor('/game/en/zoo'), '/game/en/')
  assert.equal(gamePathFor('/game/en/tanwei/'), '/game/en/')
  assert.equal(gamePathFor('/zoo'), '/')
  assert.equal(gamePathFor('/en/tanwei'), '/en/')
})

test('the game Worker serves demo routes and drops their trailing slash', async () => {
  const fetched = []
  const env = { ASSET_PREFIX: '/game', ASSETS: { fetch: async (request) => {
    const path = new URL(request.url).pathname
    fetched.push(path)
    return new Response(path, { status: path === '/' || path === '/assets/game.js' ? 200 : 404 })
  } } }
  const game = (path) => worker.fetch(new Request(`https://stationdesigner.com${path}`), env)

  // A demo path has no file behind it: the SPA fallback serves the document.
  for (const path of ['/game/zoo', '/game/tanwei', '/game/en/zoo', '/game/en/tanwei']) {
    const response = await game(path)
    assert.equal(response.status, 200, path)
    assert.equal(await response.text(), '/', `${path} serves the game document`)
  }

  // A trailing slash would send the document's relative `./assets/...` inside the
  // route, so the Worker redirects it away instead.
  for (const [path, location] of [
    ['/game/zoo/', 'https://stationdesigner.com/game/zoo'],
    ['/game/tanwei/', 'https://stationdesigner.com/game/tanwei'],
    ['/game/en/zoo/', 'https://stationdesigner.com/game/en/zoo'],
    ['/game/en/tanwei/', 'https://stationdesigner.com/game/en/tanwei'],
    ['/game/lab/', 'https://stationdesigner.com/game/lab'],
  ]) {
    const response = await game(path)
    assert.equal(response.status, 308, path)
    assert.equal(response.headers.get('location'), location, path)
  }

  // A demo document asks for its bundle at the game root, not inside the route.
  assert.equal((await game('/game/assets/game.js')).status, 200)
  assert.equal(fetched.at(-1), '/assets/game.js')
  assert.equal((await game('/game/en/assets/game.js')).status, 200)
  assert.equal(fetched.at(-1), '/assets/game.js')
  assert.equal((await game('/game/zoo/assets/game.js')).status, 404, 'the route is not a directory')

  // The Worker's own workers.dev root has no `/game` prefix to strip.
  const root = { ASSET_PREFIX: '', ASSETS: env.ASSETS }
  assert.equal((await worker.fetch(new Request('https://game.test/zoo'), root)).status, 200)
  const slash = await worker.fetch(new Request('https://game.test/zoo/'), root)
  assert.equal(slash.status, 308)
  assert.equal(slash.headers.get('location'), 'https://game.test/zoo')
})

test('boot opens a demo link instead of the autosave, and loads it once', () => {
  const boot = readFileSync(new URL('../src/app/boot.tsx', import.meta.url), 'utf8')
  assert.match(boot, /demoStationForPath\(location\.pathname\)/, 'the path decides the station')
  assert.match(boot, /loadReference\(demo\)/, 'the named example is opened')
  assert.match(boot, /gamePathFor\(/, 'the demo segment is replaced by the plain game path')
  assert.match(boot, /if \(!demo\) \{[\s\S]{0,80}readAutosave/, 'a demo link never restores the autosave')
  assert.match(boot, /if \(!isLab && !demo\)[\s\S]{0,160}initSim/, 'the demo loaded its own worker; it is not init-ed twice')
})
