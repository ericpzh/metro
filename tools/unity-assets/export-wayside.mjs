import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Canvas, ImageData, createCanvas } from '@napi-rs/canvas'
import validator from 'gltf-validator'

// The wayside family: everything the track corridor owns — platform screen door
// assemblies and their housing/header/decal layers, the track kit with its slab
// hardware and overhead support, the tunnel shell, and the bridge assembly with
// its railing, noise barrier, edge concrete and bridge-owned pillar.
//
// Every asset is the game's own builder output for one representative station
// document: a 20 m platform edge bound to a 2-car B-stock line over a 20 x 3 m
// track, a 16 m track and tunnel, and a 24 x 3 m bridge. Parameter cases and the
// runtime generators (door cadence, buried-face segmentation, bridge support
// placement, tunnel bore) are exercised in Node and recorded in the manifest.
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
// The palette's brushed-steel grain comes from Math.random; seed it before
// createModelMaterials so every GLB embedding that canvas is byte-stable.
Math.random = seeded(0x57415349) // 'WASI'

globalThis.HTMLCanvasElement = Canvas
globalThis.ImageData = ImageData
// Canvas encodes are serialised: the PSD builder prints several maps per build,
// and GLTFExporter processes textures concurrently.
let encodeQueue = Promise.resolve()
globalThis.document = {
  createElement(name) {
    assert.equal(name, 'canvas')
    const canvas = createCanvas(1, 1)
    Object.defineProperty(canvas, 'data', { value: undefined })
    canvas.toBlob = (callback, mime) => {
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
    blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.() })
  }
}

const gameRequire = createRequire(new URL('../../game/package.json', import.meta.url))
const THREE = await import(new URL('../../game/node_modules/three/build/three.module.js', import.meta.url).href)
const { GLTFExporter } = await import(pathToFileURL(gameRequire.resolve('three/addons/exporters/GLTFExporter.js')).href)
const { mergeGeometries } = await import(pathToFileURL(gameRequire.resolve('three/addons/utils/BufferGeometryUtils.js')).href)
const { createModelMaterials } = await import('../../game/src/render/models/PieceBuilder.ts')
const { buildModule } = await import('../../game/src/render/models.ts')
const { finishPsdHousing } = await import('../../game/src/render/models/pieces/PsdHousing.ts')
const { buildPsd } = await import('../../game/src/render/models/pieces/PsdModel.ts')
const { boreTunnel } = await import('../../game/src/build/model/TunnelShell.ts')
const { bridgePillarCandidates } = await import('../../game/src/build/model/BridgePillars.ts')
const { doorCentres, doorRunOffsets, doorWidthAt, trainScaleForStorey } = await import('../../game/src/sim/stock.ts')
const { bridgeBarrierTop, BRIDGE_DECK_DEPTH, pillarWidth } = await import('../../game/src/sim/structures.ts')
const { thirdRailSide, trackHeadroom } = await import('../../game/src/sim/track.ts')
const { trackGantryLayout } = await import('../../game/src/render/models/pieces/TrackGantry.ts')

const STOREY_HEIGHT = 5
const mats = createModelMaterials()
// The track and pillar builders ask the context for a floor finish. One solid
// concrete material serves the bed, trench, bridge deck, shoulders and shaft.
const concrete = new THREE.MeshStandardMaterial({
  name: 'waysideConcrete',
  color: 0x9d9c94,
  roughness: 0.9,
  metalness: 0.02,
  vertexColors: true,
})
const paletteNames = new Map(Object.entries(mats).map(([name, material]) => [material, name]))
const paletteTextures = new Map()
for (const [name, material] of Object.entries(mats)) {
  if (material.map && !paletteTextures.has(material.map)) paletteTextures.set(material.map, name)
}

const STATION = '人民广场'
const STATION_EN = 'People Square'
const LINE = {
  modelScale: 0.98,
  id: '1',
  name: '1号线',
  colour: '#1b6fd6',
  stock: 'B',
  cars: 2,
  power: 'third-rail',
  psd: 'full',
  headwayProfile: { peak: 150, offpeak: 240, late: 480 },
  alightPerTrain: 200,
  terminus: 'through',
  direction: 'up',
  upTerminus: '广州南站',
  upTerminusEn: 'Guangzhou South',
  upNextStation: '公园前',
  upNextStationEn: 'Gongyuanqian',
  downTerminus: '机场北',
  downTerminusEn: 'Airport North',
  downNextStation: '体育西路',
  downNextStationEn: 'Tiyu Xilu',
  travelSign: 1,
  stations: [],
}

const round = (value) => Number(value.toFixed(6))
const key = (x, y, z) => `${x},${y},${z}`

/** A straight track module; the whole corridor kit shares this payload shape. */
function track({ id = 'track', w = 16, d = 3, z = 0, rot = 0, power = 'third-rail', line = '1', ...cfg } = {}) {
  return { id, storeyHeight: STOREY_HEIGHT, type: 'track', x: 0, y: 0, z, w, d, rot, cfg: { line, power, dir: 'up', ...cfg } }
}
/** A platform-edge run beside a track, one cell deep. */
function edge({ id = 'edge', w = 20, y = -1, side = 'right', from = 'track', psd = 'full', dir = 'up' } = {}) {
  return {
    id, storeyHeight: STOREY_HEIGHT, type: 'platform-edge', x: 0, y, z: 0, w, rot: 0,
    cfg: { name: '屏蔽门', line: '1', dir, side, psd, from },
  }
}
/** The station document a builder reads neighbours, the line and the name from. */
function stationDocument(modules, cells = []) {
  return { name: STATION, nameEn: STATION_EN, storeyHeight: STOREY_HEIGHT, seed: 7654321, cells, modules, lines: [LINE] }
}
function context(data, owned = []) {
  return { mats, data, ads: {}, trackCells: new Set(), finish: () => concrete, owned }
}

