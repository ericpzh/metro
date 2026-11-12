// Export the civic family: the eight city-specific covered 出入口 head-houses —
// Guangzhou's default red-framed portal (drawn inline in ExitModel.ts) and the
// seven authored city canopies (Shenzhen, Shanghai, Beijing, Chengdu, Chongqing,
// Wuhan, Nanjing) — each with its own printed header fascia.
//
// Every asset is the game's own `buildModule` output for one exit module placed
// at a stable local origin, standing in an empty station document whose
// `cityStyle` is the asset's city. The canopy builder and the header artwork are
// both selected from that one field:
//
//   ExitModel.buildExit -> buildShenzhenCanopy / buildShanghaiCanopy / ... /
//                          buildNanjingCanopy (or the inline Guangzhou frame)
//   ExitModel.exitHeaderCanvas -> draw<City>Header, sized by exitHeaderResolution
//
// Nothing is hand-built here: the exporter only names materials, measures the
// result and records the city, the print size and the printed header's own
// dominant colour, which is what proves the city fascia was actually painted.
//
// The same prefab is the evidence for both of a city's checklist rows
// (city-<city>-exit-canopy and city-<city>-exit-header): the header canvas is
// part of the exit asset, so the manifest records both row ids against one GLB.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Canvas, ImageData, createCanvas } from '@napi-rs/canvas'
import validator from 'gltf-validator'

// The family prints real canvases: the palette's 64 px brushed-stainless grain,
// the 出入口 header fascia (512 x 96 for the four base cities, 2048 x 384 for the
// four high-resolution identities) and each city's extra plate (Shenzhen's
// metro-emblem blade, Shanghai's roundel, Nanjing's emblem/wordmark/portal
// label). Use the same `@napi-rs/canvas` adapter as export-exit: Three's
// GLTFExporter treats any image with a `data` property as a DataTexture and
// would write transparent black, so shadow it.
//
// GLTFExporter appends each image's bufferView only when its asynchronous encode
// settles, so several textures in one asset would race each other and produce
// different GLB bytes between two runs. Serialize the encode and the FileReader
// read: completion order then follows the deterministic material order, and the
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
const { cityStyleFor, lineColourFor } = await import('../../game/src/sim/cityStyles.ts')
const { exitHeaderResolution } = await import('../../game/src/render/exitHeaderResolution.ts')
const { EXIT_BACK, EXIT_BACK_Y, EXIT_H, EXIT_L, EXIT_REACH, exitWidth } = await import('../../game/src/sim/exits.ts')
const { EXIT_BASE_HEIGHT } = await import('../../game/src/sim/exitLanding.ts')

/**
 * The eight city canopies, in checklist row order. `headerNode` is the builder's
 * own name for the printed plate where it names one; `canopyNode` is the city
 * builder's roof (none for Guangzhou, whose roof is the shared `exit-canopy-segment`
 * strip). Guangzhou prints its header on the 512 px default; Shenzhen, Shanghai
 * and Beijing keep exitHeaderScale 1; Chengdu, Chongqing, Wuhan and Nanjing print
 * at the authored 4x resolution (2048 x 384).
 */
const CITIES = [
  { city: 'guangzhou', prefab: 'CityExitGuangzhou', canopy: 'exit-canopy-segment', headerNode: null },
  { city: 'shenzhen', prefab: 'CityExitShenzhen', canopy: 'shenzhen-curved-canopy', headerNode: null },
  { city: 'shanghai', prefab: 'CityExitShanghai', canopy: 'shanghai-flat-canopy', headerNode: null },
  { city: 'beijing', prefab: 'CityExitBeijing', canopy: 'beijing-stainless-canopy', headerNode: 'beijing-entrance-sign' },
  { city: 'chengdu', prefab: 'CityExitChengdu', canopy: 'chengdu-silver-curved-roof', headerNode: 'chengdu-entrance-sign' },
  { city: 'chongqing', prefab: 'CityExitChongqing', canopy: 'chongqing-silver-roof', headerNode: 'chongqing-entrance-sign' },
  { city: 'wuhan', prefab: 'CityExitWuhan', canopy: 'wuhan-flat-silver-roof', headerNode: 'wuhan-entrance-sign' },
  { city: 'nanjing', prefab: 'CityExitNanjing', canopy: 'nanjing-sloped-silver-roof', headerNode: 'nanjing-entrance-sign' },
].map(spec => ({
  ...spec,
  paletteId: `city-exit-${spec.city}`,
  file: `city-exit-${spec.city}.glb`,
  id: `city-exit-${spec.city}`,
  // moduleThumbnails' city pass names every city exit 13号口 on Shanghai and C口
  // elsewhere (moduleThumbnails.ts, the city-elevation document); the same
  // convention is recorded here so the printed plate is reproducible.
  exitName: spec.city === 'shanghai' ? '13号口' : 'C口',
  rows: [`city-${spec.city}-exit-canopy`, `city-${spec.city}-exit-header`],
}))

