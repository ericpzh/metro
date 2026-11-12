import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Canvas, ImageData, createCanvas } from '@napi-rs/canvas'
import validator from 'gltf-validator'

// The 围栏 / 隔音屏障 / 盲道 (fence, noise barrier and tactile) family: the game's
// own module output for ten placed pieces, exported at a stable local origin.
//
// Fence geometry is neighbour-derived (`sim/fences.ts`): a cell draws a half
// panel toward every edge a fence, gate machine or stair landing touches. With
// no neighbours `fenceArms` caps both ends and the builder draws one isolated
// 1 m panel; runs, L-joins, gate butts and landing butts are runtime
// composition, so each prefab is that single panel.
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

// Same canvas adapter as export-bin/export-cctv: shadow `data` or GLTFExporter
// writes transparent black instead of the canvas pixels.
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
const { mergeGeometries } = await import(pathToFileURL(gameRequire.resolve('three/addons/utils/BufferGeometryUtils.js')).href)
// Imported after the seeded Math.random so the palette's brushed-steel grain is
// identical in every run.
const { createModelMaterials } = await import('../../game/src/render/models/PieceBuilder.ts')
const { createModule } = await import('../../game/src/build/model/Equipment.ts')
const { buildModule } = await import('../../game/src/render/models.ts')

const FAMILY = 'barrier'

/**
 * palette id | prefab | GLB | catalogue id. `variant` is the cfg.variant the
 * palette id maps to in `createModule` (Equipment.ts) and the branch the model
 * takes. `kind` is the module type the factory must produce.
 */
const MODELS = [
  { paletteId: 'fence', prefab: 'Fence', file: 'fence.glb', id: 'station.fence.glass', kind: 'fence', variant: 'glass',
    source: 'game/src/render/models/pieces/FenceModel.ts' },
  { paletteId: 'fence-gate', prefab: 'FenceGate', file: 'fence-gate.glb', id: 'station.fence.gate', kind: 'fence', variant: 'gate',
    source: 'game/src/render/models/pieces/FenceModel.ts' },
  { paletteId: 'fence-iron', prefab: 'FenceIron', file: 'fence-iron.glb', id: 'station.fence.iron', kind: 'fence', variant: 'iron',
    source: 'game/src/render/models/pieces/FenceModel.ts' },
  { paletteId: 'fence-steel-blue', prefab: 'FenceSteelBlue', file: 'fence-steel-blue.glb', id: 'station.fence.steel-blue', kind: 'fence', variant: 'steel-blue',
    source: 'game/src/render/models/pieces/BlueSteelFence.ts' },
  { paletteId: 'noise-barrier', prefab: 'NoiseBarrier', file: 'noise-barrier.glb', id: 'station.noise-barrier.full', kind: 'fence', variant: 'sound-barrier',
    source: 'game/src/render/models/pieces/NoiseBarrierModel.ts' },
  { paletteId: 'noise-barrier-half', prefab: 'NoiseBarrierHalf', file: 'noise-barrier-half.glb', id: 'station.noise-barrier.half', kind: 'fence', variant: 'sound-barrier-half',
    source: 'game/src/render/models/pieces/NoiseBarrierModel.ts' },
  { paletteId: 'noise-barrier-railing', prefab: 'NoiseBarrierRailing', file: 'noise-barrier-railing.glb', id: 'station.noise-barrier.railing', kind: 'fence', variant: 'bridge-railing',
    source: 'game/src/render/models/pieces/NoiseBarrierModel.ts' },
  { paletteId: 'tactile-guide', prefab: 'TactileGuide', file: 'tactile-guide.glb', id: 'station.tactile.guide', kind: 'tactile', variant: 'guide',
    source: 'game/src/render/models/pieces/TactileModel.ts' },
  { paletteId: 'tactile-warning', prefab: 'TactileWarning', file: 'tactile-warning.glb', id: 'station.tactile.warning', kind: 'tactile', variant: 'warning',
    source: 'game/src/render/models/pieces/TactileModel.ts' },
  { paletteId: 'tactile-warning-strip', prefab: 'TactileWarningStrip', file: 'tactile-warning-strip.glb', id: 'station.tactile.warning-strip', kind: 'tactile', variant: 'warning-strip',
    source: 'game/src/render/models/pieces/TactileModel.ts' },
]