/** Compose each instance into an ordinary merged mesh — GLTFExporter drops instance matrices. */
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
      if (scale.x < 1e-6 || scale.y < 1e-6 || scale.z < 1e-6) continue
      geometries.push(batch.geometry.clone().applyMatrix4(world))
    }
    if (geometries.length) {
      const geometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false)
      assert.ok(geometry, `could not merge ${geometries.length} instances of ${batch.name || 'a batch'}`)
      if (geometries.length > 1) for (const clone of geometries) clone.dispose()
      const mesh = new THREE.Mesh(geometry, batch.material)
      mesh.name = batch.name
      parent.add(mesh)
    }
    parent.remove(batch)
  }
}

/** Keep only direct/descendant meshes matching `predicate`; prune empty groups. */
function filterMeshes(root, predicate) {
  for (const child of [...root.children]) {
    if (child.isMesh) {
      if (!predicate(child)) root.remove(child)
    } else {
      filterMeshes(child, predicate)
      if (child.isGroup && child.children.length === 0) root.remove(child)
    }
  }
}

/** Name every material: palette slots keep their palette key; builder prints derive from the part. */
function nameMaterials(root) {
  const used = new Map()
  const taken = new Set()
  root.traverse(object => {
    if (!object.isMesh) return
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material || used.has(material)) continue
      let name = paletteNames.get(material)
      if (!name && material === concrete) name = material.name
      if (!name && material.name) name = material.name
      if (!name && material.map) {
        name = `${(object.name || paletteTextures.get(material.map) || 'printed').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-ink`
      }
      if (!name) name = `waysideMaterial_${(material.color?.getHex() ?? 0).toString(16).padStart(6, '0')}`
      let unique = name
      let suffix = 2
      while (taken.has(unique)) unique = `${name}_${suffix++}`
      used.set(material, unique)
      taken.add(unique)
      material.name = unique
    }
  })
}

/** Give every unnamed mesh a deterministic, material-derived name. */
function nameMeshes(root, prefix) {
  let count = 0
  root.traverse(object => {
    if (!object.isMesh || object.name) return
    const material = Array.isArray(object.material) ? object.material[0] : object.material
    const materialName = (material?.name ?? 'part').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    object.name = `${prefix}-${materialName || 'part'}-${String(++count).padStart(3, '0')}`
  })
}

/** Track hardware names the builder leaves implicit: give the rails and PSU covers semantic names. */
function nameTrackParts(root) {
  root.traverse(object => {
    if (!object.isMesh || object.name) return
    if (object.material === mats.steel && object.geometry.type === 'ExtrudeGeometry') object.name = 'track-running-rail'
    else if (object.material === mats.psu && object.geometry.type === 'BoxGeometry') object.name = 'third-rail-guard'
  })
}

function resetPlacement(root) {
  const placementOffset = root.position.toArray()
  root.position.set(0, 0, 0)
  root.updateMatrixWorld(true)
  return placementOffset
}

/** Renderer-only metadata carries random UUIDs and closures; the recipe strips it all. */
function inspect(root, prefix) {
  nameMaterials(root)
  nameMeshes(root, prefix)
  let triangles = 0
  let meshes = 0
  const materials = new Map()
  const alpha = new Set()
  const glass = new Set()
  const textures = new Set()
  const parts = new Map()
  root.traverse(object => {
    object.userData = {}
    if (!object.isMesh) return
    assert.notEqual(object.isInstancedMesh, true, `${prefix}: an InstancedMesh survived expansion`)
    meshes++
    const count = object.geometry.index?.count ?? object.geometry.getAttribute('position').count
    assert.equal(count % 3, 0, `${prefix}: ${object.name} has ${count} indices`)
    const trianglesHere = count / 3
    triangles += trianglesHere
    const part = parts.get(object.name) ?? { name: object.name, triangles: 0, meshes: 0 }
    part.triangles += trianglesHere
    part.meshes++
    parts.set(object.name, part)
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      assert.ok(material?.name, `${prefix}: ${object.name} has an unnamed material`)
      materials.set(material.name, material)
      if (material.transparent) alpha.add(material.name)
      if (/glass/i.test(material.name)) glass.add(material.name)
      if (material.map) textures.add(material.map)
    }
  })
  assert.equal(Number.isInteger(triangles), true, `${prefix}: triangle count is not an integer`)
  assert.ok(triangles > 0 && meshes > 0, `${prefix}: exported no geometry`)
  return {
    triangles,
    meshes,
    materials: [...materials.keys()].sort(),
    alphaMaterials: [...alpha].sort(),
    glassMaterials: [...glass].sort(),
    textures: textures.size,
    parts: [...parts.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
  }
}

/** Add the basis sockets to the exported root, after the bounds were read. */
function withAnchors(holder, anchors) {
  const gltfRoot = new THREE.Group()
  gltfRoot.name = 'export-root'
  // Source space is Z-up. This single transform rotates it into glTF Y-up.
  gltfRoot.rotation.x = -Math.PI / 2
  gltfRoot.add(holder)
  const records = []
  for (const [name, position] of Object.entries(anchors)) {
    const anchor = new THREE.Object3D()
    anchor.name = name
    anchor.position.fromArray(position)
    gltfRoot.add(anchor)
    records.push({ name, position: position.map(round) })
  }
  return { gltfRoot, records }
}

const out = resolve(process.argv[2] ?? '.preview/unity/wayside-proof/export')
await mkdir(out, { recursive: true })

/**
 * Runtime-only behaviours the Unity side can only prove as a snapshot. Each case
 * runs the game's own TS generator in Node, records the input, the expected
 * result and what it actually produced, and must pass.
 */
