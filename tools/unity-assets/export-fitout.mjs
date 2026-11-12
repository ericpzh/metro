import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Canvas, ImageData, createCanvas, loadImage } from '@napi-rs/canvas'
import validator from 'gltf-validator'

// The fitout family: the shop / booth interiors generated from a station document
// and the roadside pieces generated from the same document.
//
//   shop-room              RoomModel store shell 6 x 4 m, two-cell shop front
//   retail-room            retail shell -> RoomModel store adapter, two-cell opening
//   ticket-booth           glazed BoothModel kiosk, transfer gap and mounted sign
//   shop-shelves           ShopShelves food run (room furniture)
//   shop-counter           ShopCounter generic two-cell run
//   shop-stock             ShopStock batches lifted from four fit-outs
//   street-arrow-markings  RoadArrowMarking four junction arrow cases on asphalt
//   street-decor           StreetDecorModel bus shelter + guidepost at a corner
//   dynamic-station-panels PanelAtlas page with edited sign, route map, poster, display
//
// The pixels are drawn by the game's own canvas printers (signFace, lineMapFace,
// stationDisplay) plus one real repository poster, then packed into a PanelAtlas.
// The palette prints a 64 px brushed-steel canvas with Math.random, so the grain is
// seeded; every canvas encode is serialised; every material, mesh and texture is
// named; userData is stripped. Two exports must be byte-identical.
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

globalThis.HTMLCanvasElement = Canvas
globalThis.ImageData = ImageData
// GLTFExporter reuses one module-level 2D canvas for every image and records the
// bufferView in encode-completion order, so two encodes in flight at once would
// race in content and order. Serialise every encode on one chain.
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
const { createModelMaterials, canvasTexture } = await import('../../game/src/render/models/PieceBuilder.ts')
const { buildModule } = await import('../../game/src/render/models.ts')
const { drawSignPanel } = await import('../../game/src/render/signFace.ts')
const { settleSignLayout, signPlate, signBoardsOf, signBoardsPanel, mountedSignBoards, defaultSignLayout } = await import('../../game/src/sim/sign.ts')
const { snapSignToBooth } = await import('../../game/src/sim/boothSigns.ts')
const { drawLineMapPlaceholder, lineMapPlaceholderPlate } = await import('../../game/src/render/lineMapFace.ts')
const { LINE_MAP_PANEL_W, LINE_MAP_PANEL_H } = await import('../../game/src/sim/linemaps.ts')
const { drawStationDisplay } = await import('../../game/src/render/stationDisplay.ts')
const { PanelAtlas, atlasUV } = await import('../../game/src/render/panelAtlas.ts')
const { croppedPlane, panelUvWindow } = await import('../../game/src/render/panelUv.ts')
const { roadArrowMarking } = await import('../../game/src/render/models/pieces/RoadArrowMarking.ts')
const { panelPosters } = await import('../../game/src/sim/billboards.ts')
const { shelfSpec } = await import('../../game/src/sim/shelves.ts')
const { counterLength } = await import('../../game/src/sim/counters.ts')

const SLUG = 'landscape-1-jpg'
const POSTER_DIR = new URL('../../game/src/assets/posters/', import.meta.url)

/* ------------------------------------------------------------ station document */

// The authored document every piece reads. It is deliberately a real station:
// the sign shield and the route map take the lines' own names and colours, the
// booth sign spells an authored label, the bus shelter prints the station name
// on its route board and freezes a campaign, and the guidepost reads an exit.
const LINES = [
  {
    id: 'l1', name: '1号线', colour: '#f0c000', upTerminus: '西站', downTerminus: '东站',
    direction: 'up', travelSign: 1, stations: ['体育西路', '西站', '东站'],
    stock: 'B', cars: 6, power: 'third-rail', headwayProfile: { peak: 120, offpeak: 240, late: 360 },
    alightPerTrain: 0, terminus: 'through',
  },
  {
    id: 'l2', name: '2号线', colour: '#1f6fd6', upTerminus: '北站', downTerminus: '南站',
    direction: 'down', travelSign: -1, stations: ['体育西路', '北站', '南站'],
    stock: 'B', cars: 6, power: 'third-rail', headwayProfile: { peak: 120, offpeak: 240, late: 360 },
    alightPerTrain: 0, terminus: 'through',
  },
]
const EXIT = { id: 'exit-a', type: 'exit', x: 0, y: 0, z: 0, w: 2, h: 2, rot: 0, cfg: { name: 'A口' } }
const DATA = {
  cells: [], modules: [EXIT], lines: LINES, name: '体育西路', nameEn: 'Tiyu Xilu', cityStyle: 'guangzhou',
}

/* -------------------------------------------------------------------- palette */

const mats = createModelMaterials()
const paletteNames = new Map(Object.entries(mats).map(([name, material]) => [material, name]))
const FINISH = {
  'wall.plaster': mats.white,
  'wall.enamel': mats.blue,
  'wall.stainless': mats.steel,
}

/**
 * The ad art the game's `render/adArt.ts` builds in the browser, cut headlessly:
 * decode a repository WebP and hand back the same centred-crop geometry and
 * unlit material pair. One material per poster, one quad per panel size.
 */
