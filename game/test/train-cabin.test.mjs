// The cabin (§1.13, §5.9). A consist is not a counter that teleports people
// onto the platform: the wave it brings rides *in* the cars, seated in the
// doorway queues it will leave by, and steps out over the dwell — a pair a
// doorway at a time — while the boarders wait for the doorway to clear and then
// walk into the same cabin. `World.seatAlighter` / `stepAlighting` /
// `boardRider` / `stepTrainRider` are that behaviour, and these are its pins:
//
//   * the whole wave appears in the stopped cabin before the doors open;
//   * a doorway passes one row of two at its own cadence, so the platform sees a
//     stream rather than a dump;
//   * boarders are held off a doorway until its own queue has drained;
//   * everybody still in the cabin when the consist leaves is aboard it, and a
//     member of the wave that never got off is a left-behind arrival;
//   * an edit that re-cuts the doorways sets the riders down instead of leaving
//     bodies pinned to a car that is no longer there, and an orphaned rider — one
//     whose consist has left the world — is dropped rather than frozen in it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { World } from '../src/sim/world.ts'
import { defaultLine, placeTrack } from '../src/build/rail.ts'
import { CABIN_ALIGHT_PAIR_S, CABIN_FLOOR_Z, CABIN_HALF_W } from '../src/sim/stock.ts'
import { TRAIN_DWELL } from '../src/sim/constants.ts'

/** A platform beside a 120 m rail: a B6 consist's own cadence, cut into the edge. */
function platformStation(alightPerTrain, inRate = 0) {
  const cells = []
  for (let x = 0; x < 130; x++) {
    cells.push({ x, y: 0, z: 0, fill: 'solid', finish: { top: 'floor.granite' }, zone: 'platform' })
    cells.push({ x, y: 1, z: 0, fill: 'solid' })
    cells.push({ x, y: 2, z: 0, fill: 'solid' })
  }
  const line = defaultLine('1', 'up', 'third-rail')
  line.alightPerTrain = alightPerTrain
  const data = {
    name: '测试',
    seed: 1,
    cells,
    modules: [{ id: 'exit', type: 'exit', x: 0, y: 0, z: 0, cfg: { name: 'A口', inRate, open: true, headHouse: false } }],
    lines: [line],
  }
  return placeTrack(data, { lineId: '1', dir: 'up', power: 'third-rail', rot: 0, x: 4, y: 1, z: 0, w: 120, d: 1 })
}

/** Everyone the sim has pinned to a consist this tick (the dead are not in the world). */
function aboard(w) {
  return w.pool.live.filter((a) => !a.dead && a.train >= 0)
}

/** Run a world until its first consist has berthed with its doors open. */
function berth(w, limit = 120) {
  for (let i = 0; i < limit; i++) {
    w.tickOnce()
    const train = w.trains[0]
    if (train && (train.state === 'opening' || train.state === 'dwell')) return train
  }
  return null
}

/** Run until the consist reaches `state`, or give up. */
function runTo(w, state, limit = 120) {
  for (let i = 0; i < limit; i++) {
    w.tickOnce()
    if (w.trains[0]?.state === state) return i + 1
  }
  return -1
}

test('the wave spawns after stopping and before the doors open', () => {
  const w = new World(platformStation(192), 99)
  w.tickOnce()
  const train = w.trains[0]
  assert.ok(train, 'the line dispatched a consist')
  assert.ok(train.doors.length > 0, 'the consist has doorways to serve')
  assert.equal(aboard(w).length, 0, 'the approaching train has no cabin passengers yet')
  while (train.state === 'approach') {
    assert.equal(aboard(w).length, 0, 'passengers spawned while the train was moving')
    w.tickOnce()
  }
  assert.equal(train.state, 'berth', 'the train stopped with its doors shut')
  assert.equal(aboard(w).length, 192, 'every passenger of the wave is already in a car')
  assert.equal(w.totals.alighted, 0, 'and nobody has stepped onto the platform yet')

  // A rider stands in the cabin the model draws: the car floor over the consist
  // origin, not the platform surface under it.
  const pose = w.trainRenderState()
  for (const a of aboard(w)) {
    assert.equal(a.state, 7, 'a rider of the wave is alighting, not walking the floor')
    assert.ok(Math.abs(a.z - (pose[2] + CABIN_FLOOR_Z)) < 1e-6, `rider z ${a.z} is not on the cabin floor`)
  }
  // Seated by doorway, in rows: one pair to a row at the front of each queue.
  const depth = train.cabins.map((queue) => queue.length)
  assert.ok(depth.every((n) => n > 0), 'every doorway was given its share of the wave')
  assert.ok(Math.max(...depth) - Math.min(...depth) <= 2, `the wave is spread over the doorways, got ${depth}`)
})

