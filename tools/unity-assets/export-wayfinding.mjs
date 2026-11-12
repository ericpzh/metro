// Export the wayfinding family: the eight city 导向柱 guideposts and the eight
// city 地面 doorway entrance panels.
//
// Every asset is the game's own `buildModule` output for one placed module at a
// stable local origin. `ctx.data.cityStyle` selects the city, which swaps both the
// builder (GuidepostModel dispatches on the city logo; DoorwayExitModel reads the
// city entrance colour and header canvas) and the artwork the builder prints, so
// these are the same pieces a player gets by switching the station's city.
//
// The 导向柱 carries several canvas plates (the Guangzhou default carries seven);
// the doorway is the wall-fixed header/entrance panel, not a head-house: 3 m wide,
// 0.07 m deep and 0.78 m tall, with the city's printed header on its street face.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Canvas, ImageData, createCanvas } from '@napi-rs/canvas'
import validator from 'gltf-validator'

// The family prints real canvases (the guideposts' plates and the doorway header).
// Use the same `@napi-rs/canvas` adapter as export-exit: Three's GLTFExporter
// treats any image with a `data` property as a DataTexture and would write
// transparent black, so shadow it.
//
// GLTFExporter appends each image's bufferView only when its asynchronous encode
// settles, so a guidepost with seven plates would race itself and produce
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

// The palette's brushed-steel grain is drawn with `Math.random`; pin the stream
// before PieceBuilder is imported so every run embeds the same PNG.
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
const { CITY_STYLE_IDS, cityStyleFor, lineColourFor } = await import('../../game/src/sim/cityStyles.ts')

/**
 * The city family, in review-row order: the eight 导向柱 guideposts and the eight
 * 3 m doorway entrance panels. A station name and its English gloss give the
 * plates and the header real content; the line supplies the badge colour the
 * city's header and live-label plates print.
 */
const CITIES = [
  { city: 'guangzhou', station: '体育西路', stationEn: 'Tiyu Xilu', guidePlates: 7 },
  { city: 'shenzhen', station: '福田', stationEn: 'Futian', guidePlates: 3 },
  { city: 'shanghai', station: '人民广场', stationEn: "People's Square", guidePlates: 1 },
  { city: 'beijing', station: '西直门', stationEn: 'Xizhimen', guidePlates: 2 },
  { city: 'chengdu', station: '天府广场', stationEn: 'Tianfu Square', guidePlates: 3 },
  { city: 'chongqing', station: '较场口', stationEn: 'Jiaochangkou', guidePlates: 1 },
  { city: 'wuhan', station: '洪山广场', stationEn: 'Hongshan Square', guidePlates: 2 },
  { city: 'nanjing', station: '新街口', stationEn: 'Xinjiekou', guidePlates: 1 },
]
// `CITY_STYLE_IDS` is the document's own order; the family must cover it exactly.
assert.deepEqual(CITIES.map(entry => entry.city), CITY_STYLE_IDS, 'the family must cover every city style')

/**
 * The doorway header style each city draws (`exitHeaderCanvas`) and the game's
 * exit-name convention. Shanghai numbers its exits (`13号口`, `nextExitName`);
 * the other cities letter them (`C口`). The review uses fixed sample labels so
 * the same asset is comparable run to run.
 */
const HEADER = {
  guangzhou: { style: 'default' },
  shenzhen: { style: 'shenzhen' },
  shanghai: { style: 'shanghai' },
  beijing: { style: 'beijing' },
  chengdu: { style: 'chengdu' },
  chongqing: { style: 'chongqing' },
  wuhan: { style: 'wuhan' },
  nanjing: { style: 'nanjing' },
}
/** How many line badges each header draws at most (guangzhou's has none). */
const HEADER_BADGES = { guangzhou: 0, shenzhen: 3, shanghai: 1, beijing: 3, chengdu: 2, chongqing: 3, wuhan: 3, nanjing: 3 }
const EXIT_NAME = city => (city === 'shanghai' ? '13号口' : 'C口')
/** True when the header prints the exit identifier (Beijing's fascia has no exit field). */
const HEADER_DRAWS_EXIT = { beijing: false }
const DOORWAY_WIDTH = 3
const DOORWAY_PIXELS = (city) => {
  const logicalWidth = Math.round(512 * (DOORWAY_WIDTH - 0.12) / 2.88)
  const scale = ['chengdu', 'chongqing', 'wuhan', 'nanjing'].includes(city) ? 4 : 1
  const width = Math.min(4096, Math.round(logicalWidth * scale))
  return { logicalWidth, width, height: Math.round(width * 96 / logicalWidth) }
}

