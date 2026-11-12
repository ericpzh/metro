import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Canvas, ImageData, createCanvas } from '@napi-rs/canvas'
import validator from 'gltf-validator'

// The retail family: the ten remaining 货架 shop fittings the station palette
// offers after the batch-2 shelf run. Two display runs (books, handbags), the
// three café backbars (single bay, two-cell medium, four-cell extra long), the
// four clothing fixtures (rail, shoe wall, folding table, wall bay) and the
// tiered fruit stand. Each asset is the game's own ShelfModel output for one
// placed module at a stable local origin.
//
// The palette prints two canvas maps: a 64 px brushed-steel grain
// (`brushedCanvas` scatters 700 lines with Math.random) and the 128 x 256
// perforated 货架 back panel. Two exports must be byte-identical, so the grain
// is drawn from a fixed-seed generator; the back panel is already deterministic.
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

// The palette prints its canvas textures through the DOM. Same adapter as
// export-shelf: shadow `data` or GLTFExporter treats every canvas as a
// DataTexture and writes transparent black.
globalThis.HTMLCanvasElement = Canvas
globalThis.ImageData = ImageData
// GLTFExporter reuses one module-level 2D canvas for every image and records the
// bufferView in encode-completion order, so two encodes in flight at once would
// race in both content and order. Serialise every canvas encode on one chain;
// this family currently prints at most the brushed-steel map per build (one
// `steel` user each), but the chain keeps a two-map build byte-stable too.
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
const { createModelMaterials } = await import('../../game/src/render/models/PieceBuilder.ts')
const { createModule } = await import('../../game/src/build/model/Equipment.ts')
const { buildModule } = await import('../../game/src/render/models.ts')
const { shelfSpec, shelfWidth } = await import('../../game/src/sim/shelves.ts')

/**
 * The ten family models, in review-row order. `cells` is the run the piece takes
 * on the tile grid (shelfWidth), `frame` the authored carcass colour the review
 * asserts stays opaque.
 */
const MODELS = [
  { paletteId: 'shelf-bags', variant: 'bags', prefab: 'ShelfBags', id: 'station.shelf.bags', cells: 2, frame: 'white' },
  { paletteId: 'shelf-books', variant: 'books', prefab: 'ShelfBooks', id: 'station.shelf.books', cells: 2, frame: 'wood' },
  { paletteId: 'shelf-cafe-backbar', variant: 'cafe-backbar', prefab: 'ShelfCafeBackbar', id: 'station.shelf.cafe-backbar', cells: 1, frame: 'darkSteel' },
  { paletteId: 'shelf-cafe-backbar-2', variant: 'cafe-backbar-2', prefab: 'ShelfCafeBackbar2', id: 'station.shelf.cafe-backbar-2', cells: 2, frame: 'darkSteel' },
  { paletteId: 'shelf-cafe-backbar-4', variant: 'cafe-backbar-4', prefab: 'ShelfCafeBackbar4', id: 'station.shelf.cafe-backbar-4', cells: 4, frame: 'darkSteel' },
  { paletteId: 'shelf-clothing-rail', variant: 'clothing-rail', prefab: 'ShelfClothingRail', id: 'station.shelf.clothing-rail', cells: 1, frame: 'white' },
  { paletteId: 'shelf-clothing-shoes', variant: 'clothing-shoes', prefab: 'ShelfClothingShoes', id: 'station.shelf.clothing-shoes', cells: 1, frame: 'darkSteel' },
  { paletteId: 'shelf-clothing-table', variant: 'clothing-table', prefab: 'ShelfClothingTable', id: 'station.shelf.clothing-table', cells: 1, frame: 'white' },
  { paletteId: 'shelf-clothing-wall', variant: 'clothing-wall', prefab: 'ShelfClothingWall', id: 'station.shelf.clothing-wall', cells: 1, frame: 'darkSteel' },
  { paletteId: 'shelf-fruit-tiered', variant: 'fruit-tiered', prefab: 'ShelfFruitTiered', id: 'station.shelf.fruit-tiered', cells: 1, frame: 'woodDark' },
].map(spec => ({ ...spec, file: `${spec.paletteId}.glb` }))

