// Opening each shipped demo, and its exploded view: staged times and memory.
//
// The measured workflows are the two the performance reference reports per demo:
//   1. save    — open the demo's station document into the live editor, from the
//                `loadReference` call (what an example-station card runs once its
//                loading shell has painted) to the first frame that draws it.
//   2. explode — open 爆炸视图 from that station, to the structural frame
//                (`data-ready`) and to the last equipment batch (`data-equipped`).
//
// Timing boundary: API-to-first-renderer-submission. It excludes compositor
// presentation, display and pointer dispatch. Memory is reported twice over:
// CDP's JS heap at each milestone (immediate, no forced GC) and the OS working
// sets of the Chrome processes that belong to this run's temporary profile,
// sampled once a second by a PowerShell child. Working sets include shared pages
// and a GPU process working set is not dedicated VRAM, so read them as
// approximate. Milestones the page holds still for are averaged over the hold;
// structure-ready is a single nearest sample because equipment keeps building.
//
//   node tools/bench-demo-load.mjs            # all three demos
//   BENCH_DEMOS=zoo node tools/bench-demo-load.mjs
//   BENCH_PROFILE=1 ...                       # separate run: writes CPU profiles
//
// Run after `npm --prefix game run build`, with no concurrent build, test or
// profiler: browser timings are diagnostics, not CI assertions.
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus, platform } from 'node:os'
import { resolve } from 'node:path'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'

const demos = (process.env.BENCH_DEMOS ?? 'zoo,tanwei,tianhe').split(',').map((id) => id.trim()).filter(Boolean)
const quality = process.env.BENCH_QUALITY ?? 'high'
const profileStages = process.env.BENCH_PROFILE === '1'
const ablations = (process.env.BENCH_ABLATE ?? '').split(',').map((name) => name.trim()).filter(Boolean)
const output = resolve(process.env.BENCH_OUTPUT ?? '.preview/perf/demo-load')
const windowSize = process.env.BENCH_SIZE ?? '1400,900'
const sampleMemory = process.env.BENCH_SAMPLE !== '0' && platform() === 'win32'
if (!demos.length || demos.some((id) => !['zoo', 'tanwei', 'tianhe'].includes(id))) throw new Error('BENCH_DEMOS must list zoo, tanwei and/or tianhe')
if (!['low', 'high'].includes(quality)) throw new Error('BENCH_QUALITY must be low or high')
if (ablations.some((name) => !['trains', 'buildViews'].includes(name))) throw new Error('BENCH_ABLATE accepts trains or buildViews')
mkdirSync(resolve(output, 'chrome'), { recursive: true })

// ---- OS memory sampler -------------------------------------------------------
// One PowerShell child, one tick per second: the Chrome processes whose
// `--user-data-dir` sits under this run's profile root, with their current
// working set. Ticks and samples are line-oriented so no JSON shape can collapse.
const SAMPLER = `
$root = $env:BENCH_PROFILE_ROOT
while ($true) {
  $tick = (Get-Date).ToUniversalTime().ToString('o')
  # Two bulk calls per tick: Get-Process for the bytes, one CIM query for the
  # command lines that name this run's profile. Per-process lookups made a tick
  # take nearly two seconds.
  $byId = @{}
  foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'")) { $byId[[int]$process.ProcessId] = $process }
  Write-Output ("TICK " + $tick)
  foreach ($sample in @(Get-Process chrome -ErrorAction SilentlyContinue)) {
    $process = $byId[[int]$sample.Id]
    if (-not $process -or $process.CommandLine -notlike ('*' + $root + '*')) { continue }
    $kind = 'browser'
    if ($process.CommandLine -match '--type=([^ ]+)') { $kind = $Matches[1] }
    $demo = ''
    if ($process.CommandLine -match 'chrome[\\\\/]+([a-z]+)-\\d+') { $demo = $Matches[1] }
    Write-Output ('{"pid":' + $sample.Id + ',"kind":"' + $kind + '","demo":"' + $demo + '","workingSet":' + $sample.WorkingSet64 + ',"privateBytes":' + $sample.PrivateMemorySize64 + '}')
  }
  Start-Sleep -Seconds 1
}
`
const ticks = []
let sampler = null
if (sampleMemory) {
  sampler = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', SAMPLER], {
    env: { ...process.env, BENCH_PROFILE_ROOT: resolve(output, 'chrome') },
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  let buffered = ''
  let current = null
  sampler.stdout.on('data', (chunk) => {
    buffered += chunk.toString()
    for (let index = buffered.indexOf('\n'); index >= 0; index = buffered.indexOf('\n')) {
      const line = buffered.slice(0, index).trim()
      buffered = buffered.slice(index + 1)
      if (line.startsWith('TICK ')) {
        current = { at: Date.parse(line.slice(5)), rows: [] }
        ticks.push(current)
      } else if (line.startsWith('{') && current) {
        try { current.rows.push(JSON.parse(line)) } catch { /* a torn line: skip */ }
      }
    }
  })
}

