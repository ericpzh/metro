// The drawn floor surface: a run of blocks is **one flat plane**, and the only edge that
// drops is the one genuinely open to the air — GAME-SPEC §4.2's 12.5 cm bevel.
//
// The mesher used to round and bevel every cell edge whatever stood beside it, so two
// blocks always met along a shared edge that both of them insetted away from: the floor
// came out as a field of shallow cones with a V-groove along every seam and a pit at
// every four-block corner, 12.5 cm deep and plainly visible from above. These tests read
// the height of the drawn surface, because that is the only thing that can tell a groove
// from a smooth floor — a triangle count cannot.
import test from 'node:test'
import assert from 'node:assert/strict'
import { BEVEL, buildSolidSet, meshChunk } from '../src/render/chunkMesher.ts'
import { finishMapOf } from '../src/sim/finishes.ts'
import { packKey } from '../src/sim/types.ts'

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
  // The seam planes between cells, sampled along their **interior** run and a hair to each
  // side. Each seam is only between two blocks over part of its length — the rest is the
  // patch's outer rim, which is meant to be bevelled — so the run is named per seam and
  // kept clear of the rim's own bevel band at both ends.
  const eps = 1e-6
  const lo = 1 + BEVEL + 0.05
  const hi = n - BEVEL - 0.05
  const seams = [
    // x = 1 divides the two columns; between two blocks over y ∈ [1, n].
    { fixed: 1, along: 'y', from: lo, to: hi },
    // y = 1 divides the two rows; between two blocks over x ∈ [1, n].
    { fixed: 1, along: 'x', from: lo, to: hi },
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

test('a whole floor is level, with no hole and no dip anywhere inside its own rim', () => {
  const n = 6
  const tris = floorTris(floorPatch(n))
  let lowest = Infinity
  for (let i = 1; i < 120; i++) {
    for (let j = 1; j < 120; j++) {
      const px = (i / 120) * n
      const py = (j / 120) * n
      // Inside the rim's own 12.5 cm bevel band the surface is meant to drop.
      if (Math.min(px, py, n - px, n - py) <= BEVEL + 0.01) continue
      const z = surfaceAt(tris, px, py)
      assert.notEqual(z, -Infinity, `nothing is drawn over (${px.toFixed(3)}, ${py.toFixed(3)})`)
      lowest = Math.min(lowest, z)
    }
  }
  assert.ok(Math.abs(lowest - 1) < 1e-6, `the floor dips to ${lowest} inside its own rim`)
})

test('a block with a neighbour on every side is a plain cube top: no bevel at all', () => {
  const n = 3
  const tris = floorTris(floorPatch(n))
  // The centre cell shares all four sides, so its top reaches the cell edge everywhere.
  for (const [px, py] of [[1.5, 1.5], [1 + 1e-6, 1.5], [2 - 1e-6, 1.5], [1.5, 1 + 1e-6], [1.5, 2 - 1e-6]]) {
    assert.ok(Math.abs(surfaceAt(tris, px, py) - 1) < 1e-6, `the interior block is bevelled at (${px}, ${py})`)
  }
})

test('the outer edge of the floor keeps its 12.5 cm bevel', () => {
  const n = 3
  const tris = floorTris(floorPatch(n))
  // Right on the rim the bevel's foot sits a full BEVEL below the floor.
  for (const [px, py, what] of [
    [1e-6, 1.5, 'the west rim'],
    [n - 1e-6, 1.5, 'the east rim'],
    [1.5, 1e-6, 'the south rim'],
    [1.5, n - 1e-6, 'the north rim'],
  ]) {
    const z = surfaceAt(tris, px, py)
    assert.ok(Math.abs(z - (1 - BEVEL)) < 1e-4, `${what} should foot at z=${1 - BEVEL}, got ${z}`)
  }
  // And a little way in from it the floor is level again.
  assert.ok(Math.abs(surfaceAt(tris, BEVEL + 0.02, 1.5) - 1) < 1e-6, 'the floor is not level inside the bevel')
})

test('a floor beside a block one level up still meets it with no slit', () => {
  // The step case: the upper block's bevel runs along an edge that is open to the air,
  // while the lower block's lid must still reach the shared cell boundary underneath it.
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

test('every bevelled face is a flat 45° strip that agrees with the normal it is lit by', () => {
  // A lone block wears its chamfer on all four sides. Each chamfer must be **planar**: the
  // triangle's own geometric normal has to match the normal the face is shaded with. A
  // bevel built by offsetting each wall's own line instead of the block's outline is not
  // planar — its two triangles read 0.80 and −0.70 against the authored normal at once —
  // and renders as a hard black wedge along the edge rather than a chamfer.
  const cells = [{ x: 0, y: 0, z: 0, fill: 'solid' }]
  const tris = floorTriangles(cells)
  let sloped = 0
  for (const { v, n } of tris) {
    if (Math.abs(n[2]) < 1e-6) continue // a vertical wall
    if (Math.abs(n[0]) < 1e-6 && Math.abs(n[1]) < 1e-6) continue // the flat top
    sloped++
    const u = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]]
    const w = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]]
    const g = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
    const gm = Math.hypot(...g)
    assert.ok(gm > 1e-9, 'a sloped face is degenerate')
    const dot = (g[0] / gm) * n[0] + (g[1] / gm) * n[1] + (g[2] / gm) * n[2]
    assert.ok(dot > 0.999, `a chamfer triangle faces ${dot.toFixed(3)} against its own normal`)
    // And it really is a 45° chamfer, not a ramp over the floor.
    assert.ok(Math.abs(Math.abs(n[2]) - Math.SQRT1_2) < 1e-6, `a chamfer leans at ${n[2].toFixed(3)}, not 45°`)
  }
  assert.ok(sloped >= 8, `a lone block should wear four chamfers, saw ${sloped} sloped triangles`)
})

test('a chamfer’s texture runs its whole depth, so it meets the flat top seamlessly', () => {
  // The top face samples v ∈ [0, 1]. The chamfer beside it has to arrive at v = 1 where
  // they meet: spanning the chamfer's v over the bevel's 12.5 cm instead leaves it sampling
  // a sliver of the texture, and the join between them draws a hard seam along the edge.
  const cells = [{ x: 0, y: 0, z: 0, fill: 'solid' }]
  const chunk = meshChunk(buildSolidSet(cells), finishMapOf(cells), 0, 0, 0, 0, new Set([packKey(0, 0, 0)]))
  const part = chunk.parts.find((p) => p.finish === 'floor.granite')
  const N = part.normals
  const UV = part.uvs
  for (let i = 0; i < N.length; i += 3) {
    const nx = N[i]
    const ny = N[i + 1]
    const nz = N[i + 2]
    if (Math.abs(nz) < 1e-6 || (Math.abs(nx) < 1e-6 && Math.abs(ny) < 1e-6)) continue
    const v = UV[(i / 3) * 2 + 1]
    assert.ok(v <= 1 + 1e-9 && v >= -1e-9, `a chamfer texel sits at v=${v}`)
  }
  // The chamfer reaches v = 1 somewhere, which is the join with the top face.
  let maxV = -Infinity
  for (let i = 0; i < N.length; i += 3) {
    const nz = N[i + 2]
    if (Math.abs(nz) < 1e-6) continue
    if (Math.abs(N[i]) < 1e-6 && Math.abs(N[i + 1]) < 1e-6) continue
    maxV = Math.max(maxV, UV[(i / 3) * 2 + 1])
  }
  assert.ok(Math.abs(maxV - 1) < 1e-6, `the chamfer stops at v=${maxV}, so its texture does not meet the top's`)
})
