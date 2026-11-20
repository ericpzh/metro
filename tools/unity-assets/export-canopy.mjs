import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Canvas, ImageData, createCanvas, loadImage } from '@napi-rs/canvas'
import validator from 'gltf-validator'

// The canopy family: the eleven overhead / street pieces the station palette
// offers around a bay — the flat roof tile, the four supported roof variants
// (shell, canopy, tapered truss, open truss), the two platform-screen end infills
// and their white cover course, the two 公交站 shelters and the two signal heads.
//
// Every asset is the game's own builder output for one placed module at a stable
// local origin, in an empty station document: no neighbours, no slab overhead and
// no line, so the pieces take their standalone placement and the PSD end panel is
// the infill course itself rather than a corner joint.
//
// The palette's steel map is a 64 px brushed canvas; the proof exports the same
// authored steel colour (0xb7bdc4) as a solid material, so the only textures in
// the family are the two canvases a 公交站 prints for itself (its 线路信息板 route
// board and the campaign on its lightboxes). That keeps the shelter's two maps
// and leaves every roof, screen and signal texture-free.
let seed = 0x9e3779b9
Math.random = () => {
  seed = (seed + 0x6d2b79f5) >>> 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// The palette prints its canvas textures through the DOM. Shadow `data` or
// GLTFExporter treats every canvas as a DataTexture and writes transparent black.
globalThis.HTMLCanvasElement = Canvas
globalThis.ImageData = ImageData
// GLTFExporter reuses one module-level 2D canvas for every image and records the
// bufferView in encode-completion order, so two encodes in flight at once would
// race in both content and order. Serialise every canvas encode on one chain; a
// 公交站 prints two maps per build (route board + campaign), so the chain is what
// keeps the two exports byte-identical.
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
// Imported after the seeded Math.random so the palette's brushed-steel grain is
// identical in every run (the grain is dropped below, but the palette still draws
// it while it builds).
const { createModelMaterials, C } = await import('../../game/src/render/models/PieceBuilder.ts')
const { createModule } = await import('../../game/src/build/model/Equipment.ts')
const { buildModule } = await import('../../game/src/render/models.ts')
const { croppedPlane, panelUvWindow } = await import('../../game/src/render/panelUv.ts')
const { AD_POSTERS } = await import('../../game/src/sim/billboards.ts')

/**
 * The eleven family models, in review-row order.
 *
 * `cells` is the tile width `createModule` anchors the piece on (the supported
 * roof bay is four cells; the plain roof tile is one), `size` the source-space
 * bounds this recipe expects, `triangles` the exact full-detail triangle count.
 */
const MODELS = [
  {
    paletteId: 'roof',
    prefab: 'Roof',
    id: 'station.roof.flat',
    variant: null,
    type: 'roof',
    cells: 1,
    width: 1,
    psd: '',
    cover: false,
    size: [1, 1, 0.25],
    minZ: 5,
    triangles: 12,
    anchorFace: 'the ceiling tile hangs above the cell floor; its own front is local -y',
  },
  {
    paletteId: 'roof-canopy',
    prefab: 'RoofCanopy',
    id: 'station.roof.canopy',
    variant: 'canopy',
    type: 'roof',
    cells: 4,
    width: 4,
    psd: '',
    cover: false,
    size: [4, 4.01, 5.0],
    minZ: 0,
    triangles: 840,
    anchorFace: 'the posted shelter spans four bays; its open front is local -y',
  },
  {
    paletteId: 'roof-shell',
    prefab: 'RoofShell',
    id: 'station.roof.shell',
    variant: 'shell',
    type: 'roof',
    cells: 4,
    width: 4,
    psd: '',
    cover: false,
    size: [4, 4.01, 0.98],
    minZ: 9.0185,
    triangles: 24,
    anchorFace: 'the shell is only its two pitched sheets, hung a storey above the bay; front local -y',
  },
  {
    paletteId: 'roof-tapered',
    prefab: 'RoofTapered',
    id: 'station.roof.tapered',
    variant: 'tapered-truss',
    type: 'roof',
    cells: 4,
    width: 4,
    psd: '',
    cover: false,
    size: [4, 4.01, 5.0],
    minZ: 5,
    triangles: 396,
    anchorFace: 'the tapered truss hangs a storey above the bay; front local -y',
  },
  {
    paletteId: 'roof-truss',
    prefab: 'RoofTruss',
    id: 'station.roof.truss',
    variant: 'truss',
    type: 'roof',
    cells: 4,
    width: 4,
    psd: '',
    cover: false,
    size: [4, 4.01, 5.0],
    minZ: 5,
    triangles: 264,
    anchorFace: 'the open truss hangs a storey above the bay; front local -y',
  },
  {
    paletteId: 'psd-end',
    prefab: 'PsdEnd',
    id: 'station.psd-end.standard',
    variant: null,
    type: 'psd-end',
    cells: 1,
    width: 1,
    psd: 'half',
    cover: false,
    size: [1, 0.249, 2.45],
    minZ: 0,
    triangles: 114,
    anchorFace: 'the screen glass faces the track on local -y; the platform is local +y',
  },
  {
    paletteId: 'psd-end-cover',
    prefab: 'PsdEndCover',
    id: 'station.psd-end.cover',
    variant: 'cover',
    type: 'psd-end',
    cells: 1,
    width: 1,
    psd: 'full',
    cover: true,
    size: [1, 0.24, 1.0],
    minZ: 0,
    triangles: 12,
    anchorFace: 'the white cover course sits on the screen line at local -y depth 0.34',
  },
  {
    paletteId: 'busstop-long',
    prefab: 'BusstopLong',
    id: 'station.busstop.long',
    variant: 'long',
    type: 'busstop',
    cells: 8,
    width: 8,
    psd: '',
    cover: false,
    size: [7.88, 1.88, 3.0],
    minZ: 0,
    triangles: 372,
    anchorFace: 'the shelter opens on local -y and backs onto the 2 m deep verge',
  },
  {
    paletteId: 'busstop-short',
    prefab: 'BusstopShort',
    id: 'station.busstop.short',
    variant: 'short',
    type: 'busstop',
    cells: 4,
    width: 4,
    psd: '',
    cover: false,
    size: [3.88, 1.88, 3.0],
    minZ: 0,
    triangles: 260,
    anchorFace: 'the shelter opens on local -y and backs onto the 2 m deep verge',
  },
  {
    paletteId: 'traffic-light',
    prefab: 'TrafficLight',
    id: 'station.traffic-light.standard',
    variant: null,
    type: 'traffic-light',
    cells: 1,
    width: 1,
    psd: '',
    cover: false,
    size: [0.42, 0.52, 3.5],
    minZ: 0,
    triangles: 108,
    anchorFace: 'the three lenses face local -y',
  },
  {
    paletteId: 'rail-signal',
    prefab: 'RailSignal',
    id: 'station.rail-signal.standard',
    variant: null,
    type: 'rail-signal',
    cells: 1,
    width: 1,
    psd: '',
    cover: false,
    size: [0.29, 0.29, 1.0],
    minZ: 0,
    triangles: 708,
    anchorFace: 'the three hooded aspects face local -y',
  },
].map(spec => ({ ...spec, file: `${spec.paletteId}.glb` }))

/** The station storey every piece stands in; the roof mounts above it. */
const STOREY_HEIGHT = 5
/** `sim/structures.ts`: the supported roof bay and the truss eave above z=0. */
const ROOF_BAY = 4
const TRUSS_ROOF_EAVE = 9
const CANOPY_ROOF_DROP = 5
/** `sim/constants.ts`: the half-height screen course and the full-height glass. */
const PSD_HALF_HEIGHT = 1.45
const PSD_FULL_HEIGHT = 3
/** `sim/finishes.ts`: floor.concrete's authored tint, the default roof finish. */
const FINISH_CONCRETE = 0x8d9299

/**
 * The factory palette, minus its brushed-steel grain.
 *
 * `createModelMaterials()` brushes `steel` with a 64 px canvas and sets its colour
 * white, so the map is what carries the grey. The proof exports the same authored
 * colour as a solid material: a roof truss and a shelter seat do not need the
 * grain, and without it the family's only textures are the two canvases a 公交站
 * prints. Every other slot is the palette's own material, named from the palette
 * entry it came from.
 */
const mats = createModelMaterials()
mats.steel.map?.dispose()
mats.steel.map = null
mats.steel.color.setHex(C.steel)
mats.steel.needsUpdate = true
/** The floor finish the roof sheets, PSD foundation and signal plinth wear. */
const concrete = new THREE.MeshStandardMaterial({ color: FINISH_CONCRETE, roughness: 0.9, metalness: 0.05, name: 'concrete' })
const paletteNames = new Map(Object.entries(mats).map(([name, material]) => [material, name]))
paletteNames.set(concrete, 'concrete')

/** Empty station document: no neighbours, no slab overhead, no line. */
const data = { cells: [], modules: [], lines: [], name: 'Station', nameEn: 'Station' }

/**
 * A 公交站 prints one campaign on its lightboxes. The game's `panelPosters` gives
 * every panel its own poster; the proof freezes the catalogue's first landscape
 * campaign as one shared plate, cropped per panel, so the shelter carries exactly
 * the two canvas maps it is reviewed for (its route board and this artwork).
 */
const POSTER_SLUG = AD_POSTERS.find(poster => poster.shapes.includes('landscape'))?.slug
assert.ok(POSTER_SLUG, 'the poster catalogue has no landscape campaign')

async function decodePoster(slug) {
  const image = await loadImage(new URL(`../../game/src/assets/posters/${slug}.webp`, import.meta.url))
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const g = canvas.getContext('2d')
  assert.ok(g, `${slug}: no 2-D context for the poster canvas`)
  g.drawImage(image, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 1
  return { slug, texture, imageAspect: image.width / image.height, width: image.width, height: image.height }
}

const poster = await decodePoster(POSTER_SLUG)

/** The `AdArt` contract a headless build supplies: one shared campaign plate. */
function createAdArt(campaign) {
  let material
  const geometries = new Map()
  return {
    async load() {},
    adFace(_slug, w, h) {
      if (!material) {
        material = new THREE.MeshBasicMaterial({ map: campaign.texture, side: THREE.FrontSide, name: 'busstopPoster' })
      }
      const key = `${w.toFixed(3)}x${h.toFixed(3)}`
      let geometry = geometries.get(key)
      if (!geometry) {
        geometry = croppedPlane(w, h, panelUvWindow(campaign.imageAspect, w / h))
        geometries.set(key, geometry)
      }
      return { geometry, material }
    },
    adWindow(w, h) {
      return { ...this.adFace(campaign.slug, w, h), slug: campaign.slug }
    },
    dispose() {},
  }
}

const ads = createAdArt(poster)

const out = resolve(process.argv[2] ?? '.preview/unity/canopy-proof/export')
await mkdir(out, { recursive: true })

const assets = []
for (const spec of MODELS) {
  const owned = []
  const ctx = {
    mats,
    data,
    ads,
    trackCells: new Set(),
    finish: (id) => (id === 'floor.concrete' ? concrete : mats.darkSteel),
    owned,
  }
  const mod = createModule(spec.paletteId, 0, 0, 0, `proof-${spec.paletteId}`, 0, spec.width)
  assert.ok(mod, `${spec.paletteId}: createModule returned null`)
  assert.equal(mod.type, spec.type, `${spec.paletteId}: expected a ${spec.type} module, got ${mod.type}`)
  const variant = 'variant' in mod.cfg ? mod.cfg.variant ?? null : null
  assert.equal(variant, spec.variant, `${spec.paletteId}: builder variant ${variant}`)
  if (spec.type === 'roof') {
    assert.equal(mod.w, spec.cells, `${spec.paletteId}: expected a ${spec.cells}-cell piece, got w=${mod.w}`)
    assert.equal(mod.d, spec.cells, `${spec.paletteId}: expected a ${spec.cells} m deep bay, got d=${mod.d}`)
  }
  if (spec.type === 'busstop') assert.equal(mod.w, spec.cells, `${spec.paletteId}: expected a ${spec.cells}-cell run, got w=${mod.w}`)
  if (spec.type === 'psd-end') assert.equal(mod.cfg.psd, spec.psd, `${spec.paletteId}: screen height ${mod.cfg.psd}`)
  const root = buildModule(mod, ctx)
  assert.ok(root, `${spec.paletteId}: buildModule returned null`)

  // The builders own the shelter's two materials and the route-board print. Name
  // them by authored colour / map so the material set is deterministic and Unity
  // can assert each queue by name.
  for (const material of owned) {
    if (material.map) material.name = 'busstopRouteBoard'
    else if (material.color?.getHex() === 0x18574d) material.name = 'busstopGreen'
    else if (material.color?.getHex() === 0xd8d9c5) material.name = 'busstopCream'
    assert.ok(material.name, `${spec.paletteId}: unnamed builder material ${material.type}`)
  }

  // `placeLocal` puts a piece at (x+0.5, y+0.5, z+1) — the PSD course stands on
  // the cell floor instead. Export from a stable local origin and record the
  // offset once.
  const placementOffset = root.position.toArray()
  // A shelter's saved coordinates already include the palette's centre-to-origin shift.
  if (spec.type === 'busstop') {
    placementOffset[0] -= mod.x
    placementOffset[1] -= mod.y
  }
  root.position.set(0, 0, 0)
  root.rotation.set(0, 0, 0)
  root.updateMatrixWorld(true)

  // Source-space bounds, before the glTF Z-up -> Y-up wrapper. Roofs are hung
  // overhead, so their box starts at z=5 or z=9 while the anchors below stay on
  // the cell floor.
  const bounds = new THREE.Box3().setFromObject(root)
  const size = bounds.getSize(new THREE.Vector3())
  const close = (actual, expected) => Math.abs(actual - expected) < 0.006
  assert.ok(close(size.x, spec.size[0]) && close(size.y, spec.size[1]) && close(size.z, spec.size[2]),
    `${spec.paletteId}: bounds ${size.toArray().map(v => v.toFixed(4))} != ${spec.size}`)
  assert.ok(close(bounds.min.z, spec.minZ), `${spec.paletteId}: bounds start at z=${bounds.min.z.toFixed(4)}, expected ${spec.minZ}`)

  // Basis anchors at the module origin: the cell floor for the hung roofs, the
  // standing point for every other piece. They hang off a wrapper group rather
  // than the built group because the 轨旁信号 scales its own root to
  // RAIL_SIGNAL_SCALE and an anchor inside it would inherit that scale.
  const anchorRoot = new THREE.Group()
  anchorRoot.add(root)
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
    anchorRoot.add(anchor)
  }

  const used = new Map()
  const named = new Set()
  const alphaMaterials = new Set()
  const glassMaterials = new Set()
  const textures = new Set()
  let triangles = 0
  let meshes = 0
  root.traverse(object => {
    object.userData = {}
    if (object.isInstancedMesh) assert.fail(`${spec.paletteId}: InstancedMesh survived the builder`)
    if (!object.isMesh) return
    meshes++
    triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      let name = used.get(material)
      if (!name) {
        name = paletteNames.get(material) ?? material.name
        assert.ok(name, `${spec.paletteId}: unnamed material ${material.type} #${material.color?.getHexString()}`)
        if (named.has(name) && paletteNames.get(material) !== name) {
          let suffix = 2
          while (named.has(`${name}${suffix}`)) suffix++
          name = `${name}${suffix}`
        }
        used.set(material, name)
        named.add(name)
        material.name = name
      }
      if (material.transparent) alphaMaterials.add(name)
      if (name.toLowerCase().includes('glass')) glassMaterials.add(name)
      if (material.map) textures.add(material.map)
    }
  })
  assert.equal(Number.isInteger(triangles), true, `${spec.paletteId}: triangle count is not an integer`)
  assert.equal(triangles, spec.triangles, `${spec.paletteId}: expected ${spec.triangles} triangles, got ${triangles}`)

  const materials = [...used.values()].sort()
  const footprint = {
    cells: spec.cells,
    bayWidthMetres: spec.type === 'roof' ? spec.cells : 0,
    storeyHeightMetres: STOREY_HEIGHT,
    // A roof hangs above its supporting storey's slab; every other piece stands
    // on the cell floor.
    ceilingHeightMetres: spec.type === 'roof' ? STOREY_HEIGHT : 0,
    roofEaveMetres: spec.type === 'roof' ? TRUSS_ROOF_EAVE : 0,
    canopyDropMetres: spec.variant === 'canopy' ? CANOPY_ROOF_DROP : 0,
    psd: spec.psd,
    coverCourse: spec.cover,
    psdHalfHeightMetres: spec.type === 'psd-end' && spec.psd === 'half' ? PSD_HALF_HEIGHT : 0,
    psdFullHeightMetres: spec.type === 'psd-end' && spec.cover ? PSD_FULL_HEIGHT : 0,
    widthMetres: Number(size.x.toFixed(4)),
    depthMetres: Number(size.y.toFixed(4)),
    heightMetres: Number(size.z.toFixed(4)),
    posterSlug: spec.type === 'busstop' ? poster.slug : '',
    mountFace: spec.anchorFace,
  }

  const gltfRoot = new THREE.Group()
  gltfRoot.name = spec.prefab
  // Source space is Z-up. The single export transform rotates it into glTF Y-up,
  // exactly as the bench, bin, cctv, glass and shelf recipes do.
  gltfRoot.rotation.x = -Math.PI / 2
  gltfRoot.add(anchorRoot)
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
    catalogueId: spec.paletteId,
    paletteId: spec.paletteId,
    family: 'canopy',
    variant: spec.variant,
    type: spec.type,
    prefab: spec.prefab,
    file: spec.file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: 'game/src/render/models/pieces/RoofModel.ts, PsdEndModel.ts, PsdModel.ts and StreetDecorModel.ts; TrafficLightModel.ts and RailSignalModel.ts',
    provenance: spec.type === 'busstop'
      ? 'Repository procedural 公交站 shelter geometry, palette and printed canvases; the lightbox campaign is the repository poster catalogue artwork'
      : 'Repository procedural station canopy, platform-screen end and signal geometry and palette',
    licenseRecord: spec.type === 'busstop'
      ? 'Repository-authored procedural geometry; the campaign pixels come from the repository poster catalogue under game/src/assets/posters'
      : 'Repository-authored procedural geometry; no third-party assets',
    units: 'metres',
    placementOffset,
    min: bounds.min.toArray(),
    max: bounds.max.toArray(),
    size: size.toArray(),
    anchors,
    facade: spec.anchorFace,
    ...footprint,
    triangles,
    meshes,
    materials,
    alphaMaterials: [...alphaMaterials].sort(),
    glassMaterials: [...glassMaterials].sort(),
    textures: textures.size,
    validation: { errors: report.issues.numErrors, warnings: report.issues.numWarnings },
  }
  await writeFile(join(out, spec.file), bytes)
  await writeFile(join(out, spec.file.replace(/\.glb$/, '.manifest.json')), JSON.stringify(manifest, null, 2) + '\n')
  assets.push(manifest)
  console.log(
    `${spec.id}: ${triangles} triangles, ${meshes} meshes, ${materials.length} materials ` +
      `(${manifest.alphaMaterials.length} alpha, ${textures.size} textures), ` +
      `${size.x.toFixed(3)} x ${size.y.toFixed(3)} x ${size.z.toFixed(3)} m at z ${bounds.min.z.toFixed(3)}, ` +
      `${bytes.length} bytes, ${manifest.sha256.slice(0, 12)}`,
  )
}

