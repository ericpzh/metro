import test from 'node:test'
import assert from 'node:assert/strict'
import { blockReason } from '../src/sim/placement.ts'
import { blockIndex } from '../src/sim/blockIndex.ts'
import { rampSurfaceRetainsVolume } from '../src/sim/rampSurface.ts'
import { rampSlopeCuts, carveRampOpenings, rampOpeningAt, rampThinCells } from '../src/sim/openings.ts'
import { checkBlockCells } from '../src/build/validation.ts'
import { addCells } from '../src/build/model/Cells.ts'
import { createModule } from '../src/build/model.ts'
import { packKey } from '../src/sim/types.ts'

// Minimal run extracted from 天河公园.metro (10).json; no dependency on Downloads.
const stair = {
  id: 'stair-straight-135', type: 'stair', x: 83, y: -102, z: -20, rot: 3,
  from: { x: 83, y: -102, z: -20 }, to: { x: 60, y: -102, z: -5 },
  cfg: { width: 2.04, style: 'straight', flights: [{ from: { x: 83, y: -102, z: -20 }, to: { x: 60, y: -102, z: -5 } }] }, storeyHeight: 5,
}

test('Tianhe (77,-100,-16): preview, placement and carving retain the calculated stair wedge', () => {
  const cells = [], modules = [stair], target = [77, -100, -16]
  const cut = rampSlopeCuts(modules).get(packKey(...target))
  assert.ok(cut)
  assert.ok(Math.abs(cut.lo - 0.7309090909090905) < 1e-8)
  assert.ok(Math.abs(cut.hi - 0.04909090909091063) < 1e-8)
  assert.equal(blockReason(cells, modules, ...target).ok, true)
  const occupied = blockIndex(cells, modules)
  assert.equal(blockReason(cells, modules, ...target, occupied).ok, true)
  const preview = checkBlockCells({ cells, modules }, [target, [77, -100, -15]])
  assert.deepEqual(preview.acceptedCells, [target])
  assert.deepEqual(preview.blockedCells, [[77, -100, -15]])
  assert.strictEqual(checkBlockCells({ cells, modules }, [target, [77, -100, -15]]), preview)
  const placed = addCells(cells, [target], modules)
  assert.equal(placed.changed, 1)
  assert.equal(placed.blocked, 0)
  carveRampOpenings(placed.cells, modules)
  assert.ok(placed.cells.some(c => c.x === 77 && c.y === -100 && c.z === -16 && c.fill === 'solid'))
  assert.deepEqual(rampThinCells(placed.cells, modules), [], 'retained wide-stair lanes must not become side panels')
})

test('Tianhe (79,-100,-17): a multi-storey forward stair follows its soffit at an interior landing', () => {
  // The reported notch under a 中直跑楼梯's second storey: an interior landing is the
  // stair's own platform, not a placed floor, so the ground beside the flight has to
  // follow the sloped soffit down to the platform's fascia. It must not be held at the
  // platform's walking surface — that left a level shelf poking through the stair body
  // at the joint. The outer lower landing still carries the base plane (`SlopeCut.base`).
  const flights = [
    { from: { x: 84, y: -102, z: -20 }, to: { x: 80, y: -102, z: -17.5 } },
    { from: { x: 80, y: -102, z: -17.5 }, to: { x: 72, y: -102, z: -12.5 } },
    { from: { x: 72, y: -102, z: -12.5 }, to: { x: 64, y: -102, z: -7.5 } },
    { from: { x: 64, y: -102, z: -7.5 }, to: { x: 60, y: -102, z: -5 } },
  ]
  const forward = { id: 'forward', type: 'stair', x: 84, y: -102, z: -20, rot: 3, from: flights[0].from, to: flights.at(-1).to, cfg: { width: 2.79, style: 'centerForward', flights }, storeyHeight: 5 }
  const cuts = rampSlopeCuts([forward])
  const besideLanding = cuts.get(packKey(79, -100, -17))
  assert.ok(besideLanding, 'the block under the flight beside the interior landing is not cut')
  assert.equal(besideLanding.base, undefined, 'an interior landing held the ground at its own surface')
  // The plane at the landing-side edge (x=80) is the soffit, 0.86 m below the cell's
  // ceiling and below the landing surface (local 0.5) — no shelf at the joint.
  assert.ok(Math.abs(besideLanding.hi - 0.14) < 1e-9)
  assert.ok(besideLanding.hi < 0.5)
  assert.ok(besideLanding.lo > besideLanding.hi, 'the flight climbs away from the landing')
  // The flight standing on the stair's own bottom landing keeps the floor-level clamp.
  const base = cuts.get(packKey(83, -102, -20))
  assert.ok(base && base.base === 1, 'the outer base block is no longer held at the floor it continues')
})

