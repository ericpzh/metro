// Chunk mesher — GAME-SPEC.md §4.2, the V1 gate (PLAN.md §4 V1).
//
// One block = one 1 m cell with six faces. For every solid cell we build a
// *rounded* cross-section profile from its 8-neighbour exposure mask, extrude it
// from z to z+1, and chamfer the exposed top rim by 12.5 cm. Inner fillets are
// dropped on purpose: PLAN.md R2 names "bevels-only on exposed edges" as the
// fallback, and a flat renderer gains nothing from the inner detail.
//
// The mesh is merged per 16^3 chunk into a single BufferGeometry, and faces
// between two solid cells are never emitted.
//
// Coordinate convention: cell (x, y, z) occupies [x, x+1] x [y, y+1] x [z, z+1],
// +z up.

import { HALF_WALL_T } from '../sim/constants.ts'
import { DEFAULT_FINISH, FINISH_LIST, RAMP_SOFFIT_FINISH } from '../sim/finishes.ts'
import type { SlopeCut } from '../sim/openings.ts'
import { isHalfWallShape, isTriangleShape, packKey as key, triangleSlopeFace } from '../sim/types.ts'
import type { Cell, CellShape, Face, FinishId, TriangleKind, TriSide, WallSide } from '../sim/types.ts'

/** Finish id -> a small dense index, so a hot loop never does a string Map get. */
const FINISH_IDS: FinishId[] = FINISH_LIST.map((f) => f.id)
const FINISH_INDEX = new Map<FinishId, number>(FINISH_IDS.map((id, i) => [id, i]))
/**
 * Index for a finish id, handing out a new slot the first time a custom-tinted
 * id (`wall.enamel#2f7ef2`) is seen. The stock list keeps stable indices; a
 * painted colour is a distinct finish with its own material, so it must not
 * fold back into the default — that is what would make every enamel wall blue.
 */
function finishIdx(id: FinishId): number {
  let i = FINISH_INDEX.get(id)
  if (i === undefined) {
    i = FINISH_IDS.length
    FINISH_INDEX.set(id, i)
    FINISH_IDS.push(id)
  }
  return i
}

// The common case is an unpainted cell: use shared default indices and skip the
// four Map lookups entirely.
const DEFAULT_TOP_I = finishIdx(DEFAULT_FINISH.top)
const DEFAULT_BOTTOM_I = finishIdx(DEFAULT_FINISH.bottom)
const DEFAULT_SIDE_I: Record<'e' | 'w' | 'n' | 's', number> = {
  e: finishIdx(DEFAULT_FINISH.e),
  w: finishIdx(DEFAULT_FINISH.w),
  n: finishIdx(DEFAULT_FINISH.n),
  s: finishIdx(DEFAULT_FINISH.s),
}

export const CHUNK = 16
/** Top-rim chamfer, metres. "12.5 cm bevel on exposed top edges" — GAME-SPEC §4.2. */
export const BEVEL = 0.125

/** One merged run of faces wearing the same finish (§4.3). */
export interface ChunkPart {
  finish: FinishId
  positions: Float32Array
  normals: Float32Array
  colors: Float32Array
  uvs: Float32Array
  indices: Uint32Array
  triangles: number
}

export interface ChunkGeometry {
  /** Geometry grouped by finish, so one material can be drawn per part. */
  parts: ChunkPart[]
  /** Cell coordinates this chunk covers, for the level/ghost logic. */
  cx: number
  cy: number
  cz: number
  triangles: number
  /** How long the build took, ms — measured against the §10.4 budget. */
  ms: number
}

/** A point in a cell's own 1 m frame, as the profile walks it. */
interface Pt {
  x: number
  y: number
}

export function buildSolidSet(cells: readonly Cell[]): Set<number> {
  const s = new Set<number>()
  for (const c of cells) if (c.fill === 'solid') s.add(key(c.x, c.y, c.z))
  return s
}

interface VecBuilder {
  pos: number[]
  nor: number[]
  col: number[]
  uv: number[]
  idx: number[]
}

function pushQuad(
  b: VecBuilder,
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  p3: [number, number, number],
  n: [number, number, number],
  ao: [number, number, number, number],
  u0: number,
  v0: number,
  u1: number,
  v1: number,
): void {
  const base = b.pos.length / 3
  b.pos.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2])
  for (let i = 0; i < 4; i++) b.nor.push(n[0], n[1], n[2])
  b.col.push(ao[0], ao[0], ao[0], ao[1], ao[1], ao[1], ao[2], ao[2], ao[2], ao[3], ao[3], ao[3])
  b.uv.push(u0, v0, u1, v0, u1, v1, u0, v1)
  b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
}

function pushTri(
  b: VecBuilder,
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  n: [number, number, number],
  ao: number,
  uv: [number, number][],
): void {
  const base = b.pos.length / 3
  b.pos.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2])
  for (let i = 0; i < 3; i++) {
    b.nor.push(n[0], n[1], n[2])
    b.col.push(ao, ao, ao)
    b.uv.push(uv[i][0], uv[i][1])
  }
  b.idx.push(base, base + 1, base + 2)
}

/**
 * Push a convex face wound so it **faces `n`**, whatever order the corners were handed in.
 *
 * A bevel's corner triangle is the one place the right order is not obvious: the block's
 * outer corner, one neighbouring miter step and the other sit in three different planes, and
 * which way round they read flips with the corner. Measuring the ring's signed area about
 * `n` and reversing when it comes out negative is one line and cannot be got wrong, where
 * writing the order out per corner is a table that goes wrong quietly — the face then draws
 * as a black hole from the side it should be lit. Each corner carries its own UV, so a
 * reversal takes the texture with it.
 */
function pushFaceOut(
  b: VecBuilder,
  pts: Array<[number, number, number]>,
  uvs: Array<[number, number]>,
  n: [number, number, number],
  ao: number,
): void {
  let turn = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    turn += (p[1] * q[2] - p[2] * q[1]) * n[0] + (p[2] * q[0] - p[0] * q[2]) * n[1] + (p[0] * q[1] - p[1] * q[0]) * n[2]
  }
  const ring = turn >= 0 ? pts : [...pts].reverse()
  const uv = turn >= 0 ? uvs : [...uvs].reverse()
  if (ring.length === 3) {
    pushTri(b, ring[0], ring[1], ring[2], n, ao, uv)
    return
  }
  const base = b.pos.length / 3
  b.pos.push(ring[0][0], ring[0][1], ring[0][2], ring[1][0], ring[1][1], ring[1][2], ring[2][0], ring[2][1], ring[2][2], ring[3][0], ring[3][1], ring[3][2])
  for (let i = 0; i < 4; i++) {
    b.nor.push(n[0], n[1], n[2])
    b.col.push(ao, ao, ao)
    b.uv.push(uv[i][0], uv[i][1])
  }
  b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
}

