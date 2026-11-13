import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Canvas, ImageData, createCanvas, loadImage } from '@napi-rs/canvas'
import validator from 'gltf-validator'

// The 显示 (display) family: the six pieces the station palette hangs and stands to
// show the time and the trains.
//
//   clock          the double-faced analogue concourse clock (two pivoted hands a face)
//   clock-digital  the two-faced LED/lunar-calendar clock in one slim housing
//   tv             the passenger-information screen: a lit departure board beside a
//                  content window, hung from the ceiling by two rods
//   tv-double      two `tv` modules back to back on one cell — one shared housing with a
//                  lit face each side. Not a palette id: `createModule('tv-double')`
//                  returns null, so this is the game's own pairing rule (`sim/tvs.ts`)
//   tvm            the ticket vending machine, with its printed 车票 marquee
//   vending        the drink vending machine, with its printed control strip and base band
//
// Every asset is the game's own builder output for one placed module at a stable local
// origin. Bounds, triangles, materials and textures come from that build, not from a
// table of expectations.
//
// Two things are runtime state rather than geometry and are frozen here:
//
//   * the **departure board** the 电视 prints is drawn by `render/stationDisplay.ts` from
//     the live train poses, so this recipe prints a fixed **sample** board (one line, three
//     destination rows and a clock). Live arrivals are game state and are not exported.
//   * the **clock's hands** are reposed every frame from the sim clock
//     (`reposeClockHands`); the exporter takes the builder's own default pose (10:09,
//     `CLOCK_POSE_SECONDS`) and does not animate the GLB. The pivots themselves are kept
//     and named, so Unity can assert the articulated hierarchy survived.