/** Average working set per process kind over the tick rows in a window. */
function memoryIn(fromMs, toMs) {
  const selected = ticks.filter((tick) => tick.at >= fromMs && tick.at <= toMs && tick.rows.length)
  if (!selected.length) return null
  const kinds = ['renderer', 'gpu-process', 'utility', 'browser']
  const mean = {}
  for (const kind of kinds) {
    const values = selected.map((tick) => tick.rows.filter((row) => row.kind === kind).reduce((sum, row) => sum + row.workingSet, 0))
    // Chrome may not spawn a GPU/utility process at all; an empty tick is a zero, not a gap.
    mean[kind] = values.reduce((sum, value) => sum + value, 0) / values.length
  }
  // The page's own renderer is the largest renderer of this profile; the rest are
  // Chrome's own about:blank/utility pages and are profile baseline, not station cost.
  const pageRenderers = selected.map((tick) => Math.max(0, ...tick.rows.filter((row) => row.kind === 'renderer').map((row) => row.workingSet)))
  const totals = selected.map((tick) => tick.rows.reduce((sum, row) => sum + row.workingSet, 0))
  const GIB = 1024 ** 3
  const gib = (bytes) => +(bytes / GIB).toFixed(2)
  return { seconds: +((toMs - fromMs) / 1000).toFixed(1), ticks: selected.length,
    renderer: gib(mean.renderer), pageRenderer: gib(pageRenderers.reduce((sum, value) => sum + value, 0) / pageRenderers.length),
    gpu: gib(mean['gpu-process']), utility: gib(mean.utility), browser: gib(mean.browser),
    total: gib(mean.renderer + mean['gpu-process'] + mean.utility + mean.browser),
    peakTotal: gib(Math.max(...totals)), peakPageRenderer: gib(Math.max(...pageRenderers)) }
}

// ---- page instrumentation ----------------------------------------------------
/**
 * Installed before the demo opens. Wrapping the subsystems' prototypes covers both
 * renderers: the editor's systems exist when this runs, and the exploded viewer
 * constructs its own from the same classes.
 */