const mats = createModelMaterials()
const paletteNames = new Map(Object.entries(mats).map(([name, material]) => [material, name]))
// The head-house floor is a 0.25 m concrete plinth. The empty document has no
// authored cell finish to inherit, so one solid concrete-coloured material
// stands in for `floor.concrete` (the exit and stair recipes do the same).
const exitConcrete = new THREE.MeshStandardMaterial({ name: 'exitConcrete', color: 0xb5b0a6, roughness: 0.88, metalness: 0.03 })

/** An empty one-line station document for one city: no runs, no slab, no wall. */
function stationDocument(spec) {
  return {
    cells: [],
    modules: [],
    lines: [{
      id: '1',
      name: 'Line 1',
      colour: lineColourFor('1', spec.city),
      stock: 'B',
      cars: 6,
      power: 'third-rail',
      psd: 'full',
      headwayProfile: { peak: 150, offpeak: 240, late: 480 },
      alightPerTrain: 420,
      terminus: 'through',
      direction: 'up',
      upTerminus: '',
      downTerminus: '',
      travelSign: 1,
      stations: [],
    }],
    name: 'Station',
    nameEn: 'Station',
    cityStyle: spec.city,
  }
}

/**
 * Read the printed header back off its own canvas: the modal colour must be the
 * city's authored entrance colour (the fascia ground), and the text, mark and
 * line badge are the ink that differs from it. This is the export-side proof
 * that the city's header artwork — not a blank plate — went into the GLB.
 */
function inspectHeader(material, spec) {
  const image = material.map?.image
  assert.ok(image?.width && image?.height, `${spec.city}: the header plate has no canvas`)
  const g = image.getContext('2d')
  const { data } = g.getImageData(0, 0, image.width, image.height)
  const counts = new Map()
  for (let i = 0; i < data.length; i += 4) {
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let dominantKey = 0, dominantCount = -1
  for (const [key, count] of counts) if (count > dominantCount) { dominantCount = count; dominantKey = key }
  const ground = [(dominantKey >> 16) & 255, (dominantKey >> 8) & 255, dominantKey & 255]
  const entrance = cityStyleFor(spec.city).entranceColour
  const expected = [1, 3, 5].map(at => parseInt(entrance.slice(at, at + 2), 16))
  const groundHex = `#${dominantKey.toString(16).padStart(6, '0')}`
  for (let channel = 0; channel < 3; channel++) {
    assert.ok(Math.abs(ground[channel] - expected[channel]) <= 8,
      `${spec.city}: header ground ${groundHex} is not the ${entrance} entrance colour`)
  }
  // Ink: everything printed over the fascia ground — station name, exit label,
  // the metro mark, the line badge. A blank plate has none of it.
  let inkPixels = 0
  const quantised = new Set()
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g2 = data[i + 1], b = data[i + 2]
    quantised.add(((r >> 4) << 8) | ((g2 >> 4) << 4) | (b >> 4))
    if (Math.abs(r - ground[0]) + Math.abs(g2 - ground[1]) + Math.abs(b - ground[2]) > 60) inkPixels++
  }
  assert.ok(inkPixels > 100, `${spec.city}: the header fascia is nearly blank (${inkPixels} ink pixels)`)
  assert.ok(quantised.size >= 6, `${spec.city}: the header fascia has only ${quantised.size} colours`)
  return {
    material: material.name,
    width: image.width,
    height: image.height,
    city: spec.city,
    exitName: spec.exitName,
    groundHex,
    ground,
    inkPixels,
    distinctColours: quantised.size,
  }
}

