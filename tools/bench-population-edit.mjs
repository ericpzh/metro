import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { serveDir, withPage, waitFor, loadExampleStation } from './browser-harness.mjs'

const output = resolve(process.env.BENCH_OUTPUT ?? '.preview/perf/population-edit.json')
mkdirSync(resolve('.preview/perf'), { recursive: true })
const server = await serveDir(resolve('game/dist'), 0)
let page
try {
  page = await withPage({ url: `http://127.0.0.1:${server.address().port}/`, profile: resolve(`.preview/perf/population-${process.pid}`), debugPort: 9433, windowSize: '1440,1000' })
  await loadExampleStation(page, process.env.BENCH_DEMO ?? 'zoo')
  await page.evaluate(`(() => {
    window.__pop = { calls: 0, ms: 0, commitMs: 0, work: {}, samples: [], errors: [] };
    const commit = __metro.getState().commit;
    __metro.setState({commit: (...args) => { const t=performance.now(); const r=commit(...args); __pop.commitMs+=performance.now()-t; return r; }});
    addEventListener('error', e => __pop.errors.push(e.message));
    const original = __scene.setStation.bind(__scene);
    __scene.setStation = (...args) => { const t = performance.now(); __pop.calls++; const r = original(...args); __pop.ms += performance.now() - t; return r; };
    for (const [object, key] of [[__scene.chunks,'prepareStation'],[__scene.chunks,'meshStation'],[__scene.modules,'buildModules'],[__scene.modules.batches,'invalidateViews']]) {
      const fn=object[key].bind(object); object[key]=(...args)=>{__pop.work[key]=(__pop.work[key]??0)+1; return fn(...args);};
    }
  })()`)
  for (const kind of ['train', 'exit']) {
    const selector = kind === 'train' ? 'input[type="range"][max="400"]' : 'input[type="range"][max="6000"]'
    await waitFor(page.evaluate, `!!document.querySelector(${JSON.stringify(selector)})`, { what: kind + ' slider' })
    await page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView(); el.focus(); })()`)
    for (let i = 0; i < 3; i++) {
      await page.evaluate(`(() => { __pop.calls = 0; __pop.ms = 0; __pop.commitMs=0; __pop.work={}; __pop.start = performance.now(); __pop.version = __metro.getState().version; })()`)
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
      await page.evaluate(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`)
      await page.evaluate(`__pop.samples.push({kind:${JSON.stringify(kind)},iteration:${i},twoRafMs:performance.now()-__pop.start,sceneCalls:__pop.calls,sceneMs:__pop.ms,commitMs:__pop.commitMs,work:{...__pop.work},commits:__metro.getState().version-__pop.version})`)
    }
  }
  const report = await page.evaluate(`({ ...__pop, fixture: {name:__metro.getState().station.name,cells:__metro.getState().station.cells.length,modules:__metro.getState().station.modules.length}, gpu:__scene.renderer.getContext().getParameter(__scene.renderer.getContext().RENDERER) })`)
  writeFileSync(output, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  if (report.samples.some(s => s.commits !== 1) || report.errors.length) throw new Error('Slider interaction failed')
  if (process.env.BENCH_ASSERT_FAST === '1' && report.samples.some(s => Object.values(s.work).some(n => n))) throw new Error('Population edit rebuilt scene resources')
} finally { await page?.close(); server.close() }
