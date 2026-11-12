import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Canvas, createCanvas, ImageData } from '@napi-rs/canvas'
import validator from 'gltf-validator'
import * as THREE from '../../game/node_modules/three/build/three.module.js'
import { GLTFExporter } from '../../game/node_modules/three/examples/jsm/exporters/GLTFExporter.js'
import { createModelMaterials } from '../../game/src/render/models/PieceBuilder.ts'
import { buildTrain, setDoorsSides } from '../../game/src/render/models/pieces/TrainModel.ts'
import { lineColourFor } from '../../game/src/sim/cityStyles.ts'
import { Rng } from '../../game/src/sim/rng.ts'

// The rolling-stock family: one three-car review consist per A/B/C/L/D stock
// class. Each is the game's own `buildTrain` output — rounded body, window band,
// livery broken at every doorway, both cabs, an intermediate car and the
// inter-car gangway — at a neutral pose (doors shut, catenary power, dirSign +1).
//
// A **three-car** formation (cab + intermediate + cab) is the smallest consist
// that contains every part of the model: both ends, a full intermediate car,
// the gangway and both door banks. It is heavier than the shipped two-car Type A
// fixture; the measured GLB bytes are recorded per asset and in the summary.
//
// The livery each class wears is the game's own choice from `captureTrains.ts`:
// `LIVERY_LINE = { A: '1', B: '2', C: '4', L: '5', D: '18' }`, resolved through
// `lineColourFor` (the Guangzhou sign colours). Power is catenary for every
// review asset, as the migration brief pins it.
//
// Door leaves: the Type A fixture's contract. Every leaf is uniquely named, the
// five door poses are sampled with `setDoorsSides`, and two one-second clips
// (`OpenPlus`, `OpenMinus`) carry each bank's own keyframes.

const LIVERIES = [
  { id: 'train-A', prefab: 'TrainA', file: 'train-a.glb', stock: 'A', line: '1' },
  { id: 'train-B', prefab: 'TrainB', file: 'train-b.glb', stock: 'B', line: '2' },
  { id: 'train-C', prefab: 'TrainC', file: 'train-c.glb', stock: 'C', line: '4' },
  { id: 'train-L', prefab: 'TrainL', file: 'train-l.glb', stock: 'L', line: '5' },
  { id: 'train-D', prefab: 'TrainD', file: 'train-d.glb', stock: 'D', line: '18' },
]
// The checklist's representative formation per class. The review consist is the
// three-car minimum that still carries both cabs, the intermediate car and the
// gangway.
const REPRESENTATIVE_CARS = { A: [6, 8], B: [4, 6], C: [4, 6], L: [4, 6], D: [8, 8] }
const CARS = 3
const POWER = 'catenary'

const NODE_GROUPS = {
  // Grouping of the authored node names the Unity review verifies. Every name is
  // the builder's own; nothing here is a renamed or merged copy.
  cabShell: stock => (stock === 'D' ? ['d-cab-shell'] : ['cab-shell']),
  gangway: stock => (stock === 'D' ? ['d-intercar-gangway'] : ['car-intercar-gangway']),
  roof: stock => (stock === 'D' ? ['d-car-roof'] : ['car-roof']),
  liveryBand: stock => (stock === 'D' ? ['d-car-livery', 'd-cab-livery'] : ['cab-livery-paint']),
  bogiePrefix: ['bogie-'],
  pantograph: ['train-pantograph'],
  cabin: ['cabin-floor', 'cabin-ceiling'],
}

