import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Canvas, ImageData, createCanvas } from '@napi-rs/canvas'
import validator from 'gltf-validator'

// The 玻璃板 (glass panel) family: ten 玻璃板 / 玻璃幕墙 sizes plus the default
// 玻璃幕墙 placement. Every model is the game's own GlassModel output for one
// placed module, exported at a stable local origin.
//
// The palette prints a brushed-steel canvas (PieceBuilder's `brushedCanvas`
// scatters 700 grain lines with Math.random). Two processes would otherwise
// produce different PNG bytes and therefore different GLB hashes, which the
// proof runner's repeat-export gate rejects, so the grain is drawn from a
// fixed-seed generator. Everything else in the palette is solid colour.
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

// The palette prints canvas textures (steel grain) through the DOM. Same
// adapter as export-bin/export-monitor: shadow `data` or GLTFExporter writes
// transparent black.
globalThis.HTMLCanvasElement = Canvas
globalThis.ImageData = ImageData
globalThis.document = {
  createElement(name) {
    assert.equal(name, 'canvas')
    const canvas = createCanvas(1, 1)
    Object.defineProperty(canvas, 'data', { value: undefined })
    canvas.toBlob = async (callback, mime) => {
      const bytes = await canvas.encode(mime === 'image/jpeg' ? 'jpeg' : 'png')
      callback(new Blob([bytes], { type: mime }))
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
const { createModelMaterials } = await import('../../game/src/render/models/PieceBuilder.ts')
const { createModule } = await import('../../game/src/build/model/Equipment.ts')
const { buildModule } = await import('../../game/src/render/models.ts')

const mats = createModelMaterials()
// Empty station document: no neighbours, no slab over the cell and no track
// deck, so the builder takes its plain outer-frame path at rot 0. Door
// cut-outs and joined ends are runtime composition and are out of scope.
const data = { cells: [], modules: [], lines: [], name: 'Station', nameEn: 'Station' }
const ctx = {
  mats, data, ads: {}, trackCells: new Set(),
  finish: (name) => (name === 'granite' ? mats.steel : mats.darkSteel),
}

/** The ten 玻璃板 sizes and the default 2 x 4 m 玻璃幕墙 (GLASS_SPECS). */
const MODELS = [
  { paletteId: 'glass-1x1', variant: '1x1', width: 1, height: 1, prefab: 'Glass1x1', file: 'glass-1x1.glb', id: 'station.glass.panel-1x1' },
  { paletteId: 'glass-1x2', variant: '1x2', width: 1, height: 2, prefab: 'Glass1x2', file: 'glass-1x2.glb', id: 'station.glass.panel-1x2' },
  { paletteId: 'glass-1x4', variant: '1x4', width: 1, height: 4, prefab: 'Glass1x4', file: 'glass-1x4.glb', id: 'station.glass.panel-1x4' },
  { paletteId: 'glass-2x1', variant: '2x1', width: 2, height: 1, prefab: 'Glass2x1', file: 'glass-2x1.glb', id: 'station.glass.panel-2x1' },
  { paletteId: 'glass-2x2', variant: '2x2', width: 2, height: 2, prefab: 'Glass2x2', file: 'glass-2x2.glb', id: 'station.glass.panel-2x2' },
  { paletteId: 'glass-2x4', variant: '2x4', width: 2, height: 4, prefab: 'Glass2x4', file: 'glass-2x4.glb', id: 'station.glass.panel-2x4' },
  { paletteId: 'glass-3x1', variant: '3x1', width: 3, height: 1, prefab: 'Glass3x1', file: 'glass-3x1.glb', id: 'station.glass.panel-3x1' },
  { paletteId: 'glass-3x2', variant: '3x2', width: 3, height: 2, prefab: 'Glass3x2', file: 'glass-3x2.glb', id: 'station.glass.panel-3x2' },
  { paletteId: 'glass-3x4', variant: '3x4', width: 3, height: 4, prefab: 'Glass3x4', file: 'glass-3x4.glb', id: 'station.glass.panel-3x4' },
  { paletteId: 'glass-4x4', variant: '4x4', width: 4, height: 4, prefab: 'Glass4x4', file: 'glass-4x4.glb', id: 'station.glass.panel-4x4' },
  // 玻璃幕墙 default placement: the palette tile creates the 2 x 4 m panel with
  // an explicit `curtainHeight: 4`. Same geometry as glass-2x4 (see `variants`).
  {
    paletteId: 'curtain-wall', variant: '2x4', width: 2, height: 4, prefab: 'CurtainWall', file: 'curtain-wall.glb',
    id: 'station.glass.curtain-wall', curtainHeight: 4,
  },
]

// GLASS_FRAME from game/src/sim/glassPanels.ts, repeated here so the manifest
// records the numbers the review asserts instead of re-reading the module.
const FRAME = { depth: 0.1, rail: 0.1, post: 0.1, pane: 0.02 }
/** GlassModel's WALL_OFFSET: short panels hang this far off the local -y wall. */
const WALL_OFFSET = 0.44

const out = resolve(process.argv[2] ?? '.preview/unity/glass-proof/export')
await mkdir(out, { recursive: true })

/** One module, built by the game's own factory and dispatcher. */
function build(spec) {
  const settings = spec.curtainHeight === undefined ? undefined : { curtainHeight: spec.curtainHeight }
  // createModule's width argument is the 玻璃幕墙/门-style run width; the plain
  // 玻璃板 palette ids take their width from the palette table instead.
  const mod = createModule(
    spec.paletteId, 0, 0, 0, `proof-${spec.paletteId}`, 0,
    spec.paletteId === 'curtain-wall' ? spec.width : undefined,
    'up', 'lane', [], undefined,
    ...(settings ? [settings] : []),
  )
  assert.ok(mod, `${spec.paletteId}: createModule returned null`)
  assert.equal(mod.type, 'glass', `${spec.paletteId}: expected a glass module, got ${mod.type}`)
  const root = buildModule(mod, ctx)
  assert.ok(root, `${spec.paletteId}: buildModule returned null`)
  // GlassModel centres the run on its tile and puts the assembly on the wall /
  // floor edge. Export from a stable local origin and record the placement once.
  const placementOffset = root.position.toArray()
  root.position.set(0, 0, 0)
  root.rotation.set(0, 0, 0)
  root.updateMatrixWorld(true)
  return { mod, root, placementOffset }
}

const assets = []
for (const spec of MODELS) {
  const { mod, root, placementOffset } = build(spec)
  const standsOnFloor = spec.height >= 4
  assert.equal(mod.w, spec.width, `${spec.paletteId}: builder run ${mod.w} != ${spec.width}`)

  // Source-space bounds, before the glTF Z-up -> Y-up wrapper.
  const bounds = new THREE.Box3().setFromObject(root)
  // Basis anchors, shared with bench/bin/cctv: `Approach` is the piece's own
  // front, and the pane faces local +y away from the wall at -y.
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

  const paletteNames = new Map(Object.entries(mats).map(([name, material]) => [material, name]))
  const used = new Map()
  const alphaMaterials = new Set()
  const glassMaterials = new Set()
  const textures = new Set()
  let triangles = 0
  let meshes = 0
  root.traverse(object => {
    // Renderer-only LOD metadata (`lowDetailGeometry`) carries random UUIDs.
    // This recipe exports the full-detail source meshes and keeps its metadata
    // in the manifest.
    object.userData = {}
    if (!object.isMesh) return
    meshes++
    triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      let name = used.get(material)
      if (!name) {
        name = paletteNames.get(material) ?? (material.map ? 'paletteMapped' : `palette-${material.color.getHexString()}`)
        // Nothing in this builder mints its own material, so the palette map is
        // the whole story; name the material so the GLB (and so Unity's imported
        // material slots) carry a deterministic name rather than an empty one.
        material.name = name
        used.set(material, name)
      }
      if (material.transparent) alphaMaterials.add(name)
      if (name.toLowerCase().includes('glass')) glassMaterials.add(name)
      if (material.map) textures.add(material.map)
    }
  })
  assert.equal(Number.isInteger(triangles), true, `${spec.paletteId}: triangle count is not an integer`)
  // 5 boxes (sill, head, two posts, one pane) x 12 triangles. A different count
  // means the builder took a composition path this recipe does not model.
  assert.equal(meshes, 5, `${spec.paletteId}: expected 5 meshes, got ${meshes}`)
  assert.equal(triangles, 60, `${spec.paletteId}: expected 60 triangles, got ${triangles}`)

  const gltfRoot = new THREE.Group()
  gltfRoot.name = spec.prefab
  // Source space is Z-up. The single export transform rotates it into glTF
  // Y-up, exactly as the bench, bin and cctv recipes do.
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

  const materials = [...used.values()].sort()
  const parameters = {
    widthMetres: spec.width,
    heightMetres: spec.height,
    mount: standsOnFloor ? 'floor-edge' : 'wall',
    wallOffsetMetres: standsOnFloor ? 0 : WALL_OFFSET,
    frameDepthMetres: FRAME.depth,
    frameRailMetres: FRAME.rail,
    framePostMetres: FRAME.post,
    paneProudMetres: FRAME.pane,
    panelsPerRun: 1,
    nodeCount: 5,
  }
  const manifest = {
    schemaVersion: 1,
    id: spec.id,
    catalogueId: spec.paletteId,
    paletteId: spec.paletteId,
    family: 'glass',
    variant: spec.variant,
    prefab: spec.prefab,
    file: spec.file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: 'game/src/render/models/pieces/GlassModel.ts',
    provenance: 'Repository-authored procedural 玻璃板 frame, posts and pane from game/src/render/models/pieces/GlassModel.ts',
    licenseRecord: 'Repository-authored procedural geometry; no third-party assets',
    units: 'metres',
    placementOffset,
    min: bounds.min.toArray(),
    max: bounds.max.toArray(),
    size: bounds.getSize(new THREE.Vector3()).toArray(),
    anchors,
    mount: standsOnFloor ? 'floor-edge' : 'wall',
    facade: 'local +y (wall at -y)',
    widthMetres: spec.width,
    heightMetres: spec.height,
    wallOffsetMetres: standsOnFloor ? 0 : WALL_OFFSET,
    frame: FRAME,
    // 0 for every plain 玻璃板; 4 for the 玻璃幕墙 placement (the palette tile's
    // explicit `curtainHeight`). Kept numeric so JsonUtility reads one shape.
    curtainHeightMetres: spec.curtainHeight ?? 0,
    triangles,
    meshes,
    materials,
    alphaMaterials: [...alphaMaterials].sort(),
    glassMaterials: [...glassMaterials].sort(),
    textures: textures.size,
    parameters,
    validation: { errors: report.issues.numErrors, warnings: report.issues.numWarnings },
  }
  await writeFile(join(out, spec.file), bytes)
  await writeFile(join(out, spec.file.replace(/\.glb$/, '.manifest.json')), JSON.stringify(manifest, null, 2) + '\n')
  assets.push(manifest)
  console.log(
    `${spec.id}: ${triangles} triangles, ${materials.length} materials (${manifest.alphaMaterials.length} alpha), ` +
      `${textures.size} textures, ${bytes.length} bytes, ${manifest.sha256}`,
  )
}

const summary = {
  schemaVersion: 1,
  family: 'glass',
  sourcePaths: [
    'game/src/render/models/pieces/GlassModel.ts',
    'game/src/render/models/PieceBuilder.ts',
    'game/src/build/model/Equipment.ts',
    'game/src/sim/glassPanels.ts',
  ],
  parameters: {
    models: MODELS.length,
    stationData: 'empty station document: { cells: [], modules: [], lines: [] }',
    rotation: 'rot 0, no neighbours: every asset is one module in the builder outer-frame path; door cut-outs and joined ends are runtime composition and are not exported',
    wallOffsetMetres: WALL_OFFSET,
    wallOffsetSource: 'GlassModel WALL_OFFSET: short panels hang 0.44 m off the local -y wall',
    floorStandingFromHeightMetres: 4,
    floorStandingSource: 'glassStandsOnFloor: 4 m panels and the 玻璃幕墙 stand on the floor edge instead of the wall',
    sizes: 'width 1/2/3/4 m x height 1/2/4 m (GLASS_SPECS); the 1x2, 2x2, 3x2 sizes are wall-mounted 2 m windows',
    curtainWall: {
      settings: '{ curtainHeight: 4 }',
      widthMetres: 2,
      heightMetres: 4,
      sharesBuilderWith: 'glass-2x4',
      note: 'the palette tile passes width 2 and curtainHeight 4, so createModule selects variant 2x4 and omits the curtainHeight override; the exported geometry is the 2 x 4 m floor-standing panel',
    },
    frame: FRAME,
    nodes: '5 meshes per panel: darkSteel sill, darkSteel head, two steel end posts, one glass pane',
    palette: 'steel (brushed canvas map), darkSteel, glass (transparent 0.26, double sided)',
    textures: 'one 64 px brushed-steel canvas map; the grain is drawn from a fixed-seed generator so the exported PNG is byte-stable',
    basis: 'source Z-up tree wrapped in a group rotated -90 degrees about X (glTF Y-up); Unity wrapper applies the 180-degree Y correction',
  },
  assets,
  validation: {
    errors: assets.reduce((sum, asset) => sum + asset.validation.errors, 0),
    warnings: assets.reduce((sum, asset) => sum + asset.validation.warnings, 0),
  },
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(`GLASS_EXPORT_OK ${assets.length} models, ${summary.validation.errors} errors, ${summary.validation.warnings} warnings -> ${out}`)
