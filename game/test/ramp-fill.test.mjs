// The ground under a run fills up to its truss — GAME-SPEC §4.2 / §5.1.
//
// A run's body hangs `RAMP_FOOT` (0.5 m) below its walking line, and the block brush
// may only lay ground whose **top face** is at or below that line (the crowd's floor is
// a block's `z + 1`, so a course above the line would stand inside the run). The last
// course under the truss therefore cannot be built — and with nothing drawn there, the
// ground stops a wedge short of the truss and you can see through to the storey below.
//
// The renderer closes it instead (`rampFillKeys` → `SceneContext.slopeFills`): a cell
// the cut names that the station holds **nothing** in and that stands on solid ground is
// meshed as if the block below carried on up to the truss. No cell is added, no tag,
// nothing for a tool to keep in step — so it follows the ground and the run on its own,
// the way `thinWallCells` follows a wide stair.
//
// This file drives the real `ChunkSystem`: the plumbing a unit test of the mesher alone
// would miss (the derived cell has to be listed for the chunk, emitted, hashed into the
// chunk cache and handed to the mesher, in both slice passes). `test/slope-cut.test.mjs`
// pins the derivation and the drawn geometry.
//
// Every scene below holds **one ground column** and nothing else, so the cell the
// assertions measure has no neighbour whose geometry could share its boundary planes: a
// block beside a run may stand taller than the truss, and its face on the shared plane
// would read as this column.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { ChunkSystem } from '../src/render/scene/systems/ChunkSystem.ts'
import { SceneContextData } from '../src/render/scene/systems/SceneSystem.ts'
import { buildSolidSet, meshChunk } from '../src/render/chunkMesher.ts'
import { RAMP_SOFFIT_FINISH, finishMapOf } from '../src/sim/finishes.ts'
import { RAMP_FOOT, carveRampOpenings, rampFillKeys, rampSlopeCuts } from '../src/sim/openings.ts'
import { packKey } from '../src/sim/types.ts'

/**
 * The run the filling rigs stand on: a **stair**, climbing one storey along −x, 6 cells across and
 * 4 m up. A stair draws no body of its own, so the ground under it is the renderer's to fill; a
 * 扶梯's piece carries that body itself now (`EscalatorModel.undercroftSolid`), so `rampFillKeys`
 * derives nothing under one — which is what the last test here is about.
 */
const stair = {
  id: 's1', type: 'stair', x: 6, y: 0, z: 0, rot: 3,
  from: { x: 6, y: 0, z: 0 }, to: { x: 0, y: 0, z: 4 },
  cfg: { width: 0.68, style: 'straight', flights: [{ from: { x: 6, y: 0, z: 0 }, to: { x: 0, y: 0, z: 4 } }] },
}

/** The same run as an escalator, for the piece that draws its own body. */
const escalator = {
  id: 'e1', type: 'escalator', x: 6, y: 0, z: 0, rot: 0,
  from: { x: 6, y: 0, z: 0 }, to: { x: 0, y: 0, z: 4 }, cfg: { dir: 'up' },
}

/** The run's walking line, in world z, at world x (as `slope-cut.test.mjs` reads it). */
const line = (x) => 1 + ((6.5 - x) / 6) * 4

/** Ground blocks at `(x, y)`, one course per storey given. */
function ground(x, y, zs) {
  return zs.map((z) => ({ x, y, z, fill: 'solid' }))
}

/** The packed key back to its cell, so a derived filling can be visited as a coordinate. */
function unpack(k) {
  const z = (k % 8192) - 4096
  const t = (k - (z + 4096)) / 8192
  const y = (t % 8192) - 4096
  const x = (t - (y + 4096)) / 8192 - 4096
  return { x, y, z }
}

/** A station of just those blocks, with the run dropped on it (and carved, unless told not to). */
function station(cells, carve = true) {
  const kept = cells.map((c) => ({ ...c }))
  if (carve) carveRampOpenings(kept, [stair])
  return { name: 'fill', seed: 1, cells: kept, modules: [stair], lines: [] }
}

/** The chunk meshes the renderer would draw for a station, with a recorded material kit. */
function render(data) {
  const asked = []
  const mats = {
    finish: (id) => {
      asked.push(id)
      return new THREE.MeshBasicMaterial()
    },
    outline: new THREE.MeshBasicMaterial(),
  }
  const ctx = new SceneContextData(new THREE.Scene(), mats, undefined, undefined)
  const chunks = new ChunkSystem(ctx)
  chunks.prepareStation(data)
  chunks.meshStation(data)
  return { chunks, ctx, asked }
}

/** Every vertex drawn over the cell `(x, y)` in one slice pass. */
function vertsOver(chunks, x, y, float = false) {
  const out = []
  for (const mesh of chunks.chunkMeshes) {
    if (mesh.userData.float !== float) continue
    const pos = mesh.geometry.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i)
      const vy = pos.getY(i)
      if (vx < x - 1e-6 || vx > x + 1 + 1e-6) continue
      if (vy < y - 1e-6 || vy > y + 1 + 1e-6) continue
      out.push(pos.getZ(i))
    }
  }
  return out
}

