// Plan 16 §2 oracle — fence, tactile and surface connections from the TypeScript game.
//
// Reads the exported `unity/Assets/StationDesigner/Demos/zoo.metro.json` envelope
// (the same bytes the Unity reader opens), runs the real TypeScript load path and
// records exactly what the game computes for the connection seam:
//
//   * `fenceConnectionIndex` / `fenceArms` (sim/fences.ts) — the four-side join mask,
//     ordered neighbour identities and the signed arm extents;
//   * `tactileArms` (sim/floorDecor.ts) as `TactileModel.build` consumes it, i.e. only
//     for a non-guide variant, with the signed arm in the tile's own frame;
//   * the real render builders `FenceModel.build`, `TactileModel.build` and
//     `OutdoorSurfaceModel.build` for the emitted geometry (triangle counts, world
//     bounds and arm slabs in document metres);
//   * `retainedModuleIds` (render/moduleDependencies.ts) for the edit-dependency API,
//     plus the `GhostSystem.setFencePreview` neighbour rule for a preview;
//   * the sidewalk/lawn tile rule, which is deliberately **not** a neighbour rule.
//
// Nothing here re-implements a rule: the sim functions are imported from `game/src`,
// and the fixture records their answers. The output goes under Tests/EditMode (a test
// fixture), never beside the gameplay documents.
//
// Usage: node tools/unity-parity/record-station-connections.mjs [--out <path>]
//
// Deterministic: the demo envelope is fixed, every source helper is pure, and every
// length is rounded to 1e-6 m before it is written.

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as THREE from '../../game/node_modules/three/build/three.module.js'
import { parse } from '../../game/src/persistence/save.ts'
import { toState } from '../../game/src/build/model.ts'
import { emptyStation } from '../../game/src/data/reference-station.ts'
import { fenceConnectionIndex, fenceArms } from '../../game/src/sim/fences.ts'
import { tactileArms } from '../../game/src/sim/floorDecor.ts'
import { gateSolidFaces } from '../../game/src/sim/gates.ts'
import { stairFlightsFor, stairSwitchbackRunWidth, STAIR_WIDTH_NARROW } from '../../game/src/sim/stairs.ts'
import { noiseBarrierVariant } from '../../game/src/sim/noiseBarriers.ts'
import { retainedModuleIds } from '../../game/src/render/moduleDependencies.ts'
import { FenceModel } from '../../game/src/render/models/pieces/FenceModel.ts'
import { TactileModel } from '../../game/src/render/models/pieces/TactileModel.ts'
import { OutdoorSurfaceModel } from '../../game/src/render/models/pieces/OutdoorSurfaceModel.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ZOO_FILE = 'unity/Assets/StationDesigner/Demos/zoo.metro.json'
const DEFAULT_OUT = 'unity/Assets/StationDesigner/Tests/EditMode/station-connections-oracle.json'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1])
const outPath = args.get('--out') ?? DEFAULT_OUT

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')
const round = (value) => (Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : value)
const point3 = (p) => [round(p.x), round(p.y), round(p.z)]

function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

function fileSha(relPath) {
  try {
    return sha256(readFileSync(resolve(ROOT, relPath), 'utf8'))
  } catch {
    return 'missing'
  }
}

/* ------------------------------------------------------------------ materials */

// The promoted assets only need their material *slots* to build source geometry.
// Values are irrelevant to triangles/bounds, so the kit is one shared set.
const materials = {
  steel: new THREE.MeshStandardMaterial(),
  darkSteel: new THREE.MeshStandardMaterial(),
  glass: new THREE.MeshStandardMaterial(),
  tactile: new THREE.MeshStandardMaterial(),
  psu: new THREE.MeshStandardMaterial(),
  outdoorSurface: new THREE.MeshStandardMaterial({ vertexColors: true }),
  white: new THREE.MeshStandardMaterial(),
  black: new THREE.MeshStandardMaterial(),
  blue: new THREE.MeshStandardMaterial(),
  trainGlass: new THREE.MeshStandardMaterial(),
  gateNavy: new THREE.MeshStandardMaterial(),
  gatePanel: new THREE.MeshStandardMaterial(),
  gatePanelBack: new THREE.MeshStandardMaterial(),
  gateCross: new THREE.MeshStandardMaterial(),
}

/* --------------------------------------------------------------- module input */

const cfgText = (value) => typeof value === 'string'
  ? value
  : value !== null && typeof value === 'object'
    ? JSON.stringify(value)
    : String(value)

function moduleDto(module) {
  const cfg = {}
  for (const [key, value] of Object.entries(module.cfg ?? {})) cfg[key] = cfgText(value)
  const dto = {
    id: module.id, type: module.type,
    x: module.x, y: module.y, z: module.z, rot: module.rot ?? 0,
    w: module.w ?? 1, d: module.d ?? 1, h: module.h ?? 1,
    cfg,
  }
  if (module.from) dto.from = point3(module.from)
  if (module.to) dto.to = point3(module.to)
  return dto
}

const modulesDto = (modules) => modules.map(moduleDto)

/** A fixture module as the save stores it; `toState` normalises it before use. */
function mod(id, type, x, y, z = 0, rot = 0, cfg = {}, extra = {}) {
  return { id, type, x, y, z, rot, w: 1, d: 1, h: 1, cfg, ...extra }
}

