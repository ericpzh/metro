import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Canvas, ImageData, createCanvas } from '@napi-rs/canvas'
import validator from 'gltf-validator'

// The 站名 (station-name calligraphy) family: the six hands — 黑体 / 楷书 / 隶书 /
// 宋体 / 魏碑 / 行书 — on both ways an inscription runs (横排 and 竖排), twelve
// pieces. Each is the game's own builder output for one placed module at a stable
// local origin (`createModule` + `buildModule`).
//
// The piece is unusual: it has **no geometry of its own**. `CalligraphyModel`
// hangs one transparent ink plate 0.46 m off the module's local −y wall, so the
// exported mesh is a single 5 × 1 m (or 0.98 × 2.6 m) quad with two triangles and
// one canvas texture. The ink is transparent on purpose — an inscription is brush
// strokes *on* the wall, and the wall is the game's, not the model's — so the
// export carries only the strokes.
//
// The text is a **sample inscription**. In the live game the plate system
// reprints every inscription from `StationData.name` at runtime (`ctx.calligraphyFace`,
// `render/scene/systems/PlateSystem.ts`); a static GLB cannot carry that binding,
// so every panel here is written with one fixed sample name and the manifest says
// so. Nothing in this export claims the prefab prints the live station name.
//
// Determinism: the palette's brushed-steel canvas draws grain with `Math.random`
// (seeded below before PieceBuilder is imported), the twelve canvases encode
// through one serialised promise queue so image bufferViews keep traversal order,
// no dates or UUIDs survive (every `userData` is stripped), and a repeat export
// must be byte-identical.
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
Math.random = seeded(0x9e3779b9)

// The palette prints its canvas textures through the DOM. Shadow `data` or
// GLTFExporter treats every canvas as a DataTexture and writes transparent black.
let encodeQueue = Promise.resolve()
globalThis.HTMLCanvasElement = Canvas
globalThis.ImageData = ImageData
globalThis.document = {
  createElement(name) {
    assert.equal(name, 'canvas')
    const canvas = createCanvas(1, 1)
    Object.defineProperty(canvas, 'data', { value: undefined })
    canvas.toBlob = (callback, mime) => {
      // GLTFExporter pushes every `getToBlobPromise` in traversal order but
      // appends the bufferViews as each resolves, so two canvases in one build
      // would race without this queue.
      const job = async () => {
        const bytes = await canvas.encode(mime === 'image/jpeg' ? 'jpeg' : 'png')
        callback(new Blob([bytes], { type: mime }))
      }
      encodeQueue = encodeQueue.then(job, job)
    }
    return canvas
  },
}

globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => {
      this.result = result
      this.onloadend?.()
    })
  }
}

const gameRequire = createRequire(new URL('../../game/package.json', import.meta.url))
const THREE = await import(new URL('../../game/node_modules/three/build/three.module.js', import.meta.url).href)
const { GLTFExporter } = await import(pathToFileURL(gameRequire.resolve('three/addons/exporters/GLTFExporter.js')).href)
// Imported after the seeded Math.random so the palette's brushed-steel grain is
// identical in every run.
const { createModelMaterials, canvasTexture } = await import('../../game/src/render/models/PieceBuilder.ts')
const { createModule } = await import('../../game/src/build/model/Equipment.ts')
const { buildModule } = await import('../../game/src/render/models.ts')
const { calligraphyPlate, drawCalligraphyPanel } = await import('../../game/src/render/calligraphyFace.ts')
const { calligraphyBottom } = await import('../../game/src/sim/calligraphy.ts')

/** The one fixed sample inscription written into every panel. */
const SAMPLE_NAME = '人民广场'
/**
 * How far the ink stands off the wall, metres — `INK_OFFSET` in
 * `pieces/CalligraphyModel.ts`. It is a property of the piece, not of this
 * export, and the Unity review asserts it on the bounds.
 */
const INK_OFFSET = 0.46
/** Review-row pitch in metres: the 横排 panels are 5 m wide. */
const ROW_PITCH = 5.6

/**
 * The twelve family models in review-row order. The palette id names the hand
 * and the axis (`calligraphy-<style>-<axis>`), and `createModule` turns it into
 * the module whose panel is cut from the station name at placement time. With no
 * station document behind it, the cut falls back to the kit's neutral name
 * (未命名车站, five characters), so 横排 is five cells (5 m) and 竖排 is the
 * column's 0.98 m width by the 2.6 m ceiling.
 *
 * `width`/`height`/`bottom`/`cells` are the panel the build must keep: the
 * exporter asserts them on the geometry, the Unity review repeats them, and the
 * catalogue row records them.
 */
