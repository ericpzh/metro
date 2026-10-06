// The 选择 tool's route preview, as geometry (§9.5).
//
// One selected passenger's remaining walk is a polyline of graph nodes, and the
// line the game paints for it is a **ribbon lying on the walk surface** rather
// than a `THREE.Line`: a 1-pixel line has no width to speak of at a station
// scale, and a preview that is meant to read as paint on the floor has to have
// the floor's own plane.
//
// Every segment is a quad whose width runs along `side = normalize(d × up)` and
// which is lifted a hair along `normal = side × d`. That is the whole trick: for
// a horizontal segment the quad is flat on the floor, and for a sloped one (a
// 楼梯 or 扶梯 in the route) it lies in the run's own plane, because `side` is
// the slope's horizontal strike and `d` is the run. A flat quad at the segment's
// average height would instead sink into the treads at both ends.
//
// The joints are filled, so a bend has no notch: at each interior waypoint a
// square of the ribbon's own width is laid in the frame of the average
// direction, and every corner the two neighbouring quads leave behind is inside
// the disc that square contains.
//
// Three-free and allocation-free on purpose: the scene hands in its own buffer
// and takes back a quad count, so a preview that follows a walking passenger
// every frame mints no garbage, and the arithmetic is checkable in Node
// (`test/agent-route.test.mjs`).

/** How wide the painted line is, m. Narrow enough to read as a route, wide enough to see. */
export const ROUTE_WIDTH = 0.18

/** How far the ribbon floats above the walk surface, m — above the floor decals. */
export const ROUTE_LIFT = 0.045

/** Vertices one quad of the ribbon is made of. */
export const ROUTE_QUAD_VERTS = 4

/** Indices one quad of the ribbon is made of. */
export const ROUTE_QUAD_INDICES = 6

/** A route longer than this is clamped: 1 km of 1 m nodes is not a station any more. */
export const ROUTE_MAX_POINTS = 1024

/** The most quads `ROUTE_MAX_POINTS` can produce — one per segment, one per joint. */
export const ROUTE_MAX_QUADS = 2 * ROUTE_MAX_POINTS

/**
 * The writer's own frame scratch. Module state rather than per-call allocation:
 * the preview follows one walking passenger and is rewritten every frame, so the
 * writer has to mint nothing to hold that promise (the scene's buffer and draw
 * range are the caller's; this is the only thing left that could be garbage).
 */
const SIDE = new Float64Array(3)
const NORMAL = new Float64Array(3)

/** How many quads a polyline of `pointCount` points produces. */
export function routeQuadCount(pointCount: number): number {
  if (pointCount < 2) return 0
  return pointCount - 1 + (pointCount - 2)
}

/**
 * The index buffer of a ribbon of up to `maxQuads` quads. The pattern is fixed —
 * quad `k` is vertices `4k..4k+3` — so it is built once for the largest route the
 * scene will ever draw and the used part is chosen with the draw range.
 */
export function routeIndices(maxQuads: number): Uint32Array {
  const out = new Uint32Array(maxQuads * ROUTE_QUAD_INDICES)
  for (let q = 0; q < maxQuads; q++) {
    const v = q * ROUTE_QUAD_VERTS
    const o = q * ROUTE_QUAD_INDICES
    out[o] = v
    out[o + 1] = v + 1
    out[o + 2] = v + 2
    out[o + 3] = v
    out[o + 4] = v + 2
    out[o + 5] = v + 3
  }
  return out
}

/** A ribbon's own frame at one direction: the width axis and the surface normal. */
function frame(dx: number, dy: number, dz: number, side: Float64Array, normal: Float64Array): void {  // side = normalize(d x up), up = +z. A segment that climbs straight up (a lift
  // shaft is the only one) has no horizontal strike, so it takes +x and the
  // ribbon stands on edge instead of collapsing to nothing.
  side[0] = dy
  side[1] = -dx
  side[2] = 0
  const len = Math.hypot(side[0], side[1])
  if (len < 1e-6) {
    side[0] = 1
    side[1] = 0
  } else {
    side[0] /= len
    side[1] /= len
  }
  // normal = side x d, which is unit because side is unit and perpendicular to d.
  normal[0] = side[1] * dz
  normal[1] = -side[0] * dz
  normal[2] = side[0] * dy - side[1] * dx
}

