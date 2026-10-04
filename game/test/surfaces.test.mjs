// B1 acceptance (PLAN.md §4): surfaces are data, and a floor finish is
// gameplay. A slow finish costs more to walk; a track bed is not a node at all;
// paint / fill / erase are immutable so undo keeps working; and the mesher
// groups a chunk into one part per finish.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildGraph } from '../src/sim/station.ts'
import { finishOf, floorSpeed, finishMapOf, customFinishId, finishBaseId, finishDef, finishLabel, finishTint } from '../src/sim/finishes.ts'
import { buildSolidSet, meshChunk } from '../src/render/chunkMesher.ts'
import { packKey } from '../src/sim/types.ts'
import { eraseFace, eraseFaces, fillSurface, paintFace, paintFaces, toData, toState } from '../src/build/model.ts'

function corridor() {
  const cells = []
  for (let x = 0; x < 5; x++) cells.push({ x, y: 0, z: 0, fill: 'solid' })
  return toState({
    name: 't',
    seed: 1,
    cells,
    modules: [],
    lines: [],
  })
}

test('a slow floor finish is a real detour', () => {
  const plain = buildGraph(toData(corridor()))
  let slow = corridor()
  for (const x of [1, 2, 3]) slow = paintFace(slow, x, 0, 0, 'top', 'floor.concrete')
  const slowGraph = buildGraph(toData(slow))

  assert.equal(plain.nodeSpeed[2], 1)
  assert.ok(Math.abs(slowGraph.nodeSpeed[2] - 0.9) < 1e-5, `node speed was ${slowGraph.nodeSpeed[2]}`)

  // Straight-line corridor: node i is cell x = i. Cost of the whole run.
  const cost = (g) => {
    let sum = 0
    for (let i = 0; i < 4; i++) {
      let edge = -1
      for (let e = g.adjStart[i]; e < g.adjStart[i + 1]; e++) if (g.adjTo[e] === i + 1) edge = g.adjCost[e]
      assert.ok(edge > 0, `no edge ${i}->${i + 1}`)
      sum += edge
    }
    return sum
  }
  assert.ok(cost(slowGraph) > cost(plain), `concrete (${cost(slowGraph)}) should cost more than granite (${cost(plain)})`)
})

test('a track bed is not a walkable node', () => {
  let s = corridor()
  s = paintFace(s, 2, 0, 0, 'top', 'floor.track')
  const g = buildGraph(toData(s))
  assert.equal(g.nodeCount, 4, 'the track cell should not become a node')
  assert.equal(g.nodeIndex.has('2,0,0'), false)
})

test('paint, fill and erase are immutable and reversible', () => {
  // A 4x4 floor.
  const cells = []
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) cells.push({ x, y, z: 0, fill: 'solid' })
  const base = toState({
    name: 't',
    seed: 1,
    cells,
    modules: [],
    lines: [],
  })

  const one = paintFace(base, 1, 1, 0, 'top', 'floor.tile')
  assert.equal(finishOf(one.cells.find((c) => c.x === 1 && c.y === 1), 'top'), 'floor.tile')
  assert.equal(finishOf(base.cells.find((c) => c.x === 1 && c.y === 1), 'top'), 'floor.granite', 'paint mutated the base state')

  const back = eraseFace(one, 1, 1, 0, 'top')
  assert.equal(finishOf(back.cells.find((c) => c.x === 1 && c.y === 1), 'top'), 'floor.granite')
  assert.equal(back.cells.find((c) => c.x === 1 && c.y === 1).finish, undefined, 'erase should drop the empty map')

  const filled = fillSurface(base, 0, 0, 0, 'top', 'floor.concrete')
  const painted = filled.cells.filter((c) => c.finish?.top === 'floor.concrete')
  assert.equal(painted.length, 16, 'the whole connected floor should be filled')
  assert.equal(floorSpeed({ finish: { top: 'floor.concrete' } }), 0.9)
})

test('the chunk mesher groups faces into one part per finish', () => {
  const cells = [
    { x: 0, y: 0, z: 0, fill: 'solid' },
    { x: 1, y: 0, z: 0, fill: 'solid', finish: { top: 'floor.concrete' } },
  ]
  const solid = buildSolidSet(cells)
  const chunk = meshChunk(solid, finishMapOf(cells), 0, 0, 0)
  const finishes = new Set(chunk.parts.map((p) => p.finish))
  assert.ok(finishes.has('floor.granite'), 'default top finish missing')
  assert.ok(finishes.has('floor.concrete'), 'painted top finish missing')
  assert.ok(chunk.triangles > 0)
})

