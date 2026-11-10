import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Canvas, ImageData, createCanvas } from '@napi-rs/canvas'
import validator from 'gltf-validator'

// The bin prints two canvas textures (brushed steel and the sorting stickers),
// so the export needs a real 2D rasterizer instead of a stub. Pin the same
// adapter the train recipe uses so both fixtures agree on PNG encoding.
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
const { BinModel } = await import('../../game/src/render/models/pieces/BinModel.ts')
const { createModelMaterials } = await import('../../game/src/render/models/PieceBuilder.ts')

const mats = createModelMaterials()
const id = 'station.bin.double-stream'
// `placeLocalAtEdge` positions the piece on its tile; the recipe exports the
// model at a stable local origin, so reset the placement and record it once.
const root = new BinModel({ mats }).build({ type: 'bin', x: 0, y: 0, z: 0, rot: 0 })
const placementOffset = root.position.toArray()
root.position.set(0, 0, 0)
root.rotation.set(0, 0, 0)

const bounds = new THREE.Box3().setFromObject(root)
// Basis anchors match the bench recipe. `Approach` records the bin's own front:
// the model's mouths and sorting stickers face local -y.
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

const names = new Map(Object.entries(mats).map(([name, material]) => [material, name]))
const used = new Map()
const textures = new Set()
const alphaMaterials = new Set()
let triangles = 0
root.traverse(object => {
  // Renderer-only LOD metadata (`lowDetailGeometry`) and shared-geometry tags
  // contain random UUIDs. This recipe exports the full-detail source meshes.
  object.userData = {}
  if (!object.isMesh) return
  triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3
  for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
    const name = names.get(material) ?? `binMaterial${used.size}`
    material.name = name
    used.set(material, name)
    if (material.map) textures.add(material.map)
    if (material.transparent) alphaMaterials.add(name)
  }
})

globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => {
      this.result = result
      this.onloadend?.()
    })
  }
}
const gltfRoot = new THREE.Group()
gltfRoot.name = 'Bin'
gltfRoot.rotation.x = -Math.PI / 2
gltfRoot.add(root)
const bytes = new Uint8Array(await new GLTFExporter().parseAsync(gltfRoot, { binary: true }))
const report = await validator.validateBytes(bytes, { uri: 'bin.glb' })
const out = resolve(process.argv[2] ?? '.preview/unity/bin-proof/export')
await mkdir(out, { recursive: true })
await writeFile(join(out, 'validation.json'), JSON.stringify(report, null, 2) + '\n')
assert.equal(report.issues.numErrors + report.issues.numWarnings, 0, 'See validation.json')
const materials = [...used.values()].sort()
const manifest = {
  schemaVersion: 1,
  id,
  file: 'bin.glb',
  sha256: createHash('sha256').update(bytes).digest('hex'),
  source: 'game/src/render/models/pieces/BinModel.ts',
  provenance: 'Repository procedural double-stream bin geometry, palette, and canvas label generator',
  units: 'metres',
  placementOffset,
  min: bounds.min.toArray(),
  max: bounds.max.toArray(),
  anchors,
  triangles,
  materials,
  alphaMaterials: [...alphaMaterials].sort(),
  textures: textures.size,
  facade: 'local -y',
}
await writeFile(join(out, 'bin.glb'), bytes)
await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`${id}: ${triangles} triangles, ${materials.length} materials, ${textures.size} textures, ${bytes.length} bytes, ${manifest.sha256}`)
