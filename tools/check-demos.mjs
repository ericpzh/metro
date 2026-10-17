// The demo-station entry points, in the built production apps.
//
//   npm run check:demos        (builds both apps, then runs this)
//
// Serves web/dist and game/dist on one origin through tools/preview.mjs — the
// same URL rules the two Workers answer — then drives Chrome over them:
//
//   * the nav button (left of 看图) and the hero button (between 开始游戏 and
//     浏览概念图) open the one picker, in the page's language;
//   * each card shows the game's own preview and links the game's own demo route
//     (/game/zoo, /game/tanwei, /game/en/…);
//   * following a card opens that station in the game and leaves the plain game
//     path behind, without touching the autosave;
//   * the trailing-slash form of a demo route is redirected, like the Worker;
//   * the nav still fits at 390 px.
//
// Screenshots land in .preview/demos/ for looking at, not for asserting.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { withPage, waitFor } from './browser-harness.mjs'
import { createPreview } from './preview.mjs'

const PROFILE = resolve('.preview/demos-profile')
const SHOTS = resolve('.preview/demos')

/** The open picker, read out of the DOM: its title, its cards and the focus. */
const READ_PICKER = `(() => {
  const panel = document.querySelector('.demos__panel')
  if (!panel) return null
  return {
    title: (panel.querySelector('h2')?.textContent ?? '').trim(),
    cards: [...panel.querySelectorAll('.demos__card')].map((card) => ({
      id: card.dataset.demo ?? '',
      href: card.getAttribute('href') ?? '',
      image: card.querySelector('img')?.getAttribute('src') ?? '',
      text: (card.textContent ?? '').replace(/\\s+/g, ' ').trim(),
    })),
    focused: document.activeElement?.dataset?.demo ?? '',
  }
})()`

/** What the running game says about the document it opened. */
const READ_GAME = `({
  name: window.__metro?.getState().station.name ?? '',
  cells: window.__metro?.getState().station.cells.length ?? 0,
  path: location.pathname,
  lang: document.documentElement.lang,
  autosave: (() => { try { return localStorage.getItem('metro-game.autosave.v1') } catch { return 'blocked' } })(),
})`

/** Both previews have decoded: a card's picture is the station it opens. */
const PREVIEWS_LOADED = `[...document.querySelectorAll('.demos__card img')].every((img) => img.complete && img.naturalWidth > 0)`

const server = createPreview()
await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
const origin = `http://127.0.0.1:${server.address().port}`
const page = await withPage({ url: `${origin}/`, profile: PROFILE })

const navigate = async (path) => {
  const loaded = page.waitForEvent('Page.loadEventFired')
  await page.send('Page.navigate', { url: `${origin}${path}` })
  await loaded
}
const shot = async (name) => {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' })
  mkdirSync(SHOTS, { recursive: true })
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'))
}

