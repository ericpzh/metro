// Train formations family: reusable car parts for the five stock classes plus a
// formation matrix over every configuration the line editor offers.
//
// The architecture follows plan 09 §"Train formations and power":
//
//   * A car is exported as **shared parts**, never as one monolithic formation:
//     a leading cab, a trailing cab and an intermediate car per stock, plus the
//     power-specific roof option (a plain cap, or a roof well carrying the
//     pantograph), the inter-car gangway and one shared pantograph assembly.
//   * The body is extracted from the game's own `buildTrain` output. The car
//     geometry, doors, interior, bogies, livery and cab are therefore the
//     builder's, not a re-implementation. Only the 2.24 m roof slice over the
//     pantograph mount is lifted out of the body and exported as the well
//     module; a plain slice caps the same opening on third-rail / unpowered
//     cars.
//   * The 50 editor cells (5 stock classes × 2 powers × 5 car counts) are
//     assembled from those parts in code and checked against the TypeScript
//     oracles (`STOCK`, `doorCentres`, `doorWidthAt`, `CAR_GAP`,
//     `pantographElbowDirection`, `PANTOGRAPH_*`). The per-cell pass/fail
//     matrix is written into the summary manifest and re-verified by
//     `ReviewFormations.Import()` in Unity.
//   * Zoo's actual Line 5 (Type L, six cars, third rail, scale 0.98, travel
//     sign +1) is resolved from `unity/Assets/StationDesigner/Zoo/ZooSave.json`
//     instead of being hard-coded.
//
// Door leaves stay independent meshes and are driven by the two clips
// `OpenPlus` / `OpenMinus`, sampled at closed / plug-out / open against
// `setDoorsSides`.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Canvas, createCanvas, ImageData } from '@napi-rs/canvas'
import validator from 'gltf-validator'
import * as THREE from '../../game/node_modules/three/build/three.module.js'
import { GLTFExporter } from '../../game/node_modules/three/examples/jsm/exporters/GLTFExporter.js'
import { createModelMaterials, slab } from '../../game/src/render/models/PieceBuilder.ts'
import { buildTrain, setDoorsSides } from '../../game/src/render/models/pieces/TrainModel.ts'
import { buildTrainPantograph, pantographElbowDirection, PANTOGRAPH_MOUNT_Z, PANTOGRAPH_WELL_HALF_LENGTH } from '../../game/src/render/models/pieces/TrainPantograph.ts'
import { buildConsistGangways, CAR_GAP } from '../../game/src/render/models/pieces/TrainGangway.ts'
import { carRoofSection, openRoofUnderside, smoothCarRoof } from '../../game/src/render/models/pieces/CarShellProfile.ts'
import { dSurface, D_CROWN_HALF, D_ROOF, buildDGangway } from '../../game/src/render/models/pieces/DTrainShell.ts'
import { STOCK, STOCK_CLASSES, PANTOGRAPH_CONTACT_Z, doorCentres, doorWidthAt } from '../../game/src/sim/stock.ts'
import { FORMATION_OPTIONS } from '../../game/src/sim/headway.ts'
import { lineColourFor } from '../../game/src/sim/cityStyles.ts'
import { Rng } from '../../game/src/sim/rng.ts'

const WELL_HALF = PANTOGRAPH_WELL_HALF_LENGTH
const WELL_LENGTH = WELL_HALF * 2
const MOUNT_OFFSET = (length) => (length - CAR_GAP) / 2 - 2
const LIVERIES = { A: '1', B: '2', C: '4', L: '5', D: '18' }
const POWERS = ['third-rail', 'catenary']
const CAR_COUNTS = [...FORMATION_OPTIONS]