test('the wave leaves a doorway at a time, over the dwell', () => {
  // 24 passengers a doorway: twelve rows, the deepest cabin the sim ever loads.
  const w = new World(platformStation(576), 99)
  const opened = runTo(w, 'opening')
  assert.ok(opened > 0, 'the doors opened')
  const doors = w.trains[0].doors.length
  assert.equal(w.totals.alighted, 0, 'the doors opened with nobody landing yet')

  let ticks = 0
  let last = 0
  let sawPartial = false
  while (w.trains[0] && (w.trains[0].state === 'opening' || w.trains[0].state === 'dwell')) {
    w.tickOnce()
    ticks++
    const landed = w.totals.alighted
    assert.ok(landed >= last, 'the alighting count never goes backwards')
    // One row of two a doorway per pair-cadence: the stream cannot outrun it.
    assert.ok(
      landed <= doors * 2 * Math.ceil(ticks / CABIN_ALIGHT_PAIR_S + 1),
      `the wave left faster than a pair a doorway can: ${landed} in ${ticks} ticks`,
    )
    if (landed > 0 && landed < 576) sawPartial = true
    last = landed
  }
  assert.ok(sawPartial, 'the wave arrived on the platform in one lump')
  assert.equal(w.totals.alighted, 576, 'and the whole wave got off within the dwell')
  assert.ok(TRAIN_DWELL > (576 / (doors * 2)) * CABIN_ALIGHT_PAIR_S, 'the fixture fits its wave in a dwell')
})

test('a doorway boards only once its own queue has drained', () => {
  const w = new World(platformStation(576, 6000), 99)
  runTo(w, 'opening')
  const train = w.trains[0]
  // While the wave is still stepping out, every doorway that still holds riders
  // is shut to boarders — the two streams never share a doorway.
  let checked = 0
  let openedToBoarders = false
  while (w.trains[0] && (w.trains[0].state === 'opening' || w.trains[0].state === 'dwell')) {
    w.tickOnce()
    for (let d = 0; d < train.doors.length; d++) {
      const s = w.graph.servers[train.doors[d]]
      if (train.cabins[d].length > 0 || train.inFlight[d] > 0) {
        assert.equal(s.rate, 0, 'a doorway let boarders in while it was still alighting')
        checked++
      } else if (s.rate > 0) {
        openedToBoarders = true
      }
    }
  }
  assert.ok(checked > 0, 'the fixture never had a doorway mid-alighting')
  // And once it is clear, it boards.
  assert.ok(openedToBoarders, 'no doorway ever opened to boarders after alighting')
})

test('boarders ride in the cabin and leave the world with the train', () => {
  // No street, so the only passengers are the wave and the boarders; no wave, so
  // the only thing that can happen is boarding into the cabin.
  const w = new World(platformStation(0, 6000), 99)
  for (let i = 0; i < 26; i++) w.tickOnce()
  const riding = w.pool.live.filter((a) => a.state === 6 && a.train >= 0)
  assert.ok(w.totals.boarded > 0, 'nobody boarded the train')
  assert.ok(riding.length > 0, 'the boarders were not seated in the cabin')
  const pose = w.trainRenderState()
  for (const a of riding) {
    assert.ok(Math.abs(a.z - (pose[2] + CABIN_FLOOR_Z)) < 0.2, 'a boarder is drawn off the cabin floor')
  }
  runTo(w, 'closing')
  assert.ok(aboard(w).length > 0, 'riders remain while the doors close')
  const train = w.trains[0]
  runTo(w, 'hold')
  assert.equal(train.state, 'hold', 'the train is sealed and has not started moving')
  assert.equal(aboard(w).length, 0, 'cabin riders despawn after closing and before moving')
  // The consist departs with them: nobody is left standing on the platform.
  for (let i = 0; i < 80; i++) {
    w.tickOnce()
    if (w.trains.length === 0) break
  }
  assert.equal(w.trains.length, 0, 'the consist left the world')
  assert.equal(aboard(w).length, 0, 'and took its riders with it')
  // Whoever is left is a boarder still queueing for the *next* train, never a
  // passenger the consist abandoned in the cabin.
  assert.equal(w.pool.live.filter((a) => a.state === 6 || a.state === 7).length, 0, 'somebody was left riding a departed train')
})

test('a wave too big for the dwell is counted left behind, not silently lost', () => {
  // More of a wave than 24 doorways can clear in one dwell: whatever is still
  // aboard when the doorway turns to boarding rides out on the train, and every
  // one of them is a left-behind arrival rather than a body that vanishes.
  const w = new World(platformStation(2000), 99)
  for (let i = 0; i < 200; i++) {
    w.tickOnce()
    if (w.trains.length === 0 && i > 2) break
  }
  assert.ok(w.totals.alighted > 0, 'nobody got off the train at all')
  assert.ok(w.totals.alighted < 2000, 'the whole wave fitted through the doorways in one dwell')
  assert.ok(w.totals.alighted + w.totals.leftBehind >= 2000, 'part of the wave went missing')
  assert.equal(aboard(w).length, 0, 'and the cabin was cleared with the consist')
})

test('a consist in the cabin is priced as a train, not as a platform crush', () => {
  // 384 bodies pinned inside one consist: if the crowd passes saw them, the
  // platform under the train would read as the worst crush in the station.
  const w = new World(platformStation(384), 99)
  runTo(w, 'berth')
  assert.equal(aboard(w).length, 384, 'the wave is aboard')
  assert.notEqual(w.metrics.worstLos, 'F', `the cabin was counted as a platform crush (worst ${w.metrics.worstLos})`)
})

