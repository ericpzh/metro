import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import validator from 'gltf-validator'
import { HangerModel } from '../../game/src/render/models/pieces/HangerModel.ts'
import { C } from '../../game/src/render/models/PieceBuilder.ts'
import { HANGER_BAR_TOP, HANGER_POST_BAR_TOP, hangerCells, hangerRoofZ } from '../../game/src/sim/hangers.ts'

const gameRequire = createRequire(new URL('../../game/package.json', import.meta.url))
const THREE = await import(new URL('../../game/node_modules/three/build/three.module.js', import.meta.url).href)
const { GLTFExporter } = await import(pathToFileURL(gameRequire.resolve('three/addons/exporters/GLTFExporter.js')).href)

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

// The catalogue entry is a 4 x 1 cell run, so `w` is the catalogue width.
// HangerModel reads one palette slot: `mats.steel`. The game kit's steel is a
// 64 px brushed canvas at 0.72 metalness; this fixture builds the same base
// colour as a solid satin material so the export stays texture-free and
// byte-reproducible (the brushed canvas calls Math.random per run). The
// metalness drop lets the review's studio lights read the faces without an IBL;
// it is recorded as a known deviation in the manifest and family report.
const STEEL = { color: C.steel, roughness: 0.4, metalness: 0.35 }
function createPalette() {
  return { steel: new THREE.MeshStandardMaterial({ ...STEEL, name: 'steel' }) }
}

const W = 4
const HANGER_ROT = 0

// `hangerRoofZ` only counts solid cells at or above the bar top, so the roof
// variant needs a real hall: floor cells at z=0 (the storey the hanger stands
// on) and a 4 x 4 roof module on the same storey. A plate roof's underside is
// `roof.z + 1 + TRUSS_ROOF_BASE` = 6 m, which is 1 m above the roof-mount bar
// top (z + 1 + 4 = 5 m). The empty-station fallback (`mod.z + 5`) would land
// exactly on the bar top and collapse the suspension rods to zero length.
const ROOF_MODULE = { type: 'roof', x: 0, y: 0, z: 0, w: 4, d: 4, rot: 0, cfg: {} }
const FLOOR_CELLS = Array.from({ length: W }, (_, x) => ({ x, y: 0, z: 0, fill: 'solid' }))
const stationData = (mount) => mount === 'roof'
  ? { cells: FLOOR_CELLS, modules: [ROOF_MODULE] }
  : { cells: [], modules: [] }

const variants = [
  {
    key: 'post',
    file: 'hanger-post.glb',
    prefab: 'HangerPost.prefab',
    id: 'station.hanger.post',
    paletteId: 'hanger-post',
    mount: 'post',
    stationNote: 'none: the post mount reads no cells or modules; the 3 m post stands on the floor',
  },
  {
    key: 'roof',
    file: 'hanger-roof.glb',
    prefab: 'HangerRoof.prefab',
    id: 'station.hanger.roof',
    paletteId: 'hanger-roof',
    mount: 'roof',
    stationNote: 'fixed representative hall: 4 floor cells at z=0 and one plate roof module (4 x 4 cells) at z=0',
  },
]

const sourcePaths = [
  'game/src/render/models/pieces/HangerModel.ts',
  'game/src/render/models/PieceBuilder.ts',
  'game/src/sim/hangers.ts',
]
const sourceSha256 = {}
for (const path of sourcePaths) sourceSha256[path] = createHash('sha256').update(await readFile(join(repo, path))).digest('hex')

