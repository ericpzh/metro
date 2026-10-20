// Elevator floor intervals (电梯 层高) — GAME-SPEC.md §5.1.
//
// An elevator piece spans **one floor interval** chosen on its action tile:
// 超短 3 m / 短 4 m / 中 5 m (default) / 长 6 m / 超长 7 m. A fresh shaft is one
// interval; hovering its upper or lower half stacks another interval at the
// currently armed size, so one shaft can serve uneven floors — a five-metre
// storey with a three-metre mezzanine above it, or a seven-metre-deep platform
// below — on the single fixed storey grid. The piece records every
// segment rise, because stops are no longer evenly spaced.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createModule, extendLift, toState } from '../src/build/model.ts'
import {
  LIFT_INTERVAL_DEFAULT,
  LIFT_INTERVALS,
  defaultLiftInterval,
  liftExtendedDown,
  liftExtendedUp,
  liftIntervalLabel,
  liftModule,
  liftRises,
  liftStops,
  nextLiftInterval,
} from '../src/sim/lifts.ts'
import { buildGraph, EDGE_KIND } from '../src/sim/station.ts'
import { serialize, parse } from '../src/persistence/save.ts'
import { emptyStation } from '../src/data/reference-station.ts'
import { moduleGhostKey } from '../src/render/moduleGhostKey.ts'
import { placementPreviewKey, useStore } from '../src/app/store.ts'
import { buildModule } from '../src/render/models.ts'

const key = (p) => `${p.x},${p.y},${p.z}`

function floors(levels) {
  const cells = []
  for (let x = 0; x <= 5; x++) for (let y = 0; y <= 5; y++) for (const z of levels) cells.push({ x, y, z, fill: 'solid' })
  return cells
}

function edgeKind(g, a, b) {
  for (let e = g.adjStart[a]; e < g.adjStart[a + 1]; e++) if (g.adjTo[e] === b) return g.adjKind[e]
  return -1
}

test('the interval tile is 3/4/5/6/7 m named 超短 / 短 / 中 / 长 / 超长, 中 by default', () => {
  assert.deepEqual(LIFT_INTERVALS.map((s) => s.interval), [3, 4, 5, 6, 7])
  assert.deepEqual(LIFT_INTERVALS.map((s) => liftIntervalLabel(s.interval)), ['超短', '短', '中', '长', '超长'])
  assert.equal(LIFT_INTERVAL_DEFAULT, 5)
  assert.equal(liftIntervalLabel(undefined), '中')
  // Tab walks 超短 → 短 → 中 → 长 → 超长 and wraps.
  let interval = 3
  for (const next of [4, 5, 6, 7, 3]) {
    interval = nextLiftInterval(interval)
    assert.equal(interval, next)
  }
  // Grid profile is fixed; only the explicitly armed interval can differ.
  assert.equal(defaultLiftInterval(), 5)
})

test('a fresh lift spans exactly one interval, and the piece records its rise', () => {
  for (const interval of [3, 4, 5, 6, 7]) {
    const m = liftModule({ x: 2, y: 2, z: -4 }, 0, `lift-${interval}`, interval)
    assert.equal(m.to.z - m.from.z, interval, `${interval} m piece`)
    assert.deepEqual(liftRises(m), [interval])
    assert.deepEqual(liftStops(m), [-4, -4 + interval])
  }
  // A five-metre station's fresh piece is 中 5 m.
  const fresh = createModule('lift', 2, 2, 0, 'l', 0, undefined, 'up', 'lane', [], undefined, { storeyHeight: 5 })
  assert.equal(fresh.to.z, 5)
  assert.deepEqual(liftRises(fresh), [5])
})

test('stacking intervals keeps every stop exact, on both sides of the shaft', () => {
  const base = liftModule({ x: 2, y: 2, z: 0 }, 0, 'lift', 5)
  const up = liftExtendedUp(base, 3)
  assert.equal(up.to.z, 8)
  assert.deepEqual(liftRises(up), [5, 3])
  assert.deepEqual(liftStops(up), [0, 5, 8])

  const down = liftExtendedDown(base, 7)
  assert.equal(down.from.z, -7)
  assert.deepEqual(liftRises(down), [7, 5])
  assert.deepEqual(liftStops(down), [-7, 0, 5])

  const both = liftExtendedDown(liftExtendedUp(base, 3), 7)
  assert.deepEqual(liftRises(both), [7, 5, 3])
  assert.deepEqual(liftStops(both), [-7, 0, 5, 8])

  // The builder's own extension entry point reads the same interval.
  const state = toState({ name: 't', seed: 1, cells: floors([-7, 0, 5, 8]), modules: [base], lines: [] })
  const grown = extendLift(extendLift(extendLift(state, 'lift', true, 3), 'lift', false, 7), 'lift', true, 3)
  assert.deepEqual(liftRises(grown.modules[0]), [7, 5, 3, 3])
  assert.deepEqual(liftStops(grown.modules[0]), [-7, 0, 5, 8, 11])
})

