import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Canvas, ImageData, createCanvas } from '@napi-rs/canvas'
import validator from 'gltf-validator'

// The vehicle family: six road vehicles and four city train marks. The vehicles
// are the game's own `roadVehicleParts(variant)` output — one merged geometry per
// authored INK colour, facing local +Y with Z up — assembled into a group and
// exported at a stable local origin. The marks are the cabs' decal canvases,
// painted through the same runtime functions the game paints them with, mounted
// on a shallow cab-front plate at review scale.
//
// Two export concerns are explicit here:
//
//  * the road kit mints a *transparent* MeshStandardMaterial per colour bin
//    (`ROAD_VEHICLE_OPACITY`, depthWrite off) and the game draws those surfaces
//    over a colourless depth prepass. The prepass is a draw-order device, not
//    geometry, so only the colour bins are exported; the authored colours,
//    opacity and material settings are kept and the depth pass stays a runtime
//    concern (RoadVehicleModel.roadVehicleDrawParts).
//  * the mark canvases are painted by `refreshCityTrainMark`,
//    `refreshChongqingTrainMark` and `refreshNanjingTrainMark` exactly as the
//    live scene does. Their canvas encodes are serialised, so two exports keep
//    identical image bufferViews.
//
// Determinism: no dates, no UUIDs in the output (every `userData` is stripped),
// stable material order, seeded Math.random, and a repeat export must be
// byte-identical.
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
const { canvasTexture, createModelMaterials, plate } = await import('../../game/src/render/models/PieceBuilder.ts')
const { roadVehicleParts } = await import('../../game/src/render/models/pieces/RoadVehicleModel.ts')
const { INK } = await import('../../game/src/render/models/pieces/vehicles/VehicleKit.ts')
const { refreshCityTrainMark, refreshNanjingTrainMark } = await import('../../game/src/render/cityBranding.ts')
const { refreshChongqingTrainMark } = await import('../../game/src/render/chongqingTrainMark.ts')

/**
 * The ten family rows in review-row order. `kind` selects the export recipe:
 * `vehicle` runs the road kit, `mark` paints a city decal canvas. `triangles`
 * pins the kit's High-detail count (game/test/road-vehicles.test.mjs pins the
 * same numbers), so a builder change cannot slip through the export.
 */
const MODELS = [
  { paletteId: 'vehicle-suv', prefab: 'VehicleSuv', file: 'vehicle-suv.glb', kind: 'vehicle', variant: 'suv', triangles: 2568 },
  { paletteId: 'vehicle-sedan', prefab: 'VehicleSedan', file: 'vehicle-sedan.glb', kind: 'vehicle', variant: 'sedan', triangles: 2492 },
  { paletteId: 'vehicle-bus-orange', prefab: 'VehicleBusOrange', file: 'vehicle-bus-orange.glb', kind: 'vehicle', variant: 'bus-orange', triangles: 5612 },
  { paletteId: 'vehicle-bus-mosaic', prefab: 'VehicleBusMosaic', file: 'vehicle-bus-mosaic.glb', kind: 'vehicle', variant: 'bus-mosaic', triangles: 5753 },
  { paletteId: 'vehicle-moped', prefab: 'VehicleMoped', file: 'vehicle-moped.glb', kind: 'vehicle', variant: 'moped', triangles: 3560 },
  { paletteId: 'vehicle-bicycle', prefab: 'VehicleBicycle', file: 'vehicle-bicycle.glb', kind: 'vehicle', variant: 'bicycle', triangles: 4080 },
  {
    paletteId: 'city-guangzhou-train-mark', prefab: 'TrainMarkGuangzhou', file: 'train-mark-guangzhou.glb', kind: 'mark',
    city: 'guangzhou', material: 'trainMark', canvas: [384, 150], atlasSlot: 0, plate: [1.40, 1.64],
    source: 'game/src/render/models/PieceBuilder.ts createModelMaterials().trainMark (384 x 150 shared cab atlas) painted by game/src/render/cityBranding.ts refreshCityTrainMark; mark drawing game/src/render/trainMarkAtlas.ts slot 0 / drawMetroMark',
  },
  {
    paletteId: 'city-beijing-train-mark', prefab: 'TrainMarkBeijing', file: 'train-mark-beijing.glb', kind: 'mark',
    city: 'beijing', material: 'trainMark', canvas: [384, 150], atlasSlot: 1, plate: [1.60, 1.875],
    source: 'game/src/render/models/PieceBuilder.ts createModelMaterials().trainMark (384 x 150 shared cab atlas) painted by game/src/render/cityBranding.ts refreshCityTrainMark (beijing-calligraphy) using game/src/render/beijingTrainMark.ts drawBeijingTrainMark; atlas slot 1',
  },
  {
    paletteId: 'city-chongqing-train-mark', prefab: 'TrainMarkChongqing', file: 'train-mark-chongqing.glb', kind: 'mark',
    city: 'chongqing', material: 'chongqingTrainMark', canvas: [512, 128], atlasSlot: -1, plate: [1.80, 0.45], line: '4', colour: '#dc8633',
    source: 'game/src/render/models/pieces/TrainModel.ts buildTrain() per-consist badge canvas (512 x 128) painted by game/src/render/chongqingTrainMark.ts refreshChongqingTrainMark using game/src/render/chongqingBranding.ts drawChongqingTrainBadge (line 4, #dc8633)',
  },
  {
    paletteId: 'city-nanjing-train-mark', prefab: 'TrainMarkNanjing', file: 'train-mark-nanjing.glb', kind: 'mark',
    city: 'nanjing', material: 'nanjingTrainMark', canvas: [256, 256], atlasSlot: -1, plate: [1.50, 1.50],
    source: 'game/src/render/models/PieceBuilder.ts createModelMaterials().nanjingTrainMark (256 x 256 retained side-decal texture) painted by game/src/render/cityBranding.ts refreshNanjingTrainMark using game/src/render/nanjingBranding.ts drawNanjingLogo; decal geometry source game/src/render/models/pieces/NanjingTrainMark.ts',
  },
]

