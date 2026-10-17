import test from 'node:test'
import assert from 'node:assert/strict'
import worker from '../../worker/index.js'

// The concept-art site is served from the domain root, so only its English pin
// reaches the Worker; everything else is a static asset the asset layer answers.
test('the site pins /en to /en/ and serves the document beneath it', async () => {
  const fetched = []
  const env = { ASSETS: { fetch: async (request) => {
    const path = new URL(request.url).pathname
    fetched.push(path)
    return new Response(path, {
      status: path === '/' || path === '/assets/site.js' || path === '/art/01.svg' ? 200 : 404,
    })
  } } }
  const site = (path, init) => worker.fetch(new Request(`https://stationdesigner.com${path}`, init), env)

  // The bare pin and an explicit index snap to the trailing-slash form, so the
  // document's relative `./assets/...` resolve one directory down.
  for (const path of ['/en', '/en/index.html']) {
    const response = await site(path)
    assert.equal(response.status, 308)
    assert.equal(response.headers.get('location'), 'https://stationdesigner.com/en/')
  }

  assert.equal((await site('/en/')).status, 200)
  assert.equal(fetched.at(-1), '/', 'the English document is the root document')
  assert.equal((await site('/en/assets/site.js')).status, 200)
  assert.equal(fetched.at(-1), '/assets/site.js', 'relative English-route bundles reach real assets')
  assert.equal((await site('/en/art/01.svg')).status, 200)
  assert.equal(fetched.at(-1), '/art/01.svg')
  assert.equal((await site('/en/assets/missing.js')).status, 404, 'a missing asset never falls back to the shell')
  assert.equal((await site('/en/anchor')).status, 404, 'the site has no client route to fall back to')
})

test('site requests outside the language pin pass through untouched', async () => {
  const fetched = []
  const env = { ASSETS: { fetch: async (request) => {
    fetched.push(new URL(request.url).pathname)
    return new Response('ok', { status: 200 })
  } } }
  const response = await worker.fetch(new Request('https://stationdesigner.com/'), env)
  assert.equal(response.status, 200)
  assert.deepEqual(fetched, ['/'])
  // /game never lands here in production: the game's Worker owns it on a more
  // specific route. The site must not rewrite such a path on its own.
  fetched.length = 0
  await worker.fetch(new Request('https://stationdesigner.com/game/'), env)
  assert.deepEqual(fetched, ['/game/'])
})