function createAdArt() {
  const posters = new Map()
  const materials = new Map()
  const geometries = new Map()
  const face = (slug, w, h) => {
    const poster = posters.get(slug)
    assert.ok(poster, `adFace: no decoded poster for ${slug}`)
    let material = materials.get(slug)
    if (!material) {
      material = new THREE.MeshBasicMaterial({ map: poster.texture })
      material.name = `streetPoster_${slug}`
      materials.set(slug, material)
    }
    const key = `${slug}@${w.toFixed(3)}x${h.toFixed(3)}`
    let geometry = geometries.get(key)
    if (!geometry) {
      geometry = croppedPlane(w, h, panelUvWindow(poster.aspect, w / h))
      geometries.set(key, geometry)
    }
    return { geometry, material }
  }
  const art = {
    async load() {},
    adFace: (slug, w, h) => face(slug, w, h),
    adWindow(w, h) {
      const slug = [...posters.keys()][0]
      return { ...face(slug, w, h), slug }
    },
    dispose() {},
  }
  return {
    art,
    async decode(slugs) {
      for (const slug of slugs) {
        if (posters.has(slug)) continue
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
        texture.name = `poster_${slug}`
        posters.set(slug, { texture, width: image.width, height: image.height, aspect: image.width / image.height })
      }
      return posters
    },
  }
}
const adArt = createAdArt()

/** The context the game's piece builders read, filled from the authored document. */
function context(cells = [], modules = DATA.modules, overrides = {}) {
  const data = { ...DATA, cells, modules }
  const ctx = {
    mats, data, ads: adArt.art, trackCells: new Set(),
    finish: (name) => FINISH[name] ?? mats.white,
    owned: [],
    ...overrides,
  }
  return ctx
}

/* -------------------------------------------------------------- room documents */

/**
 * The wall voxels a walled room needs before `RoomModel` can draw its 0.5 m
 * panels: every perimeter column solid on the three wall courses, minus the
 * opening cells the player cut. The panel finish names the face the room sees.
 */
function roomCells(mod, opening, colours) {
  const open = new Set(opening.map(([x, y]) => `${x},${y}`))
  const x1 = mod.x + mod.w - 1
  const y1 = mod.y + mod.h - 1
  const cells = []
  for (let x = mod.x; x <= x1; x++) {
    for (let y = mod.y; y <= y1; y++) {
      const perimeter = x === mod.x || x === x1 || y === mod.y || y === y1
      if (!perimeter || open.has(`${x},${y}`)) continue
      // The room's own inward faces carry the fit-out band: the north wall's
      // south face is the one seen through the shop front, so an opening reads
      // as a lit interior rather than a hole onto the slate backdrop.
      const finish = {
        n: colours.base, e: colours.base, s: colours.base, w: colours.base,
      }
      if (y === mod.y) finish.n = colours.south ?? colours.base
      if (y === y1) finish.s = colours.north ?? colours.base
      for (let dz = 1; dz <= 3; dz++) {
        cells.push({ x, y, z: mod.z + dz, fill: 'solid', finish })
      }
    }
  }
  return cells
}

/** Name a room's wall panels by the side they close, so a review can read an opening. */
function nameRoomWalls(built, width, height) {
  const counts = { south: 0, north: 0, west: 0, east: 0 }
  built.traverse(object => {
    if (!object.isMesh) return
    const at = object.position
    let side
    if (at.x < 0.51) side = 'west'
    else if (at.x > width - 0.51) side = 'east'
    else side = at.y < height / 2 ? 'south' : 'north'
    counts[side]++
    object.name = `wall-${side}-${String(counts[side]).padStart(2, '0')}`
  })
}

/* ------------------------------------------------------------------ exporters */

const out = resolve(process.argv[2] ?? '.preview/unity/fitout-proof/export')
await mkdir(out, { recursive: true })

/**
 * Expand every InstancedMesh into ordinary meshes, since GLTFExporter ignores
 * instance matrices. Instances are grouped by authored colour, transformed into
 * the batch's parent space, merged inside their batch and carried by a cloned
 * per-colour material named `<base>_<hex>`. Returns the colour mapping.
 */
function expandInstances(root) {
  const instanced = []
  root.traverse(object => { if (object.isInstancedMesh) instanced.push(object) })
  const baked = new Map()
  const matrix = new THREE.Matrix4(), local = new THREE.Matrix4(), colour = new THREE.Color()
  let instances = 0
  for (const mesh of instanced) {
    assert.ok(!Array.isArray(mesh.material), `${mesh.name}: instanced batches use one material`)
    assert.ok(mesh.count > 0, `${mesh.name}: empty instanced batch`)
    mesh.updateMatrix()
    const base = mesh.material
    const baseName = paletteNames.get(base) ?? base.name ?? 'stock'
    const groups = new Map()
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix)
      const hasColour = mesh.instanceColor !== null && mesh.instanceColor !== undefined
      if (hasColour) mesh.getColorAt(i, colour)
      else colour.setRGB(1, 1, 1)
      const hex = colour.getHexString()
      let group = groups.get(hex)
      if (!group) {
        group = { color: colour.clone(), geometries: [], triangles: 0 }
        groups.set(hex, group)
      }
      const geometry = mesh.geometry.clone()
      local.multiplyMatrices(mesh.matrix, matrix)
      geometry.applyMatrix4(local)
      group.geometries.push(geometry)
      group.triangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3
      instances++
    }
    const parent = mesh.parent
    assert.ok(parent, `${mesh.name}: instanced batch has no parent`)
    for (const [hex, group] of groups) {
      const key = `${base.uuid}|${hex}`
      let record = baked.get(key)
      if (!record) {
        const material = base.clone()
        material.name = `${baseName}_${hex}`
        material.color.copy(group.color)
        // Per-instance tint is baked into the cloned colour; the batch's texture
        // (a shelf goods sheet) stays attached where the base carried one.
        record = { color: hex, material, instances: 0, triangles: 0 }
        baked.set(key, record)
      }
      record.instances += group.geometries.length
      record.triangles += group.triangles
      const geometry = group.geometries.length === 1
        ? group.geometries[0]
        : mergeGeometries(group.geometries, false)
      assert.ok(geometry, `${mesh.name}: could not merge ${group.geometries.length} ${hex} instances`)
      if (group.geometries.length > 1) group.geometries.forEach(clone => clone.dispose())
      const replacement = new THREE.Mesh(geometry, record.material)
      replacement.name = `${mesh.name}_${hex}`
      parent.add(replacement)
    }
    parent.remove(mesh)
    mesh.geometry.dispose()
  }
  return [...baked.values()]
    .map(record => ({
      color: record.color,
      material: record.material.name,
      instances: record.instances,
      triangles: record.triangles,
    }))
    .sort((a, b) => (a.material < b.material ? -1 : a.material > b.material ? 1 : 0))
}

