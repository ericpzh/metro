import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Canvas, ImageData, createCanvas } from '@napi-rs/canvas'
import validator from 'gltf-validator'

// The printed-surface family: the two marked courts and their fabric divider,
// the three printed floor vinyls, the two wayfinding signs and the two line
// network maps. Each asset is the game's own builder output for one placed
// module at a stable local origin (`createModule` + `buildModule`).
//
// The family is the first that mixes opaque palette geometry with printed
// canvas faces, so three export concerns are explicit here:
//
//  * the palette's brushed-steel canvas draws grain with `Math.random`, seeded
//    below before PieceBuilder is imported so the exported PNG is byte-stable;
//  * the floor-mark vinyl, the sign face and the line-map board are canvases
//    that `@napi-rs/canvas` encodes asynchronously. A build can carry two of
//    them (a lit face plus the brushed-steel grain), and the GLB's image
//    bufferViews are appended in encode-completion order, so the encodes are
//    serialised below or two exports could disagree byte for byte;
//  * the sign and line-map builders accept `ctx.signFace` / `ctx.lineMapFace`
//    overrides. They are omitted on purpose: the export is the neutral default
//    face the palette mints, and the dynamic station content stays a runtime
//    binding (`dynamic-station-panels`).
//
// Determinism: no dates, no UUIDs in the output (every `userData` is stripped),
// stable material order, and a repeat export must be byte-identical.
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

