import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'

const server = await serveDir(resolve('game/dist'), 0)
let page
try {
  page = await withPage({ url: `http://127.0.0.1:${server.address().port}/`,
    profile: resolve('.preview/sign-history', `chrome-${process.pid}`), debugPort: 12000 + process.pid % 30000 })
  await waitFor(page.evaluate, '!!window.__metro')
  await page.evaluate(`localStorage.setItem('metro-sign-text-history', JSON.stringify(${JSON.stringify(Array.from({ length: 8 }, (_, i) => `Recent ${i}`))}))`)
  await page.send('Page.reload')
  await waitFor(page.evaluate, '!!window.__metro')
  await page.evaluate(`document.querySelector('.tutorialActions .ghost')?.click(); __metro.getState().openSignComposer()`)
  await waitFor(page.evaluate, `!!document.querySelector('.signModal')`)
  await page.evaluate(`document.querySelectorAll('.signLibrary .group')[3].click()`)
  await waitFor(page.evaluate, `document.querySelectorAll('.signPaletteText .signRecentLabel ~ .tile').length === 8`)
  await page.evaluate('new Promise(r => setTimeout(r, 300))')
  const layout = await page.evaluate(`(() => {
    const well = document.querySelector('.signPaletteText');
    const box = well.getBoundingClientRect();
    const tiles = [...well.querySelectorAll('.signRecentLabel ~ .tile')].map(t => {
      const r = t.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    });
    return { top: box.top, bottom: box.bottom, left: box.left, right: box.right,
      scroll: well.scrollHeight > well.clientHeight, tiles };
  })()`)
  assert.equal(layout.scroll, false, JSON.stringify(layout))
  assert.equal(new Set(layout.tiles.map(t => t.top)).size, 2, JSON.stringify(layout))
  assert.ok(layout.tiles.every(t => t.top >= layout.top && t.bottom <= layout.bottom && t.left >= layout.left && t.right <= layout.right), JSON.stringify(layout))
  await page.evaluate(`document.querySelector('.signPaletteText .signRecentLabel ~ .tile').click()`)
  await waitFor(page.evaluate, `__metro.getState().currentBoards.front.some(c => c.kind === 'text' && c.text === 'Recent 0')`)
  assert.equal(await page.evaluate(`JSON.parse(localStorage.getItem('metro-sign-text-history'))[0]`), 'Recent 0')
  console.log('Recent sign tiles fit in two rows and insert before confirmation.')
} finally {
  await page?.close()
  server.close()
}