const anchors = {
  AxisX: [1, 0, 0],
  Front: [0, 1, 0],
  Up: [0, 0, 1],
  Approach: [0, -1, 0],
}

/** Name every mesh and material, strip renderer metadata, measure, export. */
async function finish(spec, built, extras = {}, options = {}) {
  const root = new THREE.Group()
  root.name = `${spec.prefab}Model`
  root.add(built)
  root.updateMatrixWorld(true)
  const raw = new THREE.Box3().setFromObject(built)
  if (options.floorAtZero !== false) built.position.z -= raw.min.z
  root.updateMatrixWorld(true)

  const instanceColors = expandInstances(built)
  root.updateMatrixWorld(true)

  const prefix = spec.prefab.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
  const used = new Map()
  // Named parts carry their own material name: a builder that mints a canvas for
  // one plate (the guidepost's faces, the shelter's paint) gets a semantic
  // material name instead of an index.
  const materialHints = new Map()
  root.traverse(object => {
    if (!object.isMesh || !object.name || object.name.startsWith(`${prefix}-part-`)) return
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (paletteNames.has(material) || material.name || materialHints.has(material)) continue
      materialHints.set(material, `${object.name}-material`)
    }
  })
  const parts = new Set()
  const textures = new Set()
  let meshCount = 0
  let triangles = 0
  let partIndex = 0
  const alphaMaterials = new Set()
  const glassMaterials = new Set()
  root.traverse(object => {
    object.userData = {}
    const mesh = object
    if (!mesh.isMesh) return
    meshCount++
    const count = mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count
    assert.ok(Number.isInteger(count) && count > 0, `${spec.prefab}: empty geometry on ${mesh.name || 'unnamed mesh'}`)
    triangles += count / 3
    if (!mesh.name) mesh.name = `${prefix}-part-${String(partIndex++).padStart(3, '0')}`
    parts.add(mesh.name)
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      let name = used.get(material)
      if (!name) {
        name = paletteNames.get(material) || material.name || materialHints.get(material)
        if (!name) name = `${prefix}-material-${String(used.size + 1).padStart(2, '0')}`
        // Two different materials may already share a palette-owned name; keep
        // both slots distinct and stable.
        if ([...used.values()].includes(name)) {
          let suffix = 2
          while ([...used.values()].includes(`${name}${suffix}`)) suffix++
          name = `${name}${suffix}`
        }
        used.set(material, name)
        material.name = name
      }
      if (material.transparent) alphaMaterials.add(name)
      if (name.toLowerCase().includes('glass')) glassMaterials.add(name)
      if (material.map) {
        textures.add(material.map)
        if (!material.map.name) material.map.name = `${name}-map`
      }
    }
  })
  assert.ok(meshCount > 0, `${spec.prefab}: exported no geometry`)
  assert.ok(Number.isInteger(triangles), `${spec.prefab}: triangle count is not an integer`)

  for (const [name, position] of Object.entries(anchors)) {
    const anchor = new THREE.Object3D()
    anchor.name = name
    anchor.position.fromArray(position)
    root.add(anchor)
  }

  const bounds = new THREE.Box3().setFromObject(root)
  const size = bounds.getSize(new THREE.Vector3())
  const materials = [...used.values()].sort()

  // A quick sanity check shared by every asset: the measured envelope has to be
  // a real three-dimensional object, and the builder's own origin has to be the
  // prefab's floor.
  assert.ok(size.x > 0.01 && size.y > 0.01 && size.z > 0.01, `${spec.prefab}: degenerate bounds`)
  assert.ok(Math.abs(bounds.min.z) < 1e-6, `${spec.prefab}: floor is not at z=0 (min z ${bounds.min.z})`)

  const gltfRoot = new THREE.Group()
  gltfRoot.name = spec.prefab
  // Source space is Z-up; the single export transform rotates it into glTF
  // Y-up, exactly as every other recipe does.
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

  const placementOffset = options.placementOffset ?? [0, 0, 0]
  const manifest = {
    schemaVersion: 1,
    id: spec.id,
    family: 'fitout',
    row: spec.row,
    kind: spec.kind,
    prefab: spec.prefab,
    file: spec.file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: spec.source,
    provenance: 'Repository procedural fit-out geometry, station-document canvases and one repository poster; no third-party assets',
    licenseRecord: 'Repository-authored procedural geometry and canvas art',
    units: 'metres',
    min: bounds.min.toArray(),
    max: bounds.max.toArray(),
    size: size.toArray(),
    triangles,
    meshes: meshCount,
    materials,
    parts: [...parts].sort(),
    alphaMaterials: [...alphaMaterials].sort(),
    glassMaterials: [...glassMaterials].sort(),
    textures: textures.size,
    roots: extras.roots ?? [spec.prefab],
    anchors,
    placementOffset,
    notes: extras.notes ?? '',
    adapter: extras.adapter ?? '',
    openingSide: extras.openingSide ?? '',
    openingX0: extras.openingX0 ?? 0,
    openingX1: extras.openingX1 ?? 0,
    openingWidth: extras.openingWidth ?? 0,
    openingCells: extras.openingCells ?? 0,
    stockColors: instanceColors,
    panels: extras.panels ?? [],
    cases: extras.cases ?? [],
    validation: { errors: report.issues.numErrors, warnings: report.issues.numWarnings },
  }
  assert.equal(manifest.alphaMaterials.length, manifest.alphaMaterials.filter(name => materials.includes(name)).length,
    `${spec.prefab}: alpha material not in the material set`)
  await writeFile(join(out, spec.file), bytes)
  await writeFile(join(out, spec.file.replace(/\.glb$/, '.manifest.json')), JSON.stringify(manifest, null, 2) + '\n')
  console.log(
    `${spec.id}: ${triangles} triangles, ${meshCount} meshes, ${materials.length} materials ` +
      `(${manifest.alphaMaterials.length} alpha), ${textures.size} textures, ` +
      `${size.x.toFixed(3)} x ${size.y.toFixed(3)} x ${size.z.toFixed(3)} m, ` +
      `${bytes.length} bytes, ${manifest.sha256}`,
  )
  return manifest
}