/**
 * Name every material slot. Palette materials take their `createModelMaterials`
 * key. Builder-owned materials are named from what they are: the printed header
 * fascia by its pixel size (`cityExitHeader_<w>x<h>`), any other city plate by
 * its pixel size (`cityExitPlate_<w>x<h>`, e.g. Shenzhen's 128 x 128 metro blade,
 * Shanghai's 256 x 256 roundel, Nanjing's 512 x 512 emblem / 192 x 768 wordmark /
 * 384 x 960 portal label), and the floor plinth as `exitConcrete`. The remaining
 * builder-owned materials are the cities' authored frame/stone tones, named by
 * their authored colour (`cityExit_<hex>`); an ordinal keeps two same-coloured
 * slots apart.
 */
function nameMaterials(root, headerMaterial) {
  const used = new Map()
  const named = new Set()
  const alphaMaterials = new Set()
  const glassMaterials = new Set()
  const textures = new Map()
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
        if (!name && material === headerMaterial) name = `cityExitHeader_${material.map.image.width}x${material.map.image.height}`
        if (!name && material.map?.image?.width) name = `cityExitPlate_${material.map.image.width}x${material.map.image.height}`
        if (!name) {
          const hex = material.color?.getHexString?.() ?? 'none'
          name = material === exitConcrete ? 'exitConcrete' : `cityExit_${hex}`
        }
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
      if (material.map) textures.set(name, { name, width: material.map.image.width, height: material.map.image.height })
    }
  })
  return {
    names: [...used.values()].sort(),
    alphaMaterials: [...alphaMaterials].sort(),
    glassMaterials: [...glassMaterials].sort(),
    textures: [...textures.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    triangles,
    meshes,
  }
}

const round = (value) => Number(value.toFixed(6))
const out = resolve(process.argv[2] ?? '.preview/unity/civic-proof/export')
await mkdir(out, { recursive: true })