const fence = (id, x, y, z = 0, rot = 0, cfg = {}) => mod(id, 'fence', x, y, z, rot, cfg)
const gate = (id, x, y, z = 0, rot = 0, door = 'lane') => mod(id, 'gate', x, y, z, rot, { door })
const tactile = (id, x, y, z = 0, rot = 0, variant = 'warning') => mod(id, 'tactile', x, y, z, rot, { variant })
const sidewalk = (id, x, y, z = 0, variant = 'sidewalk') => mod(id, variant, x, y, z, 0, {})

function stair(id, base, rot, style, width, extraCfg = {}) {
  const flights = stairFlightsFor(base, rot, style, width)
  // A single-run stair stores no `cfg.flights` (the implied run is `from` → `to`); a
  // turning stair stores both legs, exactly as `createModule` writes them.
  const cfg = { style, width, block: false, ...extraCfg }
  if (flights.length > 1) cfg.flights = flights
  return {
    id, type: 'stair', x: base.x, y: base.y, z: base.z, rot, w: 1, d: 1, h: 1,
    from: { ...base }, to: { ...flights[flights.length - 1].to },
    cfg,
  }
}

/** Normalise one fixture's module list exactly as the game opens a saved station. */
function normalize(modules) {
  return toState({ ...emptyStation(), modules }).modules
}

/* ------------------------------------------------------------------- geometry */

function sourceGeometry(group) {
  group.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(group)
  let triangles = 0
  let meshes = 0
  let instances = 0
  group.traverse((object) => {
    if (!object.isMesh) return
    meshes++
    const geometry = object.geometry
    const tris = geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3
    const copies = object.isInstancedMesh ? object.count : 1
    triangles += tris * copies
    if (object.isInstancedMesh) instances += object.count
  })
  return {
    triangles: Math.round(triangles),
    meshes,
    instances,
    bounds: [round(box.min.x), round(box.min.y), round(box.min.z), round(box.max.x), round(box.max.y), round(box.max.z)],
  }
}

function fenceGeometry(module, data) {
  return sourceGeometry(new FenceModel({ mats: materials, data }).build(module))
}

function tactileGeometry(module, data) {
  return sourceGeometry(new TactileModel({ mats: materials, data }).build(module))
}

function surfaceGeometry(module, data) {
  return sourceGeometry(new OutdoorSurfaceModel({ mats: materials, data }).build(module))
}

/* ------------------------------------------------------------------- arm maths */

const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]]

function fenceRecord(module, modules, index) {
  const sides = { e: false, w: false, n: false, s: false }
  const neighbours = { e: [], w: [], n: [], s: [] }
  for (const [side, [dx, dy]] of [['e', STEPS[0]], ['w', STEPS[1]], ['n', STEPS[2]], ['s', STEPS[3]]]) {
    const x = module.x + dx, y = module.y + dy, z = module.z
    sides[side] = index.connects(x, y, z, -dx, -dy)
    neighbours[side] = modules
      .filter((other) => other.x === x && other.y === y && other.z === z)
      .map((other) => ({ id: other.id, type: other.type }))
  }
  const arms = fenceArms(module.rot, sides)
  const cx = module.x + 0.5, cy = module.y + 0.5, top = module.z + 1
  const endpoints = {
    x: arms.x1 > arms.x0
      ? [round(cx + arms.x0), round(cy), round(top), round(cx + arms.x1), round(cy), round(top)]
      : null,
    y: arms.y1 > arms.y0
      ? [round(cx), round(cy + arms.y0), round(top), round(cx), round(cy + arms.y1), round(top)]
      : null,
  }
  const record = {
    id: module.id, type: module.type, x: module.x, y: module.y, z: module.z, rot: module.rot ?? 0,
    variant: module.cfg?.variant ?? '', sides, neighbours,
    arms: { x0: arms.x0, x1: arms.x1, y0: arms.y0, y1: arms.y1, capE: arms.capE, capW: arms.capW, capN: arms.capN, capS: arms.capS },
    endpoints,
  }
  if (module.type === 'gate') {
    record.door = module.cfg?.door ?? ''
    record.solidFaces = { e: gateSolidFaces(module, 1, 0), w: gateSolidFaces(module, -1, 0), n: gateSolidFaces(module, 0, 1), s: gateSolidFaces(module, 0, -1) }
  }
  return record
}