/* ------------------------------------------------------------------- assets */

const assets = []
const ASSET_SPECS = []

function spec(row, prefab, source) {
  const file = `${row}.glb`
  const entry = { id: `fitout.${row}`, row, prefab, file, source }
  ASSET_SPECS.push(entry)
  return entry
}

/* 1. shop-room ------------------------------------------------------------- */
{
  const s = spec('shop-room', 'ShopRoom', 'game/src/render/models/pieces/RoomModel.ts')
  const opening = [[2, 0], [3, 0]]
  const mod = { id: 'shop-room', type: 'shop', x: 0, y: 0, z: 0, w: 6, h: 4, cfg: { kind: 'store', door: opening } }
  const ctx = context(roomCells(mod, opening, { base: 'wall.plaster', north: 'wall.enamel' }))
  const built = buildModule(mod, ctx)
  assert.ok(built, 'shop-room: buildModule returned null')
  nameRoomWalls(built, mod.w, mod.h)
  const manifest = await finish(s, built, {
    openingSide: 'south',
    openingX0: 2,
    openingX1: 4,
    openingWidth: 2,
    openingCells: 2,
    cases: [{
      name: 'fitted-shop-shell',
      detail: 'store room 6 x 4 m with a two-cell open shop front on the south side; walls painted plaster with an enamel accent band',
      count: 2,
      widthMetres: 6,
      heightMetres: 3,
    }],
    notes: 'RoomModel draws the thin perimeter panels only where the document holds solid wall voxels; the opening is the two south columns the document leaves open. Shelves, counters and stock are separate furniture modules (the next three rows).',
  }, { floorAtZero: true })
  assets.push(manifest)
}

/* 2. retail-room ----------------------------------------------------------- */
{
  const s = spec('retail-room', 'RetailRoom', 'game/src/render/models/pieces/RoomModel.ts')
  const opening = [[1, 0], [2, 0]]
  // The authored retail shell: `type: 'retail'` is the document's store adapter,
  // and `buildModule` folds it onto the walled-room builder with the store fit-out.
  const mod = { id: 'retail-room', type: 'retail', x: 0, y: 0, z: 0, w: 5, h: 4, cfg: { kind: 'cafe' } }
  const ctx = context(roomCells(mod, opening, { base: 'wall.stainless', north: 'wall.enamel' }))
  const built = buildModule(mod, ctx)
  assert.ok(built, 'retail-room: buildModule returned null')
  nameRoomWalls(built, mod.w, mod.h)
  const manifest = await finish(s, built, {
    adapter: 'models.ts case retail -> RoomModel.build({ type: shop, cfg: { kind: store } }); the authored cfg.kind is intentionally overwritten, and the retail shell carries no cfg.door, so its opening is the absent wall columns',
    openingSide: 'south',
    openingX0: 1,
    openingX1: 3,
    openingWidth: 2,
    openingCells: 2,
    cases: [{
      name: 'authored-store-adapter',
      detail: 'retail shell 5 x 4 m authored with cfg.kind cafe; the adapter draws the store fit-out (stainless walls, enamel north band) and a two-cell south opening',
      count: 2,
      widthMetres: 5,
      heightMetres: 3,
    }],
  }, { floorAtZero: true })
  assets.push(manifest)
}

