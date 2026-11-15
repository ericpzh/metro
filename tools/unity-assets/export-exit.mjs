// Export the exit family: the covered and open 出入口 head-houses (one, two and
// three bays), the four 地面 doorway headers and the 虚拟 1×1 exit marker.
//
// Every asset is the game's own `buildModule` output for one placed module at a
// stable local origin, standing in an empty station document so the default
// Guangzhou city style applies. Three builders are involved: `ExitModel` draws
// the head-houses (with `buildWavyRoof`, the red steel frame, the glass sides and
// the printed header), `DoorwayExitModel` the wall-fixed doorway panels, and
// `GuidepostModel` the 虚拟 exit marker. They share one uniform manifest.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Canvas, ImageData, createCanvas } from '@napi-rs/canvas'
import validator from 'gltf-validator'

// The family prints real canvases: the palette's 64 px brushed-stainless grain,
// the 出入口 header (metro mark, station name, exit letter) and — for the 虚拟
// marker — the guidepost's seven plates. Use the same `@napi-rs/canvas` adapter
// as export-concourse: Three's GLTFExporter treats any image with a `data`
// property as a DataTexture and would write transparent black, so shadow it.
//
// GLTFExporter appends each image's bufferView only when its asynchronous encode
// settles, so a marker with seven plates would race itself and produce different
// GLB bytes between two runs. Serialize the encode and the FileReader read:
// completion order then follows the deterministic material order, and the
// runner's two-export byte comparison holds.
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

// The palette's brushed-stainless grain is drawn with `Math.random`; pin the
// stream before PieceBuilder is imported so every run embeds the same PNG.
let seed = 0x9e3779b9
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
const { DEFAULT_CITY_STYLE } = await import('../../game/src/sim/cityStyles.ts')
const { EXIT_BACK, EXIT_BACK_Y, EXIT_H, EXIT_L, EXIT_REACH, exitWidth } = await import('../../game/src/sim/exits.ts')
const { EXIT_BASE_HEIGHT } = await import('../../game/src/sim/exitLanding.ts')

/** The eleven family models, in review-row order. */
const MODELS = [
  // 有盖 head-houses: the reference two-bay 双向, the one-bay 单向 and the three-bay 三向.
  { paletteId: 'exit', prefab: 'Exit', id: 'station.exit.standard', variant: 'covered-2', style: 'head-house', covered: true, bays: 2, source: 'game/src/render/models/pieces/ExitModel.ts' },
  { paletteId: 'exit-covered-1', prefab: 'ExitCovered1', id: 'station.exit.covered-1', variant: 'covered-1', style: 'head-house', covered: true, bays: 1, source: 'game/src/render/models/pieces/ExitModel.ts' },
  { paletteId: 'exit-covered-3', prefab: 'ExitCovered3', id: 'station.exit.covered-3', variant: 'covered-3', style: 'head-house', covered: true, bays: 3, source: 'game/src/render/models/pieces/ExitModel.ts' },
  // 地面 X向 doorway headers: wall-fixed panels, not head-houses.
  { paletteId: 'exit-doorway-1', prefab: 'ExitDoorway1', id: 'station.exit.doorway-1', variant: 'doorway-1', style: 'doorway', covered: true, bays: 1, source: 'game/src/render/models/pieces/DoorwayExitModel.ts' },
  { paletteId: 'exit-doorway-2', prefab: 'ExitDoorway2', id: 'station.exit.doorway-2', variant: 'doorway-2', style: 'doorway', covered: true, bays: 2, source: 'game/src/render/models/pieces/DoorwayExitModel.ts' },
  { paletteId: 'exit-doorway-3', prefab: 'ExitDoorway3', id: 'station.exit.doorway-3', variant: 'doorway-3', style: 'doorway', covered: true, bays: 3, source: 'game/src/render/models/pieces/DoorwayExitModel.ts' },
  { paletteId: 'exit-doorway-4', prefab: 'ExitDoorway4', id: 'station.exit.doorway-4', variant: 'doorway-4', style: 'doorway', covered: true, bays: 4, source: 'game/src/render/models/pieces/DoorwayExitModel.ts' },
  // 无盖 open exits: railings in place of the roof, frame and walls.
  { paletteId: 'exit-uncovered-1', prefab: 'ExitUncovered1', id: 'station.exit.uncovered-1', variant: 'uncovered-1', style: 'head-house', covered: false, bays: 1, source: 'game/src/render/models/pieces/ExitModel.ts' },
  { paletteId: 'exit-uncovered-2', prefab: 'ExitUncovered2', id: 'station.exit.uncovered-2', variant: 'uncovered-2', style: 'head-house', covered: false, bays: 2, source: 'game/src/render/models/pieces/ExitModel.ts' },
  { paletteId: 'exit-uncovered-3', prefab: 'ExitUncovered3', id: 'station.exit.uncovered-3', variant: 'uncovered-3', style: 'head-house', covered: false, bays: 3, source: 'game/src/render/models/pieces/ExitModel.ts' },
  // 虚拟 exit: a 1×1 visual marker / placement preview, drawn by the 导向柱 model.
  { paletteId: 'exit-virtual', prefab: 'ExitVirtual', id: 'station.exit.virtual', variant: 'virtual', style: 'virtual', covered: true, bays: 1, source: 'game/src/render/models/pieces/StreetDecorModel.ts' },
].map(spec => ({
  ...spec,
  file: `${spec.paletteId}.glb`,
  // The street doorway is local +y on every head-house and doorway panel; the
  // 虚拟 marker is a 导向柱 pillar, whose printed long faces flank a local -y nose.
  forward: spec.style === 'virtual' ? [0, -1, 0] : [0, 1, 0],
  facade: spec.style === 'virtual' ? 'local -y (guidepost nose; plates on the long faces)' : 'local +y (street doorway)',
}))