/** Authored INK colour -> deterministic material suffix. */
const INK_LABEL = new Map([
  [INK.paint, 'paint'],
  [INK.pale, 'pale'],
  [INK.accent, 'accent'],
  [INK.glass, 'glass'],
  [INK.rubber, 'rubber'],
  [INK.metal, 'metal'],
  [INK.lamp, 'lamp'],
  [INK.tail, 'tail'],
])

const mats = createModelMaterials()
const paletteNames = new Map(Object.entries(mats).map(([name, material]) => [material, name]))

const out = resolve(process.argv[2] ?? '.preview/unity/vehicle-proof/export')
await mkdir(out, { recursive: true })

/** Opaque canvas pixels grouped by their exact sRGB hex, for the Unity check. */
function canvasColours(texture) {
  const canvas = texture.image
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  const counts = new Map()
  let opaque = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    opaque++
    const hex = `#${[data[i], data[i + 1], data[i + 2]].map(value => value.toString(16).padStart(2, '0')).join('')}`
    counts.set(hex, (counts.get(hex) ?? 0) + 1)
  }
  return {
    opaquePixels: opaque,
    colours: [...counts].map(([color, pixels]) => ({ color, pixels })).sort((a, b) => b.pixels - a.pixels || (a.color < b.color ? -1 : 1)),
  }
}

/** Strip renderer-only metadata and give a mesh's material its canonical name. */
function nameMaterial(material, name) {
  assert.ok(!material.name || material.name === name, `${name}: material already named ${material.name}`)
  material.name = name
  material.userData = {}
  return name
}

const assets = []
const vehicleRows = []
const markRows = []