/**
 * The cross-section of a run's **drawn body** where it is narrower than the cell — an
 * escalator's truss box, `half` either side of its centreline across the run and the full
 * width of the tile along it. Sharp corners, because the body is a slab and not a block: the
 * profile a block gets, with the bevel, would read as a pillar under the escalator. Every
 * side of it is exposed, so it wears the run's steel all round and the top is inset on all
 * four sides like any other block's.
 *
 * `axis` is the plane's slope axis, which is the way the run travels, so the box is that
 * long along `axis` and `2 × half` across it. The two ends land on the cell boundary, where
 * the next tile's box carries on and hides them inside the union, so the skirt needs no
 * neighbour test to look continuous.
 */
function buildTrussProfile(axis: 'x' | 'y', half: number): Profile {
  const lo = 0.5 - half
  const hi = 0.5 + half
  const corners: Array<[number, number]> =
    axis === 'x'
      ? [
          [0, hi],
          [0, lo],
          [1, lo],
          [1, hi],
        ]
      : [
          [lo, 1],
          [lo, 0],
          [hi, 0],
          [hi, 1],
        ]
  const edges: ProfileEdge[] = []
  for (let i = 0; i < 4; i++) {
    const from: Pt = { x: corners[i][0], y: corners[i][1] }
    const to: Pt = { x: corners[(i + 1) % 4][0], y: corners[(i + 1) % 4][1] }
    const dx = to.x - from.x
    const dy = to.y - from.y
    const m = Math.hypot(dx, dy) || 1
    edges.push({ from, to, nx: dy / m, ny: -dx / m, exposed: true, inset: BEVEL })
  }
  return { edges }
}

/**
 * Every face of a run's truss box wears the run's own steel (`RAMP_SOFFIT_FINISH`) — one
 * shared record, so the mesher's hot loop never allocates one per filling cell.
 */
const TRUSS_FACES: Partial<Record<Face, FinishId>> = {
  top: RAMP_SOFFIT_FINISH,
  bottom: RAMP_SOFFIT_FINISH,
  e: RAMP_SOFFIT_FINISH,
  w: RAMP_SOFFIT_FINISH,
  n: RAMP_SOFFIT_FINISH,
  s: RAMP_SOFFIT_FINISH,
}

/**
 * Which of a cell's four sides is open to the air **at this cell's own height**: `false`
 * means a solid neighbour shares that side. A side merely having another cell above or
 * below it is not this — a block under a floor is still open on a side the floor does not
 * reach, so it keeps its bevel there.
 */
export interface Look {
  e: boolean
  w: boolean
  n: boolean
  s: boolean
}

/** One side of a cell's cross-section, as the profile walks it counter-clockwise. */
export interface ProfileEdge {
  from: Pt
  to: Pt
  /** Outward normal of this side, in cell-local units. */
  nx: number
  ny: number
  /** Open to the air, so this side wears a wall and the bevel above it. */
  exposed: boolean
  /** How far this side's top edge is pulled in: the bevel when exposed, flush when shared. */
  inset: number
}

/**
 * A solid cell's cross-section, as the four sides walked counter-clockwise seen from +z.
 *
 * Everything about how a block is drawn follows from this one list: which wall runs it
 * emits, how far the top face is inset, and which sides are flush with the block next door.
 */
export interface Profile {
  edges: ProfileEdge[]
}

/**
 * Build the cross-section of one cell, walked counter-clockwise from its north-west corner:
 * west, south, east, north.
 *
 * **A side a solid neighbour shares is flush.** That is the whole point of the shape. An
 * earlier version rounded and bevelled every cell edge whatever stood beside it, so two
 * blocks always met along a shared edge that both of them insetted away from: a floor came
 * out as a field of shallow cones with a V-groove along every seam and a pit at every
 * four-block corner, twelve and a half centimetres deep and plainly visible from above.
 * A shared side now draws nothing at all — no wall (the neighbour is the same building) and
 * no bevel — so the two top faces are the one flat plane all the way across.
 *
 * The rounding that went with it is the corner arc. §4.2 asks for rounded outer corners
 * *and* a 12.5 cm top bevel, and at a 12.5 cm corner radius those two cannot both exist:
 * the inset of the corner by the bevel collapses it to a point exactly where the bevel
 * ends. The bevel is the one the spec pins a number to, and a flat, seamless floor is what
 * it is for, so the outline above it is a plain square.
 */
function buildProfile(look: Look): Profile {
  // Corner i is the start of side i: NW, SW, SE, NE.
  const corner = (i: number): Pt => ({ x: i === 2 || i === 3 ? 1 : 0, y: i === 0 || i === 3 ? 1 : 0 })
  const open = [look.w, look.s, look.e, look.n]
  const edges: ProfileEdge[] = []
  for (let i = 0; i < 4; i++) {
    const from = corner(i)
    const to = corner((i + 1) % 4)
    const dx = to.x - from.x
    const dy = to.y - from.y
    const m = Math.hypot(dx, dy) || 1
    // Outward is the walk turned a quarter clockwise, which is already away from the cell.
    edges.push({
      from,
      to,
      nx: dy / m,
      ny: -dx / m,
      exposed: open[i],
      inset: open[i] ? BEVEL : 0,
    })
  }
  return { edges }
}

/** The outline a profile walks, for a caller that needs the polygon rather than the sides. */
function profileOutline(profile: Profile): Pt[] {
  return profile.edges.map((e) => e.from)
}

/**
 * The top face's boundary: the block's own convex outline inset by `BEVEL` on every side
 * that is open to the air, and untouched on every side it shares with a neighbour.
 *
 * Insetting the *outline* is what keeps each bevel a **flat 45° strip**. Offsetting each
 * wall's line on its own instead — which is what this did — sounds equivalent and is not:
 * a wall's inner line then runs the whole cell edge, so the chamfer over the west side
 * leaves the cell boundary at the north-west corner and arrives at the south-east one, a
 * diagonal sail across the floor rather than a bevel. That surface is not even planar, so
 * the two triangles it is split into disagree with the normal it is lit by (dots of 0.80
 * and −0.70 at the same time), and it is why a bevelled edge read as a row of hard black
 * wedges instead of a chamfer. On the outline the corner between two open sides is a
 * mitre: its two cells each step in by `BEVEL`, exactly what a chamfer's corner looks like.
 *
 * `ring[i]` is the inner end of the wall `edges[i]` draws, so a chamfer is the quad from
 * that wall out to this ring — `edges[i].to` to `edges[i + 1].from` — and the two open
 * sides at a convex corner close with one small triangle between their two mitre steps.
 */