function runtimeCases() {
  const cases = []

  // 1. Door cadence and the screen openings it cuts: the opening centres are
  //    measured from the exported door-leaf geometry, not re-derived.
  {
    const run = 20
    const rail = track({ w: run })
    const near = edge({ y: -1, side: 'right', from: rail.id })
    const far = edge({ y: 3, side: 'left', from: rail.id })
    const document = stationDocument([rail, near, far])
    const built = buildModule(near, context(document))
    assert.ok(built, 'platform edge did not build')
    const leaves = built.userData.doors ?? []
    const glasses = leaves.filter(mesh => mesh.name === 'psd-door-glass')
    assert.ok(glasses.length > 0, 'the screen produced no sliding glass leaves')
    const openingOf = (mesh) => mesh.position.x - mesh.userData.openSign * mesh.geometry.parameters.width / 2
    const nearOpenings = [...new Set(glasses.map(openingOf).map(round))].sort((a, b) => a - b)
    const offsets = doorRunOffsets(LINE, run).map(at => round(at - 0.5))
    const inRun = nearOpenings.filter(at => at > -0.4 && at < run - 0.4)
    // The far bank is a second full build, so its openings prove the pair lines up.
    const farBuilt = buildModule(far, context(document))
    const farGlasses = (farBuilt.userData.doors ?? []).filter(mesh => mesh.name === 'psd-door-glass')
    const farOpenings = [...new Set(farGlasses.map(openingOf).map(round))].sort((a, b) => a - b)
    const cadence = inRun.every(at => offsets.some(expected => Math.abs(expected - at) < 1e-3))
    const pair = inRun.length === farOpenings.length && inRun.every((at, i) => Math.abs(at - farOpenings[i]) < 1e-6)
    cases.push({
      id: 'psd-door-cadence',
      kind: 'door cadence / train alignment',
      input: `stock B, cars 2, modelScale ${LINE.modelScale}, rail ${run} m, edge ${run} m on both banks`,
      expected: `4 openings on the run, each centre on a doorRunOffsets entry (${offsets.filter(o => o > -0.4 && o < run - 0.4).join(', ')}); far bank matches`,
      actual: `openings ${inRun.join(', ')}; far ${farOpenings.join(', ')}`,
      pass: inRun.length === 4 && cadence && pair,
    })
  }

  // 2. Dirty-neighbour segmentation: finishPsdHousing must drop the buried cap
  //    faces where one opaque fitting meets another.
  {
    const group = new THREE.Group()
    for (const z of [0.5, 1.5]) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), concrete)
      mesh.position.set(0, 0, z)
      group.add(mesh)
    }
    const count = () => {
      let total = 0
      group.traverse(mesh => { if (mesh.isMesh) total += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3 })
      return total
    }
    const before = count()
    finishPsdHousing(group)
    const after = count()
    const bounds = new THREE.Box3().setFromObject(group)
    cases.push({
      id: 'psd-housing-segmentation',
      kind: 'dirty-neighbour segmentation',
      input: 'two 1 x 1 x 1 opaque boxes stacked, sharing the z=1 plane',
      expected: 'the shared cap faces are removed: 24 -> 20 triangles, bounds stay 1 x 1 x 2',
      actual: `${before} -> ${after} triangles, size ${bounds.getSize(new THREE.Vector3()).toArray().map(round).join(' x ')}`,
      pass: before === 24 && after === 20 &&
        Math.abs(bounds.getSize(new THREE.Vector3()).x - 1) < 1e-6 &&
        Math.abs(bounds.getSize(new THREE.Vector3()).z - 2) < 1e-6,
    })
  }

  // 3. Bridge-owned support placement: one thick pier per complete 8 m bay, at
  //    the bed centreline, from the street datum up to the deck underside.
  {
    const bridge = track({ id: 'bridge', z: 8, w: 24, bridge: true, bridgeRailing: 'railing' })
    const all = bridgePillarCandidates([], [bridge], bridge)
    const kept = bridgePillarCandidates([], [bridge], { ...bridge, cfg: { ...bridge.cfg, removedBridgePillars: ['bridge:pillar:12'] } })
    const sites = all.map(pillar => `${pillar.x},${pillar.y},z${pillar.z},h${pillar.cfg.height}`).join(' ')
    cases.push({
      id: 'bridge-support-placement',
      kind: 'bridge-owned support placement',
      input: 'bridge 24 x 3 m at z 8, street datum z 0, no removed piers',
      expected: 'three thick piers at (4,1) (12,1) (20,1), z 0, height 8; removing bridge:pillar:12 leaves two',
      actual: `${all.length} piers: ${sites}; removed -> ${kept.map(pillar => pillar.id).join(', ')}`,
      pass: all.length === 3 && kept.length === 2 &&
        all.every(pillar => pillar.cfg.size === 'thick' && pillar.z === 0 && pillar.cfg.height === 8) &&
        all.map(pillar => pillar.x).join(',') === '4,12,20' &&
        all.every(pillar => pillar.y === 1),
    })
  }

  // 4. Tunnel bore: the shell cells the game's own boreTunnel writes.
  {
    const tunnel = track({ id: 'tunnel', w: 16, tunnel: true })
    const bored = boreTunnel({ cells: [], modules: [tunnel] }, tunnel)
    const shell = bored.cells.filter(cell => cell.tags?.some(tag => tag.startsWith('tunnel-shell:')))
    const bounds = {
      x: [Math.min(...shell.map(c => c.x)), Math.max(...shell.map(c => c.x)) + 1],
      y: [Math.min(...shell.map(c => c.y)), Math.max(...shell.map(c => c.y)) + 1],
      z: [Math.min(...shell.map(c => c.z)), Math.max(...shell.map(c => c.z)) + 1],
    }
    cases.push({
      id: 'tunnel-shell-bore',
      kind: 'tunnel shell',
      input: 'tunnel track 16 x 3 m at z 0, headroom 3 courses',
      expected: '208 shell cells: 2 side walls x 5 courses + 3 ceiling cells per metre; bounds 16 x 5 x 5',
      actual: `${shell.length} cells; bounds ${bounds.x.join('..')} x ${bounds.y.join('..')} x ${bounds.z.join('..')}`,
      pass: shell.length === 208 && trackHeadroom(tunnel) === 3 &&
        bounds.x[0] === 0 && bounds.x[1] === 16 && bounds.y[0] === -1 && bounds.y[1] === 4 && bounds.z[0] === 0 && bounds.z[1] === 5,
    })
  }

  // 5. Catenary support layout: the gantry uprights the overhead support row relies on.
  {
    const station = track({ w: 16, power: 'catenary', catenaryStyle: 'gantry' })
    const bridge = track({ id: 'bridge', w: 24, power: 'catenary', bridge: true })
    const stationLayout = trackGantryLayout(station, thirdRailSide(station), 2.8)
    const bridgeLayout = trackGantryLayout(bridge, thirdRailSide(bridge), 2.8)
    cases.push({
      id: 'gantry-layout',
      kind: 'overhead support layout',
      input: 'station gantry 16 m, bridge gantry 24 m, B-stock vehicle width 2.8 m',
      expected: 'station xs -0.5 and 14.5 (2 posts); bridge xs 0, 8, 16 (3 posts), one mast row per run',
      actual: `station ${stationLayout?.xs.join(', ')}; bridge ${bridgeLayout?.xs.join(', ')}`,
      pass: stationLayout?.xs.length === 2 && bridgeLayout?.xs.length === 3 &&
        stationLayout.xs[0] === -0.5 && stationLayout.xs[1] === 14.5 &&
        bridgeLayout.xs.join(',') === '0,8,16',
    })
  }

  return cases.map(record => ({ ...record, pass: record.pass ? 'true' : 'false' }))
}

