import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Canvas, ImageData, createCanvas } from '@napi-rs/canvas'
import validator from 'gltf-validator'

// The stair palette is the game's own `createModelMaterials()` kit, which prints
// the brushed-steel canvas. Use the same `@napi-rs/canvas` adapter as export-bin /
// export-train so the stainless grain is real pixels: Three's GLTFExporter treats
// any image with a `data` property as a DataTexture and would write transparent
// black, so the shim shadows `data` and provides `toBlob`.
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

// GLTFExporter reads each encoded canvas Blob back through a FileReader.
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
const { createModelMaterials } = await import('../../game/src/render/models/PieceBuilder.ts')
const { createModule } = await import('../../game/src/build/model/Equipment.ts')
const { buildModule } = await import('../../game/src/render/models.ts')

// Canonical placement parameters (the palette's narrow size on the default
// five-metre storey). `createModule` derives every flight, landing and cfg from
// these; the recipe never hand-rolls a flight.
const STOREY_HEIGHT = 5
/** 窄: `STAIR_WIDTH_NARROW` = `ESCALATOR_BAND` (0.68 m tread band, one 1 m block). */
const WIDTH = 0.68
const WIDTH_TOKEN = 'narrow'
const BLOCK_WIDTH = 1
/** Default single-span stair length: 长, 5 m of climb over 8 cells of run. */
const RAMP_LENGTH = 'long'
const RAMP_RISE = 5
const RAMP_RUN = 8

// Palette id | prefab | GLB | catalogue id. Prefab names are the wrapper root
// names in ReviewStair.cs.
const variants = [
  { paletteId: 'stair-straight', variant: 'straight', file: 'stair-straight.glb', prefab: 'StairStraight', id: 'station.stair.straight' },
  { paletteId: 'stair-block', variant: 'block', file: 'stair-block.glb', prefab: 'StairBlock', id: 'station.stair.block' },
  { paletteId: 'stair-leftForward', variant: 'leftForward', file: 'stair-leftForward.glb', prefab: 'StairLeftForward', id: 'station.stair.left-forward' },
  { paletteId: 'stair-centerForward', variant: 'centerForward', file: 'stair-centerForward.glb', prefab: 'StairCenterForward', id: 'station.stair.center-forward' },
  { paletteId: 'stair-rightForward', variant: 'rightForward', file: 'stair-rightForward.glb', prefab: 'StairRightForward', id: 'station.stair.right-forward' },
  { paletteId: 'stair-left90', variant: 'left90', file: 'stair-left90.glb', prefab: 'StairLeft90', id: 'station.stair.left-90' },
  { paletteId: 'stair-right90', variant: 'right90', file: 'stair-right90.glb', prefab: 'StairRight90', id: 'station.stair.right-90' },
  { paletteId: 'stair-left180', variant: 'left180', file: 'stair-left180.glb', prefab: 'StairLeft180', id: 'station.stair.left-180' },
  { paletteId: 'stair-right180', variant: 'right180', file: 'stair-right180.glb', prefab: 'StairRight180', id: 'station.stair.right-180' },
]

const out = resolve(process.argv[2] ?? '.preview/unity/stair-proof/export')
await mkdir(out, { recursive: true })

