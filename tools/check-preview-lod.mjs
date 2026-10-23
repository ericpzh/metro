import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { serveDir, withPage, waitFor } from './browser-harness.mjs'

const noMultiDraw = process.argv.includes('--no-multi-draw')
const output = resolve(process.env.BENCH_OUTPUT ?? `.preview/perf/preview-audit/lod${noMultiDraw ? '-fallback' : ''}`)
mkdirSync(output, { recursive: true })
const server = await serveDir(resolve('game/dist'), 0)
let page
try {
  page = await withPage({ url: `http://127.0.0.1:${server.address().port}/`, profile: resolve(`${output}/chrome-${process.pid}`), debugPort: 10000 + process.pid % 40000, softwareGpu: false })
  if (noMultiDraw) {
    await page.send('Page.enable')
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      const prototype=WebGL2RenderingContext.prototype,get=prototype.getExtension;
      prototype.getExtension=function(name){return name==='WEBGL_multi_draw'?null:get.call(this,name)};
      window.__multiDrawDisabled=true;
    })()` })
    await page.send('Page.reload')
    await waitFor(page.evaluate, 'window.__multiDrawDisabled===true')
  }
  await waitFor(page.evaluate, '!!(window.__scene && window.__metro?.getState().metrics)')
  await page.evaluate(`document.querySelector('.tutorialActions .ghost')?.click()`)
  await page.evaluate(`(${async function () {
    const store = window.__metro, scene = window.__scene, s = store.getState(), cells = []
    for (let x = -3; x <= 3; x++) for (let y = -3; y <= 3; y++) cells.push({ x, y, z: 1, fill: 'solid' })
    for (let z = 2; z <= 5; z++) cells.push({ x: 0, y: 1, z, fill: 'solid', tags: ['wall'] })
    s.commit({ ...s.station, name: 'Preview LOD', levelBase: 1, cells, modules: [], lines: [] })
    s.setActiveZ(1); s.setGhostOther(false)
    store.setState({ playing: false, tool: 'module', moduleType: 'glass-1x1', moduleRot: 2, autoCeiling: false, hideWalls: false })
    scene.setOrtho(false)
    const cam = scene.cameraSys
    cam.controls.enableDamping = false; cam.controls.target.set(.5, 1, 4)
    cam.camera.position.set(5, -9, 7); cam.controls.update()
    window.__previewCheck = { rows: [], errors: [], candidates: [] }
    const logError = console.error
    console.error = (...args) => { __previewCheck.errors.push(args.map(String).join(' ').slice(0,4096)); logError(...args) }
    addEventListener('error', event => __previewCheck.errors.push(event.message))
    addEventListener('unhandledrejection', event => __previewCheck.errors.push(String(event.reason)))
    const original = scene.setModulePreview
    scene.setModulePreview = function (mod, blocked, ...rest) {
      if (mod && !Array.isArray(mod)) __previewCheck.candidates.push({ module: mod, blocked })
      return original.call(this, mod, blocked, ...rest)
    }
    window.__previewTriangles = (...roots) => {
      let count = 0
      for (const root of roots) root.traverseVisible(mesh => {
        if (!mesh.isMesh || !mesh.layers.isEnabled(0)) return
        if (mesh.isBatchedMesh) for (let i = 0; i < mesh.instanceCount; i++) {
          if (!mesh.getVisibleAt(i)) continue
          const range = mesh.getGeometryRangeAt(mesh.getGeometryIdAt(i))
          count += (mesh.geometry.index ? range.indexCount : range.vertexCount) / 3
        }
        else count += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3 * (mesh.isInstancedMesh ? mesh.count : 1)
      })
      return count
    }
    window.__previewSnapshot = () => {
      const g = scene.ghostSys, candidate = __previewCheck.candidates.at(-1), root = g.previewGroup.children[0]
      const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
      root.updateMatrixWorld(true)
      const Vector = scene.cameraSys.activeCamera().position.constructor
      root.traverse(mesh => {
        if (!mesh.isMesh) return
        const position = mesh.geometry.attributes.position
        for (let i = 0; i < position.count; i++) {
          const p = new Vector().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld)
          box.min = box.min.map((n, a) => Math.min(n, p.getComponent(a)))
          box.max = box.max.map((n, a) => Math.max(n, p.getComponent(a)))
        }
      })
      return { ...candidate, box, triangles: __previewTriangles(g.previewGroup, g.moduleDetail.batches.root), quality: store.getState().graphicsQuality, hideUI: store.getState().hideUI }
    }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  }})()`)
  await waitFor(page.evaluate, '__scene.ctx.stationData?.name==="Preview LOD"')
  const rows = []
  for (const [height, course] of [[1, 5], [2, 3], [2, 5]]) {
    const target = await page.evaluate(`(async()=>{
      __metro.setState({moduleType:'glass-1x${height}'});
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const scene=__scene,camera=scene.cameraSys.activeCamera(),Vector=camera.position.constructor;
      const p=new Vector(.5,1,${course}+.5).project(camera),rect=scene.renderer.domElement.getBoundingClientRect();
      const point={x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2};
      return {...point,hit:scene.pick(point.x,point.y,__metro.getState().activeZ)};
    })()`)
    assert.equal(target.hit?.cell[2], course, 'real ray hits the intended wall course')
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y })
    await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    for (const quality of ['high', 'low']) {
      await page.evaluate(`__metro.getState().setGraphicsQuality('${quality}');new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`)
      const row = await page.evaluate('__previewSnapshot()')
      assert.equal(row.module.z, course - 1)
      assert.ok(Math.abs(row.box.min[2] - course) < 1e-6)
      assert.ok(Math.abs(row.box.max[2] - course - height) < 1e-6)
      assert.equal(row.blocked, height === 2 && course === 5)
      rows.push({ height, course, ...row })
      const capture = await page.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(resolve(output, `glass-${height}m-course-${course}-${quality}.png`), Buffer.from(capture.data, 'base64'))
    }
    assert.ok(rows.at(-1).triangles < rows.at(-2).triangles, 'Low preview submits the authored reduced geometry')
  }
  // One supported preview and the click that places it, at identical camera/quality.
  await page.evaluate(`__metro.setState({moduleType:'glass-1x1'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`)
  const target = await page.evaluate(`(()=>{const camera=__scene.cameraSys.activeCamera(),Vector=camera.position.constructor,p=new Vector(.5,1,4.5).project(camera),r=__scene.renderer.domElement.getBoundingClientRect();return{x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}})()`)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...target })
  await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  const preview = await page.evaluate('__previewSnapshot()')
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...target, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...target, button: 'left', clickCount: 1 })
  await waitFor(page.evaluate, '__metro.getState().station.modules.length===1')
  await page.evaluate('__scene.setModulePreview(null);new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  const placed = await page.evaluate(`({module:__metro.getState().station.modules[0],triangles:__previewTriangles(__scene.modules.moduleMeshes,__scene.modules.batches.root),errors:__previewCheck.errors})`)
  assert.equal(placed.module.z, preview.module.z)
  assert.equal(placed.triangles, preview.triangles, 'preview and placement draw the same Low geometry')
  assert.deepEqual(placed.errors, [])
  writeFileSync(resolve(output, 'report.json'), JSON.stringify({ rows, preview, placed }, null, 2))
  console.log(JSON.stringify({ cases: rows.length, previewTriangles: preview.triangles, placedTriangles: placed.triangles, errors: placed.errors }, null, 2))
} finally { await page?.close(); server.close() }