function profileRing(profile: Profile): Pt[] {
  const edges = profile.edges
  // `ring[i]` is the inner end of wall `i` — the corner that wall runs to. Only that
  // wall's own inset moves it, so the west wall's inner line stays at x = BEVEL for its
  // whole length instead of being dragged along the neighbouring walls.
  return edges.map((e) => ({ x: e.to.x - e.nx * e.inset, y: e.to.y - e.ny * e.inset }))
}

/* -------------------------------------------------------- 半墙 (§4.1 / §4.3) */

/** A quarter-turn clockwise, in the plan (as a `WallDir`/`WallSide` step). */
const SIDE_CW: Record<WallSide, WallSide> = { n: 'e', e: 's', s: 'w', w: 'n' }

/** Clockwise quarter-turns from the canonical (south-flush) frame to `side`. */
const SIDE_TURNS: Record<WallSide, number> = { s: 0, w: 1, n: 2, e: 3 }

function sideTurned(side: WallSide, turns: number): WallSide {
  let out = side
  for (let i = 0; i < turns; i++) out = SIDE_CW[out]
  return out
}

/** A profile point turned `turns` clockwise about the cell centre. */
function turnPoint(p: Pt, turns: number): Pt {
  switch (turns) {
    case 1:
      return { x: p.y, y: 1 - p.x }
    case 2:
      return { x: 1 - p.x, y: 1 - p.y }
    case 3:
      return { x: 1 - p.y, y: p.x }
    default:
      return p
  }
}

/** A normal turned `turns` clockwise about the cell centre: the same rigid turn, no offset. */
function turnNormal(nx: number, ny: number, turns: number): { nx: number; ny: number } {
  switch (turns) {
    case 1:
      return { nx: ny, ny: -nx }
    case 2:
      return { nx: -nx, ny: -ny }
    case 3:
      return { nx: -ny, ny: nx }
    default:
      return { nx, ny }
  }
}

/**
 * The part of a profile a cut plane still has block in, as a polygon
 * (Sutherland–Hodgman against one linear half-space).
 *
 * A run's underside slopes, so on the block that straddles the point where it
 * leaves through the cell's floor the cut takes the block to nothing at one side.
 * The clipped polygon carries a vertex exactly on that line, so the top cap and the
 * side walls meet the floor there instead of chording across the corner — which is
 * what would poke the block back up through the run it was cut out of.
 *
 * `value` is the plane in cell-local units, so "still block here" is `value > 0`.
 */
function clipProfile(profile: Pt[], value: (p: Pt) => number): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < profile.length; i++) {
    const p = profile[i]
    const q = profile[(i + 1) % profile.length]
    const vp = value(p)
    const vq = value(q)
    if (vp > 0) out.push(p)
    if (vp > 0 !== vq > 0) {
      const t = vp / (vp - vq)
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t })
    }
  }
  return out
}

/* -------------------------------------------------------- 三角 (§4.1 / §4.3) */

/**
 * The frame a **三角** wedge is written in, for the side it hugs: `ox`/`oy` are the
 * cell edge on that side, `ux`/`uy` the direction the cut runs **into** the cell
 * (away from the full-height face) and `vx`/`vy` the direction along the ridge — the
 * axis the wedge is *not* cut across, which is where its two triangular ends land.
 *
 * `u` is the cut's own coordinate: 0 on the full-height face, 1 on the opposite cell
 * boundary. Everything about the piece is one line in `u` and `z`, so the eight
 * wedges are one shape in eight frames rather than eight shapes — which is the whole
 * reason the orientation cannot drift from the tag that names it.
 */
const TRI_FRAME: Record<TriSide, { ox: number; oy: number; ux: number; uy: number; vx: number; vy: number }> = {
  e: { ox: 1, oy: 0, ux: -1, uy: 0, vx: 0, vy: 1 },
  w: { ox: 0, oy: 0, ux: 1, uy: 0, vx: 0, vy: 1 },
  n: { ox: 0, oy: 1, ux: 0, uy: -1, vx: 1, vy: 0 },
  s: { ox: 0, oy: 0, ux: 0, uy: 1, vx: 1, vy: 0 },
}

/**
 * The plane a **三角**'s slope lies on, in cell-local units: its outward normal, the
 * direction it falls along its cut, and the direction along the ridge. The plane passes
 * through the cell's own centre, so this is everything a caller needs to put something
 * **on the diagonal** rather than on the cell boundary — which is where a preview drawn
 * from the cell alone would float a metre off the surface it promises.
 *
 * It is read from the same `TRI_FRAME` the mesh is written in, and `pushWedge` draws the
 * slope from it too, so a quad `GhostSystem` lays on a wedge cannot disagree with the
 * surface the 材质 brush will paint.
 */
export function wedgeSlope(kind: TriangleKind, side: TriSide): {
  normal: [number, number, number]
  along: [number, number, number]
  ridge: [number, number, number]
} {
  const F = TRI_FRAME[side]
  const s = Math.SQRT1_2
  // 45° in elevation: the normal leans up and away from the hugged face for 上 (and
  // down for 下). `along` is then the ridge turned a quarter-turn onto the slope —
  // `ridge × normal` rather than the fall read off the frame, so the three are a
  // **right-handed** frame whichever way the slope faces (the order `makeBasis` wants),
  // and the quad built from them lands on the diagonal instead of folding through it.
  const up = kind === 'upper' ? 1 : -1
  const normal: [number, number, number] = [F.ux * s, F.uy * s, up * s]
  const ridge: [number, number, number] = [F.vx, F.vy, 0]
  const along: [number, number, number] = [
    ridge[1] * normal[2] - ridge[2] * normal[1],
    ridge[2] * normal[0] - ridge[0] * normal[2],
    ridge[0] * normal[1] - ridge[1] * normal[0],
  ]
  return { normal, along, ridge }
}

/**
 * Per-vertex UVs of a face, in its own metres: `u` along its first edge and `v`
 * square to it, so a triangular end or a slope carries the same texel density as the
 * walls the profile path builds.
 */
function faceUv(pts: Array<[number, number, number]>, n: [number, number, number]): Array<[number, number]> {
  const [px, py, pz] = pts[0]
  const ex = [pts[1][0] - px, pts[1][1] - py, pts[1][2] - pz]
  const len = Math.hypot(ex[0], ex[1], ex[2]) || 1
  for (let i = 0; i < 3; i++) ex[i] /= len
  const fx = [n[1] * ex[2] - n[2] * ex[1], n[2] * ex[0] - n[0] * ex[2], n[0] * ex[1] - n[1] * ex[0]]
  return pts.map((p) => [
    (p[0] - px) * ex[0] + (p[1] - py) * ex[1] + (p[2] - pz) * ex[2],
    (p[0] - px) * fx[0] + (p[1] - py) * fx[1] + (p[2] - pz) * fx[2],
  ])
}

