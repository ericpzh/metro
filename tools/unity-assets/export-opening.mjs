// Export the 开口 (opening) family: six swing doors, two fare gates and two
// toilet cubicles.
//
// The three builders own the geometry; this recipe only freezes one canonical
// placement of each palette id at the origin, records its source-space bounds and
// basis anchors, and lets the game's own exporter turn it into glTF. Doors and
// cubicles hang their leaf/leaves in a pivot named `passenger-swing-door`, so the
// imported hierarchy keeps the articulated node instead of a flattened pose.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Canvas, ImageData, createCanvas } from '@napi-rs/canvas'
import validator from 'gltf-validator'

// The gate lane panels and the brushed-steel palette are printed canvas textures,
// so the recipe needs a real 2D rasterizer. Same adapter as export-bin/export-cctv:
// @napi-rs exposes a `data` method on Canvas and GLTFExporter treats any image with
// a `data` property as a DataTexture (transparent black), so shadow it.
//
// GLTFExporter encodes every canvas asynchronously and appends the image's
// bufferView only when its encode settles, so a gate with three textures used to
// race itself and produce different GLB bytes between two runs. Serialize the
// encode and the FileReader read: completion order then follows the deterministic
// material order, and the runner's two-export byte comparison holds.
globalThis.HTMLCanvasElement = Canvas
globalThis.ImageData = ImageData
let imageEncodes = Promise.resolve()
let imageReads = Promise.resolve()
globalThis.document = {
  createElement(name) {
    assert.equal(name, 'canvas')
    const canvas = createCanvas(1, 1)
    Object.defineProperty(canvas, 'data', { value: undefined })
    canvas.toBlob = (callback, mime) => {
      const encode = imageEncodes.then(() => canvas.encode(mime === 'image/jpeg' ? 'jpeg' : 'png'))
      imageEncodes = encode.catch(() => {})
      encode.then(bytes => callback(new Blob([bytes], { type: mime })))
    }
    return canvas
  },
}
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    const read = imageReads.then(() => blob.arrayBuffer())
    imageReads = read.catch(() => {})
    read.then(result => {
      this.result = result
      this.onloadend?.()
    })
  }
}

