// The volume a run takes out of the block under it — GAME-SPEC §5.1 / §5.4.
//
// A 楼梯 / 扶梯 stands on the ground it climbs over, and its body — an escalator's
// truss, a stair's soffit — hangs below its walking line. A block under the run that
// ends on the cell ceiling therefore disappears into the truss: the ground bulges up
// through the very thing it is founded on.
//
// `rampSlopeCuts` derives the volume the run really takes: the tiles
// `rampBodyBoxes` already reserves for collision, with the truss depth taken off
// the local walking line. The mesher draws those blocks' tops on that plane, so the
// ground under a run fills the space under the slope and stops at the truss.
//
// Nothing is added to the document. There is no filling-block piece, no new cell and
// no tag: the cut is derived from the runs, exactly like the half panel a wide run
// leaves beside it (`rampThinCells`), so it follows an edit and can never fall out
// of step with the run that made it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSolidSet, meshChunk } from '../src/render/chunkMesher.ts'
import { RAMP_FOOT, carveRampOpenings, rampBodyBoxes, rampSlopeCuts } from '../src/sim/openings.ts'
import { reservedOpening } from '../src/sim/placement.ts'
import { addCells } from '../src/build/model/Cells.ts'
import { createModule } from '../src/build/model.ts'
import { packKey } from '../src/sim/types.ts'

/** A run climbing one storey along −x: 6 cells across, 4 m up. */
const escalator = (from = { x: 6, y: 0, z: 0 }, to = { x: 0, y: 0, z: 4 }) => ({
  id: 'e1',
  type: 'escalator',
  x: from.x,
  y: from.y,
  z: from.z,
  rot: 0,
  from,
  to,
  cfg: { dir: 'up' },
})

/** The walking line of a run, at a world point: `from` and `to` are landings. */
function line(run, x, y) {
  const from = run.from ?? run
  const to = run.to ?? run
  const ax = from.x + 0.5
  const ay = from.y + 0.5
  const az = from.z + 1
  const dx = to.x + 0.5 - ax
  const dy = to.y + 0.5 - ay
  const t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)
  return az + (to.z + 1 - az) * t
}

/** The packed key back to its cell, so a cut can be asked about by coordinate. */
function unpack(k) {
  const z = (k % 8192) - 4096
  const t = (k - (z + 4096)) / 8192
  const y = (t % 8192) - 4096
  const x = (t - (y + 4096)) / 8192 - 4096
  return [x, y, z]
}

/** Every vertex the mesher draws for one cell, as world coordinates. */
function mesh(cell, slope) {
  const solid = buildSolidSet([{ ...cell, fill: 'solid' }])
  const emit = new Set([packKey(cell.x, cell.y, cell.z)])
  const chunk = meshChunk(solid, new Map(), 0, 0, cell.z, cell.z, emit, undefined, undefined, undefined, slope)
  const out = []
  for (const part of chunk.parts) {
    for (let i = 0; i < part.positions.length; i += 3) {
      out.push([part.positions[i], part.positions[i + 1], part.positions[i + 2]])
    }
  }
  return out
}

/* ------------------------------------------------------------ placing it */

test('a block under a run is floor: the brush lays it and the carve leaves it', () => {
  const esc = escalator()
  // The run's own cell — its walking line passes through it — is the opening.
  assert.equal(reservedOpening([esc], 4, 0, 2), true, "the run's own cell is not buildable")
  // The cell directly below it is *not*: the truss hangs into its top, and that is
  // exactly what the 地基 tool is for.
  assert.equal(reservedOpening([esc], 4, 0, 1), false, 'the cell under the run must be buildable')

  const { changed, blocked } = addCells([], [[4, 0, 1]], [esc])
  assert.equal(changed, 1, 'the block brush must lay a block under a run')
  assert.equal(blocked, 0, 'and must not count it as a reserved opening')

  // And a block already there when the run arrives is not eaten: the carve opens
  // the cell the walking line crosses, and the ground under the run keeps its
  // blocks — which is what the cut then shaves.
  const cells = []
  for (let z = -1; z <= 2; z++) cells.push({ x: 4, y: 0, z, fill: 'solid' })
  carveRampOpenings(cells, [esc])
  const left = cells.filter((c) => c.x === 4 && c.y === 0).map((c) => c.z).sort((a, b) => a - b)
  assert.deepEqual(left, [-1, 0, 1], 'the carve opens the run through the slab but keeps the blocks under it')
})

/* ------------------------------------------------------------- the volume */