const assets = []
for (const spec of CITIES) {
  const data = stationDocument(spec)
  const ctx = {
    mats, data, ads: {}, trackCells: new Set(),
    finish: (name) => (name === 'floor.concrete' ? exitConcrete : mats.darkSteel),
  }

  const mod = createModule('exit', 0, 0, 0, `proof-${spec.city}`, 0)
  assert.ok(mod, `${spec.city}: createModule returned null`)
  assert.equal(mod.type, 'exit', `${spec.city}: expected an exit module, got ${mod.type}`)
  assert.equal(mod.cfg.covered, true, `${spec.city}: the city head-house must be covered`)
  assert.equal(mod.cfg.bays, 2, `${spec.city}: expected the reference two-bay head-house`)
  mod.cfg.name = spec.exitName

  const root = buildModule(mod, ctx)
  assert.ok(root, `${spec.city}: buildModule returned null`)
  assert.equal(root.userData.exitCityStyle, spec.city,
    `${spec.city}: the builder did not take the city style (${root.userData.exitCityStyle})`)

  // placeLocal puts the piece on its cell centre; export from a stable local
  // origin and record the placement once.
  const placementOffset = root.position.toArray().map(round)
  root.position.set(0, 0, 0)
  root.rotation.set(0, 0, 0)
  root.updateMatrixWorld(true)

  // The printed fascia is the one builder-owned plate at the header resolution
  // for this city; find it before naming so it can be named by role.
  const pixels = exitHeaderResolution(512, spec.city)
  const headerMaterials = new Set()
  root.traverse(object => {
    if (!object.isMesh) return
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      const image = material.map?.image
      if (image?.width === pixels.width && image?.height === pixels.height) headerMaterials.add(material)
    }
  })
  assert.equal(headerMaterials.size, 1,
    `${spec.city}: expected one ${pixels.width}x${pixels.height} header plate, found ${headerMaterials.size}`)
  const headerMaterial = [...headerMaterials][0]

  const stats = nameMaterials(root, headerMaterial)
  root.updateMatrixWorld(true)
  const header = inspectHeader(headerMaterial, spec)
  const bounds = new THREE.Box3().setFromObject(root)
  assert.equal(bounds.isEmpty(), false, `${spec.city}: empty bounds`)
  const size = bounds.getSize(new THREE.Vector3())

  assert.ok(stats.triangles > 0 && stats.meshes > 0, `${spec.city}: exported no geometry`)
  assert.ok(stats.names.includes('glass'), `${spec.city}: the head-house glass is missing`)
  assert.ok(stats.alphaMaterials.includes('glass') && stats.glassMaterials.includes('glass'),
    `${spec.city}: glass is not recorded as transparent glass`)
  assert.ok(stats.textures.some(texture => texture.name === header.material),
    `${spec.city}: the header plate is not in the texture list`)

  // A city head-house occupies the shared 4 m (two-bay) footprint: ~8.1 m deep
  // through the run (5.6 m canopy reach plus the 2.3 m street overhang), 4.0 m
  // wide plus the frame, and 3.2 m to the canopy on a 0.25 m plinth, with each
  // city's own roof profile and trim above that.
  assert.ok(size.y > 7.9 && size.y < 8.8, `${spec.city}: unexpected run depth ${size.y}`)
  assert.ok(size.x > 3.9 && size.x < 4.6, `${spec.city}: unexpected width ${size.x}`)
  assert.ok(size.z > 3.4 && size.z < 5.2, `${spec.city}: unexpected height ${size.z}`)
  // Bounds are off-centre through the run (the canopy reaches 5.6 m to −y and
  // only 2.3 m past the doorway), so the manifest records min/max, not just size.
  assert.ok(bounds.min.y < -4.9 && bounds.max.y > 1.9,
    `${spec.city}: the run does not extend past both canopy ends (${bounds.min.y}..${bounds.max.y})`)

  // Basis anchors, shared with bench/bin/cctv/exit. `Front` is the gameplay
  // forward (+y source), `Approach` the street side a passenger arrives from.
  const anchors = {
    AxisX: [1, 0, 0],
    Front: [0, 1, 0],
    Up: [0, 0, 1],
    Approach: [0, 1, 0],
  }

  const parameters = {
    variant: spec.city,
    style: 'head-house',
    covered: true,
    bays: mod.cfg.bays,
    widthMetres: exitWidth(mod.cfg.bays),
    cityStyle: spec.city,
    exitName: spec.exitName,
    enclosedLengthMetres: EXIT_L,
    canopyHeightMetres: EXIT_H,
    canopyReachMetres: EXIT_REACH,
    streetOverhangMetres: EXIT_BACK,
    backWallMetres: EXIT_BACK_Y,
    baseHeightMetres: EXIT_BASE_HEIGHT,
    canopyNode: spec.canopy,
    headerNode: spec.headerNode,
  }

  const gltfRoot = new THREE.Group()
  gltfRoot.name = spec.prefab
  // Source space is Z-up. The single export transform rotates it into glTF
  // Y-up, exactly as the other recipes do.
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

  const manifest = {
    schemaVersion: 1,
    id: spec.id,
    paletteId: spec.paletteId,
    family: 'civic',
    city: spec.city,
    cityStyle: spec.city,
    rows: spec.rows,
    prefab: spec.prefab,
    file: spec.file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: 'game/src/render/models/pieces/ExitModel.ts',
    provenance: `Repository procedural ${spec.city} 出入口 head-house: the city canopy builder, palette, glass, concrete plinth and the city's printed header fascia (ExitModel.exitHeaderCanvas -> draw${spec.city[0].toUpperCase()}${spec.city.slice(1)}Header)`,
    licenseRecord: 'Repository-authored procedural geometry and canvas signage; no third-party assets',
    units: 'metres',
    placementOffset,
    min: bounds.min.toArray().map(round),
    max: bounds.max.toArray().map(round),
    size: size.toArray().map(round),
    anchors,
    facade: 'local +y (street doorway)',
    forward: [0, 1, 0],
    forwardDirection: 'local +y (street doorway, printed header)',
    exitName: spec.exitName,
    exitNameConvention: spec.city === 'shanghai'
      ? 'moduleThumbnails city pass: numbered 号口'
      : 'moduleThumbnails city pass: lettered 口',
    header,
    // The header row's evidence is this same prefab: the printed fascia is part
    // of the exit asset, not a separate plate.
    headerEvidence: { prefab: spec.prefab, file: spec.file, texture: header.material, width: header.width, height: header.height },
    triangles: stats.triangles,
    meshes: stats.meshes,
    materials: stats.names,
    alphaMaterials: stats.alphaMaterials,
    glassMaterials: stats.glassMaterials,
    textures: stats.textures.length,
    textureList: stats.textures,
    parameters,
    validation: { errors: report.issues.numErrors, warnings: report.issues.numWarnings },
  }
  await writeFile(join(out, spec.file), bytes)
  await writeFile(join(out, spec.file.replace(/\.glb$/, '.manifest.json')), JSON.stringify(manifest, null, 2) + '\n')
  assets.push(manifest)
  console.log(
    `${spec.id}: ${stats.triangles} triangles, ${stats.meshes} meshes, ${stats.names.length} materials ` +
      `(${stats.alphaMaterials.length} alpha, ${stats.textures.length} textures), header ${header.material} ` +
      `${header.width}x${header.height} ground ${header.groundHex}, ` +
      `${size.x.toFixed(3)} x ${size.y.toFixed(3)} x ${size.z.toFixed(3)} m, ${bytes.length} bytes, ${manifest.sha256}`,
  )
}