const cases = runtimeCases()
for (const record of cases) assert.equal(record.pass, 'true', `${record.id}: ${record.actual}`)

const assets = []
const failures = []

async function emit({ spec, holder, anchors, extra = {} }) {
  const stats = inspect(holder, spec.id.replace(/[^a-z0-9]+/gi, '-'))
  const bounds = new THREE.Box3().setFromObject(holder)
  assert.ok(!bounds.isEmpty(), `${spec.id}: empty bounds`)
  if (!holder.name) holder.name = 'model'
  const { gltfRoot, records } = withAnchors(holder, anchors)
  gltfRoot.name = spec.prefab

  const bytes = new Uint8Array(await new GLTFExporter().parseAsync(gltfRoot, { binary: true }))
  const base = spec.file.replace(/\.glb$/, '')
  const report = await validator.validateBytes(bytes, { uri: spec.file })
  await writeFile(join(out, `${base}.validation.json`), JSON.stringify(report, null, 2) + '\n')
  assert.equal(report.issues.numErrors + report.issues.numWarnings, 0,
    `${spec.file}: ${report.issues.numErrors} errors, ${report.issues.numWarnings} warnings`)

  const manifest = {
    schemaVersion: 1,
    id: spec.id,
    row: spec.id,
    family: 'wayside',
    prefab: spec.prefab,
    file: spec.file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: spec.source,
    provenance: 'Repository-authored procedural station geometry, palette and canvas signage',
    licenseRecord: 'Repository-authored procedural geometry; no third-party assets',
    units: 'metres',
    placementOffset: spec.placementOffset.map(round),
    min: bounds.min.toArray().map(round),
    max: bounds.max.toArray().map(round),
    size: bounds.getSize(new THREE.Vector3()).toArray().map(round),
    triangles: stats.triangles,
    meshes: stats.meshes,
    materials: stats.materials,
    alphaMaterials: stats.alphaMaterials,
    glassMaterials: stats.glassMaterials,
    textures: stats.textures,
    anchors: records,
    parts: stats.parts,
    parameters: Object.entries(extra.parameters ?? {}).map(([key, value]) => ({ key, value: String(value) })),
    ...extra.fields,
    validation: { errors: report.issues.numErrors, warnings: report.issues.numWarnings },
  }
  return { manifest, bytes }
}

async function publish(entry) {
  const { manifest, bytes } = entry
  const base = manifest.file.replace(/\.glb$/, '')
  await writeFile(join(out, manifest.file), bytes)
  await writeFile(join(out, `${base}.manifest.json`), JSON.stringify(manifest, null, 2) + '\n')
  assets.push(manifest)
  console.log(`${manifest.id}: ${manifest.triangles}t/${manifest.meshes}m ${manifest.materials.length}mat ` +
    `(${manifest.alphaMaterials.length}a, ${manifest.glassMaterials.length}g) ${manifest.textures}tex ` +
    `${bytes.length}b ${manifest.sha256.slice(0, 12)}`)
}

/* ---------------------------------------------------------------- platform */

const RUN = 20
const platformTrack = track({ id: 'track-platform', w: RUN })
const nearEdge = edge({ id: 'edge-near', y: -1, side: 'right', from: platformTrack.id })
const farEdge = edge({ id: 'edge-far', y: 3, side: 'left', from: platformTrack.id })
const platformDocument = stationDocument([platformTrack, nearEdge, farEdge])

/** Build one module at a stable local origin and expand its instances. */
function build(mod, document) {
  const root = buildModule(mod, context(document))
  assert.ok(root, `${mod.id}: builder returned null`)
  root.updateMatrixWorld(true)
  expandInstances(root)
  const placementOffset = resetPlacement(root)
  return { root, placementOffset }
}

const PLATFORM_ANCHORS = {
  AxisX: [1, 0, 0],
  Up: [0, 0, 1],
  TrackFace: [0, 0.34, 0],
  PlatformSide: [0, -0.67, 0],
}