/** The highest vertex drawn over the cell `(x, y)` in one slice pass. */
function topOver(chunks, x, y, float = false) {
  const drawn = vertsOver(chunks, x, y, float)
  assert.ok(drawn.length > 0, `nothing is drawn over (${x}, ${y})`)
  return Math.max(...drawn)
}

/**
 * The `y` values of every vertex drawn over the cell `(x, y)` **above** the storey floor
 * at `z` — the filling alone, clear of the ground block it stands on.
 */
function vertsAbove(chunks, x, z) {
  const out = []
  for (const mesh of chunks.chunkMeshes) {
    if (mesh.userData.float) continue
    const pos = mesh.geometry.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      if (pos.getX(i) < x - 1e-6 || pos.getX(i) > x + 1 + 1e-6) continue
      if (pos.getZ(i) <= z + 1e-6) continue
      out.push(pos.getY(i))
    }
  }
  assert.ok(out.length > 0, `nothing is drawn above (${x}, ${z})`)
  return out
}

/**
 * Every vertex drawn **strictly inside** the cell `(x, y)`, clear of its boundary
 * planes — where a block on the neighbouring cell would show its own face.
 */
function vertsInside(chunks, x, y) {
  const out = []
  for (const mesh of chunks.chunkMeshes) {
    const pos = mesh.geometry.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i)
      const vy = pos.getY(i)
      if (vx < x - 1e-6 || vx > x + 1 + 1e-6) continue
      if (vy < y + 1e-6 || vy > y + 1 - 1e-6) continue
      out.push(pos.getZ(i))
    }
  }
  return out
}

test('a floor under a run is drawn up to the truss, and no cell is added for it', () => {
  const data = station(ground(5, 0, [0]))
  const { chunks, ctx, asked } = render(data)

  // The course the truss crosses above the floor is the one the brush cannot lay:
  // the renderer derives it instead, and the document is untouched.
  assert.ok(ctx.slopeFills.has(packKey(5, 0, 1)), 'the wedge above the floor is a filling')
  assert.ok(
    !data.cells.some((c) => c.x === 5 && c.y === 0 && c.z === 1),
    'the filling must not be a cell in the document',
  )

  const truss = line(5) - RAMP_FOOT
  for (const pass of [false, true]) {
    const top = topOver(chunks, 5, 0, pass)
    assert.ok(Math.abs(top - truss) < 0.02, `the ground stops at ${top}, not at the truss at ${truss}`)
  }
  // …and a stair carries no drawn body of its own, so its filling keeps the cell's shape and the
  // ground's finish rather than an escalator's steel.
  assert.ok(!asked.includes(RAMP_SOFFIT_FINISH), 'the stair’s filling is drawn in a 扶梯’s steel')
  const band = vertsAbove(chunks, 5, 1)
  const lo = Math.min(...band)
  const hi = Math.max(...band)
  assert.ok(
    Math.abs(hi - lo - 1) < 1e-6,
    `the filling spans ${(hi - lo).toFixed(3)} across, not the cell's own 1 m`,
  )
  assert.ok(Math.abs((lo + hi) / 2 - 0.5) < 1e-6, 'the filling is not centred on the run’s line')
})

test('a run hanging over void is left alone: nothing floats under a truss', () => {
  // The one block of ground stands beside the run's column, never under it: the
  // escalator is over air, and there is no filling to draw.
  const data = station(ground(5, 1, [0]))
  const { chunks, ctx } = render(data)
  assert.equal(ctx.slopeFills.size, 0, 'a run over void has no filling to draw')
  assert.deepEqual(vertsInside(chunks, 5, 0), [], 'no ground was drawn under the run')
})

test('a block the station already holds there needs no filling', () => {
  // Two courses, and no carve — the shape a save may carry: the upper block is the one
  // the cut shaves, so the column already ends on the truss and nothing is derived.
  const data = station(ground(5, 0, [0, 1]), false)
  const { chunks, ctx } = render(data)
  assert.equal(ctx.slopeFills.size, 0, 'a block that is already there needs no filling')
  const truss = line(5) - RAMP_FOOT
  const top = topOver(chunks, 5, 0)
  assert.ok(Math.abs(top - truss) < 0.02, `the shaved block ends at ${top}, not at the truss at ${truss}`)
})

