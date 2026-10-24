import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { serveDir, withPage, waitFor, loadExampleStation } from './browser-harness.mjs'
const noMultiDraw = process.argv.includes('--no-multi-draw')

// Real production GLSL/multi-draw check. Geometry/calls are assertions; FPS is
// deliberately not a hardware-dependent CI threshold. Build game/dist first.
mkdirSync('.preview/perf', { recursive: true })
const server = await serveDir(resolve(process.env.BENCH_DIST ?? 'game/dist'), 0)
let page
try {
  page = await withPage({ url: `http://127.0.0.1:${server.address().port}/`,
    profile: resolve(`.preview/perf/chrome-batching-check-${process.pid}`),
    debugPort: Number(process.env.BATCH_CHECK_PORT ?? 9357),
    softwareGpu: process.argv.includes('--software-gpu'), windowSize: '1400,900' })
  if (noMultiDraw) {
    await page.send('Page.enable')
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      const prototype = WebGL2RenderingContext.prototype, get = prototype.getExtension;
      prototype.getExtension = function(name) { return name === 'WEBGL_multi_draw' ? null : get.call(this, name); };
      window.__multiDrawDisabled = true;
    })()` })
    await page.send('Page.reload')
    await waitFor(page.evaluate, 'window.__multiDrawDisabled === true', { what: 'extension-free document initialization' })
  }
  await waitFor(page.evaluate, '!!window.__scene && !!window.__metro.getState().stats', { what: 'production scene' })
  await loadExampleStation(page)
  await page.evaluate(`(async () => {
    window.__batchCheck = { errors: [] };
    window.addEventListener('error', e => __batchCheck.errors.push(e.message));
    window.addEventListener('unhandledrejection', e => __batchCheck.errors.push(String(e.reason)));
    const error = console.error;
    console.error = (...args) => { __batchCheck.errors.push(args.map(String).join(' ').slice(0, 4096)); error(...args); };
    window.__metro.getState().setPlaying(false);
    await new Promise(r => setTimeout(r, 3000));
    const scene = window.__scene, state = window.__metro.getState();
    scene.setContinuousRendering(true); scene.setStaticDetail(false);
    scene.setLevel(state.activeZ, false); scene.setAgentsVisible(false); scene.trains.setPlaying(false);
    const track = state.station.modules.find(m => m.type === 'track' && m.z === state.activeZ && m.w >= 60);
    if (!track) throw Error('validation fixture requires a visible 60 m track');
    const yaw = (track.rot ?? 0) * Math.PI / 2;
    const x = track.x + .5 + Math.cos(yaw) * (track.w - 1) / 2, y = track.y + .5 + Math.sin(yaw) * (track.w - 1) / 2;
    scene.trains.setTrains(new Float32Array([x,y,track.z+.5,4,1,0,0x336699,1,yaw,3]));
    __batchCheck.sample = async () => {
      await new Promise(r => setTimeout(r, 1000));
      const gl = scene.renderer.getContext();
      return { ...scene.renderer.info.render, glError: gl.getError(), errors: __batchCheck.errors.slice() };
    };
    __batchCheck.toggle = enabled => {
      scene.trains.setDrawBatching(enabled); scene.modules.batches.enabled = enabled; scene.modules.syncBatches();
    };
    __batchCheck.open = () => {
      for (const entry of scene.trains.trainSlots.values()) {
        entry.group.userData.doorOpen = 1; entry.group.userData.doorSides = 3;
        scene.trains.advanceTrainDoors(entry.group, 2);
      }
    };
  })()`)
  const report = { timestamp: new Date().toISOString(), phases: {} }
  for (const [name, enabled] of [['stationEnabled', true], ['stationDisabled', false]]) {
    await page.evaluate(`__batchCheck.toggle(${enabled})`)
    report.phases[name] = await page.evaluate('__batchCheck.sample()')
  }
  assert.ok(report.phases.stationEnabled.calls < report.phases.stationDisabled.calls, 'same station submits fewer draws with batching')
  await page.evaluate(`(() => {
    const scene = window.__scene;
    scene.modules.moduleMeshes.visible = false; scene.modules.batches.root.visible = false;
    for (const g of scene.chunks.levelGroups.values()) g.visible = false;
    const root = scene.trains.trainGroup.children.find(g => g.visible), c = scene.cameraSys;
    c.controls.enableDamping = false; c.controls.target.copy(root.position); c.controls.target.z += 1.5;
    c.camera.position.copy(c.controls.target); c.camera.position.y -= 130; c.camera.position.z += 100;
    c.controls.update();
  })()`)
  for (const open of [false, true]) for (const enabled of [true, false]) {
    await page.evaluate(`__batchCheck.toggle(${enabled}); ${open ? '__batchCheck.open();' : ''}`)
    const name = `train${open ? 'Open' : 'Closed'}${enabled ? 'Enabled' : 'Disabled'}`
    report.phases[name] = await page.evaluate('__batchCheck.sample()')
  }
  for (const pose of ['Open', 'Closed']) {
    const enabled = report.phases[`train${pose}Enabled`], disabled = report.phases[`train${pose}Disabled`]
    assert.ok(disabled.triangles > 1000, `${pose}: the test consist is actually visible and drawing geometry`)
    assert.equal(enabled.triangles, disabled.triangles, `${pose}: GPU submitted triangles are preserved`)
    assert.ok(enabled.calls < disabled.calls, `${pose}: actual train draws decrease`)
  }
  for (const phase of Object.values(report.phases)) {
    assert.equal(phase.glError, 0, 'no WebGL errors')
    assert.deepEqual(phase.errors, [], 'no shader/runtime errors')
  }
  report.multiDraw = await page.evaluate("!!window.__scene.renderer.getContext().getExtension('WEBGL_multi_draw')")
  if (noMultiDraw) assert.equal(report.multiDraw, false, 'the renderer exercised its extension-free fallback')
  const output = resolve(process.env.BATCH_CHECK_OUTPUT ?? `.preview/perf/render-batching-check${noMultiDraw ? '-fallback' : ''}.json`)
  writeFileSync(output, JSON.stringify(report, null, 2))
  console.log(`Station draws: ${report.phases.stationDisabled.calls} → ${report.phases.stationEnabled.calls}`)
  console.log(`Closed train draws: ${report.phases.trainClosedDisabled.calls} → ${report.phases.trainClosedEnabled.calls}; triangles preserved`)
  console.log(`Open train draws: ${report.phases.trainOpenDisabled.calls} → ${report.phases.trainOpenEnabled.calls}; triangles preserved`)
  console.log(`Native multi-draw: ${report.multiDraw}; no GLSL/WebGL/runtime errors; ${output}`)
} finally { await page?.close(); server.close() }