const out = resolve(process.argv[2] ?? '.preview/unity/hanger-proof/export')
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
  const data = stationData(spec.mount)
  const mats = createPalette()
  const module = { type: 'hanger', x: 0, y: 0, z: 0, rot: HANGER_ROT, w: W, cfg: { mount: spec.mount } }
  const root = new HangerModel({ mats, data }).build(module)

  // `placeLocal` positions the piece at (x+0.5, y+0.5, z+1); export from a
  // stable local origin and record the placement offset once.
  const placementOffset = root.position.toArray()
  const placementRotation = root.rotation.toArray().slice(0, 3)
  root.position.set(0, 0, 0)
  root.rotation.set(0, 0, 0)

  const bounds = new THREE.Box3().setFromObject(root)
  // Basis anchors match the bench/bin recipes. The hanger is symmetric across
  // its bar (panels hang either way); `Front` is the shared basis marker.
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

  const names = new Map(Object.entries(mats).map(([name, material]) => [material, name]))
  const used = new Map()
  const alphaMaterials = new Set()
  const textures = new Set()
  const meshes = []
  let triangles = 0
  root.traverse(object => {
    // Renderer-only LOD metadata (`lowDetailGeometry`) contains random UUIDs.
    // This recipe exports the full-detail source meshes and keeps the detail
    // decision in the manifest.
    object.userData = {}
    if (!object.isMesh) return
    const count = object.geometry.index?.count ?? object.geometry.getAttribute('position').count
    assert.equal(count % 3, 0, `${spec.key}: ${object.name} geometry is not triangulated`)
    triangles += count / 3
    object.geometry.computeBoundingBox()
    meshes.push({
      name: object.name,
      triangles: count / 3,
      size: object.geometry.boundingBox.getSize(new THREE.Vector3()).toArray(),
    })
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      const name = names.get(material) ?? `hangerMaterial${used.size}`
      used.set(material, name)
      material.name = name
      if (material.map) textures.add(material.map)
      if (material.transparent) alphaMaterials.add(name)
    }
  })
  assert.equal(Number.isInteger(triangles), true, `${spec.key} triangle count is not an integer`)
  assert.equal(used.size, 1, `${spec.key}: expected the single steel material`)
  assert.deepEqual([...used.values()], ['steel'], `${spec.key}: unexpected material slot`)

  // Record the parameters that fixed the roof suspension so the review can
  // assert the document's intended length instead of an empty-station fallback.
  const run = hangerCells(module)
  const roofZ = spec.mount === 'roof'
    ? hangerRoofZ(data.cells, data.modules, module, run[0][0], run[0][1])
    : undefined
  const endRoofZ = spec.mount === 'roof'
    ? hangerRoofZ(data.cells, data.modules, module, run[run.length - 1][0], run[run.length - 1][1])
    : undefined
  if (spec.mount === 'roof') {
    assert.equal(roofZ, endRoofZ, 'roof variant endpoints resolve different ceilings')
    assert.equal(roofZ, ROOF_MODULE.z + 1 + 5, 'unexpected plate-roof underside (TRUSS_ROOF_BASE is 5 m)')
  }
  const barTopLocal = spec.mount === 'roof' ? HANGER_BAR_TOP : HANGER_POST_BAR_TOP
  const suspensionLength = roofZ === undefined ? null : Math.max(0, roofZ - (module.z + 1 + barTopLocal))

  const gltfRoot = new THREE.Group()
  gltfRoot.name = spec.mount === 'roof' ? 'HangerRoof' : 'HangerPost'
  // Source space is Z-up. The single export transform rotates it into glTF
  // Y-up, exactly as the bench and bin recipes do.
  gltfRoot.rotation.x = -Math.PI / 2
  gltfRoot.add(root)
  const bytes = new Uint8Array(await new GLTFExporter().parseAsync(gltfRoot, { binary: true }))
  const report = await validator.validateBytes(bytes, { uri: spec.file })
  const base = spec.file.replace(/\.glb$/, '')
  await writeFile(join(out, `${base}.validation.json`), JSON.stringify(report, null, 2) + '\n')
  assert.equal(report.issues.numErrors + report.issues.numWarnings, 0, `See ${base}.validation.json`)

  const materials = [...used.values()].sort()
  const manifest = {
    schemaVersion: 1,
    id: spec.id,
    paletteId: spec.paletteId,
    family: 'hanger',
    variant: spec.key,
    cfgMount: spec.mount,
    file: spec.file,
    prefab: spec.prefab,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: 'game/src/render/models/pieces/HangerModel.ts',
    sourcePaths,
    sourceSha256,
    provenance: 'Repository procedural steel hanger (bar, post or roof suspensions) and palette',
    units: 'metres',
    w: W,
    rot: HANGER_ROT,
    placementOffset,
    placementRotation,
    min: bounds.min.toArray(),
    max: bounds.max.toArray(),
    anchors,
    triangles,
    meshes,
    materials,
    alphaMaterials: [...alphaMaterials].sort(),
    textures: textures.size,
    materialSlots: {
      steel: {
        source: 'PieceBuilder.createModelMaterials().steel',
        baseColor: C.steel,
        baseColorCss: `#${C.steel.toString(16).padStart(6, '0')}`,
        roughness: STEEL.roughness,
        metalness: STEEL.metalness,
        sourceRoughness: 0.34,
        sourceMetalness: 0.72,
        note: 'The game steel carries a random brushed canvas map; this recipe exports a solid satin base colour so two exports are byte-identical. Metalness is lowered to read under studio diffuse light without an environment probe.',
      },
    },
    stationContext: {
      note: spec.stationNote,
      fixed: spec.mount === 'roof'
        ? {
            cells: data.cells,
            modules: [ROOF_MODULE],
            storeyHeightMetres: 5,
            roofModuleVariant: null,
            roofModuleMetres: '4 x 4 cells at z=0',
            roofUndersideZ: roofZ,
            barTopZ: module.z + 1 + barTopLocal,
            suspensionLengthMetres: suspensionLength,
            why: 'A plate roof sits TRUSS_ROOF_BASE (5 m) above its storey floor top, so its underside is 6 m: 1 m above the roof-mount bar top. A solid ceiling slab at the standard 5 m storey would instead meet the bar top and draw zero-length rods.',
          }
        : null,
    },
    // JsonUtility (the Unity importer) reads plain numbers, not nullable ones,
    // so the absent suspension is a zero plus an explicit flag.
    hasSuspension: suspensionLength !== null,
    roofZ: roofZ ?? 0,
    barTopLocal,
    suspensionLength: suspensionLength ?? 0,
    validation: { errors: report.issues.numErrors, warnings: report.issues.numWarnings },
  }
  await writeFile(join(out, spec.file), bytes)
  await writeFile(join(out, `${base}.manifest.json`), JSON.stringify(manifest, null, 2) + '\n')
  assets.push(manifest)
  console.log(`${spec.id}: ${triangles} triangles, ${materials.length} materials, ${textures.size} textures, bounds ${manifest.min.map(n => n.toFixed(3)).join(',')} -> ${manifest.max.map(n => n.toFixed(3)).join(',')}, ${bytes.length} bytes, ${manifest.sha256}${suspensionLength === null ? '' : `, suspension ${suspensionLength} m`}`)
}

