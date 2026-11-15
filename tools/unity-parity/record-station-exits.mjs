// Plan 16 §5 oracle — exit well openings and edit snapping from the TypeScript game.
//
// Reads the exported `unity/Assets/StationDesigner/Demos/zoo.metro.json` envelope
// (the same bytes the Unity reader opens), runs the real TypeScript load path, and
// records exactly what the shipping game computes:
//
//   * `buildExit` geometry from the real `ExitModel` — the concrete pad rectangles
//     (`exit-concrete-base` meshes) and the `exitRunOpenings` / `exitLandingBack`
//     description they are cut from, for the two loaded Zoo head-houses;
//   * the floor contributors under each head-house plate: the saved solid cells,
//     the paved families and whether the real `outdoorSurfaceHidden` leaves each
//     one drawn (and why);
//   * `snapExitToRamp` and `exitRunSnap` rows, called on the real functions for
//     straight/blocked/turning stairs, escalators, lifts, level runs, doorway and
//     virtual exits, all four rotations and a spread of pointer cells.
//
// Nothing here re-implements a rule: every value is the source's answer. Output
// goes under Tests/EditMode (a test fixture), never beside the gameplay documents.
//
// Usage: node tools/unity-parity/record-station-exits.mjs [--out <path>]
//
// Deterministic: the demo envelope is fixed, every source helper is pure, and every
// length is rounded to 1e-6 m before it is written.

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as THREE from '../../game/node_modules/three/build/three.module.js'
import { parse } from '../../game/src/persistence/save.ts'
import { toState } from '../../game/src/build/model.ts'
import { emptyStation } from '../../game/src/data/reference-station.ts'
import { createModule } from '../../game/src/build/model/Equipment.ts'
import {
  EXIT_BACK,
  exitBays,
  exitCoversCell,
  exitFloorBounds,
  exitLandingBack,
  exitRunHalf,
  exitRunOpenings,
  exitRunSnap,
  exitSpan,
  isExitHeadHouse,
  snapExitToRamp,
} from '../../game/src/sim/exits.ts'
import { outdoorSurfaceHidden } from '../../game/src/sim/placement.ts'
import { ExitModel } from '../../game/src/render/models/pieces/ExitModel.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ZOO_FILE = 'unity/Assets/StationDesigner/Demos/zoo.metro.json'
const DEFAULT_OUT = 'unity/Assets/StationDesigner/Tests/EditMode/station-exits-oracle.json'

// The exit builder paints its header through a 2D canvas. This recorder only
// needs the pad rectangles, and no texture is ever uploaded, so a no-op canvas
// keeps the real builder running outside a browser.
const noopContext = new Proxy({}, {
  get(target, key) {
    if (key in target) return target[key]
    if (key === 'measureText') return () => ({ width: 10 })
    if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} })
    if (key === 'createPattern') return () => null
    if (key === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w) * Math.max(1, h) * 4), width: w, height: h })
    return () => undefined
  },
  set(target, key, value) { target[key] = value; return true },
})
globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') return {}
    return { width: 1, height: 1, getContext: () => noopContext }
  },
}

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1])
const outPath = resolve(ROOT, args.get('--out') ?? DEFAULT_OUT)

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

// The exit builder only needs material *slots*; values never reach the recorded
// rectangles. One shared kit, the same shape the other recorders use.
const materials = {
  steel: new THREE.MeshStandardMaterial(),
  darkSteel: new THREE.MeshStandardMaterial(),
  glass: new THREE.MeshStandardMaterial(),
  white: new THREE.MeshStandardMaterial(),
  concrete: new THREE.MeshStandardMaterial({ name: 'exitConcrete' }),
}

function exitContext(data) {
  return {
    mats: materials,
    data,
    finish: () => materials.concrete,
    ads: {},
    trackCells: new Set(),
    tvPlate: () => new THREE.Texture(),
  }
}