test('the cut is the run’s own underside, one block per tile of its column', () => {
  const esc = escalator()
  const cuts = rampSlopeCuts([esc])
  assert.ok(cuts.size > 0, 'a run over ground cuts something')
  for (const [k, cut] of cuts) {
    const [x, y] = unpack(k)
    assert.equal(cut.axis, 'x', 'this run travels along x, so its cut slopes along x')
    assert.ok(Math.min(cut.lo, cut.hi) < 1, 'a cut that changes nothing is not reported')
    assert.ok(Math.max(cut.lo, cut.hi) > 0, 'and one the plane has already cleared is not either')
    // It is a block the run hangs over, never one beside it or past its ends.
    assert.equal(y, 0, 'only the run’s own column is cut')
    assert.ok(x >= 0 && x <= 6, 'only the tiles the run actually sweeps are cut')
  }

  // The whole point: the cell the cut lands in is *below* the run's walking line,
  // and the block there is exactly what a player would build.
  const under = cuts.get(packKey(4, 0, 1))
  assert.notEqual(under, undefined, 'the block under the run is cut')
  const underLine = line(esc, 4.5, 0.5)
  assert.ok(1 + Math.max(under.lo, under.hi) <= underLine, 'the cut stops below the walking line')
  // The plane is the run's own underside: where it crosses the block is exactly
  // `RAMP_FOOT` below the line at that point — checked point by point, because the
  // truss slopes too.
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const world = 1 + under.lo + (under.hi - under.lo) * t
    const truss = line(esc, 4 + t, 0.5) - RAMP_FOOT
    assert.ok(Math.abs(world - truss) < 1e-9, `the cut at x=${4 + t} is the truss: ${world} vs ${truss}`)
  }
})

test('a landing column is never cut: it is the run’s graph node and its floor', () => {
  const esc = escalator()
  const cuts = rampSlopeCuts([esc])
  for (const p of [esc.from, esc.to]) {
    for (const k of cuts.keys()) {
      const [x, y] = unpack(k)
      assert.ok(!(x === p.x && y === p.y), `the landing at ${p.x},${p.y} is cut`)
    }
  }
})

test('a stair cuts the tiles its treads sweep, not the landings they stop short of', () => {
  const stair = createModule('stair-straight', 0, 0, -4, 's1', 0, undefined)
  assert.ok(stair && stair.type === 'stair')
  const landings = new Set()
  for (const f of stair.cfg.flights) {
    landings.add(`${f.from.x},${f.from.y}`)
    landings.add(`${f.to.x},${f.to.y}`)
  }
  const cuts = rampSlopeCuts([stair])
  for (const k of cuts.keys()) {
    const [x, y, z] = unpack(k)
    assert.ok(!landings.has(`${x},${y}`), `a landing tile ${x},${y} is cut`)
    assert.ok(z <= Math.max(stair.from.z, stair.to.z), 'a stair cuts the ground it climbs over, under its own run')
  }
})

/* -------------------------------------------------------------- drawing it */

test('a cut block ends on the slope: no flat cap, no square corner', () => {
  const cut = { axis: 'x', lo: 0.2, hi: 0.8 }
  const pts = mesh({ x: 4, y: 0, z: 0 }, new Map([[packKey(4, 0, 0), cut]]))
  assert.ok(pts.length > 0, 'the block is still drawn')
  const top = Math.max(...pts.map((p) => p[2]))
  assert.ok(Math.abs(top - 0.8) < 1e-6, `the top reaches the cut plane, got ${top}`)
  // Every vertex sits at or under the plane, so nothing pokes out of the cut.
  for (const [x, y, z] of pts) {
    const plane = cut.lo + (cut.hi - cut.lo) * x
    assert.ok(z <= plane + 1e-6, `vertex ${z} at ${x},${y} is above the cut plane ${plane}`)
  }
  // The low wall is the plane too, and the block is a wedge, not a shorter cube:
  // some vertex has to be near the plane's low end and none on the ceiling.
  const lowWall = pts.filter((p) => z2eq(p[2], 0.2))
  assert.ok(lowWall.length > 0, 'the shallow end of the cut is built')
})

const z2eq = (a, b) => Math.abs(a - b) < 1e-6

test('nothing a run cuts reaches above its own body, escalator or stair', () => {
  const stair = createModule('stair-straight', 0, 0, -4, 's1', 0, undefined)
  assert.ok(stair && stair.type === 'stair')
  // One straight flight, so the whole stair's body is one `from`→`to` line.
  const flight = stair.cfg.flights[0]
  for (const run of [escalator(), flight]) {
    const cuts = rampSlopeCuts('type' in run ? [run] : [stair])
    assert.ok(cuts.size > 0, 'a run over ground cuts something')
    for (const k of cuts.keys()) {
      const [x, y, z] = unpack(k)
      // A cell the carve opens is air; only a real block is drawn and checked.
      for (const [vx, vy, vz] of mesh({ x, y, z }, cuts)) {
        const body = line(run, vx, vy) - RAMP_FOOT
        assert.ok(vz <= body + 1e-6, `a vertex at ${vx},${vy},${vz} reaches into the run at ${body}`)
      }
    }
  }
})

test('a block out of the run’s reach is meshed exactly as it always was', () => {
  const cell = { x: 4, y: 0, z: 5 }
  const plain = mesh(cell, undefined)
  const withCuts = mesh(cell, rampSlopeCuts([escalator()]))
  assert.deepEqual(withCuts, plain, 'the cut map must not touch a block it does not name')
  assert.ok(Math.abs(Math.max(...plain.map((p) => p[2])) - 6) < 1e-6, 'an uncut block still fills its cell')
})
