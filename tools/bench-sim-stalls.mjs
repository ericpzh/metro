// Attribute simulation-play frame tails to actual production renderer work.
// BENCH_PROFILE=1 collects a separate CPU profile; keep clean timing runs separate.
import { execFile } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { cpus } from 'node:os'
import { promisify } from 'node:util'
import { configureBenchmarkView, serveDir, withPage, waitFor, loadExampleStation } from './browser-harness.mjs'

const execFileAsync = promisify(execFile)

async function sampleProcessTreeMemory(rootPid) {
  if (!rootPid) return null
  try {
    if (process.platform === 'win32') {
      const ps = `$root=${rootPid}; $all=Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" | Select-Object ProcessId,ParentProcessId,WorkingSetSize,PageFileUsage; $seen=New-Object 'System.Collections.Generic.HashSet[int]'; [void]$seen.Add($root); $changed=$true; while($changed){ $changed=$false; foreach($p in $all){ if($seen.Contains([int]$p.ParentProcessId) -and $seen.Add([int]$p.ProcessId)){ $changed=$true } } }; $ws=0L; $priv=0L; $n=0; foreach($p in $all){ if($seen.Contains([int]$p.ProcessId)){ $ws+=[int64]$p.WorkingSetSize; $priv+=[int64]$p.PageFileUsage*1024L; $n++ } }; "$n,$ws,$priv"`
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', ps], { timeout: 5000 })
      const parts = stdout.trim().split(',').map(Number)
      if (parts.length === 3 && parts.every(Number.isFinite)) {
        return { processCount: parts[0], workingSetBytes: parts[1], privateBytes: parts[2] }
      }
    }
  } catch { /* optional on unsupported platforms or during teardown */ }
  return null
}

const demo = process.env.BENCH_DEMO ?? 'tanwei'
const mode = process.env.BENCH_MODE ?? 'explode'
const quality = process.env.BENCH_QUALITY ?? 'low'
const seconds = Number(process.env.BENCH_SECONDS ?? 20)
const speed = Number(process.env.BENCH_SPEED ?? 16)
const pixelRatio = Number(process.env.BENCH_PIXEL_RATIO ?? 1)
const canvasSize = process.env.BENCH_CANVAS_SIZE?.split(',').map(Number)
if (canvasSize && (canvasSize.length !== 2 || canvasSize.some(value => !Number.isFinite(value) || value < 1))) throw new Error('Invalid canvas size')
const profile = process.env.BENCH_PROFILE === '1'
const trace = process.env.BENCH_TRACE === '1'
const ablation = process.env.BENCH_ABLATE ?? ''
if (!['zoo','tanwei','tianhe'].includes(demo) || !['regular','explode'].includes(mode) || !['low','high'].includes(quality) ||
    ![1,4,16,64].includes(speed) || !Number.isFinite(seconds) || seconds < 1 || !Number.isFinite(pixelRatio) || pixelRatio <= 0 || pixelRatio > 2) throw new Error('Invalid playback benchmark configuration')
