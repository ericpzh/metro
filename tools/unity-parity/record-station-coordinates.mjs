// Packet A3 oracle — document-axis footprints and mounts from the TypeScript game.
//
// Reads the exported `unity/Assets/StationDesigner/Demos/*.metro.json`
// envelopes (the same bytes the Unity reader opens), runs the real TypeScript
// load path (`parse` → `toStateRepairing` → the save's repaired module list) and
// records, for each sampled module, the source's own footprint, mount, wall
// side/courses and collision envelope. It also records the coordinate-contract
// cases (point/level/ray) the C# tests compare against.
//
// `moduleFootprint`, `moduleEnvelope`, `isWallMounted`, `isCeilingHung`,
// `wallSide`, `wallMountCourses` and `exitFootprintCells` are imported from the
// shipping game, never re-implemented here: the fixture is the source's answer,
// not a second port of it.
//
// Output goes under Tests/EditMode (a test fixture), never beside the gameplay
// documents. Run: node tools/unity-parity/record-station-coordinates.mjs

import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from '../../game/src/persistence/save.ts'
import {
  moduleFootprint,
  moduleEnvelope,
  isWallMounted,
  isCeilingHung,
  wallSide,
  wallMountCourses,
} from '../../game/src/sim/placement.ts'
import { exitFootprintCells } from '../../game/src/sim/exits.ts'
import { escalatorLandings } from '../../game/src/sim/escalators.ts'
import { levelSteps, storeyBand, normalizeLevelBase, STOREY_HEIGHT } from '../../game/src/sim/constants.ts'
import { rotateLocal } from '../../game/src/sim/track.ts'
import { nearestLevel } from '../../game/src/build/model/Cells.ts'
import { readFileSync } from 'node:fs'

const ROOT = new URL('../../', import.meta.url)
const OUT = new URL('../../unity/Assets/StationDesigner/Tests/EditMode/station-coordinates-oracle.json', import.meta.url)

const DEMOS = [
  { id: 'zoo', file: 'zoo.metro.json', every: 1 },
  { id: 'tanwei', file: 'tanwei.metro.json', every: 17 },
  { id: 'tianhe', file: 'tianhe.metro.json', every: 101 },
]

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')
const round = (n) => Math.round(n * 1e6) / 1e6
const box = (b) => (b ? [round(b.x0), round(b.y0), round(b.z0), round(b.x1), round(b.y1), round(b.z1)] : null)

function mountOf(m) {
  if (m.type === 'track' || m.type === 'platform-edge' || m.type === 'psd-end') return 'track'
  if (m.type === 'stair' || m.type === 'escalator' || m.type === 'walkway' || m.type === 'lift') return 'run'
  if (isCeilingHung(m)) return 'ceiling'
  if (isWallMounted(m)) return 'wall'
  return 'floor'
}

function moduleRow(m) {
  // `moduleFootprint` returns plan pairs for most pieces; run endpoints and escalator
  // landings carry their own elevation, which the C# contract keeps. A stair's two
  // endpoints are therefore recorded with their own z (the source helper drops it,
  // the document does not).
  const footprint = m.type === 'stair' && !m.cfg.block && m.from && m.to
    ? [[m.from.x, m.from.y, m.from.z], [m.to.x, m.to.y, m.to.z]]
    : m.type === 'escalator' || m.type === 'walkway'
      ? escalatorLandings(m).map((p) => [p.x, p.y, p.z])
      : moduleFootprint(m).map(([x, y, z]) => [x, y, z === undefined ? m.z : z])
  // An exit's **floor plate** is a separate helper (`exitFootprintCells`); both are
  // recorded and compared by their own C# API (`Footprint` / `ExitFootprint`).
  const exitFootprint = m.type === 'exit' ? exitFootprintCells(m) : null
  const [wx, wy] = wallSide(m.rot)
  return {
    id: m.id,
    type: m.type,
    x: m.x, y: m.y, z: m.z, rot: m.rot ?? 0,
    w: m.w ?? 1, d: m.d ?? 1, h: m.h ?? 1,
    mount: mountOf(m),
    wallSide: [wx, wy],
    wallCourses: wallMountCourses(m),
    footprint,
    ...(exitFootprint ? { exitFootprint } : {}),
    clearance: box(moduleEnvelope(m)),
  }
}