for (const spec of MODELS) {
  const root = new THREE.Group()
  root.name = spec.prefab
  let triangles = 0
  let meshes = 0
  const used = new Map()
  const alphaMaterials = new Set()
  const textures = new Set()
  let markInfo = null

  if (spec.kind === 'vehicle') {
    const parts = roadVehicleParts(spec.variant)
    assert.ok(parts.length > 0 && parts.length <= 8, `${spec.paletteId}: ${parts.length} colour bins`)
    for (const { geometry, material } of parts) {
      const label = INK_LABEL.get(material.color.getHex())
      assert.ok(label, `${spec.paletteId}: unauthored colour #${material.color.getHexString()}`)
      const name = nameMaterial(material, `vehicle${label[0].toUpperCase()}${label.slice(1)}`)
      // The road kit's settings are part of the authored look: a fixed grey
      // palette, 0.65 roughness, 0.70 opacity and no depth write. glTF carries
      // colour, roughness, opacity and alphaMode; depthWrite stays a renderer
      // policy and is recorded in the manifest instead.
      assert.equal(material.isMeshStandardMaterial, true, `${spec.paletteId}: ${name} is not MeshStandardMaterial`)
      assert.equal(material.color.r, material.color.g, `${spec.paletteId}: ${name} is not neutral grey`)
      assert.equal(material.transparent, true, `${spec.paletteId}: ${name} lost its transparency`)
      assert.equal(material.opacity, 0.7, `${spec.paletteId}: ${name} opacity ${material.opacity}`)
      assert.equal(material.depthWrite, false, `${spec.paletteId}: ${name} depth write changed`)
      assert.equal(material.side, THREE.FrontSide, `${spec.paletteId}: ${name} side changed`)
      const mesh = new THREE.Mesh(geometry, material)
      mesh.name = `${spec.prefab}_${name}`
      mesh.userData = {}
      geometry.userData = {}
      root.add(mesh)
      used.set(material, name)
      alphaMaterials.add(name)
      triangles += (geometry.index?.count ?? geometry.getAttribute('position').count) / 3
      meshes++
    }
    assert.equal(triangles, spec.triangles, `${spec.paletteId}: ${triangles} triangles, expected ${spec.triangles}`)
  } else {
    // The mark fixture: one canvas texture on a shallow cab-front plate. The
    // canvas is painted by the same runtime function the live scene uses, so the
    // exported artwork is the cab's decal, not a redrawn approximation.
    const [width, height] = spec.canvas
    const texture = canvasTexture(width, height, () => {})
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.01 })
    if (spec.city === 'chongqing') refreshChongqingTrainMark(material, spec.city, spec.line, spec.colour)
    else if (spec.city === 'nanjing') refreshNanjingTrainMark(material, spec.city)
    else refreshCityTrainMark(material, spec.city)
    nameMaterial(material, spec.material)
    assert.ok(material.map && material.map.image, `${spec.paletteId}: the mark canvas is missing`)
    assert.equal(material.map.image.width, width, `${spec.paletteId}: canvas width`)
    assert.equal(material.map.image.height, height, `${spec.paletteId}: canvas height`)
    const colourInfo = canvasColours(material.map)
    assert.ok(colourInfo.opaquePixels > 0, `${spec.paletteId}: the mark canvas is empty`)
    // The mark's ink is the city's authored colour family; an empty or blank
    // canvas would fail here, before Unity ever sees the file.
    const minPixels = { guangzhou: 1000, beijing: 500, chongqing: 300, nanjing: 300 }[spec.city]
    const inks = spec.city === 'guangzhou' ? ['#d8231c']
      : spec.city === 'beijing' ? ['#ffffff']
      : spec.city === 'chongqing' ? ['#ffffff', spec.colour]
      : ['#d82316', '#ffffff']
    for (const ink of inks) {
      const found = colourInfo.colours.find(entry => entry.color === ink)
      assert.ok(found && found.pixels >= minPixels, `${spec.paletteId}: ink ${ink} has ${found?.pixels ?? 0} pixels`)
    }

    const [plateWidth, plateHeight] = spec.plate
    assert.ok(plateWidth >= 1 && plateWidth <= 2, `${spec.paletteId}: plate width ${plateWidth} m is outside cab-panel scale`)
    const plateHeightFull = plateHeight + 0.08
    const backing = new THREE.Mesh(new THREE.BoxGeometry(plateWidth + 0.08, 0.05, plateHeightFull), mats.darkSteel)
    backing.name = `${spec.prefab}_backing`
    backing.position.set(0, 0, plateHeightFull / 2)
    backing.userData = {}
    backing.geometry.userData = {}
    root.add(backing)
    used.set(mats.darkSteel, nameMaterial(mats.darkSteel, 'darkSteel'))

    // `plate` faces local +Y with local +Z up, so the decal reads in the cab's
    // own frame (the vehicles also face +Y before the export rotation).
    const mark = plate(root, material, plateWidth, plateHeight, 0, 0.031, plateHeightFull / 2, Math.PI)
    mark.name = `${spec.prefab}_mark`
    mark.userData = {}
    mark.geometry.userData = {}
    if (spec.atlasSlot >= 0) {
      // The shared cab atlas is three 128 px slots; the plane shows its own slot.
      const uv = mark.geometry.getAttribute('uv')
      for (let i = 0; i < uv.count; i++) uv.setX(i, (uv.getX(i) + spec.atlasSlot) / 3)
      uv.needsUpdate = true
    }
    used.set(material, spec.material)
    alphaMaterials.add(spec.material)
    textures.add(material.map)
    triangles = 12 + 2
    meshes = 2
    markInfo = {
      ...colourInfo,
      widthMetres: plateWidth,
      heightMetres: plateHeight,
      plateDepthMetres: 0.05,
      readFace: 'local +y',
      atlasSlot: spec.atlasSlot,
      line: spec.line ?? null,
      colour: spec.colour ?? null,
    }
  }

  // Source-space bounds, before the glTF Z-up -> Y-up wrapper and before the
  // basis anchors are added (they must not widen the recorded envelope).
  const bounds = new THREE.Box3().setFromObject(root)
  const size = bounds.getSize(new THREE.Vector3())
  assert.ok(size.x > 0 && size.y > 0 && size.z > 0, `${spec.paletteId}: empty bounds`)
  if (spec.kind === 'vehicle') {
    // The queue envelope the traffic sim relies on (game/test/road-vehicles.test.mjs):
    // grounded tyres, a 4.2 m car, a 10 m bus and a 1.9 m cycle.
    assert.ok(Math.abs(bounds.min.z) < 0.001, `${spec.paletteId}: tyres leave the road (min z ${bounds.min.z})`)
    const [min, max] = spec.variant.startsWith('bus') ? [9.5, 10.3]
      : spec.variant === 'suv' || spec.variant === 'sedan' ? [4, 4.4]
      : [1.6, 2.1]
    assert.ok(size.y >= min && size.y <= max, `${spec.paletteId}: length ${size.y.toFixed(3)} m outside ${min}..${max}`)
  }

  // Basis anchors, shared with every other family. Vehicles face local +Y and
  // the mark fixtures read from local +Y.
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
    anchor.userData = {}
    root.add(anchor)
  }

  const materials = [...used.values()].sort()
  assert.equal(new Set(materials).size, materials.length, `${spec.paletteId}: duplicate material names`)
  assert.equal(textures.size, spec.kind === 'mark' ? 1 : 0, `${spec.paletteId}: unexpected texture count`)

  const gltfRoot = new THREE.Group()
  gltfRoot.name = spec.prefab
  // Source space is Z-up. The single export transform rotates it into glTF
  // Y-up, exactly as the bench, bin, cctv, shelf and printed recipes do.
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

  const rowPitchMetres = spec.kind === 'vehicle' ? 13 : 2.5
  const parameters = spec.kind === 'vehicle'
    ? {
        variant: spec.variant,
        detail: 'high',
        facing: 'local +y (travel direction)',
        up: 'local +z',
        lengthMetres: size.y,
        widthMetres: size.x,
        heightMetres: size.z,
        triangles: spec.triangles,
        colourBins: materials.length,
        opacity: 0.7,
        depthWrite: false,
        materialSettings: 'transparent MeshStandardMaterial, roughness 0.65, metalness 0, depthWrite false; the game draws a colourless depth prepass before these bins and that draw-order device is not part of the fixture',
      }
    : {
        city: spec.city,
        material: spec.material,
        canvasSource: spec.source,
        canvasPixels: `${spec.canvas[0]} x ${spec.canvas[1]}`,
        atlasSlot: spec.atlasSlot,
        line: spec.line ?? null,
        lineColour: spec.colour ?? null,
        marks: 'one cab decal plate: a 0.05 m steel backing plate and the mark plane 6 mm in front of it',
        plateWidthMetres: spec.plate[0],
        plateHeightMetres: spec.plate[1],
        readFace: 'local +y',
        inkCounts: markInfo.colours.filter(entry => entry.pixels > 0).slice(0, 8),
      }

  const manifest = {
    schemaVersion: 1,
    id: spec.paletteId,
    rowId: spec.paletteId,
    catalogue: false,
    paletteId: spec.paletteId,
    family: 'vehicle',
    kind: spec.kind,
    variant: spec.variant ?? spec.city,
    prefab: spec.prefab,
    file: spec.file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: spec.kind === 'vehicle' ? 'game/src/render/models/pieces/RoadVehicleModel.ts' : spec.source,
    provenance: spec.kind === 'vehicle'
      ? 'Repository procedural Guangzhou road-traffic geometry (VehicleKit / RoadCar / RoadBus / RoadCycle) in the ambient grey palette'
      : 'Repository-authored city train-mark canvas artwork painted by the live scene materials, mounted here as a cab-front decal fixture',
    licenseRecord: 'Repository-authored procedural geometry and canvas artwork; no third-party assets',
    units: 'metres',
    placementOffset: [0, 0, 0],
    min: bounds.min.toArray(),
    max: bounds.max.toArray(),
    size: size.toArray(),
    anchors,
    facade: 'local +y (front face)',
    triangles,
    meshes,
    materials,
    alphaMaterials: [...alphaMaterials].sort(),
    textures: textures.size,
    rowPitchMetres,
    hasMark: markInfo != null,
    parameters,
    mark: markInfo ? { city: spec.city, material: spec.material, canvas: spec.canvas, ...markInfo } : null,
    validation: { errors: report.issues.numErrors, warnings: report.issues.numWarnings },
  }
  await writeFile(join(out, spec.file), bytes)
  await writeFile(join(out, spec.file.replace(/\.glb$/, '.manifest.json')), JSON.stringify(manifest, null, 2) + '\n')
  assets.push(manifest)
  if (spec.kind === 'vehicle') {
    vehicleRows.push({
      paletteId: spec.paletteId,
      variant: spec.variant,
      triangles,
      widthMetres: size.x,
      lengthMetres: size.y,
      heightMetres: size.z,
      materials,
    })
  } else {
    markRows.push({
      paletteId: spec.paletteId,
      city: spec.city,
      material: spec.material,
      canvasWidth: spec.canvas[0],
      canvasHeight: spec.canvas[1],
      atlasSlot: spec.atlasSlot,
      line: spec.line ?? null,
      lineColour: spec.colour ?? null,
      inkCounts: markInfo.colours.filter(entry => entry.pixels > 0).slice(0, 8),
    })
  }
  console.log(
    `${spec.paletteId}: ${triangles} triangles, ${meshes} meshes, ${materials.length} materials ` +
      `(${alphaMaterials.size} alpha), ${textures.size} textures, ${bytes.length} bytes, ${manifest.sha256}`,
  )
}