/* 3. ticket-booth ---------------------------------------------------------- */
{
  const s = spec('ticket-booth', 'TicketBooth', 'game/src/render/models/pieces/BoothModel.ts')
  const booth = { id: 'ticket-booth', type: 'booth', x: 0, y: 0, z: 0, w: 4, h: 3, cfg: { kind: 'ticket' } }
  const settled = settleSignLayout([
    { id: 'c1', kind: 'arrow', arrow: 'left', x: 0.3, y: 0.2, scale: 1, side: 'both' },
    { id: 'c2', kind: 'text', text: '售票处\nTickets', x: 1.0, y: 0.2, scale: 1, side: 'both' },
    { id: 'c3', kind: 'line', lineId: 'l1', english: true, x: 1.6, y: 0.2, scale: 1, side: 'both' },
    { id: 'c4', kind: 'icon', icon: 'customer-service', x: 2.2, y: 0.2, scale: 1, side: 'both' },
  ])
  const data = { ...DATA, modules: [booth] }
  const ctx = context([], [booth], {
    signFace(id, layout, face, panel) {
      const plate = signPlate(panel)
      const material = new THREE.MeshBasicMaterial({
        map: canvasTexture(plate.width, plate.height, g => drawSignPanel(g, layout, { lines: LINES, defaultLineId: 'l1', panel }, face)),
      })
      material.name = 'boothSignFace'
      ctx.owned.push(material)
      return material
    },
  })
  let sign = { id: 'booth-sign', type: 'sign', x: 0, y: 0, z: 0, rot: 0, cfg: { mount: 'wall', front: settled.layout } }
  sign = snapSignToBooth([booth], sign, [2, -0.1], 2.2, booth.id)
  const boards = mountedSignBoards(sign.cfg.mount, signBoardsOf(sign.cfg, data))
  const panel = signBoardsPanel(boards)
  assert.ok(panel.w <= booth.w - 0.36, `ticket-booth: sign panel ${panel.w} wider than the booth header`)
  const boothGroup = buildModule(booth, ctx)
  const signGroup = buildModule(sign, ctx)
  assert.ok(boothGroup, 'ticket-booth: booth builder returned null')
  assert.ok(signGroup, 'ticket-booth: sign builder returned null')
  // Name the mounted sheet so the review can find the dynamic sign in Unity.
  signGroup.traverse(object => {
    if (object.isMesh && object.material?.name === 'boothSignFace') object.name = 'booth-sign-sheet'
  })
  assert.ok([...signGroup.children].length > 0, 'ticket-booth: sign group is empty')
  const built = new THREE.Group()
  built.name = 'ticket-booth'
  built.add(boothGroup, signGroup)
  const manifest = await finish(s, built, {
    roots: ['ticket-booth'],
    openingSide: 'front',
    openingX0: 0,
    openingX1: 4,
    openingWidth: 4,
    cases: [{
      name: 'glazed-ticket-kiosk',
      detail: `glazed ticket kiosk 4 x 3 m, front transfer gap under the 1.04 m glazing sill, wall sign ${panel.w.toFixed(2)} x ${panel.h.toFixed(2)} m with authored label 售票处 / Tickets`,
      count: 2,
      widthMetres: panel.w,
      heightMetres: panel.h,
    }],
    notes: 'The booth is the 售票亭 shell; its service glazing leaves the front transfer gap open. The sign is the separate authored 指示牌 module snapped to the booth header (sim/boothSigns.ts), drawn by render/signFace.ts from the station lines.',
  }, { floorAtZero: true })
  assets.push(manifest)
}

/* 4. shop-shelves ---------------------------------------------------------- */
{
  const s = spec('shop-shelves', 'ShopShelves', 'game/src/render/models/pieces/ShopShelves.ts')
  const variant = 'food-snacks'
  const mod = { id: 'shop-shelves', type: 'shelf', x: 0, y: 0, z: 0, rot: 0, w: 1, cfg: { variant } }
  const ctx = context([], [])
  const built = buildModule(mod, ctx)
  assert.ok(built, 'shop-shelves: buildModule returned null')
  const values = shelfSpec(variant)
  const manifest = await finish(s, built, {
    cases: [{
      name: 'food-snacks-run',
      detail: `one-cell ${variant} run stocked from ShopShelves/ShopStock; shopping face local -y`,
      count: 1,
      widthMetres: 0.96,
      heightMetres: values.height,
    }],
    notes: 'Room furniture, not a catalogue recipe: the same ShelfModel dispatch the room fit-out uses, standing on its anchor-cell edge.',
  }, { floorAtZero: true, placementOffset: [0.5, 1 - values.depth / 2, 0] })
  assets.push(manifest)
}

/* 5. shop-counter ---------------------------------------------------------- */
{
  const s = spec('shop-counter', 'ShopCounter', 'game/src/render/models/pieces/ShopCounter.ts')
  const variant = 'generic'
  const mod = { id: 'shop-counter', type: 'checkout', x: 0, y: 0, z: 0, rot: 0, w: 2, cfg: { variant } }
  const ctx = context([], [])
  const built = buildModule(mod, ctx)
  assert.ok(built, 'shop-counter: buildModule returned null')
  const manifest = await finish(s, built, {
    cases: [{
      name: 'generic-two-cell-run',
      detail: `generic store counter, ${counterLength(2)} cells (2.0 m run), customer side local -y; worktop, rear doors, POS screen and payment reader`,
      count: 2,
      widthMetres: 2,
      heightMetres: 1.4,
    }],
    notes: 'Room counter: the 收银台 piece the room fit-out places, not the customer checkout lane.',
  }, { floorAtZero: true, placementOffset: [0.5, 0.5, 0] })
  assets.push(manifest)
}