function tactileRecord(module, modules) {
  // The producer of the emitted geometry is `TactileModel.build`: it draws arms for
  // every non-guide variant and reads them in the tile's own frame. A guide tile never
  // reaches the rule, even where the pure `tactileArms` helper would answer.
  const applies = typeof module.cfg?.variant === 'string' && module.cfg.variant !== 'guide'
  const arms = applies ? tactileArms(module, modules) : []
  const strip = module.cfg?.variant === 'warning-strip'
  const cx = module.x + 0.5, cy = module.y + 0.5, top = module.z + 1
  const rotate = (x, y) => {
    switch ((((module.rot ?? 0) % 4) + 4) % 4) {
      case 1: return [-y, x]
      case 2: return [-x, -y]
      case 3: return [y, -x]
      default: return [x, y]
    }
  }
  const records = arms.map(([dx, dy]) => {
    // `TactileModel.build` emits the arm slab plus its dot field:
    //   slab(g, tactile, dx*0.3625, dy*0.3625, .003, dx?0.275:0.45, dy?0.275:0.45, .006)
    //   dots at dx?[dx*along, across] : [across, dy*along], radius .025
    // The strip's along values start at .24, so its dots reach .215 — 10 mm past the
    // centre square's edge the slab starts from. The emitted AABB is the union, in the
    // tile's own frame, rotated by the tile's saved turn.
    const sign = dx !== 0 ? dx : dy
    const stripAlong = strip ? (sign > 0 ? [0.215, 0.5] : [-0.5, -0.215]) : (sign > 0 ? [0.225, 0.5] : [-0.5, -0.225])
    const corners = []
    for (const along of stripAlong) {
      for (const across of [-0.225, 0.225]) {
        corners.push(dx !== 0 ? [along, across] : [across, along])
      }
    }
    const rotated = corners.map(([x, y]) => rotate(x, y))
    const xs = rotated.map(([x]) => x), ys = rotated.map(([, y]) => y)
    const arm = {
      min: [round(cx + Math.min(...xs)), round(cy + Math.min(...ys)), round(top)],
      max: [round(cx + Math.max(...xs)), round(cy + Math.max(...ys)), round(top + 0.012)],
    }
    // The arm `[-dx,-dy]` would be the same geometry reflected through the cell centre.
    const mirrorAlong = strip
      ? (sign > 0 ? [-0.5, -0.215] : [0.215, 0.5])
      : (sign > 0 ? [-0.5, -0.225] : [0.225, 0.5])
    const mirrorCorners = []
    for (const along of mirrorAlong) {
      for (const across of [-0.225, 0.225]) {
        mirrorCorners.push(dx !== 0 ? [along, across] : [across, along])
      }
    }
    const mirrorRotated = mirrorCorners.map(([x, y]) => rotate(x, y))
    const mxs = mirrorRotated.map(([x]) => x), mys = mirrorRotated.map(([, y]) => y)
    const mirror = {
      min: [round(cx + Math.min(...mxs)), round(cy + Math.min(...mys)), round(top)],
      max: [round(cx + Math.max(...mxs)), round(cy + Math.max(...mys)), round(top + 0.012)],
    }
    return { dx, dy, slab: arm, mirror }
  })
  return {
    id: module.id, x: module.x, y: module.y, z: module.z, rot: module.rot ?? 0,
    variant: module.cfg?.variant ?? '', applies, strip, arms: records,
  }
}

/* --------------------------------------------------------------- Zoo document */

const zooText = readFileSync(resolve(ROOT, ZOO_FILE), 'utf8')
const zooLoaded = parse(zooText)
if (!zooLoaded.ok) throw new Error(ZOO_FILE + ' does not parse: ' + zooLoaded.error)
const zooState = zooLoaded.state
const zooModules = zooState.modules
const zooIndex = fenceConnectionIndex(zooModules)
const zooFacts = { ...zooState }

const zooFenceRecords = zooModules.filter((m) => m.type === 'fence').map((m) => {
  const record = fenceRecord(m, zooModules, zooIndex)
  record.sourceGeometry = fenceGeometry(m, zooFacts)
  return record
})
const zooTactileRecords = zooModules.filter((m) => m.type === 'tactile').map((m) => {
  const record = tactileRecord(m, zooModules)
  record.sourceGeometry = tactileGeometry(m, zooFacts)
  return record
})
const zooGateRecords = zooModules.filter((m) => m.type === 'gate').map((m) => fenceRecord(m, zooModules, zooIndex))

/** The gate-side corner in the plan's image 1: fence-81 meets a doorless gate's
 * machine face on its west and the run south; the run continues past fence-755
 * (a `gate`-variant panel) to the end at fence-64. */
const CORNER_IDS = ['gate-245', 'fence-81', 'fence-80', 'fence-755', 'fence-65', 'fence-64']
const cornerRecords = zooModules
  .filter((m) => CORNER_IDS.includes(m.id))
  .map((m) => {
    if (m.type !== 'fence' && m.type !== 'gate') return null
    const record = fenceRecord(m, zooModules, zooIndex)
    record.sourceGeometry = fenceGeometry(m, zooFacts)
    return record
  })
  .filter(Boolean)

/** The same corner with gate-245 removed, then with fence-80 removed too. */
function zooWithout(ids) {
  const modules = zooModules.filter((m) => !ids.includes(m.id))
  const index = fenceConnectionIndex(modules)
  const fence81 = modules.find((m) => m.id === 'fence-81')
  const record = fenceRecord(fence81, modules, index)
  record.sourceGeometry = fenceGeometry(fence81, { ...zooState, modules })
  return { removed: ids, fence81: record }
}

/** The same edit reopened from an envelope: the save is edited as JSON, exactly as a
 * delete transaction would write it, and parsed again through the game's own reader. */
function zooReopenedWithout(ids) {
  const envelope = JSON.parse(zooText)
  envelope.static.modules = envelope.static.modules.filter((m) => !ids.includes(m.id))
  const reopened = parse(JSON.stringify(envelope))
  if (!reopened.ok) throw new Error('reopened Zoo does not parse: ' + reopened.error)
  const modules = reopened.state.modules
  const index = fenceConnectionIndex(modules)
  const fence81 = modules.find((m) => m.id === 'fence-81')
  const record = fenceRecord(fence81, modules, index)
  record.sourceGeometry = fenceGeometry(fence81, reopened.state)
  return record
}

