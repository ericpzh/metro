// Plan 16 §1 oracle — one pointer event's candidate, as the TypeScript game resolves
// it. The fixture is the source's own answer, never a second port: each row records
// `pickCells` → `moduleAim` → `createModule` → `equipmentReason` for a fresh piece and
// `moveCandidate`/`equipmentReason` for a carried one, against the same exported Zoo
// save the Unity reader opens.
//
// Output: unity/Assets/StationDesigner/Tests/EditMode/station-edit-oracle.json.
// Run: node tools/unity-parity/record-station-edit-trace.mjs

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { parse } from '../../game/src/persistence/save.ts'
import { createModule } from '../../game/src/build/model.ts'
import { moduleAim } from '../../game/src/app/tools/moduleAim.ts'
import { paletteIdForModule } from '../../game/src/app/tools/PickTool.ts'
import { pickCells } from '../../game/src/render/pickCell.ts'
import {
  equipmentReason,
  moduleFloorOk,
  moveCandidate,
  placementColliders,
  placementOnTrack,
} from '../../game/src/sim/placement.ts'

const ROOT = new URL('../../', import.meta.url)
const SAVE = new URL('../../unity/Assets/StationDesigner/Demos/zoo.metro.json', import.meta.url)
const OUT = new URL('../../unity/Assets/StationDesigner/Tests/EditMode/station-edit-oracle.json', import.meta.url)

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')
const saveText = readFileSync(SAVE, 'utf8')
const parsed = parse(saveText)
if (!parsed.ok) throw new Error('zoo save did not parse: ' + JSON.stringify(parsed))
const station = parsed.state

const round = (value) => Math.round(value * 1e6) / 1e6

/** A top-face hit on one solid block, through the source's own cell picker. */
function topHit(cell) {
  const point = [cell[0] + 0.5, cell[1] + 0.5, cell[2] + 1]
  const cells = pickCells(point, [0, 0, 1])
  return {
    cell: cells.cell,
    place: cells.place,
    normal: cells.normal,
    point,
    solid: true,
  }
}

