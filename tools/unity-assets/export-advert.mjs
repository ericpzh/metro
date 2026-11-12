import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Canvas, ImageData, createCanvas, loadImage } from '@napi-rs/canvas'
import validator from 'gltf-validator'

// The 广告牌 (billboard / advertisement lightbox) family: the ten wall-mounted
// lightboxes the station palette offers. Each asset is the game's own
// BillboardModel output for one placed module at a stable local origin: a dark
// steel housing slab flat on the local −y wall, a steel edge frame, and the lit
// poster plate on y = −0.315 facing +y into the room.
//
// The artwork is a real repository poster (`game/src/assets/posters/*.webp`),
// not a drawn canvas. `render/adArt.ts` is browser-only (it needs `Image` and a
// Vite glob), so this file supplies the `AdArt` contract headlessly: decode the
// WebP with @napi-rs/canvas, draw it onto a 2-D canvas, wrap that canvas in a
// THREE.CanvasTexture, and hand `BillboardModel` the same
// `{ geometry, material }` pair the browser would with the centred UV crop cut
// by `panelUvWindow` + `croppedPlane`.
//
// One fixed poster slug per variant keeps the export deterministic: the first
// AD_POSTERS entry whose `shapes` includes the variant's shape
// (`BILLBOARD_SPECS[].shape`), frozen into the module's `cfg.poster`.
const MODELS = [
  { paletteId: 'billboard-wide', prefab: 'BillboardWide', id: 'station.billboard.wide' },
  { paletteId: 'billboard-standard', prefab: 'BillboardStandard', id: 'station.billboard.standard' },
  { paletteId: 'billboard-large', prefab: 'BillboardLarge', id: 'station.billboard.large' },
  { paletteId: 'billboard-panorama', prefab: 'BillboardPanorama', id: 'station.billboard.panorama' },
  { paletteId: 'billboard-portrait', prefab: 'BillboardPortrait', id: 'station.billboard.portrait' },
  { paletteId: 'billboard-square', prefab: 'BillboardSquare', id: 'station.billboard.square' },
  { paletteId: 'billboard-16x9-3m', prefab: 'Billboard16x9_3m', id: 'station.billboard.16x9-3m' },
  { paletteId: 'billboard-16x9-4m', prefab: 'Billboard16x9_4m', id: 'station.billboard.16x9-4m' },
  { paletteId: 'billboard-4x3-3m', prefab: 'Billboard4x3_3m', id: 'station.billboard.4x3-3m' },
  { paletteId: 'billboard-4x3-4m', prefab: 'Billboard4x3_4m', id: 'station.billboard.4x3-4m' },
].map(spec => ({ ...spec, file: `${spec.paletteId}.glb` }))

