// Export the concourse family: the four convenience-store checkouts, the WC
// wash basin and urinal, the three 灭火器 cabinets and the city 导向柱 guidepost.
//
// Every asset is the game's own `buildModule` output for one placed module at a
// stable local origin. Three of the builders are shared with other families
// (`ShopCounter`/`ShopStock` for the counter variants, `RestroomFixtures` for the
// ceramic, `GuidepostGeometry` for the triangular column), so the recipe records
// one uniform manifest per palette id.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Canvas, ImageData, createCanvas } from '@napi-rs/canvas'
import validator from 'gltf-validator'

// The guidepost prints seven canvas plates, the fire cabinets print their labels
// and the palette's brushed stainless is a canvas map: this recipe needs a real 2D
// rasterizer. Same adapter as export-opening/export-shelf: @napi-rs exposes a
// `data` method on Canvas and GLTFExporter treats any image with a `data` property
// as a DataTexture (transparent black), so shadow it.
//
// GLTFExporter encodes every canvas asynchronously and appends the image's
// bufferView only when its encode settles, so a guidepost with seven textures used
// to race itself and produce different GLB bytes between two runs. Serialize the
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

// The palette's brushed-stainless grain is drawn with `Math.random`, which would
// make two exports differ in the embedded PNG bytes. Pin the sequence before
// PieceBuilder is imported: the family has no other random input, so a fixed
// stream makes the exported GLBs byte-identical.
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
const { mergeGeometries } = await import(pathToFileURL(gameRequire.resolve('three/addons/utils/BufferGeometryUtils.js')).href)
const { createModelMaterials } = await import('../../game/src/render/models/PieceBuilder.ts')
const { createModule } = await import('../../game/src/build/model/Equipment.ts')
const { buildModule } = await import('../../game/src/render/models.ts')
const { counterLength, counterSpec, counterVariant } = await import('../../game/src/sim/counters.ts')
const { extinguisherSpec, extinguisherVariant } = await import('../../game/src/sim/extinguishers.ts')

/** The ten family models, in review-row order. */
const MODELS = [
  { paletteId: 'checkout', prefab: 'Checkout', id: 'station.checkout.standard', width: 1, facade: 'local -y', approach: [0, -1, 0], source: 'game/src/render/models/pieces/CheckoutModel.ts' },
  { paletteId: 'checkout-cafe', prefab: 'CheckoutCafe', id: 'station.checkout.cafe', width: 1, facade: 'local -y', approach: [0, -1, 0], source: 'game/src/render/models/pieces/ShopCounter.ts' },
  { paletteId: 'checkout-cafe-pastry', prefab: 'CheckoutCafePastry', id: 'station.checkout.cafe-pastry', width: 1, facade: 'local -y', approach: [0, -1, 0], source: 'game/src/render/models/pieces/ShopCounter.ts' },
  { paletteId: 'checkout-generic', prefab: 'CheckoutGeneric', id: 'station.checkout.generic', width: 1, facade: 'local -y', approach: [0, -1, 0], source: 'game/src/render/models/pieces/ShopCounter.ts' },
  { paletteId: 'sink', prefab: 'Sink', id: 'station.sink.standard', facade: 'local +y', approach: [0, 1, 0], source: 'game/src/render/models/pieces/SinkModel.ts' },
  { paletteId: 'urinal', prefab: 'Urinal', id: 'station.urinal.standard', facade: 'local +y', approach: [0, 1, 0], source: 'game/src/render/models/pieces/UrinalModel.ts' },
  { paletteId: 'extinguisher', prefab: 'Extinguisher', id: 'station.extinguisher.standard', facade: 'local -y', approach: [0, -1, 0], source: 'game/src/render/models/pieces/ExtinguisherModel.ts' },
  { paletteId: 'extinguisher-compact', prefab: 'ExtinguisherCompact', id: 'station.extinguisher.compact', facade: 'local -y', approach: [0, -1, 0], source: 'game/src/render/models/pieces/ExtinguisherModel.ts' },
  { paletteId: 'extinguisher-glass', prefab: 'ExtinguisherGlass', id: 'station.extinguisher.glass', facade: 'local -y', approach: [0, -1, 0], source: 'game/src/render/models/pieces/ExtinguisherModel.ts' },
  // The triangular column prints its plates on the two long faces and the rear
  // face; the nose (local -y) is its leading edge, so Approach records the front.
  { paletteId: 'guidepost', prefab: 'Guidepost', id: 'station.guidepost.standard', facade: 'local -y', approach: [0, -1, 0], source: 'game/src/render/models/pieces/StreetDecorModel.ts' },
].map(spec => ({ ...spec, file: `${spec.paletteId}.glb` }))