// platform-edge: the full screen assembly, with its line, doors and platform pair.
{
  const { root, placementOffset } = build(nearEdge, platformDocument)
  const leaves = (root.userData.doors ?? []).map(mesh => ({
    name: mesh.name || '',
    x: round(mesh.position.x),
    openSign: mesh.userData.openSign,
    travel: round(mesh.userData.travel ?? 0),
    leafWidth: round(mesh.geometry.parameters?.width ?? 0),
    glass: mesh.name === 'psd-door-glass',
  }))
  const glasses = leaves.filter(leaf => leaf.glass)
  const openings = [...new Set(glasses.map(leaf => round(leaf.x - leaf.openSign * leaf.leafWidth / 2)))].sort((a, b) => a - b)
  const entry = emit({
    spec: { id: 'platform-edge', prefab: 'PlatformEdge', file: 'PlatformEdge.glb', source: 'game/src/render/models/pieces/PsdModel.ts', placementOffset },
    holder: root,
    anchors: PLATFORM_ANCHORS,
    extra: {
      fields: { doorLeaves: leaves.filter(leaf => leaf.glass), openings, doorLeafCount: leaves.length },
      parameters: {
        assembly: 'full-height platform screen doors on a 20 m run',
        line: `${LINE.id} / ${LINE.stock} stock / ${LINE.cars} cars / psd full`,
        platformPair: 'near bank side=right at j=-1 and far bank side=left at j=d; both derived from one 20 x 3 m track',
        side: 'right (track is local +y)',
        direction: 'up',
        stationName: STATION,
        headers: 'route and station panels above each train-aligned opening',
        doorCadence: 'doorRunOffsets from the B-stock consist: door centres -2.744, 2.744, ... at 12 m spacing',
        openings: openings.length,
        leaves: leaves.length,
      },
    },
  })
  await publish(await entry)
}

// platform-edge-housing: the aluminium enclosure — sill, foundation, fascia, mullions, section pillars.
{
  const { root, placementOffset } = build(nearEdge, platformDocument)
  const doors = new Set(root.userData.doors ?? [])
  const drop = new Set([
    'psd-fixed-glass', 'psd-fixed-band', 'psd-door-band', 'psd-door-warning', 'psd-door-arrow',
    'psd-route-header', 'psd-station-header', 'psd-fixed-sticker', 'psd-station-light', 'psd-station-light-bezel',
    'platform-yellow-line',
  ])
  filterMeshes(root, mesh => !doors.has(mesh) && !drop.has(mesh.name) && !/glass/i.test(mesh.material?.name ?? ''))
  const entry = emit({
    spec: { id: 'platform-edge-housing', prefab: 'PlatformEdgeHousing', file: 'PlatformEdgeHousing.glb', source: 'game/src/render/models/pieces/PsdHousing.ts', placementOffset },
    holder: root,
    anchors: PLATFORM_ANCHORS,
    extra: {
      parameters: {
        enclosure: 'psd-threshold, concrete foundation, info housing, fixed posts, section pillars and line-colour band',
        excluded: 'sliding leaves, fixed glass and printed decals',
        depthMetres: 0.18,
        partition: 'one section pillar between glass runs, jambs at every opening',
        segmentation: 'finishPsdHousing exposes only uncovered faces on opaque fittings',
      },
    },
  })
  await publish(await entry)
}

// platform-edge-header: route and station panels over the fascia.
{
  const { root, placementOffset } = build(nearEdge, platformDocument)
  const keep = new Set(['psd-info-housing', 'psd-route-header', 'psd-station-header', 'psd-line-colour-band'])
  filterMeshes(root, mesh => keep.has(mesh.name))
  const entry = emit({
    spec: { id: 'platform-edge-header', prefab: 'PlatformEdgeHeader', file: 'PlatformEdgeHeader.glb', source: 'game/src/render/models/pieces/PsdHeader.ts', placementOffset },
    holder: root,
    anchors: PLATFORM_ANCHORS,
    extra: {
      parameters: {
        headerHeightMetres: 0.53,
        headerPixels: 256,
        stationName: STATION,
        stationNameEn: STATION_EN,
        route: 'destination + adjacent station with the direction arrow, on the line colour',
        station: 'station name panel above each door opening',
        lineColour: LINE.colour,
        direction: 'up',
      },
    },
  })
  await publish(await entry)
}

// platform-edge-decals: safety vinyl, door markings, warnings and arrows.
{
  const { root, placementOffset } = build(nearEdge, platformDocument)
  const keep = new Set(['psd-fixed-band', 'psd-door-band', 'psd-door-warning', 'psd-door-arrow'])
  filterMeshes(root, mesh => keep.has(mesh.name))
  const entry = emit({
    spec: { id: 'platform-edge-decals', prefab: 'PlatformEdgeDecals', file: 'PlatformEdgeDecals.glb', source: 'game/src/render/models/pieces/PsdDecals.ts', placementOffset },
    holder: root,
    anchors: PLATFORM_ANCHORS,
    extra: {
      parameters: {
        fixedBand: '1024 x 128 mind-the-gap strip on every fixed pane, metre-scaled UVs',
        doorBand: '640 x 128 yellow/red door warning band on every leaf',
        warning: '640 x 480 keep-clear pictogram',
        arrows: 'two 256 x 256 direction arrows per opening',
        colour: 'red #b52630, yellow #f5d62c, ink #20262a',
        transparency: 'alpha-tested warning and arrow decals, depthWrite off',
      },
    },
  })
  await publish(await entry)
}

/* ------------------------------------------------------------------- track */

const TRACK_ANCHORS = { AxisX: [1, 0, 0], Up: [0, 0, 1], BedCentre: [0, 1, 0] }