const INSTRUMENT = `(() => {
  window.__benchOrigin = performance.now();
  window.__stages = [];
  window.__milestones = [];
  window.__stacks = [];
  window.__mark = (name) => {
    const stamp = new Date().toISOString();
    window.__milestones.push({ name, at: performance.now() - window.__benchOrigin, stamp });
    return stamp;
  };
  const wrap = (owner, key, stage) => {
    if (!owner || typeof owner[key] !== 'function') throw new Error('missing stage ' + key);
    const original = owner[key];
    owner[key] = function (...args) {
      const at = performance.now() - window.__benchOrigin;
      try { return original.apply(this, args); }
      finally {
        window.__stages.push({ stage, ms: performance.now() - window.__benchOrigin - at, at,
          frames: window.__scene?.framesRendered ?? -1,
          standalone: typeof this?.standalonePresentation === 'boolean' ? this.standalonePresentation : null });
      }
    };
  };
  const scene = window.__scene;
  const Scene = Object.getPrototypeOf(scene);
  for (const key of ['setStation', 'enableExplodedLayout', 'prepareStandaloneArtwork', 'setExplodedRampSections',
    'frameStandalonePresentation', 'setStandalonePresentation']) wrap(Scene, key, 'scene.' + key);
  // The frame loop and the draw are instance properties in three.js and this class,
  // so those two are wrapped on the instance and only cover the editor's renderer.
  const wrapInstance = (owner, key, stage) => {
    if (!owner || typeof owner[key] !== 'function') return;
    const original = owner[key];
    owner[key] = function (...args) {
      const at = performance.now() - window.__benchOrigin;
      try { return original.apply(this, args); }
      finally {
        window.__stages.push({ stage, ms: performance.now() - window.__benchOrigin - at, at,
          frames: window.__scene?.framesRendered ?? -1, standalone: null });
      }
    };
  };
  wrapInstance(scene, 'animate', 'scene.animate');
  wrapInstance(scene.renderer, 'render', 'render');
  // appendExplodedEquipment runs once per batch: one row per call would swamp the
  // report, so only the total is kept.
  window.__equipment = { calls: 0, ms: 0, longest: 0 };
  const append = Scene.appendExplodedEquipment;
  Scene.appendExplodedEquipment = function (...args) {
    const at = performance.now();
    try { return append.apply(this, args); }
    finally {
      const ms = performance.now() - at;
      if (!window.__equipment.calls) window.__equipment.firstAt = at - window.__benchOrigin;
      window.__equipment.calls++; window.__equipment.ms += ms;
      window.__equipment.longest = Math.max(window.__equipment.longest, ms);
      window.__equipment.lastAt = performance.now() - window.__benchOrigin;
    }
  };
  for (const [system, keys] of [
    [scene.chunks, ['prepareStation', 'meshStation']],
    [scene.modules, ['buildModules', 'buildModuleStages', 'syncBatches']],
    [scene.level, ['applyLevel']],
    [scene.trains, ['prepareForStation']],
    [scene.plates, ['redrawSignPlates', 'redrawDecorPlates']],
    [scene.grid, ['buildGrid']],
    [scene.sectionSys, ['applyClip']],
  ]) {
    const proto = Object.getPrototypeOf(system);
    for (const key of keys) wrap(proto, key, key);
  }
  // Who ran the fleet preparation, and from which task? BENCH_STACKS=1 keeps the
  // stack of every fleet call (it is normally one call per opening).
  if (${JSON.stringify(process.env.BENCH_STACKS === '1')}) {
    const trains = Object.getPrototypeOf(scene.trains);
    const prepare = trains.prepareForStation;
    trains.prepareForStation = function (...args) {
      window.__stacks.push({ stage: 'prepareForStation', at: performance.now() - window.__benchOrigin,
        stack: (new Error().stack ?? '').split('\\n').slice(1, 8).join(' | ') });
      return prepare.apply(this, args);
    };
    let animates = 0;
    const animate = scene.animate;
    scene.animate = function (...args) { animates++; window.__animateCalls = animates; return animate.apply(this, args) };
  }
  // The store's own synchronous half of opening a demo: repair + loadSim.
  const store = window.__metro;
  const loadReference = store.getState().loadReference;
  window.__load = { syncMs: 0, calls: 0 };
  store.setState({ loadReference: (id) => {
    const at = performance.now();
    try { return loadReference(id); }
    finally { window.__load.syncMs += performance.now() - at; window.__load.calls++; }
  } });
  window.__resetStages = () => { window.__stages = []; window.__equipment = { calls: 0, ms: 0, longest: 0 }; };
  // Attribution ablations (BENCH_ABLATE): remove one opening stage to measure its
  // share of the loading screen. Diagnostic only — the result is a different
  // product, so a capture with an ablation never publishes.
  const ablations = ${JSON.stringify(ablations)};
  // The fleet is prepared by TrainSystem, not by the scene itself.
  if (ablations.includes('trains')) Object.getPrototypeOf(scene.trains).prepareForStation = function () {};
  if (ablations.includes('buildViews')) Scene.prepareBuildViews = function () { this.requestRender() };
  window.__ablations = ablations;
  return true;
})()`

