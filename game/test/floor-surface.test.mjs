// The drawn floor surface: a run of blocks is **one flat plane**, out to a **square rim**.
//
// The mesher used to round and bevel every cell edge whatever stood beside it, so two
// blocks always met along a shared edge that both of them insetted away from: the floor
// came out as a field of shallow cones with a V-groove along every seam and a pit at
// every four-block corner, twelve and a half centimetres deep and plainly visible from
// above. §4.2's 12.5 cm top-rim chamfer was then cut on the exposed edges only, which
// fixed the seams but left the rim itself the fiddliest geometry in the renderer: the
// 45° strips met at every convex corner in a facet that crossed its neighbours and stood
// proud of the lid, and the mitre ring and the corner triangle that closed it were two
// special cases whose whole job was to hide that.
//
// **The chamfer is gone.** A block is a cube: its top face is its own cross-section, its
// walls run the whole way up to it, and the corner of the block is the corner of the
// cube. These tests read the height of the drawn surface and the direction of every
// triangle, because that is the only thing that can tell a chamfer from a cube — a
// triangle count cannot.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSolidSet, meshChunk } from '../src/render/chunkMesher.ts'
import { finishMapOf } from '../src/sim/finishes.ts'
import { packKey } from '../src/sim/types.ts'
import { rampFillKeys } from '../src/sim/openings.ts'

/** A solid `n × n` floor slab at z = 0. */
function floorPatch(n) {
  const cells = []
  for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) cells.push({ x, y, z: 0, fill: 'solid' })
  return cells
}

/** The upward-facing triangles of the part wearing the floor finish. */
function floorTris(cells) {
  const chunk = meshChunk(buildSolidSet(cells), finishMapOf(cells), 0, 0, 0)
  const out = []
  for (const part of chunk.parts) {
    if (part.finish !== 'floor.granite') continue
    const P = part.positions
    const I = part.indices
    for (let i = 0; i < I.length; i += 3) {
      const v = [0, 1, 2].map((j) => {
        const o = I[i + j] * 3
        return [P[o], P[o + 1], P[o + 2]]
      })
      const nz = (v[1][0] - v[0][0]) * (v[2][1] - v[0][1]) - (v[1][1] - v[0][1]) * (v[2][0] - v[0][0])
      if (nz > 1e-12) out.push(v)
    }
  }
  return out
}

/**
 * The height of the topmost drawn floor surface over `(px, py)`, or -Infinity where
 * nothing is drawn. The probe is a point-in-triangle test in plan: the surface is
 * piecewise planar, so the highest triangle containing the point is the surface.
 */
function surfaceAt(tris, px, py) {
  let best = -Infinity
  for (const [a, b, c] of tris) {
    const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if (Math.abs(d) < 1e-14) continue
    const l1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / d
    const l2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / d
    const l3 = 1 - l1 - l2
    if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue
    const z = l1 * a[2] + l2 * b[2] + l3 * c[2]
    if (z > best) best = z
  }
  return best
}

test('two blocks side by side are one flat floor across the seam between them', () => {
  const n = 3
  const tris = floorTris(floorPatch(n))
  // The seam planes between cells, sampled along their interior run and a hair to each
  // side: nothing may step down on either side of the boundary the two blocks share.
  const eps = 1e-6
  const seams = [
    // x = 1 divides the two columns; between two blocks over y ∈ [1, n].
    { fixed: 1, along: 'y', from: 1, to: n },
    // y = 1 divides the two rows; between two blocks over x ∈ [1, n].
    { fixed: 1, along: 'x', from: 1, to: n },
  ]
  for (const seam of seams) {
    for (let k = 2; k < 98; k++) {
      const t = seam.from + ((seam.to - seam.from) * k) / 100
      const probes =
        seam.along === 'y'
          ? [[seam.fixed - eps, t], [seam.fixed + eps, t]]
          : [[t, seam.fixed - eps], [t, seam.fixed + eps]]
      for (const [px, py] of probes) {
        const z = surfaceAt(tris, px, py)
        assert.ok(Math.abs(z - 1) < 1e-6, `the seam at (${px.toFixed(4)}, ${py.toFixed(4)}) is not flush: z=${z}`)
      }
    }
  }
  // And the four-block corner in the middle of the patch.
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const z = surfaceAt(tris, 1 + dx * eps, 1 + dy * eps)
    assert.ok(Math.abs(z - 1) < 1e-6, `the four-block corner at (${dx}, ${dy}) is not flush: z=${z}`)
  }
})