/* 6. shop-stock ------------------------------------------------------------ */
{
  const s = spec('shop-stock', 'ShopStock', 'game/src/render/models/pieces/ShopStock.ts')
  const fixtures = [
    { tag: 'snacks', variant: 'food-snacks', x: 0 },
    { tag: 'fruit', variant: 'fruit-island', x: 2 },
    { tag: 'cafe', variant: 'cafe-backbar', x: 4 },
    { tag: 'clothing', variant: 'clothing-rail', x: 6 },
  ]
  const ctx = context([], [])
  const built = new THREE.Group()
  built.name = 'shop-stock'
  const cases = []
  for (const fixture of fixtures) {
    const mod = {
      id: `stock-${fixture.tag}`, type: 'shelf', x: fixture.x, y: 0, z: 0, rot: 0, w: 1,
      cfg: { variant: fixture.variant },
    }
    const group = buildModule(mod, ctx)
    assert.ok(group, `shop-stock: ${fixture.variant} builder returned null`)
    group.updateMatrixWorld(true)
    let batches = 0
    group.traverse(object => {
      if (!object.isInstancedMesh || !object.name.startsWith('stock-')) return
      const clone = new THREE.InstancedMesh(object.geometry, object.material, object.count)
      const matrix = new THREE.Matrix4(), colour = new THREE.Color()
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, matrix)
        clone.setMatrixAt(i, matrix)
        if (object.instanceColor) { object.getColorAt(i, colour); clone.setColorAt(i, colour) }
      }
      const world = new THREE.Matrix4()
      object.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale)
      world.identity()
      clone.name = `stock-${fixture.tag}-${object.name.replace(/^stock-/, '')}`
      clone.instanceMatrix.needsUpdate = true
      if (clone.instanceColor) clone.instanceColor.needsUpdate = true
      built.add(clone)
      batches++
    })
    assert.ok(batches > 0, `shop-stock: ${fixture.variant} produced no stock batches`)
    cases.push({
      name: `stock-${fixture.tag}`,
      detail: `${fixture.variant} stock batches lifted from the room fit-out`,
      count: batches,
      widthMetres: 0,
      heightMetres: 0,
    })
  }
  const manifest = await finish(s, built, {
    cases,
    notes: 'The shelf stock itself: the InstancedMesh batches ShopStock.stockBatch writes, extracted from four ShopShelves fit-outs so boxes, spheres, cylinders, bananas and shirts are all present, then expanded to per-colour meshes for glTF.',
  }, { floorAtZero: true })
  assets.push(manifest)
}

/* 7. street-arrow-markings -------------------------------------------------- */
{
  const s = spec('street-arrow-markings', 'StreetArrows', 'game/src/render/models/pieces/RoadArrowMarking.ts')
  const built = new THREE.Group()
  built.name = 'street-arrows'
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x3b3f45, roughness: 0.96 })
  asphalt.name = 'asphalt'
  // A 2-lane x 8 m strip of road paint, drawn with the same function the road
  // mesh uses; each case is one movement set on its own lane.
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(9, 5), asphalt)
  surface.name = 'street-surface'
  surface.position.set(0, 0, 0)
  built.add(surface)
  const arrows = [
    { name: 'road-arrow-straight', turns: ['straight'], x: -2.7, y: 0, axis: true, sign: 1, scale: 1 },
    { name: 'road-arrow-left-through', turns: ['left', 'straight'], x: -0.9, y: 0, axis: true, sign: 1, scale: 1 },
    { name: 'road-arrow-right-through', turns: ['right', 'straight'], x: 0.9, y: 0, axis: true, sign: 1, scale: 0.9 },
    { name: 'road-arrow-three-way', turns: ['left', 'straight', 'right'], x: 2.7, y: 0, axis: true, sign: 1, scale: 0.8 },
  ]
  const cases = []
  for (const arrow of arrows) {
    const mesh = roadArrowMarking(mats.white, arrow.turns, arrow.x, arrow.y, 0.02, arrow.axis, arrow.sign, arrow.scale)
    mesh.name = arrow.name
    built.add(mesh)
    cases.push({
      name: arrow.name,
      detail: `${arrow.turns.join('+')} / axis ${arrow.axis ? 'x' : 'y'} / sign ${arrow.sign} / scale ${arrow.scale}`,
      count: arrow.turns.length,
      widthMetres: arrow.scale,
      heightMetres: 0,
    })
  }
  const manifest = await finish(s, built, {
    cases,
    notes: 'Direction arrows painted by RoadArrowMarking: a flat triangulated shaft plus one head per permitted movement, on a 9 x 5 m asphalt sample. Arrow placement from junction movements itself is runtime (RoadModel).',
  }, { floorAtZero: true })
  assets.push(manifest)
}