const MODELS = [
  { paletteId: 'calligraphy-hei-h', style: 'hei', axis: 'h', prefab: 'CalligraphyHeiH', id: 'station.calligraphy.hei-h' },
  { paletteId: 'calligraphy-hei-v', style: 'hei', axis: 'v', prefab: 'CalligraphyHeiV', id: 'station.calligraphy.hei-v' },
  { paletteId: 'calligraphy-kai-h', style: 'kai', axis: 'h', prefab: 'CalligraphyKaiH', id: 'station.calligraphy.kai-h' },
  { paletteId: 'calligraphy-kai-v', style: 'kai', axis: 'v', prefab: 'CalligraphyKaiV', id: 'station.calligraphy.kai-v' },
  { paletteId: 'calligraphy-li-h', style: 'li', axis: 'h', prefab: 'CalligraphyLiH', id: 'station.calligraphy.li-h' },
  { paletteId: 'calligraphy-li-v', style: 'li', axis: 'v', prefab: 'CalligraphyLiV', id: 'station.calligraphy.li-v' },
  { paletteId: 'calligraphy-song-h', style: 'song', axis: 'h', prefab: 'CalligraphySongH', id: 'station.calligraphy.song-h' },
  { paletteId: 'calligraphy-song-v', style: 'song', axis: 'v', prefab: 'CalligraphySongV', id: 'station.calligraphy.song-v' },
  { paletteId: 'calligraphy-wei-h', style: 'wei', axis: 'h', prefab: 'CalligraphyWeiH', id: 'station.calligraphy.wei-h' },
  { paletteId: 'calligraphy-wei-v', style: 'wei', axis: 'v', prefab: 'CalligraphyWeiV', id: 'station.calligraphy.wei-v' },
  { paletteId: 'calligraphy-xing-h', style: 'xing', axis: 'h', prefab: 'CalligraphyXingH', id: 'station.calligraphy.xing-h' },
  { paletteId: 'calligraphy-xing-v', style: 'xing', axis: 'v', prefab: 'CalligraphyXingV', id: 'station.calligraphy.xing-v' },
].map(spec => ({
  ...spec,
  file: `${spec.paletteId}.glb`,
  ink: `calligraphyInk_${spec.style}_${spec.axis}`,
  panelWidth: spec.axis === 'h' ? 5 : 0.98,
  panelHeight: spec.axis === 'h' ? 1 : 2.6,
  cells: spec.axis === 'h' ? 5 : 1,
}))

const mats = createModelMaterials()
// Empty station document: the calligraphy builder reads none of it, but the
// module context contract carries it.
const data = { cells: [], modules: [], lines: [], name: SAMPLE_NAME, nameEn: 'Renmin Guangchang' }

/**
 * The ink of one 站名, implemented exactly as the palette thumbnail recipe does
 * it (`app/moduleThumbnails.ts`): the plate's pixel size from `calligraphyPlate`,
 * a canvas drawn by `drawCalligraphyPanel`, and a transparent `MeshBasicMaterial`
 * over it whose alpha is the strokes. The face is captured per build so the
 * exporter can hash the very PNG that ends up in the GLB.
 */
let face = null
const ctx = {
  mats,
  data,
  ads: {},
  trackCells: new Set(),
  finish: () => mats.darkSteel,
  calligraphyFace: (id, spec) => {
    const plate = calligraphyPlate(spec.panel)
    const texture = canvasTexture(plate.width, plate.height, (g) => {
      drawCalligraphyPanel(g, { text: SAMPLE_NAME, style: spec.style, axis: spec.axis, panel: spec.panel })
    })
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.FrontSide })
    face = { id, material, texture, plate, style: spec.style, axis: spec.axis, panel: spec.panel }
    return { material, texture }
  },
}

const out = resolve(process.argv[2] ?? '.preview/unity/script-proof/export')
await mkdir(out, { recursive: true })

