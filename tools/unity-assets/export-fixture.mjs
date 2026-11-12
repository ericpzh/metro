import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Canvas, ImageData, createCanvas } from '@napi-rs/canvas'
import validator from 'gltf-validator'

// The 固定设施 (fixture) family: the ten bench, desk and plant-room pieces the
// station palette offers. Each asset is the game's own module builder output for
// one module placed at a stable local origin:
//
//   bench-office-1   office chair        (BenchModel → OfficeChair)
//   bench-seat-1     backed 1 m seat     (BenchModel → seatBench)
//   bench-steel-1/2  stainless platform bench, 1 m / 2 m
//   bench-wood-1/2   timber slat bench, 1 m / 2 m
//   desk             control-room desk with its chair
//   ac-unit          floor-standing chiller
//   vent             flush ceiling grille
//   electrical-cabinet  three-bay switchboard
//
// `bench-seat-2` is already shipped as Bench.prefab by the batch-1 bench row;
// this family deliberately does not redefine it.
//
// The palette prints a 64 px brushed-steel grain (`brushedCanvas` scatters 700
// lines with Math.random) and the desk prints a 256 x 160 desktop-screen canvas.
// Two exports must be byte-identical, so the grain is drawn from a fixed-seed
// generator; the desktop screen draws from constants only.
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
// export-bench/bin/shelf: shadow `data` or GLTFExporter treats every canvas as
// a DataTexture and writes transparent black.
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
// Imported after the seeded Math.random so the palette's brushed-steel grain is
// identical in every run.
const { createModelMaterials } = await import('../../game/src/render/models/PieceBuilder.ts')
const { createModule } = await import('../../game/src/build/model/Equipment.ts')
const { buildModule } = await import('../../game/src/render/models.ts')
const { benchSpec } = await import('../../game/src/sim/benches.ts')
const { VENT_DEPTH, VENT_WIDTH } = await import('../../game/src/sim/vents.ts')

/**
 * The ten family models, in review-row order. `source` is the builder that draws
 * the piece, `cells` the floor cells the module reserves along its local +x,
 * `facade` the side the piece is used from (source axes), and `size` the
 * documented source-space bounds the recipe must reproduce (metres, 2 cm gate).
 */