/**
 * Write the ribbon for `points` (xyz triples) into `out`, returning the number of
 * quads written. `out` is the scene's own buffer and must hold
 * `routeQuadCount(n) * ROUTE_QUAD_VERTS * 3` floats for the `n` written — which
 * is why the **cap is enforced here** and not left to the caller: the scene sizes
 * that buffer from `ROUTE_MAX_QUADS`, so a longer polyline handed in would run
 * off the end of a typed array, which drops the tail in silence and leaves the
 * draw range reading stale quads.
 */
export function writeRouteRibbon(points: Float32Array, out: Float32Array, width = ROUTE_WIDTH, lift = ROUTE_LIFT): number {
  const n = Math.min(Math.floor(points.length / 3), ROUTE_MAX_POINTS)
  if (n < 2) return 0
  const half = width / 2
  const side = SIDE
  const normal = NORMAL
  let quads = 0

  /** One quad, as four corners in order (front-left, front-right, back-right, back-left). */
  const quad = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number,
  ): void => {
    const o = quads * ROUTE_QUAD_VERTS * 3
    out[o] = ax; out[o + 1] = ay; out[o + 2] = az
    out[o + 3] = bx; out[o + 4] = by; out[o + 5] = bz
    out[o + 6] = cx; out[o + 7] = cy; out[o + 8] = cz
    out[o + 9] = dx; out[o + 10] = dy; out[o + 11] = dz
    quads++
  }

  // The segments: from each waypoint to the next, in its own frame.
  for (let i = 0; i + 1 < n; i++) {
    const a = i * 3
    const b = a + 3
    let dx = points[b] - points[a]
    let dy = points[b + 1] - points[a + 1]
    let dz = points[b + 2] - points[a + 2]
    const len = Math.hypot(dx, dy, dz)
    if (len < 1e-6) continue
    dx /= len
    dy /= len
    dz /= len
    frame(dx, dy, dz, side, normal)
    const liftX = normal[0] * lift
    const liftY = normal[1] * lift
    const liftZ = normal[2] * lift
    const px = points[a] + liftX
    const py = points[a + 1] + liftY
    const pz = points[a + 2] + liftZ
    const qx = points[b] + liftX
    const qy = points[b + 1] + liftY
    const qz = points[b + 2] + liftZ
    const sx = side[0] * half
    const sy = side[1] * half
    quad(
      px + sx, py + sy, pz,
      px - sx, py - sy, pz,
      qx - sx, qy - sy, qz,
      qx + sx, qy + sy, qz,
    )
  }

  // The joints: a square of the ribbon's width at every interior waypoint, in the
  // frame of the direction the walk turns through, so a bend has no notch.
  for (let i = 1; i + 1 < n; i++) {
    const p = i * 3
    const prev = p - 3
    const next = p + 3
    let inX = points[p] - points[prev]
    let inY = points[p + 1] - points[prev + 1]
    let inZ = points[p + 2] - points[prev + 2]
    let outX = points[next] - points[p]
    let outY = points[next + 1] - points[p + 1]
    let outZ = points[next + 2] - points[p + 2]
    const inLen = Math.hypot(inX, inY, inZ)
    const outLen = Math.hypot(outX, outY, outZ)
    if (inLen < 1e-6 || outLen < 1e-6) continue
    inX /= inLen; inY /= inLen; inZ /= inLen
    outX /= outLen; outY /= outLen; outZ /= outLen
    let dx = inX + outX
    let dy = inY + outY
    let dz = inZ + outZ
    const len = Math.hypot(dx, dy, dz)
    // A waypoint the walk doubles back through has no average direction, so the
    // incoming one is the turn: the square still covers the corner either way.
    if (len < 1e-6) {
      dx = inX; dy = inY; dz = inZ
    } else {
      dx /= len; dy /= len; dz /= len
    }
    frame(dx, dy, dz, side, normal)
    const cx = points[p] + normal[0] * lift
    const cy = points[p + 1] + normal[1] * lift
    const cz = points[p + 2] + normal[2] * lift
    const sx = side[0] * half
    const sy = side[1] * half
    const ax = dx * half
    const ay = dy * half
    const az = dz * half
    quad(
      cx + sx + ax, cy + sy + ay, cz + az,
      cx - sx + ax, cy - sy + ay, cz + az,
      cx - sx - ax, cy - sy - ay, cz - az,
      cx + sx - ax, cy + sy - ay, cz - az,
    )
  }

  return quads
}
