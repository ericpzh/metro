// Elevator plan size (电梯 大/小) — GAME-SPEC.md §5.1.
//
// The lift has always been a 2 × 2 m shaft. The 大/小 tile now also offers a
// 3 × 3 one: nine floor cells, a three-cell landing row on each face, and the
// same car centred in the larger plan. These tests pin the footprint, the
// support rule, the landing/graph geometry, the car position a rider is pinned
// to, the save round trip and the two catalogue/action contracts that expose it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { addEquipment, createModule, liftInColumn, toState } from '../src/build/model.ts'
import {
  LIFT_SIZE,
  LIFT_SIZE_LARGE,
  LIFT_STEP,
  liftExtendedUp,
  liftFootprintCells,
  liftLandingRows,
  liftLandingSide,
  liftModule,
  liftSizeLabel,
  liftSizeOf,
  nextLiftSize,
} from '../src/sim/lifts.ts'
import { buildGraph, EDGE_KIND } from '../src/sim/station.ts'
import { equipmentReason, liftAt, moduleEnvelope, placementBlocked } from '../src/sim/placement.ts'
import { World } from '../src/sim/world.ts'
import { serialize, parse } from '../src/persistence/save.ts'
import { emptyStation } from '../src/data/reference-station.ts'
import { moduleBuilderAttributes } from '../src/app/store/builderAttributes.ts'
import { placementPreviewKey, useStore } from '../src/app/store.ts'
import { moduleGhostKey } from '../src/render/moduleGhostKey.ts'

/** Floors at every storey the tests reach, so a lift has a landing each end. */
function floors(levels = [0, LIFT_STEP], x1 = 6, y1 = 6) {
  const cells = []
  for (let x = 0; x <= x1; x++) {
    for (let y = 0; y <= y1; y++) {
      for (const z of levels) cells.push({ x, y, z, fill: 'solid' })
    }
  }
  return cells
}

const key = (p) => `${p.x},${p.y},${p.z}`

const largeAt = (x = 2, y = 2, z = 0) => liftModule({ x, y, z }, 0, 'lift-large', LIFT_STEP, LIFT_SIZE_LARGE)
const largeTwoStorey = () => liftExtendedUp(largeAt(), LIFT_STEP)

function edgeKind(g, a, b) {
  for (let e = g.adjStart[a]; e < g.adjStart[a + 1]; e++) if (g.adjTo[e] === b) return g.adjKind[e]
  return -1
}

test('the 大 lift is a 3 × 3 footprint, stores its size, and the 小 lift stays the old 2 × 2 piece', () => {
  const small = liftModule({ x: 2, y: 2, z: 0 }, 0, 'small')
  const large = largeAt()
  assert.equal(liftSizeOf(small), LIFT_SIZE)
  assert.equal(liftSizeOf(large), LIFT_SIZE_LARGE)
  assert.equal(small.cfg.size, undefined, 'a 小 lift keeps the config it has always saved')
  assert.equal(large.cfg.size, 3)
  assert.deepEqual(liftFootprintCells(small).sort(), [[2, 2], [2, 3], [3, 2], [3, 3]].sort())
  assert.deepEqual(
    liftFootprintCells(large).sort(),
    [
      [2, 2], [3, 2], [4, 2],
      [2, 3], [3, 3], [4, 3],
      [2, 4], [3, 4], [4, 4],
    ].sort(),
  )
  const env = moduleEnvelope(large)
  assert.equal(env.x1 - env.x0, 3)
  assert.equal(env.y1 - env.y0, 3)
  assert.equal(nextLiftSize(LIFT_SIZE), LIFT_SIZE_LARGE)
  assert.equal(nextLiftSize(LIFT_SIZE_LARGE), LIFT_SIZE)
  assert.equal(liftSizeLabel(LIFT_SIZE), '小')
  assert.equal(liftSizeLabel(LIFT_SIZE_LARGE), '大')
})

test('the 大 lift needs floor under all nine cells, not just the anchor', () => {
  const large = largeAt(2, 2, -5)
  const all = floors([-5, 0])
  assert.equal(equipmentReason(all, [], large), '', 'nine solid cells accept the 大 shaft')
  const hole = all.filter((c) => !(c.z === -5 && c.x === 4 && c.y === 4))
  assert.equal(equipmentReason(hole, [], large), 'lift-footprint', 'a missing far corner refuses it')
  assert.equal(equipmentReason(hole, [], liftModule({ x: 2, y: 2, z: -5 }, 0, 'small')), '', 'the 小 lift still fits the 2 × 2 corner')
})