const summary = {
  schemaVersion: 1,
  family: 'vehicle',
  sourcePaths: [
    'game/src/render/models/pieces/RoadVehicleModel.ts',
    'game/src/render/models/pieces/vehicles/VehicleKit.ts',
    'game/src/render/models/pieces/vehicles/RoadCar.ts',
    'game/src/render/models/pieces/vehicles/RoadBus.ts',
    'game/src/render/models/pieces/vehicles/RoadCycle.ts',
    'game/src/render/models/PieceBuilder.ts',
    'game/src/render/cityBranding.ts',
    'game/src/render/trainMarkAtlas.ts',
    'game/src/render/beijingTrainMark.ts',
    'game/src/render/chongqingTrainMark.ts',
    'game/src/render/models/pieces/NanjingTrainMark.ts',
    'game/src/sim/constants.ts',
    'game/src/sim/cityStyles.ts',
  ],
  parameters: {
    models: MODELS.length,
    rot: 0,
    placement: 'the exported root is the builder output at its stable local origin: roadVehicleParts(variant) at the origin, or the mark plate standing on the local z = 0 ground plane facing local +y',
    vehicles: vehicleRows,
    marks: markRows,
    // Arrays, not maps: Unity's JsonUtility cannot deserialize dictionaries.
    row: {
      vehiclePitchMetres: 13,
      markPitchMetres: 2.5,
      markGapMetres: 5,
      vehicleYawDegrees: -30,
      farPlaneMetres: 250,
      order: MODELS.map(spec => spec.paletteId),
    },
    materials: 'every vehicle colour bin is named vehicle<Ink> from the authored VehicleKit INK palette; the cab-mark material keeps its palette name (trainMark / chongqingTrainMark / nanjingTrainMark) and the plate backing keeps darkSteel',
    textures: 'vehicles have no textures; each train mark carries exactly one canvas: the shared 384 x 150 cab atlas (Guangzhou slot 0, Beijing slot 1), the 512 x 128 Chongqing per-consist badge, or the 256 x 256 Nanjing side decal',
    canvasEncode: 'the palette uses Math.random for the brushed-steel grain (seeded 0x9e3779b9) and the canvas encodes are serialised through one promise queue, so image bufferViews keep traversal order between exports',
    basis: 'source Z-up tree wrapped in a group rotated -90 degrees about X (glTF Y-up); Unity wrapper applies the 180-degree Y correction so gameplay channels read (x, z, y)',
    depthPrepass: 'roadVehicleDrawParts draws one colourless depth prepass before the colour bins; the prepass is a renderer draw-order device and is deliberately not exported, the material settings that depend on it are recorded per vehicle',
  },
  assets,
  validation: {
    errors: assets.reduce((sum, asset) => sum + asset.validation.errors, 0),
    warnings: assets.reduce((sum, asset) => sum + asset.validation.warnings, 0),
  },
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(`VEHICLE_EXPORT_OK ${assets.length} models, ${summary.validation.errors} errors, ${summary.validation.warnings} warnings -> ${out}`)