globalThis.HTMLCanvasElement = Canvas
globalThis.ImageData = ImageData
// GLTFExporter encodes every used canvas in parallel; serialise the encodes so a
// repeat export has a stable image/bufferView order (same as export-rolling).
let canvasEncodeQueue = Promise.resolve()
globalThis.document = {
  createElement(name) {
    assert.equal(name, 'canvas')
    const canvas = createCanvas(1, 1)
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

/* ------------------------------------------------------------ the Zoo line */

/** Resolve the shipped Zoo station's Line 5 record from the game save. */
async function resolveZoo() {
  const repo = resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  const file = join(repo, 'unity/Assets/StationDesigner/Zoo/ZooSave.json')
  const save = JSON.parse(await readFile(file, 'utf8'))
  const line = save?.static?.lines?.find(entry => entry.id === '5')
  assert.ok(line, 'ZooSave.json: Line 5 is missing')
  assert.equal(line.stock, 'L', 'Zoo Line 5 stock must be L')
  assert.equal(line.cars, 6, 'Zoo Line 5 must be six cars')
  assert.equal(line.power, 'third-rail', 'Zoo Line 5 must be third rail')
  return {
    file: 'unity/Assets/StationDesigner/Zoo/ZooSave.json',
    lineId: '5',
    name: line.name,
    stock: line.stock,
    cars: line.cars,
    power: line.power,
    colour: line.colour,
    modelScale: line.modelScale ?? 1,
    direction: line.direction ?? 'up',
    travelSign: line.travelSign ?? 1,
    psd: line.psd,
  }
}

/* ------------------------------------------------------------ build helpers */

function buildCanonical(mats, stock, cars, colour) {
  return buildTrain(mats, {
    x: 0, y: 0, z: 0, yaw: 0, stock, cars, power: 'catenary',
    doorsOpen: false, colour, dirSign: 1,
  })
}

const DOOR_POSES = [[0, 0], [0.18, 0], [1, 0], [0, 0.18], [0, 1]]

/** Sample both banks through the same `setDoorsSides` the game uses. */
function sampleDoorPoses(train) {
  const leaves = train.userData.doors
  const samples = new Map(leaves.map(leaf => [leaf, []]))
  for (const [plus, minus] of DOOR_POSES) {
    setDoorsSides(train, plus, minus)
    for (const leaf of leaves) samples.get(leaf).push(leaf.position.toArray())
  }
  setDoorsSides(train, 0, 0)
  train.updateMatrixWorld(true)
  return samples
}

function box(object) {
  object.updateWorldMatrix(true, false)
  return new THREE.Box3().setFromObject(object)
}

/** Split a consist into per-car groups in car-local coordinates. */
function partition(train, stock, cars) {
  const L = STOCK[stock].length
  const total = L * cars
  const groups = Array.from({ length: cars }, (_, c) => {
    const group = new THREE.Group()
    group.name = `Car${c}`
    return group
  })
  const pantographs = Array.from({ length: cars }, () => [])
  const carCentre = (c) => c * L + L / 2 - total / 2
  train.updateMatrixWorld(true)
  for (const child of [...train.children]) {
    const name = child.name
    if (name === 'car-intercar-gangway' || name === 'd-intercar-gangway') {
      train.remove(child)
      continue
    }
    const bounds = box(child)
    const centre = (bounds.min.x + bounds.max.x) / 2
    const index = Math.max(0, Math.min(cars - 1, Math.floor((centre + total / 2) / L)))
    const group = groups[index]
    group.add(child)
    child.position.x -= carCentre(index)
    if (name === 'train-pantograph') pantographs[index].push(child)
  }
  return { groups, pantographs, carCentre }
}

/**
 * Lift the 2.24 m roof slice over `panLocalX` out of a car group and return the
 * gap. The body keeps the game's own roof runs, so the remaining roof geometry
 * is exactly the builder's.
 */
function removeWell(group, stock, panLocalX) {
  const removed = []
  if (stock === 'D') {
    const floor = group.children.filter(child => child.name === 'pantograph-roof-well')
    assert.equal(floor.length, 1, `${stock}: expected one pantograph-roof-well, got ${floor.length}`)
    removed.push(...floor)
    const walls = group.children.filter(child => {
      if (child.name || !child.isMesh) return false
      const b = box(child)
      const cx = (b.min.x + b.max.x) / 2
      return Math.abs(cx - panLocalX) <= WELL_HALF + 0.06 &&
        b.min.z >= PANTOGRAPH_MOUNT_Z - 0.03 && b.max.z <= D_ROOF + 0.02
    })
    assert.equal(walls.length, 4, `${stock}: expected four well walls, got ${walls.length}`)
    removed.push(...walls)
    for (const part of removed) group.remove(part)
    const runs = group.children.filter(child => child.name === 'd-car-roof')
    assert.ok(runs.length >= 2, `${stock}: expected the split d-car-roof runs`)
    for (const run of runs) {
      const b = box(run)
      assert.ok(b.max.x <= panLocalX - WELL_HALF + 0.02 || b.min.x >= panLocalX + WELL_HALF - 0.02,
        `${stock}: a roof run still covers the collector well`)
    }
  } else {
    const roofs = group.children.filter(child => {
      if (child.name !== 'car-roof') return false
      const b = box(child)
      return Math.abs((b.max.x - b.min.x) - WELL_LENGTH) < 0.02 &&
        Math.abs((b.min.x + b.max.x) / 2 - panLocalX) < 0.06
    })
    assert.equal(roofs.length, 1, `${stock}: expected one 2.24 m roof run over the well, got ${roofs.length}`)
    for (const roof of roofs) group.remove(roof)
    for (const roof of group.children.filter(child => child.name === 'car-roof')) {
      const b = box(roof)
      assert.ok(b.max.x <= panLocalX - WELL_HALF + 0.02 || b.min.x >= panLocalX + WELL_HALF - 0.02,
        `${stock}: a roof run still covers the collector well`)
    }
  }
  return { localX: panLocalX, halfLength: WELL_HALF }
}

/** A doorway's oracle centre and width for the car the part was lifted from. */
function doorwayFor(stock, canonicalCars, carCentre, localX) {
  const L = STOCK[stock].length
  const centres = doorCentres({ stock, cars: canonicalCars })
    .filter(offset => Math.abs(offset - carCentre) < L / 2)
  assert.ok(centres.length > 0, `${stock}: no door centre in the extracted car`)
  let nearest = centres[0]
  for (const offset of centres) if (Math.abs(offset - carCentre - localX) < Math.abs(nearest - carCentre - localX)) nearest = offset
  return {
    centre: nearest - carCentre,
    width: doorWidthAt({ stock, cars: canonicalCars }, nearest),
  }
}

/**
 * Turn one partitioned car into a reusable part: shift the door samples into
 * car-local coordinates, name every leaf, and build the two bank clips.
 */
function makeCarPart(mats, stock, canonicalCars, train, group, carCentre, pantographs, meta, samples) {
  const s = STOCK[stock]
  const pan = pantographs[0]
  assert.ok(pan, `${meta.id}: the canonical car is not powered`)
  const panLocalX = pan.position.x
  for (const extra of pantographs) group.remove(extra)
  const gap = removeWell(group, stock, panLocalX)
  group.name = meta.id

  const leaves = train.userData.doors.filter(leaf => group.children.includes(leaf))
  assert.ok(leaves.length > 0, `${meta.id}: no door leaves in the extracted car`)
  const doorways = new Map()
  const doors = []
  for (const leaf of leaves) {
    const sample = samples.get(leaf)
    assert.ok(sample, `${meta.id}: no sampled poses for a leaf`)
    const local = sample.map(position => [position[0] - carCentre, position[1], position[2]])
    const { centre, width } = doorwayFor(stock, canonicalCars, carCentre, leaf.position.x)
    const key = centre.toFixed(5)
    if (!doorways.has(key)) doorways.set(key, {
      centre, width, single: Math.abs(width - (s.singleEndDoorWidth ?? -1)) < 1e-6, leaves: [],
    })
    doorways.get(key).leaves.push(leaf)
    doors.push({
      leaf,
      side: leaf.userData.side ?? 1,
      doorway: key,
      closed: leaf.position.toArray(),
      samples: local,
      travel: leaf.userData.travel,
      openSign: leaf.userData.openSign,
      plugTravel: leaf.userData.plugTravel ?? 0,
    })
    leaf.userData.closedX -= carCentre
  }
  const ordered = [...doorways.values()].sort((a, b) => a.centre - b.centre)
  ordered.forEach((doorway, index) => {
    doorway.index = index
    for (const side of [-1, 1]) {
      const count = doorway.leaves.filter(leaf => (leaf.userData.side ?? 1) === side).length
      assert.equal(count, doorway.single ? 1 : 2,
        `${meta.id}: doorway ${index} side ${side} has ${count} leaves, expected ${doorway.single ? 1 : 2}`)
    }
  })
  const prefix = `${meta.id}Door`
  const named = doors.slice().sort((a, b) =>
    Math.abs(a.closed[0] - b.closed[0]) > 1e-9 ? a.closed[0] - b.closed[0]
      : a.side - b.side)
  named.forEach((door, index) => {
    door.leaf.name = `${prefix}${String(index).padStart(2, '0')}`
    door.name = door.leaf.name
  })
  for (const doorway of ordered) {
    doorway.leaves = doorway.leaves.map(leaf => leaf.name).sort()
  }
  const bounds = new THREE.Box3().setFromObject(group)
  const size = bounds.getSize(new THREE.Vector3())
  return {
    id: meta.id,
    file: meta.file,
    kind: meta.kind,
    stock,
    canonicalCars,
    lamp: meta.lamp ?? null,
    group,
    gap,
    bounds,
    size,
    doors: named.map(door => ({
      name: door.name,
      side: door.side,
      doorway: ordered.find(doorway => doorway.leaves.includes(door.name)).index,
      closed: door.closed,
      samples: door.samples,
      travel: door.travel,
      openSign: door.openSign,
      plugTravel: door.plugTravel,
    })),
    doorways: ordered.map(doorway => ({ centre: doorway.centre, width: doorway.width, single: doorway.single })),
    doorPrefix: prefix,
  }
}

/* ------------------------------------------------------- standalone parts */

function buildPlainRoof(mats, stock, id, file) {
  const group = new THREE.Group()
  group.name = id
  const s = STOCK[stock]
  if (stock === 'D') {
    const geometry = dSurface((u, v) => new THREE.Vector3(
      THREE.MathUtils.lerp(-WELL_HALF, WELL_HALF, u),
      THREE.MathUtils.lerp(-D_CROWN_HALF, D_CROWN_HALF, v),
      D_ROOF), 1, 1, true)
    const mesh = new THREE.Mesh(geometry, mats.trainBody)
    mesh.name = 'd-car-roof'
    group.add(mesh)
  } else {
    const geometry = new THREE.ExtrudeGeometry(carRoofSection(s.width), {
      depth: WELL_LENGTH, bevelEnabled: false, curveSegments: 32,
    })
    geometry.rotateY(Math.PI / 2)
    geometry.rotateX(Math.PI / 2)
    openRoofUnderside(geometry)
    smoothCarRoof(geometry, s.width)
    const mesh = new THREE.Mesh(geometry, mats.trainBody)
    mesh.name = 'car-roof'
    mesh.position.x = -WELL_HALF
    group.add(mesh)
  }
  return { group, id, file, kind: 'roof-plain', stock }
}

function buildWellRoof(mats, stock, id, file) {
  const group = new THREE.Group()
  group.name = id
  const s = STOCK[stock]
  if (stock === 'D') {
    const height = D_ROOF - PANTOGRAPH_MOUNT_Z
    const floor = slab(group, mats.trainBody, 0, 0, PANTOGRAPH_MOUNT_Z - 0.01, WELL_LENGTH, D_CROWN_HALF * 2, 0.02)
    floor.name = 'pantograph-roof-well'
    openRoofUnderside(floor.geometry)
    for (const side of [-1, 1]) {
      const wall = slab(group, mats.trainBody, 0, side * D_CROWN_HALF, (D_ROOF + PANTOGRAPH_MOUNT_Z) / 2,
        WELL_LENGTH, 0.02, height)
      wall.name = 'pantograph-roof-well-side'
    }
    for (const end of [-1, 1]) {
      const wall = slab(group, mats.trainBody, end * WELL_HALF, 0, (D_ROOF + PANTOGRAPH_MOUNT_Z) / 2,
        0.02, D_CROWN_HALF * 2, height)
      wall.name = 'pantograph-roof-well-end'
    }
  } else {
    const geometry = new THREE.ExtrudeGeometry(carRoofSection(s.width, false, PANTOGRAPH_MOUNT_Z), {
      depth: WELL_LENGTH, bevelEnabled: false, curveSegments: 32,
    })
    geometry.rotateY(Math.PI / 2)
    geometry.rotateX(Math.PI / 2)
    openRoofUnderside(geometry)
    smoothCarRoof(geometry, s.width)
    const mesh = new THREE.Mesh(geometry, mats.trainBody)
    mesh.name = 'car-roof'
    mesh.position.x = -WELL_HALF
    group.add(mesh)
  }
  return { group, id, file, kind: 'roof-well', stock }
}

function buildGangwayPart(mats, stock, id, file) {
  const group = new THREE.Group()
  group.name = id
  if (stock === 'D') buildDGangway(group, mats, 0)
  else buildConsistGangways(group, mats, [0], STOCK[stock].width)
  return { group, id, file, kind: 'gangway', stock }
}

function buildPantographPart(mats, id, file) {
  const group = new THREE.Group()
  group.name = id
  buildTrainPantograph(group, mats, 0, 1, PANTOGRAPH_MOUNT_Z)
  return { group, id, file, kind: 'pantograph', stock: null }
}

/* ---------------------------------------------------------------- export */

function nameMaterials(mats, part, livery, badge, owned) {
  const baseNames = new Map(Object.entries(mats).map(([name, material]) => [material, name]))
  baseNames.set(livery, 'lineLivery')
  if (badge) baseNames.set(badge, 'chongqingTrainMark')
  for (const material of owned) {
    const hex = material.color?.getHexString?.()
    if (material === livery || material === badge) continue
    if (hex === '586879') baseNames.set(material, 'cabinFloor')
    else if (hex === '527c91') baseNames.set(material, 'dCabGlass')
    else if (hex === 'e73541') baseNames.set(material, 'dCabAccent')
  }
  const materials = new Map()
  const used = new Set()
  const alphaMaterials = []
  const glassMaterials = []
  const textures = new Set()
  let meshes = 0
  let triangles = 0
  part.traverse(object => {
    object.userData = {}
    if (!object.isMesh) return
    meshes++
    triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      let name = materials.get(material)
      if (!name) {
        const base = baseNames.get(material) ?? `trainMaterial${materials.size}`
        name = base
        let suffix = 2
        while (used.has(name)) name = `${base}${suffix++}`
        materials.set(material, name)
        used.add(name)
        if (material.transparent) alphaMaterials.push(name)
        if (name.toLowerCase().includes('glass')) glassMaterials.push(name)
      }
      material.name = name
      if (material.map) textures.add(material.map)
    }
  })
  return {
    materials: [...materials.values()].sort(),
    alphaMaterials: [...new Set(alphaMaterials)].sort(),
    glassMaterials: [...new Set(glassMaterials)].sort(),
    textureCount: textures.size,
    meshes,
    triangles,
  }
}

/**
 * The top surface on the roof's centre line: 3.15/3.25 for a plain cap and
 * 2.85 for a well. A downward ray at the lateral centre is the same probe the
 * TypeScript pantograph test uses to prove the collector sits in a real recess.
 */
function centreTopZ(group) {
  group.updateMatrixWorld(true)
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1))
  const hit = ray.intersectObject(group, true)[0]
  return hit ? hit.point.z : null
}

