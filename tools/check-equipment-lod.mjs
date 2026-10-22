import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from '../game/node_modules/vite/dist/node/index.js'
import { withPage, waitFor } from './browser-harness.mjs'
import { equipmentLowBudget } from './equipment-low-budgets.mjs'

// Full-catalogue source-builder WebGL contact sheets. Production scene/batching
// is separately checked by check-render-batching.mjs, including its fallback.
const output = resolve('.preview/perf/equipment-10pct')
mkdirSync(output, { recursive: true })
const server = await createServer({ root: resolve('game'), configFile: resolve('game/vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
let page
try {
  page = await withPage({ url: `http://127.0.0.1:${server.httpServer.address().port}/`, profile: resolve(`${output}/chrome-${process.pid}`), debugPort: 9371, windowSize: '1000,800' })
  await waitFor(page.evaluate, '!!window.__scene && !!window.__metro.getState().stats')
  const result = await page.evaluate(`(${async function () {
    const THREE = await import('/node_modules/.vite/deps/three.js')
    const models = await import('/src/render/models.ts')
    const { createModule } = await import('/src/build/model.ts')
    const { MODULE_OPTIONS } = await import('/src/app/store/catalog.ts')
    const { SourceGeometryDetail } = await import('/src/render/sourceGeometryDetail.ts')
    const { EquipmentBatches } = await import('/src/render/equipmentBatches.ts')
    const { batchStaticModule } = await import('/src/render/batchStaticModule.ts')
    const { geometryDetailReady } = await import('/src/render/geometryDetail.ts')
    await geometryDetailReady
    const errors = [], originalError = console.error
    console.error = (...args) => { errors.push(args.join(' ')); originalError(...args) }
    window.__metro.getState().setPlaying(false); window.__scene.setContinuousRendering(false)
    const renderer = window.__scene.renderer
    renderer.setSize(256, 256, false)
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xd5d8df)
    scene.add(new THREE.AmbientLight(0xffffff, 2))
    const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(-5, -8, 12); scene.add(light)
    const atlases = [false, true].map(() => {
      const canvas = document.createElement('canvas'); canvas.width = 8 * 160; canvas.height = Math.ceil(MODULE_OPTIONS.length / 8) * 180
      const context = canvas.getContext('2d'); context.fillStyle = '#d5d8df'; context.fillRect(0, 0, canvas.width, canvas.height)
      return { canvas, context }
    })
    const mats = models.createModelMaterials(), rows = []
    const line = { id: '5', name: '5', colour: '#c8102e', stock: 'B', cars: 6, power: 'third-rail', direction: 'up', travelSign: 1, stations: [] }
    for (const [index, option] of MODULE_OPTIONS.entries()) {
      const mod = createModule(option.id, 4, 4, 0, option.id, 0, undefined, 'up', 'lane', [line])
      const data = { name: 'Station', seed: 1, cells: [], modules: [mod], lines: [line] }, owned = []
      const ads = { adFace: (slug, w, h) => ({ geometry: new THREE.PlaneGeometry(w, h), material: mats.desktopScreen, slug }), adWindow: (w, h) => ads.adFace('preview', w, h) }
      const ctx = { mats, ads, data, trackCells: new Set(), finish: () => mats.steel, owned, preview: false, tvPlate: () => new THREE.CanvasTexture(document.createElement('canvas')) }
      const root = models.buildModule(mod, ctx), detail = new SourceGeometryDetail(), instances = []
      scene.add(root); root.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(root), centre = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3())
      const span = Math.max(size.x, size.y, size.z, .5) * .75
      const camera = new THREE.OrthographicCamera(-span, span, span, -span, .01, 10000)
      const rear = option.id === 'monitor-wall' || option.id.startsWith('billboard-') || option.id === 'linemap-wall' || option.id.startsWith('calligraphy-') || option.id === 'sign-wall'
      camera.up.set(0, 0, 1); camera.position.copy(centre).add(new THREE.Vector3(span * .9, span * (rear ? 1.8 : -1.8), span * 1.2)); camera.lookAt(centre)
      const row = { id: option.id }
      for (const low of [false, true]) {
        if (low) {
          detail.apply(root, true)
          root.traverse(mesh => { if (mesh.isMesh && mesh.userData.staticInstances) { instances.push([mesh, mesh.geometry]); mesh.geometry = mesh.userData.staticFarGeometry ?? mesh.userData.staticDetailGeometry ?? mesh.geometry } })
        }
        renderer.render(scene, camera)
        row[low ? 'lowGPU' : 'highGPU'] = renderer.info.render.triangles
        let geometryTriangles = 0, transparencyExtra = 0
        root.traverseVisible(mesh => {
          if (!mesh.isMesh) return
          const triangles = (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3 * (mesh.isInstancedMesh ? mesh.count : 1)
          geometryTriangles += triangles
          if (!Array.isArray(mesh.material) && mesh.material.transparent && mesh.material.side === THREE.DoubleSide && !mesh.material.forceSinglePass) transparencyExtra += triangles
        })
        row[low ? 'lowModel' : 'highModel'] = geometryTriangles
        row[low ? 'lowTransparencyExtra' : 'highTransparencyExtra'] = transparencyExtra
        const atlas = atlases[low ? 1 : 0], x = index % 8 * 160, y = Math.floor(index / 8) * 180
        atlas.context.drawImage(renderer.domElement, x, y, 160, 160)
        const pixels = atlas.context.getImageData(x, y, 160, 160).data
        let visible = 0
        for (let p = 0; p < pixels.length; p += 4) if (Math.abs(pixels[p] - pixels[0]) + Math.abs(pixels[p + 1] - pixels[1]) + Math.abs(pixels[p + 2] - pixels[2]) > 30) visible++
        row[low ? 'lowPixels' : 'highPixels'] = visible
        atlas.context.fillStyle = '#18202a'; atlas.context.font = '11px sans-serif'; atlas.context.fillText(option.id, x + 4, y + 172, 152)
      }
      for (const [mesh, geometry] of instances) mesh.geometry = geometry
      detail.restore()
      if (option.id === 'monitor-wall' || option.id === 'exit-uncovered-1') {
        batchStaticModule(root, mod.type)
        root.userData.moduleType = mod.type; root.userData.moduleId = mod.id; root.userData.levelZs = [0]
        const container = new THREE.Group(), batches = new EquipmentBatches()
        container.add(root); scene.add(container, batches.root)
        batches.sync(container, 'monitor', 'catalogue')
        for (const low of [false, true]) {
          batches.equipmentDetailEnabled = low || option.id === 'monitor-wall'
          batches.graphicsQuality = low ? 'low' : 'high'; batches.updateDetail(camera, 256)
          if (low) detail.apply(root, true)
          renderer.render(scene, camera)
          row[low ? 'batchedLowGPU' : 'batchedHighGPU'] = renderer.info.render.triangles
        }
        detail.restore(); batches.clear(); scene.remove(container, batches.root); scene.add(root)
      }
      scene.remove(root); models.disposeObject(root)
      for (const mat of owned) { mat.map?.dispose(); mat.dispose() }
      rows.push(row)
      if (index % 12 === 0) await new Promise(resolve => setTimeout(resolve, 0))
    }
    models.disposeModelMaterials(mats)
    return { rows, errors, glError: renderer.getContext().getError(), high: atlases[0].canvas.toDataURL(), low: atlases[1].canvas.toDataURL() }
  }.toString()})()`)
  for (const quality of ['high', 'low']) writeFileSync(`${output}/${quality}.png`, Buffer.from(result[quality].split(',')[1], 'base64'))
  delete result.high; delete result.low
  writeFileSync(`${output}/browser.json`, JSON.stringify(result, null, 2))
  assert.deepEqual(result.errors, []); assert.equal(result.glError, 0)
  assert.equal(result.rows.length, 120)
  for (const row of result.rows) {
    assert.ok(row.highGPU > 0 && row.lowGPU > 0, `${row.id}: visible in both qualities`)
    if (row.highPixels > 20) assert.ok(row.lowPixels > 20, `${row.id}: Low still paints a visible model`)
    // GPU DoubleSide transparency can submit an additional pass; retain that
    // real count here, distinct from the geometry budget in the Node inventory.
    const budget = equipmentLowBudget(row.id, row.highModel)
    assert.ok(row.lowModel <= budget.limit, `${row.id}: real browser geometry meets its Low budget`)
    assert.equal(row.lowGPU, row.lowModel + row.lowTransparencyExtra, `${row.id}: all geometry is actually submitted, including the known transparency pass`)
    if (!budget.reason) assert.ok(row.lowGPU - row.lowTransparencyExtra < row.highModel * .1, `${row.id}: GPU model geometry is below 10%; extra transparent passes are reported separately`)
    if (row.batchedLowGPU !== undefined) {
      assert.equal(row.batchedHighGPU, row.highGPU, `${row.id}: High batching retains the complete model`)
      assert.equal(row.batchedLowGPU, row.lowGPU, `${row.id}: Low geometry survives the real cross-module batches`)
    }
  }
  console.log(`Rendered ${result.rows.length} High/Low models without WebGL/shader errors: ${output}`)
} finally { await page?.close(); await server.close() }