/** Every concrete pad rectangle the real `buildExit` lays, in module-local metres. */
function exitPads(module, data) {
  const group = new ExitModel(exitContext(data)).build(module)
  const pads = []
  group.traverse((object) => {
    if (!object.isMesh || object.name !== 'exit-concrete-base') return
    const p = object.geometry.parameters ?? {}
    pads.push({
      x: round(object.position.x),
      y: round(object.position.y),
      width: round(p.width),
      length: round(p.height),
      height: round(p.depth),
    })
  })
  // The source draws them in build order; the fixture compares the set, so keep a
  // deterministic order that does not depend on mesh traversal.
  pads.sort((a, b) => a.x - b.x || a.y - b.y || a.width - b.width || a.length - b.length)
  return pads
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

/** A fixture module as the save stores it; `toState` normalises it before use. */
function mod(id, type, x, y, z = 0, rot = 0, cfg = {}, extra = {}) {
  return { id, type, x, y, z, rot, w: 1, d: 1, h: 1, cfg, ...extra }
}

/** Normalise one fixture's module list exactly as the game opens a saved station. */
function normalize(modules) {
  return toState({ ...emptyStation(), modules }).modules
}

function fresh(type, x, y, z, rot = 0, id = 'fresh-exit') {
  const module = createModule(type, x, y, z, id, rot)
  if (!module) throw new Error('createModule returned null for ' + type)
  return module
}

/* ------------------------------------------------------------------- zoo exits */

const zooText = readFileSync(resolve(ROOT, ZOO_FILE), 'utf8')
const zooLoaded = parse(zooText)
if (!zooLoaded.ok) throw new Error(ZOO_FILE + ' does not parse: ' + zooLoaded.error)
const zoo = zooLoaded.state

const ZOO_EXIT_IDS = ['exit-uncovered-2-258', 'exit-uncovered-2-398']

function exitRecord(id) {
  const exit = zoo.modules.find((m) => m.id === id)
  if (!exit || exit.type !== 'exit') throw new Error('missing exit ' + id)
  const runs = exitRunOpenings(zoo.modules, exit)
  const yHi = Math.ceil(EXIT_BACK + 0.5) - 0.5
  const landingBack = exitLandingBack(runs, yHi - 0.3)
  const bounds = exitFloorBounds(exit)
  const cells = []
  for (let x = Math.floor(bounds.x0); x < bounds.x1; x++) {
    for (let y = Math.floor(bounds.y0); y < bounds.y1; y++) {
      const solid = zoo.cells.some((c) => c.x === x && c.y === y && c.z === exit.z && c.fill === 'solid')
      if (solid) cells.push([x, y, exit.z])
    }
  }
  const tiles = zoo.modules
    .filter((m) => (m.type === 'sidewalk' || m.type === 'lawn') &&
      exitCoversCell(exit, m.x, m.y, m.z))
    .map((m) => ({
      id: m.id, type: m.type, cell: [m.x, m.y, m.z],
      hidden: outdoorSurfaceHidden(zoo.cells, zoo.modules, m),
    }))
  const runModules = zoo.modules
    .filter((m) => m.type === 'stair' || m.type === 'escalator' || m.type === 'walkway')
    .filter((m) => exitRunOpenings([m], exit).length > 0)
    .map((m) => ({
      id: m.id,
      type: m.type,
      module: moduleDto(m),
      // The source's own `runTop` answer, read through the only exported caller.
      openings: exitRunOpenings([m], exit).map((r) => ({ column: round(r.column), row: round(r.row), half: round(r.half) })),
      half: round(exitRunHalf(m)),
    }))
  return {
    id: exit.id,
    name: exit.cfg.name,
    cell: [exit.x, exit.y, exit.z],
    rot: exit.rot ?? 0,
    bays: exitBays(exit),
    headHouse: isExitHeadHouse(exit),
    span: { centre: exitSpan(exit).centre, half: exitSpan(exit).half },
    floorBounds: { x0: round(bounds.x0), y0: round(bounds.y0), x1: round(bounds.x1), y1: round(bounds.y1) },
    runs: runs.map((r) => ({ column: round(r.column), row: round(r.row), half: round(r.half) })),
    landingBack: round(landingBack),
    yHi: round(yHi),
    pads: exitPads(exit, zoo),
    groundCells: cells,
    surfaceTiles: tiles,
    runModules,
  }
}

const zooExits = ZOO_EXIT_IDS.map(exitRecord)

/* -------------------------------------------------------------- snap fixtures */

const snapExitToRampRows = []
function snapRow(id, exitType, exitX, exitY, exitRot, rampModule, note = '') {
  const ramp = normalize([rampModule])[0]
  const exit = fresh(exitType, exitX, exitY, 0, exitRot)
  const snapped = snapExitToRamp(exit, ramp)
  const row = {
    id,
    exit: { type: exitType, x: exitX, y: exitY, z: 0, rot: exitRot, bays: exitBays(exit) },
    ramp: moduleDto(ramp),
    result: snapped ? { x: snapped.x, y: snapped.y, z: snapped.z, rot: snapped.rot } : null,
  }
  if (note) row.note = note
  if (snapped) {
    // What the opening description says after the snap: one run in the bay.
    row.openings = exitRunOpenings([...normalize([rampModule]), snapped], snapped)
      .map((r) => ({ column: round(r.column), row: round(r.row), half: round(r.half) }))
  }
  snapExitToRampRows.push(row)
}

// A straight stair arriving at the bay from the south (base → top toward +y): the
// ramp's upper landing is the exit's own street level, its base one storey below.
snapRow('straight-stair-south', 'exit-uncovered-2', 10, 10, 0,
  mod('ramp-straight-south', 'stair', 10, 2, -5, 0, { style: 'straight', width: 2 * 0.68 },
    { from: { x: 10, y: 2, z: -5 }, to: { x: 10, y: 10, z: 0 } }))
// The escalator the Zoo exits hold, all four arrival directions.
for (const rot of [0, 1, 2, 3]) {
  const facing = [[0, 1], [1, 0], [0, -1], [-1, 0]][rot]
  const baseX = 10 - facing[0] * 9
  const baseY = 10 - facing[1] * 9
  snapRow('escalator-arrive-rot' + rot, 'exit-uncovered-2', 10, 10, 0,
    mod('ramp-escalator-' + rot, 'escalator', baseX, baseY, -5, rot,
      { incline: 30, dir: 'up' }, { from: { x: baseX, y: baseY, z: -5 }, to: { x: 10, y: 10, z: 0 } }))
}
// A two-bay stair group arriving sideways: both lanes occupy the bay group.
snapRow('two-lane-stair', 'exit-covered-3', 10, 10, 0,
  mod('ramp-two-lane', 'stair', 9, 2, -5, 0, { style: 'straight', width: 2 * 0.68 },
    { from: { x: 9, y: 2, z: -5 }, to: { x: 9, y: 10, z: 0 } }))
// A three-lane stair: its tread band is centred one block across, so the source's
// `runTop` shifts the upper landing sideways before the bay is chosen.
snapRow('three-lane-stair', 'exit-uncovered-2', 10, 10, 0,
  mod('ramp-three-lane', 'stair', 10, 2, -5, 0, { style: 'straight', width: 3 * 0.68 },
    { from: { x: 10, y: 2, z: -5 }, to: { x: 10, y: 10, z: 0 } }))
// Refusals: a block stair, a turning stair, a lift, a level run, a doorway/virtual exit.
snapRow('block-stair-refused', 'exit-uncovered-2', 10, 10, 0,
  mod('ramp-block', 'stair', 10, 9, 0, 0, { block: true, width: 1, blockHeight: 1 },
    { from: { x: 10, y: 9, z: 0 }, to: { x: 10, y: 9, z: 1 } }))
snapRow('turning-stair-refused', 'exit-uncovered-2', 10, 10, 0,
  mod('ramp-turn', 'stair', 10, 2, -5, 0, { style: 'right90', width: 0.68 },
    { from: { x: 10, y: 2, z: -5 }, to: { x: 12, y: 10, z: 0 } }))
snapRow('lift-refused', 'exit-uncovered-2', 10, 10, 0,
  mod('ramp-lift', 'lift', 10, 10, 0, 0, { size: 2 },
    { from: { x: 10, y: 10, z: 0 }, to: { x: 10, y: 10, z: 5 } }))
snapRow('level-ramp-refused', 'exit-uncovered-2', 10, 10, 0,
  mod('ramp-level', 'stair', 10, 2, 0, 0, { style: 'straight', width: 0.68 },
    { from: { x: 10, y: 2, z: 0 }, to: { x: 10, y: 10, z: 0 } }))
snapRow('doorway-exit-refused', 'exit-doorway-2', 10, 10, 0,
  mod('ramp-straight-doorway', 'stair', 10, 2, -5, 0, { style: 'straight', width: 0.68 },
    { from: { x: 10, y: 2, z: -5 }, to: { x: 10, y: 10, z: 0 } }))
snapRow('virtual-exit-refused', 'exit-virtual', 10, 10, 0,
  mod('ramp-straight-virtual', 'stair', 10, 2, -5, 0, { style: 'straight', width: 0.68 },
    { from: { x: 10, y: 2, z: -5 }, to: { x: 10, y: 10, z: 0 } }))

const exitRunSnapRows = []
function runSnapStation() {
  return normalize([
    mod('exit-a', 'exit', 10, 10, 0, 0, { name: 'A', inRate: 900, open: true, covered: false, bays: 2 }),
    mod('exit-b', 'exit', 40, 40, 0, 2, { name: 'B', inRate: 900, open: true, covered: true, bays: 3 }),
    mod('exit-doorway', 'exit', 60, 60, 0, 0, { name: 'C', inRate: 900, open: true, covered: true, bays: 2, style: 'doorway' }),
    // Runs already linked to A: the two bay columns at row 0.
    mod('run-a0', 'escalator', 10, 10, 5, 2, { incline: 30, dir: 'up' },
      { from: { x: 10, y: 10, z: 5 }, to: { x: 10, y: 19, z: 0 } }),
    mod('run-a1', 'escalator', 11, 10, 5, 2, { incline: 30, dir: 'up' },
      { from: { x: 11, y: 10, z: 5 }, to: { x: 11, y: 19, z: 0 } }),
  ])
}
const runSnapModules = runSnapStation()
for (const [id, x, y, z, run, rise] of [
  ['a-bay0-default', 10, 10, 0, undefined, undefined],
  ['a-bay1-default', 11, 11, 0, undefined, undefined],
  ['a-edge-low', 9, 10, 0, undefined, undefined],
  ['a-edge-high', 12, 10, 0, undefined, undefined],
  ['a-row-one', 10, 11, 0, undefined, undefined],
  ['a-outside-x', 8, 10, 0, undefined, undefined],
  ['a-outside-y', 10, 15, 0, undefined, undefined],
  ['a-wrong-level', 10, 10, 5, undefined, undefined],
  ['b-rot2-bay0', 40, 40, 0, undefined, undefined],
  ['b-rot2-bay2', 38, 40, 0, undefined, undefined],
  ['a-short-rise', 10, 10, 0, 5, 3],
  ['a-escalator-spec', 10, 10, 0, 9, 5],
  ['doorway-none', 60, 60, 0, undefined, undefined],
]) {
  const snap = exitRunSnap(runSnapModules, x, y, z, run, rise)
  exitRunSnapRows.push({
    id,
    pointer: [x, y, z],
    run: run ?? null,
    rise: rise ?? null,
    result: snap ? {
      exitId: snap.exit.id, bay: snap.bay,
      top: point3(snap.top), base: point3(snap.base), rot: snap.rot,
    } : null,
  })
}

/* -------------------------------------------------------------------- write it */

const oracle = {
  schemaVersion: 1,
  source: {
    head: gitHead(),
    files: {
      'game/src/sim/exits.ts': fileSha('game/src/sim/exits.ts'),
      'game/src/sim/stairs.ts': fileSha('game/src/sim/stairs.ts'),
      'game/src/render/models/pieces/ExitModel.ts': fileSha('game/src/render/models/pieces/ExitModel.ts'),
      'unity/Assets/StationDesigner/Demos/zoo.metro.json': fileSha(ZOO_FILE),
    },
    zooTextSha256: sha256(zooText),
  },
  zooExits,
  snapExitToRamp: snapExitToRampRows,
  exitRunSnap: exitRunSnapRows,
}

writeFileSync(outPath, JSON.stringify(oracle, null, 2) + '\n', 'utf8')
console.log('wrote ' + outPath)
console.log('  zoo exits: ' + zooExits.map((e) => e.id + ' ' + e.runs.length + ' run(s) ' + e.pads.length + ' pad(s)').join(', '))
console.log('  snapExitToRamp rows: ' + snapExitToRampRows.length + ', exitRunSnap rows: ' + exitRunSnapRows.length)