// `createModelMaterials` prints the palette's 64 px brushed-stainless canvas,
// whose grain comes from `Math.random` (`brushedCanvas`). Seed the generator for
// the duration of the call so the grain — and therefore every GLB that embeds
// it — is byte-identical between runs. The original generator is restored at
// once; nothing else in this recipe consumes randomness.
function seededRandom(seed) {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const random = Math.random
let mats
try {
  Math.random = seededRandom(0x53544149) // 'STAI'
  mats = createModelMaterials()
} finally {
  Math.random = random
}
// The stair builder asks its context for a floor finish (`stairSurface`). The
// export uses one named solid concrete so the treads, risers and turn landings
// are their own material rather than borrowing a palette slot. With an empty
// station document there is no cell finish to inherit, so DEFAULT_MATERIAL falls
// back to the same solid.
const stairFinish = new THREE.MeshStandardMaterial({
  name: 'stairFinish',
  color: 0xb5b0a6,
  roughness: 0.86,
  metalness: 0.04,
  vertexColors: true,
})

const data = { cells: [], modules: [], lines: [], name: 'Station', nameEn: 'Station' }
const ctx = {
  mats,
  data,
  ads: {},
  trackCells: new Set(),
  // Stairs only; every finish id resolves to the one concrete material because
  // the empty document has no authored cell finish and the piece gains no walls.
  finish: () => stairFinish,
}

const anchors = {
  AxisX: [1, 0, 0],
  Front: [0, 1, 0],
  Up: [0, 0, 1],
  Approach: [0, -1, 0],
}

/** Six decimals keeps the manifest readable and stays far inside Unity's 1 mm check. */
const round = (value) => Number(value.toFixed(6))

function build(paletteId) {
  const mod = createModule(paletteId, 0, 0, 0, `proof-${paletteId}`, 0)
  assert.ok(mod, `${paletteId}: createModule returned null`)
  assert.equal(mod.type, 'stair', `${paletteId}: expected a stair module`)
  const root = buildModule(mod, ctx)
  assert.ok(root, `${paletteId}: buildModule returned null`)
  // buildStair works in world space; the block is positioned by `placeLocal`.
  // Record the placement once and export every model from its own local origin.
  const placementOffset = root.position.toArray()
  root.position.set(0, 0, 0)
  root.rotation.set(0, 0, 0)
  root.updateMatrixWorld(true)
  return { mod, root, placementOffset }
}

const assets = []
for (const spec of variants) {
  const { mod, root, placementOffset } = build(spec.paletteId)
  const bounds = new THREE.Box3().setFromObject(root)
  assert.ok(bounds.isEmpty() === false, `${spec.variant}: empty bounds`)

  const paletteNames = new Map(Object.entries(mats).map(([name, material]) => [material, name]))
  const used = new Map()
  const named = new Set()
  const alphaMaterials = new Set()
  const glassMaterials = new Set()
  const textures = new Set()
  let triangles = 0
  let meshes = 0
  root.traverse(object => {
    // Renderer-only LOD metadata (`lowDetailGeometry`, shared-geometry tags) and
    // the placement UUIDs live in userData; the GLB must not carry either.
    object.userData = {}
    // GLTFExporter silently exports only the base geometry of an InstancedMesh,
    // so a stair that ever grows one has to bake its instances first. The current
    // builder mints plain meshes only; fail loudly if that changes.
    assert.notEqual(object.isInstancedMesh, true, `${spec.variant}: bake InstancedMesh before export`)
    if (!object.isMesh) return
    meshes++
    const geometry = object.geometry
    triangles += (geometry.index?.count ?? geometry.getAttribute('position').count) / 3
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      let name = used.get(material)
      if (!name) {
        name = paletteNames.get(material) ?? (material.name || `stairMaterial${used.size}`)
        if (named.has(name)) {
          let suffix = 2
          while (named.has(`${name}${suffix}`)) suffix++
          name = `${name}${suffix}`
        }
        used.set(material, name)
        named.add(name)
        material.name = name
      }
      if (material === mats.glass) glassMaterials.add(name)
      if (material.transparent) alphaMaterials.add(name)
      if (material.map) textures.add(material.map)
    }
  })
  assert.ok(Number.isInteger(triangles), `${spec.variant}: triangle count is not an integer`)

  for (const [name, position] of Object.entries(anchors)) {
    const anchor = new THREE.Object3D()
    anchor.name = name
    anchor.position.fromArray(position)
    root.add(anchor)
  }

  const gltfRoot = new THREE.Group()
  gltfRoot.name = spec.prefab
  // Source space is Z-up; the single export transform rotates it into glTF Y-up,
  // exactly as the bench, bin and CCTV recipes do.
  gltfRoot.rotation.x = -Math.PI / 2
  gltfRoot.add(root)
  const bytes = new Uint8Array(await new GLTFExporter().parseAsync(gltfRoot, { binary: true }))
  const report = await validator.validateBytes(bytes, { uri: spec.file })
  await writeFile(join(out, `${spec.file.replace(/\.glb$/, '')}.validation.json`), JSON.stringify(report, null, 2) + '\n')
  assert.equal(report.issues.numErrors + report.issues.numWarnings, 0, `See ${spec.file.replace(/\.glb$/, '')}.validation.json`)

  const materials = [...used.values()].sort()
  const manifest = {
    schemaVersion: 1,
    id: spec.id,
    paletteId: spec.paletteId,
    family: 'stair',
    variant: spec.variant,
    style: mod.cfg.style,
    file: spec.file,
    prefab: `${spec.prefab}.prefab`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: mod.cfg.block ? 'game/src/render/models/pieces/StairBlockModel.ts' : 'game/src/render/models/pieces/StairModel.ts',
    provenance: 'Repository procedural staircase geometry, palette and glass balustrade infill',
    units: 'metres',
    placementOffset: placementOffset.map(round),
    min: bounds.min.toArray().map(round),
    max: bounds.max.toArray().map(round),
    anchors,
    triangles,
    meshes,
    materials,
    alphaMaterials: [...alphaMaterials].sort(),
    glassMaterials: [...glassMaterials].sort(),
    // The stainless grain canvas is the family's only texture; there are no
    // printed labels or decals on a stair.
    textures: textures.size,
    finish: 'stairFinish',
    storeyHeightMetres: STOREY_HEIGHT,
    widthMetres: WIDTH,
    widthToken: WIDTH_TOKEN,
    blockWidthMetres: BLOCK_WIDTH,
    rampLength: RAMP_LENGTH,
    rampRiseMetres: RAMP_RISE,
    rampRunCells: RAMP_RUN,
    cfg: {
      width: mod.cfg.width,
      style: mod.cfg.style,
      block: mod.cfg.block ?? false,
      blockHeight: mod.cfg.blockHeight ?? null,
      flights: mod.cfg.flights,
    },
    from: mod.from,
    to: mod.to,
    validation: { errors: report.issues.numErrors, warnings: report.issues.numWarnings },
  }
  await writeFile(join(out, spec.file), bytes)
  await writeFile(join(out, `${spec.file.replace(/\.glb$/, '')}.manifest.json`), JSON.stringify(manifest, null, 2) + '\n')
  assets.push(manifest)
  console.log(`${spec.id}: ${triangles} triangles, ${materials.length} materials (${manifest.alphaMaterials.length} alpha, ${manifest.textures} textures), ${bytes.length} bytes, ${manifest.sha256}`)
}