/** The measured size each recipe must reproduce, in metres (source X, Y, Z). */
const EXPECTED = {
  checkout: { size: [0.98, 0.878, 1.393], tolerance: 0.02 },
  'checkout-cafe': { size: [0.99, 0.86, 1.5], tolerance: 0.02 },
  'checkout-cafe-pastry': { size: [0.99, 0.86, 1.5], tolerance: 0.02 },
  'checkout-generic': { size: [0.99, 0.86, 1.4], tolerance: 0.02 },
  sink: { size: [0.69, 0.59, 1.04], tolerance: 0.02 },
  urinal: { size: [0.52, 0.45, 1.45], tolerance: 0.02 },
  extinguisher: { size: [0.74, 0.49, 1.1], tolerance: 0.02 },
  'extinguisher-compact': { size: [0.5, 0.32, 0.5], tolerance: 0.02 },
  'extinguisher-glass': { size: [1.5, 0.5, 2], tolerance: 0.02 },
  guidepost: { size: [0.16, 0.59, 4], tolerance: 0.03 },
}

const mats = createModelMaterials()
// Empty station document: no neighbours, no slab or track deck over the cell, so
// every `placeLocal`/`placeLocalAtEdge` takes its standalone offset and the
// guidepost keeps its default guangzhou branding.
const data = { cells: [], modules: [], lines: [], name: 'Station', nameEn: 'Station' }
const ctx = {
  mats, data, ads: {}, trackCells: new Set(),
  finish: (name) => (name === 'granite' ? mats.steel : mats.darkSteel),
}
// The shared kit is built once: the builders only read it, and the palette map is
// what names every material slot below.
const paletteNames = new Map(Object.entries(mats).map(([name, material]) => [material, name]))

/** Drop nodes the renderer never draws (the sink's activity water is hidden). */
function stripHidden(root) {
  const removed = []
  const walk = (object) => {
    for (const child of [...object.children]) {
      if (!child.visible) {
        removed.push(child.name || child.type)
        object.remove(child)
        continue
      }
      walk(child)
    }
  }
  walk(root)
  return removed
}

/**
 * GLTFExporter ignores InstancedMesh instance matrices: it writes the base
 * geometry once at the node origin and drops `instanceColor`, which would export
 * a checkout with no impulse stock. Expand every batch into ordinary meshes
 * before export: one merged geometry per authored instance colour (one geometry
 * per batch when the batch carries no colour), with the base material cloned per
 * colour and named `shelfGoods_<hex>`. Returns the colour mapping for the
 * manifest.
 */
function expandInstances(root) {
  const instanced = []
  root.traverse(object => { if (object.isInstancedMesh) instanced.push(object) })
  const baked = new Map()
  const matrix = new THREE.Matrix4(), local = new THREE.Matrix4(), color = new THREE.Color()
  let instances = 0
  for (const mesh of instanced) {
    assert.ok(!Array.isArray(mesh.material), `${mesh.name}: instanced batches use one material`)
    assert.ok(mesh.count > 0, `${mesh.name}: empty instanced batch`)
    mesh.updateMatrix()
    const base = mesh.material
    const baseName = paletteNames.get(base) ?? base.name ?? 'stockGoods'
    const groups = new Map()
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix)
      const key = mesh.instanceColor ? (mesh.getColorAt(i, color), color.getHexString()) : 'base'
      let group = groups.get(key)
      if (!group) {
        group = { color: mesh.instanceColor ? color.clone() : null, geometries: [], triangles: 0 }
        groups.set(key, group)
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
        // A colourless batch keeps the palette material itself; a coloured batch
        // gets the authored colour copied into its own clone (instanceColor
        // already multiplied the white base colour).
        const material = group.color ? base.clone() : base
        if (group.color) {
          material.name = `${baseName}_${hex}`
          material.color.copy(group.color)
        }
        record = { color: group.color ? hex : null, material, instances: 0, triangles: 0 }
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
      replacement.name = `${mesh.name || baseName}_${hex}`
      parent.add(replacement)
    }
    parent.remove(mesh)
    mesh.geometry.dispose()
  }
  return {
    batches: instanced.length,
    instances,
    colors: [...baked.values()]
      .filter(record => record.color)
      .map(record => ({
        color: record.color,
        material: record.material.name,
        instances: record.instances,
        triangles: record.triangles,
      }))
      .sort((a, b) => (a.material < b.material ? -1 : a.material > b.material ? 1 : 0)),
  }
}

