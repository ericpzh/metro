// Export both ceiling-light variants (`light-circular`, `light-rectangular`)
// through the real game builder, validate each GLB and write per-variant and
// summary manifests.
//
//   node tools/unity-assets/export-light.mjs .preview/unity/light-<stamp>/export
//
// Fixed inputs, recorded in the manifest instead of invented here:
//   * the module is a fresh `light` at cell (0, 0, 0) with an empty station
//     document, so `hangCeilingLocal` falls through to its ceiling fallback:
//     `lightCeilingZ(mod) - mod.z - 1` = 5 - 0 - 1 = 4 m above the cell floor top.
//     The 5 m is `STOREY_HEIGHT`.
//   * `rot: 0`. A rectangular light swaps its 0.8 × 0.12 m footprint on odd
//     rotations (`lightSpec`); rotation 0 is the shipped default and is what the
//     catalogue thumbnail shows.
//   * `cfg.position: 0` — the centre of `IN_CELL_POSITIONS`. Positions 1-8 offset
//     the rectangular diffuser inside its cell (`inCellOffset`, `(1 - size) / 2`
//     per step); the circular light ignores the parameter. This fixture exports
//     the centred case and the offset is recorded as a placement parameter.
//
// Materials are the two palette entries `LightModel` reads. The palette's steel
// carries a 64 × 64 brushed canvas drawn with `Math.random`, which would break
// the two-run GLB byte check, so this recipe builds steel without that map at the
// same base colour / roughness / metalness. `lightDiffuser` is the real palette
// entry: a lit `MeshStandardMaterial` with an emissive factor and intensity, not
// an unlit/basic material, which is what the Unity check asserts.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import validator from 'gltf-validator'
import { LightModel } from '../../game/src/render/models/pieces/LightModel.ts'
import { C } from '../../game/src/render/models/PieceBuilder.ts'

const gameRequire = createRequire(new URL('../../game/package.json', import.meta.url))
const THREE = await import(new URL('../../game/node_modules/three/build/three.module.js', import.meta.url).href)
const { GLTFExporter } = await import(pathToFileURL(gameRequire.resolve('three/addons/exporters/GLTFExporter.js')).href)

// Only the two palette entries this piece reads. `lightDiffuser` is copied from
// `createModelMaterials` verbatim (colour, emissive, intensity, roughness,
// double-sided) so the export carries the same luminous face the game draws.
const DIFFUSER = {
  color: 0xfff8e8,
  emissive: 0xfff4d8,
  emissiveIntensity: 1.5,
  roughness: 0.4,
  side: THREE.DoubleSide,
}
const mats = {
  steel: new THREE.MeshStandardMaterial({ color: C.steel, roughness: 0.34, metalness: 0.72, name: 'steel' }),
  lightDiffuser: new THREE.MeshStandardMaterial({ ...DIFFUSER, name: 'lightDiffuser' }),
}

const VARIANTS = [
  {
    id: 'station.light.circular',
    catalogueId: 'light-circular',
    variant: 'circular',
    file: 'light-circular.glb',
    prefab: 'LightCircular.prefab',
    rootName: 'LightCircular',
    // lightSpec(): the circular housing is a 0.5 m diameter cylinder.
    footprint: { width: 0.5, depth: 0.5 },
  },
  {
    id: 'station.light.rectangular',
    catalogueId: 'light-rectangular',
    variant: 'rectangular',
    file: 'light-rectangular.glb',
    prefab: 'LightRectangular.prefab',
    rootName: 'LightRectangular',
    // lightSpec() at rot 0: 0.8 m along x, 0.12 m along y.
    footprint: { width: 0.8, depth: 0.12 },
  },
]

const ANCHORS = {
  AxisX: [1, 0, 0],
  Front: [0, 1, 0],
  Up: [0, 0, 1],
}

const out = resolve(process.argv[2] ?? '.preview/unity/light-proof/export')
await mkdir(out, { recursive: true })

// The diffuser's linear emissive factor is what glTF stores. Read it from the
// live material so the manifest cannot drift from the palette.
const emissiveFactor = mats.lightDiffuser.emissive.toArray()