const MODELS = CITIES.flatMap(entry => ([
  {
    kind: 'guidepost',
    paletteId: 'guidepost',
    city: entry.city,
    prefab: `CityGuidepost${entry.city[0].toUpperCase()}${entry.city.slice(1)}`,
    file: `city-guidepost-${entry.city}.glb`,
    id: `city-${entry.city}-guidepost`,
    station: entry.station,
    stationEn: entry.stationEn,
    guidePlates: entry.guidePlates,
    source: entry.city === 'guangzhou'
      ? 'game/src/render/models/pieces/StreetDecorModel.ts'
      : `game/src/render/models/pieces/${entry.city[0].toUpperCase()}${entry.city.slice(1)}Guidepost.ts`,
  },
  {
    kind: 'doorway',
    paletteId: 'exit-doorway-1',
    city: entry.city,
    prefab: `CityDoorway${entry.city[0].toUpperCase()}${entry.city.slice(1)}`,
    file: `city-doorway-${entry.city}.glb`,
    id: `city-${entry.city}-doorway-entrance`,
    station: entry.station,
    stationEn: entry.stationEn,
    source: 'game/src/render/models/pieces/DoorwayExitModel.ts',
  },
]))

const mats = createModelMaterials()
const ctx = {
  mats,
  // Assigned per asset below: StationData with the city style, the sample name,
  // one live line and the exit module the guidepost's labels read.
  data: null,
  ads: {},
  trackCells: new Set(),
  finish: () => mats.darkSteel,
  owned: [],
}
const paletteNames = new Map(Object.entries(mats).map(([name, material]) => [material, name]))

/**
 * Name every material slot. Palette materials take their `createModelMaterials`
 * key; builder-owned materials are named from what they print or are: a canvas
 * plate by its pixel size (the rule export-concourse/export-exit use) and a solid
 * part by its authored colour, so the same builder always yields the same names.
 */
function nameMaterials(root, platePrefix, partPrefix) {
  const used = new Map()
  const named = new Set()
  const alphaMaterials = new Set()
  const glassMaterials = new Set()
  const textures = new Set()
  const plates = new Set()
  const palette = []
  let triangles = 0
  let meshes = 0
  let plateMeshes = 0
  root.traverse(object => {
    // Renderer-only metadata (artwork bindings, low-detail LOD geometry) is not
    // part of the asset: drop it before the exporter walks the tree.
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
          name = `${partPrefix}_${hex}`
        }
        // Palette slots are unique by construction; builder-owned plates and parts
        // with the same pixels/size/colour take an ordinal, so the set is stable.
        if (named.has(name) && !paletteNames.has(material)) {
          let suffix = 2
          while (named.has(`${name}_${suffix}`)) suffix++
          name = `${name}_${suffix}`
        }
        used.set(material, name)
        named.add(name)
        material.name = name
        palette.push({
          name,
          colour: material.color ? `#${material.color.getHexString()}` : null,
          transparent: material.transparent === true,
          map: material.map?.image ? `${material.map.image.width}x${material.map.image.height}` : null,
        })
      }
      if (material.transparent) alphaMaterials.add(name)
      if (/glass/i.test(name)) glassMaterials.add(name)
      if (material.map) {
        textures.add(material.map)
        plates.add(name)
        plateMeshes++
      }
    }
  })
  return {
    names: [...used.values()].sort(),
    palette: palette.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    alphaMaterials: [...alphaMaterials].sort(),
    glassMaterials: [...glassMaterials].sort(),
    textures: textures.size,
    plates: plates.size,
    plateMeshes,
    triangles,
    meshes,
  }
}