const summary = {
  schemaVersion: 1,
  family: 'hanger',
  catalogueIds: variants.map(v => v.paletteId),
  exporter: 'tools/unity-assets/export-hanger.mjs',
  sourcePaths,
  sourceSha256,
  parameters: {
    w: W,
    rot: HANGER_ROT,
    cellsPerMetre: 1,
    barDepthMetres: 0.2,
    postBarTopMetres: HANGER_POST_BAR_TOP,
    roofBarTopMetres: HANGER_BAR_TOP,
    postOffsetMetres: 0.17,
    postVariantStationData: 'none: { cells: [], modules: [] }',
    roofVariantStationData: 'fixed hall: 4 solid floor cells at z=0 plus one 4 x 4 plate roof module at z=0 (underside 6 m)',
    roofVariantSuspensionMetres: assets.find(a => a.variant === 'roof')?.suspensionLength ?? null,
    basis: 'source Z-up tree wrapped in a group rotated -90 degrees about X (glTF Y-up); the Unity wrapper applies the 180-degree Y correction so Unity axes read (x, z, y)',
    palette: 'steel only',
    textures: 'none: solid satin steel material, no canvas maps',
  },
  assets,
  validation: {
    errors: assets.reduce((sum, asset) => sum + asset.validation.errors, 0),
    warnings: assets.reduce((sum, asset) => sum + asset.validation.warnings, 0),
  },
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(`hanger: ${assets.length} variants, ${summary.validation.errors} errors, ${summary.validation.warnings} warnings`)