// The palette's brushed-stainless grain is drawn with `Math.random` (and Three's
// object UUIDs draw from it too), which would make two exports differ in the
// embedded PNG bytes. Pin the sequence: the doors, gates and cubicles have no
// other random input, so a fixed stream makes the exported GLBs byte-identical.
let seed = 0x5eed1234
Math.random = () => {
  seed = (seed + 0x6d2b79f5) >>> 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const gameRequire = createRequire(new URL('../../game/package.json', import.meta.url))
const THREE = await import(new URL('../../game/node_modules/three/build/three.module.js', import.meta.url).href)
const { GLTFExporter } = await import(pathToFileURL(gameRequire.resolve('three/addons/exporters/GLTFExporter.js')).href)
const { createModelMaterials } = await import('../../game/src/render/models/PieceBuilder.ts')
const { createModule } = await import('../../game/src/build/model/Equipment.ts')
const { buildModule } = await import('../../game/src/render/models.ts')
const { DOOR_FRAME, doorSpec, doorLeafHeight, doorOpeningWidth } = await import('../../game/src/sim/doors.ts')

// The 闸机's own numbers (GateModel.ts). Declared here because the builder keeps
// them module-private; `describe` below measures the built machine body and fails
// if these stop describing it.
const GATE = { width: 0.30, depth: 0.9, height: 1.02, lane: 0.5 - 0.30 }

// `WALLS` in CubicleModel.ts: the two side panels and the back panel.
const CUBICLE = { partitions: 3, partitionHeight: 1.8, doorWidth: 0.802, doorHeight: 1.75 }

const MODELS = [
  { paletteId: 'door-steel-1', prefab: 'DoorSteel1.prefab', file: 'door-steel-1.glb', id: 'station.door.steel-1', kind: 'door' },
  { paletteId: 'door-steel-2', prefab: 'DoorSteel2.prefab', file: 'door-steel-2.glb', id: 'station.door.steel-2', kind: 'door' },
  { paletteId: 'door-wood-1', prefab: 'DoorWood1.prefab', file: 'door-wood-1.glb', id: 'station.door.wood-1', kind: 'door' },
  { paletteId: 'door-wood-2', prefab: 'DoorWood2.prefab', file: 'door-wood-2.glb', id: 'station.door.wood-2', kind: 'door' },
  { paletteId: 'door-glass-1', prefab: 'DoorGlass1.prefab', file: 'door-glass-1.glb', id: 'station.door.glass-1', kind: 'door' },
  { paletteId: 'door-glass-2', prefab: 'DoorGlass2.prefab', file: 'door-glass-2.glb', id: 'station.door.glass-2', kind: 'door' },
  { paletteId: 'gate', prefab: 'Gate.prefab', file: 'gate.glb', id: 'station.gate.classic', kind: 'gate' },
  { paletteId: 'gate-new', prefab: 'GateNew.prefab', file: 'gate-new.glb', id: 'station.gate.modern', kind: 'gate' },
  { paletteId: 'cubicle', prefab: 'Cubicle.prefab', file: 'cubicle.glb', id: 'station.cubicle.shared', kind: 'cubicle' },
  { paletteId: 'cubicle-toilet', prefab: 'CubicleToilet.prefab', file: 'cubicle-toilet.glb', id: 'station.cubicle.toilet', kind: 'cubicle' },
]

const mats = createModelMaterials()
// Empty station document: no shared cubicle walls, no neighbours, no slab.
const data = { cells: [], modules: [], lines: [], name: 'Station', nameEn: 'Station' }
const ctx = {
  mats, data, ads: {}, trackCells: new Set(),
  finish: (name) => (name === 'granite' ? mats.steel : mats.darkSteel),
}

// Materials a builder mints for itself (`ownedMaterial`) are named by their
// authored colour, so both exports name them the same way.
const OWNED = new Map([
  [0xbc3a2f, 'gateWing'],           // GateModel: the opaque enamel lane leaf
  [0xc8d9d6, 'cubiclePartition'],   // CubicleModel: the painted panel
  [0xf3f3ed, 'cubicleCeramic'],     // RestroomFixtures: the porcelain bowl/cistern
  [0xfafbf8, 'cubicleSeat'],        // CubicleModel: the seat, lid and roll
  [0xabcdd1, 'cubicleWater'],       // CubicleModel: the water in the bowl
])

const paletteNames = new Map(Object.entries(mats).map(([name, material]) => [material, name]))

/** Build one canonical module and put it back on a stable local origin. */
function build(paletteId) {
  const mod = createModule(paletteId, 0, 0, 0, `proof-${paletteId}`, 0)
  assert.ok(mod, `${paletteId}: createModule returned null`)
  const root = buildModule(mod, ctx)
  assert.ok(root, `${paletteId}: buildModule returned null`)
  const placementOffset = root.position.toArray()
  root.position.set(0, 0, 0)
  root.rotation.set(0, 0, 0)
  root.updateMatrixWorld(true)
  return { mod, root, placementOffset }
}

/** The one mesh named `name`, in the builder's own local frame. */
function named(root, name) {
  const found = []
  root.traverse(object => { if (object.name === name && object.isMesh) found.push(object) })
  return found
}

/** Name every material deterministically; returns the manifest sets. */
function inspect(root, paletteId) {
  const used = new Map()
  const named = new Set()
  const alphaMaterials = new Set()
  const glassMaterials = new Set()
  const textures = new Set()
  const added = new Set()
  let triangles = 0
  let meshes = 0
  root.traverse(object => {
    // Renderer-only metadata (`lowDetailGeometry`, shared-geometry tags) carries
    // random UUIDs; the recipe exports the full-detail source meshes.
    object.userData = {}
    if (object.isInstancedMesh) assert.fail(`${paletteId}: an InstancedMesh must be expanded before export`)
    if (!object.isMesh) return
    meshes++
    const count = object.geometry.index?.count ?? object.geometry.getAttribute('position').count
    assert.equal(count % 3, 0, `${paletteId}: ${object.name || 'mesh'} has ${count} vertices`)
    triangles += count / 3
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (added.has(material)) {
        used.set(material, material.name)
        continue
      }
      added.add(material)
      let name = paletteNames.get(material)
      if (!name) {
        const hex = material.color?.getHex()
        name = OWNED.get(hex)
        assert.ok(name, `${paletteId}: unnamed builder material ${hex === undefined ? material.type : hex.toString(16)}`)
      }
      if (named.has(name)) {
        let suffix = 2
        while (named.has(`${name}${suffix}`)) suffix++
        name = `${name}${suffix}`
      }
      used.set(material, name)
      named.add(name)
      material.name = name
      if (material.transparent) alphaMaterials.add(name)
      if (/glass/i.test(name)) glassMaterials.add(name)
      if (material.map) textures.add(material.map)
    }
  })
  assert.equal(Number.isInteger(triangles), true, `${paletteId}: triangle count is not an integer`)
  return {
    triangles,
    meshes,
    materials: [...used.values()].sort(),
    alphaMaterials: [...alphaMaterials].sort(),
    glassMaterials: [...glassMaterials].sort(),
    textures: textures.size,
    materialCount: used.size,
  }
}