const MODELS = [
  {
    paletteId: 'bench-office-1', prefab: 'BenchOffice1', id: 'station.bench.office-1', variant: 'office-1',
    style: 'office', cells: 1, facade: 'local +y (sitter enters from +y)',
    size: [0.42, 0.40, 0.98], source: 'game/src/render/models/pieces/BenchModel.ts',
    provenance: 'Repository procedural office-chair geometry and palette (darkSteel frame, rubber seat)',
  },
  {
    paletteId: 'bench-seat-1', prefab: 'BenchSeat1', id: 'station.bench.seat-1', variant: 'seat-1',
    style: 'seat', cells: 1, facade: 'local +y (back on local -y)',
    size: [1.04, 0.685, 1.105], source: 'game/src/render/models/pieces/BenchModel.ts',
    provenance: 'Repository procedural upholstered one-seat bench geometry and palette',
  },
  {
    paletteId: 'bench-steel-1', prefab: 'BenchSteel1', id: 'station.bench.steel-1', variant: 'steel-1',
    style: 'steel', cells: 1, facade: 'local +y (front apron, no back)',
    size: [0.90, 0.415, 0.49], source: 'game/src/render/models/pieces/BenchModel.ts',
    provenance: 'Repository procedural stainless platform-bench geometry and palette',
  },
  {
    paletteId: 'bench-steel-2', prefab: 'BenchSteel2', id: 'station.bench.steel-2', variant: 'steel-2',
    style: 'steel', cells: 2, facade: 'local +y (front apron, no back)',
    size: [1.90, 0.415, 0.49], source: 'game/src/render/models/pieces/BenchModel.ts',
    provenance: 'Repository procedural stainless platform-bench geometry and palette',
  },
  {
    paletteId: 'bench-wood-1', prefab: 'BenchWood1', id: 'station.bench.wood-1', variant: 'wood-1',
    style: 'wood', cells: 1, facade: 'symmetric (no back)',
    size: [0.90, 0.645, 0.49], source: 'game/src/render/models/pieces/BenchModel.ts',
    provenance: 'Repository procedural timber-slat bench geometry and palette',
  },
  {
    paletteId: 'bench-wood-2', prefab: 'BenchWood2', id: 'station.bench.wood-2', variant: 'wood-2',
    style: 'wood', cells: 2, facade: 'symmetric (no back)',
    size: [1.90, 0.645, 0.49], source: 'game/src/render/models/pieces/BenchModel.ts',
    provenance: 'Repository procedural timber-slat bench geometry and palette',
  },
  {
    paletteId: 'desk', prefab: 'Desk', id: 'station.desk.standard', variant: null,
    style: 'desk', cells: 1, facade: 'local -y (operator and chair on -y)',
    size: [0.98, 0.965, 1.22], source: 'game/src/render/models/pieces/DeskModel.ts',
    provenance: 'Repository procedural control-room desk geometry, palette and desktop-screen canvas',
  },
  {
    paletteId: 'ac-unit', prefab: 'AcUnit', id: 'station.ac-unit.standard', variant: null,
    style: 'ac-unit', cells: 3, facade: 'symmetric (coil grilles front and back)',
    size: [2.88, 1.975, 2.70], source: 'game/src/render/models/pieces/AcUnitModel.ts',
    provenance: 'Repository procedural rooftop-chiller geometry and palette (coil banks, twin fans, pipes)',
  },
  {
    paletteId: 'vent', prefab: 'Vent', id: 'station.vent.standard', variant: null,
    style: 'vent', cells: 1, facade: 'symmetric (flush ceiling grille)',
    size: [VENT_WIDTH, VENT_WIDTH, VENT_DEPTH], source: 'game/src/render/models/pieces/VentModel.ts',
    provenance: 'Repository procedural ceiling-grille geometry and palette',
  },
  {
    paletteId: 'electrical-cabinet', prefab: 'ElectricalCabinet', id: 'station.electrical-cabinet.standard', variant: null,
    style: 'electrical-cabinet', cells: 3, facade: 'local -y (doors, meters and breakers on -y)',
    size: [2.95, 0.9475, 2.20], source: 'game/src/render/models/pieces/ElectricalCabinetModel.ts',
    provenance: 'Repository procedural three-bay switchboard geometry and palette (red fascia, meters, breakers)',
  },
].map(spec => ({ ...spec, file: `${spec.paletteId}.glb` }))

const mats = createModelMaterials()
const paletteNames = new Map(Object.entries(mats).map(([name, material]) => [material, name]))
// Empty station document: no neighbours, no slab over the cell and no track
// deck. The vent therefore reads its fallback ceiling line (`STOREY_HEIGHT - 1`
// = 4 m) and the bench takes its standalone edge inset.
const data = { cells: [], modules: [], lines: [], name: 'Station', nameEn: 'Station' }
const ctx = {
  mats, data, ads: {}, trackCells: new Set(),
  finish: (name) => (name === 'granite' ? mats.steel : mats.darkSteel),
}

/** The module type each palette id must create. */
const MODULE_TYPE = {
  'bench-office-1': 'bench', 'bench-seat-1': 'bench', 'bench-steel-1': 'bench', 'bench-steel-2': 'bench',
  'bench-wood-1': 'bench', 'bench-wood-2': 'bench',
  desk: 'desk', 'ac-unit': 'ac-unit', vent: 'vent', 'electrical-cabinet': 'electrical-cabinet',
}

const out = resolve(process.argv[2] ?? '.preview/unity/fixture-proof/export')
await mkdir(out, { recursive: true })