/** Distinct colours a printed canvas actually contains, so a blank plate fails. */
function canvasColours(texture) {
  const image = texture.image
  const g = image.getContext('2d')
  const { width, height } = image
  const data = g.getImageData(0, 0, width, height).data
  const step = 4 * Math.max(1, Math.floor((width * height) / 4096))
  const colours = new Set()
  for (let i = 0; i < data.length; i += step) colours.add(`${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}`)
  return colours.size
}

/** The pixel at (x, y) of a printed canvas, as an sRGB triplet. */
function canvasPixel(texture, x, y) {
  const data = texture.image.getContext('2d').getImageData(x, y, 1, 1).data
  return [data[0], data[1], data[2]]
}

const round = value => Number(value.toFixed(6))
const out = resolve(process.argv[2] ?? '.preview/unity/wayfinding-proof/export')
await mkdir(out, { recursive: true })

const assets = []
for (const spec of MODELS) {
  const cityStyle = cityStyleFor(spec.city)
  const exitName = EXIT_NAME(spec.city)
  // A virtual 1×1 exit named with the city convention: the guidepost's label
  // plates read the exit through `cfg.exitId`, exactly as a placed pillar does.
  const exit = createModule('exit-virtual', 0, 0, -20, `proof-exit-${spec.city}`, 0)
  assert.equal(exit.type, 'exit', `${spec.city}: expected an exit module`)
  exit.cfg.name = exitName
  const mod = createModule(spec.paletteId, 0, 0, 0, `proof-${spec.city}`, 0)
  assert.ok(mod, `${spec.id}: createModule returned null`)
  assert.equal(mod.type, spec.kind === 'doorway' ? 'exit' : spec.kind, `${spec.id}: expected a ${spec.kind} module, got ${mod.type}`)
  if (spec.kind === 'guidepost') {
    // The guidepost's plates print the station and the exit it stands for.
    mod.cfg.exitId = exit.id
  } else {
    assert.equal(mod.cfg.style, 'doorway', `${spec.id}: builder style drifted`)
    assert.equal(mod.cfg.bays, 1, `${spec.id}: expected the one-bay 3 m doorway`)
    mod.cfg.name = exitName
  }

  // One live line per city: the headers print its badge and the guideposts'
  // live-label plates print its colour (`lineColourFor` is the document's colour).
  const line = { id: '1', name: '1号线', colour: lineColourFor('1', spec.city) }
  ctx.data = {
    cityStyle: spec.city,
    name: spec.station,
    nameEn: spec.stationEn,
    seed: 1,
    cells: [],
    modules: [mod, exit],
    lines: [line],
  }

  const root = buildModule(mod, ctx)
  assert.ok(root, `${spec.id}: buildModule returned null`)
  // The builder stamps the city style it dispatched on; read it before the
  // renderer-only metadata is stripped below.
  const guideCityStyle = root.userData.guideCityStyle

  // placeLocal puts the piece on its cell centre; export from a stable local
  // origin and record the placement once.
  const placementOffset = root.position.toArray().map(round)
  root.position.set(0, 0, 0)
  root.rotation.set(0, 0, 0)
  root.updateMatrixWorld(true)

  const stats = nameMaterials(root, spec.kind === 'guidepost' ? 'guide' : 'exitHeader',
    spec.kind === 'guidepost' ? 'guidePart' : 'doorwayPanel')
  root.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(root)
  assert.equal(bounds.isEmpty(), false, `${spec.id}: empty bounds`)
  const size = bounds.getSize(new THREE.Vector3())
  assert.ok(stats.triangles > 0 && stats.meshes > 0, `${spec.id}: exported no geometry`)
  assert.equal(stats.glassMaterials.length, 0, `${spec.id}: this family carries no glass`)
  assert.ok(ctx.owned.length > 0, `${spec.id}: the builder minted no materials`)
  for (const material of ctx.owned) {
    assert.ok(material.name, `${spec.id}: builder-owned material ${material.uuid} was never named`)
  }

  // The artwork must actually be printed: every plate canvas holds more than one
  // colour, so a blank canvas (or a failed draw) cannot pass as a plate.
  const plateMaterials = stats.palette.filter(entry => entry.map)
  assert.equal(plateMaterials.length, stats.plates, `${spec.id}: plate count drifted`)
  const plateTextures = new Map()
  root.traverse(object => {
    if (!object.isMesh) return
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material.map && !plateTextures.has(material.name)) plateTextures.set(material.name, material.map)
    }
  })
  for (const [name, texture] of plateTextures) {
    const colours = canvasColours(texture)
    assert.ok(colours >= 2, `${spec.id}: plate ${name} is a blank canvas (${colours} colour)`)
  }

  // Family shape: a ~4 m 导向柱 and a 3 m x 0.07 m x 0.78 m doorway panel.
  const parameters = {
    kind: spec.kind, cityStyle: spec.city, exitName,
    station: spec.station, stationEn: spec.stationEn, lineId: line.id, lineColour: line.colour,
  }
  if (spec.kind === 'guidepost') {
    assert.ok(size.z > 3.6 && size.z < 4.2, `${spec.id}: unexpected guidepost height ${size.z}`)
    assert.ok(size.x < 1.7 && size.y < 1.7, `${spec.id}: guidepost plan ${size.x} x ${size.y}`)
    // The default Guangzhou pillar carries seven canvas plates; the city pilons
    // print their logo/labels only (recorded per city below).
    assert.equal(stats.textures, spec.guidePlates, `${spec.id}: expected ${spec.guidePlates} plates, got ${stats.textures}`)
    parameters.heightMetres = round(size.z)
    parameters.plateCount = stats.textures
    parameters.plateMeshes = stats.plateMeshes
    parameters.platePrefix = 'guide'
    parameters.guideCityStyle = guideCityStyle ?? spec.city
    assert.equal(parameters.guideCityStyle, spec.city, `${spec.id}: builder city style ${parameters.guideCityStyle}`)
  } else {
    assert.ok(Math.abs(size.x - DOORWAY_WIDTH) < 0.001, `${spec.id}: doorway width ${size.x}`)
    assert.ok(size.y < 0.1, `${spec.id}: doorway depth ${size.y}`)
    assert.ok(size.z > 0.75 && size.z < 0.85, `${spec.id}: doorway height ${size.z}`)
    assert.equal(stats.textures, 1, `${spec.id}: expected the one printed header canvas, got ${stats.textures}`)
    const pixels = DOORWAY_PIXELS(spec.city)
    // The printed header's first pixel is the city's entrance band, and the
    // entrance colour is also carried by the panel below it.
    const headerName = [...plateTextures.keys()][0]
    const headerTexture = plateTextures.get(headerName)
    assert.equal(headerTexture.image.width, pixels.width, `${spec.id}: header canvas width ${headerTexture.image.width}`)
    const band = canvasPixel(headerTexture, 2, 2)
    const expectedBand = hexTriplet(cityStyle.entranceColour)
    assert.ok(band.every((channel, index) => Math.abs(channel - expectedBand[index]) <= 6),
      `${spec.id}: header band ${band.join(',')} != ${expectedBand.join(',')}`)
    const panel = stats.palette.find(entry => entry.colour === cityStyle.entranceColour.toLowerCase() && !entry.map)
    assert.ok(panel, `${spec.id}: doorway lost its ${cityStyle.entranceColour} entrance panel`)
    parameters.widthMetres = round(size.x)
    parameters.heightMetres = round(size.z)
    parameters.depthMetres = round(size.y)
    parameters.header = {
      style: HEADER[spec.city].style,
      bandColour: cityStyle.entranceColour,
      panelMaterial: panel.name,
      canvas: `${pixels.width}x${pixels.height}`,
      logicalWidth: pixels.logicalWidth,
      lineBadges: Math.min(1, HEADER_BADGES[spec.city]),
      drawsExitName: HEADER_DRAWS_EXIT[spec.city] !== false,
      exitIdentifier: exitName.replace(/(?:号口|出入口|出口|入口|口)$/u, ''),
    }
  }

  // Basis anchors, shared with bench/bin/cctv/glass/shelf/stair/exit. `Front` is
  // the gameplay forward (+y source). `Approach` is the side a passenger arrives
  // from: the doorway's street face is +y; a 导向柱's printed long faces flank its
  // −y nose (the same pair export-exit records for the 虚拟 marker).
  const anchors = {
    AxisX: [1, 0, 0],
    Front: [0, 1, 0],
    Up: [0, 0, 1],
    Approach: spec.kind === 'doorway' ? [0, 1, 0] : [0, -1, 0],
  }

  const gltfRoot = new THREE.Group()
  gltfRoot.name = spec.prefab
  // Source space is Z-up. The single export transform rotates it into glTF Y-up,
  // exactly as the bench, bin, cctv, glass, shelf, stair and exit recipes do.
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
    kind: spec.kind,
    cityStyle: spec.city,
    paletteId: spec.paletteId,
    prefab: spec.prefab,
    file: spec.file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: spec.source,
    provenance: spec.kind === 'guidepost'
      ? `Repository procedural ${spec.city} 导向柱 guidepost geometry, palette and printed plates (${HEADER[spec.city].style} city style)`
      : `Repository procedural 地面 doorway entrance panel, ${HEADER[spec.city].style} city palette and printed header canvas`,
    licenseRecord: 'Repository-authored procedural geometry and canvas signage; no third-party assets',
    units: 'metres',
    placementOffset,
    min: bounds.min.toArray().map(round),
    max: bounds.max.toArray().map(round),
    size: size.toArray().map(round),
    anchors,
    facade: spec.kind === 'doorway' ? 'local +y (street face)' : 'local -y (guidepost nose/plates)',
    forward: spec.kind === 'doorway' ? [0, 1, 0] : [0, -1, 0],
    triangles: stats.triangles,
    meshes: stats.meshes,
    materials: stats.names,
    alphaMaterials: stats.alphaMaterials,
    glassMaterials: stats.glassMaterials,
    textures: stats.textures,
    plates: stats.plates,
    plateMeshes: stats.plateMeshes,
    palette: stats.palette,
    station: { name: spec.station, nameEn: spec.stationEn, lineId: line.id, lineColour: line.colour },
    city: {
      style: spec.city,
      brand: cityStyle.brandKey,
      entranceColour: cityStyle.entranceColour,
    },
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

