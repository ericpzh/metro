// Production app, real worker + React commit + renderer. Uses the existing
// console hooks; timing wrappers exist only in this disposable browser page.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { serveDir, withPage, waitFor, loadExampleStation } from './browser-harness.mjs'
import { summarize, printTimings } from './perf-stats.mjs'

const duration = Number(process.env.BENCH_SECONDS ?? 6)
const edits = Number(process.env.BENCH_EDITS ?? 8)
if (!Number.isFinite(duration) || duration < 2 || !Number.isInteger(edits) || edits < 2) throw new Error('BENCH_SECONDS >= 2; BENCH_EDITS >= 2')
const softwareGpu = process.argv.includes('--software-gpu')
const investigate = process.argv.includes('--investigate')
const profile = process.argv.includes('--profile')
const gpuTimer = process.argv.includes('--gpu-timer')
const compareBatching = process.argv.includes('--compare-batching')
mkdirSync(resolve('.preview/perf'), { recursive: true })
const server = await serveDir(resolve('game/dist'), 0)
let page
try {
  page = await withPage({ url: `http://127.0.0.1:${server.address().port}/`,
    profile: resolve(`.preview/perf/chrome-${process.pid}`), debugPort: Number(process.env.BENCH_PORT ?? 9348),
    windowSize: process.env.BENCH_SIZE ?? '1400,900', softwareGpu })
  await waitFor(page.evaluate, '!!(window.__scene && window.__metro?.getState().metrics && window.__metro.getState().stats)', { what: 'initial station' })
  const startup = { readyMs: await page.evaluate('performance.now()') }
  await page.evaluate(`document.querySelector('.tutorialActions .ghost')?.click()`)
  if (process.env.BENCH_STATION) {
    const stationPath = resolve(process.env.BENCH_STATION)
    const builtIn = stationPath === resolve('game/src/data/tanwei-station.json')
      ? 'tanwei'
      : stationPath === resolve('game/src/data/demo-station.json') ? 'zoo' : null
    if (builtIn) {
      const start = performance.now()
      await loadExampleStation(page, builtIn)
      startup.stationLoadMs = performance.now() - start
    } else {
      const text = readFileSync(stationPath, 'utf8')
      startup.stationLoadMs = await page.evaluate(`(async () => {
        const start = performance.now(), previous = window.__metro.getState().metrics;
        window.__metro.getState().loadFromText(${JSON.stringify(text)});
        while (window.__metro.getState().metrics === previous || !window.__metro.getState().metrics) await new Promise(r => setTimeout(r, 50));
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        return performance.now() - start;
      })()`)
    }
  } else await loadExampleStation(page)
  startup.fixtureReadyMs = await page.evaluate('performance.now()')
  // Allow asynchronous artwork rebuilds and shader compilation to settle.
  await page.evaluate('new Promise(r => setTimeout(r, 3000))')
  // Measure submitted-frame throughput even though the normal paused app retains
  // its framebuffer. Idle savings are measured separately below.
  await page.evaluate('window.__scene.setContinuousRendering(true)')
  await page.evaluate(`(() => {
    const scene = window.__scene, store = window.__metro;
    const bench = window.__perf = { samples: {}, active: false, last: 0, restore: [] };
    bench.errors = [];
    const error = console.error;
    console.error = (...args) => { bench.errors.push(args.map(String).join(' ').slice(0, 4096)); error(...args); };
    bench.restore.push(() => console.error = error);
    window.addEventListener('error', e => bench.errors.push(e.message));
    window.addEventListener('unhandledrejection', e => bench.errors.push(String(e.reason)));
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
    bench.wrap(scene.trains, 'setTrains', 'trains.setTrains.ms');
    for (const [field, method] of [['chunks', 'prepareStation'], ['chunks', 'meshStation'], ['modules', 'buildModules'], ['level', 'applyLevel'], ['grid', 'buildGrid'], ['crowd', 'renderAgents'], ['trains', 'updateTrains'], ['plates', 'updateAdScreens']]) {
      bench.wrap(scene[field], method, field + '.' + method + '.ms');
    }
    bench.wrap(scene.renderer, 'render', 'render.submit.ms');
    if (${gpuTimer}) {
      const gl = scene.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      bench.gpuTimer = ext ? 'EXT_disjoint_timer_query_webgl2' : 'unavailable';
      bench.uploads = { calls: 0, bytes: 0 };
      for (const method of ['bufferData', 'bufferSubData']) {
        const original = gl[method];
        gl[method] = function (...args) {
          const data = args[method === 'bufferData' ? 1 : 2];
          if (bench.active && ArrayBuffer.isView(data)) {
            const offset = args[3] ?? 0, length = args[4], bytesPerElement = data.BYTES_PER_ELEMENT ?? 1;
            bench.uploads.calls++;
            bench.uploads.bytes += length ? length * bytesPerElement : data.byteLength - offset * bytesPerElement;
          }
          return original.apply(this, args);
        };
        bench.restore.push(() => gl[method] = original);
      }
      if (ext) {
        const pending = [], original = scene.renderer.render;
        scene.renderer.render = function (...args) {
          const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
          while (pending.length && (disjoint || gl.getQueryParameter(pending[0].query, gl.QUERY_RESULT_AVAILABLE))) {
            const item = pending.shift();
            if (!disjoint && bench.active && bench.samples === item.samples)
              bench.record('gpu.render.ms', gl.getQueryParameter(item.query, gl.QUERY_RESULT) / 1e6);
            gl.deleteQuery(item.query);
          }
          const query = bench.active && pending.length < 8 ? gl.createQuery() : null;
          if (query) gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
          try { return original.apply(this, args); }
          finally {
            if (query) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push({ query, samples: bench.samples }); }
          }
        };
        bench.restore.push(() => { scene.renderer.render = original; pending.forEach(item => gl.deleteQuery(item.query)); });
      }
    }
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
      b.samples = {}; b.longTasks = []; b.uploads = { calls: 0, bytes: 0 }; b.last = 0; b.active = true;
      const firstRenderedFrame = scene.framesRendered;
      performance.mark(${JSON.stringify(name + '.start')});
      ${action || `await new Promise(r => setTimeout(r, ${duration * 1000}));`}
      b.active = false;
      performance.mark(${JSON.stringify(name + '.end')});
      const s = store.getState();
      const list = scene.renderer.renderLists.get(scene.ctx.scene, 0);
      const inventory = { byFamily: {}, byMaterial: {}, batchedSurfaces: 0 };
      for (const item of [...list.opaque, ...list.transmissive, ...list.transparent]) {
        const object = item.object, material = item.material;
        let family = 'station', root = object;
        if (object.userData.equipmentBatch) family = 'equipment.batch';
        else while (root) {
          if (root.userData.renderFamily) { family = root.userData.renderFamily; break; }
          if (root.userData.moduleType) { family = 'equipment.' + root.userData.moduleType; break; }
          root = root.parent;
        }
        const passes = material.transparent && material.side === 2 && !material.forceSinglePass ? 2 : 1;
        inventory.byFamily[family] = (inventory.byFamily[family] ?? 0) + passes;
        const key = family + '/' + material.type + '/' + (material.map ? 'mapped' : 'plain') + '/' + (material.transparent ? 'transparent' : 'opaque');
        inventory.byMaterial[key] = (inventory.byMaterial[key] ?? 0) + passes;
        if (object.isBatchedMesh) inventory.batchedSurfaces += object._instanceInfo.filter(i => i.active && i.visible).length;
      }
      return { samples: b.samples, longTasks: b.longTasks, population: s.metrics.population,
        renderedFrames: scene.framesRendered - firstRenderedFrame,
        drawInventory: inventory,
        uploads: ${gpuTimer} ? b.uploads : undefined,
        tick: s.metrics.tick, stats: s.stats, render: { ...scene.renderer.info.render },
        crowdInstances: { available: scene.crowd.agentCount, drawCount: scene.crowd.agents.count,
          submitted: scene.crowd.agents.visible ? scene.crowd.agents.count : 0,
          nonzero: Array.from({ length: scene.crowd.agents.count }, (_, i) => i)
            .filter(i => {
              const m = scene.crowd.agents.instanceMatrix.array, o = i * 16;
              return m[o] !== 0 || m[o + 1] !== 0 || m[o + 2] !== 0;
            }).length },
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
  if (profile) {
    await page.send('Profiler.enable')
    await page.send('Profiler.setSamplingInterval', { interval: 1000 })
    await page.send('Profiler.start')
  }
  if (process.argv.includes('--distant-view')) {
    await page.evaluate('window.__scene.zoomBy(2); new Promise(r => setTimeout(r, 1000))')
  }
  if (process.argv.includes('--compare-detail')) {
    await page.evaluate('window.__scene.setStaticDetail(false); new Promise(r => setTimeout(r, 1000))')
    await capture('pausedFullDetail')
    await page.evaluate('window.__scene.setStaticDetail(true); new Promise(r => setTimeout(r, 1000))')
  }
  if (process.argv.includes('--compare-equipment-detail')) {
    await page.evaluate('window.__scene.setEquipmentDetail(false); new Promise(r => setTimeout(r, 1000))')
    await capture('pausedOutdoorDetail')
    await page.evaluate('window.__scene.setEquipmentDetail(true); new Promise(r => setTimeout(r, 1000))')
  }
  await capture('paused')
  if (process.argv.includes('--lod-only') && process.argv.includes('--compare-detail')) {
    await page.evaluate('window.__scene.setStaticDetail(false); new Promise(r => setTimeout(r, 1000))')
    await capture('pausedFullDetailRepeat')
    await page.evaluate('window.__scene.setStaticDetail(true); new Promise(r => setTimeout(r, 1000))')
    await capture('pausedRepeat')
    await page.evaluate("window.__scene.setGraphicsQuality('low'); new Promise(r => setTimeout(r, 1000))")
    await capture('pausedLowQuality')
    await page.evaluate("window.__scene.setGraphicsQuality('high'); new Promise(r => setTimeout(r, 1000))")
  }
  if (process.argv.includes('--lod-only') && process.argv.includes('--compare-equipment-detail')) {
    await page.evaluate('window.__scene.setEquipmentDetail(false); new Promise(r => setTimeout(r, 1000))')
    await capture('pausedOutdoorDetailRepeat')
    await page.evaluate('window.__scene.setEquipmentDetail(true); new Promise(r => setTimeout(r, 1000))')
    await capture('pausedRepeat')
  }
  await page.evaluate('window.__scene.setContinuousRendering(false); new Promise(r => setTimeout(r, 1000))')
  await capture('pausedIdle')
  await page.evaluate('window.__scene.setContinuousRendering(true)')
  if (!process.argv.includes('--lod-only')) {
  await page.evaluate('window.__metro.getState().setSpeed(16); window.__metro.getState().setPlaying(true)')
  // A fixed sim tick, not a wall-time warmup; fail if this host cannot get there.
  await waitFor(page.evaluate, 'window.__metro.getState().metrics.tick >= 180', { tries: 180, every: 500, what: '180 simulation ticks' })
  await capture('playing16x')
  await page.evaluate('window.__metro.getState().setPlaying(false)')
  await page.evaluate('new Promise(r => setTimeout(r, 1000))')
  if (compareBatching) {
    await page.evaluate('window.__scene.setStaticDetail(false)')
    // Same production build, population, camera and station on both sides. A
    // benchmark consist ensures rolling stock is exercised even between services.
    await page.evaluate(`(() => {
      const s = window.__metro.getState(), scene = window.__scene;
      const track = s.station.modules.find(m => m.type === 'track' && m.z === s.activeZ && m.w >= 60);
      if (!track) throw Error('comparison fixture needs a visible 60 m track');
      const yaw = (track.rot ?? 0) * Math.PI / 2, d = (track.d ?? 1) / 2;
      const x = track.x + 0.5 + Math.cos(yaw) * (track.w - 1) / 2 - Math.sin(yaw) * (d - 0.5);
      const y = track.y + 0.5 + Math.sin(yaw) * (track.w - 1) / 2 + Math.cos(yaw) * (d - 0.5);
      scene.trains.setTrains(new Float32Array([x, y, track.z + 0.5, 4, 1, 0, 0x336699, 1, yaw, 3]));
    })()`)
    await capture('batchingEnabledSameScene')
    await page.evaluate(`window.__scene.trains.setDrawBatching(false);
      window.__scene.modules.batches.enabled = false; window.__scene.modules.syncBatches()`)
    await page.evaluate('new Promise(r => setTimeout(r, 1000))')
    await capture('batchingDisabledSameScene')
    await page.evaluate(`window.__scene.trains.setDrawBatching(true);
      window.__scene.modules.batches.enabled = true; window.__scene.modules.syncBatches()`)
    await page.evaluate('new Promise(r => setTimeout(r, 1000))')
    await capture('batchingEnabledSameSceneRepeat')
  }
  if (investigate) {
    // Hold population, camera, train poses and geometry constant. These temporary
    // ablations isolate CPU updates from submitting hidden geometry; no sim rules change.
    await capture('populatedPaused')
    await page.evaluate(`window.__perf.crowdUpdate = window.__scene.crowd.renderAgents;
      window.__scene.crowd.renderAgents = () => {}`)
    await capture('crowdUpdatesDisabled')
    await page.evaluate(`(() => {
      const c = window.__scene.crowd, b = window.__perf;
      const attributes = [c.agents.instanceMatrix, c.blobs.instanceMatrix, c.agents.instanceColor,
        c.agents.geometry.getAttribute('passengerPose'), c.agents.geometry.getAttribute('passengerOutfit')];
      b.packed = { count: c.agents.count, attributes, arrays: attributes.map(a => a.array.slice()) };
      let drawn = 0;
      for (let i = 0; i < b.packed.count; i++) {
        const m = b.packed.arrays[0], o = i * 16;
        // Zero-scale instances still run the vertex shader. Submit only bodies
        // the existing storey policy drew; retain their original GPU attributes.
        if (m[o] === 0 && m[o + 1] === 0 && m[o + 2] === 0) continue;
        attributes.forEach((a, j) => a.array.set(b.packed.arrays[j].subarray(i * a.itemSize, (i + 1) * a.itemSize), drawn * a.itemSize));
        drawn++;
      }
      attributes.forEach(a => a.needsUpdate = true);
      c.agents.count = c.blobs.count = drawn;
    })()`)
    await capture('crowdPackedVisibleStoreys')
    await page.evaluate(`(() => {
      const p = window.__perf.packed, c = window.__scene.crowd;
      p.attributes.forEach((a, i) => { a.array.set(p.arrays[i]); a.needsUpdate = true; });
      c.agents.count = c.blobs.count = p.count;
      delete window.__perf.packed;
    })()`)
    await page.evaluate(`window.__scene.crowd.renderAgents = window.__perf.crowdUpdate;
      window.__scene.setAgentsVisible(false)`)
    await capture('crowdHidden')
    await page.evaluate('window.__scene.crowd.renderAgents = () => {}')
    await capture('crowdHiddenUpdatesDisabled')
    await page.evaluate(`window.__scene.crowd.renderAgents = window.__perf.crowdUpdate;
      window.__scene.setAgentsVisible(true);
      window.__scene.trains.trainGroup.visible = false`)
    await capture('trainsHidden')
    await page.evaluate('window.__scene.setAgentsVisible(false)')
    await capture('crowdAndTrainsHidden')
    await page.evaluate(`window.__scene.setAgentsVisible(true);
      window.__scene.trains.trainGroup.visible = true`)
    await capture('populatedPausedRepeat')
    await capture('pointerPicking', `
      const rect = scene.renderer.domElement.getBoundingClientRect();
      for (let i = 0; i < 120; i++) {
        const x = rect.left + rect.width * (0.2 + (i % 10) * 0.06);
        const y = rect.top + rect.height * (0.2 + (Math.floor(i / 10) % 10) * 0.06);
        let start = performance.now(); scene.pick(x, y, store.getState().activeZ);
        b.record('pointer.pickCell.ms', performance.now() - start);
        start = performance.now(); scene.pickModule(x, y);
        b.record('pointer.pickModule.ms', performance.now() - start);
        await new Promise(r => requestAnimationFrame(r));
      }
    `)
  }
  await capture('trainRearrival', `
    const original = scene.trains.lastBuffer.slice();
    const pose = new Float32Array([0, 0, store.getState().activeZ + 0.5, 4, 1, 0, 0x2277aa, 1, 0, 3]);
    for (let i = 0; i < ${edits}; i++) {
      for (let missed = 0; missed < 5; missed++) scene.trains.setTrains(new Float32Array());
      const start = performance.now();
      scene.trains.setTrains(pose);
      b.record(i ? 'trains.rearrival.ms' : 'trains.firstArrival.ms', performance.now() - start);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    scene.trains.setTrains(original);
  `)
  await capture('moveLiftCancel', `
    const module = store.getState().station.modules.find(m => m.type === 'bench');
    if (!module) throw Error('no movable bench');
    for (let i = 0; i < ${edits}; i++) {
      let start = performance.now();
      store.getState().liftModule(module.id);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      b.record('move.liftToFrame.ms', performance.now() - start);
      start = performance.now();
      store.getState().cancelMove(false);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      b.record('move.cancelToFrame.ms', performance.now() - start);
    }
  `)
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
  if (investigate) {
    await capture('wallPaintEdits', `
      const original = store.getState().station;
      const solid = new Set(original.cells.filter(c => c.fill === 'solid').map(c => [c.x, c.y, c.z].join(',')));
      const cell = original.cells.find(c => c.fill === 'solid' && c.tags?.includes('wall')
        && c.z > store.getState().activeZ && c.z < store.getState().activeZ + 4
        && !solid.has([c.x, c.y + 1, c.z].join(',')));
      if (!cell) throw Error('no exposed wall paint target');
      for (let i = 0; i < ${edits}; i++) {
        const cells = original.cells.map(c => c === cell
          ? { ...c, finish: { ...c.finish, n: i % 2 ? 'wall.plaster' : 'wall.enamel' } } : c);
        await b.commit({ ...original, cells });
      }
    `)
    await capture('bulk8x8Edits', `
      const original = store.getState().station;
      const maxX = Math.max(...original.cells.map(c => c.x));
      const patch = Array.from({ length: 64 }, (_, i) => ({
        x: maxX + 2 + i % 8, y: Math.floor(i / 8), z: store.getState().activeZ, fill: 'solid' }));
      for (let i = 0; i < ${edits}; i++) {
        await b.commit({ ...original, cells: i % 2 ? original.cells : [...original.cells, ...patch] });
      }
    `)
  }
  }
  if (profile) {
    const base = resolve(process.env.BENCH_OUTPUT ?? '.preview/perf/browser.json').replace(/\.json$/, '')
    mkdirSync(dirname(base), { recursive: true })
    console.log('Stopping CPU profiler…')
    const { profile: cpu } = await page.send('Profiler.stop')
    writeFileSync(base + '.cpuprofile', JSON.stringify(cpu))
    // Keep CPU sampling and timeline recording separate: both use V8 profiling
    // machinery. Replay real edits for the trace after exporting the CPU samples.
    await page.send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing', transferMode: 'ReturnAsStream' })
    await capture('traceStructuralEdits', `
      const original = store.getState().station;
      const maxX = Math.max(...original.cells.map(c => c.x));
      const block = { x: maxX + 2, y: 0, z: store.getState().activeZ, fill: 'solid' };
      for (let i = 0; i < ${edits}; i++) {
        await b.commit({ ...original, cells: i % 2 ? original.cells : [...original.cells, block] });
      }
    `)
    console.log('Stopping Chrome trace…')
    const completed = page.waitForEvent('Tracing.tracingComplete')
    completed.catch(() => {})
    await page.send('Tracing.end')
    const { stream } = await completed
    console.log('Reading Chrome trace…')
    const chunks = []
    try {
      for (;;) {
        const chunk = await page.send('IO.read', { handle: stream })
        chunks.push(chunk.base64Encoded ? Buffer.from(chunk.data, 'base64') : Buffer.from(chunk.data))
        if (chunk.eof) break
      }
    } finally { await page.send('IO.close', { handle: stream }).catch(() => {}) }
    writeFileSync(base + '.trace.json', Buffer.concat(chunks))
    console.log('Profiles: ' + base + '.cpuprofile, ' + base + '.trace.json')
  }
  const environment = await page.evaluate(`(() => {
    const gl = window.__scene.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { userAgent: navigator.userAgent, gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      width: innerWidth, height: innerHeight, dpr: devicePixelRatio, pixelRatio: window.__scene.renderer.getPixelRatio(),
      station: { name: window.__metro.getState().station.name, nameEn: window.__metro.getState().station.nameEn,
        cells: window.__metro.getState().station.cells.length, modules: window.__metro.getState().station.modules.length },
      gpuTimer: window.__perf.gpuTimer ?? 'disabled', multiDraw: !!gl.getExtension('WEBGL_multi_draw'), activeZ: window.__metro.getState().activeZ };
  })()`)
  const report = { kind: 'production-browser', timestamp: new Date().toISOString(), environment,
    config: { duration, edits, softwareGpu, investigate, profile, gpuTimer, compareBatching,
      compareDetail: process.argv.includes('--compare-detail'), compareEquipmentDetail: process.argv.includes('--compare-equipment-detail'), distantView: process.argv.includes('--distant-view'), lodOnly: process.argv.includes('--lod-only'), continuousThroughput: true }, startup, phases }
  report.errors = await page.evaluate('window.__perf.errors')
  const output = resolve(process.env.BENCH_OUTPUT ?? '.preview/perf/browser.json')
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, JSON.stringify(report, null, 2))
  if (process.argv.includes('--screenshot')) {
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(output.replace(/\.json$/, '.png'), Buffer.from(data, 'base64'))
  }
  console.log(`Report: ${output}`)
  if (report.errors.length) throw Error('browser errors: ' + report.errors.join('; '))
} finally {
  await page?.close()
  server.close()
}