const materialExpectation = {
  steel: {
    shading: 'standard',
    baseColor: `#${C.steel.toString(16).padStart(6, '0')}`,
    metalness: 0.72,
    roughness: 0.34,
    emissive: false,
  },
  lightDiffuser: {
    shading: 'emissive',
    unlit: false,
    doubleSided: true,
    emissiveFactor,
    emissiveIntensity: DIFFUSER.emissiveIntensity,
    note: 'The palette diffuser is a lit MeshStandardMaterial with an emissive factor, not an unlit/basic material.',
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

const variants = []
for (const spec of VARIANTS) {
  const placement = { type: 'light', x: 0, y: 0, z: 0, rot: 0, cfg: { variant: spec.variant, position: 0 } }
  const model = new LightModel({ mats, data: { cells: [], modules: [] } })
  const root = model.build(placement)
  // `placeLocal` puts the piece on its cell: (x + 0.5, y + 0.5, z + 1). The
  // recipe exports at a stable local origin, so rewind that placement once and
  // keep it in the manifest. The moulded geometry keeps its local height.
  const placementOffset = root.position.toArray()
  root.position.set(0, 0, 0)
  root.rotation.set(0, 0, 0)
  root.name = 'Light'

  const bounds = new THREE.Box3().setFromObject(root)
  for (const [name, position] of Object.entries(ANCHORS)) {
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
    // contain random UUIDs. This recipe exports full-detail source meshes.
    object.userData = {}
    if (!object.isMesh) return
    const count = object.geometry.index?.count ?? object.geometry.getAttribute('position').count
    triangles += count / 3
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      const name = names.get(material) ?? `lightMaterial${used.size}`
      material.name = name
      used.set(material, name)
      if (material.map) textures.add(material.map)
      if (material.transparent) alphaMaterials.add(name)
      // The builder leaves the housing/diffuser meshes unnamed; name them from
      // their material so the imported hierarchy is inspectable.
      if (!object.name) object.name = material === mats.lightDiffuser ? 'Diffuser' : 'Housing'
    }
  })
  assert.equal(used.size, 2, `${spec.variant}: expected the steel and diffuser materials`)

  const gltfRoot = new THREE.Group()
  gltfRoot.name = spec.rootName
  // Same basis contract as the bench and bin: source is Z-up, glTF is Y-up.
  gltfRoot.rotation.x = -Math.PI / 2
  gltfRoot.add(root)
  const bytes = new Uint8Array(await new GLTFExporter().parseAsync(gltfRoot, { binary: true }))
  const validation = await validator.validateBytes(bytes, { uri: spec.file })
  assert.equal(
    validation.issues.numErrors + validation.issues.numWarnings,
    0,
    `${spec.variant}: ${validation.issues.numErrors} errors, ${validation.issues.numWarnings} warnings — see validation.json`,
  )

  const manifest = {
    schemaVersion: 1,
    id: spec.id,
    catalogueId: spec.catalogueId,
    family: 'light',
    variant: spec.variant,
    file: spec.file,
    prefab: spec.prefab,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: 'game/src/render/models/pieces/LightModel.ts',
    sourcePaths: [
      'game/src/render/models/pieces/LightModel.ts',
      'game/src/render/models/PieceBuilder.ts',
      'game/src/sim/lights.ts',
      'game/src/sim/inCellPositions.ts',
      'game/src/sim/placement.ts',
    ],
    provenance: 'Repository procedural flush ceiling light (steel housing + palette diffuser); no third-party assets',
    units: 'metres',
    basisId: 'source-z-up-to-gltf-y-up',
    placement,
    placementOffset,
    parameters: {
      ceilingFallback: 4,
      ceiling: 'hangCeilingLocal with empty cells/modules: lightCeilingZ(5) - z(0) - 1 = 4 m above the cell floor top',
      position: 0,
      positionNote: 'Rectangular diffuser offsets inside the cell via inCellOffset(position, 0.8, 0.12); 0 is the centre. The circular light ignores it.',
      rot: 0,
      footprint: spec.footprint,
      lightDepth: 0.08,
      diffuserDepth: 0.01,
    },
    min: bounds.min.toArray(),
    max: bounds.max.toArray(),
    size: bounds.getSize(new THREE.Vector3()).toArray(),
    anchors: ANCHORS,
    triangles,
    materials: [...used.values()].sort(),
    alphaMaterials: [...alphaMaterials].sort(),
    textures: textures.size,
    materialExpectation,
    facade: 'none — a ceiling fitting; the luminous face points down (source local -z)',
    validation: {
      errors: validation.issues.numErrors,
      warnings: validation.issues.numWarnings,
      infos: validation.issues.numInfos,
      hints: validation.issues.numHints,
    },
  }
  await writeFile(join(out, spec.file), bytes)
  await writeFile(join(out, `${spec.id.split('.').slice(-2).join('-')}.manifest.json`), JSON.stringify(manifest, null, 2) + '\n')
  await writeFile(join(out, `${spec.variant}.validation.json`), JSON.stringify(validation, null, 2) + '\n')
  variants.push(manifest)
  console.log(`${spec.id}: ${triangles} triangles, ${manifest.materials.length} materials, ${manifest.textures} textures, ${bytes.length} bytes, ${manifest.sha256}`)
}

const summary = {
  schemaVersion: 1,
  family: 'light',
  source: 'game/src/render/models/pieces/LightModel.ts',
  exportCommand: 'node tools/unity-assets/export-light.mjs <out>',
  basisId: 'source-z-up-to-gltf-y-up',
  placementOffset: [0.5, 0.5, 1],
  parameters: {
    ceilingFallback: 4,
    position: 0,
    rot: 0,
  },
  materialExpectation,
  variants,
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(`LIGHT_EXPORT_OK ${variants.length} variants -> ${out}`)
