// TypeScript oracle for the Unity cell mesher (plan 11, packet E).
//
// Runs the **source** mesher (`game/src/render/chunkMesher.ts`, which imports no
// three.js) over small authored fixtures and over selected chunks of a real save, and
// writes the resulting surface facts. `StationCellMeshTests.cs` rebuilds the same
// inputs from this file and compares its own mesh triangle for triangle.
//
// The fixtures pin exactly what packet E must not get wrong:
//   six-finish   one cell wearing six different finishes under an occluding block,
//                with an adjacent solid cell: occluded faces emit nothing and every
//                drawn face carries its own finish.
//   partial      half walls, a , a compound cut,  wedges (including a
//                ridge-locked run and a wedge under a slab) and a platform inset.
//   ramp         a shaved block under a run, a truss filling, two crossing cuts
//                (the neighbour-partition path) and the cap the cut leaves.
//   ground       the generated street window (`withGround`) with a virtual plane at
//                z = 0, i.e. explicit vs virtual ground.
//
// Usage (repository root):
//   node tools/unity-parity/record-station-cell-mesh.mjs [--zoo path] [--out path]
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildSolidSet, meshChunk,
} from '../../game/src/render/chunkMesher.ts'
import { finishMapOf } from '../../game/src/sim/finishes.ts'
import { withGround, GROUND_MARGIN } from '../../game/src/sim/ground.ts'
import { clearCeilingZoneLabels } from '../../game/src/build/model/Zones.ts'
import { clearContactFinishes } from '../../game/src/sim/contactFinishes.ts'
import { packKey, shapeOf } from '../../game/src/sim/types.ts'
import { facePresent, paintFaces, paintFace, eraseFaces, fillSurface } from '../../game/src/build/model/Paint.ts'
import { finishOf } from '../../game/src/sim/finishes.ts'

const root = join(import.meta.dirname, '../..')
const args = process.argv.slice(2)
const options = { zoo: join(root, 'unity/Assets/StationDesigner/Zoo/ZooSave.json'), out: join(root, 'unity/Assets/StationDesigner/Tests/EditMode/station-cell-mesh-oracle.json'), meshInput: null }
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--zoo') options.zoo = args[++i]
  else if (args[i] === '--out') options.out = args[++i]
  else if (args[i] === '--mesh-input') options.meshInput = args[++i]
  else throw new Error(`Unknown argument: ${args[i]}`)
}

const round = (value) => Math.round(value * 1e4) / 1e4
const keyOf = (x, y, z) => `${x},${y},${z}`
const cellKey = (cell) => keyOf(cell.x, cell.y, cell.z)
/** Packed cell key  "x,y,z" for the oracle's own records. */
function unpack(packed) {
  const x = Math.floor(packed / (8192 * 8192)) - 4096
  const y = (Math.floor(packed / 8192) % 8192) - 4096
  const z = (packed % 8192) - 4096
  return keyOf(x, y, z)
}

/** A cell's cut shape as a stable string, or '' for a whole block. */
function shapeName(cell) {
  const shape = shapeOf(cell)
  if (!shape) return ''
  if (shape.kind === 'triangle') return `${shape.triangle}-${shape.side}`
  if (shape.kind === 'cuts') return `cuts-${shape.mask}`
  return `${shape.kind}-${shape.side}`
}

/** Per-part facts plus an exact triangle signature list (centroid + normal + area). */
function factsOf(chunk) {
  const parts = []
  const signatures = []
  let triangles = 0
  for (const part of chunk.parts) {
    let area = 0
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let t = 0; t < part.indices.length; t += 3) {
      const points = []
      for (let v = 0; v < 3; v++) {
        const i = part.indices[t + v]
        points.push([part.positions[i * 3], part.positions[i * 3 + 1], part.positions[i * 3 + 2]])
        for (let axis = 0; axis < 3; axis++) {
          const value = part.positions[i * 3 + axis]
          if (value < min[axis]) min[axis] = value
          if (value > max[axis]) max[axis] = value
        }
      }
      const [a, b, c] = points
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
      const cross = [
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      ]
      const triArea = 0.5 * Math.hypot(...cross)
      area += triArea
      const i0 = part.indices[t]
      const cx = (a[0] + b[0] + c[0]) / 3
      const cy = (a[1] + b[1] + c[1]) / 3
      const cz = (a[2] + b[2] + c[2]) / 3
      signatures.push([
        round(cx), round(cy), round(cz),
        round(part.normals[i0 * 3]), round(part.normals[i0 * 3 + 1]), round(part.normals[i0 * 3 + 2]),
        round(triArea),
      ].join(','))
    }
    triangles += part.triangles
    parts.push({
      finish: part.finish,
      triangles: part.triangles,
      area: round(area),
      min: min.map(round),
      max: max.map(round),
    })
  }
  signatures.sort()
  parts.sort((a, b) => a.finish.localeCompare(b.finish))
  return { triangles, parts, signatures }
}

