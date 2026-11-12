import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Canvas, ImageData, createCanvas } from '@napi-rs/canvas'
import validator from 'gltf-validator'

// MonitorModel paints its dashboard/route-map ink on a canvas
// (`planarArtworkDetail`) even for a headless export, so the recipe needs a real
// 2D rasterizer. Pin the same adapter as export-bin.mjs.
globalThis.HTMLCanvasElement = Canvas
globalThis.ImageData = ImageData
globalThis.document = {
  createElement(name) {
    assert.equal(name, 'canvas')
    const canvas = createCanvas(1, 1)
    // @napi-rs exposes a `data()` method on Canvas. GLTFExporter treats any
    // image with a `data` property as a DataTexture, so shadow it or every
    // canvas is exported as transparent black.
    Object.defineProperty(canvas, 'data', { value: undefined })
    canvas.toBlob = async (callback, mime) => {
      const bytes = await canvas.encode(mime === 'image/jpeg' ? 'jpeg' : 'png')
      callback(new Blob([bytes], { type: mime }))
    }
    return canvas
  },
}

const gameRequire = createRequire(new URL('../../game/package.json', import.meta.url))
const THREE = await import(new URL('../../game/node_modules/three/build/three.module.js', import.meta.url).href)
const { GLTFExporter } = await import(pathToFileURL(gameRequire.resolve('three/addons/exporters/GLTFExporter.js')).href)
const { MonitorModel } = await import('../../game/src/render/models/pieces/MonitorModel.ts')
const { C } = await import('../../game/src/render/models/PieceBuilder.ts')

/**
 * The two finite variants of the 显示器 (MonitorModel.ts). The piece's own
 * `cfg.mount` selects the geometry:
 *
 * - `ceiling`: 0.96 × 0.72 m cabinet 0.9 m under the surface it hangs from,
 *   with two rods. With empty station data `hangCeilingLocal` falls back to
 *   `STOREY_HEIGHT - 1` = 4 m.
 * - `wall`: 3 × 2 m cabinet at eye height, bolted to the local −y wall, so its
 *   display turns into the room (+y). The display is a 3 × 4 grid of
 *   1.0 × 0.5 m panes; `panelColumns` is the width-driven parameter
 *   (`cabinetWidthM / paneWidthM` = 3 columns), which is why the catalogue
 *   entry is `w: 3`.
 */
const VARIANTS = [
  {
    variant: 'ceiling',
    id: 'station.monitor.ceiling',
    catalogueId: 'monitor-ceiling',
    mount: 'ceiling',
    w: 1,
    file: 'monitor-ceiling.glb',
    prefab: 'MonitorCeiling.prefab',
  },
  {
    variant: 'wall',
    id: 'station.monitor.wall',
    catalogueId: 'monitor-wall',
    mount: 'wall',
    w: 3,
    file: 'monitor-wall.glb',
    prefab: 'MonitorWall.prefab',
  },
]

// The builder reads these three palette entries and mints its own unlit ink
// panes through `ownedMaterial`. Keep the kit minimal like export-bench.mjs.
const mats = {
  darkSteel: new THREE.MeshStandardMaterial({ color: C.darkSteel, roughness: 0.55, metalness: 0.4, name: 'darkSteel' }),
  steel: new THREE.MeshStandardMaterial({ color: C.steel, roughness: 0.34, metalness: 0.72, name: 'steel' }),
  ledGreen: new THREE.MeshBasicMaterial({ color: 0x48e08a, name: 'ledGreen' }),
}

globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => {
      this.result = result
      this.onloadend?.()
    })
  }
}

const out = resolve(process.argv[2] ?? '.preview/unity/monitor-proof/export')
await mkdir(out, { recursive: true })
const variants = []