test('a whole floor is level, hole-free and dip-free right out to its own rim', () => {
  const n = 6
  const tris = floorTris(floorPatch(n))
  let lowest = Infinity
  // The rim is included: with no chamfer cut off the edge, the surface runs to the cell
  // boundary itself, so a floor's last centimetre is as flat as its middle.
  for (let i = 0; i < 120; i++) {
    for (let j = 0; j < 120; j++) {
      const px = (i / 120) * n
      const py = (j / 120) * n
      const z = surfaceAt(tris, px, py)
      assert.notEqual(z, -Infinity, `nothing is drawn over (${px.toFixed(3)}, ${py.toFixed(3)})`)
      lowest = Math.min(lowest, z)
    }
  }
  assert.ok(Math.abs(lowest - 1) < 1e-6, `the floor dips to ${lowest} instead of staying level`)
})

test('a block with a neighbour on every side is a plain cube top', () => {
  const n = 3
  const tris = floorTris(floorPatch(n))
  // The centre cell shares all four sides, so its top reaches the cell edge everywhere.
  for (const [px, py] of [[1.5, 1.5], [1 + 1e-6, 1.5], [2 - 1e-6, 1.5], [1.5, 1 + 1e-6], [1.5, 2 - 1e-6]]) {
    assert.ok(Math.abs(surfaceAt(tris, px, py) - 1) < 1e-6, `the interior block is not flat at (${px}, ${py})`)
  }
})

test('a rim is square: the top face reaches the cell boundary at every corner', () => {
  const cells = [{ x: 0, y: 0, z: 0, fill: 'solid' }]
  const corner = 1e-6
  const tris = floorTris(cells)
  // The lone block used to foot 12.5 cm below its ceiling at the rim, and its lid stopped
  // 12.5 cm short of each corner. Both numbers are now the cell's own: 1 and 0 / 1.
  for (const [px, py, what] of [
    [corner, 0.5, 'the west rim'],
    [1 - corner, 0.5, 'the east rim'],
    [0.5, corner, 'the south rim'],
    [0.5, 1 - corner, 'the north rim'],
    [corner, corner, 'the south-west corner'],
    [1 - corner, 1 - corner, 'the north-east corner'],
  ]) {
    const z = surfaceAt(tris, px, py)
    assert.ok(Math.abs(z - 1) < 1e-6, `${what} should reach z=1, got ${z}`)
  }
})

test('no drawn face of a block leans: the 45° top-rim cut is gone', () => {
  // The direct pin. A chamfer is four 45° strips plus a triangle at every corner, and every
  // one of them is a triangle whose authored normal has two non-zero components. A cube has
  // only axis-aligned faces, so this reads every triangle of the mesh — walls, lid, floor
  // and all — and asks for exactly one non-zero component.
  const show = (n) => `(${n.map((v) => v.toFixed(3)).join(', ')})`
  for (const cells of [[{ x: 0, y: 0, z: 0, fill: 'solid' }], floorPatch(3)]) {
    const chunk = meshChunk(buildSolidSet(cells), finishMapOf(cells), 0, 0, 0)
    let drawn = 0
    for (const part of chunk.parts) {
      const N = part.normals
      for (let i = 0; i < N.length; i += 3) {
        const n = [N[i], N[i + 1], N[i + 2]]
        drawn++
        const off = n.filter((v) => Math.abs(v) > 1e-6)
        assert.equal(off.length, 1, `a drawn face leans: ${show(n)}`)
        assert.ok(Math.abs(Math.abs(off[0]) - 1) < 1e-6, `a drawn face is not square to its axis: ${show(n)}`)
      }
    }
    assert.ok(drawn > 0, 'the probe drew nothing')
  }
})

test('a floor beside a block one level up still meets it with no slit', () => {
  // The step case: the upper block's wall runs down to the shared cell boundary, while the
  // lower block's lid has to reach that same boundary underneath it.
  const cells = [
    { x: 0, y: 0, z: 0, fill: 'solid' },
    { x: 0, y: 0, z: 1, fill: 'solid' },
    { x: 1, y: 0, z: 0, fill: 'solid' },
  ]
  const tris = floorTris(cells)
  // The upper block's top is a floor one storey up, level over its own cell.
  assert.ok(Math.abs(surfaceAt(tris, 0.5, 0.5) - 2) < 1e-6, 'the upper block is not level')
  // The lower block's lid, beside it, is its own level — the step is a step, not a gap.
  assert.ok(Math.abs(surfaceAt(tris, 1.5, 0.5) - 1) < 1e-6, 'the lower block lid is not level')
  assert.ok(surfaceAt(tris, 1.5, 0.5) > -Infinity, 'the lower block lid is missing')
  // And the lower lid reaches the boundary the two share, right up against the step.
  assert.ok(Math.abs(surfaceAt(tris, 1 + 1e-6, 0.5) - 1) < 1e-6, 'the lower lid stops short of the step')
})

