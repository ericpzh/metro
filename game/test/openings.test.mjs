// Ramps vs solid ground, and the escalator capacity model.
//
// GAME-SPEC §5.4: a placed ramp carves the floor it climbs through, but the
// landing cells stay because the station graph uses them as the ramp's nodes.
// §7.8: an escalator is single-direction, one passenger per step.
import test from 'node:test'
import assert from 'node:assert/strict'
import { carveRampOpenings, rampBlocked, rampCorridorHalf, rampThinCells, OPENING_CEILING } from '../src/sim/openings.ts'
import { reservedOpening } from '../src/sim/placement.ts'
import { EXIT_BAY_HALF } from '../src/sim/exits.ts'
import { STAIR_WIDTH_NARROW } from '../src/sim/stairs.ts'
import { createModule } from '../src/build/model.ts'
import { scenarioStation } from './support/scenario-station.ts'
import { ESCALATOR_RATE, ESCALATOR_SPEED, ESCALATOR_STEP_PITCH } from '../src/sim/constants.ts'

test('a ramp carves the slab it climbs through, but keeps its landings', () => {
  const cells = []
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) cells.push({ x, y, z: 0, fill: 'solid' })
  const ramp = {
    id: 'e',
    type: 'escalator',
    x: 1,
    y: 0,
    z: 0,
    from: { x: 1, y: 0, z: 0 },
    to: { x: 1, y: 3, z: -2 },
    cfg: { dir: 'down' },
  }
  const removed = carveRampOpenings(cells, [ramp])
  assert.ok(removed > 0, 'the slab the ramp passes through is carved')
  assert.ok(cells.some((c) => c.x === 1 && c.y === 0 && c.z === 0), 'the landing cell is kept')
  assert.ok(!cells.some((c) => c.x === 1 && c.y === 1 && c.z === 0), 'the cell beside the landing is open')
})

test('only the run body is carved; a block the handrail grazes is kept', () => {
  // A run along +y through the middle column. The escalator's body is 0.9 m
  // wide (half 0.45 m), so the columns either side are only grazed by the
  // handrail. They are kept — a floor edge may be touched by the rail — and the
  // true opening stays one cell wide.
  const cells = []
  for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) cells.push({ x, y, z: 0, fill: 'solid' })
  const ramp = {
    id: 'e',
    type: 'escalator',
    x: 2,
    y: 0,
    z: 0,
    from: { x: 2, y: 0, z: 0 },
    to: { x: 2, y: 4, z: -2 },
    cfg: { dir: 'down' },
  }
  carveRampOpenings(cells, [ramp])
  const has = (x, y) => cells.some((c) => c.x === x && c.y === y && c.z === 0)
  assert.ok(!has(2, 2), 'the run itself is open')
  assert.ok(has(1, 2) && has(3, 2), 'the columns the handrail merely grazes are kept')
  assert.ok(has(0, 2) && has(4, 2), 'the blocks beyond the handrail are kept')
  assert.ok(has(2, 0), 'the landing is still kept')
})

test('a wall beside a run is kept whole: the run fits inside its own cell', () => {
  // The escalator is 0.98 m overall, handrails included, so its rail stops a
  // centimetre inside the cell. A wall in the next column is neither carved nor
  // reached — it stays a full block, and the floor beside a run stays buildable.
  const cells = []
  for (let x = 0; x < 3; x++) {
    for (let y = 0; y < 5; y++) {
      cells.push({ x, y, z: 0, fill: 'solid', tags: x === 2 ? ['auto-wall'] : ['auto-floor'] })
    }
  }
  const ramp = {
    id: 'e',
    type: 'escalator',
    x: 1,
    y: 0,
    z: 0,
    from: { x: 1, y: 0, z: 0 },
    to: { x: 1, y: 4, z: -2 },
    cfg: { dir: 'down' },
  }
  carveRampOpenings(cells, [ramp])
  assert.ok(cells.some((c) => c.x === 2 && c.y === 2 && c.z === 0), 'the wall beside the run survives the carve')
  assert.equal(rampThinCells(cells, [ramp]).length, 0, 'nothing beside a run is reached any more')
})

test('a wall a wide stair reaches is still kept and marked for a half panel', () => {
  // A 1.6 m stair is wider than a cell, so its body and handrail genuinely cross
  // into the column beside it: that wall is not carved (the rail is allowed to
  // touch it) and is drawn half a metre thick instead.
  const cells = []
  for (let x = 0; x < 3; x++) {
    for (let y = 0; y < 5; y++) {
      cells.push({ x, y, z: 0, fill: 'solid', tags: x === 2 ? ['auto-wall'] : ['auto-floor'] })
    }
  }
  // A wide stair descending along +y through the z = 0 slab.
  const stair = createModule('stair-straight', 1, 4, -2, 's', 2, 1.6)
  assert.ok(stair)
  carveRampOpenings(cells, [stair])
  assert.ok(cells.some((c) => c.x === 2 && c.y === 2 && c.z === 0), 'the wall beside the run survives the carve')
  const thins = rampThinCells(cells, [stair])
  const at = thins.find((t) => t.x === 2 && t.y === 2 && t.z === 0)
  assert.ok(at, 'the wall is marked for thinning')
  assert.equal(at.kind, 'wall')
  assert.deepEqual(at.side, [1, 0], 'the panel sits on the side away from the run')
})