/**
 * Push one convex face, wound CCW seen from outside **whatever order its corners
 * came in**.
 *
 * A wedge's five faces live in three different planes, and the `(u, v)` frame flips
 * handedness with the side the block hugs, so writing out the winding per
 * orientation is a table of eight that can be wrong quietly. The winding is measured
 * against the face's own normal instead — by the signed area of the ring about it —
 * and `test/triangle.test.mjs` pins the result for all eight pieces.
 */
function pushFace(b: VecBuilder, pts: Array<[number, number, number]>, n: [number, number, number], ao: number): void {
  let turn = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    turn += (p[1] * q[2] - p[2] * q[1]) * n[0] + (p[2] * q[0] - p[0] * q[2]) * n[1] + (p[0] * q[1] - p[1] * q[0]) * n[2]
  }
  const ring = turn >= 0 ? pts : [...pts].reverse()
  if (ring.length === 3) {
    pushTri(b, ring[0], ring[1], ring[2], n, ao, faceUv(ring, n))
    return
  }
  const u = Math.hypot(ring[1][0] - ring[0][0], ring[1][1] - ring[0][1], ring[1][2] - ring[0][2])
  const v = Math.hypot(ring[2][0] - ring[1][0], ring[2][1] - ring[1][1], ring[2][2] - ring[1][2])
  pushQuad(b, ring[0], ring[1], ring[2], ring[3], n, [ao, ao, ao, ao], 0, 0, u, v)
}

/**
 * The five faces of a **三角** wedge, each pushed into the builder of the finish it
 * wears (`meshChunk`'s own `builderForIndex`).
 *
 * The piece is the cell cut on a 45° plane in elevation, so it is a triangular
 * prism: a flat 1 m square **in the X-Y plane** — the floor for `upper`, the ceiling
 * for `lower` — a full-height square face on the side the block hugs, the 45° slope
 * across the cell, and the two triangular ends the slope cuts on the ridge axis. Its
 * faces are the shape's own, not the cell's: the slope leans, the ends are triangles,
 * and there is nothing to chamfer — the block is sawn, so a rounded rim would read as
 * a lozenge rather than as the cut the player asked for.
 *
 * A face is drawn where the cell it looks into is empty. The slope has no neighbour
 * to be flush with, so it is always drawn — and a wedge embedded in solid blocks
 * loses the rest of its surface to its neighbours' culling all the same. It is a
 * surface of the piece rather than of the cell, which is why its finish is named by
 * `triangleSlopeFace` and not by the exposure of the cell it leans to.
 */
function pushWedge(
  builderForIndex: (i: number) => VecBuilder,
  isSolid: (x: number, y: number, z: number) => boolean,
  x: number,
  y: number,
  z: number,
  open: { e: boolean; w: boolean; n: boolean; s: boolean; up: boolean; down: boolean },
  kind: TriangleKind,
  side: TriSide,
  fin: { top: number; bottom: number; side: Record<'e' | 'w' | 'n' | 's', number> },
): void {
  const F = TRI_FRAME[side]
  const upper = kind === 'upper'
  const at = (u: number, v: number, h: number): [number, number, number] => [
    x + F.ox + F.ux * u + F.vx * v,
    y + F.oy + F.uy * u + F.vy * v,
    z + h,
  ]
  /**
   * The finish a face wears, read off its own normal the way the 材质 brush reads the
   * surface under the pointer (`render/pickCell.ts` `faceAxis`: the axis the normal
   * most points along, ties going vertical). Only the wedge's **axis-aligned** faces
   * come through here — the hugged square, the base and the two ends. The slope names
   * its slot directly (`triangleSlopeFace`, below), because a 45° normal ties on two
   * axes and the rule for it has to be the *one* the brush's `facePresent` offers it by.
   */
  const finishOf = (n: [number, number, number]): number => {
    const ax = Math.abs(n[0])
    const ay = Math.abs(n[1])
    const az = Math.abs(n[2])
    if (az >= ax && az >= ay) return n[2] >= 0 ? fin.top : fin.bottom
    return fin.side[sideOf(n[0], n[1])]
  }
  const face = (pts: Array<[number, number, number]>, n: [number, number, number], ao: number): void =>
    pushFace(builderForIndex(finishOf(n)), pts, n, ao)

  // 1. The full-height face on the side the block hugs — what the piece is aimed
  //    with, and the one surface a run of them shares with the wall behind it.
  if (open[side]) {
    const n: [number, number, number] = [-F.ux, -F.uy, 0]
    face([at(0, 0, 0), at(0, 1, 0), at(0, 1, 1), at(0, 0, 1)], n, wallAo(isSolid, x, y, z, n[0], n[1]))
  }
  // 2. The flat square: the piece's base in the X-Y plane — the floor it stands on
  //    for 上, the ceiling it hangs from for 下. It is the cell's own top or bottom
  //    face, so its exposure is the storey boundary's.
  const base = upper ? open.down : open.up
  const baseH = upper ? 0 : 1
  if (base) {
    const n: [number, number, number] = [0, 0, upper ? -1 : 1]
    const ao = upper ? 0.6 : topAoAt(isSolid, x, y, z)
    face([at(0, 0, baseH), at(1, 0, baseH), at(1, 1, baseH), at(0, 1, baseH)], n, ao)
  }
  // 3. The two triangular ends, one on each cell face across the ridge. The wrapped
  //    face is the square's own section: the hugged edge, the floor, the slope — or
  //    for 下 the hugged edge, the ceiling, and the slope under it.
  const ends: Array<[boolean, [number, number, number]]> = F.vx === 1
    ? [
        [open.w, [-1, 0, 0]],
        [open.e, [1, 0, 0]],
      ]
    : [
        [open.s, [0, -1, 0]],
        [open.n, [0, 1, 0]],
      ]
  for (const [shown, n] of ends) {
    if (!shown) continue
    const v = n[0] + n[1] > 0 ? 1 : 0
    const ao = wallAo(isSolid, x, y, z, n[0], n[1])
    face(upper ? [at(0, v, 0), at(1, v, 0), at(0, v, 1)] : [at(0, v, 0), at(0, v, 1), at(1, v, 1)], n, ao)
  }
  // 4. The 45° slope itself: up and away from the hugged face for 上, down and away
  //    for 下 — always drawn, because there is no cell face it could be flush with.
  //    Its finish is the cell's own horizontal slot, `triangleSlopeFace`: the face the
  //    diagonal leans to, which is also the one the pointer reads off its normal, so
  //    the surface drawn here is the surface the brush offers (`facePresent`).
  const slopeAo = upper ? topAoAt(isSolid, x, y, z) : wallAo(isSolid, x, y, z, F.ux, F.uy)
  pushFace(
    builderForIndex(fin[triangleSlopeFace(kind)]),
    upper ? [at(0, 0, 1), at(1, 0, 0), at(1, 1, 0), at(0, 1, 1)] : [at(0, 0, 0), at(1, 0, 1), at(1, 1, 1), at(0, 1, 0)],
    wedgeSlope(kind, side).normal,
    slopeAo,
  )
}