const frames = (count) => `new Promise(resolve => {
  let left = ${count};
  const step = () => { if (--left <= 0) resolve(); else requestAnimationFrame(step) };
  requestAnimationFrame(step);
})`

/** Wait for the first presented frame that draws the freshly installed station.
 * `onNextFrame` is the product's own signal: it is what dismisses the loading
 * shell, so this is the same boundary the player sees. */
const firstStationFrame = (expectedCells) => `new Promise(resolve => {
  const scene = window.__scene;
  const started = performance.now();
  let timer = 0;
  const arm = () => {
    scene.onNextFrame = () => {
      if (scene.ctx.stationData?.cells?.length !== ${expectedCells}) { arm(); return; }
      clearTimeout(timer);
      resolve(performance.now() - window.__benchOrigin);
    };
  };
  arm();
  timer = setTimeout(() => resolve(-1), 300000);
})`

function totals(stages) {
  const stagesByName = {}
  for (const stage of [...new Set(stages.map((row) => row.stage))]) {
    const rows = stages.filter((row) => row.stage === stage)
    stagesByName[stage] = { calls: rows.length, ms: +rows.reduce((sum, row) => sum + row.ms, 0).toFixed(2), longest: +Math.max(...rows.map((row) => row.ms)).toFixed(2) }
  }
  return stagesByName
}

const heap = (page) => page.send('Runtime.getHeapUsage')
const mb = (bytes) => +(bytes / 1048576).toFixed(0)