// track-kit: a straight and a quarter-turned path. Curved and junction paths are
// not modelled by the game's track schema, so the row records that gap.
{
  const straightMod = track({ id: 'track-straight', w: 16 })
  const straight = build(straightMod, stationDocument([straightMod]))
  const turnedMod = track({ id: 'track-turn', w: 16, rot: 1 })
  const turned = build(turnedMod, stationDocument([turnedMod]))
  nameTrackParts(straight.root)
  nameTrackParts(turned.root)
  const holder = new THREE.Group()
  holder.name = 'track-kit'
  straight.root.name = 'track-path-straight'
  turned.root.name = 'track-path-turn'
  // The quarter turn keeps its builder rotation (it carries the run axis) and is
  // set behind the straight path so both read in one frame.
  turned.root.position.set(0, 18, 0)
  holder.add(straight.root, turned.root)
  const entry = emit({
    spec: { id: 'track-kit', prefab: 'TrackKit', file: 'TrackKit.glb', source: 'game/src/render/models/pieces/TrackModel.ts', placementOffset: straight.placementOffset },
    holder,
    anchors: TRACK_ANCHORS,
    extra: {
      parameters: {
        straight: '16 x 3 m straight path, rot 0 (run along +x)',
        turned: '16 x 3 m quarter-turned path, rot 1 (run along +y), builder rotation preserved',
        power: 'third rail',
        curved: 'unsupported: SaveDoc.static.track.alignments is never[]; no curved alignment type or mesh exists',
        junction: 'unsupported: SaveDoc.static.track.junctions is never[]; no junction type or mesh exists',
        bed: 'three-cell car-width bed with recessed slab, trench walls and rail datum',
      },
    },
  })
  await publish(await entry)
}

// track-details: rail, slab track bed and third-rail power details.
{
  const mod = track({ id: 'track-details', w: 16 })
  const { root, placementOffset } = build(mod, stationDocument([mod, edge({ id: 'edge-details', from: mod.id })]))
  nameTrackParts(root)
  const entry = emit({
    spec: { id: 'track-details', prefab: 'TrackDetails', file: 'TrackDetails.glb', source: 'game/src/render/models/pieces/TrackDetails.ts', placementOffset },
    holder: root,
    anchors: TRACK_ANCHORS,
    extra: {
      parameters: {
        track: '16 x 3 m straight, third-rail power',
        rail: 'two 0.07 m running rails on 1.435 m gauge, extruded bevelled crown over a dark web',
        bed: 'recessed concrete slab, drainage troughs and a 0.04 m centre slab',
        sleepers: '0.23 m concrete sleepers on a 0.6 m pitch',
        fastenings: 'rail seats, spring clips and anchor bolts, baked from instanced batches',
        power: 'guarded 750 V third rail on the side away from the platform screen',
        thirdRailSide: thirdRailSide(mod, [edge({ id: 'edge-details', from: mod.id })], 'up'),
      },
    },
  })
  await publish(await entry)
}

// track-gantry: overhead support — masts, cantilevers, registration and contact wire.
{
  const mod = track({ id: 'track-gantry', w: 16, power: 'catenary', catenaryStyle: 'gantry' })
  const { root, placementOffset } = build(mod, stationDocument([mod]))
  const entry = emit({
    spec: { id: 'track-gantry', prefab: 'TrackGantry', file: 'TrackGantry.glb', source: 'game/src/render/models/pieces/TrackGantry.ts', placementOffset },
    holder: root,
    anchors: TRACK_ANCHORS,
    extra: {
      parameters: {
        track: '16 x 3 m straight, catenary power, gantry style',
        posts: 'two 0.12 m masts on the travel side at x -0.5 and 14.5',
        support: 'cantilever arm, triangular brace, insulated upper stay and registration arm',
        wire: 'contact wire at the pantograph plane, messenger wire and droppers',
        headroomCourses: 4,
        gantryRule: 'one mast row per 8 m bay, shared with the bridge barrier cut-outs',
      },
    },
  })
  await publish(await entry)
}

// track-tunnel: the shell the game bores around a tunnel track, with its track inside.
{
  const mod = track({ id: 'track-tunnel', w: 16, tunnel: true })
  const document = stationDocument([mod])
  const { root: trackRoot, placementOffset } = build(mod, document)
  nameTrackParts(trackRoot)
  // boreTunnel writes the solid shell cells; extract their exposed faces as one
  // concrete surface per orientation, exactly the shell surface the game draws.
  const bored = boreTunnel({ cells: [], modules: [mod] }, mod)
  const shellCells = bored.cells.filter(cell => cell.tags?.some(tag => tag.startsWith('tunnel-shell:')))
  assert.ok(shellCells.length > 0, 'tunnel shell produced no cells')
  const solid = new Set(bored.cells.filter(cell => cell.fill === 'solid').map(cell => key(cell.x, cell.y, cell.z)))
  const buckets = new Map()
  const addFace = (name, corners, normal) => {
    let bucket = buckets.get(name)
    if (!bucket) buckets.set(name, bucket = { positions: [], normals: [], uvs: [], indices: [] })
    const base = bucket.positions.length / 3
    for (const [x, y, z] of corners) {
      bucket.positions.push(x, y, z)
      bucket.normals.push(...normal)
      bucket.uvs.push(x + y, z)
    }
    bucket.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const faces = [
    { n: [1, 0, 0], name: 'tunnel-shell-portal', c: (x, y, z) => [[x + 1, y, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x + 1, y, z + 1]] },
    { n: [-1, 0, 0], name: 'tunnel-shell-portal', c: (x, y, z) => [[x, y + 1, z], [x, y, z], [x, y, z + 1], [x, y + 1, z + 1]] },
    { n: [0, 1, 0], name: 'tunnel-shell-wall', c: (x, y, z) => [[x + 1, y + 1, z], [x, y + 1, z], [x, y + 1, z + 1], [x + 1, y + 1, z + 1]] },
    { n: [0, -1, 0], name: 'tunnel-shell-wall', c: (x, y, z) => [[x, y, z], [x + 1, y, z], [x + 1, y, z + 1], [x, y, z + 1]] },
    { n: [0, 0, 1], name: 'tunnel-shell-roof', c: (x, y, z) => [[x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]] },
    { n: [0, 0, -1], name: 'tunnel-shell-ceiling', c: (x, y, z) => [[x, y + 1, z], [x + 1, y + 1, z], [x + 1, y, z], [x, y, z]] },
  ]
  for (const cell of shellCells) {
    for (const face of faces) {
      const [nx, ny, nz] = face.n
      if (solid.has(key(cell.x + nx, cell.y + ny, cell.z + nz))) continue
      addFace(face.name, face.c(cell.x, cell.y, cell.z), face.n)
    }
  }
  const shell = new THREE.Group()
  shell.name = 'tunnel-shell'
  for (const [name, bucket] of buckets) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(bucket.positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.normals, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(bucket.uvs, 2))
    geometry.setIndex(bucket.indices)
    geometry.computeBoundingBox()
    const mesh = new THREE.Mesh(geometry, concrete)
    mesh.name = name
    shell.add(mesh)
  }
  const holder = new THREE.Group()
  holder.name = 'track-tunnel'
  trackRoot.name = 'tunnel-track'
  trackRoot.position.set(0.5, 0.5, 0)
  holder.add(shell, trackRoot)
  const entry = emit({
    spec: { id: 'track-tunnel', prefab: 'TrackTunnel', file: 'TrackTunnel.glb', source: 'game/src/render/models/pieces/TrackModel.ts', placementOffset },
    holder,
    anchors: { AxisX: [1, 0, 0], Up: [0, 0, 1], BoreCentre: [8, 1.5, 2] },
    extra: {
      parameters: {
        bore: '16 m tunnel, 3 m clear width, 3 courses headroom',
        shell: `${shellCells.length} solid shell cells from build/model/TunnelShell.ts boreTunnel; 1 m walls and crown`,
        portal: 'open at both ends; the bore exposes its walls, crown and inner ceiling',
        track: 'recessed bed, running rails and third-rail power inside the shell',
        trackHeadroomCourses: trackHeadroom(mod),
      },
    },
  })
  await publish(await entry)
}

