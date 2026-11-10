import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import validator from 'gltf-validator'
import { BenchModel } from '../../game/src/render/models/pieces/BenchModel.ts'
import { C } from '../../game/src/render/models/PieceBuilder.ts'

const gameRequire = createRequire(new URL('../../game/package.json', import.meta.url))
const THREE = await import(new URL('../../game/node_modules/three/build/three.module.js', import.meta.url).href)
const { GLTFExporter } = await import(pathToFileURL(gameRequire.resolve('three/addons/exporters/GLTFExporter.js')).href)

// The static bench has no textures. The full game palette initializes canvases.
const mats = {
  darkSteel: new THREE.MeshStandardMaterial({ color: C.darkSteel, roughness: 0.55, metalness: 0.4, name: 'darkSteel' }),
  white: new THREE.MeshStandardMaterial({ color: C.white, roughness: 0.45, metalness: 0.05, name: 'white' }),
  trainSeat: new THREE.MeshStandardMaterial({ color: C.trainSeat, roughness: 0.7, metalness: 0.1, name: 'trainSeat' }),
}
const id = 'station.bench.seat-2'
const root = new BenchModel({ mats }).build({ type: 'bench', x: 0, y: 0, z: 0, rot: 0, cfg: { variant: 'seat-2' } })
const placementOffset = root.position.toArray()
root.position.set(0, 0, 0)
root.rotation.set(0, 0, 0)
const bounds = new THREE.Box3().setFromObject(root)
const anchors = {
  AxisX: [1, 0, 0],
  Front: [0, 1, 0],
  Up: [0, 0, 1],
}
for (const [name, position] of Object.entries(anchors)) {
  const anchor = new THREE.Object3D()
  anchor.name = name
  anchor.position.fromArray(position)
  root.add(anchor)
}
let triangles = 0
root.traverse(object => {
  // Three's renderer-only LOD metadata contains geometry with random UUIDs.
  // This recipe exports full-detail meshes and keeps its metadata in the manifest.
  object.userData = {}
  if (object.isMesh) triangles += object.geometry.index.count / 3
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
gltfRoot.name = 'Bench'
gltfRoot.rotation.x = -Math.PI / 2
gltfRoot.add(root)
const bytes = new Uint8Array(await new GLTFExporter().parseAsync(gltfRoot, { binary: true }))
const report = await validator.validateBytes(bytes, { uri: 'bench.glb' })
const out = resolve(process.argv[2] ?? '.preview/unity/bench-proof/export')
await mkdir(out, { recursive: true })
await writeFile(join(out, 'validation.json'), JSON.stringify(report, null, 2) + '\n')
assert.equal(report.issues.numErrors + report.issues.numWarnings, 0, 'See validation.json')
const manifest = {
  schemaVersion: 1,
  id,
  file: 'bench.glb',
  sha256: createHash('sha256').update(bytes).digest('hex'),
  source: 'game/src/render/models/pieces/BenchModel.ts',
  provenance: 'Repository procedural bench geometry and palette',
  units: 'metres',
  placementOffset,
  min: bounds.min.toArray(),
  max: bounds.max.toArray(),
  anchors,
  triangles,
  materials: Object.keys(mats).sort(),
}
await writeFile(join(out, 'bench.glb'), bytes)
await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`${id}: ${triangles} triangles, ${bytes.length} bytes, ${manifest.sha256}`)