const zoo = {
  file: ZOO_FILE,
  sha256: sha256(zooText),
  cells: zooState.cells.length,
  modules: zooState.modules.length,
  lines: zooState.lines.length,
  counts: {
    fences: zooFenceRecords.length,
    gates: zooGateRecords.length,
    tactiles: zooTactileRecords.length,
    tactileApplying: zooTactileRecords.filter((record) => record.applies).length,
    tactileArms: zooTactileRecords.reduce((sum, record) => sum + record.arms.length, 0),
    fenceJunctions: zooFenceRecords.filter((record) => record.arms.x1 > record.arms.x0 && record.arms.y1 > record.arms.y0).length,
  },
  image1Corner: {
    label: 'gate-side corner (plan 16 §2 image 1)',
    ids: CORNER_IDS,
    note: 'fence-81 joins gate-245’s doorless machine face west and the fence run south; the run continues past the gate-variant panel fence-755 to fence-64.',
    records: cornerRecords,
    deletion: {
      withoutGate: zooWithout(['gate-245']),
      withoutGateAndSouthRun: zooWithout(['gate-245', 'fence-80']),
      reopenedWithoutGate: zooReopenedWithout(['gate-245']),
    },
  },
  fences: zooFenceRecords,
  gates: zooGateRecords,
  tactiles: zooTactileRecords,
}

/* ------------------------------------------------------------------- fixtures */

const fixtures = []

function addFixture(id, kind, note, rawModules, options = {}) {
  const modules = normalize(rawModules)
  const data = { ...emptyStation(), cells: [], modules }
  const index = fenceConnectionIndex(modules)
  const fences = modules.filter((m) => m.type === 'fence' || m.type === 'gate').map((m) => {
    const record = fenceRecord(m, modules, index)
    record.sourceGeometry = fenceGeometry(m, data)
    return record
  })
  const tactiles = modules.filter((m) => m.type === 'tactile').map((m) => {
    const record = tactileRecord(m, modules)
    record.sourceGeometry = tactileGeometry(m, data)
    return record
  })
  const entry = { id, kind, note, modules: modulesDto(modules), fences, tactiles }
  if (options.surfaces) entry.surfaces = options.surfaces(modules, data)
  if (options.gaps) entry.gaps = options.gaps
  fixtures.push(entry)
  return { modules, data, index, entry }
}

addFixture('fence-straight', 'fence',
  'A four-cell glass run: two interior cells join east+west, the two ends cap their far edge.',
  [fence('s0', 0, 0), fence('s1', 1, 0), fence('s2', 2, 0), fence('s3', 3, 0)])

addFixture('fence-corner', 'fence',
  'An L: the corner cell joins east and north and draws two half arms; nothing caps.',
  [fence('c', 0, 0), fence('ce', 1, 0), fence('cn', 0, 1)])

addFixture('fence-tee', 'fence',
  'A T: the centre joins east, west and north.',
  [fence('t', 0, 0), fence('te', 1, 0), fence('tw', -1, 0), fence('tn', 0, 1)])

addFixture('fence-cross', 'fence',
  'A +: four arms, no caps.',
  [fence('x', 0, 0), fence('xe', 1, 0), fence('xw', -1, 0), fence('xn', 0, 1), fence('xs', 0, -1)])

addFixture('fence-gate-faces', 'fence',
  'A lane gate joins only on its machine face; its lane side is a doorway. A doorless gate is solid all round.',
  [
    fence('ga-fence', 0, 0), gate('ga-east-lane', 1, 0, 0, 0, 'lane'),
    fence('gb-fence', 0, 2), gate('gb-east-lane-turn', 1, 2, 0, 2, 'lane'),
    fence('gc-fence', 0, 4), gate('gc-east-doorless', 1, 4, 0, 0, 'fence'),
  ])

const WIDE_STAIR = { x: 10, y: 0, z: 0 }
const SWITCHBACK = { x: 20, y: 0, z: 0 }
const QUARTER = { x: 40, y: 0, z: 0 }
const ESCALATOR2 = { x: 60, y: 0, z: 0 }
const ESCALATOR3 = { x: 70, y: 0, z: 0 }
const WALKWAY = { x: 80, y: 0, z: 0 }
const LIFT = { x: 90, y: 0, z: 0 }
const BLOCK = { x: 100, y: 0, z: 0 }

const straightStair = stair('stair-straight', { x: 0, y: 0, z: 0 }, 0, 'straight', STAIR_WIDTH_NARROW)
const wideStair = stair('stair-wide', WIDE_STAIR, 0, 'straight', 2.04)
const switchbackStair = stair('stair-switchback', SWITCHBACK, 0, 'right180', stairSwitchbackRunWidth(1.36))
const quarterStair = stair('stair-quarter', QUARTER, 0, 'right90', STAIR_WIDTH_NARROW)
const escalator2 = mod('escalator-2', 'escalator', ESCALATOR2.x, ESCALATOR2.y, 0, 0, { width: 2 }, { from: { x: 60, y: 0, z: 0 }, to: { x: 60, y: 3, z: 0 } })
const escalator3 = mod('escalator-3', 'escalator', ESCALATOR3.x, ESCALATOR3.y, 0, 0, { width: 3 }, { from: { x: 70, y: 0, z: 0 }, to: { x: 70, y: 3, z: 0 } })
const walkway = mod('walkway-1', 'walkway', WALKWAY.x, WALKWAY.y, 0, 0, {}, { from: { x: 80, y: 0, z: 0 }, to: { x: 80, y: 3, z: 0 } })
const lift = mod('lift-1', 'lift', LIFT.x, LIFT.y, 0, 0, { size: 2 }, { from: { x: 90, y: 0, z: 0 }, to: { x: 90, y: 3, z: 0 } })
const blockStair = mod('stair-block-1', 'stair', BLOCK.x, BLOCK.y, 0, 0, { block: true, width: STAIR_WIDTH_NARROW }, { from: { x: 100, y: 0, z: 0 }, to: { x: 100, y: 1, z: 1 } })