const fixtures = []

/* ------------------------------------------------------------- six-finish cell */

{
  const faceFinishes = {
    top: 'floor.marble', bottom: 'ceil.baffle', n: 'wall.enamel#ff4242',
    e: 'wall.stainless', s: 'floor.granite', w: 'ceil.steel',
  }
  const cells = [
    { x: 0, y: 0, z: 0, fill: 'solid', finish: { ...faceFinishes } },
    { x: 1, y: 0, z: 0, fill: 'solid' }, // occludes the east face
    { x: 0, y: 0, z: 1, fill: 'solid', tags: ['wall'] }, // occludes the top face
  ]
  const solid = buildSolidSet(cells)
  const thin = new Map()
  const chunk = cells
  const chunkGeometry = meshChunk(solid, finishMapOf(cells), 0, 0, 0, 0,
    new Set(chunk.map((cell) => packKey(cell.x, cell.y, cell.z))), undefined, chunk, thin)
  const expected = factsOf(chunkGeometry)
  fixtures.push({
    name: 'six-finish',
    description: 'six different finishes on one cell, east and top occluded by solid neighbours',
    cells: cells.map((cell) => ({ x: cell.x, y: cell.y, z: cell.z, tags: cell.tags ?? [], finish: Object.entries(cell.finish ?? {}).map(([face, id]) => `${face}=${id}`) })),
    thin: [], fills: [], slopes: [], insets: [], hidden: [],
    virtualGround: false, groundZ: 0, groundMargin: GROUND_MARGIN, levelBase: 0, storeyHeight: 5,
    expected,
  })
}

/* -------------------------------------------------------------------- partial */

{
  const cells = [
    { x: 0, y: 0, z: 0, fill: 'solid', tags: ['half-wall:n'], finish: { top: 'floor.granite', s: 'wall.plaster' } },
    { x: 0, y: 0, z: 1, fill: 'solid' }, // a block over the half wall
    { x: 1, y: 0, z: 0, fill: 'solid', tags: ['half-corner:e'] },
    { x: 2, y: 0, z: 0, fill: 'solid', tags: ['half-corner:n', 'half-corner:s'] }, // compound cut
    { x: 3, y: 0, z: 0, fill: 'solid', tags: ['tri-upper:w'] },
    { x: 3, y: 1, z: 0, fill: 'solid', tags: ['tri-upper:w'] }, // ridge-locked run
    { x: 4, y: 0, z: 0, fill: 'solid', tags: ['tri-lower:e'], finish: { bottom: 'ceil.metal' } },
    { x: 5, y: 0, z: 0, fill: 'solid', tags: ['tri-upper:n'] },
    { x: 5, y: 0, z: 1, fill: 'solid' }, // a slab over the wedge's tip
    { x: 6, y: 0, z: 0, fill: 'solid' },
    { x: 7, y: 0, z: 0, fill: 'solid' }, // the inset's neighbour
  ]
  const insets = new Map([[packKey(6, 0, 0), { x0: 0, x1: 0.87, y0: 0, y1: 1 }]])
  const chunk = cells
  const solid = buildSolidSet(cells)
  const thin = new Map()
  for (const cell of cells) {
    const shape = shapeOf(cell)
    if (shape) thin.set(packKey(cell.x, cell.y, cell.z), shape)
  }
  const chunkGeometry = meshChunk(solid, finishMapOf(cells), 0, 0, 0, 0,
    new Set(chunk.map((cell) => packKey(cell.x, cell.y, cell.z))), undefined, chunk, thin,
    undefined, undefined, undefined, insets)
  fixtures.push({
    name: 'partial-shapes',
    description: 'half wall under a block, a , a compound cut, four  wedges, a ridge run and a platform inset',
    cells: cells.map((cell) => ({ x: cell.x, y: cell.y, z: cell.z, tags: cell.tags ?? [], finish: Object.entries(cell.finish ?? {}).map(([face, id]) => `${face}=${id}`) })),
    thin: [], fills: [], slopes: [], insets: [...insets].map(([key, inset]) => ({ key: unpack(key), ...inset })), hidden: [],
    virtualGround: false, groundZ: 0, groundMargin: GROUND_MARGIN, levelBase: 0, storeyHeight: 5,
    expected: factsOf(chunkGeometry),
  })
}

