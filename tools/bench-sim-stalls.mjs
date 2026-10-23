// Attribute simulation-play frame tails to actual production renderer work.
// BENCH_PROFILE=1 collects a separate CPU profile; keep clean timing runs separate.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { cpus } from 'node:os'
import { serveDir, withPage, waitFor, loadExampleStation } from './browser-harness.mjs'

const demo = process.env.BENCH_DEMO ?? 'tanwei'
const mode = process.env.BENCH_MODE ?? 'explode'
const quality = process.env.BENCH_QUALITY ?? 'low'
const seconds = Number(process.env.BENCH_SECONDS ?? 20)
const speed = Number(process.env.BENCH_SPEED ?? 16)
const pixelRatio = Number(process.env.BENCH_PIXEL_RATIO ?? 1)
const profile = process.env.BENCH_PROFILE === '1'
const trace = process.env.BENCH_TRACE === '1'
const ablation = process.env.BENCH_ABLATE ?? ''
if (!['zoo','tanwei'].includes(demo) || !['regular','explode'].includes(mode) || !['low','high'].includes(quality) ||
    ![1,4,16,64].includes(speed) || !Number.isFinite(seconds) || seconds < 1 || !Number.isFinite(pixelRatio) || pixelRatio <= 0 || pixelRatio > 2) throw new Error('Invalid playback benchmark configuration')