/** Family-specific facts the Unity review re-checks against the geometry. */
function describe(spec, mod, root) {
  if (spec.kind === 'door') {
    const door = doorSpec(mod.cfg.variant)
    // `buildStandingDoor` uses the module's own run (`mod.w`, the spec's width).
    const width = Math.max(DOOR_FRAME.post * 2 + 0.2, mod.w)
    const opening = doorOpeningWidth(width)
    const { leaves } = door
    // The leaves hang in their own pivot: one per leaf, named for the door.
    const pivots = root.children.filter(child => child.name === 'passenger-swing-door')
    assert.equal(pivots.length, leaves, `${spec.paletteId}: expected ${leaves} leaf pivots, found ${pivots.length}`)
    return {
      variant: door.variant,
      material: door.material,
      leaves,
      spanMetres: width,
      openingMetres: opening,
      panelHeightMetres: door.h,
      leafHeightMetres: doorLeafHeight(door.h),
      leafPivot: 'passenger-swing-door',
      placement: 'leading edge of the anchor tile (rot 0)',
    }
  }
  if (spec.kind === 'gate') {
    const bodies = named(root, 'gate-body')
    assert.equal(bodies.length, 1, `${spec.paletteId}: expected one named machine body`)
    const body = new THREE.Box3().setFromObject(bodies[0])
    const size = body.getSize(new THREE.Vector3())
    const centre = body.getCenter(new THREE.Vector3())
    assert.ok(Math.abs(size.x - GATE.width) < 1e-6, `${spec.paletteId}: body width ${size.x}`)
    assert.ok(Math.abs(size.y - GATE.depth) < 1e-6, `${spec.paletteId}: body depth ${size.y}`)
    // The machine body occupies the cell's local -x half; the lane is on +x.
    assert.ok(centre.x < -0.2, `${spec.paletteId}: machine body is not on local -x (${centre.x})`)
    return {
      variant: mod.cfg.variant === 'new' ? 'modern' : 'classic',
      dir: mod.cfg.dir,
      door: mod.cfg.door,
      machineSide: 'local -x',
      bodyWidthMetres: size.x,
      bodyDepthMetres: size.y,
      bodyCentreX: centre.x,
      heightMetres: GATE.height,
      laneWidthMetres: GATE.lane,
      // The two arrow faces a two-way lane builds; `gateCross` is the one-way
      // no-entry face and is not part of this canonical placement.
      lanePanelTextures: ['gatePanel', 'gatePanelBack'],
    }
  }
  const standalone = mod.cfg.variant === 'toilet'
  const partitions = named(root, 'cubicle-partition')
  const pivots = root.children.filter(child => child.name === 'passenger-swing-door')
  if (standalone) {
    assert.equal(partitions.length, 0, 'cubicle-toilet: shell partitions must not be built')
    assert.equal(pivots.length, 0, 'cubicle-toilet: the standalone toilet has no door')
  } else {
    assert.equal(partitions.length, CUBICLE.partitions, `cubicle: expected ${CUBICLE.partitions} partitions`)
    assert.equal(pivots.length, 1, 'cubicle: expected one cubicle door pivot')
  }
  return {
    variant: standalone ? 'toilet' : 'shared',
    partitions: partitions.length,
    partitionHeightMetres: CUBICLE.partitionHeight,
    doorWidthMetres: CUBICLE.doorWidth,
    doorHeightMetres: CUBICLE.doorHeight,
    doorPivot: standalone ? null : 'passenger-swing-door',
    fixtures: standalone ? 'porcelain bowl, seat, cistern' : 'bowl, seat, cistern, paper roll',
  }
}

const out = resolve(process.argv[2] ?? '.preview/unity/opening-proof/export')
await mkdir(out, { recursive: true })