const mats = createModelMaterials()
// Empty station document: no slab, track deck, run or wall behind the piece, so
// every `placeLocal` takes its standalone offset and the default Guangzhou city
// style drives the red canopy frame, blue waved roof and printed header.
const data = { cells: [], modules: [], lines: [], name: 'Station', nameEn: 'Station' }
// The head-house floor is a 0.25 m concrete plinth. The empty document has no
// authored cell finish to inherit, so one solid concrete-coloured material
// stands in for `floor.concrete` (the stair recipe does the same with
// `stairFinish`); it is builder-owned and named by its authored colour.
const exitConcrete = new THREE.MeshStandardMaterial({ name: 'exitConcrete', color: 0xb5b0a6, roughness: 0.88, metalness: 0.03 })
const ctx = {
  mats, data, ads: {}, trackCells: new Set(),
  finish: (name) => (name === 'floor.concrete' ? exitConcrete : mats.darkSteel),
}
const paletteNames = new Map(Object.entries(mats).map(([name, material]) => [material, name]))

/**
 * Name every material slot. Palette materials take their `createModelMaterials`
 * key. Builder-owned materials are named from what they print or are: a canvas
 * plate by its pixel size (the same rule export-concourse uses for the guidepost),
 * the doorway's coloured panel by its authored colour, the floor plinth as
 * `exitConcrete`. `platePrefix` keeps the 虚拟 marker's seven 导向柱 plates
 * distinguishable from the 出入口 header plate.
 */
function nameMaterials(root, platePrefix, panelPrefix) {
  const used = new Map()
  const named = new Set()
  const alphaMaterials = new Set()
  const glassMaterials = new Set()
  const textures = new Set()
  let triangles = 0
  let meshes = 0
  root.traverse(object => {
    object.userData = {}
    assert.notEqual(object.isInstancedMesh, true, 'bake InstancedMesh instances before export')
    if (!object.isMesh) return
    meshes++
    triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      let name = used.get(material)
      if (!name) {
        name = paletteNames.get(material)
        if (!name && material.map?.image?.width) name = `${platePrefix}Plate_${material.map.image.width}x${material.map.image.height}`
        if (!name) {
          const hex = material.color?.getHexString?.() ?? 'none'
          name = material === exitConcrete ? 'exitConcrete' : `${panelPrefix}_${hex}`
        }
        // Palette slots are unique by construction; only two builder-owned plates
        // with the same pixel size need an ordinal, so the set stays stable.
        if (named.has(name) && !paletteNames.has(material)) {
          let suffix = 2
          while (named.has(`${name}_${suffix}`)) suffix++
          name = `${name}_${suffix}`
        }
        used.set(material, name)
        named.add(name)
        material.name = name
      }
      if (material.transparent) alphaMaterials.add(name)
      if (/glass/i.test(name)) glassMaterials.add(name)
      if (material.map) textures.add(material.map)
    }
  })
  return {
    names: [...used.values()].sort(),
    alphaMaterials: [...alphaMaterials].sort(),
    glassMaterials: [...glassMaterials].sort(),
    textures: textures.size,
    triangles,
    meshes,
  }
}

