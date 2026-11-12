// Transit family export: the ten circulation, structure and street-surface pieces
// of the station catalogue, built by the game's own `createModule` + `buildModule`
// on an empty station document and written as one GLB + manifest per model.
//
//   node tools/unity-assets/export-transit.mjs <out-dir>
//
// Canonical placements (all at the origin, rot 0):
//   escalator   default 长 single-span ramp (5 m rise over 9 cells at 30°), 5 m storey
//   lift        small 2 × 2 glass shaft, one 5 m interval
//   walkway     default 短 30 m level belt
//   pillar-*    长 5 m section
//   bridge      12 × 3 m track deck (bridge track, third rail, railing)
//   road        6 × 12 m two-way street
//   sidewalk    one 1 m paved tile
//   lawn        one 1 m grass tile
//   tree        full-detail street ash (the 18k-triangle foliage)
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Canvas, ImageData, createCanvas } from '@napi-rs/canvas'
import validator from 'gltf-validator'

// The station builders rasterise canvases even headless. `@napi-rs/canvas`
// exposes `data()` on every Canvas, which Three's GLTFExporter mistakes for a
// DataTexture and writes as transparent black, so shadow `data` and provide
// `toBlob`. Both textures this family carries (the brushed-steel grain and the
// lift's call-panel screen) go through it.
globalThis.HTMLCanvasElement = Canvas
globalThis.ImageData = ImageData
globalThis.document = {
  createElement(name) {
    assert.equal(name, 'canvas')
    const canvas = createCanvas(1, 1)
    Object.defineProperty(canvas, 'data', { value: undefined })
    canvas.toBlob = (callback, mime) => {
      // GLTFExporter gathers every texture encode as a promise and awaits them
      // together, assigning bufferView indices in completion order. One encode
      // at a time keeps that order — and therefore the GLB bytes — stable.
      encodeQueue = encodeQueue.then(async () => {
        const bytes = await canvas.encode(mime === 'image/jpeg' ? 'jpeg' : 'png')
        callback(new Blob([bytes], { type: mime }))
      })
      return encodeQueue
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
let encodeQueue = Promise.resolve()

const gameRequire = createRequire(new URL('../../game/package.json', import.meta.url))
const THREE = await import(new URL('../../game/node_modules/three/build/three.module.js', import.meta.url).href)
const { GLTFExporter } = await import(pathToFileURL(gameRequire.resolve('three/addons/exporters/GLTFExporter.js')).href)
const { mergeGeometries } = await import(pathToFileURL(gameRequire.resolve('three/addons/utils/BufferGeometryUtils.js')).href)
const { createModelMaterials } = await import('../../game/src/render/models/PieceBuilder.ts')
const { createModule } = await import('../../game/src/build/model/Equipment.ts')
const { buildModule } = await import('../../game/src/render/models.ts')
const { escalatorBodyWidth, escalatorBandWidth, escalatorBalustradeWidth } = await import('../../game/src/sim/escalators.ts')
const { walkwayLengthOf, walkwayLengthSpec } = await import('../../game/src/sim/walkways.ts')
const { liftSizeOf, liftLevels, liftStops, LIFT_INTERVAL_DEFAULT } = await import('../../game/src/sim/lifts.ts')
const { pillarWidth } = await import('../../game/src/sim/structures.ts')
const { BRIDGE_DECK_DEPTH } = await import('../../game/src/sim/structures.ts')
const { ESCALATOR_TRUSS_DEPTH } = await import('../../game/src/sim/rampSurface.ts')
const { roadLayout } = await import('../../game/src/sim/roads.ts')
const { OUTDOOR_SURFACE_HEIGHT } = await import('../../game/src/sim/constants.ts')

const STOREY_HEIGHT = 5

// `createModelMaterials` prints the palette's 64 px brushed-stainless canvas,
// whose grain comes from `Math.random` (`brushedCanvas`). Seed the generator for
// the duration of the call so the grain — and every GLB that embeds it — is
// byte-identical between runs. The original generator is restored at once;
// nothing else in this recipe consumes randomness.
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
  Math.random = seededRandom(0x5452414e) // 'TRAN'
  mats = createModelMaterials()
} finally {
  Math.random = random
}

// The track and pillar builders ask their context for a floor finish. With no
// authored cell behind the piece the finish id is always `floor.concrete`, so
// one solid concrete material serves the bridge deck/bed, the trough, the
// shoulders and the thick pillar's shaft — the same role `stairFinish` plays for
// the staircase family. It is not a palette slot: the builder-owned material is
// named by its authored colour.
const concreteFinish = new THREE.MeshStandardMaterial({
  name: 'transitConcrete_b5b0a6',
  color: 0xb5b0a6,
  roughness: 0.86,
  metalness: 0.04,
  vertexColors: true,
})

// Empty station document: no cells, no neighbours, no line, no slab. `data.lines`
// is an empty list, so the bridge's third rail takes its default travel side.
const data = { cells: [], modules: [], lines: [], name: 'Station', nameEn: 'Station' }
const owned = []
const ctx = {
  mats,
  data,
  ads: {},
  trackCells: new Set(),
  finish: () => concreteFinish,
  owned,
}

// Palette id | prefab | GLB | catalogue id, in the catalogue's own order.
const MODELS = [
  { paletteId: 'escalator', prefab: 'Escalator', file: 'escalator.glb', id: 'station.escalator.standard', kind: 'escalator', source: 'game/src/render/models/pieces/EscalatorModel.ts' },
  { paletteId: 'lift', prefab: 'Lift', file: 'lift.glb', id: 'station.lift.standard', kind: 'lift', source: 'game/src/render/models/pieces/LiftModel.ts' },
  { paletteId: 'walkway', prefab: 'Walkway', file: 'walkway.glb', id: 'station.walkway.standard', kind: 'walkway', source: 'game/src/render/models/pieces/WalkwayModel.ts' },
  { paletteId: 'pillar-slim', prefab: 'PillarSlim', file: 'pillar-slim.glb', id: 'station.pillar.slim', kind: 'pillar-slim', source: 'game/src/render/models/pieces/PillarModel.ts' },
  { paletteId: 'pillar-thick', prefab: 'PillarThick', file: 'pillar-thick.glb', id: 'station.pillar.thick', kind: 'pillar-thick', source: 'game/src/render/models/pieces/PillarModel.ts' },
  { paletteId: 'bridge', prefab: 'Bridge', file: 'bridge.glb', id: 'station.track.bridge', kind: 'bridge', source: 'game/src/render/models/pieces/TrackModel.ts' },
  { paletteId: 'road', prefab: 'Road', file: 'road.glb', id: 'station.road.standard', kind: 'road', source: 'game/src/render/models/pieces/RoadModel.ts' },
  { paletteId: 'sidewalk', prefab: 'Sidewalk', file: 'sidewalk.glb', id: 'station.sidewalk.standard', kind: 'sidewalk', source: 'game/src/render/models/pieces/OutdoorSurfaceModel.ts' },
  { paletteId: 'lawn', prefab: 'Lawn', file: 'lawn.glb', id: 'station.lawn.standard', kind: 'lawn', source: 'game/src/render/models/pieces/OutdoorSurfaceModel.ts' },
  { paletteId: 'tree', prefab: 'Tree', file: 'tree.glb', id: 'station.tree.standard', kind: 'tree', source: 'game/src/render/models/pieces/TreeModel.ts' },
]

// Builder-owned materials, named by their authored colour. Every one of these
// is minted per build through `ownedMaterial`, so identity is stable within one
// build and the name is derived from the colour the builder wrote.
const OWNED_BY_COLOR = new Map([
  [0x3b3f45, 'roadAsphalt_3b3f45'],       // RoadModel: the asphalt deck
  [0xf7c83c, 'roadMarkingYellow_f7c83c'], // RoadModel: the centre-line paint
  [0xa8d8e6, 'liftGlass_a8d8e6'],         // LiftModel: glass clone at opacity 0.2
])
// The lift's stainless clone keeps the palette's brushed map but drops its
// metalness; its authored colour is the palette steel behind the white albedo.
const STEEL_CLONE = 'liftSteel_b7bdc4'

const paletteNames = new Map(Object.entries(mats).map(([name, material]) => [material, name]))
const paletteTextures = new Map()
for (const [name, material] of Object.entries(mats)) {
  if (material.map && !paletteTextures.has(material.map)) paletteTextures.set(material.map, name)
}

/**
 * Expand every THREE.InstancedMesh in place. GLTFExporter writes only the base
 * geometry of an instanced mesh, silently dropping the per-instance matrices, so
 * the escalator/walkway step band (treads, nosings and risers) is baked here:
 * each instance matrix is composed, degenerate (hidden) instances are skipped,
 * geometries are merged per material and the batch is replaced by an ordinary
 * mesh. Replaces children from the leaves up so traversal stays valid.
 */
function expandInstances(root) {
  const batches = []
  root.traverse(object => { if (object.isInstancedMesh) batches.push(object) })
  for (const batch of batches) {
    const parent = batch.parent
    assert.ok(parent, 'InstancedMesh without a parent')
    parent.updateWorldMatrix(true, false)
    batch.updateWorldMatrix(true, false)
    const toParent = new THREE.Matrix4().copy(parent.matrixWorld).invert()
    const nodeMatrix = new THREE.Matrix4().multiplyMatrices(toParent, batch.matrixWorld)
    const instance = new THREE.Matrix4()
    const world = new THREE.Matrix4()
    const scale = new THREE.Vector3()
    const geometries = []
    for (let i = 0; i < batch.count; i++) {
      batch.getMatrixAt(i, instance)
      world.multiplyMatrices(nodeMatrix, instance)
      scale.setFromMatrixScale(world)
      // The step band hides the treads under the landing combs with a zero
      // scale; those instances must stay out of the export entirely.
      if (scale.x < 1e-6 || scale.y < 1e-6 || scale.z < 1e-6) continue
      geometries.push(batch.geometry.clone().applyMatrix4(world))
    }
    if (geometries.length > 0) {
      const geometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries)
      assert.ok(geometry, `could not merge ${geometries.length} instances of ${batch.name || 'a batch'}`)
      if (geometries.length > 1) for (const clone of geometries) clone.dispose()
      const mesh = new THREE.Mesh(geometry, batch.material)
      mesh.name = batch.name
      parent.add(mesh)
    }
    parent.remove(batch)
  }
}

/**
 * The two belt pieces carry their run on the group's own quaternion
 * (`buildRampBand`: the truss is built along the group's local +X, so the basis
 * that turns that onto the run IS the geometry). Resetting that rotation — the
 * blanket "record placement, clear rotation" step the other families use — would
 * flatten the truss and glass while the step band, whose child cancels the run
 * rotation, stayed inclined. Only the *placement* translation is removed here.
 *
 * The canonical frame then yaws the whole belt −90° about Z (source run +Y → +X)
 * so that every model in the family exports with its long axis along +X, which is
 * also the axis the review row lays pieces out on. The yaw is a rigid parent
 * rotation, so the incline, the truss and the band stay in register.
 */
const BELT_YAW = -Math.PI / 2

/** Build one canonical module and put it back on a stable local origin. */
function build(spec) {
  const mod = createModule(spec.paletteId, 0, 0, 0, `proof-${spec.paletteId}`, 0)
  assert.ok(mod, `${spec.paletteId}: createModule returned null`)
  const root = buildModule(mod, ctx)
  assert.ok(root, `${spec.paletteId}: buildModule returned null`)
  root.updateMatrixWorld(true)
  expandInstances(root)
  // The builders place world-space pieces (placeLocal, the run origin, the road
  // surface) from the canonical cell; export from that recorded frame instead.
  const placementOffset = root.position.toArray()
  root.position.set(0, 0, 0)
  root.updateMatrixWorld(true)

  const holder = new THREE.Group()
  holder.name = 'canonical'
  const belt = spec.kind === 'escalator' || spec.kind === 'walkway'
  if (belt) {
    holder.rotation.z = BELT_YAW
    holder.name = 'canonical-yaw'
  }
  holder.add(root)
  holder.updateMatrixWorld(true)
  return { mod, root, holder, placementOffset, belt }
}

/** Name every material deterministically and collect the manifest sets. */
function inspect(root, paletteId) {
  const used = new Map()
  const named = new Set()
  const alphaMaterials = new Set()
  const glassMaterials = new Set()
  const textures = new Set()
  let triangles = 0
  let meshes = 0
  root.traverse(object => {
    // Renderer-only LOD metadata (`lowDetailGeometry`, shared-geometry tags,
    // door rigs) carries random UUIDs; the recipe exports full-detail meshes.
    object.userData = {}
    assert.notEqual(object.isInstancedMesh, true, `${paletteId}: an InstancedMesh survived expansion`)
    if (!object.isMesh) return
    meshes++
    const count = object.geometry.index?.count ?? object.geometry.getAttribute('position').count
    assert.equal(count % 3, 0, `${paletteId}: ${object.name || 'mesh'} has ${count} vertices`)
    triangles += count / 3
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      let name = used.get(material)
      if (!name) {
        name = paletteNames.get(material)
        if (!name && material === concreteFinish) name = concreteFinish.name
        if (!name && material.map && paletteTextures.has(material.map)) name = STEEL_CLONE
        if (!name) {
          const hex = material.color?.getHex() ?? 0
          name = OWNED_BY_COLOR.get(hex) ?? `transitMaterial_${hex.toString(16).padStart(6, '0')}`
        }
        if (named.has(name)) {
          let suffix = 2
          while (named.has(`${name}_${suffix}`)) suffix++
          name = `${name}_${suffix}`
        }
        used.set(material, name)
        named.add(name)
        material.name = name
      }
      if (/glass/i.test(name)) glassMaterials.add(name)
      if (material.transparent) alphaMaterials.add(name)
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
  }
}

/** Canonical placement facts for one piece, read from the piece's own cfg/geometry. */
function describe(spec, mod, stats) {
  switch (spec.kind) {
    case 'escalator':
      return {
        rampLength: 'long',
        rampSpan: 'single',
        storeyHeightMetres: STOREY_HEIGHT,
        inclineDegrees: mod.cfg.incline,
        riseMetres: Math.abs(mod.to.z - mod.from.z),
        runCells: Math.round(Math.hypot(mod.to.x - mod.from.x, mod.to.y - mod.from.y)),
        widthBlocks: mod.cfg.width ?? 1,
        bodyWidthMetres: escalatorBodyWidth(mod),
        bandWidthMetres: escalatorBandWidth(mod),
        balustradeWidthMetres: escalatorBalustradeWidth(mod),
        trussDepthMetres: ESCALATOR_TRUSS_DEPTH,
        travel: mod.cfg.dir,
        balustrade: 'glass panes with black rubber handrails',
      }
    case 'lift':
      return {
        style: mod.cfg.style ?? 'glass',
        sizeMetres: liftSizeOf(mod),
        intervalMetres: LIFT_INTERVAL_DEFAULT,
        storeyHeightMetres: STOREY_HEIGHT,
        risesMetres: liftStops(mod),
        levelsMetres: liftLevels(mod),
        shaft: '2 x 2 glazed shaft with stainless posts, caps and a moving glass car',
      }
    case 'walkway':
      return {
        walkwayLength: walkwayLengthOf(mod),
        lengthMetres: walkwayLengthSpec(walkwayLengthOf(mod)).run,
        widthBlocks: mod.cfg.width ?? 1,
        bodyWidthMetres: escalatorBodyWidth(mod),
        bandWidthMetres: escalatorBandWidth(mod),
        travel: mod.cfg.dir,
        balustrade: 'glass panes with black rubber handrails',
      }
    case 'pillar-slim':
    case 'pillar-thick':
      return {
        size: mod.cfg.size,
        heightMetres: mod.cfg.height,
        widthMetres: pillarWidth(mod),
        collars: 'steel cap rings at both ends',
      }
    case 'bridge':
      return {
        planCells: [mod.w, mod.d],
        widthMetres: mod.w,
        depthMetres: mod.d,
        deckDepthMetres: BRIDGE_DECK_DEPTH,
        power: mod.cfg.power,
        railing: mod.cfg.bridgeRailing ?? 'railing',
        line: mod.cfg.line,
        deck: 'concrete trough and shoulders over a steel track bed',
      }
    case 'road': {
      const layout = roadLayout(mod)
      return {
        widthMetres: mod.w,
        depthMetres: mod.d,
        direction: mod.cfg.direction,
        lanes: layout.lanes,
        laneWidthMetres: layout.laneWidth,
        surface: 'asphalt plane with white edge/lane paint and a yellow centre pair',
      }
    }
    case 'sidewalk':
    case 'lawn':
      return {
        tileMetres: 1,
        heightMetres: OUTDOOR_SURFACE_HEIGHT,
        vertexColours: spec.kind === 'lawn' ? ['0x6a6046 body', '0x6b9343 / 0x70994a / 0x769b4c grass tiles'] : ['0x8f9699 body', '0xaeb5b7 / 0xb8bec0 / 0xa4adaf paver rows'],
      }
    case 'tree':
      return {
        detail: 'full-detail street ash: trunk plus 18k-triangle foliage, no LOD swap',
        foliageTriangles: stats.triangles,
        heightMetres: 4.5,
        bark: 'brown bark material, pale green foliage',
      }
    default:
      throw new Error(`unknown transit kind ${spec.kind}`)
  }
}

const out = resolve(process.argv[2] ?? '.preview/unity/transit-proof/export')
await mkdir(out, { recursive: true })

const anchors = {
  AxisX: [1, 0, 0],
  Front: [0, 1, 0],
  Up: [0, 0, 1],
  Approach: [0, -1, 0],
}
/** Six decimals keeps the manifest readable and stays far inside Unity's 1 mm check. */
const round = (value) => Number(value.toFixed(6))

const assets = []
for (const spec of MODELS) {
  const { mod, root, holder, placementOffset, belt } = build(spec)
  const stats = inspect(root, spec.paletteId)
  const bounds = new THREE.Box3().setFromObject(holder)
  assert.ok(!bounds.isEmpty(), `${spec.paletteId}: empty bounds`)
  const facts = describe(spec, mod, stats)

  const gltfRoot = new THREE.Group()
  gltfRoot.name = spec.prefab
  // Source space is Z-up; this single transform rotates it into glTF Y-up,
  // exactly as the bench, bin, stair and CCTV recipes do.
  gltfRoot.rotation.x = -Math.PI / 2
  gltfRoot.add(holder)
  // Anchors are siblings of the model under the exported root, never children of
  // the belt's run transform, so they stay on the source axes. They are added
  // after the bounds are read so the sockets never inflate the envelope.
  for (const [name, position] of Object.entries(anchors)) {
    const anchor = new THREE.Object3D()
    anchor.name = name
    anchor.position.fromArray(position)
    gltfRoot.add(anchor)
  }
  const bytes = new Uint8Array(await new GLTFExporter().parseAsync(gltfRoot, { binary: true }))
  const base = spec.file.replace(/\.glb$/, '')
  const report = await validator.validateBytes(bytes, { uri: spec.file })
  await writeFile(join(out, `${base}.validation.json`), JSON.stringify(report, null, 2) + '\n')
  assert.equal(report.issues.numErrors + report.issues.numWarnings, 0, `See ${base}.validation.json`)

  const manifest = {
    schemaVersion: 1,
    id: spec.id,
    paletteId: spec.paletteId,
    family: 'transit',
    kind: spec.kind,
    file: spec.file,
    prefab: `${spec.prefab}.prefab`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: spec.source,
    provenance: 'Repository-authored procedural station geometry and palette',
    units: 'metres',
    rotation: 0,
    modelYawDegrees: belt ? -90 : 0,
    canonicalOrientation: belt
      ? 'run yawed −90° about source Z so the belt lies along +X; the incline and step band keep their builder transform'
      : 'builder frame, placement translation removed',
    placementOffset: placementOffset.map(round),
    min: bounds.min.toArray().map(round),
    max: bounds.max.toArray().map(round),
    anchors,
    triangles: stats.triangles,
    meshes: stats.meshes,
    materials: stats.materials,
    alphaMaterials: stats.alphaMaterials,
    glassMaterials: stats.glassMaterials,
    textures: stats.textures,
    cfg: mod.cfg,
    ...facts,
    validation: { errors: report.issues.numErrors, warnings: report.issues.numWarnings },
  }
  await writeFile(join(out, spec.file), bytes)
  await writeFile(join(out, `${base}.manifest.json`), JSON.stringify(manifest, null, 2) + '\n')
  assets.push(manifest)
  console.log(`${spec.id}: ${stats.triangles}t/${stats.meshes}m ${stats.materials.length}mat (${manifest.alphaMaterials.length}a, ${manifest.glassMaterials.length}g) ${stats.textures}tex ${bytes.length}b ${manifest.sha256.slice(0, 12)}`)
}

const summary = {
  schemaVersion: 1,
  family: 'transit',
  sourcePaths: [
    'game/src/render/models/pieces/EscalatorModel.ts',
    'game/src/render/models/pieces/WalkwayModel.ts',
    'game/src/render/models/pieces/LiftModel.ts',
    'game/src/render/models/pieces/PillarModel.ts',
    'game/src/render/models/pieces/TrackModel.ts',
    'game/src/render/models/pieces/RoadModel.ts',
    'game/src/render/models/pieces/OutdoorSurfaceModel.ts',
    'game/src/render/models/pieces/TreeModel.ts',
    'game/src/render/models/PieceBuilder.ts',
    'game/src/build/model/Equipment.ts',
    'game/src/sim/escalators.ts',
    'game/src/sim/walkways.ts',
    'game/src/sim/lifts.ts',
    'game/src/sim/structures.ts',
    'game/src/sim/roads.ts',
  ],
  parameters: {
    stationData: 'empty station document: { cells: [], modules: [], lines: [] } — no neighbours, slab, line or landing floor',
    storeyHeightMetres: STOREY_HEIGHT,
    escalator: 'default 长 single-span ramp: 5 m rise over 9 cells at 30°, 1-block 窄 body (1.00 m), glass balustrades, black handrails',
    escalatorRampLength: 'long',
    escalatorRampSpan: 'single',
    escalatorRiseMetres: 5,
    escalatorRunCells: 9,
    escalatorInclineDegrees: 30,
    escalatorBodyWidthMetres: escalatorBodyWidth({ cfg: {} }),
    lift: 'small 2 × 2 glazed shaft, one 5 m interval, moving glass car',
    liftSizeMetres: 2,
    liftIntervalMetres: LIFT_INTERVAL_DEFAULT,
    walkway: 'default 短 30 m level belt, 1-block 窄 body, glass balustrades, black handrails',
    walkwayLength: 'short',
    walkwayLengthMetres: 30,
    pillarHeightMetres: 5,
    pillarSlimWidthMetres: 0.3,
    pillarThickWidthMetres: 1,
    bridgeWidthMetres: 12,
    bridgeDepthMetres: 3,
    bridgeDeckDepthMetres: BRIDGE_DECK_DEPTH,
    roadWidthMetres: 6,
    roadDepthMetres: 12,
    surfaceTileMetres: 1,
    surfaceHeightMetres: OUTDOOR_SURFACE_HEIGHT,
    treeDetail: 'full-detail street ash foliage (18k triangles); LOD metadata stripped at export',
    finish: 'transitConcrete_b5b0a6: one solid concrete finish for the bridge deck/bed, trough and shoulders and the thick pillar shaft',
    finishMaterial: 'transitConcrete_b5b0a6',
    materials: 'createModelMaterials palette slots plus builder-owned roadAsphalt_3b3f45, roadMarkingYellow_f7c83c, liftSteel_b7bdc4 (steel clone) and liftGlass_a8d8e6 (glass clone)',
    textures: 'lift: brushed-steel grain + call-panel screen (2); escalator/walkway/bridge/pillars: brushed-steel grain (1); road/surfaces/tree: none',
    beltCanonicalOrientation: 'the escalator and walkway keep their builder run transform (it carries the incline and the step band) and are yawed −90° about source Z so the belt lies along +X; placement translation removed, rotation preserved',
    instanceExpansion: 'every THREE.InstancedMesh is expanded before export: instance matrices composed into the parent frame, zero-scale (hidden) instances dropped, geometries merged with BufferGeometryUtils.mergeGeometries',
    basis: 'source Z-up tree wrapped in a group rotated -90 degrees about X (glTF Y-up); Unity wrapper applies the 180-degree Y correction',
  },
  assets,
  validation: {
    errors: assets.reduce((sum, asset) => sum + asset.validation.errors, 0),
    warnings: assets.reduce((sum, asset) => sum + asset.validation.warnings, 0),
  },
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(`transit: ${assets.length} models, ${summary.validation.errors} errors, ${summary.validation.warnings} warnings`)