/** Finish one part: deterministic materials, wrapper, GLB and manifest. */
async function exportPart(mats, spec, context, out) {
  const { group } = spec
  const naming = nameMaterials(mats, group, context.livery, context.badge, context.owned)
  assert.ok(naming.triangles > 0, `${spec.id}: no geometry`)
  const bounds = new THREE.Box3().setFromObject(group)
  const size = bounds.getSize(new THREE.Vector3())
  const clips = []
  if (spec.kind === 'cab' || spec.kind === 'mid') {
    const tracks = { OpenPlus: [], OpenMinus: [] }
    for (const door of spec.doors) {
      const bank = door.side === 1 ? 'OpenPlus' : 'OpenMinus'
      const sample = door.samples
      const positions = bank === 'OpenPlus'
        ? [sample[0], sample[1], sample[2]]
        : [sample[0], sample[3], sample[4]]
      tracks[bank].push(new THREE.VectorKeyframeTrack(`${door.name}.position`, [0, 0.18, 1],
        positions.flatMap(position => position)))
    }
    for (const name of ['OpenPlus', 'OpenMinus']) {
      if (tracks[name].length) clips.push(new THREE.AnimationClip(name, 1, tracks[name]))
    }
    assert.equal(clips.length, 2, `${spec.id}: both door banks must carry a clip`)
  }
  const root = new THREE.Group()
  root.name = spec.id
  group.name = `${spec.id}Part`
  root.rotation.x = -Math.PI / 2
  root.add(group)
  const options = { binary: true }
  if (clips.length) options.animations = clips
  const bytes = new Uint8Array(await new GLTFExporter().parseAsync(root, options))
  const report = await validator.validateBytes(bytes, { uri: spec.file })
  const reportName = spec.file.replace(/\.glb$/, '.validation.json')
  await writeFile(join(out, reportName), JSON.stringify(report, null, 2) + '\n')
  assert.equal(report.issues.numErrors + report.issues.numWarnings, 0,
    `${spec.file}: ${report.issues.numErrors} errors, ${report.issues.numWarnings} warnings`)
  const manifest = {
    schemaVersion: 1,
    id: spec.id,
    file: spec.file,
    kind: spec.kind,
    stock: spec.stock,
    canonicalCars: spec.canonicalCars ?? null,
    lamp: spec.lamp ?? null,
    source: 'game/src/render/models/pieces/TrainModel.ts (car body) + TrainPantograph.ts / DTrainShell.ts (roof option)',
    provenance: 'Repository procedural rolling-stock geometry, palette and canvas generators; body lifted from buildTrain, roof well separated as a reusable module',
    units: 'metres',
    min: bounds.min.toArray(),
    max: bounds.max.toArray(),
    size: size.toArray(),
    triangles: naming.triangles,
    meshes: naming.meshes,
    materials: naming.materials,
    alphaMaterials: naming.alphaMaterials,
    glassMaterials: naming.glassMaterials,
    textures: naming.textureCount,
    clips: clips.map(clip => clip.name),
    doorPrefix: spec.doorPrefix ?? null,
    doors: spec.doors?.map(door => ({
      name: door.name,
      side: door.side,
      doorway: door.doorway,
      travel: door.travel,
      openSign: door.openSign,
      plugTravel: door.plugTravel,
      samples: door.samples.map(position => ({ position })),
    })) ?? [],
    doorways: spec.doorways ?? [],
    gap: spec.gap ?? null,
    bodyHalf: spec.kind === 'cab' || spec.kind === 'mid' ? (STOCK[spec.stock].length - CAR_GAP) / 2 : null,
  }
  if (spec.kind === 'roof-plain' || spec.kind === 'roof-well') {
    manifest.centreTopZ = centreTopZ(group)
    manifest.well = spec.kind === 'roof-well'
  }
  if (spec.kind === 'pantograph') {
    manifest.mountZ = PANTOGRAPH_MOUNT_Z
    manifest.contactZ = PANTOGRAPH_CONTACT_Z
    manifest.elbow = 1
  }
  if (spec.kind === 'gangway') manifest.gapLength = size.x
  manifest.sha256 = createHash('sha256').update(bytes).digest('hex')
  manifest.validation = { errors: report.issues.numErrors, warnings: report.issues.numWarnings }
  await writeFile(join(out, spec.file), bytes)
  await writeFile(join(out, spec.file.replace(/\.glb$/, '.manifest.json')), JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}

/* ------------------------------------------------------- the 50-cell plan */

function sameNumber(a, b, tolerance = 1e-6) {
  return Math.abs(a - b) <= tolerance
}

function anchors() {
  return { AxisX: [1, 0, 0], Front: [0, 1, 0], Up: [0, 0, 1], Approach: [0, -1, 0] }
}

/**
 * Assemble one editor cell from the shared parts and compare every invariant
 * with the TypeScript oracle. Returns the plan the Unity review rebuilds plus
 * a `checks` map and a pass/fail status.
 */
function assembleCell(stock, power, cars, dirSign, library) {
  const s = STOCK[stock]
  const L = s.length
  const total = L * cars
  const halfLen = (L - CAR_GAP) / 2
  const mountOffset = halfLen - 2
  const carCentre = (c) => c * L + L / 2 - total / 2
  const failures = []
  const check = (condition, message) => { if (!condition) failures.push(message) }

  const layout = []
  for (let c = 0; c < cars; c++) {
    const end = c === 0 || c === cars - 1
    const direction = power === 'catenary' ? pantographElbowDirection(stock, cars, c) : 0
    let part
    let rotation = 0
    if (!end) {
      part = library.mid
      rotation = direction === -1 ? 180 : 0
    } else if (c === cars - 1) {
      part = dirSign >= 0 ? library.lead : library.trail
      rotation = dirSign >= 0 ? 0 : 180
    } else {
      part = dirSign >= 0 ? library.trail : library.lead
      rotation = dirSign >= 0 ? 0 : 180
    }
    const gapX = carCentre(c) + (rotation ? -part.gap.localX : part.gap.localX)
    const module = direction === 0 ? 'plain' : 'well'
    layout.push({
      index: c,
      centre: carCentre(c),
      role: part.kind === 'cab' ? (part.lamp === 'head' ? 'lead' : 'trail') : 'mid',
      part: part.id,
      rotation,
      gapX,
      module,
      panDirection: direction,
      panX: direction === 0 ? 0 : gapX,
      partData: part,
    })
  }

  // Car spacing and consist length.
  check(layout.length === cars, `car count ${layout.length} != ${cars}`)
  for (let c = 1; c < cars; c++) {
    check(sameNumber(layout[c].centre - layout[c - 1].centre, L), `car ${c} spacing is not ${L}`)
  }
  check(sameNumber(total, L * cars), 'formation length is not stock length × cars')
  check(sameNumber(halfLen * 2 + CAR_GAP, L), 'car body length + gangway gap is not the stock length')

  // Overall geometry: the two cab noses plus their couplers, measured from the
  // real part bounds. A rotated part mirrors its local x range.
  let minX = Infinity
  let maxX = -Infinity
  for (const car of layout) {
    const part = car.partData
    const partMin = car.rotation ? -part.bounds.max.x : part.bounds.min.x
    const partMax = car.rotation ? -part.bounds.min.x : part.bounds.max.x
    minX = Math.min(minX, car.centre + partMin)
    maxX = Math.max(maxX, car.centre + partMax)
  }
  const overall = maxX - minX
  const right = layout[cars - 1]
  const left = layout[0]
  // The cab re-skin reaches the stock envelope's half length; only the coupler
  // hangs past it. Measure both overhangs from the real part geometry.
  const rightOuter = right.rotation ? -right.partData.bounds.min.x : right.partData.bounds.max.x
  const leftOuter = left.rotation ? -left.partData.bounds.max.x : left.partData.bounds.min.x
  const rightOverhang = rightOuter - L / 2
  const leftOverhang = -leftOuter - L / 2
  check(overall > total - 1e-6, 'assembled length is shorter than the stock envelope')
  check(sameNumber(overall, total + rightOverhang + leftOverhang, 0.02), 'assembled length does not match the cab overhangs')

  // Every part carries the body face at ±halfLen on its inboard side.
  for (const car of layout) {
    const part = car.partData
    const localMin = car.rotation ? -part.bounds.max.x : part.bounds.min.x
    const localMax = car.rotation ? -part.bounds.min.x : part.bounds.max.x
    check(sameNumber(localMin, -halfLen, 0.02) || sameNumber(localMax, halfLen, 0.02),
      `car ${car.index} has no body face at the car envelope`)
  }

  // Doors: every oracle centre and width, in every car.
  const expectedDoorCentres = doorCentres({ stock, cars })
  const expectedDoorWidths = expectedDoorCentres.map(offset => doorWidthAt({ stock, cars }, offset))
  let doorMaxDelta = 0
  for (let c = 0; c < cars; c++) {
    const expected = expectedDoorCentres
      .map((offset, index) => ({ offset, width: expectedDoorWidths[index] }))
      .filter(door => Math.abs(door.offset - carCentre(c)) < L / 2)
      .sort((a, b) => a.offset - b.offset)
    const part = layout[c].partData
    const actual = part.doorways
      .map(doorway => ({
        offset: carCentre(c) + (layout[c].rotation ? -doorway.centre : doorway.centre),
        width: doorway.width,
      }))
      .sort((a, b) => a.offset - b.offset)
    check(actual.length === expected.length, `car ${c}: ${actual.length} doorways, expected ${expected.length}`)
    for (let i = 0; i < Math.min(actual.length, expected.length); i++) {
      // `doorCentres` rounds the offset from the consist centre to 0.1 m. The
      // shared car part carries its canonical (two-car) local cadence, so an
      // odd car count can move a doorway by up to half that grid. Widths and
      // car spacing stay exact; the measured delta is recorded per cell.
      const delta = Math.abs(actual[i].offset - expected[i].offset)
      doorMaxDelta = Math.max(doorMaxDelta, delta)
      check(delta <= 0.051,
        `car ${c} doorway ${i}: ${actual[i].offset.toFixed(3)} != ${expected[i].offset.toFixed(3)} (delta ${delta.toFixed(3)})`)
      check(sameNumber(actual[i].width, expected[i].width, 1e-6),
        `car ${c} doorway ${i}: width ${actual[i].width} != ${expected[i].width}`)
    }
  }

  // Door clips: OpenPlus drives the +y bank through plug then slide while the
  // -y bank stays shut; OpenMinus is the mirror. Every pose is checked against
  // the samples the game's own setDoorsSides produced.
  for (const car of layout) {
    const part = car.partData
    check(part.doors.filter(door => door.side === 1).length === part.doors.filter(door => door.side === -1).length,
      `car ${car.index}: the two door banks differ`)
    for (const door of part.doors) {
      const samples = door.samples.map(sample => sample.position)
      const closed = samples[0]
      const plug = door.plugTravel ?? 0
      const travel = door.travel ?? 0
      const sign = door.openSign ?? 1
      const plus = door.side === 1
      const plugPose = plus ? samples[1] : samples[3]
      const openPose = plus ? samples[2] : samples[4]
      const idlePlus = plus ? samples[3] : samples[1]
      const idleMinus = plus ? samples[4] : samples[2]
      check(sameNumber(plugPose[0], closed[0], 1e-9), `car ${car.index} ${door.name}: plug pose slid the leaf`)
      check(sameNumber(Math.abs(plugPose[1] - closed[1]), plug, 1e-6), `car ${car.index} ${door.name}: plug travel`)
      check(sameNumber(openPose[0] - closed[0], sign * travel, 1e-6), `car ${car.index} ${door.name}: slide travel`)
      check(sameNumber(idlePlus[0], closed[0], 1e-9), `car ${car.index} ${door.name}: opposite bank moved`)
      check(sameNumber(idleMinus[0], closed[0], 1e-9), `car ${car.index} ${door.name}: opposite bank moved`)
    }
  }

  // Pantographs: layout, mount position and elbow direction.
  const expectedPans = []
  if (power === 'catenary') {
    for (let c = 0; c < cars; c++) {
      const direction = pantographElbowDirection(stock, cars, c)
      if (!direction) continue
      const mountEnd = c === 0 ? 1 : c === cars - 1 ? -1 : -direction
      const x = carCentre(c) + mountEnd * (halfLen - 2)
      expectedPans.push({ car: c, x, direction })
    }
  }
  const actualPans = layout.filter(car => car.panDirection !== 0).map(car => ({
    car: car.index, x: car.panX, direction: car.panDirection,
  }))
  check(actualPans.length === expectedPans.length, `${actualPans.length} pantographs, expected ${expectedPans.length}`)
  for (const expected of expectedPans) {
    const actual = actualPans.find(pan => pan.car === expected.car)
    check(actual != null, `missing pantograph on car ${expected.car}`)
    if (actual) {
      check(sameNumber(actual.x, expected.x, 1e-6), `pantograph car ${expected.car}: mount ${actual.x} != ${expected.x}`)
      check(actual.direction === expected.direction, `pantograph car ${expected.car}: elbow ${actual.direction} != ${expected.direction}`)
      check(sameNumber(layout[expected.car].gapX, expected.x, 1e-6), `car ${expected.car}: roof well is not over the mount`)
    }
  }
  if (power === 'third-rail') check(actualPans.length === 0, 'third-rail formation has a pantograph')

  // Third-rail / unpowered cars keep a plain roof over the gap.
  for (const car of layout) {
    if (car.module === 'plain') check(car.panDirection === 0, `car ${car.index} carries a pantograph with a plain cap`)
  }

  const matrix = {
    id: `${stock}-${power}-${cars}`,
    stock,
    power,
    cars,
    dirSign,
    carLength: L,
    bodyHalf: halfLen,
    gap: CAR_GAP,
    length: total,
    overall,
    carCentres: layout.map(car => car.centre),
    plan: layout.map(car => ({
      index: car.index,
      centre: car.centre,
      role: car.role,
      part: car.part,
      rotation: car.rotation,
      gapX: car.gapX,
      module: car.module,
      panDirection: car.panDirection,
      panX: car.panX,
    })),
    doorCentres: expectedDoorCentres,
    doorWidths: expectedDoorWidths,
    doorMaxDelta,
    pantographs: expectedPans,
    anchors: anchors(),
    status: failures.length ? 'FAIL' : 'PASS',
    failures,
  }
  return matrix
}

/* ------------------------------------------------------------------- main */

const out = resolve(process.argv[2] ?? '.preview/unity/formations-proof/export')
await mkdir(out, { recursive: true })
const zoo = await resolveZoo()
const stocks = process.env.FORMATIONS_STOCKS ? process.env.FORMATIONS_STOCKS.split(',') : [...STOCK_CLASSES]
for (const stock of stocks) assert.ok(STOCK_CLASSES.includes(stock), `unknown stock ${stock}`)
const fullRun = stocks.length === STOCK_CLASSES.length && STOCK_CLASSES.every(stock => stocks.includes(stock))

// One palette for the family, seeded exactly as export-rolling.
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
const library = {}
const colors = Object.fromEntries(STOCK_CLASSES.map(stock => [stock, lineColourFor(LIVERIES[stock])]))

async function exportCarParts(stock) {
  const colour = stock === zoo.stock ? zoo.colour : colors[stock]
  library[stock] = {}

  // Two-car catenary: both cabs are powered, so one build yields the leading
  // and trailing cab parts, each with its own lamp set and 2.24 m roof gap.
  const cabTrain = buildCanonical(mats, stock, 2, colour)
  const cabLivery = cabTrain.userData.liveryMaterial
  const cabBadge = cabTrain.userData.chongqingTrainMark
  const cabOwned = [...(cabTrain.userData.ownedMats ?? [])]
  const cabSamples = sampleDoorPoses(cabTrain)
  const cabParts = partition(cabTrain, stock, 2)
  const leadGroup = cabParts.groups[1]
  const trailGroup = cabParts.groups[0]
  const lead = makeCarPart(mats, stock, 2, cabTrain, leadGroup, cabParts.carCentre(1),
    cabParts.pantographs[1], { id: `Train${stock}CabLead`, file: `train-${stock.toLowerCase()}-cab-lead.glb`, kind: 'cab', lamp: 'head' }, cabSamples)
  const trail = makeCarPart(mats, stock, 2, cabTrain, trailGroup, cabParts.carCentre(0),
    cabParts.pantographs[0], { id: `Train${stock}CabTrail`, file: `train-${stock.toLowerCase()}-cab-trail.glb`, kind: 'cab', lamp: 'tail' }, cabSamples)

  // Six-car catenary: the first intermediate whose elbow points +x. It is car 1
  // for A/B/C/D ('.>..<.') and car 2 for L ('>.>..<'), so the shared mid part is
  // always stored with its well at -mountOffset and its base elbow at +1.
  const midCar = [1, 2, 3, 4].find(c => pantographElbowDirection(stock, 6, c) === 1)
  assert.ok(midCar != null, `${stock}: the six-car layout has no +x intermediate collector`)
  const midTrain = buildCanonical(mats, stock, 6, colour)
  const midLivery = midTrain.userData.liveryMaterial
  const midBadge = midTrain.userData.chongqingTrainMark
  const midOwned = [...(midTrain.userData.ownedMats ?? [])]
  const midSamples = sampleDoorPoses(midTrain)
  const midParts = partition(midTrain, stock, 6)
  const mid = makeCarPart(mats, stock, 6, midTrain, midParts.groups[midCar], midParts.carCentre(midCar),
    midParts.pantographs[midCar], { id: `Train${stock}Mid`, file: `train-${stock.toLowerCase()}-mid.glb`, kind: 'mid' }, midSamples)

  const plain = buildPlainRoof(mats, stock, `Train${stock}RoofPlain`, `train-${stock.toLowerCase()}-roof-plain.glb`)
  const well = buildWellRoof(mats, stock, `Train${stock}RoofWell`, `train-${stock.toLowerCase()}-roof-well.glb`)
  const gangway = buildGangwayPart(mats, stock, `Train${stock}Gangway`, `train-${stock.toLowerCase()}-gangway.glb`)

  const leadManifest = await exportPart(mats, lead, { livery: cabLivery, badge: cabBadge, owned: cabOwned }, out)
  const trailManifest = await exportPart(mats, trail, { livery: cabLivery, badge: cabBadge, owned: cabOwned }, out)
  const midManifest = await exportPart(mats, mid, { livery: midLivery, badge: midBadge, owned: midOwned }, out)
  const plainManifest = await exportPart(mats, plain, { livery: null, badge: null, owned: [] }, out)
  const wellManifest = await exportPart(mats, well, { livery: null, badge: null, owned: [] }, out)
  const gangwayManifest = await exportPart(mats, gangway, { livery: null, badge: null, owned: [] }, out)
  assets.push(leadManifest, trailManifest, midManifest, plainManifest, wellManifest, gangwayManifest)

  const byId = new Map(assets.map(asset => [asset.id, asset]))
  library[stock] = {
    lead: byId.get(leadManifest.id),
    trail: byId.get(trailManifest.id),
    mid: byId.get(midManifest.id),
    plain: byId.get(plainManifest.id),
    well: byId.get(wellManifest.id),
    gangway: byId.get(gangwayManifest.id),
  }
  // Attach the parsed bounds/doors the cell planner reads. manifests keep raw
  // arrays; the planner wants numbers.
  for (const part of Object.values(library[stock])) {
    part.bounds = { min: new THREE.Vector3().fromArray(part.min), max: new THREE.Vector3().fromArray(part.max) }
  }
  console.log(`${stock}: cab-lead ${leadManifest.triangles}t, cab-trail ${trailManifest.triangles}t, ` +
    `mid ${midManifest.triangles}t, plain ${plainManifest.triangles}t, well ${wellManifest.triangles}t, ` +
    `gangway ${gangwayManifest.triangles}t`)
}

for (const stock of stocks) await exportCarParts(stock)

const pantograph = buildPantographPart(mats, 'TrainPantograph', 'pantograph.glb')
const pantographManifest = await exportPart(mats, pantograph, { livery: null, badge: null, owned: [] }, out)
assets.push(pantographManifest)
console.log(`pantograph: ${pantographManifest.triangles}t`)

// Attach pantograph bounds for the summary.
pantographManifest.bounds = { min: new THREE.Vector3().fromArray(pantographManifest.min), max: new THREE.Vector3().fromArray(pantographManifest.max) }

// The 50 editor cells. Every cell is assembled twice: dirSign +1 and -1, so
// the matrix also proves travel reversal moves the leading/trailing cabs
// without moving a physical mount.
const cells = []
for (const stock of stocks) {
  for (const power of POWERS) {
    for (const cars of CAR_COUNTS) {
      const forward = assembleCell(stock, power, cars, 1, library[stock])
      const reverse = assembleCell(stock, power, cars, -1, library[stock])
      const forwardPans = JSON.stringify(forward.pantographs)
      const reversePans = JSON.stringify(reverse.pantographs)
      const reversal = {
        status: forward.status === 'PASS' && reverse.status === 'PASS' &&
          forwardPans === reversePans &&
          forward.carCentres.every((centre, index) => sameNumber(centre, reverse.carCentres[index])) &&
          forward.plan[0].role !== reverse.plan[0].role
          ? 'PASS' : 'FAIL',
        forwardMinusX: forward.plan[0].role,
        reverseMinusX: reverse.plan[0].role,
        mounts: forwardPans === reversePans,
      }
      const cell = { ...forward, dirSignReversal: reversal }
      if (reversal.status !== 'PASS') cell.failures = [...cell.failures, 'dirSign reversal did not swap the cabs cleanly']
      cell.status = cell.failures.length ? 'FAIL' : 'PASS'
      cells.push(cell)
      if (cell.status !== 'PASS') console.log(`CELL FAIL ${cell.id}: ${cell.failures.slice(0, 4).join('; ')}`)
    }
  }
}

const failed = cells.filter(cell => cell.status !== 'PASS')
const summary = {
  schemaVersion: 1,
  family: 'formations',
  sourcePaths: [
    'game/src/render/models/pieces/TrainModel.ts',
    'game/src/render/models/pieces/CabModel.ts',
    'game/src/render/models/pieces/StreamlinedCab.ts',
    'game/src/render/models/pieces/DTrainShell.ts',
    'game/src/render/models/pieces/CarShellProfile.ts',
    'game/src/render/models/pieces/TrainGangway.ts',
    'game/src/render/models/pieces/TrainInterior.ts',
    'game/src/render/models/pieces/TrainBogie.ts',
    'game/src/render/models/pieces/TrainPantograph.ts',
    'game/src/render/models/pieces/TrainRoofAc.ts',
    'game/src/render/models/PieceBuilder.ts',
    'game/src/sim/stock.ts',
    'game/src/sim/headway.ts',
    'game/src/sim/cityStyles.ts',
    'game/src/app/captureTrains.ts',
    'game/test/train-pantograph.test.mjs',
    'tools/unity-assets/train-source.mjs',
    'tools/unity-assets/export-rolling.mjs',
  ],
  parameters: {
    models: assets.length,
    partArchitecture: 'per stock: leading cab, trailing cab, intermediate car, plain roof cap, roof well, gangway; one shared pantograph',
    cells: cells.length,
    matrix: { total: cells.length, passed: cells.length - failed.length, failed: failed.length },
    powers: POWERS,
    carCounts: CAR_COUNTS,
    stocks: STOCK_CLASSES,
    zoo,
    livery: 'captureTrains.ts LIVERY_LINE resolved through lineColourFor; Zoo L uses the save colour',
    doors: 'every leaf named <Part>Door<nn>; five setDoorsSides poses sampled (closed, +plug 0.18, +open 1, -plug 0.18, -open 1); clips OpenPlus and OpenMinus, one second each, one track per leaf',
    doorRounding: 'doorCentres rounds the offset from the consist centre to 0.1 m; the shared car parts carry their canonical local cadence, so an odd car count can differ by up to 0.05 m. The matrix accepts the half-grid tolerance and records the measured delta per cell; widths and car spacing stay exact.',
    basis: 'source Z-up wrapped -90 degrees about X (glTF Y-up); Unity wrapper applies the 180-degree Y correction, so gameplay channels read (x, z, y)',
    roof: 'pantograph mounts at (halfLen - 2) from each inboard car end; well span 2.24 m at PANTOGRAPH_MOUNT_Z 2.85, contact at 3.57; third-rail/unpowered gaps are capped plain',
    rendered: '10 short two-car evidence formations (all stock × power), A 8-car overhead, Zoo L 6-car third rail',
  },
  assets: assets.map(asset => ({ ...asset, bounds: undefined })),
  parts: assets.map(asset => ({
    id: asset.id, file: asset.file, kind: asset.kind, stock: asset.stock,
    triangles: asset.triangles, bytes: undefined,
  })),
  cells,
  formations: [],
  validation: {
    errors: assets.reduce((sum, asset) => sum + asset.validation.errors, 0),
    warnings: assets.reduce((sum, asset) => sum + asset.validation.warnings, 0),
  },
}
// The formation evidence set the Unity review builds and renders.
const short = []
for (const stock of stocks) {
  for (const power of POWERS) {
    const cars = 2
    short.push({
      id: `${stock}-${power}-${cars}`,
      prefab: `Formation${stock}2${power === 'catenary' ? 'Overhead' : 'ThirdRail'}`,
      stock, power, cars, modelScale: 1, colour: colors[stock], dirSign: 1,
      doorsOpen: 'source +y bank (world +z, platform side)',
      row: null,
    })
  }
}
const long = []
if (stocks.includes('A')) long.push({
  id: 'A-catenary-8', prefab: 'FormationA8Overhead', stock: 'A', power: 'catenary', cars: 8,
  modelScale: 1, colour: colors.A, dirSign: 1, doorsOpen: 'source +y bank (world +z, platform side)',
})
if (stocks.includes(zoo.stock)) long.push({
  id: `${zoo.stock}-${zoo.power}-${zoo.cars}`,
  prefab: `Formation${zoo.stock}${zoo.cars}ThirdRailZoo`,
  stock: zoo.stock, power: zoo.power, cars: zoo.cars, modelScale: zoo.modelScale,
  colour: zoo.colour, dirSign: zoo.travelSign, doorsOpen: 'source +y bank (world +z, platform side)',
  zoo: true,
})
summary.parameters.models = assets.length
summary.parameters.cells = cells.length
summary.parameters.matrix = { total: cells.length, passed: cells.length - failed.length, failed: failed.length }
summary.parameters.stocks = stocks
summary.formations = [...short, ...long]
await writeFile(join(out, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(`FORMATIONS_EXPORT_OK ${assets.length} parts, ${cells.length} cells (${failed.length} failed), ` +
  `${summary.formations.length} evidence formations, ${summary.validation.errors} errors, ` +
  `${summary.validation.warnings} warnings -> ${out}`)
if (!fullRun) console.log('DEBUG SUBSET: not a complete 50-cell matrix')
if (failed.length) {
  console.error(`Cell matrix failed: ${failed.map(cell => cell.id).join(', ')}`)
  process.exitCode = 1
}