/** Every triangle of the floor part, with its authored normal. */
function floorTriangles(cells) {
  const chunk = meshChunk(buildSolidSet(cells), finishMapOf(cells), 0, 0, 0, 0, new Set(cells.map((c) => packKey(c.x, c.y, c.z))))
  const out = []
  for (const part of chunk.parts) {
    if (part.finish !== 'floor.granite') continue
    const P = part.positions
    const N = part.normals
    const I = part.indices
    for (let i = 0; i < I.length; i += 3) {
      const o = [0, 1, 2].map((j) => I[i + j] * 3)
      out.push({
        v: o.map((b) => [P[b], P[b + 1], P[b + 2]]),
        n: [N[o[0]], N[o[0] + 1], N[o[0] + 2]],
      })
    }
  }
  return out
}

test('a wall reaches the ceiling it ends on, so the rim is one clean edge', () => {
  // A wall used to stop 12.5 cm below its own ceiling, with the chamfer bridging the gap.
  // Nothing bridges anything now: the wall's top vertices are at the block's own height.
  const cells = [{ x: 0, y: 0, z: 0, fill: 'solid' }]
  const chunk = meshChunk(buildSolidSet(cells), finishMapOf(cells), 0, 0, 0, 0, new Set([packKey(0, 0, 0)]))
  assert.ok(Math.abs(surfaceAt(floorTris(cells), 0.5, 0.5) - 1) < 1e-6, 'the lone block is not level')
  let walls = 0
  for (const part of chunk.parts) {
    const N = part.normals
    const P = part.positions
    const I = part.indices
    for (let t = 0; t < I.length; t += 3) {
      const o = [0, 1, 2].map((j) => I[t + j] * 3)
      if (Math.abs(N[o[0] + 2]) > 1e-6) continue // the flat top, or a bottom face — not a wall
      walls++
      const top = Math.max(P[o[0] + 2], P[o[1] + 2], P[o[2] + 2])
      assert.ok(top <= 1 + 1e-6, `a wall rises past the ceiling, to ${top}`)
      assert.ok(top >= 1 - 1e-6, `a wall stops ${(1 - top).toFixed(3)} below the ceiling it ends on`)
    }
  }
  assert.ok(walls >= 2, `the lone block drew ${walls} wall triangles`)
})

test('the filling under a run is a closed body, not four walls with no lid', () => {
  // A run whose ground the renderer fills gets a derived wedge: the cell between the ground
  // below and the run's underside, drawn by `chunkMesher`'s `fill` (`rampFillKeys`). **No run
  // in the game asks for one any more** — a 扶梯's piece draws its own body and a 楼梯 leans
  // on the ground it really has, hanging over its own well — so this pins the drawing itself,
  // over a hand-made cut. A filling must be a **closed** shell: a filling cell once counted as
  // solid for its neighbours' exposure, so the cell it stands for reported `up = false` and
  // drew no top face, and the run's body came out as four walls with no lid.
  const cells = []
  for (let x = 0; x <= 8; x++) for (let y = 0; y <= 2; y++) cells.push({ x, y, z: 0, fill: 'solid' })
  const solid = buildSolidSet(cells)
  // Three cells of wedge above the floor, sloping along x like a run climbing over them.
  const cuts = new Map()
  const list = []
  for (const x of [3, 4, 5]) {
    const c = { x, y: 1, z: 1 }
    cuts.set(packKey(c.x, c.y, c.z), { axis: 'x', lo: 0.25, hi: 0.75 })
    list.push(c)
  }
  const fills = rampFillKeys(solid, cuts)
  assert.equal(fills.size, list.length, 'the hand-made cut over ground should be filled')

  const zs = list.map((c) => c.z)
  const chunk = meshChunk(
    solid, finishMapOf(cells), 0, 0, Math.min(...zs), Math.max(...zs),
    new Set(fills), undefined, list, undefined, cuts, fills,
  )
  assert.ok(chunk.triangles > 0, 'the filling drew nothing')

  // A filling cell's body rises **above its own base** — it has walls *and* a lid. The one
  // that failed had walls only: read as solid by the cell below, the cell reported `up =
  // false` and never drew a top face, so the highest thing drawn in it was its own floor.
  for (const c of list) {
    let top = -Infinity
    let offCell = 0
    for (const part of chunk.parts) {
      const P = part.positions
      for (let i = 0; i < P.length; i += 3) {
        const [vx, vy, vz] = [P[i], P[i + 1], P[i + 2]]
        if (vz < c.z - 1e-9 || vz > c.z + 1 + 1e-9) { offCell++; continue }
        // Belongs to this column, in plan.
        if (vx < c.x - 1e-6 || vx > c.x + 1 + 1e-6 || vy < c.y - 1e-6 || vy > c.y + 1 + 1e-6) continue
        top = Math.max(top, vz)
      }
    }
    assert.equal(offCell, 0, `a filling vertex at (${c.x},${c.y},${c.z}) is outside its own cell's storey`)
    // A cut may shave the body right down, so the bar is "clearly above its own base",
    // not "near the ceiling". Walls alone top out at the base itself.
    assert.ok(top > c.z + 0.25, `the filling at (${c.x},${c.y},${c.z}) only reaches ${top}: walls with no lid`)
  }
})