const server = await serveDir(resolve(process.env.BENCH_DIST ?? 'game/dist'), 0)
const url = `http://127.0.0.1:${server.address().port}/`
const results = []
try {
  for (const [index, demo] of demos.entries()) {
    const profile = resolve(output, 'chrome', `${demo}-${process.pid}`)
    const startedAt = new Date().toISOString()
    const page = await withPage({ url, profile, debugPort: 12000 + process.pid % 20000 + index,
      windowSize, softwareGpu: false, commandTimeoutMs: 600000 })
    try {
      await page.send('Runtime.enable')
      await waitFor(page.evaluate, '!!window.__scene && !!window.__metro', { what: 'game shell' })
      await page.evaluate(`(() => {
        const state = window.__metro.getState();
        state.setPlaying(false);
        state.setGraphicsQuality(${JSON.stringify(quality)});
      })()`)
      await page.evaluate(frames(4))
      const editorEmpty = await heap(page)
      await page.evaluate(INSTRUMENT)
      const editorEmptyAt = Date.now()

      // ---- save ---------------------------------------------------------------
      if (profileStages) { await page.send('Profiler.enable'); await page.send('Profiler.setSamplingInterval', { interval: 1000 }); await page.send('Profiler.start') }
      const opened = await page.evaluate(`(() => {
        window.__resetStages();
        window.__loadStart = performance.now();
        window.__mark('save-open');
        window.__metro.getState().loadReference(${JSON.stringify(demo)});
        window.__openReturnMs = performance.now() - window.__loadStart;
        const station = window.__metro.getState().station;
        return { cells: station.cells.length, modules: station.modules.length, name: station.name, cityStyle: station.cityStyle };
      })()`)
      const firstFrameAt = await page.evaluate(firstStationFrame(opened.cells))
      if (firstFrameAt < 0) throw new Error(`${demo}: the station never reached its first frame`)
      const saveLoadedAt = Date.now()
      await page.evaluate('window.__mark("save-loaded")')
      const saveStages = await page.evaluate('window.__stages')
      const openReturnMs = await page.evaluate('window.__openReturnMs')
      const saveHeap = await heap(page)
      const saveInventory = await page.evaluate(`(() => {
        const scene = window.__scene, renderer = scene.renderer.info;
        let objects = 0; scene.ctx.scene.traverseVisible(() => { objects++ });
        let all = 0; scene.ctx.scene.traverse(() => { all++ });
        return { draws: renderer.render.calls, triangles: renderer.render.triangles,
          geometries: renderer.memory.geometries, textures: renderer.memory.textures, programs: renderer.programs?.length ?? null,
          visibleObjects: objects, sceneObjects: all,
          chunks: scene.chunks.chunkMeshes.length, moduleRoots: scene.modules.moduleMeshes.children.length,
          batchRoots: scene.modules.batches.root.children.length, trainGroups: scene.trains.trainGroup.children.length,
          canvas: { width: scene.renderer.domElement.width, height: scene.renderer.domElement.height } };
      })()`)
      if (profileStages) { const { profile: cpu } = await page.send('Profiler.stop'); writeFileSync(resolve(output, `${demo}-save.cpuprofile`), JSON.stringify(cpu)) }
      const gpu = await page.evaluate(`(() => { const gl = window.__scene.renderer.getContext();
        const debug = gl.getExtension('WEBGL_debug_renderer_info');
        return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) })()`)
      // Hold still so the sampler records the settled state more than once.
      await page.evaluate('new Promise(resolve => setTimeout(resolve, 2600))')
      const saveSettledHeap = await heap(page)
      const saveSettledAt = Date.now()

      // ---- explode ------------------------------------------------------------
      await page.evaluate('window.__resetStages()')
      if (profileStages) await page.send('Profiler.start')
      await page.evaluate(`(() => {
        window.__explodeStart = performance.now();
        window.__mark('explode-open');
        // Split the viewer's startup: snapshot (toData + explodedView) + React +
        // the new renderer, before the first wrapped scene stage. __benchmarkScene
        // is set by the viewer right after it constructs the renderer.
        const poll = () => {
          if (window.__benchmarkScene && !window.__explodeRendererAt) {
            window.__explodeRendererAt = performance.now() - window.__explodeStart;
            window.__mark('explode-renderer');
            return;
          }
          requestAnimationFrame(poll);
        };
        requestAnimationFrame(poll);
        // The PreparedViewer commits a canvas as soon as the snapshot (toData +
        // explodedView) is ready; the renderer follows on its own timer.
        const snapshotPoll = () => {
          if (document.querySelector('.explodedViewer canvas') && !window.__explodeSnapshotAt) {
            window.__explodeSnapshotAt = performance.now() - window.__explodeStart;
            window.__mark('explode-snapshot');
            return;
          }
          requestAnimationFrame(snapshotPoll);
        };
        requestAnimationFrame(snapshotPoll);
        window.__explodeWatch = new MutationObserver(() => {
          const viewer = document.querySelector('.explodedViewer');
          if (!viewer) return;
          if (viewer.dataset.ready === 'true' && !window.__explodeStructureAt) {
            window.__explodeStructureAt = performance.now() - window.__explodeStart;
            window.__mark('explode-structure');
          }
          if (viewer.dataset.equipped === 'true' && !window.__explodeEquippedAt) {
            window.__explodeEquippedAt = performance.now() - window.__explodeStart;
            window.__mark('explode-equipped');
            window.__explodeWatch.disconnect();
          }
        });
        window.__explodeWatch.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-ready', 'data-equipped'] });
        window.__metro.getState().setExplodedView(true);
      })()`)
      await waitFor(page.evaluate, `typeof window.__explodeStructureAt === 'number'`, { tries: 2400, every: 100, what: `${demo} exploded structure` })
      const structureAt = Date.now()
      const structureHeap = await heap(page)
      const structureInventory = await page.evaluate(`(() => {
        const scene = window.__benchmarkScene; if (!scene) return null;
        const renderer = scene.renderer.info;
        let objects = 0; scene.ctx.scene.traverseVisible(() => { objects++ });
        return { draws: renderer.render.calls, triangles: renderer.render.triangles,
          geometries: renderer.memory.geometries, textures: renderer.memory.textures,
          visibleObjects: objects, equipped: document.querySelector('.explodedViewer')?.dataset.equipped ?? null };
      })()`)
      await waitFor(page.evaluate, `typeof window.__explodeEquippedAt === 'number'`, { tries: 3600, every: 100, what: `${demo} exploded equipment` })
      await page.evaluate(frames(2))
      const explodeStages = await page.evaluate('window.__stages')
      const equipment = await page.evaluate('window.__equipment')
      const stacks = await page.evaluate('window.__stacks ?? []')
      const animateCalls = await page.evaluate('window.__animateCalls ?? null')
      const equippedHeap = await heap(page)
      const equippedInventory = await page.evaluate(`(() => {
        const scene = window.__benchmarkScene; if (!scene) return null;
        const renderer = scene.renderer.info;
        let objects = 0; scene.ctx.scene.traverseVisible(() => { objects++ });
        let all = 0; scene.ctx.scene.traverse(() => { all++ });
        return { draws: renderer.render.calls, triangles: renderer.render.triangles,
          geometries: renderer.memory.geometries, textures: renderer.memory.textures, programs: renderer.programs?.length ?? null,
          visibleObjects: objects, sceneObjects: all,
          moduleRoots: scene.modules.moduleMeshes.children.length, batchRoots: scene.modules.batches.root.children.length,
          canvas: { width: scene.renderer.domElement.width, height: scene.renderer.domElement.height },
          framesRendered: scene.framesRendered };
      })()`)
      if (profileStages) { const { profile: cpu } = await page.send('Profiler.stop'); writeFileSync(resolve(output, `${demo}-explode.cpuprofile`), JSON.stringify(cpu)) }
      await page.evaluate('new Promise(resolve => setTimeout(resolve, 2600))')
      const equippedSettledHeap = await heap(page)
      const equippedSettledAt = Date.now()
      const structureMs = await page.evaluate('window.__explodeStructureAt')
      const equippedMs = await page.evaluate('window.__explodeEquippedAt')
      const rendererMs = await page.evaluate('window.__explodeRendererAt ?? null')
      const snapshotMs = await page.evaluate('window.__explodeSnapshotAt ?? null')
      const browser = await page.send('Browser.getVersion')

      const row = {
        demo, profile, windowStart: startedAt, windowEnd: new Date().toISOString(), station: opened, ablations,
        save: {
          syncMs: +((await page.evaluate('window.__load.syncMs'))).toFixed(1),
          apiReturnMs: +openReturnMs.toFixed(1),
          firstFrameMs: +(firstFrameAt - (await page.evaluate('window.__milestones.find(r => r.name === "save-open").at'))).toFixed(1),
          stages: saveStages.map((stage) => ({ stage: stage.stage, ms: +stage.ms.toFixed(2), at: +stage.at.toFixed(2), standalone: stage.standalone })),
          totals: totals(saveStages),
        },
        explode: {
          structureMs: +structureMs.toFixed(1), equippedMs: +equippedMs.toFixed(1),
          // Until the viewer's own renderer exists: snapshot packing + React + construction.
          rendererMs: rendererMs === null ? null : +rendererMs.toFixed(1),
          snapshotMs: snapshotMs === null ? null : +snapshotMs.toFixed(1),
          stages: explodeStages.filter((stage) => stage.standalone !== false).map((stage) => ({ stage: stage.stage, ms: +stage.ms.toFixed(2), at: +stage.at.toFixed(2) })),
          equipment: { calls: equipment.calls, ms: +equipment.ms.toFixed(2), longest: +equipment.longest.toFixed(2),
            firstAt: equipment.firstAt === undefined ? null : +equipment.firstAt.toFixed(1),
            lastAt: equipment.lastAt === undefined ? null : +equipment.lastAt.toFixed(1) },
        },
        heap: {
          editorEmpty: editorEmpty.usedSize,
          saveLoaded: saveSettledHeap.usedSize,
          explodeStructure: structureHeap.usedSize,
          explodeEquipped: equippedSettledHeap.usedSize,
          saveBackingStorage: saveSettledHeap.backingStorageSize,
          explodeBackingStorage: equippedSettledHeap.backingStorageSize,
          raw: { editorEmpty, saveHeap, saveSettledHeap, structureHeap, equippedHeap, equippedSettledHeap },
        },
        // Windows are only sampled when the sampler is enabled; nulls mean "not measured".
        windows: {
          editorEmpty: sampleMemory ? memoryIn(editorEmptyAt - 2000, editorEmptyAt + 300) : null,
          saveLoaded: sampleMemory ? memoryIn(saveSettledAt - 2200, saveSettledAt) : null,
          explodeStructure: sampleMemory ? memoryIn(structureAt - 1500, structureAt + 700) : null,
          explodeEquipped: sampleMemory ? memoryIn(equippedSettledAt - 2200, equippedSettledAt) : null,
        },
        inventory: { save: saveInventory, explodeStructure: structureInventory, explodeEquipped: equippedInventory },
        environment: { browser: browser.product, userAgent: browser.userAgent, gpu, quality, windowSize },
        stacks, animateCalls,
      }
      results.push(row)
      console.log(`${demo}: save ${(row.save.firstFrameMs / 1000).toFixed(2)} s (sync ${row.save.syncMs} ms), ` +
        `explode ${(row.explode.structureMs / 1000).toFixed(2)} s structure / ${(row.explode.equippedMs / 1000).toFixed(2)} s equipped, ` +
        `JS heap ${mb(row.heap.editorEmpty)} → ${mb(row.heap.saveLoaded)} → ${mb(row.heap.explodeEquipped)} MB`)
    } finally {
      await page.close()
    }
  }
} finally {
  server.close()
  sampler?.kill()
}