/* ----------------------------------------------------------------------- ramp */

{
  // A ground slab with one block shaved by a run, and four void cells above it that
  // a run's truss hangs into: `rampFillKeys`' case (a filling stands on a solid block
  // under a cut and is drawn though the document holds no cell there).
  const cells = []
  for (let x = 0; x <= 2; x++) for (let y = 0; y <= 1; y++) cells.push({ x, y, z: 0, fill: 'solid' })
  const cuts = new Map([
    [packKey(0, 0, 0), { axis: 'x', lo: 0.3, hi: 0.95, finish: 'floor.slate' }],
    [packKey(1, 0, 1), { axis: 'x', lo: 0.2, hi: 0.9, base: 0, finish: 'floor.slate' }],
    [packKey(2, 0, 1), { axis: 'x', lo: 0.1, hi: 0.7, half: 0.41, finish: 'ceil.steel' }],
    [packKey(1, 1, 1), { axis: 'y', lo: 0.15, hi: 0.8 }],
    [packKey(2, 1, 1), { axis: 'y', lo: 0.05, hi: 0.65 }],
  ])
  const fills = new Set([packKey(1, 0, 1), packKey(2, 0, 1), packKey(1, 1, 1), packKey(2, 1, 1)])
  const chunk = cells.map((cell) => ({ x: cell.x, y: cell.y, z: cell.z }))
  // `ChunkSystem` meshes the filling a block carries up to a run's truss with that
  // block (its own storey), so the fill cells are part of the visit list.
  for (const cell of cells) {
    if (fills.has(packKey(cell.x, cell.y, cell.z + 1))) chunk.push({ x: cell.x, y: cell.y, z: cell.z + 1 })
  }
  const chunkGeometry = meshChunk(buildSolidSet(cells), finishMapOf(cells), 0, 0, 0, 0,
    new Set(chunk.map((cell) => packKey(cell.x, cell.y, cell.z))), undefined, chunk, new Map(),
    cuts, fills)
  fixtures.push({
    name: 'ramp',
    description: 'a shaved ground block, a truss-box filling, two crossing slope cuts and a painted run finish',
    cells: cells.map((cell) => ({ x: cell.x, y: cell.y, z: cell.z, tags: [], finish: [] })),
    thin: [], fills: [...fills].map(unpack), slopes: [...cuts].map(([packed, cut]) => ({
      key: unpack(packed), axis: cut.axis, lo: cut.lo, hi: cut.hi,
      basePlane: cut.base ?? 0, hasBase: cut.base !== undefined,
      halfWidth: cut.half ?? 0, hasHalf: cut.half !== undefined,
      finish: cut.finish ?? '',
    })), insets: [], hidden: [],
    virtualGround: false, groundZ: 0, groundMargin: GROUND_MARGIN, levelBase: 0, storeyHeight: 5,
    expected: factsOf(chunkGeometry),
  })
}
/* --------------------------------------------------------------------- ground */