test('a 大 lift reserves all nine plan cells against another shaft', () => {
  const large = largeAt()
  assert.equal(placementBlocked([large], { ...largeAt(), id: 'other' }), true)
  assert.equal(placementBlocked([large], liftModule({ x: 4, y: 4, z: 0 }, 0, 'corner')), true, 'the far corner is inside the 3 × 3')
  assert.equal(placementBlocked([large], liftModule({ x: 5, y: 2, z: 0 }, 0, 'beside')), false, 'the next bay is free')
})

test('a 大 storey opens a three-cell landing row on the face it serves', () => {
  const m = largeAt()
  assert.deepEqual(liftLandingRows(m, 0), [[[2, 1], [3, 1], [4, 1]]])
  const both = { ...m, cfg: { ...m.cfg, doors: { 0: 'both' } } }
  assert.deepEqual(liftLandingRows(both, 0), [
    [[2, 1], [3, 1], [4, 1]],
    [[2, 5], [3, 5], [4, 5]],
  ])
  for (const [x, y] of liftLandingRows(both, 0)[0]) assert.equal(liftLandingSide(both, x, y), 1)
  for (const [x, y] of liftLandingRows(both, 0)[1]) assert.equal(liftLandingSide(both, x, y), 2)
  const turned = { ...largeAt(), rot: 1 }
  assert.deepEqual(liftLandingRows(turned, 0), [[[5, 2], [5, 3], [5, 4]]], 'rot 1 opens east of the 3 × 3')
})

test('the 大 shaft keeps all nine cabin cells out of the walk graph and boards from its landing row', () => {
  const data = { name: 't', seed: 1, cells: floors(), modules: [largeTwoStorey()], lines: [] }
  const g = buildGraph(data)
  const s = g.servers.find((x) => x.kind === 'lift')
  assert.ok(s)
  assert.equal(s.lift.size, 3)
  for (let x = 2; x <= 4; x++) for (let y = 2; y <= 4; y++) {
    assert.equal(g.nodeIndex.get(`${x},${y},0`), undefined, `cabin cell ${x},${y} is not walkable`)
  }
  for (const x of [2, 3, 4]) assert.notEqual(g.nodeIndex.get(`${x},1,0`), undefined, 'every front landing cell is a doorway')
  assert.equal(s.lift.stops.length, 2)
  assert.equal(s.lift.stops[0], g.nodeIndex.get('2,1,0'))
  assert.equal(edgeKind(g, s.lift.stops[0], s.lift.stops[1]), EDGE_KIND.lift)
})

test('a rider is pinned inside the 大 car, centred on the 3 × 3 assembly', () => {
  const data = { name: 't', seed: 1, cells: floors(), modules: [largeTwoStorey()], lines: [] }
  const w = new World(data, 1)
  const g = w.graph
  const s = g.servers.find((x) => x.kind === 'lift')
  const bottom = g.nodeIndex.get('2,1,0')
  const top = g.nodeIndex.get('2,1,5')
  const a = w.pool.spawn({ origin: '', stops: [], dest: '' }, g.nodeX[bottom], g.nodeY[bottom], g.nodeZ[bottom], 0)
  a.state = 2
  a.server = s.id
  a.liftBoard = bottom
  a.liftDest = top
  s.queue.push(a.id)

  let sawAboard = false
  let stayedInCabin = true
  let releasedZ = null
  for (let i = 0; i < 160; i++) {
    w.tickOnce()
    if (a.liftServer >= 0 && a.liftPhase === 1) {
      sawAboard = true
      // Centre of a 3 × 3 anchor at (2, 2) is (3.5, 3.5); a slot is never
      // farther than ~0.7 m from it inside the 2.25 m carriage.
      if (Math.abs(a.x - 3.5) > 0.75 || Math.abs(a.y - 3.5) > 0.75) stayedInCabin = false
    }
    if (releasedZ === null && a.liftServer === -1 && a.liftBoard === -1) releasedZ = a.z
  }
  assert.ok(sawAboard, 'the passenger never boarded the 大 car')
  assert.ok(stayedInCabin, 'the passenger drifted out of the 大 cabin while riding')
  assert.notEqual(releasedZ, null, 'the passenger never got off')
  assert.ok(Math.abs(releasedZ - g.nodeZ[top]) < 0.05)
})