/**
 * The cross-section of a **半墙** cell: the same profile a full cell gets, squashed to
 * `HALF_WALL_T` and turned so the half it keeps is the one flush to the side the panel
 * hugs (`halfWallSide`). The panel's **inner** face — the one looking across the cell's
 * own clear half — is always built, because it is a surface inside this cell that nothing
 * can stand across; that is the face the half-block walls of a facility room have always
 * been read on, and the one the paint brush aims at. Its two ends take the exposure of the
 * neighbours they meet, so the columns of one run join with no face between them, and its
 * outer face is the side itself.
 *
 * The squash happens in the canonical frame before the turn, so the bevel stays where the
 * profile put it: 12.5 cm along the wall, half that through it. The turn is rigid, so a
 * west-facing panel is this profile turned a quarter-turn, not a second shape.
 */
function buildThinProfile(side: WallSide, E: boolean, W: boolean, N: boolean, S: boolean): Profile {
  const turns = SIDE_TURNS[side]
  const solid: Record<WallSide, boolean> = { n: N, e: E, s: S, w: W }
  // The canonical panel is flush to the south edge: outer face south, inner face
  // north (always exposed), its two ends east and west.
  const canon = buildProfile({
    e: solid[sideTurned('e', turns)],
    w: solid[sideTurned('w', turns)],
    n: true,
    s: solid[side],
  })
  return {
    edges: canon.edges.map((e) => {
      const from = turnPoint({ x: e.from.x, y: e.from.y * HALF_WALL_T }, turns)
      const to = turnPoint({ x: e.to.x, y: e.to.y * HALF_WALL_T }, turns)
      // The squash is anisotropic, so the normal turns and then has to be renormalised:
      // a normal across the panel is 1/HALF_WALL_T long after it, and the bevel with it
      // is the same 12.5 cm measured through the panel rather than along the wall.
      const n = turnNormal(e.nx, e.ny * HALF_WALL_T, turns)
      const m = Math.hypot(n.nx, n.ny) || 1
      return { from, to, nx: n.nx / m, ny: n.ny / m, exposed: e.exposed, inset: e.inset / m }
    }),
  }
}

/**
 * Mesh one 16^3 chunk. `solid` must contain every solid cell in the station so
 * neighbour queries across chunk boundaries are correct. `zEnd` bounds the
 * vertical span: the level slicer passes a storey's top so a level is meshed
 * alone, never drawing the storeys above it. `emit`, when given, limits which
 * solid cells contribute geometry — the block tool's add preview meshes only the
 * pending cells while still reading `solid` for exposure, so it draws the exact
 * final surface those cells will have. `thin`, when given, names the cells among
 * them that are **not** whole blocks (packed key → the shape they draw): a **半墙**
 * panel, which meshes half a block thick, or a **三角** wedge, which meshes as the
 * cell cut on its own 45° plane. It is a parameter rather than something read off
 * `cells`
 * because the build ghost meshes cells the station does not hold yet. `slope`, the
 * same way, names the blocks a 楼梯 / 扶梯 takes its volume out of (packed key → the
 * underside plane `sim/openings.ts` derives): their top is the run's slope rather
 * than the cell's ceiling, so the space under a run fills up to its truss instead
 * of bulging through it. `fill`, finally, names the cells of that filling the
 * station holds **no block** in (`rampFillKeys`): each is drawn as if its block
 * existed — shaved by the same `slope` entry, wearing the finish of the block it
 * stands on, solid to every neighbour so the ground below joins it seamlessly — so
 * the wedge under a truss is filled without a cell no tool could address.
 */