// The family's fixed shape: one covered head-house per city, in checklist order.
assert.equal(assets.length, 8, 'expected eight city canopies')
assert.deepEqual(assets.map(asset => asset.city), ['guangzhou', 'shenzhen', 'shanghai', 'beijing', 'chengdu', 'chongqing', 'wuhan', 'nanjing'],
  'the city order drifted from the checklist rows')
assert.equal(new Set(assets.map(asset => asset.sha256)).size, 8, 'two cities exported identical GLBs')
// The printed fascia is the row's other evidence: each city must carry its own
// authored entrance colour, and the eight must read as several distinct hues.
const grounds = new Map(assets.map(asset => [asset.header.groundHex, asset.city]))
assert.ok(grounds.size >= 5, `only ${grounds.size} distinct header grounds across eight cities`)
assert.equal(assets.filter(asset => asset.header.width === 512).length, 4, 'expected four 512 px headers')
assert.equal(assets.filter(asset => asset.header.width === 2048).length, 4, 'expected four 2048 px headers')
// Guangzhou alone keeps the palette's red frame and blue waved roof; every city
// keeps the glass.
const guangzhou = assets[0]
assert.ok(guangzhou.materials.includes('exitRed') && guangzhou.materials.includes('blue'),
  'the Guangzhou default canopy lost its red frame or blue roof')
for (const asset of assets.slice(1)) {
  assert.ok(!asset.materials.includes('exitRed') && !asset.materials.includes('blue'),
    `${asset.city}: a city canopy must not reuse the Guangzhou red frame / blue roof`)
}
assert.ok(assets.every(asset => asset.textures >= 1 && asset.materials.includes('glass')))