test('a wide stair keeps its side floor cells and marks them as half blocks', () => {
  // A 1.6 m stair reaches 0.3 m into each neighbouring column: those floor
  // blocks survive the carve (only the run's own cell is opened) and are thinned
  // to the far half so the stair fits. This is what fills the floor at the top.
  // A lower slab at z=-4, an upper slab at z=0; the stair climbs from the lower
  // to the upper along +y and punches through the upper slab near its top.
  const cells = []
  for (let x = -1; x <= 1; x++) {
    for (let y = 0; y <= 8; y++) {
      cells.push({ x, y, z: -4, fill: 'solid', tags: ['auto-floor'] })
      cells.push({ x, y, z: 0, fill: 'solid', tags: ['auto-floor'] })
    }
  }
  const stair = createModule('stair-straight', 0, 0, -4, 's', 0, 1.6)
  assert.ok(stair)
  carveRampOpenings(cells, [stair])
  const has = (x, y) => cells.some((c) => c.x === x && c.y === y && c.z === 0)
  assert.ok(!has(0, 4), 'the run cell at the top is carved')
  assert.ok(has(-1, 4) && has(1, 4), 'the side floor cells survive the carve')
  const thins = rampThinCells(cells, [stair])
  const side = thins.find((t) => t.x === 1 && t.y === 4)
  assert.ok(side, 'the side floor is marked for a half block')
  assert.equal(side.kind, 'floor')
  assert.deepEqual(side.side, [1, 0])
})

test('a run that lands on a floor does not carve the slab above it', () => {
  // The old 3.2 m escalator headroom reached the roof over the landing and
  // punched a hole in a slab the run never meets. A run opens the floor it
  // climbs through, not the storey above the room it lands in.
  const cells = []
  for (let y = 0; y <= 8; y++) {
    cells.push({ x: 0, y, z: 0, fill: 'solid' }) // lower floor
    cells.push({ x: 0, y, z: 4, fill: 'solid' }) // the floor the run lands on
    cells.push({ x: 0, y, z: 8, fill: 'solid' }) // the roof over that floor
  }
  const run = {
    id: 'e',
    type: 'escalator',
    x: 0,
    y: 0,
    z: 0,
    from: { x: 0, y: 0, z: 0 },
    to: { x: 0, y: 6, z: 4 },
    cfg: { dir: 'up' },
  }
  carveRampOpenings(cells, [run])
  const cell = (y, z) => cells.find((c) => c.x === 0 && c.y === y && c.z === z)
  assert.ok(!cell(3, 4), 'the floor the run climbs through is opened')
  assert.ok(cell(6, 4), 'the landing is kept')
  assert.ok(cell(6, 8), 'the roof above the landing must survive the carve')
  assert.ok(cell(3, 8)?.tags?.includes(OPENING_CEILING), 'the orphan over an opening is tagged as its ceiling')
})

test('the reference station has no holes in its gate floor or concourse roof', () => {
  const d = scenarioStation()
  const solid = new Set(d.cells.filter((c) => c.fill === 'solid').map((c) => `${c.x},${c.y},${c.z}`))
  // The gate row is floor, not a gap: the fare line is a zone boundary in the
  // graph, so the gates stay the only legal crossing.
  for (let x = -7; x <= 7; x++) assert.ok(solid.has(`${x},12,-4`), `gate-row floor missing at ${x}`)
  // The roof over the hall is whole — the old over-carve punched it above the
  // platform escalators, leaving orphaned blocks floating over the concourse.
  for (let x = -8; x <= 8; x++) {
    for (let y = -1; y <= 23; y++) assert.ok(solid.has(`${x},${y},0`), `concourse roof hole at ${x},${y}`)
  }
})

test('the exit floor leaves the runs their handrail clearance', () => {
  // The exit's drawn floor strips flank the two runs; they must stand off far
  // enough that the balustrade and handrail never surface through them.
  const esc = createModule('escalator', 0, 0, 0, 'e', 0)
  const stair = createModule('stair-straight', 0, 0, 0, 's', 0, STAIR_WIDTH_NARROW)
  assert.ok(esc && stair)
  assert.ok(EXIT_BAY_HALF >= rampCorridorHalf(esc), 'the exit bay must clear an escalator handrail')
  assert.ok(EXIT_BAY_HALF >= rampCorridorHalf(stair), 'the exit bay must clear a narrow stair handrail')
})