test('a 扶梯 derives no filling at all: its own piece carries that body', () => {
  // The piece draws the body that used to be derived here (`EscalatorModel.undercroftSolid`, cut to
  // this very cell and plane). A second one on the same plane is a face that flickers against the
  // piece's, so the renderer derives nothing: the cut still shaves the ground, and the tab is empty.
  const data = { name: 'fill', seed: 1, cells: ground(5, 0, [0]), modules: [escalator], lines: [] }
  const { chunks, ctx } = render(data)
  assert.equal(ctx.slopeFills.size, 0, 'the escalator derives a filling its own piece already draws')
  assert.ok(ctx.slopeCuts.size > 0, 'the escalator no longer shaves the ground it climbs over')
  assert.deepEqual(vertsOver(chunks, 5, 0).filter((z) => z > 1 + 1e-6), [], 'a second body was drawn under an escalator')
})

test('the mesher’s truss-width band still fits the escalator’s own truss', async () => {
  // No game path hands the mesher a truss-width filling any more — the 扶梯's piece is that body —
  // so the cut goes in by hand. What is pinned is the profile the mesher draws for a body narrower
  // than the cell: the same width as the model's truss, on the run's own line, and reaching *into*
  // it rather than stopping short (the plane is `RAMP_FOOT` below the walking line; the truss hangs
  // a little deeper, measured across the incline, so the two overlap).
  const stubContext = () => {
    const store = {}
    return new Proxy(store, {
      get(target, key) {
        if (key in target) return target[key]
        if (key === 'measureText') return (text) => ({ width: String(text ?? '').length * 8 })
        if (key === 'canvas') return { width: 0, height: 0, getContext: stubContext }
        return () => undefined
      },
      set(target, key, value) {
        target[key] = value
        return true
      },
    })
  }
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: stubContext }) }
  const { buildModule, createModelMaterials } = await import('../src/render/models.ts')
  const mats = createModelMaterials()
  const group = buildModule(escalator, { mats })
  group.updateMatrixWorld(true)
  const truss = []
  // The truss alone: the piece also carries its own solid under it (`EscalatorModel`'s
  // undercroft), in the same dark steel.
  group.traverse((o) => {
    if (!o.isMesh || o.name !== 'truss') return
    const pos = o.geometry.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      truss.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld))
    }
  })
  assert.ok(truss.length > 0, 'the escalator model has no dark-steel truss to fit')

  const cells = ground(5, 0, [0])
  const solid = buildSolidSet(cells)
  const cuts = new Map([...rampSlopeCuts([escalator])].map(([k, c]) => [k, { ...c, ownBody: undefined }]))
  const fills = rampFillKeys(solid, cuts)
  const list = [...fills].map(unpack)
  const chunk = meshChunk(
    solid, finishMapOf(cells), 0, 0, Math.min(...list.map((c) => c.z)), Math.max(...list.map((c) => c.z)),
    new Set(fills), undefined, list, undefined, cuts, fills,
  )
  const band = []
  for (const part of chunk.parts) {
    for (let i = 0; i < part.positions.length; i += 3) {
      if (part.positions[i] < 5 - 1e-6 || part.positions[i] > 6 + 1e-6) continue
      if (part.positions[i + 2] <= 1 + 1e-6) continue
      band.push(part.positions[i + 1])
    }
  }
  assert.ok(band.length > 0, 'the truss-width filling drew nothing')
  const ys = truss.map((p) => p.y)
  assert.ok(
    Math.abs(ys.length ? Math.max(...ys) - Math.min(...ys) - (Math.max(...band) - Math.min(...band)) : NaN) < 1e-6,
    'the filling is not as wide as the truss',
  )
  assert.ok(Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - (Math.min(...band) + Math.max(...band)) / 2) < 1e-6, 'the filling is not on the truss’s centreline')

  // The truss's underside, from its lowest corner along the run's own slope, against the
  // plane the filling tops out on: it must cover it (no gap) without burying it deep.
  const low = truss.reduce((best, p) => (p.z < best.z ? p : best), truss[0])
  const slope = (escalator.to.z - escalator.from.z) / (escalator.to.x - escalator.from.x)
  for (const x of [5, 5.5, 4.5]) {
    const underside = low.z + slope * (x - low.x)
    const top = line(x) - RAMP_FOOT
    assert.ok(underside <= top + 1e-6, `the truss underside at x=${x} is above the filling (${underside} > ${top})`)
    assert.ok(top - underside < 0.1, `the filling is buried ${(top - underside).toFixed(3)} into the truss at x=${x}`)
  }
})

test('the filling follows the ground it stands on', () => {
  // `rampFillKeys` reads the block below each cut cell, so raising the ground raises the
  // filling with it — and a cut over void fills nothing at all.
  const cut = new Map([[packKey(5, 0, 5), { axis: 'x', lo: 0.2, hi: 0.8 }]])
  const bare = buildSolidSet(ground(5, 0, [0]))
  assert.deepEqual([...rampFillKeys(bare, cut)], [], 'a cut with no ground under it fills nothing')
  const grounded = buildSolidSet(ground(5, 0, [0, 4]))
  assert.deepEqual([...rampFillKeys(grounded, cut)], [packKey(5, 0, 5)], 'the cut cell above the new ground is the filling')
})