/** The design widths (metres) the review and the catalogue pin per variant. */
const WIDTH = {
  bags: 1.94,
  books: 1.94,
  'cafe-backbar': 0.96,
  'cafe-backbar-2': 1.96,
  'cafe-backbar-4': 3.96,
  'clothing-rail': 0.94,
  'clothing-shoes': 0.94,
  'clothing-table': 0.94,
  'clothing-wall': 0.94,
  'fruit-tiered': 0.96,
}

const mats = createModelMaterials()
// Empty station document: no neighbours, no slab over the cell and no track
// deck, so placeLocalAtEdge takes its standalone offset (no curtain shift).
const data = { cells: [], modules: [], lines: [], name: 'Station', nameEn: 'Station' }
const ctx = {
  mats, data, ads: {}, trackCells: new Set(),
  finish: (name) => (name === 'granite' ? mats.steel : mats.darkSteel),
}
const paletteNames = new Map(Object.entries(mats).map(([name, material]) => [material, name]))

/**
 * GLTFExporter ignores InstancedMesh instance matrices: it writes the base
 * geometry once at the node origin and drops `instanceColor`, which would export
 * every fixture with no stock at all. Expand every batch into ordinary meshes
 * before export: instances grouped by authored instance colour, transformed into
 * the batch's parent space, merged with BufferGeometryUtils.mergeGeometries, and
 * carried by a cloned per-colour material named `shelfGoods_<lowercase hex>`.
 *
 * Merging happens inside one batch only. Two batches in the same model can share
 * an authored colour (the handbag cubbies place the cubby colour on both the
 * extruded bag and the flat front panel); an ExtrudeGeometry is non-indexed and
 * a BoxGeometry is indexed, so merging across those two would fail. Both meshes
 * still share the one cloned material record, so the material set is unchanged.
 * Returns the colour mapping for the manifest.
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
    const baseName = paletteNames.get(base) ?? base.name ?? 'shelfGoods'
    const groups = new Map()
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix)
      mesh.getColorAt(i, color)
      const hex = color.getHexString()
      let group = groups.get(hex)
      if (!group) {
        group = { color: color.clone(), geometries: [], triangles: 0 }
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
        // instanceColor already multiplies the white base colour; copy the
        // authored colour so the baked mesh renders exactly as the batch did.
        material.color.copy(group.color)
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
      replacement.name = `${mesh.name || baseName}_${hex}`
      parent.add(replacement)
    }
    parent.remove(mesh)
    mesh.geometry.dispose()
  }
  assert.equal(instanced.length > 0, true, 'the builder produced no instanced stock to expand')
  return {
    batches: instanced.length,
    instances,
    colors: [...baked.values()]
      .map(record => ({
        color: record.color,
        material: record.material.name,
        instances: record.instances,
        triangles: record.triangles,
      }))
      .sort((a, b) => (a.material < b.material ? -1 : a.material > b.material ? 1 : 0)),
  }
}

const out = resolve(process.argv[2] ?? '.preview/unity/retail-proof/export')
await mkdir(out, { recursive: true })

const assets = []
for (const spec of MODELS) {
  const specValues = shelfSpec(spec.variant)
  assert.equal(shelfWidth(spec.variant), spec.cells, `${spec.paletteId}: expected a ${spec.cells}-cell run`)
  const mod = createModule(spec.paletteId, 0, 0, 0, `proof-${spec.paletteId}`, 0)
  assert.ok(mod, `${spec.paletteId}: createModule returned null`)
  assert.equal(mod.type, 'shelf', `${spec.paletteId}: expected a shelf module, got ${mod.type}`)
  assert.equal(mod.cfg.variant, spec.variant, `${spec.paletteId}: builder variant ${mod.cfg.variant}`)
  const root = buildModule(mod, ctx)
  assert.ok(root, `${spec.paletteId}: buildModule returned null`)

  // placeLocalAtEdge puts the piece on its tile edge; export from a stable local
  // origin and record the placement once. A multi-cell run still starts at the
  // anchor cell, so its bounds run from -0.5 to cells - 0.5.
  const placementOffset = root.position.toArray()
  root.position.set(0, 0, 0)
  root.rotation.set(0, 0, 0)
  root.updateMatrixWorld(true)

  const instance = expandInstances(root)

  // Strip renderer-only metadata (random UUIDs) now the instanced batches have
  // become ordinary meshes.
  const used = new Map()
  const named = new Set()
  const alphaMaterials = new Set()
  const glassMaterials = new Set()
  const textures = new Set()
  let triangles = 0
  let meshes = 0
  root.traverse(object => {
    object.userData = {}
    if (object.isInstancedMesh) assert.fail(`${spec.paletteId}: InstancedMesh survived expansion`)
    if (!object.isMesh) return
    meshes++
    triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      let name = used.get(material)
      if (!name) {
        name = paletteNames.get(material) ?? material.name
        // The builder mints no materials of its own in this family; the only
        // non-palette materials are the per-colour stock clones named above.
        assert.ok(name, `${spec.paletteId}: unnamed material ${material.type} #${material.color?.getHexString()}`)
        if (named.has(name) && paletteNames.get(material) !== name) {
          let suffix = 2
          while (named.has(`${name}${suffix}`)) suffix++
          name = `${name}${suffix}`
          material.name = name
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
  assert.ok(triangles > 0 && meshes > 0, `${spec.paletteId}: exported no geometry`)
  assert.ok(instance.colors.length > 0, `${spec.paletteId}: no instance colours were baked`)
  // Every baked stock colour must be a real material slot, and the count on the
  // fixture must match the distinct colours the batches authored.
  const materials = [...used.values()].sort()
  for (const record of instance.colors) assert.ok(materials.includes(record.material), `${spec.paletteId}: missing ${record.material}`)
  assert.equal(materials.filter(name => name.startsWith('shelfGoods_')).length, instance.colors.length,
    `${spec.paletteId}: stock colour materials were merged or renamed`)
  assert.ok(materials.includes(spec.frame), `${spec.paletteId}: frame material ${spec.frame} was not used by the builder`)

  // Source-space bounds, before the glTF Z-up -> Y-up wrapper.
  const bounds = new THREE.Box3().setFromObject(root)
  const size = bounds.getSize(new THREE.Vector3())
  // The piece stands on the anchor cell: -0.5 .. cells - 0.5 in x.
  assert.ok(Math.abs(bounds.min.x + 0.5) < 0.06,
    `${spec.paletteId}: bounds start at x=${bounds.min.x}, expected the anchor-cell edge -0.5`)
  assert.ok(Math.abs(bounds.max.x - (spec.cells - 0.5)) < 0.06,
    `${spec.paletteId}: bounds end at x=${bounds.max.x}, expected ${spec.cells - 0.5}`)
  assert.ok(Math.abs(size.x - WIDTH[spec.variant]) < 0.02,
    `${spec.paletteId}: width ${size.x} != design width ${WIDTH[spec.variant]}`)
  assert.ok(Math.abs(size.z - specValues.height) < 0.02,
    `${spec.paletteId}: height ${size.z} != shelfSpec height ${specValues.height}`)
  // Basis anchors, shared with bench/bin/cctv/glass/shelf. The shopping face is
  // local -y, so `Approach` is the piece's own front.
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

  const parameters = {
    variant: spec.variant,
    cells: spec.cells,
    widthMetres: Number(size.x.toFixed(3)),
    heightMetres: specValues.height,
    depthMetres: specValues.depth,
    frameMaterial: spec.frame,
    edgeDepthMetres: specValues.depth,
    shoppingFace: 'local -y',
    instanceExpansion: `${instance.instances} instances baked into ${instance.colors.length} per-colour materials`,
  }

  const gltfRoot = new THREE.Group()
  gltfRoot.name = spec.prefab
  // Source space is Z-up. The single export transform rotates it into glTF
  // Y-up, exactly as the bench, bin, cctv, glass and shelf recipes do.
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

  const manifest = {
    schemaVersion: 1,
    id: spec.id,
    catalogueId: spec.paletteId,
    paletteId: spec.paletteId,
    family: 'retail',
    variant: spec.variant,
    prefab: spec.prefab,
    file: spec.file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: 'game/src/render/models/pieces/ShelfModel.ts',
    provenance: 'Repository procedural 货架 retail fixture geometry, palette and canvas maps',
    licenseRecord: 'Repository-authored procedural geometry; no third-party assets',
    units: 'metres',
    cells: spec.cells,
    widthMetres: parameters.widthMetres,
    placementOffset,
    min: bounds.min.toArray(),
    max: bounds.max.toArray(),
    size: size.toArray(),
    anchors,
    facade: 'local -y',
    heightMetres: specValues.height,
    depthMetres: specValues.depth,
    edgeDepthMetres: specValues.depth,
    frameMaterial: spec.frame,
    triangles,
    meshes,
    materials,
    alphaMaterials: [...alphaMaterials].sort(),
    glassMaterials: [...glassMaterials].sort(),
    textures: textures.size,
    instances: instance.instances,
    instanceColors: instance.colors,
    parameters,
    validation: { errors: report.issues.numErrors, warnings: report.issues.numWarnings },
  }
  await writeFile(join(out, spec.file), bytes)
  await writeFile(join(out, spec.file.replace(/\.glb$/, '.manifest.json')), JSON.stringify(manifest, null, 2) + '\n')
  assets.push(manifest)
  console.log(
    `${spec.id}: ${triangles} triangles, ${meshes} meshes, ${materials.length} materials ` +
      `(${manifest.alphaMaterials.length} alpha, ${instance.colors.length} stock colours), ` +
      `${textures.size} textures, ${size.x.toFixed(3)} x ${size.y.toFixed(3)} x ${size.z.toFixed(3)} m, ` +
      `${bytes.length} bytes, ${manifest.sha256}`,
  )
}

const summary = {
  schemaVersion: 1,
  family: 'retail',
  sourcePaths: [
    'game/src/render/models/pieces/ShelfModel.ts',
    'game/src/render/models/pieces/DisplayShelves.ts',
    'game/src/render/models/pieces/WideBackbar.ts',
    'game/src/render/models/pieces/ShopShelves.ts',
    'game/src/render/models/pieces/ShopStock.ts',
    'game/src/render/models/PieceBuilder.ts',
    'game/src/build/model/Equipment.ts',
    'game/src/sim/shelves.ts',
  ],
  parameters: {
    models: MODELS.length,
    rot: 0,
    stationData: 'empty station document: { cells: [], modules: [], lines: [] }',
    placement: 'placeLocalAtEdge(..., spec.depth, no modules): standalone offset [0.5, 1 - depth/2, 1] for every variant; a multi-cell run still anchors on its first cell, so its bounds run from -0.5 to cells - 0.5',
    // Arrays, not a map: Unity's JsonUtility cannot deserialize dictionaries.
    variants: MODELS.map(spec => {
      const values = shelfSpec(spec.variant)
      const asset = assets.find(entry => entry.paletteId === spec.paletteId)
      return {
        variant: spec.variant,
        cells: spec.cells,
        widthMetres: asset.parameters.widthMetres,
        heightMetres: values.height,
        depthMetres: values.depth,
        frameMaterial: spec.frame,
      }
    }),
    instanceExpansion: 'every THREE.InstancedMesh is expanded before export: instances grouped by authored colour, transformed, merged with BufferGeometryUtils.mergeGeometries inside their batch, and carried by a cloned per-colour material named shelfGoods_<lowercase hex>',
    instanceCount: assets.reduce((sum, asset) => sum + asset.instanceColors.reduce((n, record) => n + record.instances, 0), 0),
    stockColours: assets.reduce((sum, asset) => sum + asset.instanceColors.length, 0),
    palette: 'createModelMaterials(): steel (64 px brushed canvas map), darkSteel, white, rubber, glass (transparent 0.26, double sided), gateRed (transparent 0.82), blue, wood, woodLight, woodDark, shelfPanel (128 x 256 pegboard canvas), shelfGoods (white base tinted per instance)',
    textures: 'the 64 px brushed-steel canvas map is the only map these fixtures reference (café backbars and the clothing rail use `steel`); it is drawn from a fixed-seed generator and its encode is serialised so the exported PNG is byte-stable',
    basis: 'source Z-up tree wrapped in a group rotated -90 degrees about X (glTF Y-up); Unity wrapper applies the 180-degree Y correction so gameplay channels read (x, z, y)',
  },
  assets,
  validation: {
    errors: assets.reduce((sum, asset) => sum + asset.validation.errors, 0),
    warnings: assets.reduce((sum, asset) => sum + asset.validation.warnings, 0),
  },
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(`RETAIL_EXPORT_OK ${assets.length} models, ${summary.validation.errors} errors, ${summary.validation.warnings} warnings -> ${out}`)