/**
 * Remove the head-house's baked concrete plinth (`exitConcrete` meshes, the
 * `exit-concrete-base` nodes) before export. The runtime composes the floor from the
 * saved runs' own openings instead (18 §6), so a baked pad would cover the wellway it
 * is supposed to leave open. Returns how many pad meshes were retired.
 */
function removePads(root) {
  const pads = new Set()
  root.traverse(object => {
    if (!object.isMesh) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    if (!materials.includes(exitConcrete)) return
    pads.add(object)
  })
  for (const mesh of pads) mesh.removeFromParent()
  return pads.size
}

const round = (value) => Number(value.toFixed(6))const out = resolve(process.argv[2] ?? '.preview/unity/exit-proof/export')
await mkdir(out, { recursive: true })

const assets = []
for (const spec of MODELS) {
  const mod = createModule(spec.paletteId, 0, 0, 0, `proof-${spec.paletteId}`, 0)
  assert.ok(mod, `${spec.paletteId}: createModule returned null`)
  assert.equal(mod.type, 'exit', `${spec.paletteId}: expected an exit module, got ${mod.type}`)
  assert.equal(mod.cfg.bays, spec.bays, `${spec.paletteId}: expected ${spec.bays} bays, got ${mod.cfg.bays}`)
  assert.equal(mod.cfg.covered !== false, spec.covered, `${spec.paletteId}: covered flag drifted`)
  assert.equal(mod.cfg.style, spec.style === 'doorway' ? 'doorway' : spec.style === 'virtual' ? 'virtual' : undefined,
    `${spec.paletteId}: builder style drifted`)

  const root = buildModule(mod, ctx)
  assert.ok(root, `${spec.paletteId}: buildModule returned null`)

  // 18 §6: a head-house's plan-wide concrete plinth is **not** baked into the runtime
  // asset. Unity composes that floor from the shared opening description
  // (`StationExitOpenings`, the port of `exitRunOpenings`/`exitLandingBack`), which
  // leaves the wellway the linked stair/escalator runs actually use open; a baked pad
  // covers it again, because a registered visibility target re-enables every child it
  // collected. The strips keep the source's own `floor.concrete` finish and metre UVs
  // at runtime, so the floor still reads as the web pad.
  const retiredPads = spec.style === 'head-house' ? removePads(root) : 0

  // placeLocal puts the piece on its cell centre; export from a stable local
  // origin and record the placement once.
  const placementOffset = root.position.toArray().map(round)
  root.position.set(0, 0, 0)
  root.rotation.set(0, 0, 0)
  root.updateMatrixWorld(true)

  const stats = nameMaterials(root,
    spec.style === 'virtual' ? 'guide' : 'exitHeader',
    spec.style === 'doorway' ? 'doorwayPanel' : 'exitPanel')
  root.updateMatrixWorld(true)
  // A head-house runtime asset is **pad-free**: no concrete plinth mesh, no
  // `exitConcrete` material left to re-enable, and its canopy/frame/glass/railing
  // pieces all still present.
  if (spec.style === 'head-house') {
    assert.ok(retiredPads > 0, `${spec.paletteId}: the source built no concrete plinth to retire`)
    let padNodes = 0
    root.traverse(object => { if (object.name === 'exit-concrete-base') padNodes++ })
    assert.equal(padNodes, 0, `${spec.paletteId}: a pad node survived the pad-free export`)
    assert.equal(stats.names.includes('exitConcrete'), false,
      `${spec.paletteId}: the retired plinth left its concrete material in the asset`)
  }
  const bounds = new THREE.Box3().setFromObject(root)
  assert.equal(bounds.isEmpty(), false, `${spec.paletteId}: empty bounds`)
  const size = bounds.getSize(new THREE.Vector3())
  assert.ok(stats.triangles > 0 && stats.meshes > 0, `${spec.paletteId}: exported no geometry`)

  // Basis anchors, shared with bench/bin/cctv/glass/shelf/stair. `Front` is the
  // gameplay forward (+y source), `Approach` the side a passenger arrives from:
  // the street doorway for a head-house or doorway panel, the 导向柱 nose for the
  // 虚拟 marker. `AxisX` and `Up` complete the frame.
  const anchors = {
    AxisX: [1, 0, 0],
    Front: [0, 1, 0],
    Up: [0, 0, 1],
    Approach: spec.forward,
  }

  const width = spec.style === 'virtual' ? 1 : exitWidth(spec.bays)
  const parameters = {
    variant: spec.variant,
    style: spec.style,
    covered: spec.covered,
    bays: spec.bays,
    widthMetres: width,
    cityStyle: DEFAULT_CITY_STYLE,
    marker: spec.style === 'virtual',
    enclosedLengthMetres: spec.style === 'head-house' ? EXIT_L : 0,
    canopyHeightMetres: spec.style === 'head-house' && spec.covered ? EXIT_H : 0,
    canopyReachMetres: spec.style === 'head-house' && spec.covered ? EXIT_REACH : 0,
    streetOverhangMetres: spec.style === 'head-house' && spec.covered ? EXIT_BACK : 0,
    backWallMetres: spec.style === 'head-house' && spec.covered ? EXIT_BACK_Y : 0,
    baseHeightMetres: spec.style === 'head-house' ? EXIT_BASE_HEIGHT : 0,
  }

  const gltfRoot = new THREE.Group()
  gltfRoot.name = spec.prefab
  // Source space is Z-up. The single export transform rotates it into glTF
  // Y-up, exactly as the bench, bin, cctv, glass, shelf and stair recipes do.
  gltfRoot.rotation.x = -Math.PI / 2
  gltfRoot.add(root)
  for (const [name, position] of Object.entries(anchors)) {
    const anchor = new THREE.Object3D()
    anchor.name = name
    anchor.position.fromArray(position)
    gltfRoot.add(anchor)
  }
  const bytes = new Uint8Array(await new GLTFExporter().parseAsync(gltfRoot, { binary: true }))
  const report = await validator.validateBytes(bytes, { uri: spec.file })
  const reportName = spec.file.replace(/\.glb$/, '.validation.json')
  await writeFile(join(out, reportName), JSON.stringify(report, null, 2) + '\n')
  assert.equal(
    report.issues.numErrors + report.issues.numWarnings,
    0,
    `${spec.file}: ${report.issues.numErrors} errors, ${report.issues.numWarnings} warnings. See ${reportName}`,
  )

  const marker = spec.style === 'virtual'
  const manifest = {
    schemaVersion: 1,
    id: spec.id,
    catalogueId: spec.paletteId,
    paletteId: spec.paletteId,
    family: 'exit',
    variant: spec.variant,
    style: spec.style,
    prefab: spec.prefab,
    file: spec.file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: spec.source,
    provenance: marker
      ? 'Repository procedural 虚拟 exit marker (导向柱 guidepost geometry, palette and seven canvas plates)'
      : 'Repository procedural 出入口 / exit doorway geometry, palette, canopy glass and printed header canvas',
    licenseRecord: 'Repository-authored procedural geometry and canvas signage; no third-party assets',
    units: 'metres',
    placementOffset,
    min: bounds.min.toArray().map(round),
    max: bounds.max.toArray().map(round),
    size: size.toArray().map(round),
    anchors,
    facade: spec.facade,
    forward: spec.forward,
    forwardDirection: marker ? 'local -y (printed faces on the long sides)' : 'local +y (street doorway)',
    triangles: stats.triangles,
    meshes: stats.meshes,
    materials: stats.names,
    alphaMaterials: stats.alphaMaterials,
    glassMaterials: stats.glassMaterials,
    textures: stats.textures,
    marker,
    // 18 §6: a head-house ships without its baked plinth; the runtime composes the
    // floor from the linked runs' openings (`StationExitOpenings`).
    padFree: spec.style === 'head-house',
    retiredPadMeshes: retiredPads,
    parameters,
    validation: { errors: report.issues.numErrors, warnings: report.issues.numWarnings },
  }
  await writeFile(join(out, spec.file), bytes)
  await writeFile(join(out, spec.file.replace(/\.glb$/, '.manifest.json')), JSON.stringify(manifest, null, 2) + '\n')
  assets.push(manifest)
  console.log(
    `${spec.id}: ${stats.triangles} triangles, ${stats.meshes} meshes, ${stats.names.length} materials ` +
      `(${stats.alphaMaterials.length} alpha, ${stats.textures} textures), ` +
      `${size.x.toFixed(3)} x ${size.y.toFixed(3)} x ${size.z.toFixed(3)} m, ${bytes.length} bytes, ${manifest.sha256}`,
  )
}