/**
 * Name every material slot. Palette materials take their `createModelMaterials`
 * key; the builder-owned ceramic/porcelain and chrome fittings take their authored
 * colour (the kit mints them per build); the guidepost's seven canvas plates take
 * their plate size plus a stable ordinal in traversal order.
 */
function nameMaterials(root, paletteUsed) {
  const used = new Map()
  const named = new Set()
  const alphaMaterials = new Set()
  const glassMaterials = new Set()
  const textures = new Set()
  let triangles = 0
  let meshes = 0
  root.traverse(object => {
    object.userData = {}
    assert.ok(!object.isInstancedMesh, 'InstancedMesh survived expansion')
    if (!object.isMesh) return
    meshes++
    triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      let name = used.get(material)
      if (!name) {
        name = paletteNames.get(material)
        if (!name && material.name) name = material.name
        if (!name && material.map?.image?.width) name = `guidePlate_${material.map.image.width}x${material.map.image.height}`
        if (!name) {
          const hex = material.color?.getHexString?.() ?? 'none'
          name = hex === 'f3f3ed' ? `porcelain_${hex}` : `fixture_${hex}`
        }
        // Palette slots are unique by construction; only same-named owned
        // materials need an ordinal so the manifest stays a stable set.
        if (named.has(name) && !paletteNames.has(material)) {
          let suffix = 2
          while (named.has(`${name}_${suffix}`)) suffix++
          name = `${name}_${suffix}`
        }
        used.set(material, name)
        named.add(name)
        material.name = name
        if (paletteNames.has(material)) paletteUsed.add(name)
      }
      if (material.transparent) alphaMaterials.add(name)
      if (/glass/i.test(name)) glassMaterials.add(name)
      if (material.map) textures.add(material.map)
    }
  })
  return {
    used,
    materials: [...used.values()].sort(),
    alphaMaterials: [...alphaMaterials].sort(),
    glassMaterials: [...glassMaterials].sort(),
    textures: textures.size,
    triangles,
    meshes,
  }
}

const out = resolve(process.argv[2] ?? '.preview/unity/concourse-proof/export')
await mkdir(out, { recursive: true })