const assets = []
for (const spec of MODELS) {
  const mod = createModule(spec.paletteId, 0, 0, 0, `proof-${spec.paletteId}`, 0)
  assert.ok(mod, `${spec.paletteId}: createModule returned null`)
  assert.equal(mod.type, MODULE_TYPE[spec.paletteId], `${spec.paletteId}: expected ${MODULE_TYPE[spec.paletteId]}, got ${mod.type}`)
  if (spec.variant) assert.equal(mod.cfg.variant, spec.variant, `${spec.paletteId}: builder variant ${mod.cfg.variant}`)
  if (spec.variant !== null) assert.equal(mod.w, spec.cells, `${spec.paletteId}: module reserves ${mod.w} cells`)
  const root = buildModule(mod, ctx)
  assert.ok(root, `${spec.paletteId}: buildModule returned null`)

  // The builders place the piece on its cell with placeLocal (cell corner plus
  // half a cell, floor at z+1) or the bench's own edge inset. Export from a
  // stable module-local origin and record the placement once.
  const placementOffset = root.position.toArray()
  root.position.set(0, 0, 0)
  root.rotation.set(0, 0, 0)
  root.updateMatrixWorld(true)

  // Strip renderer-only LOD metadata (random UUIDs) now: this recipe exports the
  // full-detail source meshes and keeps its metadata in the manifest.
  const used = new Map()
  const named = new Set()
  const alphaMaterials = new Set()
  const glassMaterials = new Set()
  const textures = new Set()
  let triangles = 0
  let meshes = 0
  root.traverse(object => {
    object.userData = {}
    if (!object.isMesh) return
    meshes++
    triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      let name = used.get(material)
      if (!name) {
        // Every material in this family is a palette slot: the builders clone
        // none and print none of their own.
        name = paletteNames.get(material)
        assert.ok(name, `${spec.paletteId}: unnamed material ${material.type} #${material.color?.getHexString()}`)
        assert.ok(!named.has(name), `${spec.paletteId}: duplicate palette material ${name}`)
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

  // Source-space bounds, before the glTF Z-up -> Y-up wrapper.
  const bounds = new THREE.Box3().setFromObject(root)
  const size = bounds.getSize(new THREE.Vector3())
  for (const [axis, expected] of ['x', 'y', 'z'].map((axis, index) => [axis, spec.size[index]])) {
    const actual = size[axis]
    assert.ok(Math.abs(actual - expected) < 0.02,
      `${spec.paletteId}: ${axis} size ${actual.toFixed(4)} != documented ${expected}`)
  }
  // Floor-standing pieces start on the tile floor; the vent hangs off it.
  if (spec.style !== 'vent') assert.ok(Math.abs(bounds.min.z) < 1e-6, `${spec.paletteId}: floor piece starts at z=0, got ${bounds.min.z}`)
  else {
    assert.ok(Math.abs(bounds.max.z - 4) < 1e-6, `${spec.paletteId}: vent hangs from the 4 m fallback ceiling, got ${bounds.max.z}`)
    assert.ok(Math.abs(size.z - VENT_DEPTH) < 0.001, `${spec.paletteId}: vent is a ${VENT_DEPTH} m plate, got ${size.z}`)
  }
  // The bench run grows along +x from its centred origin; the plant-room pieces
  // are built from their cell corner.
  const [ox, oy] = placementOffset
  assert.ok(Math.abs(ox - (spec.variant !== null ? 0.5 + (spec.cells - 1) / 2 : 0.5)) < 1e-6, `${spec.paletteId}: placement x ${ox}`)
  assert.ok(Math.abs(oy - (spec.variant !== null ? 0.575 : 0.5)) < 1e-6, `${spec.paletteId}: placement y ${oy}`)
  assert.equal(placementOffset[2], 1, `${spec.paletteId}: placement z ${placementOffset[2]}`)

  // Basis anchors, shared with bench/bin/cctv/shelf/glass. The piece's own front
  // is recorded per asset in `facade`; these four are the basis contract.
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

  const materials = [...used.values()].sort()
  const gltfRoot = new THREE.Group()
  gltfRoot.name = spec.prefab
  // Source space is Z-up. The single export transform rotates it into glTF
  // Y-up, exactly as the bench, bin, cctv and shelf recipes do.
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

  const bench = spec.variant !== null ? benchSpec(spec.variant) : null
  const parameters = {
    rot: 0,
    cells: spec.cells,
    facade: spec.facade,
    style: spec.style,
    variant: spec.variant,
    placement: spec.variant !== null
      ? 'bench run centred on its cells: x + 0.5 + (cells - 1) / 2, edge inset 0.5 - 0.85 / 2 on local -y, floor at z + 1'
      : 'placeLocal: cell corner + 0.5 in x and y, floor at z + 1',
    ...(bench ? { benchStyle: bench.style, runMetres: bench.w === 1 ? 0.9 : 1.9 } : {}),
    ...(spec.style === 'vent' ? { ceilingMetres: 4, plateThicknessMetres: VENT_DEPTH } : {}),
  }

  const manifest = {
    schemaVersion: 1,
    id: spec.id,
    catalogueId: spec.paletteId,
    paletteId: spec.paletteId,
    family: 'fixture',
    variant: spec.variant ?? 'standard',
    style: spec.style,
    prefab: spec.prefab,
    file: spec.file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: spec.source,
    provenance: spec.provenance,
    licenseRecord: 'Repository-authored procedural geometry; no third-party assets',
    units: 'metres',
    placementOffset,
    min: bounds.min.toArray(),
    max: bounds.max.toArray(),
    size: size.toArray(),
    anchors,
    facade: spec.facade,
    footprintCells: spec.cells,
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
    `${spec.id}: ${triangles} triangles, ${meshes} meshes, ${materials.length} materials ` +
      `(${manifest.alphaMaterials.length} alpha), ${textures.size} textures, ` +
      `${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)} m, ${bytes.length} bytes, ${manifest.sha256}`,
  )
}

const summary = {
  schemaVersion: 1,
  family: 'fixture',
  sourcePaths: [
    'game/src/render/models/pieces/BenchModel.ts',
    'game/src/render/models/pieces/OfficeChair.ts',
    'game/src/render/models/pieces/DeskModel.ts',
    'game/src/render/models/pieces/AcUnitModel.ts',
    'game/src/render/models/pieces/VentModel.ts',
    'game/src/render/models/pieces/ElectricalCabinetModel.ts',
    'game/src/render/models/PieceBuilder.ts',
    'game/src/build/model/Equipment.ts',
    'game/src/render/models.ts',
    'game/src/sim/benches.ts',
    'game/src/sim/vents.ts',
  ],
  parameters: {
    models: MODELS.length,
    rot: 0,
    stationData: 'empty station document: { cells: [], modules: [], lines: [] }',
    placement: 'each builder places its piece with placeLocal (cell corner + 0.5 in x and y, floor at z + 1); the bench run adds (cells - 1) / 2 in x and its 0.075 m edge inset in y. The root offset is recorded and removed, so every GLB is exported at the module-local origin',
    palette: 'createModelMaterials(): steel (64 px brushed canvas map), darkSteel, black, rubber, white, wood, woodLight, trainSeat, gateRed (transparent 0.82, double sided), green, orange, desktopScreen (256 x 160 canvas)',
    textures: 'one 64 px brushed-steel canvas map used by every steel-faced piece (the grain is drawn from a fixed-seed generator so the exported PNG is byte-stable) and the desk’s 256 x 160 desktop-screen canvas; the timber, seat, chair and white-frame pieces are texture-free',
    basis: 'source Z-up tree wrapped in a group rotated -90 degrees about X (glTF Y-up); Unity wrapper applies the 180-degree Y correction so gameplay channels read (x, z, y)',
    anchors: 'AxisX +X, Front +Y, Up +Z, Approach -Y in source space; each asset records its own usable facade',
    benchFamilies: 'bench variants carry their own cfg from sim/benches.ts: steel (1 or 2 cells), seat (1 or 2 cells), wood (1 or 2 cells) and office (one chair); bench-seat-2 stays with the batch-1 Bench.prefab row',
    // Arrays, not a map: Unity's JsonUtility cannot deserialize dictionaries.
    benchSpecs: MODELS.filter(spec => spec.variant !== null).map(spec => {
      const values = benchSpec(spec.variant)
      return {
        paletteId: spec.paletteId,
        variant: values.variant,
        style: values.style,
        cells: values.w,
        runMetres: values.w === 1 ? 0.9 : 1.9,
      }
    }),
  },
  assets,
  validation: {
    errors: assets.reduce((sum, asset) => sum + asset.validation.errors, 0),
    warnings: assets.reduce((sum, asset) => sum + asset.validation.warnings, 0),
  },
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(`FIXTURE_EXPORT_OK ${assets.length} models, ${summary.validation.errors} errors, ${summary.validation.warnings} warnings -> ${out}`)