const documents = []
for (const demo of DEMOS) {
  const path = new URL('../../unity/Assets/StationDesigner/Demos/' + demo.file, import.meta.url)
  const text = readFileSync(path, 'utf8')
  const loaded = parse(text)
  if (!loaded.ok) throw new Error(demo.file + ' does not parse: ' + loaded.error)
  const state = loaded.state
  const modules = state.modules
  const rows = []
  for (let i = 0; i < modules.length; i += demo.every) rows.push(moduleRow(modules[i]))
  // Every exit is a geometry anchor the families need, whatever the sample says.
  if (demo.every > 1) {
    for (const m of modules) if (m.type === 'exit' && !rows.some((row) => row.id === m.id)) rows.push(moduleRow(m))
  }
  documents.push({
    id: demo.id,
    file: demo.file,
    sha256: sha256(text),
    cells: state.cells.length,
    modules: modules.length,
    lines: state.lines.length,
    levelBase: state.levelBase,
    storeyHeight: state.storeyHeight,
    sampled: rows.length,
    rows,
  })
}

// Coordinate-contract cases: exact points (no cell/floor offsets), cell centre,
// floor top, the four quarter turns, the level grid and street-plane rays.
const points = []
for (const [x, y, z] of [[0, 0, 0], [1, 2, 3], [-7, 4, -15], [-1, -1, -0.5], [120, -33, 11], [5, 6, -20]]) {
  points.push({ x, y, z, world: [x, z, y] })
}
const cells = []
for (const [x, y, z] of [[0, 0, 0], [-3, 2, -15], [11, -4, 5]]) {
  cells.push({ x, y, z, centre: [x + 0.5, z + 0.5, y + 0.5], floorTop: [x + 0.5, z + 1, y + 0.5] })
}
const turns = []
for (let rot = -2; rot <= 6; rot++) {
  const norm = ((rot % 4) + 4) % 4
  const [dx, dy] = rotateLocal(rot, 1, 0)
  const [sx, sy] = rotateLocal(rot, 0, -1)
  turns.push({ rot, norm, yaw: -90 * norm, forward: [dx, dy], wallStep: [sx, sy] })
}
const levels = []
for (let base = 0; base <= 4; base++) {
  const steps = levelSteps(base)
  const nearest = []
  for (const z of [-21, -15, -12.5, -10, -5.4, -1, 0, 2.5, 4.9, 5, 11, 30]) nearest.push({ z, level: nearestLevel(z, base) })
  const bands = []
  for (const z of [-45, -20.4, -20, -15.5, -0.2, 0, 4.9, 30, 40]) bands.push({ z, band: storeyBand(z, base) })
  levels.push({ base, steps, nearest, bands })
}
const rays = []
for (const [ox, oy, oz, dx, dy, dz] of [
  [0, 10, 0, 0, -1, 0],
  [3.5, 8, -2.25, 0.2, -0.8, 0.1],
  [-4, 2, 6, 0, 1, 0],
  [1, 0, 1, 1, 0, 0],
]) {
  // The C# helper intersects Unity world y = 0 and reports the document point.
  const t = -oy / dy
  const hit = dy === 0 || t < 0 ? null : [ox + dx * t, oz + dz * t, 0]
  rays.push({ origin: [ox, oy, oz], direction: [dx, dy, dz], document: hit })
}

const fixture = {
  schemaVersion: 1,
  generatedBy: 'tools/unity-parity/record-station-coordinates.mjs',
  contract: {
    axes: 'document (x,y,z) -> world (x,z,y)',
    yawPerTurn: -90,
    storeyHeight: STOREY_HEIGHT,
    levelBaseRange: [0, 4],
  },
  documents,
  coordinates: { points, cells, turns, levels, rays },
  normalizeLevelBase: [0, 1, 3, 4, 5, -2, 2.6, 3.4].map((value) => ({
    value,
    normalized: normalizeLevelBase(value),
  })),
}

mkdirSync(new URL('../../unity/Assets/StationDesigner/Tests/EditMode/', import.meta.url), { recursive: true })
writeFileSync(OUT, JSON.stringify(fixture) + '\n')
console.log(JSON.stringify({
  ok: true,
  out: 'unity/Assets/StationDesigner/Tests/EditMode/station-coordinates-oracle.json',
  documents: documents.map((d) => ({ id: d.id, modules: d.modules, sampled: d.sampled, cells: d.cells })),
}))