globalThis.HTMLCanvasElement = Canvas
globalThis.ImageData = ImageData
// GLTFExporter encodes every used canvas in parallel, so the order its image
// promises settle in — and therefore the GLB's image/bufferView order — is not
// stable. One queue serialises the encodes in call order, making a repeat export
// byte-identical.
let canvasEncodeQueue = Promise.resolve()
globalThis.document = {
  createElement(name) {
    assert.equal(name, 'canvas')
    const canvas = createCanvas(1, 1)
    // @napi-rs/canvas exposes `data()` on Canvas; GLTFExporter would treat that
    // as a DataTexture and write transparent black. Shadow it, as export-train.
    Object.defineProperty(canvas, 'data', { value: undefined })
    canvas.toBlob = (callback, mime) => {
      canvasEncodeQueue = canvasEncodeQueue.then(async () => {
        const bytes = await canvas.encode(mime === 'image/jpeg' ? 'jpeg' : 'png')
        callback(new Blob([bytes], { type: mime }))
      })
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

/** One train export: build, name its doors, sample both banks and pack the GLB. */
async function exportConsist(mats, spec) {
  const cars = CARS
  const colour = lineColourFor(spec.line)
  const train = buildTrain(mats, {
    x: 0, y: 0, z: 0, yaw: 0, stock: spec.stock, cars, power: POWER,
    doorsOpen: false, colour, dirSign: 1,
  })
  // The consist's own material identities, captured before userData is stripped.
  const liveryMaterial = train.userData.liveryMaterial
  const ownedMats = [...(train.userData.ownedMats ?? [])]
  const badgeMaterial = train.userData.chongqingTrainMark

  const leaves = train.userData.doors
  assert.ok(leaves.length > 0, `${spec.id}: builder registered no door leaves`)
  const doorPrefix = `${spec.prefab}Door`
  const doors = leaves.map((mesh, i) => {
    mesh.name = `${doorPrefix}${String(i).padStart(2, '0')}`
    return { name: mesh.name, side: mesh.userData.side, samples: [] }
  })
  assert.equal(new Set(doors.map(door => door.name)).size, doors.length, `${spec.id}: duplicate door names`)
  // Five poses: closed, plug-out and fully open on the + bank (1, 2), then the
  // − bank alone (3, 4). The stationary bank is sampled too, so the review can
  // prove side isolation.
  for (const [plus, minus] of [[0, 0], [0.18, 0], [1, 0], [0, 0.18], [0, 1]]) {
    setDoorsSides(train, plus, minus)
    leaves.forEach((mesh, i) => doors[i].samples.push({ position: mesh.position.toArray() }))
  }
  setDoorsSides(train, 0, 0)

  // Source-space bounds, before the Z-up to glTF Y-up wrapper.
  const bounds = new THREE.Box3().setFromObject(train)
  const size = bounds.getSize(new THREE.Vector3())

  // Name every material deterministically. The palette materials keep their kit
  // names; the per-build livery, cabin floor, Chongqing badge and (D only) cab
  // glass/accent are named by identity/colour. buildStreamlinedCab mints a fresh
  // glass and accent per cab end, so a repeated base name gets a numeric suffix.
  const baseNames = new Map(Object.entries(mats).map(([name, material]) => [material, name]))
  baseNames.set(liveryMaterial, 'lineLivery')
  if (badgeMaterial) baseNames.set(badgeMaterial, 'chongqingTrainMark')
  for (const material of ownedMats) {
    const hex = material.color?.getHexString?.()
    if (material === liveryMaterial || material === badgeMaterial) continue
    if (hex === '586879') baseNames.set(material, 'cabinFloor')
    else if (hex === '527c91') baseNames.set(material, 'dCabGlass')
    else if (hex === 'e73541') baseNames.set(material, 'dCabAccent')
  }

  const materials = new Map()
  const usedNames = new Set()
  const alphaMaterials = new Set()
  const glassMaterials = new Set()
  const textures = new Set()
  const nodes = new Map()
  let meshes = 0
  let triangles = 0
  train.traverse(object => {
    object.userData = {}
    nodes.set(object.name, (nodes.get(object.name) ?? 0) + 1)
    if (!object.isMesh) return
    meshes++
    triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      let name = materials.get(material)
      if (!name) {
        const base = baseNames.get(material) ?? `trainMaterial${materials.size}`
        name = base
        let suffix = 2
        while (usedNames.has(name)) name = `${base}${suffix++}`
        materials.set(material, name)
        usedNames.add(name)
      }
      material.name = name
      if (material.transparent) alphaMaterials.add(name)
      if (name.toLowerCase().includes('glass')) glassMaterials.add(name)
      if (material.map) textures.add(material.map)
    }
  })
  assert.equal(Number.isInteger(triangles), true, `${spec.id}: triangle count is not an integer`)
  assert.ok(triangles > 0 && meshes > 0, `${spec.id}: exported no geometry`)
  assert.equal(doors.filter(door => door.side === 1).length, doors.filter(door => door.side === -1).length,
    `${spec.id}: the two door banks differ in size`)

  const counts = {}
  for (const [group, rule] of Object.entries(NODE_GROUPS)) {
    if (group === 'bogiePrefix') {
      counts.bogies = [...nodes].filter(([name]) => name.startsWith(rule[0])).reduce((n, [, count]) => n + count, 0)
    } else if (group === 'pantograph') {
      counts.pantographs = nodes.get(rule[0]) ?? 0
    } else if (group === 'cabin') {
      for (const name of rule) counts[name === 'cabin-floor' ? 'cabinFloors' : 'cabinCeilings'] = nodes.get(name) ?? 0
    } else {
      const namesForGroup = rule(spec.stock)
      counts[group] = namesForGroup.reduce((n, name) => n + (nodes.get(name) ?? 0), 0)
      if (group === 'gangway') counts.gangwayNames = namesForGroup
    }
  }
  assert.equal(counts.cabShell, 2, `${spec.id}: expected two cab shells, got ${counts.cabShell}`)
  assert.equal(counts.cabinFloors, cars, `${spec.id}: expected ${cars} cabin floors, got ${counts.cabinFloors}`)
  assert.equal(counts.cabinCeilings, cars, `${spec.id}: expected ${cars} cabin ceilings, got ${counts.cabinCeilings}`)
  assert.ok(counts.gangway >= 1, `${spec.id}: no inter-car gangway`)
  assert.ok(counts.bogies > 0, `${spec.id}: no bogie parts`)
  assert.ok(counts.pantographs >= 2, `${spec.id}: expected the two cab-car pantographs, got ${counts.pantographs}`)

  // The four basis anchors shared with the bench/bin/cctv/glass/shelf recipes:
  // source +X is along the consist, source +Y is the near door bank, +Z is up.
  const anchors = {
    AxisX: [1, 0, 0],
    Front: [0, 1, 0],
    Up: [0, 0, 1],
    Approach: [0, -1, 0],
  }
  const root = new THREE.Group()
  root.name = spec.prefab
  root.rotation.x = -Math.PI / 2
  root.add(train)
  for (const [name, position] of Object.entries(anchors)) {
    const anchor = new THREE.Object3D()
    anchor.name = name
    anchor.position.fromArray(position)
    // Under the consist, exactly as the shelf/bin/bed recipes hang their
    // anchors off the piece; the verify path is the same.
    train.add(anchor)
  }

  const clips = [[1, 'OpenPlus', 1], [-1, 'OpenMinus', 3]].map(([side, name, start]) =>
    new THREE.AnimationClip(name, 1, doors.filter(door => door.side === side).map(door =>
      new THREE.VectorKeyframeTrack(`${door.name}.position`, [0, 0.18, 1],
        [door.samples[0], ...door.samples.slice(start, start + 2)].flatMap(sample => sample.position)))))
  assert.equal(clips[0].tracks.length, doors.filter(door => door.side === 1).length, `${spec.id}: OpenPlus lost tracks`)
  assert.equal(clips[1].tracks.length, doors.filter(door => door.side === -1).length, `${spec.id}: OpenMinus lost tracks`)

  const bytes = new Uint8Array(await new GLTFExporter().parseAsync(root, { binary: true, animations: clips }))
  const materialsList = [...materials.values()].sort()
  return {
    bytes,
    manifest: {
      schemaVersion: 1,
      id: spec.id,
      prefab: spec.prefab,
      file: spec.file,
      stock: spec.stock,
      cars,
      power: POWER,
      colour,
      liveryLine: spec.line,
      representativeCars: REPRESENTATIVE_CARS[spec.stock],
      source: 'game/src/render/models/pieces/TrainModel.ts',
      provenance: 'Repository procedural rolling-stock geometry, palette and canvas generators; livery from game/src/app/captureTrains.ts LIVERY_LINE resolved through lineColourFor',
      units: 'metres',
      basis: 'source Z-up wrapped -90 degrees about X (glTF Y-up); Unity wrapper applies the 180-degree Y correction, so gameplay channels read (x, z, y)',
      min: bounds.min.toArray(),
      max: bounds.max.toArray(),
      size: size.toArray(),
      triangles,
      meshes,
      materials: materialsList,
      alphaMaterials: [...alphaMaterials].sort(),
      glassMaterials: [...glassMaterials].sort(),
      textures: textures.size,
      anchors,
      doorPrefix,
      clips: clips.map(clip => clip.name),
      doors,
      nodes: counts,
    },
  }
}

const out = resolve(process.argv[2] ?? '.preview/unity/rolling-proof/export')
await mkdir(out, { recursive: true })

// One palette for the family: the brushed-steel canvas samples Math.random, so
// scope a fixed seed to that synchronous call. Repeat exports then match byte
// for byte, exactly as the Type A fixture.
const random = Math.random
const textureRng = new Rng(1)
let mats
try {
  Math.random = () => textureRng.next()
  mats = createModelMaterials()
} finally {
  Math.random = random
}

const assets = []
for (const spec of LIVERIES) {
  const { bytes, manifest } = await exportConsist(mats, spec)
  const report = await validator.validateBytes(bytes, { uri: spec.file })
  const reportName = spec.file.replace(/\.glb$/, '.validation.json')
  await writeFile(join(out, reportName), JSON.stringify(report, null, 2) + '\n')
  assert.equal(
    report.issues.numErrors + report.issues.numWarnings,
    0,
    `${spec.file}: ${report.issues.numErrors} errors, ${report.issues.numWarnings} warnings. See ${reportName}`,
  )
  manifest.sha256 = createHash('sha256').update(bytes).digest('hex')
  manifest.validation = { errors: report.issues.numErrors, warnings: report.issues.numWarnings }
  await writeFile(join(out, spec.file), bytes)
  await writeFile(join(out, spec.file.replace(/\.glb$/, '.manifest.json')), JSON.stringify(manifest, null, 2) + '\n')
  assets.push(manifest)
  console.log(
    `${spec.id}: ${manifest.triangles} triangles, ${manifest.meshes} meshes, ${manifest.materials.length} materials, ` +
      `${manifest.textures} textures, ${manifest.doors.length} door leaves, ${bytes.length} bytes, ` +
      `bounds ${manifest.size.map(value => value.toFixed(2)).join(' x ')}`,
  )
}

const summary = {
  schemaVersion: 1,
  family: 'rolling',
  sourcePaths: [
    'game/src/render/models/pieces/TrainModel.ts',
    'game/src/render/models/pieces/CabModel.ts',
    'game/src/render/models/pieces/StreamlinedCab.ts',
    'game/src/render/models/pieces/TrainShell.ts',
    'game/src/render/models/pieces/CarShellProfile.ts',
    'game/src/render/models/pieces/TrainGangway.ts',
    'game/src/render/models/pieces/DTrainShell.ts',
    'game/src/render/models/pieces/TrainInterior.ts',
    'game/src/render/models/pieces/TrainBogie.ts',
    'game/src/render/models/pieces/NanjingTrainMark.ts',
    'game/src/render/models/PieceBuilder.ts',
    'game/src/render/trainMarkAtlas.ts',
    'game/src/sim/stock.ts',
    'game/src/sim/cityStyles.ts',
    'game/src/app/captureTrains.ts',
  ],
  parameters: {
    models: assets.length,
    cars: CARS,
    power: POWER,
    formation: 'three-car review consist: driving cab + intermediate car + driving cab',
    representativeFormations: LIVERIES.map(spec => ({
      stock: spec.stock,
      cars: REPRESENTATIVE_CARS[spec.stock],
      line: spec.line,
      colour: lineColourFor(spec.line),
    })),
    livery: 'captureTrains.ts LIVERY_LINE: A=line 1 #edcf3b, B=line 2 #00679e, C=line 4 #01824a, L=line 5 #c70541, D=line 18 #364c9c',
    doors: 'every leaf named <Prefab>Door<nn>; five setDoorsSides poses sampled (closed, +plug 0.18, +open 1, -plug 0.18, -open 1); clips OpenPlus and OpenMinus, one second each, one track per leaf',
    basis: 'source Z-up wrapped -90 degrees about X (glTF Y-up); Unity wrapper applies the 180-degree Y correction so gameplay channels read (x, z, y)',
    textures: 'createModelMaterials canvases: 64 px brushed steel grain (seeded Math.random), 384 x 150 metro mark, 256 x 256 Nanjing mark, 512 x 128 Chongqing badge (cleared without a city style)',
    scene: 'five consists on parallel 7.5 m tracks, centred on the same x, raised three-quarter review camera',
  },
  assets,
  validation: {
    errors: assets.reduce((sum, asset) => sum + asset.validation.errors, 0),
    warnings: assets.reduce((sum, asset) => sum + asset.validation.warnings, 0),
  },
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(`ROLLING_EXPORT_OK ${assets.length} consists, ${summary.validation.errors} errors, ${summary.validation.warnings} warnings -> ${out}`)