const assets = []
for (const spec of MODELS) {
  const { mod, root, placementOffset } = build(spec.paletteId)
  const facts = describe(spec, mod, root)
  const stats = inspect(root, spec.paletteId)

  const bounds = new THREE.Box3().setFromObject(root)
  // Basis anchors match the bench/bin/cctv recipes; `Approach` is the door's own
  // front face, the way a passenger walks through it (local -y at rot 0).
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
  gltfRoot.name = spec.prefab.replace(/\.prefab$/, '')
  // Source space is Z-up; the single export transform rotates it into glTF Y-up.
  gltfRoot.rotation.x = -Math.PI / 2
  gltfRoot.add(root)
  const bytes = new Uint8Array(await new GLTFExporter().parseAsync(gltfRoot, { binary: true }))
  const base = spec.file.replace(/\.glb$/, '')
  const report = await validator.validateBytes(bytes, { uri: spec.file })
  await writeFile(join(out, `${base}.validation.json`), JSON.stringify(report, null, 2) + '\n')
  assert.equal(report.issues.numErrors + report.issues.numWarnings, 0, `See ${base}.validation.json`)

  const manifest = {
    schemaVersion: 1,
    id: spec.id,
    paletteId: spec.paletteId,
    prefab: spec.prefab,
    family: 'opening',
    kind: spec.kind,
    file: spec.file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: spec.kind === 'door'
      ? 'game/src/render/models/pieces/DoorModel.ts'
      : spec.kind === 'gate' ? 'game/src/render/models/pieces/GateModel.ts'
        : 'game/src/render/models/pieces/CubicleModel.ts',
    provenance: 'Repository-authored procedural 门 / 闸机 / 厕所隔间 geometry and palette',
    units: 'metres',
    rotation: 0,
    placementOffset,
    min: bounds.min.toArray(),
    max: bounds.max.toArray(),
    anchors,
    triangles: stats.triangles,
    meshes: stats.meshes,
    materials: stats.materials,
    alphaMaterials: stats.alphaMaterials,
    glassMaterials: stats.glassMaterials,
    textures: stats.textures,
    ...facts,
    validation: { errors: report.issues.numErrors, warnings: report.issues.numWarnings },
  }
  await writeFile(join(out, spec.file), bytes)
  await writeFile(join(out, `${base}.manifest.json`), JSON.stringify(manifest, null, 2) + '\n')
  assets.push(manifest)
  console.log(`${spec.id}: ${stats.triangles}t ${stats.materials.length}m (${stats.alphaMaterials.length}a) ${stats.textures}tex ${bytes.length}b ${manifest.sha256}`)
}

const door = doorSpec('steel-1')
const summary = {
  schemaVersion: 1,
  family: 'opening',
  sourcePaths: [
    'game/src/render/models/pieces/DoorModel.ts',
    'game/src/render/models/pieces/GateModel.ts',
    'game/src/render/models/pieces/CubicleModel.ts',
    'game/src/render/models/pieces/RestroomFixtures.ts',
    'game/src/render/models/PieceBuilder.ts',
    'game/src/build/model/Equipment.ts',
    'game/src/sim/doors.ts',
    'game/src/sim/gates.ts',
  ],
  parameters: {
    stationData: 'empty station document: { cells: [], modules: [], lines: [] }',
    rotation: 0,
    doorSpansMetres: [1, 2],
    doorPanelHeightMetres: door.h,
    doorLeafHeightMetres: doorLeafHeight(door.h),
    doorThresholdMetres: DOOR_FRAME.threshold,
    doorPostDepthMetres: DOOR_FRAME.postDepth,
    doorLeafMetres: DOOR_FRAME.leaf,
    doorSingleLeafCount: 1,
    doorDoubleLeafCount: 2,
    doorPlacement: "the doorway's own line sits a frame half-depth inside the anchor cell's leading edge (rot 0)",
    doorMaterialPalette: 'steel: binSteel frame + binSteel leaf; wood: wood frame + woodLight leaf; glass: binSteel frame + glass leaf',
    gateBodyWidthMetres: GATE.width,
    gateBodyDepthMetres: GATE.depth,
    gateHeightMetres: GATE.height,
    gateDir: 'both',
    gateDoor: 'lane',
    gateMachineHalf: 'local -x',
    gateLanePanels: ['gatePanel', 'gatePanelBack'],
    gateCanvasTextures: ['gatePanel', 'gatePanelBack', 'gateCross'],
    gateCrossNote: "gateCross is the no-entry face of a one-way gate; a two-way lane (dir 'both') prints the two arrow panels and builds no cross",
    cubiclePartitions: CUBICLE.partitions,
    cubiclePartitionHeightMetres: CUBICLE.partitionHeight,
    cubicleDoorWidthMetres: CUBICLE.doorWidth,
    cubicleDoorHeightMetres: CUBICLE.doorHeight,
    cubicleVariants: { cubicle: 'shared shell: three partitions, three hinged doors, one WC', 'cubicle-toilet': 'standalone WC: no shell, ceramic bowl, seat and cistern' },
    basis: 'source Z-up tree wrapped in a group rotated -90 degrees about X (glTF Y-up); Unity wrapper applies the 180-degree Y correction',
    ownedMaterials: [...OWNED.values()],
  },
  assets,
  validation: {
    errors: assets.reduce((sum, asset) => sum + asset.validation.errors, 0),
    warnings: assets.reduce((sum, asset) => sum + asset.validation.warnings, 0),
  },
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(`opening: ${assets.length} models, ${summary.validation.errors} errors, ${summary.validation.warnings} warnings`)