try {
  await page.send('Page.enable')
  await waitFor(page.evaluate, `!!document.querySelector('[data-demos="nav"]')`, { what: 'the site nav' })

  // --- Chinese site: one picker, opened by both buttons ---------------------
  await page.evaluate(`(() => { const b = document.querySelector('[data-demos="nav"]'); b.focus(); b.click(); return true })()`)
  await waitFor(page.evaluate, `!!document.querySelector('.demos__panel')`, { what: 'the nav picker' })
  const zh = await page.evaluate(READ_PICKER)
  assert.equal(zh.title, '示例车站')
  assert.deepEqual(zh.cards.map((c) => c.id), ['zoo', 'tanwei'])
  assert.deepEqual(zh.cards.map((c) => c.href), ['/game/zoo', '/game/tanwei'])
  assert.ok(zh.cards[0].image.endsWith('/stations/zoo.webp'), zh.cards[0].image)
  assert.ok(zh.cards[1].image.endsWith('/stations/tanwei.webp'), zh.cards[1].image)
  assert.match(zh.cards[0].text, /动物园/)
  assert.match(zh.cards[0].text, /广州地铁/)
  assert.match(zh.cards[1].text, /坦尾/)
  assert.equal(zh.focused, 'zoo', 'the first card takes focus')
  await waitFor(page.evaluate, PREVIEWS_LOADED, { what: 'the station previews' })
  await shot('picker-zh')
  console.log(`demos: nav picker — ${zh.cards.map((c) => `${c.id} -> ${c.href}`).join(', ')}`)

  // Escape closes it and hands focus back to the button that opened it.
  await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await waitFor(page.evaluate, `!document.querySelector('.demos__panel')`, { what: 'the closed picker' })
  assert.equal(await page.evaluate(`document.activeElement?.dataset?.demos ?? ''`), 'nav')

  await page.evaluate(`(() => { const b = document.querySelector('[data-demos="hero"]'); b.focus(); b.click(); return true })()`)
  await waitFor(page.evaluate, `!!document.querySelector('.demos__panel')`, { what: 'the hero picker' })
  const hero = await page.evaluate(READ_PICKER)
  assert.deepEqual(hero.cards.map((c) => c.href), ['/game/zoo', '/game/tanwei'])
  console.log('demos: the hero button opens the same cards')

  // --- following a card starts the zoo, then leaves the plain game path ----
  const zooLoaded = page.waitForEvent('Page.loadEventFired')
  await page.evaluate(`(() => { setTimeout(() => document.querySelector('.demos__card[data-demo="zoo"]').click(), 0); return true })()`)
  await zooLoaded
  await waitFor(page.evaluate, `window.__metro?.getState().station.cells.length > 1000`, { what: 'the zoo document' })
  const zoo = await page.evaluate(READ_GAME)
  assert.equal(zoo.name, '动物园')
  assert.equal(zoo.path, '/game/', 'the demo segment is replaced by the plain game path')
  assert.equal(zoo.autosave, null, 'a demo link does not write the autosave')
  console.log(`demos: /game/zoo opened ${zoo.name} (${zoo.cells} cells) at ${zoo.path}`)

  // --- a demo link outranks the autosave; the plain path restores it -------
  const renamed = await page.evaluate(`(() => {
    window.__metro.getState().renameStation('我的车站')
    window.dispatchEvent(new Event('pagehide'))
    return window.__metro.getState().station.name
  })()`)
  assert.equal(renamed, '我的车站')
  assert.equal(await page.evaluate(`localStorage.getItem('metro-game.autosave.v1') !== null`), true, 'the edit is autosaved')

  await navigate('/game/tanwei')
  await waitFor(page.evaluate, `window.__metro?.getState().station.name === '坦尾'`, { what: 'the Tanwei document' })
  const override = await page.evaluate(READ_GAME)
  assert.equal(override.name, '坦尾', 'the demo link opens its station over the autosave')
  assert.equal(override.autosave !== null, true, 'the autosave is still there')

  await navigate('/game/')
  await waitFor(page.evaluate, `window.__metro?.getState().station.name === '我的车站'`, { what: 'the restored autosave' })
  console.log(`demos: /game/tanwei outweighs the autosave; /game/ restores ${await page.evaluate(`window.__metro.getState().station.name`)}`)

  // --- the English site links the English demo routes ----------------------
  await navigate('/en/')
  await waitFor(page.evaluate, `document.documentElement.lang === 'en' && !!document.querySelector('[data-demos="hero"]')`, { what: 'the English site' })
  await page.evaluate(`(() => { const b = document.querySelector('[data-demos="hero"]'); b.focus(); b.click(); return true })()`)
  await waitFor(page.evaluate, `!!document.querySelector('.demos__panel')`, { what: 'the English picker' })
  const en = await page.evaluate(READ_PICKER)
  assert.equal(en.title, 'Demo stations')
  assert.deepEqual(en.cards.map((c) => c.href), ['/game/en/zoo', '/game/en/tanwei'])
  assert.equal(en.cards[0].text.includes('Zoo'), true)
  assert.equal(en.cards[1].text.includes('Tanwei'), true)
  await waitFor(page.evaluate, PREVIEWS_LOADED, { what: 'the English previews' })
  await shot('picker-en')
  console.log(`demos: English picker — ${en.cards.map((c) => c.href).join(', ')}`)

  const tanweiLoaded = page.waitForEvent('Page.loadEventFired')
  await page.evaluate(`(() => { setTimeout(() => document.querySelector('.demos__card[data-demo="tanwei"]').click(), 0); return true })()`)
  await tanweiLoaded
  await waitFor(page.evaluate, `window.__metro?.getState().station.cells.length > 1000`, { what: 'the Tanwei document' })
  const tanwei = await page.evaluate(READ_GAME)
  assert.equal(tanwei.name, '坦尾')
  assert.equal(tanwei.path, '/game/en/', 'the language pin survives, the demo segment does not')
  assert.equal(tanwei.lang, 'en', 'the English route still opens the English game')
  console.log(`demos: /game/en/tanwei opened ${tanwei.name} at ${tanwei.path} in ${tanwei.lang}`)

  // --- the Worker's trailing-slash rule, end to end ------------------------
  await navigate('/game/zoo/')
  await waitFor(page.evaluate, `window.__metro?.getState().station.cells.length > 1000`, { what: 'the redirected zoo document' })
  const slashed = await page.evaluate(READ_GAME)
  assert.equal(slashed.name, '动物园')
  assert.equal(slashed.path, '/game/', '/game/zoo/ redirects to /game/zoo, then opens the plain path')
  console.log('demos: /game/zoo/ redirects and opens the zoo')

  // --- the nav still fits a phone -----------------------------------------
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await navigate('/')
  await waitFor(page.evaluate, `!!document.querySelector('[data-demos="nav"]')`, { what: 'the narrow site nav' })
  const narrow = await page.evaluate(`(() => {
    const nav = document.querySelector('.nav__inner')
    return {
      width: window.innerWidth,
      page: document.documentElement.scrollWidth > window.innerWidth + 1,
      nav: nav.scrollWidth > nav.clientWidth + 1,
    }
  })()`)
  assert.equal(narrow.nav, false, `the nav overflows at ${narrow.width} px`)
  assert.equal(narrow.page, false, `the page scrolls sideways at ${narrow.width} px`)
  await page.evaluate(`(() => { const b = document.querySelector('[data-demos="nav"]'); b.focus(); b.click(); return true })()`)
  await waitFor(page.evaluate, PREVIEWS_LOADED, { what: 'the phone picker' })
  await shot('picker-mobile')
  console.log(`demos: the nav fits at ${narrow.width} px`)

  console.log('demos: pass')
} finally {
  await page.close()
  await new Promise((ok) => server.close(ok))
}