test('an edit that re-cuts the doorways sets the riders down, and marks nobody', () => {
  // The cabin is cut from the station, so an edit that moves the screens moves
  // the car the riders were seated in. They are set down — and **not** counted as
  // left behind, because an edit is not the station failing to serve them.
  const w = new World(platformStation(192), 99)
  const train = berth(w)
  assert.ok(train, 'the consist berthed')
  assert.equal(aboard(w).length, 192, 'with its wave aboard')
  const before = w.totals.leftBehind
  const oldDoors = train.doors.length

  // The consist shrinks: every screen door the old car door met is re-derived.
  w.data.lines[0].cars = 4
  w.rebuild()

  assert.equal(aboard(w).length, 0, 'nobody is left standing in a cabin that no longer exists')
  const after = w.trains[0]
  assert.ok(after, 'the consist is still on the road')
  assert.ok(after.doors.length < oldDoors, `its doorways were re-cut (${oldDoors} -> ${after.doors.length})`)
  assert.equal(after.cabins.length, after.doors.length, 'and its cabin queues rebuilt to match')
  assert.equal(after.alightLeft, 0, 'with no wave left to seat')
  assert.equal(w.totals.leftBehind, before, 'an edit is not a left-behind arrival')
})

test('an edit that changes nothing keeps the wave aboard', () => {
  // The other half of the contract: a rebuild that leaves the doorways alone must
  // not dump the passengers the car is already carrying.
  const w = new World(platformStation(192), 99)
  berth(w)
  const doors = [...w.trains[0].doors]
  w.rebuild()
  assert.deepEqual([...w.trains[0].doors], doors, 'the doorways did not move')
  assert.equal(aboard(w).length, 192, 'so the wave is still riding')
})

test('a rider whose consist has gone is dropped, not frozen in the world', () => {
  // The pool recycles agents, so a body pinned to a train that is no longer in
  // `trains` would stay where it was, forever, inside a car that has left. Both
  // guards are defensive — `emptyTrain` clears riders before the consist is
  // spliced — and both have to *end* the passenger rather than leave them.
  const w = new World(platformStation(48), 99)
  w.tickOnce()
  const train = w.trains[0]
  const a = w.pool.spawn({ origin: 'test', stops: [], dest: 'exit:exit' }, 20, -1.5, -14.9, w.tick)
  a.train = train.id + 9999
  w.tickOnce()
  assert.equal(a.dead, true, 'a rider of a consist that is gone is not left in the world')

  const b = w.pool.spawn({ origin: 'test', stops: [], dest: 'exit:exit' }, 20, -1.5, -14.9, w.tick)
  b.train = train.id
  b.trainDoor = train.doors.length + 5
  w.tickOnce()
  assert.equal(b.dead, true, 'nor is one whose doorway is not on its own consist')
})

test('boarders stand behind the wave, never in its slots', () => {
  // The two streams share a doorway but not a place: a boarder's row starts where
  // the wave's queue ended when the doors opened, so an alighter is never pushed
  // out of a slot by somebody walking in behind it.
  const w = new World(platformStation(96, 6000), 99)
  const train = berth(w)
  runTo(w, 'closing')
  const boarders = w.pool.live.filter((a) => a.train >= 0 && a.state === 6)
  assert.ok(boarders.length > 0, 'nobody walked in')
  for (const a of boarders) {
    assert.ok(
      a.trainRow >= train.cabinDepth[a.trainDoor],
      `a boarder stands at row ${a.trainRow}, inside the wave's own queue (depth ${train.cabinDepth[a.trainDoor]})`,
    )
  }
})

test('an odd wave leaves one seat in its last row, and still clears', () => {
  // Three passengers a doorway: the last row is a single. The queue is rows, not
  // pairs, so the odd one leaves with the row it is on rather than being stuck.
  const w = new World(platformStation(3 * 24 + 5), 99)
  const train = berth(w)
  assert.equal(aboard(w).length, 3 * 24 + 5, 'the odd wave is seated whole')
  const odd = train.cabins.filter((q) => q.length % 2 === 1).length
  assert.ok(odd > 0, 'the fixture has an odd row to test')
  while (w.trains[0] && (w.trains[0].state === 'opening' || w.trains[0].state === 'dwell')) w.tickOnce()
  assert.equal(w.totals.alighted, 3 * 24 + 5, 'every one of them got off')
})

test('two runs of one seed seat the same wave, in the same slots, at the same cadence', () => {
  // The cabin is part of the deterministic crowd (§7.6): the slots are a function
  // of the station and the doorways, and the wave's own draw is one stream.
  const run = () => {
    const w = new World(platformStation(240, 600), 4242)
    const trace = []
    for (let i = 0; i < 40; i++) {
      w.tickOnce()
      const riders = aboard(w)
      trace.push(`${w.totals.alighted}|${riders.length}|${riders.map((a) => `${a.id}:${a.trainRow}`).join(',')}`)
    }
    return trace
  }
  assert.deepEqual(run(), run())
})