// One 2-D canvas adapter for the palette's printed maps, the departure board and the
// decoded poster. Shadow `data` or GLTFExporter treats every canvas as a DataTexture and
// writes transparent black (see the asset skill).
globalThis.HTMLCanvasElement = Canvas
globalThis.ImageData = ImageData
globalThis.document = {
  createElement(name) {
    assert.equal(name, 'canvas')
    const canvas = createCanvas(1, 1)
    Object.defineProperty(canvas, 'data', { value: undefined })
    // Several canvases are minted in one build (palette maps, the departure board, the
    // poster). Their encoders are serialized on this chain so the image bufferView order
    // cannot race between two exports.
    canvas.toBlob = (callback, mime) => {
      encodeChain = encodeChain.then(async () => {
        const bytes = await canvas.encode(mime === 'image/jpeg' ? 'jpeg' : 'png')
        const blob = new Blob([bytes], { type: mime })
        blob.arrayBuffer = async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        callback(blob)
      })
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

let encodeChain = Promise.resolve()

// The palette's brushed-steel canvas draws grain with Math.random. Seed it before
// importing PieceBuilder so the exported texture is byte-stable across runs.
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
const { createModelMaterials, canvasTexture } = await import('../../game/src/render/models/PieceBuilder.ts')
const { createModule, randomAdSlug } = await import('../../game/src/build/model/Equipment.ts')
const { buildModule } = await import('../../game/src/render/models.ts')
const { posterFor } = await import('../../game/src/sim/billboards.ts')
const { tvPairSlot, TV_HALF } = await import('../../game/src/sim/tvs.ts')
const { CLOCK_POSE_SECONDS } = await import('../../game/src/render/models/pieces/ClockModel.ts')
const { clockHandAngles } = await import('../../game/src/sim/clock.ts')
const { drawStationDisplay, stationDisplayLayout, STATION_PLATE } = await import('../../game/src/render/stationDisplay.ts')
const { croppedPlane, panelUvWindow } = await import('../../game/src/render/panelUv.ts')

/** The six family models, in review-row order. */
const MODELS = [
  { key: 'clock', paletteId: 'clock', prefab: 'Clock', file: 'clock.glb', id: 'station.clock.standard', variant: 'analogue' },
  { key: 'clock-digital', paletteId: 'clock-digital', prefab: 'ClockDigital', file: 'clock-digital.glb', id: 'station.clock.digital', variant: 'digital' },
  { key: 'tv', paletteId: 'tv', prefab: 'Tv', file: 'tv.glb', id: 'station.tv.standard', variant: 'single' },
  { key: 'tv-double', paletteId: 'tv-double', prefab: 'TvDouble', file: 'tv-double.glb', id: 'station.tv.double', variant: 'pair', pair: true },
  { key: 'tvm', paletteId: 'tvm', prefab: 'Tvm', file: 'tvm.glb', id: 'station.tvm.standard', variant: 'single' },
  { key: 'vending', paletteId: 'vending', prefab: 'Vending', file: 'vending.glb', id: 'station.vending.standard', variant: 'single' },
]

/**
 * The hung-ceiling fallback for a station with no slab over the cell:
 * `hangCeilingLocal` reads `STOREY_HEIGHT (5) - 1`. Asserted against the built geometry.
 */
const CEILING = 4

/**
 * Where the builder seats a module, in an empty station: `placeLocal` centres a hung
 * piece on its cell, while `placeLocalAtEdge` (the TVM and the vending machine) stands
 * it against the cell's near edge at its own depth.
 */
const PLACEMENT = [0.5, 0.5, 1]
/** The same seat as `placeLocalAtEdge`: the tile edge less half the piece's depth. */
const edgePlacement = (depth) => [0.5, 0.5 + (0.5 - depth / 2), 1]
const EDGE_PLACEMENT = {
  tvm: edgePlacement(0.6),
  vending: edgePlacement(0.732),
}

/** The stationary pose the digital clock's LED face prints (`CLOCK_POSE_SECONDS`). */
const DIGITAL_SECONDS = CLOCK_POSE_SECONDS % 86400

/* --------------------------------------------------------- departure board */

/**
 * The sample 电视 board. The scene redraws this from the live train poses
 * (`PlateSystem.makeTvPlate`), which are game state and cannot be exported, so the
 * recipe freezes one representative board: one line's shield, the station name, the
 * three 列车开往 cards and the clock — exactly the regions `drawStationDisplay` paints.
 */
const BOARD_STATUS = {
  name: '1号线',
  colour: '#c8102e',
  terminus: '广州东站',
  arrivals: [
    { minutes: 2, atPlatform: false, arriving: false },
    { minutes: 6, atPlatform: false, arriving: false },
    { minutes: 11, atPlatform: false, arriving: false },
  ],
}
const BOARD_STATION = '体育西路'
const BOARD_CLOCK = '10:09'
const BOARD_DATE = '11月11日 周三'

/** A line shield in the station footer card, so the sample board shows which line it is. */
function drawLineShield(g) {
  const { station } = stationDisplayLayout()
  const box = { x: station.x + 6, y: station.y + 6, w: 34, h: station.h - 12 }
  g.fillStyle = BOARD_STATUS.colour
  g.beginPath()
  g.roundRect(box.x, box.y, box.w, box.h, 6)
  g.fill()
  g.fillStyle = '#ffffff'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = 'bold 24px "Microsoft YaHei", sans-serif'
  g.fillText('1', box.x + box.w / 2, box.y + box.h / 2 + 1)
  g.textAlign = 'left'
  g.textBaseline = 'top'
}

/**
 * One departure board, shared by every 电视 in the family. Named `tvDepartureBoard`
 * because that is the material the review asserts: the board is the piece's own lit
 * information panel, not artwork.
 */
const departureBoard = canvasTexture(STATION_PLATE.width, STATION_PLATE.height, (g) => {
  drawStationDisplay(g, BOARD_STATUS, BOARD_STATION, BOARD_CLOCK, BOARD_DATE)
  drawLineShield(g)
})
departureBoard.name = 'tvDepartureBoard'

/* --------------------------------------------------------------- ad artwork */

const POSTER_DIR = new URL('../../game/src/assets/posters/', import.meta.url)
const posters = new Map()

/** Decode one repository poster into a colour-managed canvas texture (as export-advert). */
async function decodePoster(slug) {
  const existing = posters.get(slug)
  if (existing) return existing
  const image = await loadImage(new URL(`${slug}.webp`, POSTER_DIR))
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const g = canvas.getContext('2d')
  assert.ok(g, `${slug}: no 2-D context for the poster canvas`)
  g.drawImage(image, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 1
  texture.name = `tvPoster_${slug}`
  const record = { slug, texture, imageAspect: image.width / image.height, width: image.width, height: image.height }
  posters.set(slug, record)
  return record
}

/**
 * The headless `AdArt` contract the 电视's content window reads: the frozen
 * `cfg.poster` decoded from the repository poster catalogue, cropped to the window
 * with the same centred UV window `render/adArt.ts` uses in the browser.
 */
function createAdArt() {
  const materials = new Map()
  const geometries = new Map()
  return {
    async load() {},
    adFace(slug, w, h) {
      const poster = posters.get(slug)
      assert.ok(poster, `adFace: no decoded poster for ${slug}`)
      let material = materials.get(slug)
      if (!material) {
        material = new THREE.MeshBasicMaterial({ map: poster.texture, side: THREE.FrontSide })
        // The one lit-artwork material of the piece.
        material.name = 'tvContentWindow'
        materials.set(slug, material)
      }
      const key = `${slug}@${w.toFixed(3)}x${h.toFixed(3)}`
      let geometry = geometries.get(key)
      if (!geometry) {
        geometry = croppedPlane(w, h, panelUvWindow(poster.imageAspect, w / h))
        geometries.set(key, geometry)
      }
      return { geometry, material }
    },
    adWindow(w, h) {
      const poster = [...posters.values()][0]
      return { ...this.adFace(poster.slug, w, h), slug: poster.slug }
    },
    dispose() {},
  }
}

/* ------------------------------------------------------------------- build */

const mats = createModelMaterials()
const paletteNames = new Map(Object.entries(mats).map(([name, material]) => [material, name]))

/** The hung pieces (both clocks and both screens); the TVM and the vending machine stand. */
const HUNG = new Set(['clock', 'clock-digital', 'tv', 'tv-double'])
/** The two pieces that carry a station board and a content window. */
const SCREENS = new Set(['tv', 'tv-double'])

/** One module of the piece, with the campaign the game would have frozen on it. */
function modulesFor(spec) {
  const modules = []
  if (spec.pair) {
    // `tv-double` is not a palette id: the pair is two `tv` modules sharing one cell,
    // facing exactly opposite ways (`tvPairAxis`). The first in document order hangs it.
    assert.equal(createModule('tv-double', 0, 0, 0, 'proof-tv-double', 0), null,
      'tv-double is not a createModule palette id')
    for (const rot of [0, 2]) {
      const mod = createModule('tv', 0, 0, 0, `proof-tv-double-${rot}`, rot)
      assert.ok(mod, `could not create the rot ${rot} member of the pair`)
      modules.push(mod)
    }
  } else {
    const mod = createModule(spec.paletteId, 0, 0, 0, `proof-${spec.key}`, 0)
    assert.ok(mod, `${spec.paletteId}: createModule returned null`)
    modules.push(mod)
  }
  // Freeze each screen's campaign, exactly as `assignAdPosters` does when a 电视 is
  // committed: deterministic in the module id, never rolled at draw time.
  return modules.map((mod) => (mod.type === 'tv' ? { ...mod, cfg: { ...mod.cfg, poster: randomAdSlug(mod) } } : mod))
}

/** A mesh's axis-aligned box in the root's own frame (the dial/hand pivots are turned). */
function measureParts(root) {
  root.updateMatrixWorld(true)
  const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const parts = []
  root.traverse((object) => {
    if (!object.isMesh) return
    object.geometry.computeBoundingBox()
    const toRoot = new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld)
    const box = object.geometry.boundingBox.clone().applyMatrix4(toRoot)
    parts.push({
      mesh: object,
      material: Array.isArray(object.material) ? object.material[0] : object.material,
      min: box.min.toArray(),
      max: box.max.toArray(),
      size: box.getSize(new THREE.Vector3()).toArray(),
    })
  })
  return parts
}

const close = (a, b, tolerance = 0.004) => Math.abs(a - b) < tolerance

/**
 * The 电视 housing is the one measurement that says whether the pair merged: the bezel
 * posts span the body, so their depth *is* the housing's (`TvModel` TV_HALF_DEPTH, and
 * `test/tv-pair.test.mjs` measures the same two numbers). A lone 电视 is one panel thick;
 * a back-to-back pair is exactly two of them.
 */
function measureHousing(parts) {
  const posts = parts.filter(part =>
    close(part.size[0], 0.07) && close(part.size[2], 0.8) && part.material === mats.darkSteel)
  return {
    posts: posts.length,
    depthMetres: posts.length ? posts[0].size[1] : 0,
    postSize: posts.length ? posts[0].size.map(value => Number(value.toFixed(4))) : [],
  }
}

const out = resolve(process.argv[2] ?? '.preview/unity/display-proof/export')
await mkdir(out, { recursive: true })

const assets = []
for (const spec of MODELS) {
  const data = { cells: [], modules: modulesFor(spec), lines: [], name: 'Station', nameEn: 'Station' }
  // Decode the campaigns this piece prints before the build asks for them.
  for (const mod of data.modules) if (mod.type === 'tv') await decodePoster(posterFor(mod.cfg.poster).slug)

  const owned = []
  const ctx = {
    mats,
    data,
    ads: createAdArt(),
    trackCells: new Set(),
    finish: () => mats.darkSteel,
    owned,
    tvPlate: () => departureBoard,
    tvPairSlot: (id) => tvPairSlot(id, data.modules),
  }

  let root
  const placement = EDGE_PLACEMENT[spec.key] ?? PLACEMENT
  if (spec.pair) {
    root = new THREE.Group()
    root.name = spec.prefab
    for (const mod of data.modules) {
      const member = buildModule(mod, ctx)
      assert.ok(member, `${spec.key}: buildModule returned null for ${mod.id}`)
      assert.deepEqual(member.position.toArray(), placement, `${spec.key}: unexpected cell placement`)
      // Cell-local: both members sit on the same cell, so the pair's own root is that
      // cell's centre. The half-turn each one carries stays on its own group.
      member.position.set(0, 0, 0)
      root.add(member)
    }
  } else {
    root = buildModule(data.modules[0], ctx)
    assert.ok(root, `${spec.key}: buildModule returned null`)
    assert.deepEqual(root.position.toArray(), placement, `${spec.key}: unexpected cell placement`)
    root.position.set(0, 0, 0)
    root.rotation.set(0, 0, 0)
  }
  root.updateMatrixWorld(true)

  // The clock's hands are pivots the scene turns every frame (`reposeClockHands`); the
  // exporter keeps the builder's own 10:09 pose and names the articulated nodes so the
  // review can assert the hierarchy. No animation is written to the GLB.
  const rig = root.userData.clockRig
  const faces = ['Front', 'Back']
  for (const [index, pivot] of (rig?.hour ?? []).entries()) {
    pivot.name = index === 0 ? 'clockHourHand' : `clockHourHand${index + 1}`
    if (pivot.children[0]) pivot.children[0].name = pivot.name.replace('Hand', 'Arm')
    if (pivot.parent && !pivot.parent.name) pivot.parent.name = `clockDial${faces[index] ?? index + 1}`
    if (pivot.parent?.parent && !pivot.parent.parent.name) pivot.parent.parent.name = `clockFace${faces[index] ?? index + 1}`
  }
  for (const [index, pivot] of (rig?.minute ?? []).entries()) {
    pivot.name = index === 0 ? 'clockMinuteHand' : `clockMinuteHand${index + 1}`
    if (pivot.children[0]) pivot.children[0].name = pivot.name.replace('Hand', 'Arm')
  }
  const handNodes = [...(rig?.hour ?? []), ...(rig?.minute ?? [])].map(pivot => pivot.name)

  // Name every material: palette slots by their authored key, builder-minted ones by
  // their authored colour (or the role the family gives them).
  const used = new Map()
  const named = new Set()
  const alphaMaterials = new Set()
  const glassMaterials = new Set()
  const textures = new Set()
  const textureNames = new Set()
  let triangles = 0
  let meshes = 0
  root.traverse((object) => {
    if (!object.isMesh) return
    meshes++
    triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      let name = used.get(material)
      if (!name) {
        name = paletteNames.get(material)
        if (!name) {
          if (material.map === departureBoard) name = 'tvDepartureBoard'
          else if (material.map && material.map.name?.startsWith('tvPoster_')) name = 'tvContentWindow'
          else if (material.map && material.map.image?.width === 256 && material.map.image?.height === 64) name = 'tvmMarquee'
          else if (material.color?.getHex() === 0x243c85) name = 'tvmNavy'
          else name = material.name
          assert.ok(name, `${spec.key}: unnamed material ${material.type} #${material.color?.getHexString()}`)
          if (named.has(name)) {
            let suffix = 2
            while (named.has(`${name}${suffix}`)) suffix++
            name = `${name}${suffix}`
          }
        }
        used.set(material, name)
        named.add(name)
        material.name = name
      }
      if (material.transparent) alphaMaterials.add(name)
      if (name.toLowerCase().includes('glass')) glassMaterials.add(name)
      if (material.map) {
        textures.add(material.map)
        if (material.map.name) textureNames.add(material.map.name)
      }
    }
  })
  assert.equal(Number.isInteger(triangles), true, `${spec.key}: triangle count is not an integer`)

  // Name the meshes the review has to find: the 电视's two lit panes, the digital
  // clock's two faces, the TVM's marquee, the vending machine's printed strip.
  const meshNames = new Set()
  root.traverse((object) => {
    if (!object.isMesh || object.name) return
    const material = Array.isArray(object.material) ? object.material[0] : object.material
    let name = material.name
    if (meshNames.has(name)) {
      let suffix = 2
      while (meshNames.has(`${name}${suffix}`)) suffix++
      name = `${name}${suffix}`
    }
    object.name = name
    meshNames.add(name)
  })

  const parts = measureParts(root)
  const housing = measureHousing(parts)
  const bounds = new THREE.Box3().setFromObject(root)
  const size = bounds.getSize(new THREE.Vector3())

  // The hung pieces hang from the ceiling fallback; the standing ones stand on the floor.
  if (HUNG.has(spec.key)) {
    assert.ok(close(bounds.max.z, CEILING, 0.002), `${spec.key}: does not reach the ${CEILING} m ceiling (${bounds.max.z})`)
  }
  if (spec.key === 'tvm' || spec.key === 'vending') {
    assert.ok(Math.abs(bounds.min.z) < 1e-6, `${spec.key}: does not stand on the floor (${bounds.min.z})`)
  }
  assert.equal(housing.posts, SCREENS.has(spec.key) ? 2 : 0, `${spec.key}: expected one bezel housing (two posts)`)

  // Basis anchors, shared with bench/bin/cctv/shelf. The lit face is local -y.
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

  // Strip renderer-only metadata (random UUIDs and LOD payloads) before export.
  root.traverse((object) => { object.userData = {} })

  const pose = clockHandAngles(CLOCK_POSE_SECONDS)
  const pairSpec = spec.pair
    ? {
      modules: 2,
      rotations: [0, 2],
      // `sim/tvs.ts` reports the pair as two panel depths; the drawn housing is two
      // panels of `TV_HALF_DEPTH` each, i.e. twice one lone 电视's body.
      slotDepthMetres: 2 * TV_HALF,
      pairBodyDepthMetres: housing.depthMetres,
      paneHalfDepthMetres: Number(bounds.max.y.toFixed(4)),
      cellDepthMetres: 1,
    }
    : null
  const parameters = {
    mount: HUNG.has(spec.key) ? 'hung from the storey ceiling' : 'standing on the floor',
    ceilingHeightMetres: HUNG.has(spec.key) ? CEILING : 0,
    facing: 'local -y',
    ...(spec.key === 'clock' ? {
      clockPoseSeconds: CLOCK_POSE_SECONDS,
      hourHandDegrees: Number(pose.hour.toFixed(3)),
      minuteHandDegrees: Number(pose.minute.toFixed(3)),
      faces: 2,
    } : {}),
    ...(spec.key === 'clock-digital' ? {
      digitalPoseSeconds: DIGITAL_SECONDS,
      faces: 2,
    } : {}),
    ...(SCREENS.has(spec.key) ? {
      screenWidthMetres: 1.56,
      boardMetres: [0.96, 0.54],
      boardSample: true,
      posters: data.modules.map(mod => mod.cfg.poster),
    } : {}),
    ...(spec.key === 'tvm' ? { marquee: 'tvmMarquee', marqueeMetres: [0.61, 0.145] } : {}),
    ...(spec.key === 'vending' ? { printedFaces: ['vendingPanel', 'vendingBase'] } : {}),
    ...(pairSpec ?? {}),
  }

  const gltfRoot = new THREE.Group()
  gltfRoot.name = spec.prefab
  // Source space is Z-up. The single export transform rotates it into glTF Y-up,
  // exactly as the bench, bin, cctv, shelf and billboard recipes do.
  gltfRoot.rotation.x = -Math.PI / 2
  gltfRoot.add(root)
  const bytes = new Uint8Array(await new GLTFExporter().parseAsync(gltfRoot, { binary: true }))
  // Settle every queued canvas encode before hashing the bytes.
  await encodeChain
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
    family: 'display',
    variant: spec.variant,
    prefab: spec.prefab,
    file: spec.file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: spec.pair
      ? 'game/src/render/models/pieces/TvModel.ts (two tv modules paired by game/src/sim/tvs.ts)'
      : `game/src/render/models/pieces/${spec.key === 'clock' || spec.key === 'clock-digital' ? 'ClockModel' : spec.key === 'tv' ? 'TvModel' : spec.key === 'tvm' ? 'TvmModel' : 'VendingModel'}.ts`,
    provenance: spec.pair
      ? 'Repository procedural 电视 pair: one shared housing with a lit board and content window on each face'
      : 'Repository procedural display geometry, palette and printed canvas maps',
    licenseRecord: SCREENS.has(spec.key)
      ? 'Repository-authored procedural geometry; the content-window artwork is decoded from the repository poster catalogue under game/src/assets/posters'
      : 'Repository-authored procedural geometry; no third-party assets',
    units: 'metres',
    placementOffset: placement,
    moduleIds: data.modules.map(mod => mod.id),
    moduleRotations: data.modules.map(mod => mod.rot),
    min: bounds.min.toArray(),
    max: bounds.max.toArray(),
    size: size.toArray(),
    anchors,
    facade: spec.pair ? 'lit faces local -y and +y' : 'local -y',
    // Explicit switches, not null objects: Unity's JsonUtility builds a default
    // instance for a JSON null, so a missing nested object cannot be detected there.
    screen: SCREENS.has(spec.key),
    pairMember: Boolean(spec.pair),
    ceilingHung: HUNG.has(spec.key),
    hands: spec.key === 'clock' ? handNodes.length : 0,
    triangles,
    meshes,
    materials: [...used.values()].sort(),
    alphaMaterials: [...alphaMaterials].sort(),
    glassMaterials: [...glassMaterials].sort(),
    textures: textures.size,
    textureNames: [...textureNames].sort(),
    housing: SCREENS.has(spec.key)
      ? { posts: housing.posts, depthMetres: Number(housing.depthMetres.toFixed(4)), postSize: housing.postSize }
      : null,
    departureBoard: SCREENS.has(spec.key)
      ? { material: 'tvDepartureBoard', texture: 'tvDepartureBoard', width: STATION_PLATE.width, height: STATION_PLATE.height, sample: true }
      : null,
    pose: spec.key === 'clock'
      ? {
        seconds: CLOCK_POSE_SECONDS,
        hourDegrees: Number(pose.hour.toFixed(3)),
        minuteDegrees: Number(pose.minute.toFixed(3)),
        hands: handNodes.length,
        nodes: handNodes,
      }
      : null,
    pair: pairSpec,
    parameters,
    validation: { errors: report.issues.numErrors, warnings: report.issues.numWarnings },
  }
  await writeFile(join(out, spec.file), bytes)
  await writeFile(join(out, spec.file.replace(/\.glb$/, '.manifest.json')), JSON.stringify(manifest, null, 2) + '\n')
  assets.push(manifest)
  console.log(
    `${spec.id}: ${triangles} triangles, ${meshes} meshes, ${manifest.materials.length} materials ` +
      `(${manifest.alphaMaterials.length} alpha), ${textures.size} textures, ${size.x.toFixed(3)} x ${size.y.toFixed(3)} x ${size.z.toFixed(3)} m` +
      (SCREENS.has(spec.key) ? `, housing ${housing.depthMetres.toFixed(3)} m` : '') +
      `, ${bytes.length} bytes, ${manifest.sha256.slice(0, 12)}`,
  )
}

const clock = assets.find(asset => asset.variant === 'analogue')
const pair = assets.find(asset => asset.variant === 'pair')
const solo = assets.find(asset => asset.id === 'station.tv.standard')
assert.ok(clock?.pose, 'the analogue clock manifest lost its hand pose')
assert.ok(pair?.pair && solo?.housing, 'the tv manifests lost their housing')
// Two thin panels, not a box as deep as the cell — and exactly twice one lone 电视.
assert.ok(close(pair.housing.depthMetres, 2 * solo.housing.depthMetres, 0.002),
  `pair housing ${pair.housing.depthMetres} m is not two lone 电视 bodies (${solo.housing.depthMetres} m each)`)
assert.ok(pair.housing.depthMetres > 0.05 && pair.housing.depthMetres < 0.5,
  `pair housing ${pair.housing.depthMetres} m is not a slim body`)

const summary = {
  schemaVersion: 1,
  family: 'display',
  sourcePaths: [
    'game/src/render/models/pieces/ClockModel.ts',
    'game/src/render/models/pieces/TvModel.ts',
    'game/src/render/models/pieces/TvmModel.ts',
    'game/src/render/models/pieces/VendingModel.ts',
    'game/src/render/models/PieceBuilder.ts',
    'game/src/build/model/Equipment.ts',
    'game/src/sim/tvs.ts',
    'game/src/render/stationDisplay.ts',
  ],
  parameters: {
    models: MODELS.length,
    rot: 0,
    stationData: 'empty station document: { cells: [], modules: [], lines: [] }',
    placement: 'placeLocal / placeLocalAtEdge put a module at the cell centre [x + 0.5, y + 0.5, z + 1]; the export resets it and keeps that offset in placementOffset',
    ceilingHeightMetres: CEILING,
    ceilingSource: 'hangCeilingLocal fallback `STOREY_HEIGHT (5) - 1` for a piece with no slab or deck overhead',
    mount: { clock: 'ceiling', 'clock-digital': 'ceiling', tv: 'ceiling', 'tv-double': 'ceiling', tvm: 'floor', vending: 'floor' },
    clockPoseSeconds: clock.pose.seconds,
    clockPose: {
      hourDegrees: clock.pose.hourDegrees,
      minuteDegrees: clock.pose.minuteDegrees,
      faces: 2,
      hands: clock.pose.hands,
      note: 'the builder default (10:09); a placed clock is reposed from the sim clock every frame (reposeClockHands). The GLB carries this fixed pose and no animation',
    },
    digitalPoseSeconds: DIGITAL_SECONDS,
    digitalNote: 'the LED/lunar face is a static canvas printed at CLOCK_POSE_SECONDS; nothing is animated',
    pair: {
      modules: 2,
      rotations: [0, 2],
      rule: 'two tv modules on one cell facing exactly 180 degrees apart (tvPairAxis); the first in document order hangs the shared housing',
      housingHalfDepthMetres: Number((pair.housing.depthMetres / 2).toFixed(4)),
      housingDepthMetres: pair.housing.depthMetres,
      soloHousingDepthMetres: solo.housing.depthMetres,
      slotDepthMetres: pair.pair.slotDepthMetres,
      paneHalfDepthMetres: pair.pair.paneHalfDepthMetres,
      cellDepthMetres: 1,
      note: 'the drawn pair is two lone 电视 bodies back to back: each panel is TV_HALF_DEPTH (0.05 m) either side of the shared centre, so the housing is 0.20 m thick (0.10 m either side) and the lit panes stand 0.015 m proud of it. sim/tvs.ts reports the same pair as slot.depth = 2 * TV_HALF = 0.10 m, which the renderer reads as presence only',
    },
    departureBoard: {
      material: 'tvDepartureBoard',
      width: STATION_PLATE.width,
      height: STATION_PLATE.height,
      sample: true,
      note: 'SAMPLE / RUNTIME PLACEHOLDER: the scene redraws this board every frame from the live train poses and clock (render/stationDisplay.ts). Live arrivals are game state and are not exported; the recipe prints one fixed board with a line shield, the station name, three 列车开往 rows and a clock',
    },
    contentWindow: {
      material: 'tvContentWindow',
      posters: [...new Set(assets.flatMap(asset => asset.parameters.posters ?? []))].sort(),
      source: 'the frozen cfg.poster decoded from game/src/assets/posters/<slug>.webp and cropped to the window with panelUvWindow + croppedPlane, exactly as render/adArt.ts does',
    },
    palette: 'createModelMaterials(): steel (64 px brushed canvas map), darkSteel, white, black, blue, orange, green, psu, gateRed (transparent 0.82), glass (transparent 0.26), binSteel (128 px satin canvas), screen (LCD canvas), clockDisplay (384 x 152 LED canvas), vendingPanel (128 x 576) and vendingBase (384 x 96) printed maps, ledGreen',
    textures: 'every printed map is a 2-D canvas encoded through @napi-rs/canvas; the palette grain is drawn from a fixed-seed generator and the canvas encoders are serialized so the image order is byte-stable',
    basis: 'source Z-up tree wrapped in a group rotated -90 degrees about X (glTF Y-up); Unity wrapper applies the 180-degree Y correction so gameplay channels read (x, z, y)',
  },
  assets,
  validation: {
    errors: assets.reduce((sum, asset) => sum + asset.validation.errors, 0),
    warnings: assets.reduce((sum, asset) => sum + asset.validation.warnings, 0),
  },
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(`DISPLAY_EXPORT_OK ${assets.length} models, ${summary.validation.errors} errors, ${summary.validation.warnings} warnings -> ${out}`)