addFixture('fence-rail-landings', 'fence',
  'Rail landings open a fence run: a straight stair’s full-width band, a wide stair’s band one cell away from its base, a switchback’s lower and upper landing, a 90° turn’s two landings, an escalator’s own landings (1/2/3 lanes) and a walkway’s. A lift landing and a 楼梯块 are deliberately not indexed (kind: gap).',
  [
    straightStair, wideStair, switchbackStair, quarterStair,
    escalator2, escalator3, walkway, lift, blockStair,
    fence('land-straight-lower', 1, 0), fence('land-straight-upper', 1, 8, 5),
    fence('land-wide-edge', 13, 0),
    fence('land-switchback-lower', 19, 0), fence('land-switchback-top', 23, 0, 5),
    fence('land-quarter-lower', 39, 0), fence('land-quarter-top', 44, 5, 5),
    fence('land-escalator-2', 59, 0), fence('land-escalator-2-lane', 61, -1),
    fence('land-escalator-3', 69, 0), fence('land-escalator-3-lane2', 72, -1),
    fence('land-walkway', 81, 0),
    fence('no-land-lift', 91, 0), fence('no-land-block', 101, 0),
  ],
  {
    gaps: [
      { kind: 'gap', id: 'lift-landing', members: ['lift-1', 'no-land-lift'], rule: 'fenceConnectionIndex indexes a stair, escalator or walkway landing, never a lift; the fence ends with its own post beside a lift.', expect: 'no-land-lift.sides.w === false' },
      { kind: 'gap', id: 'block-stair-landing', members: ['stair-block-1', 'no-land-block'], rule: 'a 楼梯块 (cfg.block) has no run of its own and is skipped by the stair branch.', expect: 'no-land-block.sides.w === false' },
    ],
  })

addFixture('fence-rotations', 'fence',
  'One asymmetric L (west + north arms) through all four saved rotations: the arms are baked from the neighbours, so the saved turn must change nothing.',
  [
    fence('rot0', 0, 0, 0, 0), fence('rot0-w', -1, 0), fence('rot0-n', 0, 1),
    fence('rot1', 10, 0, 0, 1), fence('rot1-w', 9, 0), fence('rot1-n', 10, 1),
    fence('rot2', 20, 0, 0, 2), fence('rot2-w', 19, 0), fence('rot2-n', 20, 1),
    fence('rot3', 30, 0, 0, 3), fence('rot3-w', 29, 0), fence('rot3-n', 30, 1),
  ])

addFixture('fence-deletion', 'fence',
  'Edit deletion: remove the middle cell of a five-cell run and the two neighbours become capped run ends.',
  [fence('d0', 0, 0), fence('d1', 1, 0), fence('d2', 2, 0), fence('d3', 3, 0), fence('d4', 4, 0)])

addFixture('tactile-straight', 'tactile',
  'A straight warning run: interior tiles grow both along-run arms, the ends grow one.',
  [tactile('t0', 0, 0), tactile('t1', 1, 0), tactile('t2', 2, 0)])

addFixture('tactile-corner', 'tactile',
  'An L of warning squares: the corner grows east and north.',
  [tactile('l', 0, 0), tactile('le', 1, 0), tactile('ln', 0, 1)])

addFixture('tactile-tee', 'tactile', 'A T of warning squares.', [tactile('t', 0, 0), tactile('te', 1, 0), tactile('tw', -1, 0), tactile('tn', 0, 1)])

addFixture('tactile-strip', 'tactile',
  'A warning strip grows only a crosswise arm, toward a neighbour whose band crosses the shared edge; a strip beside a warning square stays unjoined (kind: gap).',
  [
    tactile('strip-east', 0, 0, 0, 0, 'warning-strip'), tactile('strip-north', 0, 1, 0, 1, 'warning-strip'),
    tactile('strip-square', 4, 0, 0, 0, 'warning-strip'), tactile('square-beside', 4, 1, 0, 0, 'warning'),
    tactile('strip-guide', 8, 0, 0, 0, 'warning-strip'), tactile('guide-crossing', 8, 1, 0, 1, 'guide'),
  ],
  {
    gaps: [
      { kind: 'gap', id: 'strip-beside-warning-square', members: ['strip-square', 'square-beside'], rule: 'a strip skips a junction square: its own one-metre top already covers the shared edge.', expect: 'strip-square has no north arm' },
      { kind: 'gap', id: 'guide-never-arms', members: ['guide-crossing'], rule: 'TactileModel.build never calls tactileArms for a guide; its ribs already run the length of the band.', expect: 'guide-crossing.applies === false' },
    ],
  })