test('the 大/小 plan survives saving, and an older 小 save reads back as 2 × 2', () => {
  const large = toState({ ...emptyStation(), modules: [largeTwoStorey()] })
  const saved = parse(serialize(large))
  assert.ok(saved.ok)
  const lift = saved.state.modules[0]
  assert.equal(lift.cfg.size, 3)
  assert.equal(liftSizeOf(lift), 3)

  const old = parse(serialize(toState({ ...emptyStation(), modules: [liftModule({ x: 2, y: 2, z: 0 }, 0, 'old')] })))
  assert.ok(old.ok)
  assert.equal(old.state.modules[0].cfg.size, undefined)
  assert.equal(liftSizeOf(old.state.modules[0]), 2)
})

test('a pointer anywhere on the 3 × 3 plan finds the shaft, whichever column and storey', () => {
  const shaft = largeTwoStorey()
  for (const [x, y] of [[2, 2], [3, 4], [4, 2], [4, 4]]) assert.equal(liftAt([shaft], x, y, 0)?.id, shaft.id, `${x},${y}`)
  assert.equal(liftAt([shaft], 5, 2, 0), undefined, 'the next bay is not the shaft')
  assert.equal(liftAt([shaft], 3, 2, 2), shaft, 'a mid-shaft storey still targets the same car')
})

test('the 大/小 plan is in the preview and ghost identities, and a pick cancellation restores it', () => {
  const before = useStore.getState()
  try {
    useStore.setState({ moduleType: 'lift', liftSize: 2 })
    const smallKey = placementPreviewKey(useStore.getState())
    useStore.getState().cycleLiftSize()
    assert.equal(useStore.getState().liftSize, 3)
    assert.notEqual(placementPreviewKey(useStore.getState()), smallKey)
    useStore.getState().beginPick()
    useStore.getState().cycleLiftSize()
    useStore.getState().cancelPick()
    assert.equal(useStore.getState().liftSize, 3, 'cancel restores the size the pick stood on')
    useStore.getState().cycleLiftSize()
    assert.equal(useStore.getState().liftSize, 2)
  } finally {
    useStore.setState(before)
  }
  const small = liftModule({ x: 2, y: 2, z: 0 }, 0, 'small')
  const large = largeAt()
  assert.notEqual(moduleGhostKey(small), moduleGhostKey(large), 'the plan is in the ghost identity')
})

test('the production factory and the column lookup carry the 大 plan', () => {
  const large = createModule('lift', 2, 2, 0, 'factory-large', 0, undefined, 'up', 'lane', [], undefined, { liftSize: 3 })
  assert.ok(large && large.type === 'lift')
  assert.equal(liftSizeOf(large), 3)
  assert.deepEqual(liftFootprintCells(large), liftFootprintCells(largeAt()))
  assert.equal(liftInColumn([large], 4, 4)?.id, 'factory-large', 'the far corner is the same shaft')
  assert.equal(liftInColumn([large], 5, 4), undefined)
  const grown = liftExtendedUp(large, LIFT_STEP)
  assert.equal(liftSizeOf(grown), 3, 'extending keeps the plan')
  assert.deepEqual(liftFootprintCells(grown), liftFootprintCells(large))
  assert.equal(addEquipment(toState({ name: 't', seed: 1, cells: floors(), modules: [], lines: [] }), large).modules.length, 1)
})

test('the 大/小 action tile leads the lift card', () => {
  const state = useStore.getState()
  const attrs = moduleBuilderAttributes('lift', state)
  assert.deepEqual(attrs.map((a) => a.kind), ['rotation', 'size', 'length', 'style'])
  assert.deepEqual(attrs.map((a) => a.shortcut), ['R', 'Tab', 'Shift+Tab', undefined])
  assert.equal(attrs[1].label, '小')
  assert.equal(moduleBuilderAttributes('lift', { ...state, liftSize: LIFT_SIZE_LARGE })[1].label, '大')
})