export function meshChunk(
  solid: Set<number>,
  finishes: Map<number, Partial<Record<Face, FinishId>>>,
  cx: number,
  cy: number,
  cz: number,
  zEnd: number = cz + CHUNK - 1,
  emit?: Set<number>,
  skip?: Set<number>,
  cells?: readonly { x: number; y: number; z: number }[],
  thin?: ReadonlyMap<number, CellShape>,
  slope?: ReadonlyMap<number, SlopeCut>,
  fill?: ReadonlySet<number>,
): ChunkGeometry {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  // What a cell *voted* for its neighbours' exposure, and what it *draws*, are not the same
  // question — this is the one place they come apart.
  //
  // `skip` cells are hidden from the mesh (a shop's auto walls are drawn as thin panels
  // instead), so they must not occlude their neighbours either: otherwise the floor slab
  // under a hidden wall is culled and leaves a half-block void along the inside of the room.
  //
  // A `fill` cell is the ground a run's truss hangs into — drawn, but not a cell the station
  // holds. Letting it vote makes the cell below believe a block stands on top of it, so that
  // cell reports `up = false` and never draws a top face at all: the run's body came out as
  // four walls with no lid and the inside of the escalator showed through the gaps between
  // them. It is still *something* the mesher draws, though, so the cell above it is not open
  // to the sky — which is what `draws` and `standsOn` are for.
  const isSolid = (x: number, y: number, z: number): boolean => {
    const k = key(x, y, z)
    if (skip !== undefined && skip.has(k)) return false
    if (fill !== undefined && fill.has(k)) return false
    return solid.has(k)
  }
  /** Does the mesher draw anything in this cell at all — a block, or a run's filling? */
  const draws = (x: number, y: number, z: number): boolean => solid.has(key(x, y, z)) || (fill !== undefined && fill.has(key(x, y, z)))
  /** Is there something under this cell to stand on — a block, or a run's filling? */
  const standsOn = (x: number, y: number, z: number): boolean => draws(x, y, z - 1)
  const H = BEVEL

  // Faces are sorted into one builder per finish, so a chunk yields a handful of
  // parts (one per material) instead of one part repainted per face. A dense
  // array indexed by finish keeps the per-face selection off the string Map.
  const builders: Array<VecBuilder | null> = []
  const builderForIndex = (i: number): VecBuilder => {
    let b = builders[i]
    if (!b) {
      b = { pos: [], nor: [], col: [], uv: [], idx: [] }
      builders[i] = b
    }
    return b
  }

  // The cells to visit. A caller that already knows which cells this chunk holds
  // (a storey's band, grouped by chunk) passes them and the volume is never walked;
  // otherwise the whole chunk box is visited. `emit`, when given, still filters.
  const visits = cells ?? volumeCells(cx, cy, cz, zEnd)

  for (const cell of visits) {
    const x = cell.x
    const y = cell.y
    const z = cell.z
    if (!draws(x, y, z)) continue
    if (skip !== undefined && skip.has(key(x, y, z))) continue
    if (emit !== undefined && !emit.has(key(x, y, z))) continue
    // A cell is open above unless something is drawn there — the block above, or the
    // filling under a run. Only a real block ever culls a face on a *side*.
    const up = !draws(x, y, z + 1)
    const down = !standsOn(x, y, z)
    const E = !isSolid(x + 1, y, z)
    const W = !isSolid(x - 1, y, z)
    const N = !isSolid(x, y + 1, z)
    const S = !isSolid(x, y - 1, z)
    if (!up && !down && !E && !W && !N && !S) continue

    const k = key(x, y, z)
    const filled = fill !== undefined && fill.has(k)
    /**
     * A block a run takes its volume out of ends on the run's **underside** instead of
     * on the 1 m line: a plane sloping along one horizontal axis, in cell-local units,
     * so a block under a 楼梯 / 扶梯 fills the space under the slope and stops at the
     * truss. `undefined` is the ordinary full-height block, meshed exactly as it always
     * was — and it is the common case, so the cut costs it nothing but the map miss.
     */
    const cut = up ? slope?.get(k) : undefined
    /**
     * The ground a truss hangs into, drawn as the **run's own body** instead of as a
     * block of the cell: the cut carries the body's half-width (`slope`), so an
     * escalator's filling is its truss box, in the run's steel, meeting the truss flush.
     */
    const truss = filled && cut !== undefined && cut.half !== undefined
    // A filling cell the station holds nothing in wears the finish of the block it
    // stands on — the ground carried up to the truss — unless it is that truss box,
    // which wears the run's own steel so the escalator reads as one body.
    const fin = truss ? TRUSS_FACES : finishes.get(k) ?? (filled ? finishes.get(key(x, y, z - 1)) : undefined)
    /**
     * The **cap**: the surface a run left behind, the plane its cut shaves to. It belongs to
     * the run as much as to the ground — a 楼梯 painted with the 材质 brush paints the ground
     * under it with it (`SlopeCut.finish`) — so a block that carries no top finish of its own
     * takes the run's. A face the player painted themselves always wins.
     */
    const topI = fin?.top !== undefined ? finishIdx(fin.top) : cut?.finish !== undefined ? finishIdx(cut.finish) : DEFAULT_TOP_I
    const bottomI = fin?.bottom !== undefined ? finishIdx(fin.bottom) : DEFAULT_BOTTOM_I
    const sideI: Record<'e' | 'w' | 'n' | 's', number> = fin
      ? {
          e: finishIdx(fin.e ?? DEFAULT_FINISH.e),
          w: finishIdx(fin.w ?? DEFAULT_FINISH.w),
          n: finishIdx(fin.n ?? DEFAULT_FINISH.n),
          s: finishIdx(fin.s ?? DEFAULT_FINISH.s),
        }
      : DEFAULT_SIDE_I

    // A 半墙 cell meshes as the half of the block its panel hugs; every other
    // solid cell is a full block. The faces keep their own finishes either way, so
    // painting a 半墙 is painting a wall — one face per surface, both sides of it.
    // A **三角** is not a cross-section at all: its cell is cut in *elevation*, so it
    // meshes as a wedge with its own five faces (`pushWedge`) rather than as a profile
    // extruded up the cell. It is a sawn block — no top-rim chamfer — and none of the
    // profile machinery below applies to it, so it is done with its cell here.
    const thinShape = thin?.get(k)
    if (isTriangleShape(thinShape)) {
      pushWedge(builderForIndex, isSolid, x, y, z, { e: E, w: W, n: N, s: S, up, down }, thinShape.triangle, thinShape.side, {
        top: topI,
        bottom: bottomI,
        side: sideI,
      })
      continue
    }
    let built: Profile
    if (filled && cut !== undefined && cut.half !== undefined) {
      built = buildTrussProfile(cut.axis, cut.half)
    } else if (isHalfWallShape(thinShape)) {
      built = buildThinProfile(thinShape.side, E, W, N, S)
    } else {
      built = buildProfile({ e: E, w: W, n: N, s: S })
    }
    const edges = built.edges
    const shape = profileOutline(built)
    /** The top face's own boundary: the outline pulled in by each side's bevel, flush where nothing is exposed. */
    const ring = profileRing(built)

    const ox = x
    const oy = y
    const oz = z
    /**
     * How high the **top face** sits at a point, and how high a **wall** reaches there.
     *
     * They are the same number only when a run has cut the block. A plain block's top face is
     * its own ceiling (`1`) while its walls stop a bevel lower (`1 - H`) so the chamfer has
     * somewhere to be — reading the wall's height for the cap drops the whole top by 12.5 cm
     * and opens a rim of missing surface all the way round every block.
     *
     * With a **cut** both follow the run's underside, and it is the run's *lower* edge that
     * wins: a cut only ever takes volume away, so a block the run has climbed clear of is
     * whole. Taking the plane outright lifted the cap above the cell and left the real top
     * open, which is what drew the filling under a truss as an open box with the inside of
     * the run showing through it.
     */
    let cutAt: ((px: number, py: number) => number) | null = null
    const bodyTop = (px: number, py: number): number =>
      cutAt === null ? 1 : Math.min(1, cutAt(px, py))
    const wallTop = (px: number, py: number): number =>
      cutAt === null ? (up ? 1 - H : 1) : Math.min(1, cutAt(px, py))
    if (cut !== undefined) {
      const lo = cut.lo
      const rise = cut.hi - cut.lo
      const alongX = cut.axis === 'x'
      /**
       * The run's own plane, never below the **base plane** it stands on (`SlopeCut.base`):
       * a stair's soffit hangs under the landing it leaves, and ground cut to that would
       * be a wedge dipping below the floor the piece is founded on — the block under the
       * base would stop being a floor block. The cut takes volume only from at or above
       * the plane, so the base block stays whole and level with the floor beside it.
       */
      const clamp = cut.base
      cutAt = clamp === undefined
        ? (px: number, py: number): number => lo + rise * (alongX ? px : py)
        : (px: number, py: number): number => {
            const raw = lo + rise * (alongX ? px : py)
            return raw > clamp ? raw : clamp
          }
    }
    // Where the plane leaves through the block's floor the block is empty past it,
    // so the cross-section is clipped there: a fan chording across that corner would
    // rise back up into the run it was cut out of. Everywhere else it is the outline.
    // The test is on the plane as drawn — the base clamp included — or a block the
    // clamp has filled back to its floor would be clipped away as if it were empty.
    let body = shape
    if (cutAt !== null && Math.min(cutAt(0, 0), cutAt(1, 0), cutAt(0, 1), cutAt(1, 1)) <= 0) {
      const plane = cutAt
      body = clipProfile(shape, (p: Pt): number => plane(p.x, p.y))
    }
    /**
     * The side walls, and the top-rim chamfer over each of them.
     *
     * A side flush with a solid neighbour emits neither: there is no wall between two parts
     * of the same building, and no bevel on a boundary that is not a rim. That is the whole
     * of "no gap between blocks" — with the wall and the chamfer gone the two top faces are
     * one plane, and the cell boundary between them is not drawn at all.
     *
     * A **cut** block is the separate case. Clipping against the run's underside can turn a
     * corner into a new vertex, so its cross-section is no longer the outline the sides were
     * built from and cannot be indexed by it; it is walked as its own polygon, and it wears
     * no chamfer because it ends on a face the run made (a sawn block keeps its sharp edge).
     */
    if (cutAt === null) {
      /**
       * The inner corner `k`: the wall running to it steps in by its own inset, and the wall
       * leaving it by its own — the two steps a chamfer's mitre is made of. A corner with no
       * open side on it, or one shared with a neighbour, simply does not move.
       */
      const inner = (k: number): Pt => {
        const at = ring[(k - 1 + edges.length) % edges.length]
        return { x: at.x, y: at.y }
      }
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i]
        if (!e.exposed) continue
        const p = shape[i]
        const q = shape[(i + 1) % shape.length]
        const nx = e.nx
        const ny = e.ny
        // Ambient occlusion from the cells beside this wall.
        const ao = wallAo(isSolid, x, y, z, nx, ny)
        const uLen = Math.hypot(q.x - p.x, q.y - p.y)
        // This wall's own inner line: exactly `BEVEL` in, for its whole length.
        const o1: Pt = { x: p.x - nx * e.inset, y: p.y - ny * e.inset }
        const o2: Pt = { x: q.x - nx * e.inset, y: q.y - ny * e.inset }
        // An uncut block ends on the cell ceiling; its walls stop at the chamfer's foot.
        const hp = wallTop(p.x, p.y)
        const hq = wallTop(q.x, q.y)
        if (hp > 0 || hq > 0) {
          pushQuad(
            builderForIndex(sideI[sideOf(nx, ny)]),
            [ox + p.x, oy + p.y, oz],
            [ox + q.x, oy + q.y, oz],
            [ox + q.x, oy + q.y, oz + hq],
            [ox + p.x, oy + p.y, oz + hp],
            [nx, ny, 0],
            [ao, ao, ao, ao],
            0,
            0,
            uLen,
            hq,
          )
        }
        if (up) {
          const cn = Math.hypot(nx, ny, 1)
          const nrm: [number, number, number] = [nx / cn, ny / cn, 1 / cn]
          /**
           * The chamfer is the **flat 45° strip** between this wall's top and this wall's
           * own inner line, with its UVs spanning the strip's full depth — `v` 0 at the wall
           * and 1 at the inner edge, so the last texel row down the chamfer is the first row
           * of the flat top it meets. Spanning `v` over `H` instead left the chamfer
           * sampling a 12.5 cm sliver of the texture while the top beside it sampled the
           * whole metre, and the join between them drew a hard seam.
           */
          pushFaceOut(
            builderForIndex(topI),
            [
              [ox + p.x, oy + p.y, oz + hp],
              [ox + o1.x, oy + o1.y, oz + 1],
              [ox + o2.x, oy + o2.y, oz + 1],
              [ox + q.x, oy + q.y, oz + hq],
            ],
            [
              [0, 0],
              [0, 1],
              [uLen, 1],
              [uLen, 0],
            ],
            nrm,
            ao + 0.12,
          )
          // The corner this wall runs to: the two mitre steps meet the block's own corner
          // in one small triangle. It collapses to nothing wherever the neighbouring side
          // is shared, which is what keeps a merged run of blocks free of geometry at its
          // seams — and a zero-area triangle is not worth pushing at all.
          const c = inner(i + 1)
          if (c.x !== o2.x || c.y !== o2.y) {
            pushFaceOut(
              builderForIndex(topI),
              [
                [ox + q.x, oy + q.y, oz + hq],
                [ox + o2.x, oy + o2.y, oz + 1],
                [ox + c.x, oy + c.y, oz + 1],
              ],
              [
                [q.x, q.y],
                [o2.x, o2.y],
                [c.x, c.y],
              ],
              nrm,
              ao + 0.12,
            )
          }
        }
      }
    } else {
      for (let i = 0; i < body.length; i++) {
        const p = body[i]
        const q = body[(i + 1) % body.length]
        const mx = (p.x + q.x) / 2
        const my = (p.y + q.y) / 2
        let nx = 0
        let ny = 0
        if (mx < 1e-6) nx = -1
        else if (mx > 1 - 1e-6) nx = 1
        else if (my < 1e-6) ny = -1
        else if (my > 1 - 1e-6) ny = 1
        else continue
        // The wall reaches the run's underside — or the cell's own ceiling, where the run
        // has already climbed clear of this block and there is nothing left to cut.
        const hp = wallTop(p.x, p.y)
        const hq = wallTop(q.x, q.y)
        if (hp <= 0 && hq <= 0) continue
        const ao = wallAo(isSolid, x, y, z, nx, ny)
        pushQuad(
          builderForIndex(sideI[sideOf(nx, ny)]),
          [ox + p.x, oy + p.y, oz],
          [ox + q.x, oy + q.y, oz],
          [ox + q.x, oy + q.y, oz + hq],
          [ox + p.x, oy + p.y, oz + hp],
          [nx, ny, 0],
          [ao, ao, ao, ao],
          0,
          0,
          Math.hypot(q.x - p.x, q.y - p.y),
          hq,
        )
      }
    }

    /**
     * The top face: a fan of the **ring**, flat at full height.
     *
     * Ring and outline carry the same vertex order, so the ring is inset on a bevelled side,
     * flush on a shared one, and the plane simply carries on into the block next door
     * wherever the two meet.
     *
     * A **cut** block is the exception, and only in one direction. Its top is the run's own
     * underside, so it follows the cut plane — but the cut only ever takes volume *away*: a
     * block a run has climbed clear of is still a whole block, and its top is its own
     * ceiling. Taking the plane as the height outright put the cap up in the air above the
     * cell wherever the run had passed above it, and left the cell's real top open — which is
     * what drew the filling under a truss as an open box, walls and no lid, with the inside
     * of the run showing from above. `min` against the ceiling is the whole fix, and it keeps
     * the cap over the block's **own** cross-section, so a narrow truss box gets a narrow lid.
     */
    if (up) {
      const topAo = topAoAt(isSolid, x, y, z)
      const cap = cutAt === null ? ring : body
      const cxm = cxCenter(cap)
      const cym = cyCenter(cap)
      /**
       * The hub's height is the **mean of the cap's own boundary heights**, not the height
       * the surface happens to have at the hub's position.
       *
       * A run's cut plane slopes along one axis, so `bodyTop` at the hub's `(x, y)` is only
       * right when the hub sits at the mean of the boundary *positions* — and it does not,
       * because the fan's hub is the polygon's centroid. Sampling there drops the hub below
       * the rim it is meant to close, splitting the lid away from the walls and leaving the
       * run's body open exactly as it does on the boundary itself. The mean of the rim's
       * heights lies on the plane by construction, so the fan comes out flat.
       *
       * The mean is taken of the plane **as drawn**, so a cell whose whole plane the base
       * clamp has lifted gets one level lid — exactly the top the block would have had if
       * the stair had never touched it (`SlopeCut.base`). Taking the raw plane instead
       * tilts that lid under the floor it sits level with.
       */
      let cH = 0
      for (const p of cap) cH += bodyTop(p.x, p.y)
      cH /= cap.length
      for (let i = 0; i < cap.length; i++) {
        const p = cap[i]
        const q = cap[(i + 1) % cap.length]
        pushTri(
          builderForIndex(topI),
          [ox + cxm, oy + cym, oz + cH],
          [ox + p.x, oy + p.y, oz + bodyTop(p.x, p.y)],
          [ox + q.x, oy + q.y, oz + bodyTop(q.x, q.y)],
          [0, 0, 1],
          topAo,
          [
            [cxm, cym],
            [p.x, p.y],
            [q.x, q.y],
          ],
        )
      }
    }

    // Bottom face, for floating blocks and cutaways. A cut block's footprint is the
    // clipped cross-section, so the floor under it follows the same knife edge.
    if (down) {
      const ao = 0.6
      // A plain block fans from its cell centre; a clipped one has to fan from
      // inside its own cross-section, or the fan's hub lands where the cut has
      // already emptied the block.
      const cxm = cutAt === null ? 0.5 : cxCenter(body)
      const cym = cutAt === null ? 0.5 : cyCenter(body)
      for (let i = 0; i < body.length; i++) {
        const p = body[(i + 1) % body.length]
        const q = body[i]
        pushTri(
          builderForIndex(bottomI),
          [ox + cxm, oy + cym, oz],
          [ox + p.x, oy + p.y, oz],
          [ox + q.x, oy + q.y, oz],
          [0, 0, -1],
          ao,
          [
            [cxm, cym],
            [p.x, p.y],
            [q.x, q.y],
          ],
        )
      }
    }
  }

  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  // Stock FINISH_LIST ids keep their order; a custom tint appends on first
  // sight, so parts still come out in a stable order for a given station.
  const parts: ChunkPart[] = []
  for (let i = 0; i < builders.length; i++) {
    const b = builders[i]
    if (!b) continue
    parts.push({
      finish: FINISH_IDS[i],
      positions: new Float32Array(b.pos),
      normals: new Float32Array(b.nor),
      colors: new Float32Array(b.col),
      uvs: new Float32Array(b.uv),
      indices: new Uint32Array(b.idx),
      triangles: b.idx.length / 3,
    })
  }
  let triangles = 0
  for (const p of parts) triangles += p.triangles
  return { parts, cx, cy, cz, triangles, ms: t1 - t0 }
}