const assets = []
for (const spec of MODELS) {
  const mod = createModule(spec.paletteId, 0, 0, 0, `proof-${spec.paletteId}`, 0, spec.width)
  assert.ok(mod, `${spec.paletteId}: createModule returned null`)
  assert.ok(['checkout', 'sink', 'urinal', 'extinguisher', 'guidepost'].includes(mod.type),
    `${spec.paletteId}: unexpected module type ${mod.type}`)
  const root = buildModule(mod, ctx)
  assert.ok(root, `${spec.paletteId}: buildModule returned null`)

  // placeLocal/placeLocalAtEdge put the piece on its tile; export from a stable
  // local origin and record the placement once.
  const placementOffset = root.position.toArray().map(value => Math.round(value * 1e6) / 1e6)
  root.position.set(0, 0, 0)
  root.rotation.set(0, 0, 0)
  root.updateMatrixWorld(true)

  const hidden = stripHidden(root)
  root.updateMatrixWorld(true)
  const expansion = expandInstances(root)
  root.updateMatrixWorld(true)

  const paletteUsed = new Set()
  root.traverse(object => { object.userData = {} })
  const stats = nameMaterials(root, paletteUsed)

  // Source-space bounds, before the glTF Z-up -> Y-up wrapper.
  const bounds = new THREE.Box3().setFromObject(root)
  const size = bounds.getSize(new THREE.Vector3())
  const want = EXPECTED[spec.paletteId]
  ;['x', 'y', 'z'].forEach((axis, index) => {
    assert.ok(Math.abs(size[axis] - want.size[index]) <= want.tolerance,
      `${spec.paletteId}: ${axis} size ${size[axis].toFixed(3)} m is outside ${want.size[index]} ± ${want.tolerance} m`)
  })

  // Basis anchors, shared with bench/bin/cctv/glass/shelf. `Front` is the
  // gameplay forward (+y in source), `Approach` records the piece's own front.
  // They hang off the export wrapper rather than the builder's own group: the
  // compact 灭火器 cabinet scales its carcass on the root it returns, and a scaled
  // parent would shrink the anchors with it.
  const anchors = {
    AxisX: [1, 0, 0],
    Front: [0, 1, 0],
    Up: [0, 0, 1],
    Approach: spec.approach,
  }

  const parameters = { variant: null, counterWidthMetres: 0, counterLengthMetres: 0, widthMetres: 0, depthMetres: 0, heightMetres: 0, cells: 0, plateTextures: 0, cityStyle: '', facade: spec.facade }
  if (mod.type === 'checkout') {
    parameters.variant = counterVariant(mod.cfg.variant)
    parameters.counterWidthMetres = spec.width
    parameters.counterLengthMetres = counterLength(mod.w)
    parameters.heightMetres = counterSpec(mod.cfg.variant).height
  } else if (mod.type === 'extinguisher') {
    const variant = extinguisherVariant(mod.cfg.variant)
    const values = extinguisherSpec(variant)
    parameters.variant = variant
    parameters.widthMetres = values.width
    parameters.depthMetres = values.depth
    parameters.heightMetres = values.height
    parameters.cells = values.cells
  } else if (mod.type === 'guidepost') {
    parameters.variant = 'guangzhou'
    parameters.heightMetres = 4
    parameters.plateTextures = stats.textures
    parameters.cityStyle = 'guangzhou'
  } else {
    parameters.variant = mod.type
  }
  assert.equal(stats.triangles > 0 && stats.meshes > 0, true, `${spec.paletteId}: exported no geometry`)

  const gltfRoot = new THREE.Group()
  gltfRoot.name = spec.prefab
  // Source space is Z-up. The single export transform rotates it into glTF Y-up,
  // exactly as the bench, bin, cctv, glass and shelf recipes do.
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
    catalogueId: spec.paletteId,
    paletteId: spec.paletteId,
    family: 'concourse',
    variant: parameters.variant,
    prefab: spec.prefab,
    file: spec.file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: spec.source,
    provenance: 'Repository procedural station-concourse geometry, palette and canvas labels',
    licenseRecord: 'Repository-authored procedural geometry and canvas artwork; no third-party assets',
    units: 'metres',
    placementOffset,
    min: bounds.min.toArray().map(value => Math.round(value * 1e6) / 1e6),
    max: bounds.max.toArray().map(value => Math.round(value * 1e6) / 1e6),
    size: size.toArray().map(value => Math.round(value * 1e6) / 1e6),
    anchors,
    facade: spec.facade,
    triangles: stats.triangles,
    meshes: stats.meshes,
    materials: stats.materials,
    alphaMaterials: stats.alphaMaterials,
    glassMaterials: stats.glassMaterials,
    textures: stats.textures,
    hiddenMeshes: hidden,
    instanceColors: expansion.colors,
    parameters,
    validation: { errors: report.issues.numErrors, warnings: report.issues.numWarnings },
  }
  await writeFile(join(out, spec.file), bytes)
  await writeFile(join(out, spec.file.replace(/\.glb$/, '.manifest.json')), JSON.stringify(manifest, null, 2) + '\n')
  assets.push(manifest)
  console.log(
    `${spec.id}: ${stats.triangles} triangles, ${stats.meshes} meshes, ${stats.materials.length} materials ` +
      `(${stats.alphaMaterials.length} alpha), ${stats.textures} textures, ` +
      `${size.x.toFixed(3)} x ${size.y.toFixed(3)} x ${size.z.toFixed(3)} m, ${bytes.length} bytes, ${manifest.sha256}`,
  )
}