addFixture('tactile-rotations', 'tactile',
  'One asymmetric corner (north + east neighbours) through all four saved rotations: the emitted arms must stay north + east, so the local signed arm changes with the turn.',
  [
    tactile('tr0', 0, 0, 0, 0), tactile('tr0-e', 1, 0), tactile('tr0-n', 0, 1),
    tactile('tr1', 10, 0, 0, 1), tactile('tr1-e', 11, 0), tactile('tr1-n', 10, 1),
    tactile('tr2', 20, 0, 0, 2), tactile('tr2-e', 21, 0), tactile('tr2-n', 20, 1),
    tactile('tr3', 30, 0, 0, 3), tactile('tr3-e', 31, 0), tactile('tr3-n', 30, 1),
  ])

addFixture('tactile-deletion', 'tactile',
  'Edit deletion: remove the middle tile and its neighbours lose the arm they grew toward it.',
  [tactile('q0', 0, 0), tactile('q1', 1, 0), tactile('q2', 2, 0)])

addFixture('tactile-chunk-boundary', 'tactile',
  'A join across the 16×16 chunk boundary: x = 15 and x = 16 compose the arm the other meets.',
  [tactile('cb-left', 15, 0), tactile('cb-right', 16, 0)])

addFixture('surface-sidewalk-seams', 'surface',
  'Sidewalk and lawn are repeated immutable one-metre tiles, never a neighbour shape: the sidewalk’s paver artwork carries its own 0.008 m seams and the builder reads no neighbour.',
  [sidewalk('sw0', 0, 0), sidewalk('sw1', 1, 0), sidewalk('lawn0', 2, 0, 0, 'lawn')],
  {
    surfaces: (modules, data) => modules.map((module) => {
      const geometry = surfaceGeometry(module, data)
      return {
        id: module.id, type: module.type, x: module.x, y: module.y, z: module.z,
        variant: module.cfg?.variant ?? '', sourceGeometry: geometry,
        neighbourRule: false,
        seam: module.type === 'sidewalk' ? 0.008 : 0,
      }
    }),
  })

/* --------------------------------------------------------- deletion after-images */

const straightDeletion = (() => {
  const before = normalize([fence('d0', 0, 0), fence('d1', 1, 0), fence('d2', 2, 0), fence('d3', 3, 0), fence('d4', 4, 0)])
  const after = normalize(before.filter((m) => m.id !== 'd2'))
  const beforeIndex = fenceConnectionIndex(before)
  const afterIndex = fenceConnectionIndex(after)
  const afterData = { ...emptyStation(), modules: after }
  const record = (module, index) => {
    const entry = fenceRecord(module, after, index)
    entry.sourceGeometry = fenceGeometry(module, afterData)
    return entry
  }
  return {
    removed: ['d2'],
    before: before.filter((m) => m.id === 'd1' || m.id === 'd3').map((m) => fenceRecord(m, before, beforeIndex)),
    after: after.filter((m) => m.id === 'd1' || m.id === 'd3').map((m) => record(m, afterIndex)),
  }
})()

const tactileDeletion = (() => {
  const before = normalize([tactile('q0', 0, 0), tactile('q1', 1, 0), tactile('q2', 2, 0)])
  const after = normalize(before.filter((m) => m.id !== 'q1'))
  return {
    removed: ['q1'],
    before: before.filter((m) => m.id === 'q0' || m.id === 'q2').map((m) => tactileRecord(m, before)),
    after: after.filter((m) => m.id === 'q0' || m.id === 'q2').map((m) => tactileRecord(m, after)),
  }
})()

/* ------------------------------------------------------------- edit dependencies */

const depFence = (id, x, y, z = 0, rot = 0) => mod(id, 'fence', x, y, z, rot, {})

/** The TypeScript dependency rule, run for real: everything in `after` the retention
 * analysis does **not** retain among the join families must be rebuilt; removed join
 * records are reported too, because a caller must drop their views. */
function retainedAnalysis(beforeModules, afterModules) {
  const before = toState({ ...emptyStation(), modules: beforeModules })
  const after = toState({ ...emptyStation(), modules: afterModules })
  const retained = retainedModuleIds(before, after)
  const affected = after.modules
    .filter((m) => (m.type === 'fence' || m.type === 'gate' || m.type === 'tactile') && !retained.has(m.id))
    .map((m) => m.id)
  const present = new Set(after.modules.map((m) => m.id))
  for (const module of before.modules) {
    if (!present.has(module.id) && (module.type === 'fence' || module.type === 'gate' || module.type === 'tactile')) affected.push(module.id)
  }
  return { before: before.modules, after: after.modules, retained: [...retained], affected }
}

/** The `GhostSystem.setFencePreview` rule: only adjacent **committed fences** are
 * rebuilt (a ground noise barrier keeps its own model), and the dragged candidates are
 * the new ghosts. Gates, tactile tiles and rail landings are not rebuilt by a drag. */
function previewAnalysis(stationModules, candidates) {
  const station = toState({ ...emptyStation(), modules: stationModules })
  const index = fenceConnectionIndex(station.modules)
  const affected = []
  const add = (id) => { if (id && !affected.includes(id)) affected.push(id) }
  for (const candidate of candidates) add(candidate.id)
  for (const candidate of candidates) {
    for (const [dx, dy] of STEPS) {
      for (const neighbour of index.fencesAt(candidate.x + dx, candidate.y + dy, candidate.z)) {
        if (noiseBarrierVariant(neighbour)) continue
        add(neighbour.id)
      }
    }
  }
  return { candidates: candidates.map(moduleDto), affected }
}