test('each stair and escalator rotation allows underside wedges and refuses its empty passage', () => {
  for (const type of ['stair-straight', 'stair-right90', 'stair-right180', 'escalator']) {
    for (let rot = 0; rot < 4; rot++) for (const dir of type === 'escalator' ? ['up', 'down'] : ['up']) {
      const m = createModule(type, -10, -10, -5, 'run', rot, type === 'escalator' ? 3 : 2.04, dir)
      const modules = [m], cells = [], occupied = blockIndex(cells, modules)
      let checked = 0
      for (const [key, cut] of rampSlopeCuts(modules)) {
        if (!rampSurfaceRetainsVolume(cut.patches)) continue
        const z = key % 8192 - 4096, t = (key - z - 4096) / 8192
        const y = t % 8192 - 4096, x = (t - y - 4096) / 8192 - 4096
        assert.equal(rampOpeningAt(modules, x, y, z), false, `${type}/${rot}/${dir}: cut wedge refused`)
        assert.equal(occupied.opening(x, y, z), false)
        if (z === 0) continue // Intact street is implicit ground, not an authored cell.
        const placed = addCells(cells, [[x, y, z]], modules)
        assert.equal(placed.blocked, 0)
        carveRampOpenings(placed.cells, modules)
        assert.ok(placed.cells.some(c => c.x === x && c.y === y && c.z === z))
        checked++
      }
      assert.ok(checked > 0)
      const from = m.from.z < m.to.z ? m.from : m.to
      const to = m.from.z < m.to.z ? m.to : m.from
      // At least one actual passage cell remains reserved in the indexed path.
      let refused = false
      for (let x = Math.min(from.x, to.x); x <= Math.max(from.x, to.x); x++) {
        for (let y = Math.min(from.y, to.y); y <= Math.max(from.y, to.y); y++) {
          for (let z = from.z; z <= to.z + 1; z++) if (occupied.opening(x, y, z)) refused = true
        }
      }
      assert.ok(refused, 'the slope allowance opened the entire passenger corridor to blocks')
    }
  }
})

test('retained volume requires area and handles zero, partial and intersecting patches', () => {
  const p = { axis: 'x', lo: -1, hi: -1, x0: 0, x1: 1, y0: 0, y1: 1 }
  assert.equal(rampSurfaceRetainsVolume([{ ...p, lo: 0, hi: 0 }]), false)
  assert.equal(rampSurfaceRetainsVolume([{ ...p, lo: -1, hi: 0 }]), false, 'a boundary face is not a block volume')
  assert.equal(rampSurfaceRetainsVolume([{ ...p, lo: -1, hi: 0.01 }]), true)
  assert.equal(rampSurfaceRetainsVolume([{ ...p, x1: 0.5 }]), true, 'ground outside the cut footprint survives')
  assert.equal(rampSurfaceRetainsVolume([{ ...p, lo: -1, hi: 1 }, { ...p, lo: 1, hi: -1 }]), false, 'two cuts can jointly consume the entire block')
  assert.equal(rampSurfaceRetainsVolume([{ ...p, base: 0.1 }]), true)
})

test('a wedge belonging to one run cannot excuse blocking a second run underneath', () => {
  const lower = { ...stair, id: 'lower', z: -22, from: { ...stair.from, z: -22 }, to: { ...stair.to, z: -7 }, cfg: { ...stair.cfg, flights: [{ from: { ...stair.from, z: -22 }, to: { ...stair.to, z: -7 } }] } }
  for (const modules of [[stair, lower], [lower, stair]]) {
    assert.equal(blockReason([], modules, 77, -100, -16).reason, 'opening')
    assert.equal(blockIndex([], modules).opening(77, -100, -16), true)
  }
})