const assets = []
const panels = []
const textureDigests = new Map()
for (const spec of MODELS) {
  face = null
  const mod = createModule(spec.paletteId, 0, 0, 0, `proof-${spec.paletteId}`, 0)
  assert.ok(mod, `${spec.paletteId}: createModule returned null`)
  assert.equal(mod.type, 'calligraphy', `${spec.paletteId}: expected a calligraphy module, got ${mod.type}`)
  assert.equal(mod.cfg.style, spec.style, `${spec.paletteId}: builder style ${mod.cfg.style}`)
  assert.equal(mod.cfg.axis, spec.axis, `${spec.paletteId}: builder axis ${mod.cfg.axis}`)
  // The panel is cut from the fallback name because there is no station document
  // behind this export: 横排 five cells at 1 m, 竖排 one 0.98 m column up to 2.6 m.
  assert.equal(mod.w, spec.cells, `${spec.paletteId}: panel cells ${mod.w} != ${spec.cells}`)
  assert.equal(mod.panelH, spec.panelHeight, `${spec.paletteId}: panel height ${mod.panelH} != ${spec.panelHeight}`)

  const root = buildModule(mod, ctx)
  assert.ok(root, `${spec.paletteId}: buildModule returned null`)
  assert.ok(face, `${spec.paletteId}: the builder did not ask ctx.calligraphyFace for its ink`)
  assert.equal(face.style, spec.style, `${spec.paletteId}: ink face style ${face.style}`)
  assert.equal(face.axis, spec.axis, `${spec.paletteId}: ink face axis ${face.axis}`)
  assert.ok(Math.abs(face.panel.w - spec.panelWidth) < 1e-6, `${spec.paletteId}: ink panel width ${face.panel.w}`)
  assert.ok(Math.abs(face.panel.h - spec.panelHeight) < 1e-6, `${spec.paletteId}: ink panel height ${face.panel.h}`)

  // `placeLocal` puts the piece at (x + 0.5 + dx, y + 0.5, z + 1); createModule
  // already cut the run's origin from the name (`trackOriginForCentre`), so every
  // one of the twelve lands on the same cell-centre offset. Record it once and
  // export from a stable local origin.
  const placementOffset = root.position.toArray()
  assert.ok(Math.abs(placementOffset[0] - 0.5) < 1e-6 && Math.abs(placementOffset[1] - 0.5) < 1e-6 &&
    Math.abs(placementOffset[2] - 1) < 1e-6, `${spec.paletteId}: unexpected placement offset ${placementOffset}`)
  root.position.set(0, 0, 0)
  root.rotation.set(0, 0, 0)
  root.updateMatrixWorld(true)

  // Strip renderer-only metadata (random UUIDs, artwork bindings) and name the
  // ink material for the hand and axis it carries, which is what lets Unity
  // tell the twelve styles apart.
  const paletteNames = new Map(Object.entries(mats).map(([name, material]) => [material, name]))
  const used = new Map()
  const alphaMaterials = new Set()
  const textures = new Set()
  let triangles = 0
  let meshes = 0
  root.traverse(object => {
    object.userData = {}
    if (!object.isMesh) return
    meshes++
    triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      assert.equal(paletteNames.get(material), undefined, `${spec.paletteId}: unexpected palette material ${paletteNames.get(material)}`)
      assert.equal(material, face.material, `${spec.paletteId}: the mesh is not wearing the ink face`)
      material.name = spec.ink
      used.set(material, spec.ink)
      if (material.transparent) alphaMaterials.add(spec.ink)
      if (material.map) textures.add(material.map)
    }
  })
  assert.equal(Number.isInteger(triangles), true, `${spec.paletteId}: triangle count is not an integer`)
  // The piece is one plane: one mesh, two triangles, one texture, one transparent
  // material — no board, no frame, no backing.
  assert.equal(meshes, 1, `${spec.paletteId}: expected one mesh, got ${meshes}`)
  assert.equal(triangles, 2, `${spec.paletteId}: expected two triangles, got ${triangles}`)
  assert.equal(textures.size, 1, `${spec.paletteId}: expected one texture, got ${textures.size}`)
  assert.deepEqual([...alphaMaterials], [spec.ink], `${spec.paletteId}: unexpected alpha materials`)
  assert.equal(face.material.transparent, true, `${spec.paletteId}: the ink must be transparent`)
  assert.equal(face.material.side, THREE.FrontSide, `${spec.paletteId}: the ink is a one-sided plate`)

  // Source-space bounds, before the glTF Z-up -> Y-up wrapper and before the
  // basis anchors are added (they must not widen the recorded envelope). The
  // plane has no thickness, so its y extent is the single ink offset.
  const bounds = new THREE.Box3().setFromObject(root)
  const size = bounds.getSize(new THREE.Vector3())
  const close = (actual, expected, tolerance, field) =>
    assert.ok(Math.abs(actual - expected) <= tolerance, `${spec.paletteId}: ${field} ${actual.toFixed(4)} != ${expected} (+-${tolerance})`)
  close(size.x, spec.panelWidth, 1e-6, 'panel width')
  close(size.z, spec.panelHeight, 1e-6, 'panel height')
  assert.ok(Math.abs(size.y) < 1e-6, `${spec.paletteId}: the ink plate has thickness ${size.y}`)
  close(bounds.min.y, -INK_OFFSET, 1e-6, 'ink offset')
  close(bounds.max.y, -INK_OFFSET, 1e-6, 'ink offset')
  close(bounds.min.z, calligraphyBottom(spec.axis), 1e-6, 'panel bottom')
  close(bounds.max.z, calligraphyBottom(spec.axis) + spec.panelHeight, 1e-6, 'panel top')
  close(bounds.min.x, -spec.panelWidth / 2, 1e-6, 'panel left')
  close(bounds.max.x, spec.panelWidth / 2, 1e-6, 'panel right')

  // The ink PNG is the model: hash it so the review can prove the twelve plates
  // differ (different hand, different axis) rather than trusting the names.
  const png = Buffer.from(await face.texture.image.encode('png'))
  const textureSha256 = createHash('sha256').update(png).digest('hex')
  assert.ok(png.length > 1024, `${spec.paletteId}: the ink PNG is suspiciously empty (${png.length} bytes)`)
  if (textureDigests.has(textureSha256)) {
    throw new Error(`${spec.paletteId}: its ink texture is identical to ${textureDigests.get(textureSha256)}`)
  }
  textureDigests.set(textureSha256, spec.paletteId)

  // Basis anchors, shared with bench/bin/cctv/shelf/printed. The ink plate faces
  // local +y; `Approach` is the wall the piece is mounted on.
  const anchors = {
    AxisX: [1, 0, 0],
    Front: [0, 1, 0],
    Up: [0, 0, 1],
    Approach: [0, -1, 0],
  }
  for (const [name, position] of Object.entries(anchors)) {
    const anchor = new THREE.Object3D()
    anchor.name = name
    anchor.position.fromArray(position)
    root.add(anchor)
  }

  const bottom = calligraphyBottom(spec.axis)
  const parameters = {
    style: spec.style,
    axis: spec.axis,
    sampleStationName: SAMPLE_NAME,
    panelWidthMetres: spec.panelWidth,
    panelHeightMetres: spec.panelHeight,
    panelCells: spec.cells,
    panelBottomMetres: bottom,
    panelCentreMetres: bottom + spec.panelHeight / 2,
    inkOffsetMetres: INK_OFFSET,
    wall: 'local -y (the piece is wall-mounted; the ink plate hangs 0.46 m off that face)',
    textureWidth: face.plate.width,
    textureHeight: face.plate.height,
    texture: `calligraphyPlate at 512 px/m (${face.plate.width} x ${face.plate.height}) drawn by drawCalligraphyPanel`,
    inscription: `sample inscription ${SAMPLE_NAME}: the prefab carries this one fixed sample text in every panel`,
    dynamicReprint: 'runtime binding: the live game reprints every 站名 from StationData.name through ctx.calligraphyFace (render/scene/systems/PlateSystem.ts); the prefab carries a sample inscription, not the live station name',
    artwork: 'transparent ink only: no board, no frame, no ground — the wall behind the piece is the inscription\'s paper',
  }

  const gltfRoot = new THREE.Group()
  gltfRoot.name = spec.prefab
  // Source space is Z-up. The single export transform rotates it into glTF
  // Y-up, exactly as the bench, bin, cctv, shelf and printed recipes do.
  gltfRoot.rotation.x = -Math.PI / 2
  gltfRoot.add(root)
  const bytes = new Uint8Array(await new GLTFExporter().parseAsync(gltfRoot, { binary: true }))
  const report = await validator.validateBytes(bytes, { uri: spec.file })
  const reportName = spec.file.replace(/\.glb$/, '.validation.json')
  await writeFile(join(out, reportName), JSON.stringify(report, null, 2) + '\n')
  assert.equal(
    report.issues.numErrors + report.issues.numWarnings,
    0,
    `${spec.file}: ${report.issues.numErrors} errors, ${report.issues.numWarnings} warnings. See ${reportName}`,
  )

  const manifest = {
    schemaVersion: 1,
    id: spec.id,
    catalogueId: spec.paletteId,
    paletteId: spec.paletteId,
    family: 'script',
    kind: 'calligraphy',
    style: spec.style,
    axis: spec.axis,
    prefab: spec.prefab,
    file: spec.file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    textureSha256,
    source: 'game/src/render/models/pieces/CalligraphyModel.ts',
    provenance: 'Repository procedural 站名 calligraphy piece: one transparent ink plate drawn by game/src/render/calligraphyFace.ts on the local -y wall; no board or frame',
    licenseRecord: 'Repository-authored procedural geometry and canvas lettering; no third-party assets',
    units: 'metres',
    placementOffset,
    min: bounds.min.toArray(),
    max: bounds.max.toArray(),
    size: size.toArray(),
    anchors,
    facade: 'local -y wall; the ink plate hangs 0.46 m proud of it, normal local +y',
    triangles,
    meshes,
    materials: [spec.ink],
    alphaMaterials: [spec.ink],
    textures: textures.size,
    textureWidth: face.plate.width,
    textureHeight: face.plate.height,
    rowPitchMetres: ROW_PITCH,
    inkMaterial: spec.ink,
    parameters,
    validation: { errors: report.issues.numErrors, warnings: report.issues.numWarnings },
  }
  await writeFile(join(out, spec.file), bytes)
  await writeFile(join(out, spec.file.replace(/\.glb$/, '.manifest.json')), JSON.stringify(manifest, null, 2) + '\n')
  assets.push(manifest)
  panels.push({
    paletteId: spec.paletteId,
    style: spec.style,
    axis: spec.axis,
    widthMetres: spec.panelWidth,
    heightMetres: spec.panelHeight,
    bottomMetres: bottom,
    rowPitchMetres: ROW_PITCH,
    textureWidth: face.plate.width,
    textureHeight: face.plate.height,
    textureSha256,
    inkMaterial: spec.ink,
  })
  console.log(
    `${spec.id}: ${triangles} triangles, ${meshes} mesh, ${spec.ink}, ${face.plate.width}x${face.plate.height} ink, ` +
      `${bytes.length} bytes, ${manifest.sha256}, ink ${textureSha256.slice(0, 16)}`,
  )
}

