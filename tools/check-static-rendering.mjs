import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { serveDir, withPage, waitFor, loadExampleStation } from './browser-harness.mjs'

const noMultiDraw = process.argv.includes('--no-multi-draw')
const output = resolve('.preview/perf/static-cache', noMultiDraw ? 'fallback' : '.')
mkdirSync(output, { recursive: true })
const server = await serveDir(resolve('game/dist'), 0)
const reports = []
try {
  for (const id of ['zoo', 'tanwei']) {
    const page = await withPage({ url: `http://127.0.0.1:${server.address().port}/`,
      profile: resolve(output, `chrome-${id}-${process.pid}`), debugPort: 9368,
      softwareGpu: false, windowSize: '1400,900' })
    try {
      if (noMultiDraw) {
        await page.send('Page.enable')
        await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
          const original = WebGL2RenderingContext.prototype.getExtension;
          WebGL2RenderingContext.prototype.getExtension = function(name) {
            return name === 'WEBGL_multi_draw' ? null : original.call(this, name);
          };
          window.__staticFallback = true;
        })()` })
        await page.send('Page.reload')
        await waitFor(page.evaluate, 'window.__staticFallback === true', { what: 'extension-free renderer' })
      }
      await waitFor(page.evaluate, '!!window.__scene && !!window.__metro', { what: 'app shell' })
      await page.evaluate(`(() => {
        window.__staticErrors = [];
        const error = console.error;
        console.error = (...args) => { __staticErrors.push(args.map(String).join(' ')); error(...args); };
        addEventListener('error', e => __staticErrors.push(e.message));
        addEventListener('unhandledrejection', e => __staticErrors.push(String(e.reason)));
      })()`)
      await loadExampleStation(page, id)
      await page.evaluate(`window.__metro.getState().setPlaying(false); new Promise(r => setTimeout(r, 3000))`)
      const geometry = await page.evaluate(`(async () => {
        const scene = window.__scene;
        const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        scene.setStaticDetail(false); await frames();
        const detailed = { ...scene.renderer.info.render };
        scene.setStaticDetail(true); await frames();
        const automatic = { ...scene.renderer.info.render };
        return { detailed, automatic };
      })()`)
      assert.ok(geometry.automatic.triangles <= geometry.detailed.triangles)
      const { data } = await page.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(resolve(output, `${id}-auto.png`), Buffer.from(data, 'base64'))
      const report = await page.evaluate(`(async () => {
        const scene = window.__scene, store = window.__metro;
        const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const changes = [];
        const step = async (name, action) => {
          const before = scene.framesRendered; action(); await frames();
          const draws = scene.framesRendered - before;
          if (draws < 1) throw Error(name + ': cached frame did not wake');
          changes.push({ name, draws });
        };
        // Freeze wall-clock artwork only during the idle assertion; test its wake separately.
        scene.plates.tvScreens.forEach(tv => tv.nextAt = Infinity);
        scene.controls.enableDamping = false; scene.controls.update();
        await wait(1200);
        const beforeIdle = scene.framesRendered; await wait(500);
        const idleDraws = scene.framesRendered - beforeIdle;
        if (idleDraws !== 0) throw Error('settled paused scene redrew ' + idleDraws + ' times');
        await step('camera orbit', () => scene.orbitBy(20, 5));
        await step('cursor', () => scene.setCursor([0, 0, 0], true));
        await step('module preview', () => scene.setModulePreview({id:'preview',type:'tree',x:0,y:0,z:0,rot:0,cfg:{}}));
        await step('clear preview', () => { scene.setModulePreview(null); scene.setCursor(null); });
        await step('storey visibility', () => scene.setLevel(store.getState().activeZ, false));
        await step('restore storeys', () => scene.setLevel(store.getState().activeZ, true));
        const outdoor = scene.modules.moduleMeshes.children.filter(root => ['sidewalk','lawn','tree','road','traffic-light'].includes(root.userData.moduleType));
        const outdoorVisibility = outdoor.map(root => root.visible);
        await step('hide ground', () => scene.setHideGround(true));
        if (outdoor.some(root => root.visible) || scene.roads.root.visible) throw Error('hidden ground retained an outdoor draw');
        await step('restore ground', () => scene.setHideGround(false));
        if (outdoor.some((root,i) => root.visible !== outdoorVisibility[i])) throw Error('ground visibility did not restore');
        await step('cut', () => scene.setSection(scene.defaultSection(), true));
        await step('clear cut', () => scene.setSection(scene.defaultSection(), false));
        if (scene.plates.tvScreens.length) await step('artwork swap', () => scene.plates.tvScreens[0].nextAt = 0);
        scene.plates.tvScreens.forEach(tv => tv.nextAt = Infinity);
        // Plan view makes the outside tile's top an unambiguous source-layer pick.
        scene.setPreset('plan'); scene.setHideUI(true); await frames();
        const tileRoots = scene.modules.moduleMeshes.children.filter(g => g.userData.moduleType === 'sidewalk' && g.children.length);
        tileRoots.sort((a,b) => a.position.x - b.position.x || a.position.y - b.position.y);
        let picked = null;
        const camera = scene.cameraSys.activeCamera(), rect = scene.renderer.domElement.getBoundingClientRect();
        for (const root of tileRoots) {
          const mesh = root.children[0]; mesh.geometry.computeBoundingBox();
          const point = mesh.geometry.boundingBox.getCenter(mesh.position.clone());
          point.z = mesh.geometry.boundingBox.max.z; point.applyMatrix4(mesh.matrixWorld).project(camera);
          if (Math.abs(point.x) >= 1 || Math.abs(point.y) >= 1) continue;
          const hit = scene.pickModule(rect.left + (point.x + 1) * rect.width / 2, rect.top + (1 - point.y) * rect.height / 2);
          if (hit === root.userData.moduleId) { picked = hit; break; }
        }
        if (!picked) throw Error('no batched sidewalk source could be picked');
        const batchObjects = scene.modules.batches.root.children.slice();
        await step('move pickup', () => scene.setMovingModule(picked));
        await step('move cancel', () => scene.setMovingModule(null));
        if (!batchObjects.every(mesh => scene.modules.batches.root.children.includes(mesh))) throw Error('pickup/cancel replaced GPU batches');
        const module = store.getState().station.modules.find(m => m.id === picked);
        const previous = store.getState().metrics, previousFrames = scene.framesRendered;
        store.getState().commit({...store.getState().station, modules:store.getState().station.modules.filter(m=>m.id!==picked)});
        for (let i=0; i<300 && store.getState().metrics===previous; i++) await wait(50);
        if (store.getState().metrics===previous) throw Error('worker did not acknowledge tile delete');
        await frames();
        if (scene.modules.moduleMeshes.children.some(g=>g.userData.moduleId===picked)) throw Error('deleted tile still draws');
        const retained = batchObjects.filter(mesh=>scene.modules.batches.root.children.includes(mesh)).length;
        if (!retained) throw Error('tile edit discarded every static batch');
        if (scene.framesRendered===previousFrames) throw Error('tile edit did not wake framebuffer');
        store.getState().undo(); await frames();
        if (!scene.modules.moduleMeshes.children.some(g=>g.userData.moduleId===module.id)) throw Error('undo did not restore the tile');
        store.getState().setPlaying(true); const tick=store.getState().metrics.tick;
        for(let i=0;i<50 && store.getState().metrics.tick===tick;i++) await wait(50);
        if (store.getState().metrics.tick===tick) throw Error('resume did not advance simulation');
        store.getState().setPlaying(false);
        return { id:store.getState().station.name, idleDraws, changes, picked, retained, batches:batchObjects.length,
          multiDraw:!!scene.renderer.getContext().getExtension('WEBGL_multi_draw'),
          glError:scene.renderer.getContext().getError(), errors:window.__staticErrors };
      })()`)
      assert.equal(report.glError, 0); assert.deepEqual(report.errors, [])
      if (noMultiDraw) assert.equal(report.multiDraw, false)
      reports.push({ ...report, geometry })
      console.log(`${report.id}: idle draws ${report.idleDraws}; ${report.changes.length} wakeups; picking/edit/undo/resume pass`)
    } finally { await page.close() }
  }
  writeFileSync(resolve(output, 'browser-check.json'), JSON.stringify(reports, null, 2))
} finally { server.close() }