const sourceHash = JSON.parse(readFileSync(resolve(process.env.BENCH_DIST ?? 'game/dist', 'editor-benchmark-build.json'), 'utf8')).sourceHash
const report = {
  kind: 'demo-load-and-explode',
  timestamp: new Date().toISOString(),
  sourceHash,
  environment: { cpu: cpus()[0]?.model, platform: platform(), node: process.version, mode: 'Chrome headless, hardware rendering requested' },
  config: { demos, quality, windowSize, profileStages, sampled: sampleMemory, ablations,
    boundary: 'API-to-first-presented-frame; JS heap without forced GC; working sets averaged over held milestones' },
  samplers: ticks.length,
  demos: results,
}
writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
writeFileSync(resolve(output, 'processes.json'), JSON.stringify(ticks))

const fixed = (value, digits = 2) => (value === null || value === undefined ? '—' : Number(value).toFixed(digits))
if (ablations.length) console.log(`\nABLATED CAPTURE (BENCH_ABLATE=${ablations.join(',')}): diagnostic attribution only, never a product timing.`)
console.log('\n| Demo | Cells | Save to first frame | Explode viewer start | Explode structure | Explode equipped | JS heap empty → save → explode |')
console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
for (const demo of results) {
  console.log(`| ${demo.demo} | ${demo.station.cells.toLocaleString('en-US')} | ${fixed(demo.save.firstFrameMs / 1000)} s | ` +
    `${fixed(demo.explode.snapshotMs / 1000)} s | ${fixed(demo.explode.rendererMs / 1000)} s | ${fixed(demo.explode.structureMs / 1000)} s | ${fixed(demo.explode.equippedMs / 1000)} s | ` +
    `${mb(demo.heap.editorEmpty)} → ${mb(demo.heap.saveLoaded)} → ${mb(demo.heap.explodeEquipped)} MB |`)
}
if (sampleMemory) {
  console.log('\nWorking sets (GiB, averaged over the milestone hold; page renderer is the largest single renderer):')
  console.log('| Demo | Milestone | Page renderer | GPU process | Browser | Total (all) | Peak total | Ticks |')
  console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |')
  for (const demo of results) {
    for (const [name, window] of [['editor empty', demo.windows.editorEmpty], ['save loaded', demo.windows.saveLoaded],
      ['explode structure', demo.windows.explodeStructure], ['explode equipped', demo.windows.explodeEquipped]]) {
      if (!window) continue
      console.log(`| ${demo.demo} | ${name} | ${fixed(window.pageRenderer)} | ${fixed(window.gpu)} | ${fixed(window.browser)} | ${fixed(window.total)} | ${fixed(window.peakTotal)} | ${window.ticks} |`)
    }
  }
}
console.log(`\nReport: ${resolve(output, 'report.json')}`)
