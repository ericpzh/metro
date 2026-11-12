import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import validator from 'gltf-validator'
import { CctvModel } from '../../game/src/render/models/pieces/CctvModel.ts'
import { C } from '../../game/src/render/models/PieceBuilder.ts'

const gameRequire = createRequire(new URL('../../game/package.json', import.meta.url))
const THREE = await import(new URL('../../game/node_modules/three/build/three.module.js', import.meta.url).href)
const { GLTFExporter } = await import(pathToFileURL(gameRequire.resolve('three/addons/exporters/GLTFExporter.js')).href)

// CctvModel reads five palette slots: steel, darkSteel, white, black and the
// tinted glass it clones for the lens / smoke dome / optical window. Build only
// those here instead of the full 60-material palette (which needs canvases).
// The steel canvas is a 64 px brushed map; the fixture uses the same base colour
// as a solid material, so the recipe stays texture-free.
function createPalette() {
  return {
    steel: new THREE.MeshStandardMaterial({ color: C.steel, roughness: 0.34, metalness: 0.72, name: 'steel' }),
    darkSteel: new THREE.MeshStandardMaterial({ color: C.darkSteel, roughness: 0.55, metalness: 0.4, name: 'darkSteel' }),
    white: new THREE.MeshStandardMaterial({ color: C.white, roughness: 0.45, metalness: 0.05, name: 'white' }),
    black: new THREE.MeshStandardMaterial({ color: C.black, roughness: 0.6, metalness: 0.2, name: 'black' }),
    tintedGlass: new THREE.MeshStandardMaterial({
      color: 0x8fb6c4, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.4, side: THREE.DoubleSide, name: 'tintedGlass',
    }),
  }
}

// `cfg.variant` values the source builder branches on. `undefined` is the 枪机
// bullet camera (the bare palette id `cctv`). The post variant passes a fixed
// 4 m mount; every ceiling variant reads the hung-ceiling height, which is 4 m
// for a station with no slab over the cell (`STOREY_HEIGHT 5 - 1`).
const variants = [
  { key: 'bullet', cfgVariant: undefined, file: 'cctv.glb', prefab: 'Cctv.prefab', paletteId: 'cctv', id: 'station.cctv.bullet' },
  { key: 'dome', cfgVariant: 'dome', file: 'cctv-dome.glb', prefab: 'CctvDome.prefab', paletteId: 'cctv-dome', id: 'station.cctv.dome' },
  { key: 'ptz', cfgVariant: 'ptz', file: 'cctv-ptz.glb', prefab: 'CctvPtz.prefab', paletteId: 'cctv-ptz', id: 'station.cctv.ptz' },
  { key: 'post', cfgVariant: 'post', file: 'cctv-post.glb', prefab: 'CctvPost.prefab', paletteId: 'cctv-post', id: 'station.cctv.post' },
]

const CEILING_HEIGHT = 4
const POST_MOUNT_HEIGHT = 4
const out = resolve(process.argv[2] ?? '.preview/unity/cctv-proof/export')
await mkdir(out, { recursive: true })

globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => {
      this.result = result
      this.onloadend?.()
    })
  }
}