/** Every cell in a chunk's box, for a caller with no cell list of its own. */
function volumeCells(cx: number, cy: number, cz: number, zEnd: number): Array<{ x: number; y: number; z: number }> {
  const out: Array<{ x: number; y: number; z: number }> = []
  for (let x = cx; x < cx + CHUNK; x++) {
    for (let y = cy; y < cy + CHUNK; y++) {
      for (let z = cz; z <= zEnd; z++) out.push({ x, y, z })
    }
  }
  return out
}

/** The side face a wall normal belongs to; arcs snap to their dominant axis. */
function sideOf(nx: number, ny: number): 'e' | 'w' | 'n' | 's' {
  if (Math.abs(nx) >= Math.abs(ny)) return nx >= 0 ? 'e' : 'w'
  return ny >= 0 ? 'n' : 's'
}

/**
 * The **area centroid** of a polygon, as the hub its top face fans from.
 *
 * A vertex mean is not good enough: the bevel ring has three points along each rounded
 * corner and only one at a flush edge, so its vertices are nowhere near evenly spread. On
 * a ring that is a plain inset square the mean falls *outside* the polygon, and every
 * triangle of the fan then reaches across the cell and folds back on itself. The area
 * centroid is always inside a convex polygon, which is the whole requirement here.
 */