test('every cell a ramp carve opens is reserved against a hand-built block', () => {
  // The block brush's guard must agree with the carve exactly: any cell the
  // carve removes has to be refused if a player tries to lay it back.
  const cells = []
  for (let x = -1; x <= 1; x++) {
    for (let y = 0; y <= 6; y++) {
      for (let z = -2; z <= 2; z++) cells.push({ x, y, z, fill: 'solid' })
    }
  }
  const r = {
    id: 'e',
    type: 'escalator',
    x: 0,
    y: 0,
    z: 0,
    from: { x: 0, y: 0, z: 0 },
    to: { x: 0, y: 6, z: -4 },
    cfg: { dir: 'down' },
  }
  const before = cells.map((c) => `${c.x},${c.y},${c.z}`)
  carveRampOpenings(cells, [r])
  const after = new Set(cells.map((c) => `${c.x},${c.y},${c.z}`))
  let opened = 0
  for (const k of before) {
    if (after.has(k)) continue
    const [x, y, z] = k.split(',').map(Number)
    assert.ok(reservedOpening([r], x, y, z), `${k} was carved but reads as buildable`)
    opened++
  }
  assert.ok(opened > 0, 'the carve actually opened cells')
})

test('the reference station keeps every ramp landing node', () => {
  const d = scenarioStation()
  const has = new Set(d.cells.map((c) => `${c.x},${c.y},${c.z}`))
  let ramps = 0
  for (const m of d.modules) {
    if (m.type !== 'escalator' && m.type !== 'stair' && m.type !== 'lift') continue
    ramps++
    assert.ok(has.has(`${m.from.x},${m.from.y},${m.from.z}`), `from landing missing for ${m.id}`)
    assert.ok(has.has(`${m.to.x},${m.to.y},${m.to.z}`), `to landing missing for ${m.id}`)
  }
  assert.ok(ramps > 0)
})

test('an escalator runs one passenger per step at 75/min', () => {
  assert.equal(ESCALATOR_RATE, ESCALATOR_SPEED / ESCALATOR_STEP_PITCH)
  assert.ok(Math.abs(ESCALATOR_RATE * 60 - 75) < 0.01, `expected 75/min, got ${ESCALATOR_RATE * 60}`)
})

const ramp = (id, x, fromY, fromZ, toY, toZ) => ({
  id,
  type: 'escalator',
  x,
  y: fromY,
  z: fromZ,
  from: { x, y: fromY, z: fromZ },
  to: { x, y: toY, z: toZ },
  cfg: { dir: fromZ > toZ ? 'down' : 'up' },
})

test('a ramp directly below another is blocked; a ramp in the next column is not', () => {
  const down = ramp('down', -4, 28, 0, 21, -4)
  const stacked = ramp('stacked', -4, 22, -4, 29, 0) // same column, overlapping y/z
  const beside = ramp('beside', -2, 28, 0, 21, -4) // next column over
  assert.ok(rampBlocked([down], stacked), 'a ramp placed below must be rejected')
  assert.ok(!rampBlocked([down], beside), 'a ramp in the next column is fine')
})

test('no two ramps in the reference station overlap', () => {
  const ramps = scenarioStation().modules.filter((m) => m.type === 'escalator' || m.type === 'stair' || m.type === 'lift')
  assert.ok(ramps.length > 0)
  for (let i = 0; i < ramps.length; i++) {
    for (let j = i + 1; j < ramps.length; j++) {
      assert.ok(!rampBlocked([ramps[i]], ramps[j]), `${ramps[i].id} and ${ramps[j].id} overlap`)
    }
  }
})

test('every surface exit has an up escalator and a descending run under its roof', () => {
  const d = scenarioStation()
  const exits = d.modules.filter((m) => m.type === 'exit')
  assert.ok(exits.length > 0)
  for (const e of exits) {
    // A run whose surface landing (the higher end) lands within a bay-width of
    // the exit: its roof is what covers them. The west bay may be a stair.
    const near = d.modules.filter((m) => {
      if (m.type !== 'escalator' && m.type !== 'stair') return false
      const top = m.from.z >= m.to.z ? m.from : m.to
      return Math.hypot(top.x - e.x, top.y - e.y) <= 2.5
    })
    const down = near.some((m) => m.type === 'stair' || m.cfg.dir === 'down')
    assert.ok(down, `${e.id} has no descending run (escalator or stair) under its roof`)
    assert.ok(
      near.some((m) => m.type === 'escalator' && m.cfg.dir === 'up'),
      `${e.id} has no up escalator under its roof`,
    )
  }
})