for (const spec of VARIANTS) {
  // `cfg.mount` picks the cabinet; `w` places the run at its two/three-cell
  // centre (MonitorModel uses `(mod.w - 1) / 2`), so it must match the
  // catalogue width (1 for the ceiling unit, 3 for the wall board).
  const root = new MonitorModel({
    mats,
    data: { cells: [], modules: [] },
    owned: [],
  }).build({
    type: 'monitor',
    x: 0,
    y: 0,
    z: 0,
    rot: 0,
    w: spec.w,
    cfg: { mount: spec.mount },
  })
  // `placeLocal` puts the piece on its tile; the recipe exports a stable local
  // origin and records the placement once.
  const placementOffset = root.position.toArray()
  root.position.set(0, 0, 0)
  root.rotation.set(0, 0, 0)

  const width = spec.mount === 'wall' ? 3 : 0.96
  const height = spec.mount === 'wall' ? 2 : 0.72
  const panelColumns = spec.mount === 'wall' ? width / 1 : 1
  const panelRows = spec.mount === 'wall' ? 4 : 1
  const params = {
    mount: spec.mount,
    ceilingFallbackM: spec.mount === 'ceiling' ? 4 : 0,
    hangBelowCeilingM: spec.mount === 'ceiling' ? 0.9 : 0,
    cabinetWidthM: width,
    cabinetHeightM: height,
    cabinetDepthM: 0.18,
    wallCentreHeightM: spec.mount === 'wall' ? 1.5 : 0,
    panelWidthM: spec.mount === 'wall' ? 1 : width - 0.16,
    panelHeightM: spec.mount === 'wall' ? 0.5 : height - 0.18,
    panelColumns,
    panelRows,
    panelCount: panelColumns * panelRows,
    panelWidthDriven: spec.mount === 'wall',
  }

  // Source-space basis anchors. `Front` is the piece's real viewing face, which
  // is local −y for the ceiling cabinet and local +y for the wall board (the
  // wall is at −y, so its display turns into the room). `Up` is source +z.
  const anchors = {
    AxisX: [1, 0, 0],
    Front: spec.mount === 'wall' ? [0, 1, 0] : [0, -1, 0],
    Up: [0, 0, 1],
  }
  for (const [name, position] of Object.entries(anchors)) {
    const anchor = new THREE.Object3D()
    anchor.name = name
    anchor.position.fromArray(position)
    root.add(anchor)
  }

  const paletteNames = new Map(Object.entries(mats).map(([name, material]) => [material, name]))
  const used = new Map()
  const textures = new Set()
  const alphaMaterials = new Set()
  let triangles = 0
  const lodPrints = []
  root.traverse(object => {
    // Renderer-only LOD metadata and shared-geometry tags contain random UUIDs.
    // This recipe exports the full-detail source meshes and keeps its metadata
    // in the manifest.
    object.userData = {}
    if (!object.isMesh) return
    const geometry = object.geometry
    const meshTriangles = (geometry.index?.count ?? geometry.getAttribute('position').count) / 3
    // `planarArtworkDetail` adds a zero-face canvas quad as the renderer's
    // low-detail LOD. The high-detail vector ink meshes are the export; the
    // empty quad is not valid glTF TRIANGLES and carries no pixels of its own.
    if (meshTriangles === 0) { lodPrints.push(object); return }
    triangles += meshTriangles
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      let name = paletteNames.get(material) ?? material.name
      if (!name) {
        // The unlit ink panes are minted per build with no name. Name them by
        // their colour so the GLB and the Unity material slots are stable; the
        // printed planar artwork carries the canvas and gets its own slot.
        name = material.map ? 'planarArtwork' : `ink-${material.color.getHexString()}`
        material.name = name
      }
      used.set(material, name)
      if (material.map) textures.add(material.map)
      if (material.transparent) alphaMaterials.add(name)
    }
  })
  for (const print of lodPrints) print.removeFromParent()
  if (lodPrints.length) {
    console.log(`${spec.id}: stripped ${lodPrints.length} zero-face low-detail artwork quad(s); exporting the vector ink`)
  }
  // Bounds are measured after the LOD strip so the manifest describes exactly
  // the exported geometry (the canvas quad reached 2 mm further forward).
  const bounds = new THREE.Box3().setFromObject(root)

  // Export source Z-up through the same −90° X group as export-bin.mjs.
  const gltfRoot = new THREE.Group()
  gltfRoot.name = spec.variant === 'wall' ? 'MonitorWall' : 'MonitorCeiling'
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
    catalogueId: spec.catalogueId,
    family: 'monitor',
    variant: spec.variant,
    file: spec.file,
    prefab: spec.prefab,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: 'game/src/render/models/pieces/MonitorModel.ts',
    provenance: 'Repository procedural monitor cabinet, ceiling rods and flat ink dashboard artwork',
    licenseRecord: 'Repository-authored procedural geometry and canvas artwork; no third-party assets',
    units: 'metres',
    placementOffset,
    min: bounds.min.toArray(),
    max: bounds.max.toArray(),
    anchors,
    facade: spec.mount === 'wall' ? 'local +y' : 'local -y',
    triangles,
    materials: [...used.values()].sort(),
    alphaMaterials: [...alphaMaterials].sort(),
    textures: textures.size,
    parameters: params,
  }
  await writeFile(join(out, spec.file), bytes)
  await writeFile(join(out, spec.file.replace(/\.glb$/, '.manifest.json')), JSON.stringify(manifest, null, 2) + '\n')
  variants.push({
    id: spec.id,
    catalogueId: spec.catalogueId,
    variant: spec.variant,
    file: spec.file,
    prefab: spec.prefab,
    manifest: spec.file.replace(/\.glb$/, '.manifest.json'),
    validation: reportName,
    sha256: manifest.sha256,
    min: manifest.min,
    max: manifest.max,
    anchors,
    triangles,
    materials: manifest.materials,
    alphaMaterials: manifest.alphaMaterials,
    textures: manifest.textures,
    parameters: params,
  })
  console.log(
    `${spec.id}: ${triangles} triangles, ${manifest.materials.length} materials, ${textures.size} textures, ` +
      `${panelColumns}x${panelRows} panes, ${bytes.length} bytes, ${manifest.sha256}`,
  )
}

const summary = {
  schemaVersion: 1,
  family: 'monitor',
  basis: 'reset source placement to local origin; source Z-up wrapped in a group rotated -90° about X; the Unity wrapper adds 180° about Y so gameplay channels read (x, z, y)',
  variants,
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n')
const validations = {}
for (const variant of variants) validations[variant.variant] = variant.validation
await writeFile(join(out, 'validation.json'), JSON.stringify(validations, null, 2) + '\n')
console.log(`MONITOR_EXPORT_OK ${variants.length} variants -> ${out}`)