if (profile && trace) throw new Error('Collect CPU profiles and traces in separate runs')
const output = resolve(process.env.BENCH_OUTPUT ?? `.preview/perf/sim-stalls/${demo}-${mode}-${quality}.json`)
mkdirSync(dirname(output), { recursive: true })
const server = await serveDir(resolve(process.env.BENCH_DIST ?? 'game/dist'), 0)
let page
try {
  page = await withPage({ url: `http://127.0.0.1:${server.address().port}/`,
    profile: resolve('.preview/perf/sim-stalls', `chrome-${process.pid}`),
    debugPort: 9600 + process.pid % 200, windowSize: '1400,900', softwareGpu: false })
  await waitFor(page.evaluate, '!!window.__scene && !!window.__metro', { what: 'game shell' })
  await page.evaluate(`(() => {
    const state = window.__metro.getState();
    state.setPlaying(false); state.setSpeed(${speed}); state.setGraphicsQuality('${quality}');
    const proto = window.__scene.constructor.prototype;
    const setup = proto.setStandalonePresentation;
    proto.setStandalonePresentation = function (...args) { window.__explodedScene = this; return setup.apply(this, args); };
    window.__trainPreparation = [];
    const trains = window.__scene.trains.constructor.prototype, prepare = trains.prepareForStation;
    if (prepare) trains.prepareForStation = function (...args) {
      const at = performance.now();
      const result = prepare.apply(this,args);
      window.__trainPreparation.push({ renderer: this === window.__scene.trains ? 'editor' : 'explode',
        duration: performance.now()-at, groups: this.trainGroup.children.length });
      return result;
    };
    window.__fixtureOpeningStart = performance.now();
  })()`)
  await loadExampleStation(page, demo)
  const stationOpeningMs = await page.evaluate('performance.now()-window.__fixtureOpeningStart')
  if (mode === 'explode') {
    await page.evaluate('window.__metro.getState().setExplodedView(true)')
    await waitFor(page.evaluate, 'document.querySelector(".explodedViewer")?.dataset.ready === "true"',
      { tries: 240, every: 250, what: 'exploded view' })
  }
  if (pixelRatio !== 1) await page.evaluate(`(() => {
    const scene = ${mode === 'explode' ? 'window.__explodedScene' : 'window.__scene'};
    const renderer = scene.renderer;
    renderer.setPixelRatio(${pixelRatio});
    renderer.setSize(renderer.domElement.clientWidth, renderer.domElement.clientHeight, false);
  })()`)
  if (profile) { await page.send('Profiler.enable'); await page.send('Profiler.setSamplingInterval', { interval: 1000 }); await page.send('Profiler.start') }
  if (trace) await page.send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline.frame'+(process.env.BENCH_TRACE_GPU === '1' ? ',gpu,cc' : ''), transferMode:'ReturnAsStream' })
  const raw = await page.evaluate(`(async () => {
    const events = [], frames = [], rafFrames = [], snapshots = [], errors = [];
    const measuredScene = ${mode === 'explode' ? 'window.__explodedScene' : 'window.__scene'};
    if (${JSON.stringify(ablation)} === 'render') measuredScene.renderer.render = () => {};
    if (${JSON.stringify(ablation)} === 'crowd') {
      measuredScene.crowd.agents.removeFromParent(); measuredScene.crowd.agentsLow.removeFromParent(); measuredScene.crowd.blobs.removeFromParent();
    }
    if (${JSON.stringify(ablation)} === 'station' || ${JSON.stringify(ablation)} === 'chunks') {
      for (const mesh of measuredScene.chunks.chunkMeshes) mesh.removeFromParent();
    }
    if (${JSON.stringify(ablation)} === 'station' || ${JSON.stringify(ablation)} === 'modules') {
      measuredScene.modules.moduleMeshes.removeFromParent(); measuredScene.modules.batches.root.removeFromParent();
    }
    const start = performance.now();
    performance.mark('sim-play-start');
    const metrics = () => window.__metro.getState().metrics;
    const record = (kind, at, duration, extra = {}) => events.push({ kind, at: at-start, duration, tick: metrics()?.tick, ...extra });
    const wrap = (object, key, name) => {
      if (!object || typeof object[key] !== 'function') return;
      const original = object[key];
      object[key] = function (...args) {
        const at = performance.now(), groups = this.trainGroup?.children.length;
        try { return original.apply(this, args); }
        finally { const duration = performance.now()-at;
          if (duration >= 2 || key === 'setTrains' || key === 'createEntry') record(name, at, duration,
            key === 'setTrains' ? { groupsBefore: groups, groupsAfter: this.trainGroup?.children.length, poses: args[0].length/10 } : {});
        }
      };
    };
    for (const [name, scene] of [['editor', window.__scene], ['explode', window.__explodedScene]]) {
      if (!scene) continue;
      wrap(scene, 'animate', name+'.animate');
      for (const key of ['setTrains', 'createEntry', 'updateTrains', 'updateGeometryDetail']) wrap(scene.trains, key, name+'.trains.'+key);
      for (const key of ['setSimClock', 'updateAdScreens']) wrap(scene.plates, key, name+'.plates.'+key);
      for (const key of ['setAgents', 'renderAgents']) wrap(scene.crowd, key, name+'.crowd.'+key);
      wrap(scene.modules.batches.atlas, 'update', name+'.atlas.update');
      wrap(scene.modules.batches, 'updateDetail', name+'.batches.updateDetail');
      wrap(scene.modules.batches, 'withHiddenSources', name+'.renderFrame');
      wrap(scene.roads, 'update', name+'.roads.update');
    }
    window.addEventListener('error', event => errors.push(event.message));
    window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
    const originalConsoleError = console.error;
    console.error = (...args) => { errors.push(args.map(String).join(' ')); originalConsoleError.apply(console,args); };
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) record('longtask', entry.startTime, entry.duration);
    });
    observer.observe({ type: 'longtask', buffered: false });
    let lastTick = -1;
    const unsubscribe = window.__metro.subscribe(state => {
      const m = state.metrics;
      if (!m || m.tick === lastTick) return;
      lastTick = m.tick; snapshots.push({ at: performance.now()-start, tick: m.tick, simTime: m.simTime, population: m.population, tickMs: m.tickMs });
    });
    const initial = { ...metrics() };
    window.__metro.getState().setPlaying(true);
    await new Promise(resolve => {
      let previous = performance.now(), previousRaf = previous, submissions = measuredScene.framesRendered;
      const sample = () => {
        const now = performance.now();
        rafFrames.push({ at: now-start, interval: now-previousRaf }); previousRaf = now;
        if (measuredScene.framesRendered !== submissions) {
          frames.push({ at: now-start, interval: now-previous, tick: metrics()?.tick });
          previous = now; submissions = measuredScene.framesRendered;
        }
        if (now-start >= ${seconds*1000}) resolve(); else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    window.__metro.getState().setPlaying(false);
    unsubscribe(); observer.disconnect();
    const scene = ${mode === 'explode' ? 'window.__explodedScene' : 'window.__scene'};
    const gl = scene.renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
    const countObjects = (root, predicate) => {
      let count = 0; root.traverseVisible(object => { if (predicate(object)) count++ }); return count;
    };
    return { initial, final: metrics(), frames, rafFrames, events, snapshots, errors, preparation: window.__trainPreparation,
      environment: { browser: navigator.userAgent, gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        cells: window.__metro.getState().station.cells.length, modules: window.__metro.getState().station.modules.length,
        seed: window.__metro.getState().station.seed },
      glError: gl.getError(),
      canvas: { width: scene.renderer.domElement.width, height: scene.renderer.domElement.height },
      inventory: { chunks: scene.chunks.chunkMeshes.length, moduleRoots: scene.modules.moduleMeshes.children.length,
        batchRoots: scene.modules.batches.root.children.length, visibleMeshes: countObjects(scene.ctx.scene, object => object.isMesh),
        visibleObjects: countObjects(scene.ctx.scene, () => true), trainGroups: scene.trains.trainGroup.children.length,
        contactShadows: scene.modules.moduleMeshes.children.filter(root => root.userData.contactBlobKey !== undefined)
          .map(root => ({ level: root.userData.levelZs[0], visible: root.visible, count: root.count })),
        passengerShadows: scene.crowd.blobs.count },
      draws: scene.renderer.info.render.calls, triangles: scene.renderer.info.render.triangles };
  })()`)
  if (profile) {
    const { profile: cpu } = await page.send('Profiler.stop')
    writeFileSync(output.replace(/\.json$/, '.cpuprofile'), JSON.stringify(cpu))
  }
  if (trace) {
    const completed = page.waitForEvent('Tracing.tracingComplete')
    await page.send('Tracing.end')
    const { stream } = await completed
    let data = ''
    for (;;) { const chunk = await page.send('IO.read',{handle:stream,size:65536}); data += chunk.base64Encoded ? Buffer.from(chunk.data,'base64').toString() : chunk.data; if(chunk.eof) break }
    await page.send('IO.close',{handle:stream})
    writeFileSync(output.replace(/\.json$/,'.trace.json'),data)
  }
  if (!raw.frames.length || raw.final.tick <= raw.initial.tick) throw new Error('Playback produced no submitted frames or simulation progress')
  const sorted = raw.frames.map(frame => frame.interval).sort((a,b) => b-a)
  const tail = sorted.slice(0, Math.max(1, Math.ceil(sorted.length*.01)))
  const stats = { fps: sorted.length*1000/sorted.reduce((a,b)=>a+b,0),
    onePercentLowFps: 1000/(tail.reduce((a,b)=>a+b,0)/tail.length), worstMs: sorted[0],
    over100ms: sorted.filter(value=>value>100).length }
  const slowFrames = raw.frames.filter(frame => frame.interval >= tail.at(-1)).map(frame => ({ ...frame,
    work: raw.events.filter(event => event.kind !== 'longtask' && event.at < frame.at && event.at+event.duration > frame.at-frame.interval)
      .sort((a,b)=>b.duration-a.duration).slice(0,5) }))
  writeFileSync(output, JSON.stringify({ demo, mode, quality, speed, seconds, pixelRatio, profile, trace, ablation,
    cpu:cpus()[0]?.model, build:resolve(process.env.BENCH_DIST ?? 'game/dist'), stationOpeningMs, stats, slowFrames, ...raw }, null, 2))
  console.log(JSON.stringify({ output, stats, slowFrames }, null, 2))
  if (raw.errors.length || raw.glError) throw new Error('Playback captured a runtime or GL error')
  if (process.env.BENCH_ASSERT_PREPARED === '1' && raw.events.some(event => event.kind.endsWith('.createEntry'))) {
    throw new Error('Playback built a train instead of using its prepared model')
  }
} finally { await page?.close(); server.close() }