if (profile && trace) throw new Error('Collect CPU profiles and traces in separate runs')
const output = resolve(process.env.BENCH_OUTPUT ?? `.preview/perf/sim-stalls/${demo}-${mode}-${quality}.json`)
mkdirSync(dirname(output), { recursive: true })
const server = await serveDir(resolve(process.env.BENCH_DIST ?? 'game/dist'), 0)
let page
let memTimer = null
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
  const viewSetup = await configureBenchmarkView(page, demo, mode)
  const stationOpeningMs = await page.evaluate('performance.now()-window.__fixtureOpeningStart')
  let structureReadyMs = stationOpeningMs
  if (mode === 'explode') {
    await page.evaluate('window.__explodeOpenStart = performance.now(); window.__metro.getState().setExplodedView(true)')
    await waitFor(page.evaluate, 'document.querySelector(".explodedViewer")?.dataset.ready === "true"',
      { tries: 240, every: 250, what: 'exploded view' })
    structureReadyMs = await page.evaluate('performance.now()-window.__explodeOpenStart')
  }
  if (pixelRatio !== 1) await page.evaluate(`(() => {
    const scene = ${mode === 'explode' ? 'window.__explodedScene' : 'window.__scene'};
    const renderer = scene.renderer;
    renderer.setPixelRatio(${pixelRatio});
    renderer.setSize(renderer.domElement.clientWidth, renderer.domElement.clientHeight, false);
  })()`)
  if (canvasSize) await page.evaluate(`(() => {
    const scene = ${mode === 'explode' ? 'window.__explodedScene' : 'window.__scene'};
    scene.resize(${canvasSize[0]}, ${canvasSize[1]});
  })()`)
  if (profile) { await page.send('Profiler.enable'); await page.send('Profiler.setSamplingInterval', { interval: 1000 }); await page.send('Profiler.start') }
  if (trace) await page.send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline.frame'+(process.env.BENCH_TRACE_GPU === '1' ? ',gpu,cc' : ''), transferMode:'ReturnAsStream' })

  const procSamples = []
  let samplingMem = false
  const pollProcessMem = async () => {
    if (samplingMem) return
    samplingMem = true
    try {
      const s = await sampleProcessTreeMemory(page.chromePid)
      if (s) procSamples.push(s)
    } finally { samplingMem = false }
  }
  await pollProcessMem()
  memTimer = setInterval(() => { void pollProcessMem() }, 2500)

  const raw = await page.evaluate(`(async () => {
    const events = [], frames = [], rafFrames = [], snapshots = [], errors = [], checkpoints = [];
    const measuredScene = ${mode === 'explode' ? 'window.__explodedScene' : 'window.__scene'};
    if (${JSON.stringify(ablation)} === 'plates') measuredScene.plates.setSimClock = () => {};
    if (${JSON.stringify(ablation)} === 'atlas') measuredScene.modules.batches.atlas.update = () => {};
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
        const versions = key === 'setSimClock' ? new Map([...this.tvPlates].map(([id, texture]) => [id, texture.version])) : null;
        try { return original.apply(this, args); }
        finally { const duration = performance.now()-at;
          const repainted = versions ? [...this.tvPlates].filter(([id, texture]) => texture.version !== versions.get(id)).length : 0;
          if (duration >= 2 || repainted || key === 'setTrains' || key === 'createEntry') record(name, at, duration,
            key === 'setTrains' ? { groupsBefore: groups, groupsAfter: this.trainGroup?.children.length, poses: args[0].length/10 } :
            versions ? { repainted, clock: this.ctx.clockText } : {});
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
    const initialPub = window.__metroPublication ? { ...window.__metroPublication } : null;
    const initial = { ...metrics() };
    const checkpointTargets = [160, 320, 460].map(offset => initial.tick + offset);
    let nextCheckpoint = 0;
    let lastTick = -1;
    const unsubscribe = window.__metro.subscribe(state => {
      const m = state.metrics;
      if (!m || m.tick === lastTick) return;
      lastTick = m.tick;
      const pub = window.__metroPublication;
      snapshots.push({
        at: performance.now()-start,
        tick: m.tick,
        simTime: m.simTime,
        population: m.population,
        tickMs: m.tickMs,
        trainArrivals: m.trainArrivals,
        workerCompletedTicks: pub?.workerCompletedTicks ?? null,
        workerTimerMisses: pub?.workerTimerMisses ?? null,
        deliveryLagMs: pub?.deliveryLagMs ?? null,
      });
      while (nextCheckpoint < checkpointTargets.length && m.tick >= checkpointTargets[nextCheckpoint]) {
        const cam = measuredScene.cameraSys?.activeCamera?.() ?? measuredScene.camera;
        checkpoints.push({
          targetTick: checkpointTargets[nextCheckpoint],
          tick: m.tick,
          population: m.population,
          trainArrivals: m.trainArrivals,
          agentCount: measuredScene.crowd.agentCount,
          trainGroups: measuredScene.trains.trainGroup.children.length,
          draws: measuredScene.renderer.info.render.calls,
          cameraPosition: cam?.position?.toArray?.() ?? null,
          cameraTarget: measuredScene.controls?.target?.toArray?.() ?? null,
        });
        nextCheckpoint++;
      }
    });
    let equipmentReadyAt = (${mode === 'explode' ? 'document.querySelector(".explodedViewer")?.dataset.equipped === "true"' : 'measuredScene.isStationReady?.() !== false'}) ? 0 : null;
    let peakJsHeapBytes = performance.memory?.usedJSHeapSize ?? 0;
    let sampleStep = 0;
    window.__metro.getState().setPlaying(true);
    await new Promise(resolve => {
      let previous = performance.now(), previousRaf = previous, submissions = measuredScene.framesRendered;
      const sample = () => {
        const now = performance.now();
        rafFrames.push({ at: now-start, interval: now-previousRaf }); previousRaf = now;
        if (equipmentReadyAt === null) {
          const ready = ${mode === 'explode' ? 'document.querySelector(".explodedViewer")?.dataset.equipped === "true"' : 'measuredScene.isStationReady?.() !== false'};
          if (ready) equipmentReadyAt = now - start;
        }
        if ((++sampleStep & 31) === 0 && performance.memory?.usedJSHeapSize) {
          if (performance.memory.usedJSHeapSize > peakJsHeapBytes) peakJsHeapBytes = performance.memory.usedJSHeapSize;
        }
        if (measuredScene.framesRendered !== submissions) {
          const deliveredTick = metrics()?.tick ?? -1;
          const renderedTick = typeof measuredScene.lastRenderedTick === 'number' && measuredScene.lastRenderedTick >= 0
            ? measuredScene.lastRenderedTick
            : deliveredTick;
          const renderLagMs = typeof measuredScene.lastRenderedLagMs === 'number' ? measuredScene.lastRenderedLagMs : null;
          frames.push({
            at: now-start,
            interval: now-previous,
            tick: renderedTick,
            deliveredTick,
            renderLagMs,
          });
          previous = now; submissions = measuredScene.framesRendered;
        }
        if (now-start >= ${seconds*1000}) resolve(); else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    if (performance.memory?.usedJSHeapSize && performance.memory.usedJSHeapSize > peakJsHeapBytes) {
      peakJsHeapBytes = performance.memory.usedJSHeapSize;
    }
    const finalPub = window.__metroPublication ? { ...window.__metroPublication } : null;
    window.__metro.getState().setPlaying(false);
    unsubscribe(); observer.disconnect();
    const scene = ${mode === 'explode' ? 'window.__explodedScene' : 'window.__scene'};
    const gl = scene.renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
    const countObjects = (root, predicate) => {
      let count = 0; root.traverseVisible(object => { if (predicate(object)) count++ }); return count;
    };
    return { initial, final: metrics(), initialPub, finalPub, frames, rafFrames, events, snapshots, checkpoints, errors, preparation: window.__trainPreparation,
      equipmentReadyAt, peakJsHeapBytes,
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
      draws: scene.renderer.info.render.calls, triangles: scene.renderer.info.render.triangles,
      passengerMaterials: [scene.crowd.agents,scene.crowd.agentsLow].map(mesh=>({opacity:mesh.material.opacity,transparent:mesh.material.transparent,depthWrite:mesh.material.depthWrite,count:mesh.count})) };
  })()`)
  if (memTimer) { clearInterval(memTimer); memTimer = null }
  await pollProcessMem()
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
  let cdpMemory = null
  try {
    await page.send('Performance.enable')
    const { metrics: perfMetrics } = await page.send('Performance.getMetrics')
    const byName = Object.fromEntries((perfMetrics ?? []).map(m => [m.name, m.value]))
    cdpMemory = { jsHeapUsedBytes: byName.JSHeapUsedSize ?? null, jsHeapTotalBytes: byName.JSHeapTotalSize ?? null, domNodes: byName.Nodes ?? null }
  } catch { /* optional */ }
  const processMemory = procSamples.length ? {
    peakWorkingSetBytes: Math.max(...procSamples.map(s => s.workingSetBytes)),
    peakPrivateBytes: Math.max(...procSamples.map(s => s.privateBytes)),
    finalWorkingSetBytes: procSamples.at(-1).workingSetBytes,
    finalPrivateBytes: procSamples.at(-1).privateBytes,
    processCount: procSamples.at(-1).processCount,
    samples: procSamples.length,
  } : null
  if (!raw.frames.length || raw.final.tick <= raw.initial.tick) throw new Error('Playback produced no submitted frames or simulation progress')
  const summarizeIntervals = (list) => {
    const sortedAsc = list.map(frame => frame.interval).sort((a,b) => a-b)
    const sortedDesc = [...sortedAsc].reverse()
    const tail = sortedDesc.slice(0, Math.max(1, Math.ceil(sortedDesc.length*.01)))
    const pct = p => sortedAsc[Math.min(sortedAsc.length - 1, Math.floor((sortedAsc.length - 1) * p))]
    return {
      fps: sortedDesc.length*1000/sortedDesc.reduce((a,b)=>a+b,0),
      onePercentLowFps: 1000/(tail.reduce((a,b)=>a+b,0)/tail.length),
      p50Ms: pct(0.5), p95Ms: pct(0.95), p99Ms: pct(0.99),
      worstMs: sortedDesc[0],
      over100ms: sortedDesc.filter(value=>value>100).length,
    }
  }
  const summarizeNumbers = (nums) => {
    if (!nums.length) return null
    const asc = [...nums].sort((a, b) => a - b)
    const pct = p => asc[Math.min(asc.length - 1, Math.floor((asc.length - 1) * p))]
    return {
      p50: pct(0.5),
      p95: pct(0.95),
      max: asc.at(-1),
      avg: asc.reduce((a, b) => a + b, 0) / asc.length,
    }
  }
  const stats = summarizeIntervals(raw.frames)
  const rafStats = summarizeIntervals(raw.rafFrames)
  const expectedIntervalMs = Math.max(4, 1000 / speed)
  const snapGaps = []
  for (let i = 1; i < raw.snapshots.length; i++) snapGaps.push(raw.snapshots[i].at - raw.snapshots[i - 1].at)
  const windowSec = raw.rafFrames.length ? raw.rafFrames.at(-1).at / 1000 : seconds
  const sourceCompletedTicks = raw.finalPub && raw.initialPub
    ? raw.finalPub.workerCompletedTicks - raw.initialPub.workerCompletedTicks
    : raw.final.tick - raw.initial.tick
  const sourceTimerMisses = raw.finalPub && raw.initialPub
    ? raw.finalPub.workerTimerMisses - raw.initialPub.workerTimerMisses
    : null
  const deliveryLags = raw.snapshots.map(s => s.deliveryLagMs).filter(v => typeof v === 'number')
  const renderLags = raw.frames.map(f => f.renderLagMs).filter(v => typeof v === 'number')
  const tickLags = raw.frames
    .filter(f => typeof f.deliveredTick === 'number' && typeof f.tick === 'number' && f.tick >= 0)
    .map(f => Math.max(0, f.deliveredTick - f.tick))
  const publication = {
    windowSec,
    expectedTicks: windowSec * speed,
    workerCompletedTicks: sourceCompletedTicks,
    workerTimerMisses: sourceTimerMisses,
    deliveredSnapshots: raw.snapshots.length,
    deliveredTickRange: raw.snapshots.length ? [raw.snapshots[0].tick, raw.snapshots.at(-1).tick] : null,
    uniqueRenderedTicks: new Set(raw.frames.map(f => f.tick).filter(t => t >= 0)).size,
    submittedTickRange: raw.frames.length ? [raw.frames[0].tick, raw.frames.at(-1).tick] : null,
    consumerGapMisses: snapGaps.filter(g => g > expectedIntervalMs * 1.5).length,
    timerMisses: sourceTimerMisses ?? snapGaps.filter(g => g > expectedIntervalMs * 1.5).length,
    maxSnapshotGapMs: snapGaps.length ? Math.max(...snapGaps) : 0,
    avgSnapshotGapMs: snapGaps.length ? snapGaps.reduce((a, b) => a + b, 0) / snapGaps.length : 0,
    deliveryLagMs: summarizeNumbers(deliveryLags),
    renderLagMs: summarizeNumbers(renderLags),
    maxTickLag: tickLags.length ? Math.max(...tickLags) : 0,
  }
  const equipmentReadyMs = raw.equipmentReadyAt !== null ? structureReadyMs + raw.equipmentReadyAt : null
  const sorted = raw.frames.map(frame => frame.interval).sort((a,b) => b-a)
  const tail = sorted.slice(0, Math.max(1, Math.ceil(sorted.length*.01)))
  const slowFrames = raw.frames.filter(frame => frame.interval >= tail.at(-1)).map(frame => ({ ...frame,
    work: raw.events.filter(event => event.kind !== 'longtask' && event.at < frame.at && event.at+event.duration > frame.at-frame.interval)
      .sort((a,b)=>b.duration-a.duration).slice(0,5) }))
  writeFileSync(output, JSON.stringify({ demo, mode, quality, speed, seconds, pixelRatio, canvasSize, profile, trace, ablation, viewSetup,
    cpu:cpus()[0]?.model, build:resolve(process.env.BENCH_DIST ?? 'game/dist'), stationOpeningMs, structureReadyMs, equipmentReadyMs,
    cdpMemory, processMemory, stats, rafStats, publication, slowFrames, ...raw }, null, 2))
  console.log(JSON.stringify({ output, stats, rafStats, publication, structureReadyMs, equipmentReadyMs, peakJsHeapBytes: raw.peakJsHeapBytes, cdpMemory, processMemory }, null, 2))
  if (raw.errors.length || raw.glError) throw new Error('Playback captured a runtime or GL error')
  if (process.env.BENCH_ASSERT_PREPARED === '1' && raw.events.some(event => event.kind.endsWith('.createEntry'))) {
    throw new Error('Playback built a train instead of using its prepared model')
  }
} finally { if (memTimer) clearInterval(memTimer); await page?.close(); server.close() }