{
  const authored = [
    { x: 0, y: 0, z: 1, fill: 'solid' },
    { x: 1, y: 0, z: 1, fill: 'solid' },
    { x: 0, y: 1, z: 1, fill: 'solid' },
    { x: 1, y: 1, z: 1, fill: 'solid' },
    { x: 2, y: 0, z: 1, fill: 'solid', finish: { top: 'floor.granite' } },
  ]
  const effective = withGround(authored, [], GROUND_MARGIN)
  // The chunk at the origin, in the ground band.
  const chunk = effective.filter((cell) => Math.floor(cell.x / 16) * 16 === 0 && Math.floor(cell.y / 16) * 16 === 0 && cell.z === 0)
  const chunkGeometry = meshChunk(buildSolidSet(effective), finishMapOf(effective), 0, 0, 0, 0,
    new Set(chunk.map((cell) => packKey(cell.x, cell.y, cell.z))), undefined, chunk, new Map())
  fixtures.push({
    name: 'virtual-ground',
    description: 'the generated street plane over a 2x2 block at z=1 (explicit vs virtual ground)',
    cells: authored.map((cell) => ({ x: cell.x, y: cell.y, z: cell.z, tags: [], finish: Object.entries(cell.finish ?? {}).map(([face, id]) => `${face}=${id}`) })),
    thin: [], fills: [], slopes: [], insets: [], hidden: [],
    virtualGround: true, groundZ: 0, groundMargin: GROUND_MARGIN, levelBase: 0, storeyHeight: 5,
    expected: factsOf(chunkGeometry),
  })
}

/* --------------------------------------------------------------- Zoo chunks */

function loadZoo(path) {
  const save = JSON.parse(readFileSync(path, 'utf8'))
  const cells = save?.static?.cells ?? []
  // The same two normalizations packet A's reader applies before a consumer sees cells.
  const normalized = clearContactFinishes(clearCeilingZoneLabels(cells))
  return { save, cells, normalized }
}

const zoo = loadZoo(options.zoo)
const normalizedCells = zoo.normalized.filter((cell) => cell.fill === 'solid')
const thin = new Map()
for (const cell of normalizedCells) {
  const shape = shapeOf(cell)
  if (shape) thin.set(packKey(cell.x, cell.y, cell.z), shape)
}
const solid = buildSolidSet(normalizedCells)
const finishes = finishMapOf(normalizedCells)
const bands = new Set(normalizedCells.map((cell) => Math.floor(cell.z / 5) * 5))

/** Chunk columns to sample, picked from the save's own content (never a fixed ID). */
function chooseChunks() {
  const byChunk = new Map()
  for (const cell of normalizedCells) {
    const cx = Math.floor(cell.x / 16) * 16
    const cy = Math.floor(cell.y / 16) * 16
    const key = `${cx},${cy}`
    const entry = byChunk.get(key) ?? { cx, cy, cells: 0, shaped: 0, finished: 0 }
    entry.cells++
    if (shapeOf(cell)) entry.shaped++
    if (cell.finish) entry.finished++
    byChunk.set(key, entry)
  }
  const all = [...byChunk.values()].sort((a, b) => b.cells - a.cells)
  const picks = []
  const take = (entry, why) => {
    if (!entry || picks.some((pick) => pick.cx === entry.cx && pick.cy === entry.cy)) return
    picks.push({ ...entry, why })
  }
  take(all[0], 'largest chunk by cell count')
  take([...all].sort((a, b) => b.shaped - a.shaped)[0], 'most shaped cells')
  take([...all].sort((a, b) => b.finished - a.finished)[0], 'most per-face finishes')
  return picks
}

const zooFixtures = []
for (const pick of chooseChunks()) {
  // The storey pass for each band the chunk actually reaches.
  for (const band of [...bands].sort((a, b) => a - b)) {
    const chunkCells = normalizedCells.filter((cell) =>
      Math.floor(cell.x / 16) * 16 === pick.cx && Math.floor(cell.y / 16) * 16 === pick.cy && cell.z >= band && cell.z < band + 5)
    if (chunkCells.length === 0) continue
    const chunkGeometry = meshChunk(solid, finishes, pick.cx, pick.cy, band, band,
      new Set(chunkCells.map((cell) => packKey(cell.x, cell.y, cell.z))), undefined, chunkCells, thin)
    const expected = factsOf(chunkGeometry)
    // A full signature list would be large; the aggregate per finish plus a digest
    // pins the same surfaces. Keep one representative cell of each face finish.
    const digest = [...expected.signatures].reduce((hash, line) => (Math.imul(hash ^ line.length, 16777619) >>> 0), 2166136261) >>> 0
    const selected = []
    const seen = new Set()
    for (const cell of chunkCells) {
      const shape = shapeOf(cell)
      const tag = `${cell.finish ? Object.values(cell.finish).join('+') : 'default'}|${shape ? 'shaped' : 'full'}`
      if (seen.has(tag)) continue
      seen.add(tag)
      selected.push(keyOf(cell.x, cell.y, cell.z))
      if (selected.length >= 8) break
    }
    zooFixtures.push({
      name: `zoo-${pick.cx}-${pick.cy}-band-${band}`,
      why: pick.why,
      chunk: { cx: pick.cx, cy: pick.cy, band },
      cells: chunkCells.length,
      selectedCellIds: selected,
      expected: {
        triangles: expected.triangles,
        signatureDigest: digest,
        signatureCount: expected.signatures.length,
        parts: expected.parts,
      },
    })
  }
}