/* 8. street-decor ----------------------------------------------------------- */
{
  const s = spec('street-decor', 'StreetDecor', 'game/src/render/models/pieces/StreetDecorModel.ts')
  const posterSlugs = panelPosters(SLUG, ['landscape', 'portrait']).map(entry => entry.slug)
  await adArt.decode([...posterSlugs, SLUG])
  const busstop = { id: 'street-busstop', type: 'busstop', x: 0, y: 0, z: 0, rot: 0, w: 4, cfg: { variant: 'short', poster: SLUG } }
  const guidepost = { id: 'street-guidepost', type: 'guidepost', x: 5, y: 0, z: 0, rot: 0, w: 1, cfg: { exitId: EXIT.id } }
  const data = { ...DATA, modules: [EXIT, busstop, guidepost] }
  const ctx = context([], data.modules)
  const bus = buildModule(busstop, ctx)
  const guide = buildModule(guidepost, ctx)
  assert.ok(bus, 'street-decor: busstop builder returned null')
  assert.ok(guide, 'street-decor: guidepost builder returned null')
  // The shelter mints its two paint materials per build; name them by colour so
  // the review can tell the canopy from the cabinet.
  const shelterPaint = new Map([[0x18574d, 'shelterGreen'], [0xd8d9c5, 'shelterCream']])
  bus.traverse(object => {
    if (!object.isMesh) return
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material.name || paletteNames.has(material)) continue
      material.name = shelterPaint.get(material.color?.getHex()) ?? 'shelterPaint'
    }
  })
  bus.name = 'street-busstop'
  guide.name = 'street-guidepost'
  const built = new THREE.Group()
  built.name = 'street-decor'
  built.add(bus, guide)
  const posters = posterSlugs
  const manifest = await finish(s, built, {
    roots: ['street-busstop', 'street-guidepost'],
    cases: [
      { name: 'bus-shelter', detail: `short 公交站 with route-information board and ${posters.length} authored campaign posters (${posters.join(', ')})`, count: posters.length, widthMetres: 4, heightMetres: 3 },
      { name: 'guidepost', detail: 'default Guangzhou 出入口 guidepost reading station 体育西路 and exit A口', count: 1, widthMetres: 1.14, heightMetres: 4 },
    ],
    notes: 'Roadside details from StreetDecorModel: the shelter prints the station name on its route board and one campaign per display from the authored cfg.poster; the guidepost prints the station, exit and line identity from the same document.',
  }, { floorAtZero: true })
  assets.push(manifest)
}