// The palette prints its canvas textures through the DOM. Shadow `data` or
// GLTFExporter treats every canvas as a DataTexture and writes transparent
// black (the `@napi-rs/canvas` note in the asset skill).
let encodeQueue = Promise.resolve()
globalThis.HTMLCanvasElement = Canvas
globalThis.ImageData = ImageData
globalThis.document = {
  createElement(name) {
    assert.equal(name, 'canvas')
    const canvas = createCanvas(1, 1)
    Object.defineProperty(canvas, 'data', { value: undefined })
    canvas.toBlob = (callback, mime) => {
      // Serialise the encodes: GLTFExporter pushes every `getToBlobPromise` in
      // traversal order but appends the bufferViews as each resolves, so two
      // canvases in one build would race without this queue.
      const job = async () => {
        const bytes = await canvas.encode(mime === 'image/jpeg' ? 'jpeg' : 'png')
        callback(new Blob([bytes], { type: mime }))
      }
      encodeQueue = encodeQueue.then(job, job)
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
const { floorDecorSpec } = await import('../../game/src/sim/floorDecor.ts')
const { mountedSignBoards, signBoardsOf, signBoardsPanel, signMountSpec } = await import('../../game/src/sim/sign.ts')
const { hangCeilingLocal } = await import('../../game/src/sim/placement.ts')
const { lineMapSpec } = await import('../../game/src/sim/linemaps.ts')

/**
 * The ten family models in review-row order. `kind` names the builder family,
 * `variant` the `cfg` value that selects it (`cfg.variant` for the courts and
 * floor marks, `cfg.mount` for the signs and line maps). `width`, `depth` and
 * `height` are the source-space extents the reviewed geometry must keep; they
 * are checked after the build so a builder change cannot drift silently.
 */
const MODELS = [
  { paletteId: 'court-badminton', prefab: 'CourtBadminton', id: 'station.court.badminton', kind: 'court', variant: 'badminton', width: 14, depth: 7, height: 1.6, textures: 0, lines: 1, pitch: 8 },
  { paletteId: 'court-divider', prefab: 'CourtDivider', id: 'station.court.divider', kind: 'court', variant: 'divider', width: 1.94, depth: 0.82, height: 1, textures: 0, lines: 0, pitch: 8 },
  { paletteId: 'court-pickleball', prefab: 'CourtPickleball', id: 'station.court.pickleball', kind: 'court', variant: 'pickleball', width: 14, depth: 7, height: 0.95, textures: 0, lines: 1, pitch: 8 },
  { paletteId: 'floor-mark-boarding', prefab: 'FloorMarkBoarding', id: 'station.floor-mark.boarding', kind: 'floor-mark', variant: 'boarding', width: 3, depth: 0.25, height: 0, textures: 1, lines: 0, pitch: 3 },
  { paletteId: 'floor-mark-direction', prefab: 'FloorMarkDirection', id: 'station.floor-mark.direction', kind: 'floor-mark', variant: 'direction', width: 1, depth: 2, height: 0, textures: 1, lines: 0, pitch: 3 },
  { paletteId: 'floor-mark-waiting', prefab: 'FloorMarkWaiting', id: 'station.floor-mark.waiting', kind: 'floor-mark', variant: 'waiting', width: 3, depth: 2, height: 0, textures: 1, lines: 0, pitch: 3 },
  { paletteId: 'sign-ceiling', prefab: 'SignCeiling', id: 'station.sign.ceiling', kind: 'sign', variant: 'ceiling', width: 1.9, depth: 0.16, height: 0.85, textures: 2, lines: 0, pitch: 3 },
  { paletteId: 'sign-wall', prefab: 'SignWall', id: 'station.sign.wall', kind: 'sign', variant: 'wall', width: 1.9, depth: 0, height: 0.4, textures: 1, lines: 0, pitch: 3 },
  { paletteId: 'linemap-stand', prefab: 'LinemapStand', id: 'station.linemap.stand', kind: 'linemap', variant: 'stand', width: 1.86, depth: 0.62, height: 2.28, textures: 2, lines: 0, pitch: 3 },
  { paletteId: 'linemap-wall', prefab: 'LinemapWall', id: 'station.linemap.wall', kind: 'linemap', variant: 'wall', width: 1.92, depth: 0.18, height: 1.94, textures: 2, lines: 0, pitch: 3 },
].map(spec => ({ ...spec, file: `${spec.paletteId}.glb` }))

const mats = createModelMaterials()
// Empty station document: no neighbours, no slab over the cell and no track
// deck, so the hung sign resolves its ceiling to the `STOREY_HEIGHT - 1`
// fallback (3 m local) and the line-map board is centred on its two-cell run.
const data = { cells: [], modules: [], lines: [], name: 'Station', nameEn: 'Station' }
const ctx = {
  mats, data, ads: {}, trackCells: new Set(),
  finish: (name) => (name === 'granite' ? mats.steel : mats.darkSteel),
}
const paletteNames = new Map(Object.entries(mats).map(([name, material]) => [material, name]))

const out = resolve(process.argv[2] ?? '.preview/unity/printed-proof/export')
await mkdir(out, { recursive: true })

const assets = []
const panels = []
for (const spec of MODELS) {
  const mod = createModule(spec.paletteId, 0, 0, 0, `proof-${spec.paletteId}`, 0)
  assert.ok(mod, `${spec.paletteId}: createModule returned null`)
  assert.equal(mod.type, spec.kind, `${spec.paletteId}: expected a ${spec.kind} module, got ${mod.type}`)
  const selector = spec.kind === 'sign' || spec.kind === 'linemap' ? mod.cfg.mount : mod.cfg.variant
  assert.equal(selector, spec.variant, `${spec.paletteId}: builder selector ${selector}`)

  const root = buildModule(mod, ctx)
  assert.ok(root, `${spec.paletteId}: buildModule returned null`)

  // `placeLocal` (and the line map's own run centring) positions the piece at
  // its cell. Export from a stable local origin and record the placement once.
  const placementOffset = root.position.toArray()
  root.position.set(0, 0, 0)
  root.rotation.set(0, 0, 0)
  root.updateMatrixWorld(true)

  // The courts' net is `LineSegments` with a `LineBasicMaterial`, which
  // GLTFExporter only accepts with a warning ("use MeshStandardMaterial or
  // MeshBasicMaterial"). The net is unlit ink in the game, so swap the material
  // for the equivalent unlit `MeshBasicMaterial`; the glTF primitive keeps its
  // LINES topology and the colour is unchanged.
  root.traverse(object => {
    const material = object.isLine === true ? object.material : null
    if (!material || !material.isLineBasicMaterial) return
    object.material = new THREE.MeshBasicMaterial({ color: material.color.clone(), name: 'courtNetInk', toneMapped: false })
  })

  // Strip renderer-only metadata (random UUIDs, artwork bindings, LOD handles)
  // and name every material deterministically: palette slots keep their kit
  // name, and the two builder-minted materials are named by their job.
  const used = new Map()
  const named = new Set()
  const alphaMaterials = new Set()
  const textures = new Set()
  let triangles = 0
  let meshes = 0
  let lineMeshes = 0
  root.traverse(object => {
    object.userData = {}
    const line = object.isLine === true
    if (!line && !object.isMesh) return
    if (line) lineMeshes++
    else {
      meshes++
      triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3
    }
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      let name = used.get(material)
      if (!name) {
        name = paletteNames.get(material)
        if (!name) {
          // Builder-owned materials: the court net's line ink, and the floor
          // mark's transparent vinyl (minted per variant by FloorMarkModel).
          name = line
            ? 'courtNetInk'
            : spec.kind === 'floor-mark'
              ? `floorMarkInk_${spec.variant}`
              : `printed_${material.color ? material.color.getHexString() : material.type}`
        }
        assert.ok(name, `${spec.paletteId}: unnamed material ${material.type}`)
        if (named.has(name)) {
          let suffix = 2
          while (named.has(`${name}${suffix}`)) suffix++
          name = `${name}${suffix}`
        }
        used.set(material, name)
        named.add(name)
        material.name = name
      }
      if (material.transparent) alphaMaterials.add(name)
      if (material.map) textures.add(material.map)
    }
  })
  assert.equal(Number.isInteger(triangles), true, `${spec.paletteId}: triangle count is not an integer`)
  assert.ok(triangles > 0 && meshes > 0, `${spec.paletteId}: exported no geometry`)

  // Source-space bounds, before the glTF Z-up -> Y-up wrapper and before the
  // basis anchors are added (they must not widen the recorded envelope).
  const bounds = new THREE.Box3().setFromObject(root)
  const size = bounds.getSize(new THREE.Vector3())
  const close = (actual, expected, tolerance, field) =>
    assert.ok(Math.abs(actual - expected) <= tolerance, `${spec.paletteId}: ${field} ${actual.toFixed(4)} != ${expected} (+-${tolerance})`)
  close(size.x, spec.width, 0.06, 'width')
  close(size.y, spec.depth, 0.06, 'depth')
  close(size.z, spec.height, 0.03, 'height')

  // Basis anchors, shared with bench/bin/cctv/shelf/glass. `Front` is the
  // readable side: the sign and line-map lit faces look local +y, and the floor
  // mark's canvas top points local +y. `Approach` is local -y — the wall side
  // the printed panels are backed against.
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
  assert.equal(textures.size, spec.textures, `${spec.paletteId}: expected ${spec.textures} textures, got ${textures.size}`)
  assert.equal(lineMeshes, spec.lines, `${spec.paletteId}: expected ${spec.lines} line primitives, got ${lineMeshes}`)
  if (spec.kind === 'floor-mark') {
    assert.ok(alphaMaterials.has(`floorMarkInk_${spec.variant}`), `${spec.paletteId}: the vinyl must be transparent`)
  } else {
    assert.equal(alphaMaterials.size, 0, `${spec.paletteId}: unexpected transparent materials ${[...alphaMaterials]}`)
  }

  // Per-model canonical parameters. The catalogue rows repeat these, so the
  // numbers stay with the asset that was actually exported.
  const decor = spec.kind === 'court' || spec.kind === 'floor-mark' ? floorDecorSpec(mod) : null
  let parameters
  if (spec.kind === 'court') {
    parameters = spec.variant === 'divider'
      ? {
          variant: 'divider', bayWidthMetres: decor.w, bayDepthMetres: decor.d, bayHeightMetres: decor.h,
          fabricWidthMetres: 1.9, fabricHeightMetres: 0.86, fabricThicknessMetres: 0.045,
          frameMaterial: 'darkSteel', fabricMaterial: 'courtDivider',
          artwork: 'none: flat palette fabric with steel posts, rails and T-feet',
        }
      : {
          variant: spec.variant, bayWidthMetres: decor.w, bayDepthMetres: decor.d, bayHeightMetres: decor.h,
          surfaceThicknessMetres: 0.024, markingStrokeMetres: spec.variant === 'badminton' ? 0.04 : 0.0508,
          netHeightMetres: spec.variant === 'badminton' ? 1.55 : 0.9144,
          netCentreHeightMetres: spec.variant === 'badminton' ? 1.524 : 0.8636,
          netDepthMetres: spec.variant === 'badminton' ? 0.76 : 0.82,
          netWidthMetres: decor.d + 0.36,
          kitchenWidthMetres: spec.variant === 'pickleball' ? 4.2672 : 0,
          netLineMaterial: 'unlit MeshBasicMaterial (courtNetInk): the game draws the net with LineBasicMaterial, exported as unlit ink with its LINES topology kept',
          artwork: 'painted flat court colours plus white line slabs; the net is line geometry with a shared two-sided mesh',
        }
  } else if (spec.kind === 'floor-mark') {
    parameters = {
      variant: spec.variant, widthMetres: decor.w, depthMetres: decor.d, thicknessMetres: decor.h,
      texturePixels: '768 x 512', coverage: 'transparent vinyl decal outside its ink',
      canvasTop: 'local +y',
      lineBinding: 'runtime binding: cfg.line (neutral fallback is line 5, #c8102e, when a mark is unbound)',
      dynamicContent: 'runtime binding: dynamic-station-panels',
    }
  } else if (spec.kind === 'sign') {
    const mount = signMountSpec(mod.cfg.mount)
    const boards = mountedSignBoards(mod.cfg.mount, signBoardsOf(mod.cfg, data))
    const panel = signBoardsPanel(boards)
    parameters = {
      mount: mount.mount, panelWidthMetres: panel.w, panelHeightMetres: panel.h,
      boardThicknessMetres: 0.08,
      // `mount.panelZ` is the mount's nominal eye height; a hung board actually
      // rides the drop its rods make under the ceiling (SIGN_HANG = 0.65 m).
      panelCentreMetres: mount.hung ? hangCeilingLocal(mod, data.cells, data.modules) - 0.65 : mount.panelZ,
      ceilingMetres: mount.hung ? hangCeilingLocal(mod, data.cells, data.modules) : 0,
      hung: mount.hung, doubleSided: mount.doubleSided,
      faces: 'one lit face (neutral default front board); no back board is composed',
      texture: 'signPlate at PX_PER_METRE (512 px/m)',
      dynamicContent: 'runtime binding: dynamic-station-panels',
    }
  } else {
    const map = lineMapSpec(mod.cfg.mount)
    parameters = {
      mount: map.mount, panelWidthMetres: map.panelW, panelHeightMetres: map.panelH,
      framePadMetres: 0.05, panelCentreMetres: map.panelZ, heightMetres: map.height, doubleSided: map.doubleSided,
      faces: map.doubleSided ? 'two lit faces (front and back of the totem)' : 'one lit face (the wall board)',
      texture: 'lineMapPlaceholderPlate at 420 px/m (drawn empty-network board)',
      dynamicContent: 'runtime binding: dynamic-station-panels',
    }
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
    family: 'printed',
    kind: spec.kind,
    variant: spec.variant,
    prefab: spec.prefab,
    file: spec.file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: {
      court: 'game/src/render/models/pieces/CourtModel.ts',
      'floor-mark': 'game/src/render/models/pieces/FloorMarkModel.ts',
      sign: 'game/src/render/models/pieces/SignModel.ts',
      linemap: 'game/src/render/models/pieces/LineMapModel.ts',
    }[spec.kind],
    provenance: {
      court: 'Repository procedural court bay, line markings and line-geometry net',
      'floor-mark': 'Repository procedural floor vinyl geometry and canvas decal artwork',
      sign: 'Repository procedural wayfinding sign body and neutral default printed face',
      linemap: 'Repository procedural line-map board/totem and drawn neutral network board',
    }[spec.kind],
    licenseRecord: 'Repository-authored procedural geometry and canvas artwork; no third-party assets',
    units: 'metres',
    placementOffset,
    min: bounds.min.toArray(),
    max: bounds.max.toArray(),
    size: size.toArray(),
    anchors,
    facade: spec.kind === 'floor-mark' ? 'flat: canvas top local +y, face normal local +z' : 'local +y (readable face)',
    triangles,
    meshes,
    lineMeshes,
    materials,
    alphaMaterials: [...alphaMaterials].sort(),
    textures: textures.size,
    rowPitchMetres: spec.pitch,
    parameters,
    validation: { errors: report.issues.numErrors, warnings: report.issues.numWarnings },
  }
  await writeFile(join(out, spec.file), bytes)
  await writeFile(join(out, spec.file.replace(/\.glb$/, '.manifest.json')), JSON.stringify(manifest, null, 2) + '\n')
  assets.push(manifest)
  // The family panel table carries the *measured* envelope, exactly as the
  // per-asset manifest and the catalogue row do, so Unity can assert one table.
  panels.push({
    paletteId: spec.paletteId,
    kind: spec.kind,
    variant: spec.variant,
    widthMetres: size.x,
    depthMetres: size.y,
    heightMetres: size.z,
    textures: textures.size,
    linePrimitives: lineMeshes,
    rowPitchMetres: spec.pitch,
  })
  console.log(
    `${spec.id}: ${triangles} triangles, ${meshes} meshes (+${lineMeshes} lines), ${materials.length} materials ` +
      `(${manifest.alphaMaterials.length} alpha), ${textures.size} textures, ${bytes.length} bytes, ${manifest.sha256}`,
  )
}

const summary = {
  schemaVersion: 1,
  family: 'printed',
  sourcePaths: [
    'game/src/render/models/pieces/CourtModel.ts',
    'game/src/render/models/pieces/FloorMarkModel.ts',
    'game/src/render/models/pieces/SignModel.ts',
    'game/src/render/models/pieces/LineMapModel.ts',
    'game/src/render/models/PieceBuilder.ts',
    'game/src/render/floorMarkArt.ts',
    'game/src/render/signFace.ts',
    'game/src/render/lineMapFace.ts',
    'game/src/build/model/Equipment.ts',
    'game/src/sim/floorDecor.ts',
    'game/src/sim/sign.ts',
    'game/src/sim/linemaps.ts',
  ],
  parameters: {
    models: MODELS.length,
    rot: 0,
    stationData: 'empty station document: { cells: [], modules: [], lines: [] }',
    placement: 'createModule(paletteId, 0, 0, 0, "proof-" + paletteId, 0) then buildModule(mod, ctx); the root placement offset is recorded and the export is built at the local origin',
    mounts: MODELS.filter(spec => spec.kind === 'sign' || spec.kind === 'linemap').map(spec => ({ paletteId: spec.paletteId, mount: spec.variant })),
    hungSignCeilingMetres: 4,
    hungSignCeilingSource: 'hangCeilingLocal fallback `STOREY_HEIGHT (5) - 1` for a piece with no slab over its cell',
    // Arrays, not maps: Unity's JsonUtility cannot deserialize dictionaries.
    panels,
    dynamicContent: 'sign faces and line-map boards are runtime bindings of the dynamic-station-panels row: the exports carry the neutral default printed faces, not a station document',
    neutralFaces: 'neutral default faces: ctx.signFace and ctx.lineMapFace are omitted, so the palette mints them — mats.signFace (default front board from makeSignBoards(undefined, [])) and mats.lineMapPlaceholder (drawn empty-network board at 420 px/m)',
    textures: 'floor-mark vinyl 1 canvas (768 x 512); sign 1 (wall) or 2 (ceiling: signFace + brushed steel 64 px); line map 2 (board + brushed steel); courts none (flat palette colours and line geometry)',
    canvasEncode: 'the palette uses Math.random for the brushed-steel grain (seeded 0x9e3779b9) and the canvas encodes are serialised through one promise queue, so image bufferViews keep traversal order between exports',
    basis: 'source Z-up tree wrapped in a group rotated -90 degrees about X (glTF Y-up); Unity wrapper applies the 180-degree Y correction so gameplay channels read (x, z, y)',
    row: 'courts on 8 m centres and the other pieces on 3 m centres, in review-row order; the two 14 m courts are turned 90 degrees in the Unity review scene so their 7 m width faces the row',
  },
  assets,
  validation: {
    errors: assets.reduce((sum, asset) => sum + asset.validation.errors, 0),
    warnings: assets.reduce((sum, asset) => sum + asset.validation.warnings, 0),
  },
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(`PRINTED_EXPORT_OK ${assets.length} models, ${summary.validation.errors} errors, ${summary.validation.warnings} warnings -> ${out}`)