/* ---------------------------------------------------------------- paint (section4.3) */
//
// The brush's own facts: which cell faces it offers (`facePresent`), how far a
// whole-surface flood walks (`fillSurface`), and the writes a press commits
// (`paintFace` / `paintFaces` / `eraseFaces`). The C# engine is compared against
// these directly, including the street materialisation a bottom-face paint performs.

const paintCells = []
for (let x = 0; x <= 3; x++) for (let y = 0; y <= 2; y++) paintCells.push({ x, y, z: 0, fill: 'solid', finish: x === 1 && y === 0 ? { top: 'floor.granite' } : undefined })
for (let z = 1; z <= 5; z++) paintCells.push({ x: 0, y: 1, z, fill: 'solid', tags: ['wall'] })
paintCells.push({ x: 1, y: 1, z: 3, fill: 'solid', tags: ['wall', 'suspended-ceiling'] })
paintCells.push({ x: 5, y: 0, z: 0, fill: 'solid', tags: ['half-wall:n'], finish: { top: 'floor.granite' } })
paintCells.push({ x: 5, y: 0, z: 1, fill: 'solid' })
paintCells.push({ x: 6, y: 0, z: 0, fill: 'solid', tags: ['half-corner:e'] })
paintCells.push({ x: 7, y: 0, z: 0, fill: 'solid', tags: ['half-corner:n', 'half-corner:s'] })
paintCells.push({ x: 8, y: 0, z: 0, fill: 'solid', tags: ['tri-upper:w'] })
for (let x = 2; x <= 3; x++) for (let y = 0; y <= 1; y++) paintCells.push({ x, y, z: 5, fill: 'solid' })
paintCells.push({ x: 12, y: 12, z: 0, fill: 'solid', zone: 'outside', tags: ['painted-ground'], finish: { bottom: 'ceil.baffle' } })
for (let x = 20; x <= 21; x++) for (let y = 20; y <= 21; y++) paintCells.push({ x, y, z: 2, fill: 'solid' })
const voidCell = { x: 10, y: 10, z: 0, fill: 'void' }
const paintState = { cells: paintCells, modules: [] }
const paintSolid = buildSolidSet(paintCells)
// `facePresent` keys its `thin` map by the **string** cell key (`thinWallSideMap`),
// while the mesher takes packed numeric keys: two maps, deliberately.
const paintThin = new Map()
for (const cell of paintCells) {
  const shape = shapeOf(cell)
  if (shape) paintThin.set(cellKey(cell), shape)
}
const paintEffective = withGround(paintCells.concat([voidCell]), [], GROUND_MARGIN)
const stringCells = (cells) => new Set(cells.filter((cell) => cell.fill === 'solid').map((cell) => cellKey(cell)))
const paintEffectiveSolid = stringCells(paintEffective)
const FACE_ORDER = ['top', 'bottom', 'n', 'e', 's', 'w']

