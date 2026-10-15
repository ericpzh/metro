import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'

const server = await serveDir(resolve('game/dist'), 0)
let page
try {
  page = await withPage({ url: `http://127.0.0.1:${server.address().port}/`,
    profile: resolve(`.preview/perf/stair-chrome-${process.pid}`), softwareGpu: false })
  await waitFor(page.evaluate, '!!(window.__scene && window.__metro?.getState().metrics)', { what: 'station' })
  if (process.env.BENCH_STATION) {
    const save = readFileSync(process.env.BENCH_STATION, 'utf8')
    await page.evaluate(`window.__metro.getState().loadFromText(${JSON.stringify(save)})`)
  }
  await page.evaluate(`new Promise(resolve => setTimeout(resolve, 3000))`)
  const point = await page.evaluate(`(async () => {
    window.__metro.setState({ tool: 'module', moduleType: 'stair-block', moduleRot: 0 });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const scene = window.__scene, canvas = scene.renderer.domElement, rect = canvas.getBoundingClientRect();
    let point;
    for (let row = 3; row < 9 && !point; row++) for (let column = 2; column < 9; column++) {
      const x = rect.left + rect.width * column / 10, y = rect.top + rect.height * row / 10;
      if (scene.pick(x, y, window.__metro.getState().activeZ) && !scene.pickModule(x, y)) { point = { x, y }; break; }
    }
    if (!point) throw Error('no unobstructed pointer target');
    window.__stairDrag = { raycasts: 0, raycastMs: 0, modules: window.__metro.getState().station.modules.length };
    const original = scene.pickModule;
    scene.pickModule = function (...args) {
      __stairDrag.raycasts++;
      const start = performance.now();
      try { return original.apply(this, args); } finally { __stairDrag.raycastMs += performance.now() - start; }
    };
    document.addEventListener('pointerdown', () => { __stairDrag.downStart = performance.now(); }, { capture: true, once: true });
    document.addEventListener('pointerdown', () => { __stairDrag.pointerDownMs = performance.now() - __stairDrag.downStart; }, { once: true });
    return point;
  })()`)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
  await page.evaluate('new Promise(resolve => setTimeout(resolve, 180))')
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + 100, y: point.y + 35, button: 'left', buttons: 1 })
  await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x + 100, y: point.y + 35, button: 'left', clickCount: 1 })
  const report = await page.evaluate('({...window.__stairDrag, station: window.__metro.getState().station.name})')
  const output = resolve(process.env.BENCH_OUTPUT ?? '.preview/perf/stair-drag.json')
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, JSON.stringify(report, null, 2))
  console.log(report)
  console.log(`Report: ${output}`)
} finally {
  await page?.close()
  server.close()
}