// The family's fixed shape: seven head-houses, four doorway headers, one marker.
assert.equal(assets.length, 11, 'expected eleven exit models')
assert.equal(assets.filter(asset => asset.style === 'head-house').length, 6, 'expected six head-houses (three covered, three open)')
assert.equal(assets.filter(asset => asset.style === 'doorway').length, 4, 'expected four doorway headers')
assert.equal(assets.find(asset => asset.paletteId === 'exit-virtual').textures, 7, 'the 虚拟 marker must carry its seven canvas plates')
// The street head-houses reach 8.1 m in source y (5.6 m of canopy over the run
// plus the street overhang); the doorway headers are wide and thin.
for (const asset of assets.filter(entry => entry.style === 'head-house')) {
  assert.ok(asset.size[1] > 7.5 && asset.size[1] < 8.5, `${asset.paletteId}: unexpected run depth ${asset.size[1]}`)
}
for (const asset of assets.filter(entry => entry.style === 'doorway')) {
  assert.ok(asset.size[1] < 0.2 && asset.size[2] > 0.6 && asset.size[2] < 1.0,
    `${asset.paletteId}: unexpected doorway header ${asset.size.join(' x ')}`)
}

const summary = {
  schemaVersion: 1,
  family: 'exit',
  sourcePaths: [
    'game/src/render/models/pieces/ExitModel.ts',
    'game/src/render/models/pieces/DoorwayExitModel.ts',
    'game/src/render/models/pieces/ExitLanding.ts',
    'game/src/render/models/pieces/StreetDecorModel.ts',
    'game/src/render/models/pieces/GuidepostGeometry.ts',
    'game/src/render/models/PieceBuilder.ts',
    'game/src/build/model/Equipment.ts',
    'game/src/sim/exits.ts',
    'game/src/sim/cityStyles.ts',
    'game/src/sim/exitLanding.ts',
  ],
  parameters: {
    models: MODELS.length,
    family: 'exit',
    rot: 0,
    cityStyle: DEFAULT_CITY_STYLE,
    cityStyleSource: 'empty station document -> cityStyleFor(undefined) = DEFAULT_CITY_STYLE guangzhou: the red steel canopy frame, blue waved roof, glass sides and the default 出入口 header',
    stationData: 'empty station document: { cells: [], modules: [], lines: [], name: "Station", nameEn: "Station" } — no runs, no slab, no wall block behind a doorway panel',
    placement: 'ExitModel/DoorwayExitModel: placeLocal offsets [0.5, 0.5, 1] (a doorway panel then nudges z by its mountZ); createModule places every variant at the cell origin',
    exitWidths: 'exitWidth(bays) = bays + 2 blocks: 3 / 4 / 5 m for the 单向 / 双向 / 三向 head-house; doorway panels span the same width; the 虚拟 marker is 1 x 1',
    enclosedLengthMetres: EXIT_L,
    canopyHeightMetres: EXIT_H,
    canopyReachMetres: EXIT_REACH,
    streetOverhangMetres: EXIT_BACK,
    backWallMetres: EXIT_BACK_Y,
    baseHeightMetres: EXIT_BASE_HEIGHT,
    virtualMarker: 'exit-virtual is a visual marker and placement preview, not a full exit: a 1 x 1 导向柱 pillar drawn by GuidepostModel through the exit palette id. It has no head-house plan, floor pad, run opening or street doorway; it records marker=true and its seven canvas plates.',
    exitSpecs: assets.map(asset => ({
      paletteId: asset.paletteId,
      variant: asset.parameters.variant,
      style: asset.parameters.style,
      covered: asset.parameters.covered,
      bays: asset.parameters.bays,
      widthMetres: asset.parameters.widthMetres,
      depthMetres: asset.size[1],
    })),
    palette: 'createModelMaterials(): steel (64 px brushed canvas map), darkSteel, glass (transparent 0.26, double sided), exitRed, blue, glow; the 出入口 header canvas plate and the doorway entrance-colour panel are named by pixel size / authored colour. The head-house concrete plinth is **not** exported (padFree): the runtime lays the floor from the saved runs\' own openings with the `floor.concrete` station finish and metre UVs',
    textures: 'brushed steel 64 px canvas (steel), the 出入口 header canvas (512 x 96 for the head-houses and the 3 m doorway, wider for the 4-6 m headers) and, for the 虚拟 marker, its seven 导向柱 plates; the steel grain uses a fixed-seed generator and every canvas encode is serialised, so two exports are byte-identical',
    basis: 'source Z-up tree wrapped in a group rotated -90 degrees about X (glTF Y-up); Unity wrapper applies the 180-degree Y correction so gameplay channels read (x, z, y)',
  },
  assets,
  validation: {
    errors: assets.reduce((sum, asset) => sum + asset.validation.errors, 0),
    warnings: assets.reduce((sum, asset) => sum + asset.validation.warnings, 0),
  },
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(`EXIT_EXPORT_OK ${assets.length} models, ${summary.validation.errors} errors, ${summary.validation.warnings} warnings -> ${out}`)
