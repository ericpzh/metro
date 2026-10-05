// The shipped demo station (动物园, Line 5) — a regression guard for the save
// that replaced the old hand-built reference rig. It must build a connected
// graph (passengers enter at an exit, reach a platform, board, alight and leave)
// and it must actually move a crowd.
import test from 'node:test'
import assert from 'node:assert/strict'
import { World } from '../src/sim/world.ts'
import { buildGraph } from '../src/sim/station.ts'
import { referenceStation, REFERENCE_BOOT } from '../src/data/reference-station.ts'

function reachable(g, starts) {
  const seen = new Uint8Array(g.nodeCount)
  const q = [...starts]
  for (const s of starts) seen[s] = 1
  while (q.length) {
    const n = q.pop()
    for (let e = g.adjStart[n]; e < g.adjStart[n + 1]; e++) {
      const m = g.adjTo[e]
      if (!seen[m]) { seen[m] = 1; q.push(m) }
    }
  }
  return seen
}

test('the demo station is one connected circulation', () => {
  const g = buildGraph(referenceStation())
  const fromExits = reachable(g, g.exits.map((e) => e.node))
  const fromPlatforms = reachable(g, g.platforms.flatMap((p) => p.cells))

  assert.ok(g.exits.length >= 1, 'the demo should have at least one exit')
  assert.ok(g.platforms.length >= 1, 'the demo should have at least one platform')
  for (const p of g.platforms) {
    for (const c of p.cells) assert.ok(fromExits[c], `platform ${p.id} is unreachable from the exits`)
    for (const d of p.doors) assert.ok(fromExits[d], `a screen door of ${p.id} is unreachable from the exits`)
  }
  for (const e of g.exits) assert.ok(fromPlatforms[e.node], `exit ${e.id} is unreachable from the platforms`)
})

test('the demo moves a crowd: people board and leave', () => {
  const w = new World(referenceStation(), referenceStation().seed)
  for (let i = 0; i < 900; i++) w.tickOnce()
  assert.ok(w.totals.boarded > 0, 'nobody boarded a train on the demo')
  assert.ok(w.totals.exited > 0, 'nobody reached an exit on the demo')
  // Stuck is an agent-tick count, not a population; a connected station keeps it
  // a small fraction of the crowd that passed through.
  const throughput = w.pool.count + w.totals.exited + w.totals.boarded
  assert.ok(w.metrics.stuck < throughput * 0.5, `the demo strands its crowd (stuck ${w.metrics.stuck} of ${throughput})`)
})

test('the demo boots at the authored time with a fresh floor', () => {
  assert.equal(REFERENCE_BOOT.warmup, 0)
  const w = new World(referenceStation(), referenceStation().seed)
  w.load(referenceStation(), referenceStation().seed, REFERENCE_BOOT.startSeconds)
  assert.equal(w.pool.count, 0, 'the demo should open empty')
  assert.equal(w.simTime, REFERENCE_BOOT.startSeconds, 'the demo should open at its authored time')
})

test('the shipped demo carries no cell off the 1 m grid', () => {
  // The author's own save arrived with 19 (fractional coordinates, no tags, no
  // module standing on them). No tool in the game can mint one — or remove one,
  // since a pick names whole cells (`render/pickCell.ts`) and `removeCells` matches
  // an exact coordinate — so a save is the only way they can appear, and they must
  // not be shipped.
  // `toState` drops them on load (`save.test.mjs`); this is the guard on the file
  // itself, which `referenceStation()` hands out raw.
  const stray = referenceStation().cells.filter(
    (c) => !Number.isInteger(c.x) || !Number.isInteger(c.y) || !Number.isInteger(c.z),
  )
  assert.deepEqual(stray, [], `${stray.length} off-grid cells in the demo save`)
})