/* 9. dynamic-station-panels -------------------------------------------------- */
{
  const s = spec('dynamic-station-panels', 'StationPanels', 'game/src/render/panelAtlas.ts + render/signFace.ts + render/lineMapFace.ts + render/stationDisplay.ts')
  // The four authored sources, each drawn at the panel's own resolution. They
  // are the pixels the game's sign editor, line-map board, poster plate and TV
  // display print; PanelAtlas packs them on one page and the panels share it.
  const settled = settleSignLayout([
    { id: 'c1', kind: 'arrow', arrow: 'left', x: 0.3, y: 0.2, scale: 1, side: 'both' },
    { id: 'c2', kind: 'text', text: '往 1号线\nTo Line 1', x: 1.0, y: 0.2, scale: 1, side: 'both' },
    { id: 'c3', kind: 'line', lineId: 'l1', english: true, x: 1.7, y: 0.2, scale: 1, side: 'both' },
    { id: 'c4', kind: 'icon', icon: 'customer-service', x: 2.3, y: 0.2, scale: 1, side: 'both' },
    { id: 'c5', kind: 'arrow', arrow: 'up-right', x: 2.8, y: 0.2, scale: 1, side: 'both' },
  ])
  const signPanel = settled.panel
  const signPx = signPlate(signPanel)
  const signCanvas = document.createElement('canvas')
  signCanvas.width = signPx.width
  signCanvas.height = signPx.height
  drawSignPanel(signCanvas.getContext('2d'), settled.layout, { lines: LINES, defaultLineId: 'l1', panel: signPanel }, 'both')

  const mapPanel = { w: LINE_MAP_PANEL_W, h: LINE_MAP_PANEL_H }
  const mapPx = lineMapPlaceholderPlate(mapPanel)
  const mapCanvas = document.createElement('canvas')
  mapCanvas.width = mapPx.width
  mapCanvas.height = mapPx.height
  drawLineMapPlaceholder(mapCanvas.getContext('2d'), { lines: LINES, stationName: DATA.name, panel: mapPanel })

  await adArt.decode([SLUG])
  const posterImage = await loadImage(new URL(`${SLUG}.webp`, POSTER_DIR))
  const posterCanvas = document.createElement('canvas')
  posterCanvas.width = posterImage.width
  posterCanvas.height = posterImage.height
  posterCanvas.getContext('2d').drawImage(posterImage, 0, 0)

  const displayCanvas = document.createElement('canvas')
  displayCanvas.width = 960
  displayCanvas.height = 540
  drawStationDisplay(displayCanvas.getContext('2d'), {
    name: LINES[0].name, colour: LINES[0].colour, terminus: '西站',
    arrivals: [
      { minutes: 2, atPlatform: false, arriving: false },
      { minutes: 4, atPlatform: false, arriving: true },
      { minutes: 7, atPlatform: true, arriving: false },
    ],
  }, DATA.name, '12:34', '11月11日')

  const atlas = new PanelAtlas(2048)
  const sources = [
    { name: 'panel-edited-sign', canvas: signCanvas, width: signPanel.w, height: signPanel.h, detail: 'authored 指示牌 face: two arrows, the edited label 往 1号线 / To Line 1, the line shield and a customer-service mark' },
    { name: 'panel-route-map', canvas: mapCanvas, width: mapPanel.w, height: mapPanel.h, detail: '线网图 board drawn from the station lines (2 lines, 3 stations, interchange ring at 体育西路)' },
    { name: 'panel-poster', canvas: posterCanvas, width: 1.6, height: 0.9, detail: `repository campaign poster ${SLUG}` },
    { name: 'panel-display', canvas: displayCanvas, width: 1.6, height: 0.9, detail: 'TV passenger-information board: three service cards, station name and clock' },
  ]
  const built = new THREE.Group()
  built.name = 'station-panels'
  const panels = []
  const gap = 0.3
  let cursor = 0
  let atlasMaterial = null
  for (const source of sources) {
    const texture = new THREE.CanvasTexture(source.canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 1
    texture.name = `${source.name}-source`
    const entryMaterial = new THREE.MeshBasicMaterial({ map: texture })
    entryMaterial.name = `${source.name}-source`
    const region = atlas.resolve(entryMaterial)
    assert.ok(region, `${source.name}: PanelAtlas refused the source`)
    if (!atlasMaterial) {
      atlasMaterial = region.material
      atlasMaterial.name = 'panelAtlas'
    }
    assert.equal(region.material, atlasMaterial, `${source.name}: source was packed into a second atlas material`)
    const height = source.height
    const bottom = 1.25
    const x = cursor + source.width / 2
    const backing = new THREE.Mesh(new THREE.BoxGeometry(source.width + 0.06, 0.06, height + 0.06), mats.darkSteel)
    backing.name = `${source.name}-backing`
    backing.position.set(x, 0.04, bottom + height / 2)
    built.add(backing)
    const geometry = new THREE.PlaneGeometry(source.width, height)
    atlasUV(geometry, region)
    const plane = new THREE.Mesh(geometry, region.material)
    plane.name = source.name
    plane.position.set(x, -0.02, bottom + height / 2)
    plane.rotation.order = 'ZXY'
    plane.rotation.set(Math.PI / 2, 0, 0)
    built.add(plane)
    panels.push({
      name: source.name,
      detail: source.detail,
      u: region.u,
      v: region.v,
      w: region.w,
      h: region.h,
      widthMetres: source.width,
      heightMetres: source.height,
    })
    cursor += source.width + gap
  }
  const atlasMap = atlasMaterial.map
  atlasMap.name = 'panelAtlasPage0'
  assert.equal(atlas.size, 2048, 'dynamic-station-panels: unexpected atlas page size')
  const manifest = await finish(s, built, {
    panels,
    cases: panels.map(panel => ({
      name: panel.name,
      detail: panel.detail,
      count: 1,
      widthMetres: panel.widthMetres,
      heightMetres: panel.heightMetres,
    })),
    notes: `PanelAtlas packed ${panels.length} authored sources on one ${atlas.size} px page; every panel shares the page texture through a distinct UV window, which is the runtime atlas contract. Live repaint/rebinding and per-slot patching stay runtime work.`,
  }, { floorAtZero: true })
  assets.push(manifest)
}

/* ------------------------------------------------------------------- summary */

const summary = {
  schemaVersion: 1,
  family: 'fitout',
  sourcePaths: [
    'game/src/render/models/pieces/RoomModel.ts',
    'game/src/render/models/pieces/BoothModel.ts',
    'game/src/render/models/pieces/ShopShelves.ts',
    'game/src/render/models/pieces/ShopCounter.ts',
    'game/src/render/models/pieces/ShopStock.ts',
    'game/src/render/models/pieces/RoadArrowMarking.ts',
    'game/src/render/models/pieces/StreetDecorModel.ts',
    'game/src/render/panelAtlas.ts',
    'game/src/render/signFace.ts',
    'game/src/render/lineMapFace.ts',
    'game/src/render/stationDisplay.ts',
    'game/src/render/models/PieceBuilder.ts',
    'game/src/render/models.ts',
    'game/src/sim/boothSigns.ts',
    'game/src/sim/sign.ts',
    'game/src/sim/shelves.ts',
    'game/src/sim/counters.ts',
    'game/src/sim/roads.ts',
    'game/src/sim/roadLaneMovements.ts',
  ],
  parameters: {
    models: assets.length,
    stationDocument: 'authored review document: 体育西路 / Tiyu Xilu (Guangzhou), two lines (1号线 #f0c000 and 2号线 #1f6fd6) each with three stations, one exit A口. Room wall cells, booth and sign modules are authored per row.',
    dimensions: 'metres; source Z-up tree wrapped in a group rotated -90 degrees about X (glTF Y-up); Unity wrapper applies the 180-degree Y correction so gameplay channels read (x, z, y)',
    seeding: 'Math.random is replaced with a fixed-seed generator before the palette prints its 64 px brushed-steel canvas, so every repeat export is byte-identical',
    encoding: 'every canvas encode runs on one serialised chain because GLTFExporter reuses one module-level canvas and records bufferViews in encode-completion order',
    naming: 'every mesh, material and texture is named; unnamed builder slabs become <prefab>-part-NNN in traversal order, per-colour stock materials are <base>_<hex>, and the atlas page is panelAtlasPage0',
    instancing: 'every THREE.InstancedMesh is expanded before export: instances grouped by authored colour, transformed, merged with BufferGeometryUtils.mergeGeometries inside their batch, carried by a cloned per-colour material',
    textures: 'one repository poster per authored campaign; the station-document canvases are the game\'s own sign, line-map and TV printers; the panel row is one 2048 px PanelAtlas page',
    runtime: 'room wall cells, booth sign binding, poster campaigns and panel content are authored snapshots. Dynamic panel repainting/rebinding, stock replenishment and street placement from the road network are runtime work recorded in the row report',
  },
  assets,
  validation: {
    errors: assets.reduce((sum, asset) => sum + asset.validation.errors, 0),
    warnings: assets.reduce((sum, asset) => sum + asset.validation.warnings, 0),
  },
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(`FITOUT_EXPORT_OK ${assets.length} models, ${summary.validation.errors} errors, ${summary.validation.warnings} warnings -> ${out}`)