const summary = {
  schemaVersion: 1,
  family: 'stair',
  sourcePaths: [
    'game/src/render/models/pieces/StairModel.ts',
    'game/src/render/models/pieces/StairBlockModel.ts',
    'game/src/render/models/PieceBuilder.ts',
    'game/src/build/model/Equipment.ts',
    'game/src/sim/stairs.ts',
    'game/src/sim/placement.ts',
  ],
  parameters: {
    stationData: 'empty station document: { cells: [], modules: [], lines: [] } — no wall sides, lane mates or exit landings',
    storeyHeightMetres: STOREY_HEIGHT,
    widthMetres: WIDTH,
    widthToken: WIDTH_TOKEN,
    blockWidthMetres: BLOCK_WIDTH,
    widthSource: 'createModule default: STAIR_WIDTH_NARROW = ESCALATOR_BAND 0.68 m; the piece fills one 1 m block and its 0.79 m treads include the two outer balustrades',
    rampLength: RAMP_LENGTH,
    rampRiseMetres: RAMP_RISE,
    rampRunCells: RAMP_RUN,
    rampLengthSource: 'defaultRampLength(5, single, stair) = 长: 5 m of climb over 8 cells; turning shapes split it into two 4-cell flights at half rise',
    finish: 'stairFinish: one solid concrete-coloured MeshStandardMaterial replaces the floor finish',
    finishMaterial: 'stairFinish',
    materials: 'stairFinish, steel (brushed-canvas map), darkSteel, handrail, glass',
    texture: 'one 64 px brushed-stainless canvas embedded per GLB',
    basis: 'source Z-up tree wrapped in a group rotated -90 degrees about X (glTF Y-up); Unity wrapper applies the 180-degree Y correction',
  },
  assets,
  validation: {
    errors: assets.reduce((sum, asset) => sum + asset.validation.errors, 0),
    warnings: assets.reduce((sum, asset) => sum + asset.validation.warnings, 0),
  },
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(`stair: ${assets.length} variants, ${summary.validation.errors} errors, ${summary.validation.warnings} warnings`)
