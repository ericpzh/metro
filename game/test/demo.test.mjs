// The shipped demo station (动物园, Line 5) — a regression guard for the save
// that replaced the old hand-built reference rig. It must build a connected
// graph (passengers enter at an exit, reach a platform, board, alight and leave)
// and it must actually move a crowd.
import test from 'node:test'
import assert from 'node:assert/strict'
import { World } from '../src/sim/world.ts'
import { buildGraph } from '../src/sim/station.ts'
import { referenceStation, emptyStation, REFERENCE_BOOT } from '../src/data/reference-station.ts'

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

test('the demo hands out a fresh document every time, on the seed it boots with', () => {
  // `referenceStation()` is a `structuredClone`, not a shared object: the app mutates
  // the station it is given (undo, edits, a lift), so one shared document would leak
  // those edits back into the next 打开 — and the demo is also what a cold boot loads,
  // which is why its seed has to be the document's own.
  const first = referenceStation()
  first.cells.length = 0
  first.name = '被改过的'
  const second = referenceStation()
  assert.ok(second.cells.length > 0, 'a fresh copy never sees an edit made to the last one')
  assert.notEqual(second.name, '被改过的', 'and neither does its name')
  assert.equal(second.name, '动物园', 'the demo is still the author’s 动物园 save')
  assert.equal(second.seed, 7654321, 'with the seed a cold boot and an 打开 both run the crowd on')
  assert.ok(second.lines.length >= 1, 'and its line')
  assert.ok(second.modules.length >= 1, 'and the station built on it')
})

test('a new station starts on the infinite street, with nothing built on it', () => {
  const fresh = emptyStation()
  assert.equal(fresh.name, '未命名车站', 'a new station is unnamed until it is saved')
  assert.deepEqual(fresh.modules, [], 'nothing is placed on it')
  assert.deepEqual(fresh.lines, [], 'and no line is laid')
  // The street is implicit (stored inverted: only holes are cells), so a new
  // station is an empty document standing on infinite ground.
  assert.deepEqual(fresh.cells, [], 'the street is virtual, not a seed of blocks')
  assert.equal(emptyStation('自定义').name, '自定义', 'and it can be named on the way in')
})