/** `paintFaces` / `eraseFaces` before-after diff, as the writes packet E publishes. */
function writesOf(beforeCells, afterCells, face) {
  const before = new Map(beforeCells.map((cell) => [cellKey(cell), cell]))
  const after = new Map(afterCells.map((cell) => [cellKey(cell), cell]))
  const writes = []
  for (const [key, cell] of after) {
    const old = before.get(key)
    const finish = cell.finish?.[face]
    if (!old) {
      if (finish) writes.push({ cell: [cell.x, cell.y, cell.z], face, finish, materialise: true, zone: cell.zone ?? '', tags: cell.tags ?? [] })
      continue
    }
    const was = old.finish?.[face]
    if (finish === was) continue
    writes.push({ cell: [cell.x, cell.y, cell.z], face, finish: finish ?? null, materialise: false, zone: '', tags: [] })
  }
  for (const [key, old] of before) {
    if (after.has(key)) continue
    writes.push({ cell: [old.x, old.y, old.z], face, finish: null, materialise: false, zone: '', tags: [] })
  }
  writes.sort((a, b) => a.cell[0] - b.cell[0] || a.cell[1] - b.cell[1] || a.cell[2] - b.cell[2] || a.face.localeCompare(b.face))
  return writes
}

const presence = []
for (const cell of paintEffective) {
  if (cell.fill !== 'solid') continue
  for (const face of FACE_ORDER) {
    const present = facePresent(paintEffectiveSolid, paintThin, cell.x, cell.y, cell.z, face)
    presence.push(`${cellKey(cell)},${face},${present ? 1 : 0}`)
  }
}
presence.sort()
const faceFinishCounts = []
for (const face of FACE_ORDER) {
  const counts = new Map()
  for (const cell of paintEffective) {
    if (cell.fill !== 'solid') continue
    if (!facePresent(paintEffectiveSolid, paintThin, cell.x, cell.y, cell.z, face)) continue
    const finish = finishOf(cell, face)
    counts.set(finish, (counts.get(finish) ?? 0) + 1)
  }
  for (const [finish, count] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) faceFinishCounts.push({ face, finish, count })
}

const paintFixtures = []
function paintCase(name, { mode, anchor, face, finish, dragTo }) {
  const before = paintState.cells
  let after
  if (mode === 'erase') {
    after = eraseFaces(paintState, [anchor], face).cells
  } else if (mode === 'surface') {
    after = fillSurface(paintState, anchor[0], anchor[1], anchor[2], face, finish).cells
  } else if (mode === 'drag') {
    const cells = []
    for (let x = Math.min(anchor[0], dragTo[0]); x <= Math.max(anchor[0], dragTo[0]); x++)
      for (let y = Math.min(anchor[1], dragTo[1]); y <= Math.max(anchor[1], dragTo[1]); y++) cells.push([x, y, anchor[2]])
    const targets = cells.filter(([x, y, z]) => facePresent(paintEffectiveSolid, paintThin, x, y, z, face))
    after = paintFaces(paintState, targets, face, finish).cells
  } else if (mode === 'street-bottom') {
    after = paintFace(paintState, anchor[0], anchor[1], anchor[2], face, finish).cells
  } else {
    after = paintFaces(paintState, [anchor], face, finish).cells
  }
  paintFixtures.push({ name, mode: mode === 'street-bottom' ? 'single' : mode, anchor, face, finish, dragTo: dragTo ? [dragTo[0], dragTo[1], anchor[2]] : null, expected: { writes: writesOf(before, after, face) } })
}

paintCase('single-top', { mode: 'single', anchor: [1, 0, 0], face: 'top', finish: 'floor.marble' })
paintCase('single-east-edge', { mode: 'single', anchor: [21, 21, 2], face: 'e', finish: 'wall.stainless' })
paintCase('single-street-bottom-materialises', { mode: 'street-bottom', anchor: [20, 20, 0], face: 'bottom', finish: 'ceil.baffle' })
paintCase('surface-floor', { mode: 'surface', anchor: [0, 0, 0], face: 'top', finish: 'floor.marble' })
paintCase('surface-wall-bounded-by-ceiling', { mode: 'surface', anchor: [0, 1, 1], face: 'e', finish: 'wall.plaster' })
paintCase('surface-floor-underside', { mode: 'surface', anchor: [21, 21, 2], face: 'bottom', finish: 'ceil.metal' })
paintCase('surface-half-wall-inner', { mode: 'surface', anchor: [5, 0, 0], face: 's', finish: 'wall.plaster' })
paintCase('surface-wedge-slope', { mode: 'surface', anchor: [8, 0, 0], face: 'top', finish: 'floor.slate' })
paintCase('drag-rect', { mode: 'drag', anchor: [0, 0, 0], face: 'top', finish: 'floor.granite', dragTo: [2, 1] })
paintCase('erase-face', { mode: 'erase', anchor: [1, 0, 0], face: 'top' })