const dependencies = []

/** The same analysis on the shipped document, recorded by edit rather than by copying
 * all 4,299 module rows into the fixture twice. */
const zooDependencies = []
function addZooDependency(id, note, edit) {
  const afterModules = zooModules.filter((m) => !edit.removed.includes(m.id))
  const analysis = retainedAnalysis(zooModules, afterModules)
  const entry = { id, note, removed: edit.removed, affected: analysis.affected }
  if (edit.candidates) entry.preview = previewAnalysis(zooModules, edit.candidates)
  zooDependencies.push(entry)
  return entry
}

addZooDependency('zoo-delete-gate-245',
  'Deleting the doorless gate at the image-1 corner rebuilds the fence it carried and the neighbouring gate.',
  { removed: ['gate-245'] })

addZooDependency('zoo-delete-fence-80',
  'Deleting the run cell south of fence-81 rebuilds the corner fence and the next cell of the run.',
  { removed: ['fence-80'] })

addZooDependency('zoo-preview-new-corner-cell',
  'A dragged fence east of fence-81 rebuilds only the candidate and the committed corner fence during the preview.',
  { removed: [], candidates: [fence('candidate-east', 76, 18, -15)] })

function addDependency(id, note, beforeRaw, afterRaw, options = {}) {
  const analysis = retainedAnalysis(beforeRaw, afterRaw)
  const entry = {
    id, note, mode: 'commit',
    before: modulesDto(analysis.before), after: modulesDto(analysis.after),
    affected: analysis.affected,
  }
  if (options.previewCandidates) {
    const preview = previewAnalysis(analysis.before, options.previewCandidates)
    entry.preview = preview
  }
  dependencies.push(entry)
  return entry
}

// Place a fence against the end of a two-cell run: the new fence and the committed end.
addDependency('place-extends-run',
  'Placing a fence beside a committed run rebuilds the new tile and the committed end whose cap goes away.',
  [depFence('run-a', 0, 0), depFence('run-b', 1, 0)],
  [depFence('run-a', 0, 0), depFence('run-b', 1, 0), depFence('run-c', 2, 0)],
  { previewCandidates: [depFence('run-c', 2, 0)] })

// Place a fence beside a doorless gate: the gate's fence half changes at commit, but a
// drag preview does not rebuild it (GhostSystem only rebuilds adjacent fences).
addDependency('place-beside-doorless-gate',
  'A committed fence beside a doorless gate rebuilds the gate’s carried fence panel; the drag preview only rebuilds adjacent committed fences.',
  [gate('doorless-gate', 5, 0, 0, 0, 'fence'), depFence('gate-run', 4, 0)],
  [gate('doorless-gate', 5, 0, 0, 0, 'fence'), depFence('gate-run', 4, 0), depFence('gate-new', 6, 0)],
  { previewCandidates: [depFence('gate-new', 6, 0)] })

// Delete a tile from a tactile run: both surviving neighbours change.
addDependency('delete-tactile',
  'Deleting a warning square drops the arm its two neighbours grew toward it.',
  [tactile('del-0', 0, 0), tactile('del-1', 1, 0), tactile('del-2', 2, 0)],
  [tactile('del-0', 0, 0), tactile('del-2', 2, 0)])

// Remove a wide stair: a fence beside the *far* lane of its landing band is three cells
// from the stair record, so only the fence-connection mask rule can find it.
addDependency('wide-stair-landing',
  'Removing a wide stair changes the join of a fence beside its far landing cell, which is not adjacent to the stair record.',
  [wideStair, depFence('far-lane-fence', 13, 0), depFence('remote-fence', 20, 0)],
  [depFence('far-lane-fence', 13, 0), depFence('remote-fence', 20, 0)])

// Noise barriers keep their own model during a drag even though the index counts them.
addDependency('preview-noise-barrier',
  'A drag next to a ground noise barrier draws the candidate and any adjacent ordinary fence, but not the barrier (it has no arm geometry).',
  [depFence('ordinary-end', 0, 0), fence('barrier', 2, 0, 0, 0, { variant: 'sound-barrier' })],
  [depFence('ordinary-end', 0, 0), fence('barrier', 2, 0, 0, 0, { variant: 'sound-barrier' })],
  { previewCandidates: [depFence('drag-cell', 1, 0)] })

/* ----------------------------------------------------------------------- gaps */

const gaps = [
  {
    kind: 'gap', id: 'lift-landing', fixture: 'fence-rail-landings', members: ['lift-1', 'no-land-lift'],
    rule: 'fenceConnectionIndex indexes a stair, escalator or walkway landing, never a lift.',
    expect: 'the fence beside a lift keeps sides.w = false and caps its end',
  },
  {
    kind: 'gap', id: 'block-stair-landing', fixture: 'fence-rail-landings', members: ['stair-block-1', 'no-land-block'],
    rule: 'a 楼梯块 (cfg.block) has no run of its own and is skipped by the stair branch.',
    expect: 'the fence beside a block stair keeps sides.w = false',
  },
  {
    kind: 'gap', id: 'guide-never-arms', fixture: 'tactile-strip', members: ['guide-crossing'],
    rule: 'TactileModel.build never calls tactileArms for a guide; its ribs already run the length of the band.',
    expect: 'applies = false, no arms',
  },
  {
    kind: 'gap', id: 'strip-beside-warning-square', fixture: 'tactile-strip', members: ['strip-square', 'square-beside'],
    rule: 'a warning strip skips a junction square: its own one-metre top already covers the shared edge.',
    expect: 'strip-square keeps no north arm even though a warning square touches it',
  },
  {
    kind: 'gap', id: 'preview-skips-noise-barrier', fixture: null, members: ['barrier'],
    rule: 'GhostSystem.setFencePreview rebuilds only adjacent committed fences that are not ground noise barriers.',
    expect: 'preview.affected excludes the sound-barrier id',
  },
]