/* ------------------------------------------------------------------ bridge */

const BRIDGE_ANCHORS = { AxisX: [1, 0, 0], Up: [0, 0, 1], DeckUnderside: [0, 1, -BRIDGE_DECK_DEPTH], ShoulderNorth: [0, 2.66, 0], ShoulderSouth: [0, -0.66, 0] }

// bridge-kit: the complete elevated span — deck, shoulders, gantry support and railing.
{
  const mod = track({ id: 'bridge', w: 24, z: 8, power: 'catenary', bridge: true, bridgeRailing: 'railing' })
  const { root, placementOffset } = build(mod, stationDocument([mod]))
  nameTrackParts(root)
  const entry = emit({
    spec: { id: 'bridge-kit', prefab: 'BridgeKit', file: 'BridgeKit.glb', source: 'game/src/render/models/pieces/TrackModel.ts', placementOffset },
    holder: root,
    anchors: BRIDGE_ANCHORS,
    extra: {
      parameters: {
        span: '24 x 3 m bridge at 8 m above the street',
        deck: '1 m concrete trough over a steel track bed, shoulders raised to the railing footing',
        railing: 'steel railing on both shoulders',
        power: 'catenary with a bridge gantry mast every 8 m',
        supports: 'bridge-gantry-post uprights at x 0, 8, 16 on the travel side',
        edgeConcrete: 'continuous shoulders cut around the gantry posts',
      },
    },
  })
  await publish(await entry)
}

// bridge-railing: the shared steel railing profile.
{
  const mod = track({ id: 'bridge-railing', w: 24, z: 8, bridge: true, bridgeRailing: 'railing' })
  const { root, placementOffset } = build(mod, stationDocument([mod]))
  filterMeshes(root, mesh => mesh.name.startsWith('bridge-railing-'))
  const entry = emit({
    spec: { id: 'bridge-railing', prefab: 'BridgeRailing', file: 'BridgeRailing.glb', source: 'game/src/render/models/pieces/BridgeRailing.ts', placementOffset },
    holder: root,
    anchors: BRIDGE_ANCHORS,
    extra: {
      parameters: {
        profile: '0.08 m steel top rail at 1.25 m over 0.08 m posts every 2 m',
        runs: 'both bridge shoulders, 24 m',
        posts: 13,
        material: 'palette steel',
      },
    },
  })
  await publish(await entry)
}

// bridge-noise-barrier: full-height sound barrier with glazed bays.
{
  const mod = track({ id: 'bridge-barrier', w: 24, z: 8, bridge: true, bridgeRailing: 'sound-barrier' })
  const { root, placementOffset } = build(mod, stationDocument([mod]))
  filterMeshes(root, mesh => mesh.name.startsWith('bridge-barrier-'))
  const entry = emit({
    spec: { id: 'bridge-noise-barrier', prefab: 'BridgeNoiseBarrier', file: 'BridgeNoiseBarrier.glb', source: 'game/src/render/models/pieces/BridgeNoiseBarrier.ts', placementOffset },
    holder: root,
    anchors: BRIDGE_ANCHORS,
    extra: {
      parameters: {
        topMetres: bridgeBarrierTop('sound-barrier'),
        bays: '2 m steel posts every 2 m, lower white panel, glazed band, middle and top rails',
        glazing: '3 mm clearance inside the opaque frame on every edge',
        runs: 'both bridge shoulders, 24 m',
        material: 'steel frame, white lower panel, palette glass',
      },
    },
  })
  await publish(await entry)
}

// bridge-edge-concrete: the raised deck shoulders.
{
  const mod = track({ id: 'bridge-edge', w: 24, z: 8, bridge: true, bridgeRailing: 'railing' })
  const { root, placementOffset } = build(mod, stationDocument([mod]))
  filterMeshes(root, mesh => mesh.name === 'bridge-edge-concrete')
  const entry = emit({
    spec: { id: 'bridge-edge-concrete', prefab: 'BridgeEdgeConcrete', file: 'BridgeEdgeConcrete.glb', source: 'game/src/render/models/pieces/BridgeEdgeConcrete.ts', placementOffset },
    holder: root,
    anchors: BRIDGE_ANCHORS,
    extra: {
      parameters: {
        shoulderDepthMetres: 0.5,
        heightMetres: 0.55,
        runs: 'both bridge shoulders, 24 m, split around gantry posts',
        material: 'waysideConcrete',
      },
    },
  })
  await publish(await entry)
}