const assets = []
for (const spec of variants) {
  const mats = createPalette()
  const root = new CctvModel({
    mats,
    // Empty station document: no slab or track deck overhead, so the hung-ceiling
    // fallback resolves to 4 m. `ads` is unused by this builder but part of the
    // shared module context contract.
    data: { cells: [], modules: [] },
    ads: {},
  }).build({ type: 'cctv', x: 0, y: 0, z: 0, rot: 0, cfg: { variant: spec.cfgVariant } })

  // `placeLocal` positions the piece at (x+0.5, y+0.5, z+1); export from a
  // stable local origin and record the placement offset once.
  const placementOffset = root.position.toArray()
  root.position.set(0, 0, 0)
  root.rotation.set(0, 0, 0)

  const bounds = new THREE.Box3().setFromObject(root)
  // Basis anchors match the bench/bin recipes. `Approach` records the piece's
  // own front: the camera head, lens and optical panel face local -y.
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

  const paletteNames = new Map(Object.entries(mats).map(([name, material]) => [material, name]))
  const used = new Map()
  const named = new Set()
  const alphaMaterials = new Set()
  const glassMaterials = new Set()
  const textures = new Set()
  let triangles = 0
  let meshes = 0
  root.traverse(object => {
    // Renderer-only LOD metadata contains random UUIDs. This recipe exports the
    // full-detail source meshes and keeps its metadata in the manifest.
    object.userData = {}
    if (!object.isMesh) return
    meshes++
    triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      let name = used.get(material)
      if (!name) {
        name = paletteNames.get(material)
        if (!name) {
          // Clones the builder mints from `mats.tintedGlass`: the bullet's flat
          // optical window is deliberately opaque, the dome/PTZ smoke shell is
          // transparent. Name them by their authored colour so the recipe is
          // deterministic and Unity can assert the queue of each.
          const hex = material.color?.getHex()
          name = hex === 0x274b62 ? 'cctvOpticalGlass'
            : hex === 0x505960 ? 'cctvSmokeGlass'
              : (material.name || 'cctvMaterial')
        }
        if (named.has(name)) {
          let suffix = 2
          while (named.has(`${name}${suffix}`)) suffix++
          name = `${name}${suffix}`
        }
        used.set(material, name)
        named.add(name)
        material.name = name
      }
      if (name.includes('Glass')) glassMaterials.add(name)
      if (material.transparent) alphaMaterials.add(name)
      if (material.map) textures.add(material.map)
    }
  })
  assert.equal(Number.isInteger(triangles), true, `${spec.key} triangle count is not an integer`)

  const gltfRoot = new THREE.Group()
  gltfRoot.name = spec.key === 'bullet' ? 'Cctv' : `Cctv${spec.key[0].toUpperCase()}${spec.key.slice(1)}`
  // Source space is Z-up. The single export transform rotates it into glTF
  // Y-up, exactly as the bench and bin recipes do.
  gltfRoot.rotation.x = -Math.PI / 2
  gltfRoot.add(root)
  const bytes = new Uint8Array(await new GLTFExporter().parseAsync(gltfRoot, { binary: true }))
  const report = await validator.validateBytes(bytes, { uri: spec.file })
  await writeFile(join(out, `${spec.file.replace(/\.glb$/, '')}.validation.json`), JSON.stringify(report, null, 2) + '\n')
  assert.equal(report.issues.numErrors + report.issues.numWarnings, 0, `See ${spec.file.replace(/\.glb$/, '')}.validation.json`)

  const materials = [...used.values()].sort()
  const manifest = {
    schemaVersion: 1,
    id: spec.id,
    paletteId: spec.paletteId,
    family: 'cctv',
    variant: spec.key,
    cfgVariant: spec.cfgVariant ?? null,
    file: spec.file,
    prefab: spec.prefab,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: 'game/src/render/models/pieces/CctvModel.ts',
    provenance: 'Repository procedural 监控 / CCTV geometry and palette (bullet, dome, PTZ and post variants)',
    units: 'metres',
    placementOffset,
    min: bounds.min.toArray(),
    max: bounds.max.toArray(),
    anchors,
    triangles,
    meshes,
    materials,
    alphaMaterials: [...alphaMaterials].sort(),
    glassMaterials: [...glassMaterials].sort(),
    textures: textures.size,
    facade: 'local -y',
    ceilingHeight: CEILING_HEIGHT,
    postMountHeight: spec.key === 'post' ? POST_MOUNT_HEIGHT : 0,
    validation: { errors: report.issues.numErrors, warnings: report.issues.numWarnings },
  }
  await writeFile(join(out, spec.file), bytes)
  await writeFile(join(out, `${spec.file.replace(/\.glb$/, '')}.manifest.json`), JSON.stringify(manifest, null, 2) + '\n')
  assets.push(manifest)
  console.log(`${spec.id}: ${triangles} triangles, ${materials.length} materials (${manifest.alphaMaterials.length} alpha), ${textures.size} textures, ${bytes.length} bytes, ${manifest.sha256}`)
}

const summary = {
  schemaVersion: 1,
  family: 'cctv',
  sourcePaths: [
    'game/src/render/models/pieces/CctvModel.ts',
    'game/src/render/models/PieceBuilder.ts',
    'game/src/sim/placement.ts',
  ],
  parameters: {
    stationData: 'empty station document: { cells: [], modules: [] }',
    ceilingHeightMetres: CEILING_HEIGHT,
    ceilingSource: 'hangCeilingLocal fallback `STOREY_HEIGHT (5) - 1` for a piece with no slab or deck overhead',
    postMountMetres: POST_MOUNT_HEIGHT,
    postMountSource: 'buildPost calls buildPtz(mats, 4) and adds a 3.84 m guidepost pole',
    variantValues: { cctv: 'undefined (bullet / 枪机)', 'cctv-dome': 'dome', 'cctv-ptz': 'ptz', 'cctv-post': 'post' },
    basis: 'source Z-up tree wrapped in a group rotated -90 degrees about X (glTF Y-up); Unity wrapper applies the 180-degree Y correction',
    palette: 'steel, darkSteel, white, black, tintedGlass (cloned by the builder for the lens, smoke dome and optical window)',
    textures: 'none: the recipe constructs solid palette materials, so no canvas maps are exported',
  },
  assets,
  validation: {
    errors: assets.reduce((sum, asset) => sum + asset.validation.errors, 0),
    warnings: assets.reduce((sum, asset) => sum + asset.validation.warnings, 0),
  },
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(`cctv: ${assets.length} variants, ${summary.validation.errors} errors, ${summary.validation.warnings} warnings`)