const summary = {
  schemaVersion: 1,
  family: 'civic',
  sourcePaths: [
    'game/src/render/models/pieces/ExitModel.ts',
    'game/src/render/models/pieces/ShenzhenExitCanopy.ts',
    'game/src/render/models/pieces/ShanghaiExitCanopy.ts',
    'game/src/render/models/pieces/BeijingExitCanopy.ts',
    'game/src/render/models/pieces/ChengduExitCanopy.ts',
    'game/src/render/models/pieces/ChongqingExitCanopy.ts',
    'game/src/render/models/pieces/WuhanExitCanopy.ts',
    'game/src/render/models/pieces/NanjingExitCanopy.ts',
    'game/src/render/models/pieces/NanjingRoofSign.ts',
    'game/src/render/models/pieces/ShenzhenExitHeader.ts',
    'game/src/render/models/pieces/ShanghaiExitHeader.ts',
    'game/src/render/models/pieces/BeijingExitHeader.ts',
    'game/src/render/models/pieces/ChengduExitHeader.ts',
    'game/src/render/models/pieces/ChongqingExitHeader.ts',
    'game/src/render/models/pieces/WuhanExitHeader.ts',
    'game/src/render/models/pieces/NanjingExitHeader.ts',
    'game/src/render/models/PieceBuilder.ts',
    'game/src/build/model/Equipment.ts',
    'game/src/sim/exits.ts',
    'game/src/sim/cityStyles.ts',
    'game/src/render/exitHeaderResolution.ts',
  ],
  parameters: {
    models: CITIES.length,
    family: 'civic',
    rot: 0,
    cities: CITIES.map(spec => spec.city),
    cityStyleSource: 'one empty station document per asset with cityStyle set to the asset city, so cityStyleFor(city) selects both the canopy builder (ExitModel.buildExit) and the printed header (ExitModel.exitHeaderCanvas)',
    stationData: 'empty station document: { cells: [], modules: [], lines: [one line], name: "Station", nameEn: "Station" } — no runs, no slab, no wall behind the head-house',
    lineColour: "one line id '1' coloured by lineColourFor('1', city), which the printed fascia shows as its line badge (Chongqing's separator bars, Nanjing's tile)",
    exitNames: CITIES.map(spec => ({ city: spec.city, exitName: spec.exitName, convention: spec.city === 'shanghai' ? 'numbered 号口' : 'lettered 口' })),
    exitNameSource: 'game/src/app/moduleThumbnails.ts city elevation pass: 13号口 on Shanghai, C口 on every other city',
    placement: 'ExitModel: placeLocal offsets [0.5, 0.5, 1]; createModule places every city head-house at the cell origin with the reference two bays and covered=true',
    exitWidths: 'exitWidth(2) = 4 m: the reference 双向 head-house, which every city canopy wraps',
    enclosedLengthMetres: EXIT_L,
    canopyHeightMetres: EXIT_H,
    canopyReachMetres: EXIT_REACH,
    streetOverhangMetres: EXIT_BACK,
    backWallMetres: EXIT_BACK_Y,
    baseHeightMetres: EXIT_BASE_HEIGHT,
    headerPolicy: 'one prefab serves both of a city\'s checklist rows: the printed header fascia is part of the exit asset (ExitModel.exitHeaderCanvas), and the manifest records its texture name, pixel size and city under `header`',
    headerResolution: 'exitHeaderResolution(512, city): 512 x 96 for Guangzhou / Shenzhen / Shanghai / Beijing, 2048 x 384 for Chengdu / Chongqing / Wuhan / Nanjing (exitHeaderScale 4)',
    headerColours: assets.map(asset => ({ city: asset.city, ground: asset.header.groundHex, entranceColour: cityStyleFor(asset.city).entranceColour, inkPixels: asset.header.inkPixels, distinctColours: asset.header.distinctColours })),
    palette: 'createModelMaterials(): steel (64 px brushed canvas map), darkSteel, glass (transparent 0.26, double sided), exitRed and blue (Guangzhou only), white, glow; each city builder owns its frame/stone tones (named cityExit_<hex> after the authored colour) and its extra printed plates (cityExitPlate_<w>x<h>)',
    textures: 'the brushed-steel 64 px canvas, the city header fascia (512 x 96 or 2048 x 384), and Shenzhen\'s 128 x 128 metro blade / Shanghai\'s 256 x 256 roundel / Nanjing\'s 512 x 512 emblem, 192 x 768 wordmark and 384 x 960 portal label; the steel grain uses a fixed-seed generator and every canvas encode is serialised, so two exports are byte-identical',
    boundsNote: 'the head-house bounds are off-centre: the canopy reaches 5.6 m along -y (over the run) and 2.3 m past the street doorway (+y), so min/max are recorded per asset',
    basis: 'source Z-up tree wrapped in a group rotated -90 degrees about X (glTF Y-up); Unity wrapper applies the 180-degree Y correction so gameplay channels read (x, z, y)',
    citySpecs: assets.map(asset => ({
      city: asset.city,
      paletteId: asset.paletteId,
      prefab: asset.prefab,
      exitName: asset.exitName,
      headerWidth: asset.header.width,
      headerHeight: asset.header.height,
      headerGround: asset.header.groundHex,
      canopyNode: asset.parameters.canopyNode,
      headerNode: asset.parameters.headerNode,
      sizeMetres: asset.size,
      depthMetres: asset.size[1],
      triangles: asset.triangles,
      textures: asset.textures,
      materials: asset.materials.length,
    })),
  },
  assets,
  validation: {
    errors: assets.reduce((sum, asset) => sum + asset.validation.errors, 0),
    warnings: assets.reduce((sum, asset) => sum + asset.validation.warnings, 0),
  },
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(`CIVIC_EXPORT_OK ${assets.length} cities, ${summary.validation.errors} errors, ${summary.validation.warnings} warnings -> ${out}`)
