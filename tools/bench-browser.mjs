// Production app, real worker + React commit + renderer. Uses the existing
// console hooks; timing wrappers exist only in this disposable browser page.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'
import { summarize, printTimings } from './perf-stats.mjs'

const duration = Number(process.env.BENCH_SECONDS ?? 6)
const edits = Number(process.env.BENCH_EDITS ?? 8)
if (!Number.isFinite(duration) || duration < 2 || !Number.isInteger(edits) || edits < 2) throw new Error('BENCH_SECONDS >= 2; BENCH_EDITS >= 2')
const softwareGpu = process.argv.includes('--software-gpu')
mkdirSync(resolve('.preview/perf'), { recursive: true })
const server = await serveDir(resolve('game/dist'), 0)
let page
try {
  page = await withPage({ url: `http://127.0.0.1:${server.address().port}/`,
    profile: resolve(`.preview/perf/chrome-${process.pid}`), debugPort: Number(process.env.BENCH_PORT ?? 9348),
    windowSize: process.env.BENCH_SIZE ?? '1400,900', softwareGpu })
  await waitFor(page.evaluate, '!!(window.__scene && window.__metro?.getState().metrics && window.__metro.getState().stats)', { what: 'demo station' })
  // Allow asynchronous artwork rebuilds and shader compilation to settle.
  await page.evaluate('new Promise(r => setTimeout(r, 3000))')
  await page.evaluate(`(() => {
    const scene = window.__scene, store = window.__metro;
    const bench = window.__perf = { samples: {}, active: false, last: 0, restore: [] };
    bench.record = (key, ms) => { if (bench.active) (bench.samples[key] ??= []).push(ms); };
    bench.wrap = (object, method, key) => {
      if (typeof object?.[method] !== 'function') throw Error('missing benchmark method: ' + method);
      const original = object[method];
      object[method] = function (...args) {
        const start = performance.now();
        try { return original.apply(this, args); } finally { bench.record(key, performance.now() - start); }
      };
      bench.restore.push(() => object[method] = original);
    };
    bench.wrap(scene, 'setStation', 'build.setStation.ms');
    for (const [field, method] of [['chunks', 'prepareStation'], ['chunks', 'meshStation'], ['modules', 'buildModules'], ['level', 'applyLevel'], ['grid', 'buildGrid'], ['crowd', 'renderAgents'], ['trains', 'updateTrains'], ['plates', 'updateAdScreens']]) {
      bench.wrap(scene[field], method, field + '.' + method + '.ms');
    }
    bench.wrap(scene.renderer, 'render', 'render.submit.ms');
    const loop = (now) => {
      if (bench.active && bench.last) bench.record('frame.interval.ms', now - bench.last);
      bench.last = bench.active ? now : 0;
      bench.raf = requestAnimationFrame(loop);
    };
    bench.raf = requestAnimationFrame(loop);
    bench.longTasks = [];
    bench.observer = new PerformanceObserver(list => {
      if (bench.active) bench.longTasks.push(...list.getEntries().map(e => e.duration));
    });
    bench.observer.observe({ type: 'longtask' });
    bench.commit = async (next) => {
      const previousMetrics = store.getState().metrics;
      const start = performance.now();
      const worker = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { unsubscribe(); reject(Error('worker did not acknowledge edit')); }, 15000);
        const unsubscribe = store.subscribe(state => {
          if (state.metrics === previousMetrics) return;
          clearTimeout(timer); unsubscribe();
          bench.record('build.workerResponse.ms', performance.now() - start);
          resolve();
        });
      });
      store.getState().commit(next);
      bench.record('build.commit.ms', performance.now() - start);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      bench.record('build.editToFrame.ms', performance.now() - start);
      await worker;
      await new Promise(r => setTimeout(r, 150));
    };
    store.getState().setPlaying(false);
    return true;
  })()`)
  const phases = {}
  async function capture(name, action = '') {
    console.log(`Measuring ${name}…`)
    const raw = await page.evaluate(`(async () => {
      const b = window.__perf, store = window.__metro, scene = window.__scene;
      b.samples = {}; b.longTasks = []; b.last = 0; b.active = true;
      ${action || `await new Promise(r => setTimeout(r, ${duration * 1000}));`}
      b.active = false;
      const s = store.getState();
      return { samples: b.samples, longTasks: b.longTasks, population: s.metrics.population,
        tick: s.metrics.tick, stats: s.stats, render: { ...scene.renderer.info.render },
        memory: { ...scene.renderer.info.memory } };
    })()`)
    const timings = Object.fromEntries(Object.entries(raw.samples).filter(([, v]) => v.length).map(([k, v]) => [k, summarize(v)]))
    const frames = raw.samples['frame.interval.ms'] ?? []
    const fps = frames.length * 1000 / frames.reduce((a, b) => a + b, 0)
    delete raw.samples
    phases[name] = { ...raw, fps, framesOver33ms: frames.filter(t => t > 33.33).length, timings }
    console.log(`${fps.toFixed(1)} FPS; ${raw.render.calls} draws; ${raw.render.triangles} triangles; ${raw.population} passengers`)
    printTimings(timings)
  }
  await capture('paused')
  await page.evaluate('window.__metro.getState().setSpeed(16); window.__metro.getState().setPlaying(true)')
  // A fixed sim tick, not a wall-time warmup; fail if this host cannot get there.
  await waitFor(page.evaluate, 'window.__metro.getState().metrics.tick >= 180', { tries: 180, every: 500, what: '180 simulation ticks' })
  await capture('playing16x')
  await page.evaluate('window.__metro.getState().setPlaying(false)')
  await page.evaluate('new Promise(r => setTimeout(r, 1000))')
  await capture('paintEdits', `
    const cell = store.getState().station.cells.find(c => c.fill === 'solid' && c.z === store.getState().activeZ && !c.tags?.length
      && !store.getState().station.modules.some(m => m.type === 'stair' &&
        ((m.x === c.x && m.y === c.y && m.z === c.z) || (m.from?.x === c.x && m.from?.y === c.y && m.from?.z === c.z))));
    if (!cell) throw Error('no demo paint target');
    for (let i = 0; i < ${edits}; i++) {
      const state = store.getState();
      const cells = state.station.cells.map(c => c.x === cell.x && c.y === cell.y && c.z === cell.z
        ? { ...c, finish: { ...c.finish, top: i % 2 ? 'floor.concrete' : 'floor.tile' } } : c);
      // Passive effects finish the scene rebuild before the next RAF. Two RAFs
      // include the first presented frame; worker acknowledgement is separate.
      await b.commit({ ...state.station, cells });
    }
  `)
  await capture('blockEdits', `
    const original = store.getState().station;
    const maxX = Math.max(...original.cells.map(c => c.x));
    const block = { x: maxX + 2, y: 0, z: store.getState().activeZ, fill: 'solid' };
    for (let i = 0; i < ${edits}; i++) {
      await b.commit({ ...original, cells: i % 2 ? original.cells : [...original.cells, block] });
    }
  `)
  const environment = await page.evaluate(`(() => {
    const gl = window.__scene.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { userAgent: navigator.userAgent, gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      width: innerWidth, height: innerHeight, dpr: devicePixelRatio, pixelRatio: window.__scene.renderer.getPixelRatio(),
      station: { cells: window.__metro.getState().station.cells.length, modules: window.__metro.getState().station.modules.length },
      activeZ: window.__metro.getState().activeZ };
  })()`)
  const report = { kind: 'production-browser', timestamp: new Date().toISOString(), environment,
    config: { duration, edits, softwareGpu }, phases }
  const output = resolve(process.env.BENCH_OUTPUT ?? '.preview/perf/browser.json')
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, JSON.stringify(report, null, 2))
  console.log(`Report: ${output}`)
} finally {
  await page?.close()
  server.close()
}