/* ------------------------------------------------------------------ residuals */

const residualNotes = [
  {
    kind: 'residual', id: 'one-axis-prefab-core',
    source: 'FenceModel.drawFence composes every cell from fenceArms: a straight run has no end posts and a run end has one.',
    unity: 'OutdoorModuleViews composes only a two-axis junction. A one-axis cell still draws the promoted isolated one-metre panel, which carries two end posts; the port therefore adds 168 glass triangles (2 × 84) to a straight run and 84 to a run end.',
    measuredBy: 'fixtures fence-straight / fence-corner / fence-tee and zoo.fences[].sourceGeometry',
  },
  {
    kind: 'residual', id: 'tactile-arm-dot-grid',
    source: 'TactileModel’s junction dot loop adds the wing grid by floating-point accumulation, so the +x half gets a 0.2 column the −x half does not (15–20 extra dots per arm).',
    unity: 'TactileArmMesh emits the intended 3 × 4 grid (0.28/0.36/0.44 across ±0.12/±0.04) per arm; the arm slab, the connectivity shape, is exact.',
    measuredBy: 'fixtures tactile-corner / tactile-rotations',
  },
  {
    kind: 'residual', id: 'non-glass-fence-composition',
    source: 'drawFence has glass, iron and gate variants that all read fenceArms.',
    unity: 'only the glass panel is composed (`fence-arms-uncomposed:variant:<v>`); an iron, gate, steel-blue or noise-barrier junction keeps the promoted panel.',
    measuredBy: 'zoo fence variants (no iron junction in Zoo; fixture fence-rotations is glass)',
  },
]

/* ---------------------------------------------------------------------- output */

const body = {
  schemaVersion: 1,
  generatedBy: 'tools/unity-parity/record-station-connections.mjs',
  command: 'node tools/unity-parity/record-station-connections.mjs',
  contract: {
    axes: 'document (x,y,z) -> Unity world (x,z,y); z is elevation',
    fenceArms: 'cell-centre metres: ±0.5 is a cell edge; the arms are baked from neighbours, never from the saved turn',
    tactileArms: 'the signed one-cell step in the tile’s own frame, after rotateLocal(-rot, dx, dy)',
    endpoints: 'document metres at the storey floor top (z + 1)',
  },
  provenance: {
    gitHead: gitHead(),
    sources: Object.fromEntries([
      'game/src/sim/fences.ts',
      'game/src/sim/floorDecor.ts',
      'game/src/sim/stairs.ts',
      'game/src/sim/escalators.ts',
      'game/src/sim/gates.ts',
      'game/src/render/moduleDependencies.ts',
      'game/src/render/models/pieces/FenceModel.ts',
      'game/src/render/models/pieces/TactileModel.ts',
      'game/src/render/models/pieces/OutdoorSurfaceModel.ts',
      'game/src/render/scene/systems/GhostSystem.ts',
    ].map((path) => [path, fileSha(path)])),
  },
  zoo,
  fixtures,
  deletion: { fence: straightDeletion, tactile: tactileDeletion },
  dependencies,
  zooDependencies,
  gaps,
  residuals: residualNotes,
  surface: {
    rule: 'sidewalk/lawn are repeated immutable one-metre tiles (OutdoorSurfaceModel.outdoorSurfaceGeometry); no neighbour shape rule exists and the 0.008 m sidewalk paver seam is artwork, not connectivity.',
    fixture: 'surface-sidewalk-seams',
  },
}

const canonical = JSON.stringify(body)
const contentSha256 = sha256(canonical)
const fixture = { ...body, provenance: { ...body.provenance, fixtureSha256: contentSha256 } }
const text = JSON.stringify(fixture, null, 2) + '\n'

mkdirSync(dirname(resolve(ROOT, outPath)), { recursive: true })
writeFileSync(resolve(ROOT, outPath), text)
console.log(JSON.stringify({
  ok: true,
  out: relative(ROOT, resolve(ROOT, outPath)),
  bytes: Buffer.byteLength(text),
  fixtureSha256: contentSha256,
  zoo: {
    sha256: zoo.sha256,
    modules: zoo.modules,
    fences: zoo.counts.fences,
    tactiles: zoo.counts.tactiles,
    tactileArms: zoo.counts.tactileArms,
    corner: CORNER_IDS,
  },
  fixtures: fixtures.map((entry) => ({ id: entry.id, modules: entry.modules.length, fences: entry.fences.length, tactiles: entry.tactiles.length })),
  dependencies: dependencies.map((entry) => ({ id: entry.id, affected: entry.affected })),
  gaps: gaps.map((gap) => gap.id),
}))