test('搪瓷板 takes a custom colour on top of the stock finish', () => {
  const id = customFinishId('wall.enamel', 0xff8800)
  assert.equal(id, 'wall.enamel#ff8800')
  assert.equal(finishBaseId(id), 'wall.enamel')
  assert.equal(finishTint(id), 0xff8800)

  const def = finishDef(id)
  assert.equal(def.look, 'enamel', 'the custom panel must keep the enamel look')
  assert.equal(def.family, 'wall', 'the custom panel must keep the wall family')
  assert.equal(def.tint, 0xff8800)
  assert.equal(def.speed, finishDef('wall.enamel').speed, 'colour must not change behaviour')
  assert.equal(finishLabel(id), '搪瓷板', 'the label is the base finish, not the hex')

  // A stock id parses back to itself and carries no tint.
  assert.equal(finishBaseId('wall.enamel'), 'wall.enamel')
  assert.equal(finishTint('wall.enamel'), null)
})

test('the mesher keeps two enamel tints in separate parts, not the default', () => {
  const red = customFinishId('wall.enamel', 0xff0000)
  const green = customFinishId('wall.enamel', 0x00ff00)
  const cells = [
    { x: 0, y: 0, z: 0, fill: 'solid', finish: { n: red } },
    { x: 2, y: 0, z: 0, fill: 'solid', finish: { n: green } },
  ]
  const chunk = meshChunk(buildSolidSet(cells), finishMapOf(cells), 0, 0, 0)
  const finishes = new Set(chunk.parts.map((p) => p.finish))
  assert.ok(finishes.has(red), 'the first custom tint should be its own part')
  assert.ok(finishes.has(green), 'the second custom tint should be its own part')
})

test('paintFaces / eraseFaces repaint a drag rectangle immutably', () => {
  const cells = []
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) cells.push({ x, y, z: 0, fill: 'solid' })
  const base = toState({
    name: 't',
    seed: 1,
    cells,
    modules: [],
    lines: [],
  })
  const rect = [
    [1, 1, 0],
    [2, 1, 0],
    [1, 2, 0],
    [2, 2, 0],
  ]

  const painted = paintFaces(base, rect, 'top', 'floor.tile')
  assert.equal(painted.cells.filter((c) => c.finish?.top === 'floor.tile').length, 4, 'the rectangle should be painted')
  assert.equal(base.cells.some((c) => c.finish !== undefined), false, 'paintFaces mutated the base state')
  assert.equal(paintFaces(base, [], 'top', 'floor.tile'), base, 'an empty rectangle is a no-op')

  const back = eraseFaces(painted, rect, 'top')
  assert.equal(back.cells.some((c) => c.finish !== undefined), false, 'eraseFaces should drop the empty finish map')
})

test('the add preview meshes only the pending cells, with real exposure', () => {
  // The build ghost (§9.5) meshes the cells an add-drag would place, but reads
  // the whole station for exposure. A lone pending block shows every face; with a
  // solid neighbour the shared wall disappears, exactly as it will on release.
  const none = new Map()
  const emit = new Set([packKey(1, 0, 0)])
  const lone = meshChunk(buildSolidSet([{ x: 1, y: 0, z: 0, fill: 'solid' }]), none, 0, 0, 0, 0, emit)
  const attached = meshChunk(
    buildSolidSet([
      { x: 0, y: 0, z: 0, fill: 'solid' },
      { x: 1, y: 0, z: 0, fill: 'solid' },
    ]),
    none,
    0,
    0,
    0,
    0,
    emit,
  )
  const whole = meshChunk(
    buildSolidSet([
      { x: 0, y: 0, z: 0, fill: 'solid' },
      { x: 1, y: 0, z: 0, fill: 'solid' },
    ]),
    none,
    0,
    0,
    0,
    0,
  )

  assert.ok(lone.triangles > 0, 'a lone pending block should preview its faces')
  assert.ok(attached.triangles > 0, 'the attached pending block still has visible faces')
  assert.ok(attached.triangles < lone.triangles, 'the wall shared with the neighbour should be dropped')
  assert.ok(whole.triangles > attached.triangles, 'without emit the existing neighbour is meshed too')
})