/** The single 1 m panel the fence family exports, in cell-pitch metres. */
const FENCE_PANEL_PITCH = 1
/** The noise barrier's ground offset inside its module origin (`base` in NoiseBarrierModel). */
const NOISE_BARRIER_BASE = { 'sound-barrier': 0.5, 'sound-barrier-half': 0.5, 'bridge-railing': 0.55 }
/** Canonical tactile tile plan, metres. */
const TACTILE_TILE = { width: 1, depth: 0.45, thickness: 0.012 }

const COMPOSITION = {
  fence: 'isolated panel: no fence, gate or rail-landing neighbour, so fenceArms caps both ends of the rot 0 +x axis. '
    + 'Runs, L-joins, T/+ junctions, gate butts and stair/escalator-landing butts are runtime composition; '
    + 'the prefab is one isolated 1 m panel.',
  tactile: 'isolated flat tile at rot 0: no tactile neighbour, so tactileArms is empty and the tile keeps its bare '
    + 'base slab. Run continuation, L/T/+ junction arms are runtime composition; the prefab is one tile.',
}

// Builder-minted materials need a stable name from their authored colour. The
// blue steel fence is the only one in this family (0x175585).
const OWNED_NAMES = new Map([[0x175585, 'steelBlueFence']])

const mats = createModelMaterials()
// Empty station document: no neighbours, no slab over the cell and no track
// deck, so every builder takes its isolated/ground path at rot 0.
const data = { cells: [], modules: [], lines: [], name: 'Station', nameEn: 'Station' }
const ctx = {
  mats, data, ads: {}, trackCells: new Set(),
  // Stairs (and any finish-aware builder) call this. Use a solid palette material.
  finish: (name) => (name === 'granite' ? mats.steel : mats.darkSteel),
}

const out = resolve(process.argv[2] ?? '.preview/unity/barrier-proof/export')
await mkdir(out, { recursive: true })

/** Drop float fuzz at the origin (the fence shoe sits at ~7.7e-10 m, not 0). */
const clean = values => values.map(value => (Math.abs(value) < 1e-6 ? 0 : value))

/**
 * GLTFExporter silently exports only the base geometry of an `InstancedMesh`
 * and drops every instance matrix. The 盲道 warning strip is one dot field
 * (~60 cylinders); bake each instance matrix into an ordinary indexed
 * geometry and replace the InstancedMesh with a plain Mesh under the same
 * material, so the merged dot field is what the GLB carries.
 */
function mergeInstancedMeshes(root) {
  const batches = []
  root.traverse(object => { if (object.isInstancedMesh) batches.push(object) })
  let instances = 0
  let dotTriangles = 0
  for (const batch of batches) {
    const matrix = new THREE.Matrix4()
    const geometries = []
    for (let i = 0; i < batch.count; i++) {
      batch.getMatrixAt(i, matrix)
      geometries.push(batch.geometry.clone().applyMatrix4(matrix))
    }
    const merged = mergeGeometries(geometries, false)
    assert.ok(merged, 'could not merge the instanced dot geometry')
    for (const geometry of geometries) geometry.dispose()
    const mesh = new THREE.Mesh(merged, batch.material)
    mesh.name = 'tactileDots'
    batch.parent.add(mesh)
    batch.parent.remove(batch)
    instances += batch.count
    dotTriangles += (merged.index?.count ?? merged.getAttribute('position').count) / 3
  }
  return { instances, dotTriangles }
}

const paletteNames = new Map(Object.entries(mats).map(([name, material]) => [material, name]))
const assets = []