/** Every candidate anchor cell at one elevation, in document order. */
function floorCells(z) {
  const seen = new Set()
  const out = []
  for (const cell of station.cells) {
    if (cell.fill !== 'solid' || cell.z !== z) continue
    const key = `${cell.x},${cell.y}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push([cell.x, cell.y, cell.z])
  }
  return out
}

/** One hit row: what the source's candidate would be for this palette id at this cell. */
function freshCase(paletteId, cell, rotation, width) {
  const hit = topHit(cell)
  const at = moduleAim(station, paletteId, hit)
  const mod = createModule(paletteId, at[0], at[1], at[2], 'oracle-' + paletteId, rotation, width ?? 1, 'up', 'lane', station)
  if (!mod) return { paletteId, cell, rotation, unsupported: true }
  const reason = equipmentReason(station.cells, station.modules, mod, true)
  return {
    paletteId,
    rotation,
    cell,
    hit: { cell: hit.cell, place: hit.place, solid: true, point: hit.point.map(round) },
    aim: at,
    candidate: {
      type: mod.type,
      x: mod.x,
      y: mod.y,
      z: mod.z,
      rot: mod.rot ?? 0,
      w: mod.w ?? 1,
      d: mod.d ?? 1,
      cfg: mod.cfg ?? {},
    },
    floorOk: moduleFloorOk(station.cells, station.modules, mod),
    onTrack: placementOnTrack(station.cells, mod, station.modules),
    reason,
    colliders: placementColliders(station.modules, mod).map((m) => m.id),
  }
}

/** The first allowed and the first refused placement for one palette id at a level. */
function findCases(paletteId, z, rotation, width) {
  let accepted = null
  let refused = null
  const cells = floorCells(z)
  const stride = Math.max(1, Math.floor(cells.length / 400))
  for (let i = 0; i < cells.length; i += stride) {
    const row = freshCase(paletteId, cells[i], rotation, width)
    if (row.unsupported) continue
    if (row.reason === '' && accepted === null) accepted = row
    if (row.reason !== '' && refused === null) refused = row
    if (accepted && refused) break
  }
  return { accepted, refused }
}

// The levels the palette rows live on in Zoo: the concourse/platform storeys.
const levels = [...new Set(station.modules.map((m) => m.z))].sort((a, b) => a - b)
const paletteRows = [
  { id: 'bench-steel-1', width: 1, rotation: 0 },
  { id: 'bench-wood-2', width: 2, rotation: 1 },
  { id: 'fence', width: 1, rotation: 0 },
  { id: 'fence-steel-blue', width: 1, rotation: 2 },
  { id: 'tactile-warning', width: 1, rotation: 0 },
  { id: 'floor-mark-boarding', width: 1, rotation: 0 },
  { id: 'tvm', width: 1, rotation: 0 },
]

const placements = []
for (const row of paletteRows) {
  for (const z of levels) {
    const found = findCases(row.id, z, row.rotation, row.width)
    if (found.accepted) {
      placements.push({ ...found.accepted, level: z })
      if (found.refused) placements.push({ ...found.refused, level: z })
      break
    }
  }
}

// A move of a few existing pieces to the first floor cell two cells away that the
// source accepts; the refusal row is the same piece aimed into a solid block.
const moveTypes = ['bench', 'fence', 'tactile', 'floor-mark']
const moves = []
for (const type of moveTypes) {
  const mod = station.modules.find((m) => m.type === type)
  if (!mod) continue
  let accepted = null
  let refused = null
  const cells = floorCells(mod.z)
  for (const cell of cells) {
    for (const rotation of [mod.rot ?? 0, ((mod.rot ?? 0) + 1) % 4]) {
      const { module: moved, reason } = moveCandidate(station.cells, station.modules, mod, { x: cell[0], y: cell[1], z: cell[2] }, rotation)
      const code = equipmentReason(station.cells, station.modules.filter((m) => m.id !== mod.id), moved)
      const row = {
        moduleId: mod.id,
        type: mod.type,
        from: { x: mod.x, y: mod.y, z: mod.z, rot: mod.rot ?? 0 },
        at: cell,
        rotation,
        candidate: {
          type: moved.type,
          x: moved.x,
          y: moved.y,
          z: moved.z,
          rot: moved.rot ?? 0,
          w: moved.w ?? 1,
          d: moved.d ?? 1,
        },
        notice: reason,
        reason: code,
        colliders: placementColliders(station.modules.filter((m) => m.id !== mod.id), moved).map((m) => m.id),
      }
      if (code === '' && accepted === null) accepted = row
      if (code !== '' && cell[0] === mod.x && cell[1] === mod.y && refused === null) refused = row
      if (accepted && refused) break
    }
    if (accepted && refused) break
  }
  if (accepted) moves.push(accepted)
  if (refused) moves.push(refused)
}

// The eyedropper mapping for one placed piece of each migrated family.
const picks = []
for (const type of ['bench', 'fence', 'tactile', 'floor-mark', 'tvm', 'gate', 'clock', 'cctv', 'monitor', 'light']) {
  const mod = station.modules.find((m) => m.type === type)
  if (!mod) continue
  picks.push({ moduleId: mod.id, type: mod.type, paletteId: paletteIdForModule(mod) })
}

const oracle = {
  format: 'station-edit-oracle',
  source: { demo: 'zoo', saveSha256: sha256(saveText), cells: station.cells.length, modules: station.modules.length },
  levels,
  placements,
  moves,
  picks,
}
writeFileSync(OUT, JSON.stringify(oracle, null, 2) + '\n')
console.log(`station-edit-oracle: ${placements.length} placements, ${moves.length} moves, ${picks.length} picks`)
console.log(`save ${oracle.source.saveSha256.slice(0, 12)} → ${OUT.pathname}`)