// Zoo: the brush's own per-face finish counts and an exact presence digest over the
// normalized cells (E3 must offer the same surfaces the mesher draws).
const zooSolid = stringCells(normalizedCells)
const zooPresenceCells = normalizedCells.slice().sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z)
const zooThin = new Map()
for (const cell of zooPresenceCells) {
  const shape = shapeOf(cell)
  if (shape) zooThin.set(cellKey(cell), shape)
}
// Cell-major, so the bits read as one six-face group per cell in sorted order: the C#
// test walks the same cells in the same order and compares the bit string directly.
let zooBits = ''
const zooCountByFace = new Map(FACE_ORDER.map((face) => [face, new Map()]))
for (const cell of zooPresenceCells) {
  for (const face of FACE_ORDER) {
    const present = facePresent(zooSolid, zooThin, cell.x, cell.y, cell.z, face)
    zooBits += present ? '1' : '0'
    if (!present) continue
    const finish = finishOf(cell, face)
    const counts = zooCountByFace.get(face)
    counts.set(finish, (counts.get(finish) ?? 0) + 1)
  }
}
const zooCounts = []
for (const face of FACE_ORDER) {
  for (const [finish, count] of [...zooCountByFace.get(face)].sort((a, b) => a[0].localeCompare(b[0]))) zooCounts.push({ face, finish, count })
}
const digestOf = (text) => {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0
  return hash >>> 0
}
const paintOracle = {
  cells: paintCells.map((cell) => ({ x: cell.x, y: cell.y, z: cell.z, fill: cell.fill, tags: cell.tags ?? [], finish: Object.entries(cell.finish ?? {}).map(([face, id]) => `${face}=${id}`), zone: cell.zone ?? '' })),
  voids: [keyOf(voidCell.x, voidCell.y, voidCell.z)],
  virtualGround: true, groundZ: 0, groundMargin: GROUND_MARGIN,
  presence,
  faceFinishCounts,
  fixtures: paintFixtures,
  zoo: {
    presence: zooBits,
    cells: zooPresenceCells.length,
    presenceCount: zooBits.length,
    presenceDigest: digestOf(zooBits),
    faceFinishCounts: zooCounts,
  },
}

const oracle = {
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  zoo: {
    path: 'unity/Assets/StationDesigner/Zoo/ZooSave.json',
    sha256: createHash('sha256').update(readFileSync(options.zoo)).digest('hex'),
    cells: zoo.cells.length,
    normalizedSolids: normalizedCells.length,
    shapedCells: thin.size,
    finishCells: finishes.size,
    levelBase: zoo.save.levelBase ?? 0,
    fixtures: zooFixtures,
  },
  fixtures,
  paint: paintOracle,
}

writeFileSync(options.out, JSON.stringify(oracle, null, 2) + '\n')

// Optional side file for the standalone C# parity harness (a scratch verification run
// that cannot call Unity's reader): the normalized cells the Zoo fixtures were meshed
// from, so the harness feeds the mesher exactly the same station.
if (options.meshInput) {
  writeFileSync(options.meshInput, JSON.stringify({
    levelBase: zoo.save.levelBase ?? 0,
    cells: normalizedCells.map((cell) => ({
      x: cell.x, y: cell.y, z: cell.z,
      tags: cell.tags ?? [],
      finish: Object.entries(cell.finish ?? {}).map(([face, id]) => `${face}=${id}`),
    })),
  }))
}

console.log(JSON.stringify({
  out: options.out,
  fixtures: fixtures.map((fixture) => ({ name: fixture.name, triangles: fixture.expected.triangles, parts: fixture.expected.parts.length })),
  zoo: zooFixtures.map((fixture) => ({ name: fixture.name, cells: fixture.cells, triangles: fixture.expected.triangles, parts: fixture.expected.parts.length })),
}))