for (const spec of MODELS) {
  const mod = createModule(spec.paletteId, 0, 0, 0, `proof-${spec.paletteId}`, 0)
  assert.ok(mod, `${spec.paletteId}: createModule returned null`)
  assert.equal(mod.type, spec.kind, `${spec.paletteId}: expected a ${spec.kind} module, got ${mod.type}`)
  assert.equal(mod.cfg.variant, spec.variant, `${spec.paletteId}: unexpected variant ${mod.cfg.variant}`)

  const root = buildModule(mod, ctx)
  assert.ok(root, `${spec.paletteId}: buildModule returned null`)
  // The builder places the piece at its cell; export from a stable local origin
  // and record the placement offset once.
  const placementOffset = root.position.toArray()
  root.position.set(0, 0, 0)
  root.rotation.set(0, 0, 0)
  root.updateMatrixWorld(true)

  const dots = mergeInstancedMeshes(root)

  // Renderer-only LOD metadata and shared-geometry tags contain random UUIDs.
  // This recipe exports the full-detail source meshes and keeps its metadata in
  // the manifest.
  root.traverse(object => { object.userData = {} })

  const used = new Map()
  const named = new Set()
  const alphaMaterials = new Set()
  const glassMaterials = new Set()
  const textures = new Set()
  let triangles = 0
  let meshes = 0
  root.traverse(object => {
    if (!object.isMesh) return
    meshes++
    const geometry = object.geometry
    triangles += (geometry.index?.count ?? geometry.getAttribute('position').count) / 3
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      let name = used.get(material)
      if (!name) {
        name = paletteNames.get(material)
        if (!name) {
          // A material a builder mints for this call: name it by its authored
          // colour so the recipe is deterministic and Unity can assert the slot.
          const hex = material.color?.getHex()
          name = OWNED_NAMES.get(hex) ?? `barrierMaterial-${(hex ?? 0).toString(16).padStart(6, '0')}`
        }
        if (named.has(name)) {
          let suffix = 2
          while (named.has(`${name}${suffix}`)) suffix++
          name = `${name}${suffix}`
        }
        material.name = name
        used.set(material, name)
        named.add(name)
      }
      if (material.transparent) alphaMaterials.add(name)
      if (material === mats.glass) glassMaterials.add(name)
      if (material.map) textures.add(name)
    }
  })
  assert.equal(Number.isInteger(triangles), true, `${spec.paletteId} triangle count is not an integer`)

  const bounds = new THREE.Box3().setFromObject(root)
  const size = bounds.getSize(new THREE.Vector3())

  // Basis anchors match the bench/bin/cctv recipes. `Front` is the piece's own
  // forward face (+y) and `Approach` the ground a viewer arrives from (-y).
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

  const gltfRoot = new THREE.Group()
  gltfRoot.name = spec.prefab
  // Source space is Z-up. The single export transform rotates it into glTF
  // Y-up, exactly as the bench/bin/cctv recipes do.
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

  const isNoiseBarrier = spec.variant in NOISE_BARRIER_BASE
  const isTactile = spec.kind === 'tactile'
  const parameters = {
    variant: spec.variant,
    rot: 0,
    composition: COMPOSITION[spec.kind],
    widthMetres: size.x,
    depthMetres: size.y,
    heightMetres: size.z,
    isolatedPanel: spec.kind === 'fence',
    ...(isNoiseBarrier ? {
      noiseBarrierBaseMetres: NOISE_BARRIER_BASE[spec.variant],
      fixture: spec.variant === 'bridge-railing' ? 'BridgeRailing.buildBridgeRailing' : 'BridgeNoiseBarrier.buildBridgeNoiseBarrier',
    } : {}),
    ...(isTactile ? {
      tileWidthMetres: TACTILE_TILE.width,
      tileDepthMetres: TACTILE_TILE.depth,
      tileThicknessMetres: TACTILE_TILE.thickness,
      dotInstances: dots.instances,
    } : {}),
  }

  const manifest = {
    schemaVersion: 1,
    id: spec.id,
    paletteId: spec.paletteId,
    family: FAMILY,
    variant: spec.variant,
    prefab: `${spec.prefab}.prefab`,
    file: spec.file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: spec.source,
    provenance: 'Repository-authored procedural fence / noise-barrier / tactile geometry, palette and canvas grain',
    licenseRecord: 'Repository-authored procedural geometry; no third-party assets',
    units: 'metres',
    placementOffset: clean(placementOffset),
    min: clean(bounds.min.toArray()),
    max: clean(bounds.max.toArray()),
    sizeMetres: clean(size.toArray()),
    anchors,
    triangles,
    meshes,
    materials: [...used.values()].sort(),
    alphaMaterials: [...alphaMaterials].sort(),
    glassMaterials: [...glassMaterials].sort(),
    textures: textures.size,
    dotInstances: dots.instances,
    dotTriangles: dots.dotTriangles,
    parameters,
    validation: { errors: report.issues.numErrors, warnings: report.issues.numWarnings },
  }
  await writeFile(join(out, spec.file), bytes)
  await writeFile(join(out, spec.file.replace(/\.glb$/, '.manifest.json')), JSON.stringify(manifest, null, 2) + '\n')
  assets.push(manifest)
  console.log(
    `${spec.id}: ${triangles} triangles, ${manifest.materials.length} materials `
      + `(${manifest.alphaMaterials.length} alpha), ${textures.size} textures, `
      + `${size.x.toFixed(3)} x ${size.y.toFixed(3)} x ${size.z.toFixed(3)} m, ${bytes.length} bytes, ${manifest.sha256}`,
  )
}