const guidepost = assets.find(asset => asset.paletteId === 'guidepost')
assert.equal(guidepost.textures, 7, 'the guidepost must carry its seven canvas plates')
assert.equal(assets.filter(asset => asset.parameters.counterWidthMetres === 1).length, 4, 'expected four 1 m counters')

const summary = {
  schemaVersion: 1,
  family: 'concourse',
  sourcePaths: [
    'game/src/render/models/pieces/CheckoutModel.ts',
    'game/src/render/models/pieces/ShopCounter.ts',
    'game/src/render/models/pieces/ShopStock.ts',
    'game/src/render/models/pieces/SinkModel.ts',
    'game/src/render/models/pieces/UrinalModel.ts',
    'game/src/render/models/pieces/RestroomFixtures.ts',
    'game/src/render/models/pieces/ExtinguisherModel.ts',
    'game/src/render/models/pieces/StreetDecorModel.ts',
    'game/src/render/models/pieces/GuidepostGeometry.ts',
    'game/src/render/models/PieceBuilder.ts',
    'game/src/build/model/Equipment.ts',
    'game/src/sim/counters.ts',
    'game/src/sim/extinguishers.ts',
  ],
  parameters: {
    models: MODELS.length,
    family: 'concourse',
    rot: 0,
    stationData: 'empty station document: { cells: [], modules: [], lines: [], name: "Station", nameEn: "Station" }, so every piece takes its standalone placement offset',
    counterWidthMetres: 1,
    counterLengthMetres: 1,
    counterLengths: [1, 2, 3, 4],
    counterPlacement: 'CheckoutModel/ShopCounter: extension = counterLength(w) - 1, centred at extension / 2; placeLocal offsets [0.5, 0.5, 1]',
    extinguisherPlacement: 'ExtinguisherModel: placeLocalAtEdge depth = spec.depth (standard 0.534, compact 0.35, glass 0.5), two-cell cabinets shift +0.5 m in x',
    guidepostHeightMetres: 4,
    guidepostPlateTextures: 7,
    guidepostPlates: 'guideFace (256 x 277 station ink), guideEnglishFace (256 x 993 rear English), guideExitLetterFace, guideTrainIconFace, guideLogoFace front and the two triangular side logos',
    extinguisherSpecs: ['standard', 'compact', 'glass'].map(variant => {
      const values = extinguisherSpec(variant)
      return { variant, widthMetres: values.width, depthMetres: values.depth, heightMetres: values.height, cells: values.cells }
    }),
    instanceExpansion: 'every THREE.InstancedMesh is expanded before export: instances grouped by authored colour, transformed, merged with BufferGeometryUtils.mergeGeometries, and carried by a cloned per-colour material named shelfGoods_<lowercase hex>; colourless batches keep their palette material',
    instanceCount: assets.reduce((sum, asset) => sum + asset.instanceColors.reduce((n, record) => n + record.instances, 0), 0),
    stockColours: assets.reduce((sum, asset) => sum + asset.instanceColors.length, 0),
    hiddenRuntimeMeshes: 'the sink\'s activity water stream is authored visible=false and is stripped before export; it stays a runtime-only animation',
    palette: 'createModelMaterials(): steel (64 px brushed canvas map), darkSteel, black, rubber, white, steel, exitRed, glass (transparent 0.26, double sided), psu, blue, green, woodLight, woodDark, desktopScreen, shelfGoods (white base tinted per instance), fireLabels, fireStationLabels; builder-owned porcelain (0xf3f3ed) and chrome fittings are named by authored colour',
    textures: 'brushed steel 64 px canvas (steel), 256 x 160 desktop screen, 320 x 400 fire label, 640 x 800 fire-station label, and the guidepost\'s seven 256-1024 px plate canvases; the steel grain uses a fixed-seed generator so the exported PNGs are byte-stable',
    basis: 'source Z-up tree wrapped in a group rotated -90 degrees about X (glTF Y-up); Unity wrapper applies the 180-degree Y correction so gameplay channels read (x, z, y)',
  },
  assets,
  validation: {
    errors: assets.reduce((sum, asset) => sum + asset.validation.errors, 0),
    warnings: assets.reduce((sum, asset) => sum + asset.validation.warnings, 0),
  },
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(`CONCOURSE_EXPORT_OK ${assets.length} models, ${summary.validation.errors} errors, ${summary.validation.warnings} warnings -> ${out}`)