assert.equal(assets.length, MODELS.length, 'exported model count')
assert.equal(new Set(textureDigests.keys()).size, MODELS.length, 'the twelve ink plates must all differ')

const summary = {
  schemaVersion: 1,
  family: 'script',
  sourcePaths: [
    'game/src/render/models/pieces/CalligraphyModel.ts',
    'game/src/render/calligraphyFace.ts',
    'game/src/render/models/PieceBuilder.ts',
    'game/src/build/model/Equipment.ts',
    'game/src/sim/calligraphy.ts',
  ],
  parameters: {
    models: MODELS.length,
    rot: 0,
    sampleStationName: SAMPLE_NAME,
    sampleNameSource: 'one fixed sample inscription (人民广场) written into every panel; the live name is a runtime binding',
    dynamicReprint: 'runtime binding: the live game reprints every 站名 from StationData.name through ctx.calligraphyFace; the prefabs carry the sample inscription only',
    stationData: 'empty station document: { cells: [], modules: [], lines: [] } — createModule cuts each panel from the calligraphy fallback name 未命名车站, so 横排 is five cells (5 x 1 m) and 竖排 one 0.98 x 2.6 m column',
    placement: 'createModule(paletteId, 0, 0, 0, "proof-" + paletteId, 0) then buildModule(mod, ctx); the root placement offset is recorded and the export is built at the local origin',
    inkOffsetMetres: INK_OFFSET,
    mesh: 'one transparent 2-triangle ink plate per piece: no board, no frame, no backing',
    textureNote: 'each model exports exactly one canvas: the transparent ink plate, drawn by drawCalligraphyPanel at 512 px/m',
    canvasEncode: 'the palette uses Math.random for the brushed-steel grain (seeded 0x9e3779b9) and the canvas encodes are serialised through one promise queue, so image bufferViews keep traversal order between exports',
    basis: 'source Z-up tree wrapped in a group rotated -90 degrees about X (glTF Y-up); Unity wrapper applies the 180-degree Y correction so gameplay channels read (x, z, y)',
    row: '12 prefabs on 5.6 m centres in review-row order: the 横排 panels are 5 m wide, the 竖排 columns 0.98 m, so the row keeps a 0.6 m gap between the horizontal panels',
    panels,
  },
  assets,
  validation: {
    errors: assets.reduce((sum, asset) => sum + asset.validation.errors, 0),
    warnings: assets.reduce((sum, asset) => sum + asset.validation.warnings, 0),
  },
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(`SCRIPT_EXPORT_OK ${assets.length} models, ${summary.validation.errors} errors, ${summary.validation.warnings} warnings -> ${out}`)