// The palette prints its canvas textures through the DOM and the poster too is
// decoded into one. Same adapter as export-bin/export-glass/export-shelf: shadow
// `data` or GLTFExporter treats every canvas as a DataTexture and writes
// transparent black.
globalThis.HTMLCanvasElement = Canvas
globalThis.ImageData = ImageData
globalThis.document = {
  createElement(name) {
    assert.equal(name, 'canvas')
    const canvas = createCanvas(1, 1)
    Object.defineProperty(canvas, 'data', { value: undefined })
    canvas.toBlob = async (callback, mime) => {
      const bytes = await canvas.encode(mime === 'image/jpeg' ? 'jpeg' : 'png')
      callback(new Blob([bytes], { type: mime }))
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
const { createModule } = await import('../../game/src/build/model/Equipment.ts')
const { buildModule } = await import('../../game/src/render/models.ts')
const { AD_POSTERS, BILLBOARD_SPECS } = await import('../../game/src/sim/billboards.ts')
const { croppedPlane, panelUvWindow } = await import('../../game/src/render/panelUv.ts')

const POSTER_DIR = new URL('../../game/src/assets/posters/', import.meta.url)

/**
 * The lit face of one panel, the way `render/adArt.ts` builds it in the browser:
 * the unlit material over the poster texture and the quad whose UVs hold the
 * centred crop that fits the image to the panel. One material per poster, one
 * geometry per panel size, exactly as the browser caches them.
 */
function createAdArt(posters) {
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
        // Stable authored name: the one lit-artwork material of the piece.
        material.name = 'billboardPoster'
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

/** Decode one repository poster into a colour-managed canvas texture. */
async function decodePoster(slug) {
  const path = new URL(`${slug}.webp`, POSTER_DIR)
  const image = await loadImage(path)
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

// The palette slots BillboardModel reads. The game's `crateModelMaterials()`
// brushes its steel with a 64 px canvas map; a billboard's steel is the 0.04 m
// edge frame, so the recipe uses the same authored colours and finish as solid
// palette materials. That keeps the exported assets to exactly one texture — the
// poster — instead of carrying the palette grain once per model.
const C = {
  steel: 0xb7bdc4,
  darkSteel: 0x3c434c,
}
function createPalette() {
  return {
    steel: new THREE.MeshStandardMaterial({ color: C.steel, roughness: 0.34, metalness: 0.72, name: 'steel' }),
    darkSteel: new THREE.MeshStandardMaterial({ color: C.darkSteel, roughness: 0.55, metalness: 0.4, name: 'darkSteel' }),
  }
}

/** The first catalogue poster that may be printed on a panel of this shape. */
function posterForShape(shape) {
  const poster = AD_POSTERS.find(entry => entry.shapes.includes(shape))
  assert.ok(poster, `no poster in the catalogue prints the ${shape} shape`)
  return poster
}

const out = resolve(process.argv[2] ?? '.preview/unity/advert-proof/export')
await mkdir(out, { recursive: true })

const mats = createPalette()
const paletteNames = new Map(Object.entries(mats).map(([name, material]) => [material, name]))
// Empty station document: no neighbours, no raised finish under the piece, so
// `buildModule`'s outdoor-surface lift is zero and the bounds stay local.
const data = { cells: [], modules: [], lines: [], name: 'Station', nameEn: 'Station' }

const posters = new Map()
const plan = []
for (const spec of MODELS) {
  const values = BILLBOARD_SPECS[spec.paletteId.slice('billboard-'.length)]
  assert.ok(values, `${spec.paletteId}: no BILLBOARD_SPECS entry`)
  const poster = posterForShape(values.shape)
  if (!posters.has(poster.slug)) posters.set(poster.slug, await decodePoster(poster.slug))
  plan.push({ ...spec, values, poster: posters.get(poster.slug) })
}

const assets = []
for (const spec of plan) {
  const ads = createAdArt(posters)
  const ctx = { mats, data, ads, trackCells: new Set(), finish: () => mats.darkSteel, tvPlate: () => null }
  const mod = createModule(spec.paletteId, 0, 0, 0, `proof-${spec.paletteId}`, 0)
  assert.ok(mod, `${spec.paletteId}: createModule returned null`)
  assert.equal(mod.type, 'billboard', `${spec.paletteId}: expected a billboard module, got ${mod.type}`)
  // Freeze the campaign the panel prints, exactly as `assignAdPosters` does when
  // the piece is committed.
  mod.cfg = { ...mod.cfg, poster: spec.poster.slug }
  const root = buildModule(mod, ctx)
  assert.ok(root, `${spec.paletteId}: buildModule returned null`)

  // `buildBillboard` centres the run on the cell at (x+0.5, y+0.5, z+1); export
  // from a stable local origin and record the placement once.
  const placementOffset = root.position.toArray()
  root.position.set(0, 0, 0)
  root.rotation.set(0, 0, 0)
  root.updateMatrixWorld(true)

  const used = new Map()
  const named = new Set()
  const alphaMaterials = new Set()
  const glassMaterials = new Set()
  const textures = new Set()
  let triangles = 0
  let meshes = 0
  const posterMaterials = []
  root.traverse(object => {
    // Renderer-only metadata carries random UUIDs; this recipe exports the
    // full-detail source meshes and keeps the numbers in the manifest.
    object.userData = {}
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
      if (name === 'billboardPoster') posterMaterials.push(material)
      if (material.transparent) alphaMaterials.add(name)
      if (name.toLowerCase().includes('glass')) glassMaterials.add(name)
      if (material.map) textures.add(material.map)
    }
  })
  assert.equal(Number.isInteger(triangles), true, `${spec.paletteId}: triangle count is not an integer`)
  // The expected housing: one 12-triangle housing slab, one 12-triangle steel
  // edge and the two-triangle poster quad.
  assert.equal(triangles, 26, `${spec.paletteId}: expected 26 triangles, got ${triangles}`)
  assert.equal(meshes, 3, `${spec.paletteId}: expected 3 housing meshes, got ${meshes}`)
  const materials = [...used.values()].sort()
  assert.deepEqual(materials, ['billboardPoster', 'darkSteel', 'steel'], `${spec.paletteId}: materials ${materials}`)
  assert.equal(posterMaterials.length, 1, `${spec.paletteId}: expected one poster material`)
  assert.equal(textures.size, 1, `${spec.paletteId}: expected one poster texture, got ${textures.size}`)
  assert.equal(alphaMaterials.size, 0, `${spec.paletteId}: the printed panel must stay opaque`)
  assert.equal(posterMaterials[0].map.image.width, spec.poster.width,
    `${spec.paletteId}: poster texture lost its pixels`)

  // Source-space bounds, before the glTF Z-up -> Y-up wrapper. The housing sits
  // on y = -0.42 and the lit plate on y = -0.315.
  const bounds = new THREE.Box3().setFromObject(root)
  const size = bounds.getSize(new THREE.Vector3())
  // Basis anchors, shared with bench/bin/cctv/glass/shelf. `Front` is the lit
  // face (+y into the room); `Approach` is the local -y wall the housing bolts to.
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
    variant: spec.values.variant,
    shape: spec.values.shape,
    posterSlug: spec.poster.slug,
    cells: spec.values.w,
    panelW: spec.values.panelW,
    panelH: spec.values.panelH,
    panelZ: spec.values.panelZ,
    totalHeightMetres: spec.values.totalHeight ?? 0,
    mountFace: 'local -y wall',
    litFace: 'local +y',
    housingY: -0.42,
    posterY: -0.315,
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
    family: 'billboard',
    variant: spec.values.variant,
    prefab: spec.prefab,
    file: spec.file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: 'game/src/render/models/pieces/BillboardModel.ts',
    provenance: 'Repository procedural 广告牌 lightbox housing (dark steel slab, steel edge frame) with the panel artwork decoded from the repository poster catalogue under game/src/assets/posters',
    licenseRecord: 'Repository-authored procedural geometry; the poster pixels come from the repository poster catalogue under game/src/assets/posters',
    units: 'metres',
    placementOffset,
    min: bounds.min.toArray(),
    max: bounds.max.toArray(),
    size: size.toArray(),
    anchors,
    facade: 'lit face local +y; housing on the local -y wall',
    shape: spec.values.shape,
    posterSlug: spec.poster.slug,
    posterImage: { width: spec.poster.width, height: spec.poster.height, aspect: spec.poster.imageAspect },
    cells: spec.values.w,
    panelW: spec.values.panelW,
    panelH: spec.values.panelH,
    panelZ: spec.values.panelZ,
    totalHeightMetres: spec.values.totalHeight ?? 0,
    triangles,
    meshes,
    materials,
    alphaMaterials: [...alphaMaterials].sort(),
    glassMaterials: [...glassMaterials].sort(),
    textures: textures.size,
    parameters,
    validation: { errors: report.issues.numErrors, warnings: report.issues.numWarnings },
  }
  await writeFile(join(out, spec.file), bytes)
  await writeFile(join(out, spec.file.replace(/\.glb$/, '.manifest.json')), JSON.stringify(manifest, null, 2) + '\n')
  assets.push(manifest)
  console.log(
    `${spec.id}: ${triangles} triangles, ${meshes} meshes, ${materials.length} materials, ` +
      `${textures.size} texture (${spec.poster.slug}), ${spec.values.panelW.toFixed(3)} x ${spec.values.panelH.toFixed(3)} m panel, ` +
      `${bytes.length} bytes, ${manifest.sha256.slice(0, 12)}`,
  )
}

const summary = {
  schemaVersion: 1,
  family: 'billboard',
  sourcePaths: [
    'game/src/render/models/pieces/BillboardModel.ts',
    'game/src/render/models/PieceBuilder.ts',
    'game/src/build/model/Equipment.ts',
    'game/src/sim/billboards.ts',
    'game/src/sim/posterCatalogue.ts',
    'game/src/render/panelUv.ts',
  ],
  parameters: {
    models: MODELS.length,
    rot: 0,
    stationData: 'empty station document: { cells: [], modules: [], lines: [] }',
    placement: 'buildBillboard centres the run on the placed cell: group.position = [x + 0.5 + dx, y + 0.5 + dy, z + 1]. createModule anchors an even run on its lower-middle cell, so an odd cell span records placementOffset [0.5, 0.5, 1] and an even span [1, 0.5, 1]',
    posterRule: 'one fixed slug per variant: the first AD_POSTERS entry whose shapes includes BILLBOARD_SPECS[variant].shape, frozen into cfg.poster (no RNG, so two exports are byte-identical)',
    // Arrays, not a map: Unity's JsonUtility cannot deserialize dictionaries.
    billboardSpecs: plan.map(spec => ({
      paletteId: spec.paletteId,
      variant: spec.values.variant,
      shape: spec.values.shape,
      posterSlug: spec.poster.slug,
      cells: spec.values.w,
      panelW: spec.values.panelW,
      panelH: spec.values.panelH,
      panelZ: spec.values.panelZ,
      totalHeightMetres: spec.values.totalHeight ?? 0,
    })),
    posters: [...posters.values()].sort((a, b) => (a.slug < b.slug ? -1 : 1)).map(poster => ({
      slug: poster.slug,
      width: poster.width,
      height: poster.height,
      aspect: poster.imageAspect,
      shapes: AD_POSTERS.find(entry => entry.slug === poster.slug).shapes,
    })),
    palette: 'steel (0xb7bdc4, roughness 0.34, metalness 0.72) and darkSteel (0x3c434c, roughness 0.55, metalness 0.4) as solid palette materials; the game kit brushes its steel with a 64 px canvas map, which a 0.04 m edge frame does not need',
    textures: 'one poster texture per model, decoded from game/src/assets/posters/<slug>.webp with @napi-rs/canvas, drawn onto a 2-D canvas and wrapped in a THREE.CanvasTexture (SRGBColorSpace); the quad UVs hold the centred crop from panelUvWindow + croppedPlane',
    expectedHousing: '26 triangles (12 housing slab + 12 steel edge + 2 poster plane), 3 meshes, 1 texture, all materials opaque',
    basis: 'source Z-up tree wrapped in a group rotated -90 degrees about X (glTF Y-up); Unity wrapper applies the 180-degree Y correction so gameplay channels read (x, z, y)',
  },
  assets,
  validation: {
    errors: assets.reduce((sum, asset) => sum + asset.validation.errors, 0),
    warnings: assets.reduce((sum, asset) => sum + asset.validation.warnings, 0),
  },
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(`ADVERT_EXPORT_OK ${assets.length} models, ${summary.validation.errors} errors, ${summary.validation.warnings} warnings -> ${out}`)