// bridge-pillar: the thick pier the bridge generates under each complete 8 m bay.
{
  const bridge = track({ id: 'bridge-pillar-span', w: 24, z: 8, bridge: true, bridgeRailing: 'railing' })
  const candidates = bridgePillarCandidates([], [bridge], bridge)
  assert.equal(candidates.length, 3, 'expected one pier per complete bay')
  const pillar = { ...candidates[0] }
  const root = buildModule(pillar, context(stationDocument([bridge, pillar])))
  assert.ok(root, 'bridge pillar did not build')
  root.updateMatrixWorld(true)
  expandInstances(root)
  const placementOffset = resetPlacement(root)
  let meshIndex = 0
  root.traverse(object => {
    if (!object.isMesh) return
    object.name = meshIndex++ === 0 ? 'bridge-pillar-shaft' : 'bridge-pillar-collar'
  })
  const entry = emit({
    spec: { id: 'bridge-pillar', prefab: 'BridgePillar', file: 'BridgePillar.glb', source: 'game/src/render/models/pieces/PillarModel.ts', placementOffset },
    holder: root,
    anchors: { AxisX: [1, 0, 0], Up: [0, 0, 1], Base: [0, 0, 0] },
    extra: {
      fields: { openings: [] },
      parameters: {
        placement: 'bridge-owned: thick pier at the centreline of each complete 8 m bay',
        site: `${pillar.id} at cell (${pillar.x}, ${pillar.y}), base z ${pillar.z}`,
        heightMetres: bridge.z - BRIDGE_DECK_DEPTH - pillar.z - 1,
        widthMetres: pillarWidth(pillar),
        size: pillar.cfg.size,
        finish: 'waysideConcrete shaft with steel cap collars',
        candidates: candidates.length,
        removedPiers: 'bridgePillarCandidates honours cfg.removedBridgePillars',
      },
    },
  })
  await publish(await entry)
}

/* ------------------------------------------------------------------ summary */

const summary = {
  schemaVersion: 1,
  family: 'wayside',
  sourcePaths: [
    'game/src/render/models/pieces/PsdModel.ts',
    'game/src/render/models/pieces/PsdHousing.ts',
    'game/src/render/models/pieces/PsdHeader.ts',
    'game/src/render/models/pieces/PsdDecals.ts',
    'game/src/render/models/pieces/TrackModel.ts',
    'game/src/render/models/pieces/TrackDetails.ts',
    'game/src/render/models/pieces/TrackGantry.ts',
    'game/src/render/models/pieces/BridgeRailing.ts',
    'game/src/render/models/pieces/BridgeNoiseBarrier.ts',
    'game/src/render/models/pieces/BridgeEdgeConcrete.ts',
    'game/src/render/models/pieces/PillarModel.ts',
    'game/src/build/model/TunnelShell.ts',
    'game/src/build/model/BridgePillars.ts',
    'game/src/render/models/PieceBuilder.ts',
    'game/src/sim/stock.ts',
    'game/src/sim/structures.ts',
    'game/src/sim/track.ts',
    'game/src/sim/psdEnds.ts',
  ],
  parameters: {
    family: 'wayside',
    assets: assets.length,
    station: STATION,
    stationEn: STATION_EN,
    lineId: LINE.id,
    stock: LINE.stock,
    cars: LINE.cars,
    modelScale: LINE.modelScale,
    platformRun: '20 m platform edge beside a 20 x 3 m track, full-height screen doors on both banks',
    platformPair: 'near bank side=right at j=-1 and far bank side=left at j=d; both builds produce the same four opening centres',
    trackKit: 'straight 16 x 3 m path plus a quarter-turned 16 x 3 m path; one bed depth, third rail',
    tunnel: '16 m bore, 3 m clear width, 3 courses headroom, 208 shell cells',
    bridge: '24 x 3 m span at 8 m, concrete trough over a steel bed, railing or full-height noise barrier, thick piers every 8 m',
    curvedPaths: 'unsupported: SaveDoc.static.track.alignments is never[] and TrackModel has no curved alignment',
    junctionPaths: 'unsupported: SaveDoc.static.track.junctions is never[] and no junction generator or mesh exists',
    materials: 'createModelMaterials palette plus waysideConcrete and the PSD canvas prints (headers, bands, warnings, arrows, line-colour band)',
    textures: 'brushed-steel grain and the PSD canvas signage; encoded serially and seeded so every GLB is byte-stable',
    instanceExpansion: 'every THREE.InstancedMesh (sleepers, seats, clips, bolts) is expanded: instances composed, merged per batch and carried by the batch material',
    basis: 'source Z-up tree wrapped in a group rotated -90 degrees about X (glTF Y-up); Unity wrapper applies the 180-degree Y correction so bounds read (x, z, y)',
    anchors: 'AxisX, Up and a per-row physical socket (TrackFace, BedCentre, BoreCentre, DeckUnderside, Base)',
    runtime: cases,
    paths: [
      { kind: 'straight', rot: 0, w: 16, d: 3, note: 'exported in TrackKit' },
      { kind: 'quarter-turn', rot: 1, w: 16, d: 3, note: 'exported in TrackKit; builder rotation preserved' },
      { kind: 'curved', rot: 0, w: 0, d: 0, note: 'unsupported: no alignment type in the save schema' },
      { kind: 'junction', rot: 0, w: 0, d: 0, note: 'unsupported: no junction type in the save schema' },
    ],
  },
  assets,
  validation: {
    errors: assets.reduce((sum, asset) => sum + asset.validation.errors, 0),
    warnings: assets.reduce((sum, asset) => sum + asset.validation.warnings, 0),
  },
}
assert.equal(assets.length, 13, `expected 13 row assets, got ${assets.length}`)
await writeFile(join(out, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(`WAYSIDE_EXPORT_OK ${assets.length} assets, ${summary.validation.errors} errors, ${summary.validation.warnings} warnings -> ${out}`)