/** `#rrggbb` -> `[r, g, b]`. */
function hexTriplet(hex) {
  const value = hex.replace('#', '')
  return [0, 2, 4].map(index => Number.parseInt(value.slice(index, index + 2), 16))
}

// The family's fixed shape: eight cities, one guidepost and one doorway each.
assert.equal(assets.length, 16, 'expected sixteen wayfinding assets')
assert.equal(assets.filter(asset => asset.kind === 'guidepost').length, 8, 'expected eight city guideposts')
assert.equal(assets.filter(asset => asset.kind === 'doorway').length, 8, 'expected eight city doorways')
assert.equal(assets.filter(asset => asset.kind === 'guidepost' && asset.cityStyle === 'guangzhou')[0].textures, 7,
  'the Guangzhou default guidepost must carry its seven plates')

const summary = {
  schemaVersion: 1,
  family: 'wayfinding',
  sourcePaths: [
    'game/src/render/models/pieces/StreetDecorModel.ts',
    'game/src/render/models/pieces/GuidepostGeometry.ts',
    'game/src/render/models/pieces/ShenzhenGuidepost.ts',
    'game/src/render/models/pieces/ShanghaiGuidepost.ts',
    'game/src/render/models/pieces/BeijingGuidepost.ts',
    'game/src/render/models/pieces/ChengduGuidepost.ts',
    'game/src/render/models/pieces/ChongqingGuidepost.ts',
    'game/src/render/models/pieces/WuhanGuidepost.ts',
    'game/src/render/models/pieces/NanjingGuidepost.ts',
    'game/src/render/models/pieces/DoorwayExitModel.ts',
    'game/src/render/models/pieces/ExitModel.ts',
    'game/src/render/models/PieceBuilder.ts',
    'game/src/build/model/Equipment.ts',
    'game/src/sim/cityStyles.ts',
    'game/src/sim/exits.ts',
    'game/src/render/exitHeaderResolution.ts',
  ],
  parameters: {
    models: MODELS.length,
    family: 'wayfinding',
    rot: 0,
    cities: CITIES.map(entry => entry.city),
    cityStyleSource: 'ctx.data.cityStyle per asset: GuidepostModel dispatches on the city logo (buildNanjing/Wuhan/Chongqing/Chengdu/Beijing/Shanghai/ShenzhenGuidepost, default Guangzhou) and DoorwayExitModel reads cityStyleFor(cityStyle).entranceColour plus the city header canvas',
    stationData: 'one station document per asset: { cells: [], modules: [the piece, a virtual 1x1 exit], lines: [line 1 in the city colour], name: the city sample station, nameEn: its English gloss, cityStyle: the asset city } — no slab, track deck, run or wall block',
    stationSamples: CITIES.map(entry => ({ city: entry.city, name: entry.station, nameEn: entry.stationEn, line: '1', lineColour: lineColourFor('1', entry.city) })),
    placement: 'placeLocal offset [0.5, 0.5, 1] for both kinds (the doorway then nudges z by its mountZ, 0 here)',
    guidepost: 'eight ~4 m 导向柱 pillars, one per city; plate/texture counts: ' +
      CITIES.map(entry => `${entry.city} ${entry.guidePlates}`).join(', ') +
      '; the Guangzhou default (StreetDecorModel) carries the train icon, exit letter, station face (front/rear), Metro logo and its two triangular side logos',
    doorway: `${DOORWAY_WIDTH} m wide x 0.07 m deep x 0.78 m tall 地面 entrance panel: a darkSteel backing, a 2.94 m panel in the city entrance colour and the printed header canvas (a 512 x 96 logical header, 2048 x 384 for the 4x Chengdu/Chongqing/Wuhan/Nanjing print)`,
    exitNames: CITIES.map(entry => `${entry.city} ${EXIT_NAME(entry.city)}`).join(', ') +
      '; the sim letters exits A-Z (C口) except Shanghai, which numbers them (nextExitName: 13号口)',
    headerStyles: CITIES.map(entry => `${entry.city} ${HEADER[entry.city].style}`).join(', '),
    palette: 'createModelMaterials(): darkSteel/white/blue/exitRed/psu and the guidepost city materials are builder-owned and named by plate pixels or authored colour; every palette material keeps its createModelMaterials key. No glass in this family.',
    textures: 'the guidepost plates and the doorway header are 2-D canvases encoded through @napi-rs/canvas; the palette grain is drawn from a fixed-seed generator and the canvas encoders are serialized so image bufferViews keep traversal order',
    basis: 'source Z-up tree wrapped in a group rotated -90 degrees about X (glTF Y-up); Unity wrapper applies the 180-degree Y correction so gameplay channels read (x, z, y)',
  },
  assets,
  validation: {
    errors: assets.reduce((sum, asset) => sum + asset.validation.errors, 0),
    warnings: assets.reduce((sum, asset) => sum + asset.validation.warnings, 0),
  },
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(`WAYFINDING_EXPORT_OK ${assets.length} models, ${summary.validation.errors} errors, ${summary.validation.warnings} warnings -> ${out}`)
