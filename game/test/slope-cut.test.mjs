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
import { RAMP_FOOT, STAIR_BODY_DROP, carveRampOpenings, rampBodyBoxes, rampFillKeys, rampSlopeCuts } from '../src/sim/openings.ts'
import { stairTreadTrim, STAIR_WIDTH_DOUBLE } from '../src/sim/stairs.ts'
import { ESCALATOR_BALUSTRADE } from '../src/sim/constants.ts'
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

/**
 * The same run as a **stair** (`rot: 3` is the orientation `createModule('stair-straight', 6, 0, 0,
 * …)` builds for it). A stair draws no body of its own, so it is the run whose ground the renderer
 * still fills — an escalator's piece carries that body itself now (`EscalatorModel.undercroftSolid`),
 * which is why the filling tests are written over this one.
 */
const stair = (from = { x: 6, y: 0, z: 0 }, to = { x: 0, y: 0, z: 4 }) => ({
  id: 's1',
  type: 'stair',
  x: from.x,
  y: from.y,
  z: from.z,
  rot: 3,
  from,
  to,
  cfg: { width: 0.68, style: 'straight', flights: [{ from, to }] },
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

/**
 * The **body line** under a **stair**, at a world point: its treads stop `stairTreadTrim`
 * short of each landing centre but still carry the whole rise, so the stringers and soffit
 * the model hangs under them — and the plane the ground under the run is cut to
 * (`rampSlopeCuts`) — follow that steeper line, not the landing-to-landing walking line
 * above. An escalator's truss really does run landing centre to landing centre, so it keeps
 * `line`.
 */
function bodyLine(run, x, y) {
  const from = run.from ?? run
  const to = run.to ?? run
  const ax = from.x + 0.5
  const ay = from.y + 0.5
  const az = from.z + 1
  const dx = to.x + 0.5 - ax
  const dy = to.y + 0.5 - ay
  const len = Math.hypot(dx, dy)
  const trim = stairTreadTrim(len)
  const u = ((x - ax) * dx + (y - ay) * dy) / len
  return az + (to.z + 1 - az) * ((u - trim) / (len - trim * 2))
}

/** The packed key back to its cell, so a cut can be asked about by coordinate. */
function unpack(k) {
  const z = (k % 8192) - 4096
  const t = (k - (z + 4096)) / 8192
  const y = (t % 8192) - 4096
  const x = (t - (y + 4096)) / 8192 - 4096
  return [x, y, z]
}

/**
 * The **base plane** of a flight's cut, in the `lo`/`hi` units of one of its cells, in
 * absolute (world) height: the surface of the landing the run climbs from, which is where
 * the piece stands and the lowest plane the ground under it may be cut to
 * (`SlopeCut.base`). `bodyLine` runs through it — the treads stop `stairTreadTrim` short of
 * the landing, so the body is already *below* that surface where the flight leaves it.
 */
const baseOf = (run) => (run.from ?? run).z + 1

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

/**
 * Every vertex the mesher draws for a set of cells to visit, against a solid set the
 * caller owns (so a *derived* filling can be visited without being solid).
 */
function meshCells(visit, solid, slope, fill) {
  const emit = new Set(visit.map((c) => packKey(c.x, c.y, c.z)))
  const zs = visit.map((c) => c.z)
  const chunk = meshChunk(solid, new Map(), 0, 0, Math.min(...zs), Math.max(...zs), emit, undefined, visit, undefined, slope, fill)
  const out = []
  for (const part of chunk.parts) {
    for (let i = 0; i < part.positions.length; i += 3) {
      out.push([part.positions[i], part.positions[i + 1], part.positions[i + 2]])
    }
  }
  return out
}

/**
 * True when a drawn vertex comes from a **cut** block rather than from a whole one — the
 * mesher puts a cut cell's top on the run's plane, and a cell the base clamp has left whole
 * on its own ceiling. Asked of a vertex that may sit on a cell boundary, so it answers for
 * any of the cells the vertex could belong to.
 */
function cutBlockAt(cuts, x, y, z) {
  for (const cx of [Math.floor(x - 1e-6), Math.floor(x + 1e-6)]) {
    for (const cy of [Math.floor(y - 1e-6), Math.floor(y + 1e-6)]) {
      for (const cz of [Math.floor(z - 1e-6), Math.floor(z + 1e-6)]) {
        if (cuts.has(packKey(cx, cy, cz))) return true
      }
    }
  }
  return false
}

/**
 * The bounds of a cut cell's **cap** at a world point: the run's plane folded up to the base
 * plane the piece stands on (`SlopeCut.base`), so never under that floor and never over the
 * body the flight hangs from. A fan's hub sits at the mean of its rim, so a cap vertex is
 * bounded by the fold rather than equal to it. `null` when the cell is not cut.
 */
function capBounds(cuts, x, y, z) {
  const cut = cuts.get(packKey(x, y, z))
  if (cut === undefined) return null
  const clamp = cut.base ?? -Infinity
  const lo = Math.min(1, Math.max(clamp, Math.min(cut.lo, cut.hi)))
  const hi = Math.min(1, Math.max(clamp, Math.max(cut.lo, cut.hi)))
  return [z + lo, z + hi]
}

/** The cap bounds that accept this vertex, over every cell it could belong to (it may sit on a boundary). */
function capBoundsAt(cuts, x, y, z) {
  const out = []
  for (const cx of [Math.floor(x - 1e-6), Math.floor(x + 1e-6)]) {
    for (const cy of [Math.floor(y - 1e-6), Math.floor(y + 1e-6)]) {
      for (const cz of [Math.floor(z - 1e-6), Math.floor(z + 1e-6)]) {
        const b = capBounds(cuts, cx, cy, cz)
        if (b !== null && z >= b[0] - 1e-6 && z <= b[1] + 1e-6) out.push(b)
      }
    }
  }
  return out
}

/**
 * The height of a cut cell's shaved cap at a world point: the run's plane **held at the base
 * plane** the piece stands on (`SlopeCut.base`), which is what the mesher draws there. `null`
 * when the cell is not cut.
 */
function capAt(cuts, x, y, z, wx, wy) {
  const cut = cuts.get(packKey(x, y, z))
  if (cut === undefined) return null
  const px = cut.axis === 'x' ? wx - x : wy - y
  return z + Math.min(1, Math.max(cut.base ?? -Infinity, cut.lo + (cut.hi - cut.lo) * px))
}

/**
 * True when a drawn vertex is **on the shaved cap** of a cut block, rather than part of a whole
 * block's chamfered rim or of a cell the clamp has left whole (whose top is its own ceiling —
 * the one place the ground under a stair is legitimately over the soffit, because that cell is
 * the floor the piece stands on). Asked of a vertex on a cell boundary, so it answers for any
 * of the cells the vertex could belong to.
 */
function onCutCap(cuts, x, y, z) {
  for (const cx of [Math.floor(x - 1e-6), Math.floor(x + 1e-6)]) {
    for (const cy of [Math.floor(y - 1e-6), Math.floor(y + 1e-6)]) {
      for (const cz of [Math.floor(z - 1e-6), Math.floor(z + 1e-6)]) {
        const cap = capAt(cuts, cx, cy, cz, x, y)
        if (cap !== null && Math.abs(z - cap) < 1e-6) return true
      }
    }
  }
  return false
}

/** The highest vertex drawn over the cell `(x, y)`. */

/** The highest vertex drawn over the cell `(x, y)`. */
function topOver(verts, x, y) {
  const inCell = verts.filter((p) => p[0] >= x - 1e-9 && p[0] <= x + 1 + 1e-9 && p[1] >= y - 1e-9 && p[1] <= y + 1 + 1e-9)
  assert.ok(inCell.length > 0, `nothing drawn over (${x}, ${y})`)
  return Math.max(...inCell.map((p) => p[2]))
}

/* ------------------------------------------------------------ placing it */

test('a block under a run is floor: the brush lays it and the carve leaves it', () => {
  const esc = escalator()
  // The run's own cell — its walking line passes through it — is the opening.
  assert.equal(reservedOpening([esc], 4, 0, 2), true, "the run's own cell is not buildable")
  // The cell directly below it is *not*: the truss hangs into its top, and that is
  // exactly what the 方块 tool is for.
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

test('a stair is cut to its own body, not an escalator’s truss depth', () => {
  // A stair hangs its stringers and soffit `STAIR_BODY_DROP` below the walking line — it is
  // not a truss box. Cutting it at an escalator's `RAMP_FOOT` stopped the ground 14 cm short
  // of the steps it carries: a slot of daylight under every flight, which is what the
  // escalator (whose own piece draws the body down to that plane) never showed.
  const run = stair()
  const cuts = rampSlopeCuts([run])
  assert.ok(cuts.size > 0, 'a stair over ground cuts something')
  assert.ok(STAIR_BODY_DROP < RAMP_FOOT, 'a stair must hang less deep than an escalator’s truss')
  let clamped = 0
  for (const [k, cut] of cuts) {
    const [x, y, z] = unpack(k)
    // The plane is the stair's underside — `lo`/`hi` are cell-local, so the cell's own floor
    // (world `z`) comes in — with one rule over it: it is **never below the base plane** the
    // piece stands on (`SlopeCut.base`). A stair's body is steeper than its run, so where the
    // flight leaves its landing the soffit already hangs under the floor the piece stands on,
    // and ground cut to *that* is a wedge dipping below the floor beside it: the block under
    // the base has to stay the floor block it is. The clamp only ever raises the plane, and
    // only as far as that floor.
    for (const t of [0, 0.5, 1]) {
      const world = z + cut.lo + (cut.hi - cut.lo) * t
      assert.ok(world >= baseOf(run) - 1e-9, `the cut at x=${x + t} is under the base plane the stair stands on: ${world}`)
    }
    // The clamp lands *on* the plane, not near it: wherever the run's own body dips under it,
    // the cut sits exactly at the base — the level of the floor the piece stands on.
    if (cut.base !== undefined) {
      assert.ok(Math.abs(z + cut.base - baseOf(run)) < 1e-9, `the cut names a base plane that is not the landing: ${z + cut.base}`)
      assert.ok(Math.min(cut.lo, cut.hi) >= cut.base - 1e-9, `the cut dips below its own base plane`)
      clamped++
    }
  }
  assert.ok(clamped > 0, 'no cut carries the base plane, so the clamp is not being read')
  assert.ok(cuts.size > clamped, 'the base clamp swallowed every cut on the flight')
  // Held at the base plane is not *flat* where the body is above it: the cut still slopes
  // with the run wherever the soffit has climbed clear of the floor the piece stands on.
  const sloping = [...cuts.values()].filter((c) => Math.abs(c.hi - c.lo) > 1e-9)
  assert.ok(sloping.length > 0, 'the base clamp flattened the whole flight')
})

test('a turn flight is cut on the slope its treads climb, not the landing-to-landing line', () => {
  // The bug this pins: the cut followed the walking line (landing centre to landing centre),
  // which is *shallower* than the body under the treads — the treads stop `stairTreadTrim`
  // short of each landing centre and still carry the whole rise. A 3-cell turn flight is
  // trimmed by a sixth of its run at each end, so its drawn body is 45° where that line is
  // 33.7°: the plane crossed the stair, a wedge of daylight under its upper steps and the
  // ground buried in its lower ones, worst on exactly the shapes a 90° / 180° turn is made of.
  for (const id of ['stair-straight', 'stair-right90', 'stair-right180']) {
    const m = createModule(id, 0, 0, -4, 'x', 0, undefined)
    assert.ok(m && m.type === 'stair')
    const cuts = rampSlopeCuts([m])
    assert.ok(cuts.size > 0, `${id} cuts nothing`)
    for (const f of m.cfg.flights) {
      const ax = f.from.x + 0.5
      const ay = f.from.y + 0.5
      const bx = f.to.x + 0.5
      const by = f.to.y + 0.5
      const len = Math.hypot(bx - ax, by - ay)
      const trim = stairTreadTrim(len)
      const drawn = (f.to.z - f.from.z) / (len - trim * 2)
      assert.ok(drawn > (f.to.z - f.from.z) / len + 1e-9, `${id}: a trimmed flight is not steeper than its landing-to-landing line`)
      let checked = 0
      for (const [k, cut] of cuts) {
        const [x, y] = unpack(k)
        const cx = x + 0.5
        const cy = y + 0.5
        // Only the cells this flight sweeps: on its own line, whatever the other flight does.
        if (Math.abs(Math.hypot(cx - ax, cy - ay) + Math.hypot(cx - bx, cy - by) - len) > 0.6) continue
        checked++
        // The slope is the drawn body's wherever the whole plane is above the base plane the
        // piece stands on; a cell whose plane reaches below it is held at that plane instead
        // (`SlopeCut.base`), and then its low end is the base — the floor it is level with.
        const below = cut.base !== undefined && Math.min(cut.lo, cut.hi) <= cut.base + 1e-9
        if (below) {
          assert.ok(Math.min(cut.lo, cut.hi) >= cut.base - 1e-9, `${id} at ${x},${y}: the cut dips below the base plane`)
          continue
        }
        assert.ok(
          Math.abs(Math.abs(cut.hi - cut.lo) - drawn) < 1e-9,
          `${id} at ${x},${y}: the cut slopes ${Math.abs(cut.hi - cut.lo)}, not the drawn body’s ${drawn}`,
        )
      }
      assert.ok(checked > 0, `${id}: no cut cell was found on the flight into ${f.to.x},${f.to.y}`)
    }
  }
})

test('the ground under a painted stair is painted with it', () => {
  // The 材质 brush paints the *piece* (`stair.cfg.finish`), and the canvas its cut leaves — a
  // shaved block's cap or the derived filling above it — is part of that piece's surface: the
  // cut carries the finish, and the mesher draws the cap in it, so a staircase and the ground
  // under it are one thing to paint. The block's own *sides* stay the ground's.
  const cladding = 'wall.enamel'
  const painted = { ...stair(), cfg: { ...stair().cfg, finish: cladding } }
  const cuts = rampSlopeCuts([painted])
  assert.ok(cuts.size > 0, 'a stair over ground cuts something')
  for (const cut of cuts.values()) assert.equal(cut.finish, cladding, 'the cut does not carry the piece’s finish')
  // The cap is the shaved plane itself, and it wears the piece's finish where the block has
  // none of its own — while the block's own sides keep the ground's.
  const cell = { x: 5, y: 0, z: 1 }
  const k = packKey(cell.x, cell.y, cell.z)
  const groundFinish = 'floor.granite'
  const solid = buildSolidSet([{ ...cell, fill: 'solid' }])
  const sides = new Map([[k, { bottom: groundFinish, e: groundFinish, w: groundFinish, n: groundFinish, s: groundFinish }]])
  const chunk = meshChunk(solid, sides, 0, 0, cell.z, cell.z, new Set([k]), undefined, undefined, undefined, cuts)
  const cap = chunk.parts.find((p) => p.finish === cladding)
  const flanks = chunk.parts.find((p) => p.finish === groundFinish)
  assert.ok(cap !== undefined, 'the cap is not drawn in the stair’s finish')
  assert.ok(flanks !== undefined, 'the block’s own sides lost the ground’s finish')
  const cut = cuts.get(k)
  assert.notEqual(cut, undefined)
  const along = cut.axis === 'x' ? (p) => p[0] - cell.x : (p) => p[1] - cell.y
  for (let i = 0; i < cap.positions.length; i += 3) {
    const p = [cap.positions[i], cap.positions[i + 1], cap.positions[i + 2]]
    const plane = cell.z + cut.lo + (cut.hi - cut.lo) * along(p)
    assert.ok(Math.abs(p[2] - plane) < 1e-6, `a cap vertex at ${p} is not on the cut plane ${plane}`)
  }
  // A top face the player painted themselves always wins over the piece's own finish.
  const paintedTop = new Map([[k, { ...sides.get(k), top: groundFinish }]])
  const kept = meshChunk(solid, paintedTop, 0, 0, cell.z, cell.z, new Set([k]), undefined, undefined, undefined, cuts)
  assert.equal(kept.parts.find((p) => p.finish === cladding), undefined, 'the stair painted over the player’s own cap')
  assert.ok(kept.parts.find((p) => p.finish === groundFinish) !== undefined, 'the player’s cap went missing')
  // An unpainted stair leaves the ground alone: no finish on its cut.
  for (const cut of rampSlopeCuts([stair()]).values()) assert.equal(cut.finish, undefined, 'an unpainted stair paints the ground under it')
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

test('a slid flight cuts every block its band covers, not only the one its line is named for', () => {
  // A **block-grid switchback** (`stairFlightSlides`) stands its runs half a block off
  // their landing cells, so each flight's walking line runs exactly along a **block
  // boundary** and its band is two blocks wide. The line's own column is the cell the
  // tile is named for; the ground the run owns is the *pair* the line divides — the same
  // pair the carve opens (`within`'s core test) and the pair `rampBodyBoxes` keeps
  // equipment out of. Cutting only the named column left the band's second block standing
  // inside the flight's soffit: up to the body's own drop of ground through the treads.
  const st = { name: 't', seed: 1, cells: [], modules: [], lines: [] }
  const m = createModule('stair-right180', 0, 0, -4, 't', 0, STAIR_WIDTH_DOUBLE, 'up', 'lane', st)
  assert.ok(m && m.type === 'stair')
  assert.equal(m.cfg.width, 1.79, 'a 中 双跑楼梯 stands on the block grid')
  const cuts = rampSlopeCuts([m])
  const columns = new Set()
  for (const k of cuts.keys()) {
    const [x, y] = unpack(k)
    columns.add(`${x},${y}`)
  }
  // Each flight's band covers two whole blocks: x 0–1 for the run that climbs y, x 2–3
  // for the return. Both blocks of each are cut.
  for (const x of [0, 1, 2, 3]) {
    assert.ok(
      [...columns].some((c) => c.startsWith(`${x},`)),
      `the band's block x=${x} was never cut (columns: ${[...columns].sort().join(' ')})`,
    )
  }
})

test('a run’s collision body hangs as deep as the body it draws, not one shared depth', () => {
  // `rampBodyBoxes` is what keeps flat equipment out of a run's space (`placement.ts`
  // `collisionBoxes`), so it has to be the **drawn** body: an escalator's truss by
  // `RAMP_FOOT`, a stair's stringers and soffit by `STAIR_BODY_DROP`. Reserving a stair at a
  // truss's depth kept a bench or a 围栏 out of a 0.29 m band the stair's own model leaves
  // clear. One box per swept tile, so each box is read against its **own** line at the
  // tile's downhill edge — the `lo` `flightBodyBoxes` takes — and the shared clearance is
  // taken from the escalator's own box rather than restated here.
  assert.ok(STAIR_BODY_DROP < RAMP_FOOT, 'a stair must hang less deep than an escalator’s truss')
  /** The line a box is measured from: its tile's own downhill edge. */
  const loOf = (run, at, b) => {
    const alongX = run.from.y === run.to.y
    const mid = alongX ? (b.y0 + b.y1) / 2 : (b.x0 + b.x1) / 2
    const ends = alongX ? [b.x0, b.x1] : [b.y0, b.y1]
    return Math.min(...ends.map((u) => (alongX ? at(run, u, mid) : at(run, mid, u))))
  }
  const esc = escalator()
  const clear = loOf(esc, line, rampBodyBoxes(esc)[0]) - RAMP_FOOT - rampBodyBoxes(esc)[0].z0
  assert.ok(clear > 0 && clear < 0.5, `the clearance read off the truss box is ${clear}`)

  const run = stair()
  const boxes = rampBodyBoxes(run)
  assert.ok(boxes.length > 0, 'a stair reserves nothing')
  for (const b of boxes) {
    const lo = loOf(run, bodyLine, b)
    assert.ok(
      Math.abs(b.z0 - (lo - STAIR_BODY_DROP - clear)) < 1e-9,
      `the box at ${b.x0},${b.y0} starts at ${b.z0.toFixed(3)}: its drawn body's underside is ${(lo - STAIR_BODY_DROP - clear).toFixed(3)}`,
    )
    // And it is not the truss's depth, which is the other 0.14 m of a stair's own treads.
    assert.ok(
      Math.abs(b.z0 - (lo - RAMP_FOOT - clear)) > 0.1,
      'the stair was reserved at an escalator’s truss depth',
    )
  }
})

test('a stair never cuts the ground below its base plane', () => {
  // The bug this pins, seen on the demo station's exit stair: the block directly under the base
  // came out a **tilted wedge**. A stair's body line is steeper than its run — its treads stop
  // `stairTreadTrim` short of the landing but carry the whole rise — so where the flight leaves
  // its landing the soffit already hangs *below* the floor the piece stands on, and the ground
  // under that floor was shaved to it, dipping under the slab beside it. That block is a floor
  // block: it has to stay whole and level with the floor it continues, and the rule is the
  // general one — a 楼梯 takes ground at or above its base plane (`SlopeCut.base`) and never below.
  const run = stair()
  const base = baseOf(run)
  const floor = []
  for (let x = 0; x <= 8; x++) for (let y = -1; y <= 1; y++) floor.push({ x, y, z: 0, fill: 'solid' })
  const cuts = rampSlopeCuts([run])
  const solid = buildSolidSet(floor)

  // Every cell of the base course is a floor block at the plane the piece stands on: the base
  // column (its landing) is not cut at all, and where the clamp reaches the ceiling the mesher
  // leaves a level top rather than a lid tilted below the floor. What is checked is the **cap** —
  // the surface a run leaves behind — never the block's own floor and walls.
  const baseB = meshCells(floor, solid, cuts, undefined)
  for (const x of [4, 5, 6, 7]) {
    const drawn = baseB.filter((p) => p[0] >= x - 1e-9 && p[0] <= x + 1 + 1e-9 && p[1] >= -1e-9 && p[1] <= 1 + 1e-9)
    assert.ok(drawn.length > 0, `nothing is drawn over the floor at x=${x}`)
    const top = Math.max(...drawn.map((p) => p[2]))
    assert.ok(Math.abs(top - base) < 1e-9, `the floor at x=${x} does not end level at the base plane: ${top}`)
    for (const [px, py, pz] of drawn) {
      if (pz <= base + 1e-9) continue
      assert.ok(onCutCap(cuts, px, py, pz), `the floor at x=${x} carries a surface at ${pz} that is neither whole nor a shaved cap`)
    }
  }
  // A cell further along is *not* level: give the ground the second course the run climbs over
  // and the shave comes back — its plane is clear of the base there, so it is cut to the run's
  // slope rather than held. The clamp is a floor, not a flattening of the whole flight.
  const deep = floor.concat(floor.map((c) => ({ ...c, z: 1 })))
  const lifted = meshCells(deep, buildSolidSet(deep), cuts, undefined)
  assert.ok(
    lifted.some((p) => p[2] > base + 0.2),
    'the stair no longer shaves anything above its base plane',
  )
  // The clamp is not a licence to leave the flight buried: the run's body is still shaved above
  // the plane, so the filling under the treads still climbs with them.
  const highest = Math.max(...[...cuts.entries()].map(([k, cut]) => unpack(k)[2] + Math.max(cut.lo, cut.hi)))
  assert.ok(highest > base + 0.3, `the stair no longer shaves anything above its base plane (highest ${highest})`)
})

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
  // One straight flight, so the whole stair's body is one `from`→`to` line — `RAMP_FOOT`
  // under it for the escalator, `STAIR_BODY_DROP` for a stair, each its own drawn body.
  //
  // A **cut** vertex is the one this bounds. A block the base clamp has left whole
  // (`SlopeCut.base`) is not a shave at all: it reaches its own ceiling, which sits *above*
  // the plane the piece stands on and may well sit above the soffit that hangs under it —
  // that is the base block the floor the stair is founded on continues, and the stair's own
  // treads and risers are what fills that corner.
  const flight = stair.cfg.flights[0]
  const base = flight.from.z + 1
  const cases = [
    { label: 'escalator', runs: [escalator()], drop: RAMP_FOOT, at: line, base: undefined },
    { label: 'stair', runs: [stair], drop: STAIR_BODY_DROP, at: bodyLine, base },
  ]
  for (const { label, runs, drop, at, base: basePlane } of cases) {
    const cuts = rampSlopeCuts(runs)
    assert.ok(cuts.size > 0, 'a run over ground cuts something')
    let checked = 0
    let held = 0
    for (const [k, cut] of cuts) {
      const [x, y, z] = unpack(k)
      for (const [vx, vy, vz] of mesh({ x, y, z }, cuts)) {
        if (!onCutCap(cuts, vx, vy, vz)) continue
        // The cap is the run's own plane **folded up to the base plane** it stands on: never
        // under the floor the piece is founded on, never over the body it hangs from. Its fan
        // hub is the *mean* of the folded rim, so it is bounded by that fold rather than equal
        // to it. Where the soffit has dipped below that floor — the first column or two past
        // the landing — the fold is the base plane itself, which is the floor block the stair
        // is founded on, and the treads and risers fill that corner above it.
        const bounds = capBoundsAt(cuts, vx, vy, vz)
        assert.ok(bounds.length > 0, `${label}: a cap vertex at ${vx},${vy},${vz} is outside every folded plane`)
        if (cut.base !== undefined && Math.min(cut.lo, cut.hi) <= cut.base + 1e-9) {
          held++
          continue
        }
        checked++
        // Never over the run's own plane: it is what the flight hangs from, and the fold only
        // ever raises the ground to the floor plane — where the soffit has dipped *under* that
        // floor the stair's own treads and risers are what fills the corner, not the cut.
        const top = Math.min(1, Math.max(cut.base ?? -Infinity, Math.max(cut.lo, cut.hi)))
        assert.ok(vz <= z + top + 1e-6, `${label}: a vertex at ${vx},${vy},${vz} is over the run’s own plane ${z + top}`)
        if (basePlane === undefined) {
          const body = at(runs[0], vx, vy) - drop
          assert.ok(vz <= body + 1e-6, `${label}: a vertex at ${vx},${vy},${vz} reaches into the run at ${body}`)
        } else {
          assert.ok(vz >= basePlane - 1e-9, `${label}: the ground at ${vx},${vy} is cut under the base plane`)
        }
      }
    }
    assert.ok(checked > 0, `${label}: no shaved vertex was checked at all`)
    if (basePlane !== undefined) assert.ok(held > 0, 'the stair no longer fills the corner under its base plane')
  }
})

test('the cut carries the drawn body’s width where it is narrower than the cell', () => {
  // An escalator's body is its truss box, so the filling under it is drawn as that box
  // rather than as a block of the cell. A stair's treads run out to the cell edge, so its
  // cut stays cell-wide and its filling keeps the ground's own shape.
  const esc = escalator()
  for (const cut of rampSlopeCuts([esc]).values()) {
    assert.equal(cut.half, ESCALATOR_BALUSTRADE / 2, 'an escalator cut must carry its truss half-width')
  }
  const stair = createModule('stair-straight', 0, 0, -4, 's1', 0, undefined)
  assert.ok(stair && stair.type === 'stair')
  for (const cut of rampSlopeCuts([stair]).values()) {
    assert.equal(cut.half, undefined, 'a stair cut must stay cell-wide')
  }
})

test('a block out of the run’s reach is meshed exactly as it always was', () => {
  const cell = { x: 4, y: 0, z: 5 }
  const plain = mesh(cell, undefined)
  const withCuts = mesh(cell, rampSlopeCuts([escalator()]))
  assert.deepEqual(withCuts, plain, 'the cut map must not touch a block it does not name')
  assert.ok(Math.abs(Math.max(...plain.map((p) => p[2])) - 6) < 1e-6, 'an uncut block still fills its cell')
})

/* -------------------------------------- the filling no block has to cover */

test('a packed key steps one block down by subtracting one', () => {
  // `rampFillKeys` reads the block under a cut cell as `key - 1`: `packKey`'s z term
  // is the last one it adds, so the step holds for every coordinate a station can
  // use. If it ever stopped holding, a filling would stand on the wrong block.
  for (const [x, y, z] of [[0, 0, 0], [5, 0, 1], [-3, 7, -8], [4095, -4095, 4095], [-4096, 4096, -4096]]) {
    assert.equal(packKey(x, y, z - 1), packKey(x, y, z) - 1, `packKey(${x}, ${y}, ${z}) does not step down by one`)
  }
})

test('a stair derives no filling: it hangs over its own well and leans on the ground it has', () => {
  // The mass a filling would stand in under a stair is the run's own **carved passage** — the
  // cell its treads sweep, a block-sized space no block fits in and no 材质 brush can register
  // on. So a stair asks for none: `rampFillKeys` derives nothing over it, and what is left
  // under the flight is the ground it really meets — the block below the first step, shaved to
  // the run's underside — or the open well it hangs over.
  const run = stair()
  const floor = []
  for (let x = 0; x <= 8; x++) for (let y = -1; y <= 1; y++) floor.push({ x, y, z: 0, fill: 'solid' })
  const solid = buildSolidSet(floor)
  const cuts = rampSlopeCuts([run])
  assert.ok(cuts.size > 0, 'the stair no longer shaves the ground it climbs over')
  for (const cut of cuts.values()) {
    assert.equal(cut.noFill, true, 'a stair cut does not say it leaves its ground alone')
    assert.equal(cut.ownBody, undefined, 'a stair cut is not the escalator case')
  }
  assert.equal(rampFillKeys(solid, cuts).size, 0, 'the stair derives a filling under its own passage')
  const lifted = meshCells(floor.concat(floor.map((c) => ({ ...c, z: 1 }))), buildSolidSet(floor.concat(floor.map((c) => ({ ...c, z: 1 })))), cuts, undefined)
  // The ground it has is still shaved to its own body line: the block under the flight ends on
  // the treads' line, `STAIR_BODY_DROP` under it, wherever that line is inside the block *and
  // at or above the base plane* the piece stands on (`SlopeCut.base`) — a cell the flight
  // leaves its landing on is held at that plane, which is the base block this rule protects.
  const base = baseOf(run)
  const shaved = [...cuts.entries()]
    .map(([k, cut]) => [unpack(k), cut])
    .filter(([[x, y, z], cut]) => z === 0 && y === 0 && x >= 0 && x <= 8 && z + Math.max(cut.lo, cut.hi) > base + 0.2)
    .sort((a, b) => a[0][0] - b[0][0])[0]
  assert.ok(shaved !== undefined, 'the stair shaved none of the floor it stands on')
  const [[x, y, z], cut] = shaved
  const ceiling = 1
  assert.ok(
    lifted.some((p) => Math.abs(p[2] - ceiling) < 1e-6) && lifted.some((p) => p[2] < ceiling - 1e-6),
    'the floor under the flight was not shaved at all',
  )
  // The block under the treads is a wedge: its top is the run's underside at both of its own
  // edges, and it is the ground's own cell — the shave never leaves the plane it was given.
  for (const t of [0, 1]) {
    const at = z + cut.lo + (cut.hi - cut.lo) * t
    assert.ok(lifted.some((p) => Math.abs(p[2] - at) < 1e-6), `no vertex is on the run’s plane at ${at}`)
  }
  // And the cell the flight leaves its landing on — the one carrying the base plane beside the
  // shave — is held there, level with the floor it continues rather than a wedge dipping under it.
  const baseCell = [...cuts.entries()]
    .map(([k, c]) => [unpack(k), c])
    .filter(([[bx, by, bz], c]) => bz === z && by === y && c.base !== undefined && Math.abs(bx - x) <= 1)
    .map(([, c]) => c)[0]
  assert.ok(baseCell !== undefined, 'no cell beside the shave carries the base plane the stair stands on')
  assert.ok(
    lifted.some((p) => Math.abs(p[2] - (z + baseCell.base)) < 1e-6),
    'the base block was not held at the plane the stair stands on',
  )
  // Nothing is drawn in the run's own carved passage: the cells it crosses hold air.
  const passage = [...cuts.keys()].map((k) => unpack(k)).filter((c) => c[2] === 1)
  assert.ok(passage.length > 0, 'the stair cut nothing above its own floor')
  const above = meshCells(floor, solid, cuts, undefined).filter((p) => p[2] > ceiling + 1e-6)
  assert.deepEqual(above, [], 'a mass was drawn in the stair’s own passage')
})

test('a 扶梯 derives no filling: its own piece draws that body', () => {
  // Two bodies in one cell are two coplanar faces, one meshed from the ground's kit and one from
  // the model's, and the pair flickers. So the cut an escalator leaves is still shaved ground —
  // the piece's undercroft is cut to that very plane — but nothing is *filled* over it: the piece
  // stands there (`EscalatorModel.undercroftSolid`, pinned against the truss in `module-build`).
  const run = escalator()
  const floor = []
  for (let x = 0; x <= 8; x++) for (let y = -1; y <= 1; y++) floor.push({ x, y, z: 0, fill: 'solid' })
  const solid = buildSolidSet(floor)
  const cuts = rampSlopeCuts([run])
  assert.ok(cuts.size > 0, 'the escalator no longer shaves the ground it climbs over')
  assert.equal(rampFillKeys(solid, cuts).size, 0, 'the escalator derives a filling its piece already draws')
  for (const cut of cuts.values()) assert.equal(cut.ownBody, true, 'the cut does not say its piece draws the body')
})