function cxCenter(pts: Pt[]): number {
  return centroid(pts).x
}

function cyCenter(pts: Pt[]): number {
  return centroid(pts).y
}

function centroid(pts: Pt[]): { x: number; y: number } {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    const cross = p.x * q.y - q.x * p.y
    a += cross
    cx += (p.x + q.x) * cross
    cy += (p.y + q.y) * cross
  }
  // Degenerate (all points collinear): fall back to the mean, which is at least on the line.
  if (Math.abs(a) < 1e-12) {
    let sx = 0
    let sy = 0
    for (const p of pts) {
      sx += p.x
      sy += p.y
    }
    return { x: sx / pts.length, y: sy / pts.length }
  }
  return { x: cx / (3 * a), y: cy / (3 * a) }
}

/** Wall AO from the 8 cells in the wall's plane, one step out along the normal. */
function wallAo(isSolid: (x: number, y: number, z: number) => boolean, x: number, y: number, z: number, nx: number, ny: number): number {
  let occl = 0
  const ax = nx !== 0 ? x + nx : x
  const ay = ny !== 0 ? y + ny : y
  const along = nx !== 0 ? [0, 0] : [1, 0]
  for (let dz = -1; dz <= 1; dz++) {
    for (let t = -1; t <= 1; t++) {
      if (t === 0 && dz === 0) continue
      const px = ax + along[0] * t
      const py = ay + along[1] * t
      if (isSolid(px, py, z + dz)) occl++
    }
  }
  return Math.max(0.4, 1 - 0.09 * occl)
}

/** Top AO from solid cells one level up in the ring around the cell. */
function topAoAt(isSolid: (x: number, y: number, z: number) => boolean, x: number, y: number, z: number): number {
  let occl = 0
  for (let dz = 1; dz <= 2; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        if (isSolid(x + dx, y + dy, z + dz)) occl++
      }
    }
  }
  return Math.max(0.45, 1 - 0.06 * occl)
}