const byId = new Map(assets.map(asset => [asset.id, asset]))
const fence = byId.get('station.fence.glass')
assert.ok(fence, 'the isolated fence panel is missing')
const summary = {
  schemaVersion: 1,
  family: FAMILY,
  sourcePaths: [
    'game/src/render/models/pieces/FenceModel.ts',
    'game/src/render/models/pieces/BlueSteelFence.ts',
    'game/src/render/models/pieces/NoiseBarrierModel.ts',
    'game/src/render/models/pieces/BridgeNoiseBarrier.ts',
    'game/src/render/models/pieces/BridgeRailing.ts',
    'game/src/render/models/pieces/TactileModel.ts',
    'game/src/render/models/PieceBuilder.ts',
    'game/src/build/model/Equipment.ts',
  ],
  parameters: {
    assetCount: assets.length,
    stationData: 'empty station document: { cells: [], modules: [], lines: [] }',
    rot: 0,
    isolatedPanel: true,
    fencePanelPitchMetres: FENCE_PANEL_PITCH,
    fencePanelWidthMetres: fence.sizeMetres[0],
    runtimeComposition: COMPOSITION.fence,
    tactileComposition: COMPOSITION.tactile,
    noiseBarrierGeometry: 'NoiseBarrierModel reuses buildBridgeNoiseBarrier (sound-barrier, sound-barrier-half) and '
      + 'buildBridgeRailing (bridge-railing): the bridge barrier geometry stood on the ground at one metre.',
    soundBarrierHeightMetres: byId.get('station.noise-barrier.full').sizeMetres[2],
    soundBarrierHalfHeightMetres: byId.get('station.noise-barrier.half').sizeMetres[2],
    bridgeRailingHeightMetres: byId.get('station.noise-barrier.railing').sizeMetres[2],
    tactileTileWidthMetres: TACTILE_TILE.width,
    tactileTileDepthMetres: TACTILE_TILE.depth,
    tactileTileThicknessMetres: TACTILE_TILE.thickness,
    tactileBasis: 'flat tile lies in the source XY plane and keeps its thin +z (0.012 m) height',
    tactileDotsMerged: true,
    tactileWarningStripInstances: byId.get('station.tactile.warning-strip').dotInstances,
    tactileDots: 'GLTFExporter drops InstancedMesh instances, so the dot field matrices are merged into one ordinary '
      + 'indexed geometry under the same tactile material before export; the prefab keeps the merged dot mesh.',
    basis: 'source Z-up tree wrapped in a group rotated -90 degrees about X (glTF Y-up); the Unity wrapper applies '
      + 'the 180-degree Y correction so gameplay channels read (x, z, y)',
    palette: 'createModelMaterials() with a fixed-seed brushed-steel grain so the steel canvas is byte-identical '
      + 'between runs; steel, glass, white, darkSteel and tactile are the palette slots the builders read',
    textures: 'the brushed steel canvas map is exported on every asset that uses the steel slot; the blue steel '
      + 'fence and the tactile tiles are texture-free',
  },
  assets,
  validation: {
    errors: assets.reduce((sum, asset) => sum + asset.validation.errors, 0),
    warnings: assets.reduce((sum, asset) => sum + asset.validation.warnings, 0),
  },
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(`${FAMILY}: ${assets.length} models, ${summary.validation.errors} errors, ${summary.validation.warnings} warnings`)