test('the graph serves every uneven level with one car, both ways', () => {
  const mod = liftExtendedDown(liftExtendedUp(liftModule({ x: 2, y: 2, z: 0 }, 0, 'lift', 5), 3), 7)
  // Three stories: the levels are −7, 0 and 5; the shaft's top at 8 is its cap.
  const g = buildGraph({ name: 't', seed: 1, cells: floors([-7, 0, 5, 8]), modules: [mod], lines: [] })
  const server = g.servers.find((s) => s.kind === 'lift')
  assert.equal(server.lift.stops.length, 3, 'every level below the top cap is a stop')
  for (const z of [-7, 0, 5]) assert.notEqual(g.nodeIndex.get(key({ x: 2, y: 1, z })), undefined, `${z} m landing is walkable`)
  for (const a of server.lift.stops) for (const b of server.lift.stops) {
    if (a !== b) assert.equal(edgeKind(g, a, b), EDGE_KIND.lift, 'the car reaches every other stop')
  }
})

test('an interval change redraws the ghost, and a mixed shaft survives saving', () => {
  const before = useStore.getState()
  try {
    useStore.setState({ moduleType: 'lift', liftInterval: 5 })
    const keyBefore = placementPreviewKey(useStore.getState())
    useStore.getState().cycleLiftInterval()
    assert.equal(useStore.getState().liftInterval, 6)
    assert.notEqual(placementPreviewKey(useStore.getState()), keyBefore)
    useStore.getState().beginPick()
    useStore.getState().cycleLiftInterval()
    useStore.getState().cancelPick()
    assert.equal(useStore.getState().liftInterval, 6)
    useStore.getState().cycleLiftInterval()
    assert.equal(useStore.getState().liftInterval, 7)
  } finally {
    useStore.setState(before)
  }
  const three = liftModule({ x: 2, y: 2, z: 0 }, 0, 'a', 3)
  const five = liftModule({ x: 2, y: 2, z: 0 }, 0, 'b', 5)
  assert.notEqual(moduleGhostKey(three), moduleGhostKey(five), 'the interval is in the ghost identity')
  const mixed = liftExtendedDown(liftExtendedUp(five, 3), 7)
  const state = toState({ ...emptyStation(), modules: [mixed] })
  const saved = parse(serialize(state))
  assert.ok(saved.ok)
  assert.deepEqual(saved.state.modules[0].cfg.rises, [7, 5, 3])
  const reloaded = toState(saved.state)
  assert.deepEqual(liftStops(reloaded.modules[0]), [-7, 0, 5, 8])
})

test('the drawn shaft is exactly the stacked intervals and opens its landing doors below the capped top', () => {
  const mod = liftExtendedDown(liftExtendedUp(liftModule({ x: 4, y: 4, z: 0 }, 0, 'doors', 5), 3), 7)
  // The shaft runs from −7 to 8 (15 m) with no extra storey. The top landing is
  // capped and has no room for a portal; every landing below it draws one.
  // A shaft cell plus the front landing row at each level: the doors follow the
  // landing row, because the shaft cells are cut out of the slab above.
  const cells = (levels) => levels.flatMap((z) => [
    { x: 4, y: 4, z, fill: 'solid' },
    { x: 4, y: 3, z, fill: 'solid' },
    { x: 5, y: 3, z, fill: 'solid' },
  ])
  const mats = new Proxy({}, { get: (o, k) => (o[k] ??= new THREE.MeshStandardMaterial()) })
  for (const [levels, portals] of [[[-7, 0, 5, 8], 3], [[-7, 0, 8], 2]]) {
    const data = { ...emptyStation(), cells: cells(levels), modules: [mod], lines: [] }
    const group = buildModule(mod, { data, mats, trackCells: new Set(), finish: () => mats.steel, owned: [] })
    const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3())
    assert.ok(Math.abs(size.z - 15) < 1e-6, 'the shaft is exactly the 15 m it spans')
    assert.equal(group.userData.liftLandings.length, portals, `landing portals at ${portals} floors below the capped top`)
    assert.ok(group.userData.liftCabin, 'the moving cabin is still handed to the scene')
  }
})