const summary = {
  schemaVersion: 1,
  family: 'canopy',
  sourcePaths: [
    'game/src/render/models/pieces/RoofModel.ts',
    'game/src/render/models/pieces/PsdEndModel.ts',
    'game/src/render/models/pieces/PsdModel.ts',
    'game/src/render/models/pieces/PsdHousing.ts',
    'game/src/render/models/pieces/PsdHeader.ts',
    'game/src/render/models/pieces/StreetDecorModel.ts',
    'game/src/render/models/pieces/TrafficLightModel.ts',
    'game/src/render/models/pieces/RailSignalModel.ts',
    'game/src/render/models/PieceBuilder.ts',
    'game/src/render/models.ts',
    'game/src/build/model/Equipment.ts',
    'game/src/sim/structures.ts',
    'game/src/sim/psdEnds.ts',
    'game/src/sim/constants.ts',
  ],
  parameters: {
    models: MODELS.length,
    rot: 0,
    stationData: 'empty station document: { cells: [], modules: [], lines: [] }',
    placement: 'createModule anchors each piece at cell (0,0,0); placeLocal puts it at [x+0.5, y+0.5, z+1] — the PSD end course stands on the cell floor at [0.5, 0.5, 0] — and the 公交站 is centred on its 4 / 8 cell run by trackOriginForCentre, so its origin is [-0.5, 0.5, 1] (short) / [-2.5, 0.5, 1] (long)',
    roofBayWidthMetres: ROOF_BAY,
    roofTileCells: 1,
    storeyHeightMetres: STOREY_HEIGHT,
    ceilingHeightMetres: STOREY_HEIGHT,
    roofEaveMetres: TRUSS_ROOF_EAVE,
    canopyDropMetres: CANOPY_ROOF_DROP,
    psdHalfHeightMetres: PSD_HALF_HEIGHT,
    psdFullHeightMetres: PSD_FULL_HEIGHT,
    // Arrays, not a map: Unity's JsonUtility cannot deserialize dictionaries.
    roofVariants: MODELS.filter(spec => spec.type === 'roof').map(spec => ({
      paletteId: spec.paletteId,
      variant: spec.variant ?? 'flat',
      cells: spec.cells,
      bayWidthMetres: spec.cells,
      minZ: spec.minZ,
      heightMetres: spec.size[2],
    })),
    busStopLengths: MODELS.filter(spec => spec.type === 'busstop').map(spec => ({
      paletteId: spec.paletteId,
      variant: spec.variant,
      cells: spec.cells,
      lengthMetres: spec.size[0],
    })),
    psdEnds: MODELS.filter(spec => spec.type === 'psd-end').map(spec => ({
      paletteId: spec.paletteId,
      psd: spec.psd,
      coverCourse: spec.cover,
      widthMetres: spec.size[0],
      heightMetres: spec.size[2],
    })),
    palette: 'createModelMaterials() slots these builders read: steel (exported as the authored 0xb7bdc4 solid, no grain map), darkSteel, black, gateRed, white, orange, green, psdFixedGlass (transparent 0.26, depthWrite off), psdMovingGlass, ledRed, ledGreen, glow; plus the floor.concrete finish (0x8d9299) the roof sheets, PSD foundation and signal plinth wear',
    textures: 'two canvas maps per 公交站, both printed by the builder: its 256 x 768 线路信息板 route board and the frozen campaign on its lightboxes (one shared plate cropped per panel). Every roof, screen and signal is texture-free.',
    posters: [poster.slug],
    basis: 'source Z-up tree wrapped in a group rotated -90 degrees about X (glTF Y-up); Unity wrapper applies the 180-degree Y correction so gameplay channels read (x, z, y)',
  },
  assets,
  validation: {
    errors: assets.reduce((sum, asset) => sum + asset.validation.errors, 0),
    warnings: assets.reduce((sum, asset) => sum + asset.validation.warnings, 0),
  },
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(`CANOPY_EXPORT_OK ${assets.length} models, ${summary.validation.errors} errors, ${summary.validation.warnings} warnings -> ${out}`)
