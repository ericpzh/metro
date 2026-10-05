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
import { DEFAULT_FINISH, FINISH_LIST } from '../sim/finishes.ts'
import { packKey as key, type Cell, type Face, type FinishId, type WallSide } from '../sim/types.ts'

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
/** Outer corner radius of the rounded profile, metres. */
export const CORNER_R = 0.125
/** Top-rim chamfer, metres. "12.5 cm bevel on exposed top edges". */
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

interface Pt {
  x: number
  y: number
  nx: number
  ny: number
  /** True when at least one adjacent edge is exposed. */
  exposed: boolean
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

/** Build the rounded cross-section profile for one cell, CCW viewed from +z. */
function buildProfile(E: boolean, W: boolean, N: boolean, S: boolean): Pt[] {
  const R = CORNER_R
  const pts: Pt[] = []
  const arc = (cx: number, cy: number, a0: number, a1: number): void => {
    const steps = 3
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const a = a0 + (a1 - a0) * t
      const nx = Math.cos(a)
      const ny = Math.sin(a)
      pts.push({ x: cx + R * nx, y: cy + R * ny, nx, ny, exposed: true })
    }
  }
  const corner = (x: number, y: number, nx: number, ny: number, exp: boolean): void => {
    pts.push({ x, y, nx, ny, exposed: exp })
  }
  // SW then S edge then SE then E then NE then N then NW then W.
  if (W && S) arc(R, R, Math.PI, 1.5 * Math.PI)
  else corner(0, 0, W ? -1 : 0, S ? -1 : 0, W || S)
  if (S && E) arc(1 - R, R, 1.5 * Math.PI, 2 * Math.PI)
  else corner(1, 0, E ? 1 : 0, S ? -1 : 0, E || S)
  if (E && N) arc(1 - R, 1 - R, 0, 0.5 * Math.PI)
  else corner(1, 1, E ? 1 : 0, N ? 1 : 0, E || N)
  if (N && W) arc(R, 1 - R, 0.5 * Math.PI, Math.PI)
  else corner(0, 1, W ? -1 : 0, N ? 1 : 0, N || W)
  return pts
}

function edgeExposure(p: Pt, q: Pt): { exposed: boolean; nx: number; ny: number } {
  const mx = (p.x + q.x) / 2
  const my = (p.y + q.y) / 2
  if (mx < 1e-6) return { exposed: true, nx: -1, ny: 0 }
  if (mx > 1 - 1e-6) return { exposed: true, nx: 1, ny: 0 }
  if (my < 1e-6) return { exposed: true, nx: 0, ny: -1 }
  if (my > 1 - 1e-6) return { exposed: true, nx: 0, ny: 1 }
  // An arc segment — both adjacent sides are exposed.
  const nx = p.nx + q.nx
  const ny = p.ny + q.ny
  const m = Math.hypot(nx, ny) || 1
  return { exposed: true, nx: nx / m, ny: ny / m }
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
      return { x: p.y, y: 1 - p.x, nx: p.ny, ny: -p.nx, exposed: p.exposed }
    case 2:
      return { x: 1 - p.x, y: 1 - p.y, nx: -p.nx, ny: -p.ny, exposed: p.exposed }
    case 3:
      return { x: 1 - p.y, y: p.x, nx: -p.ny, ny: p.nx, exposed: p.exposed }
    default:
      return p
  }
}

/**
 * The cross-section of a **半墙** cell: the same rounded profile a full cell gets,
 * squashed to `HALF_WALL_T` and turned so the half it keeps is the one flush to the
 * side the panel hugs (`halfWallSide`). The panel's **inner** face — the one
 * looking across the cell's own clear half — is always built, because it is a
 * surface inside this cell that nothing can stand across; that is the face the
 * half-block walls of a facility room have always been read on, and the one the
 * paint brush aims at. Its two ends take the exposure of the neighbours they meet,
 * so the columns of one run join with no face between them, and its outer face is
 * the side itself.
 *
 * The squash happens in the canonical frame before the turn, so the rounding
 * stays where the profile put it: 12.5 cm along the wall, half that through it.
 * The turn is rigid, so a west-facing panel is this profile turned a quarter-turn,
 * not a second shape.
 */
function buildThinProfile(side: WallSide, E: boolean, W: boolean, N: boolean, S: boolean): Pt[] {
  const turns = SIDE_TURNS[side]
  const solid: Record<WallSide, boolean> = { n: N, e: E, s: S, w: W }
  // The canonical panel is flush to the south edge: outer face south, inner face
  // north (always exposed), its two ends east and west.
  const profile = buildProfile(solid[sideTurned('e', turns)], solid[sideTurned('w', turns)], true, solid[side])
  return profile.map((p) => turnPoint({ ...p, y: p.y * HALF_WALL_T }, turns))
}

/**
 * Mesh one 16^3 chunk. `solid` must contain every solid cell in the station so
 * neighbour queries across chunk boundaries are correct. `zEnd` bounds the
 * vertical span: the level slicer passes a storey's top so a level is meshed
 * alone, never drawing the storeys above it. `emit`, when given, limits which
 * solid cells contribute geometry — the block tool's add preview meshes only the
 * pending cells while still reading `solid` for exposure, so it draws the exact
 * final surface those cells will have. `thin`, when given, names the **半墙** cells
 * among them (packed key → the side the panel hugs), which mesh half a block thick
 * instead of a full one. It is a parameter rather than something read off `cells`
 * because the build ghost meshes cells the station does not hold yet.
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
  thin?: ReadonlyMap<number, WallSide>,
): ChunkGeometry {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  // `skip` cells are hidden from the mesh (a shop's auto walls are drawn as
  // thin panels instead), so they must not occlude their neighbours: otherwise
  // the floor slab under a hidden wall is culled and leaves a half-block void
  // along the inside of the room.
  const isSolid = (x: number, y: number, z: number): boolean =>
    solid.has(key(x, y, z)) && !(skip !== undefined && skip.has(key(x, y, z)))
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
    if (!isSolid(x, y, z)) continue
    if (skip !== undefined && skip.has(key(x, y, z))) continue
    if (emit !== undefined && !emit.has(key(x, y, z))) continue
    const up = !isSolid(x, y, z + 1)
    const down = !isSolid(x, y, z - 1)
    const E = !isSolid(x + 1, y, z)
    const W = !isSolid(x - 1, y, z)
    const N = !isSolid(x, y + 1, z)
    const S = !isSolid(x, y - 1, z)
    if (!up && !down && !E && !W && !N && !S) continue

    const fin = finishes.get(key(x, y, z))
    const topI = fin?.top !== undefined ? finishIdx(fin.top) : DEFAULT_TOP_I
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
    const side = thin?.get(key(x, y, z))
    const profile = side ? buildThinProfile(side, E, W, N, S) : buildProfile(E, W, N, S)
    // Per-point exposed normal and inward offset for the top bevel.
    const offs: Pt[] = profile.map((p, i) => {
      const prev = profile[(i - 1 + profile.length) % profile.length]
      const next = profile[(i + 1) % profile.length]
      const e1 = edgeExposure(prev, p)
      const e2 = edgeExposure(p, next)
      let nx = 0
      let ny = 0
      if (e1.exposed) {
        nx += e1.nx
        ny += e1.ny
      }
      if (e2.exposed) {
        nx += e2.nx
        ny += e2.ny
      }
      const m = Math.hypot(nx, ny)
      if (m < 1e-6) return { x: p.x, y: p.y, nx: 0, ny: 0, exposed: false }
      return { x: p.x - (nx / m) * H, y: p.y - (ny / m) * H, nx: nx / m, ny: ny / m, exposed: true }
    })

    const ox = x
    const oy = y
    const oz = z
    const wallTop = up ? 1 - H : 1

    // Walls + chamfer rim.
    for (let i = 0; i < profile.length; i++) {
      const p = profile[i]
      const q = profile[(i + 1) % profile.length]
      const e = edgeExposure(p, q)
      if (!e.exposed) continue
      const nx = e.nx
      const ny = e.ny
      // Ambient occlusion from the cells beside this wall.
      const ao = wallAo(isSolid, x, y, z, nx, ny)
      const uLen = Math.hypot(q.x - p.x, q.y - p.y)
      pushQuad(
        builderForIndex(sideI[sideOf(nx, ny)]),
        [ox + p.x, oy + p.y, oz],
        [ox + q.x, oy + q.y, oz],
        [ox + q.x, oy + q.y, oz + wallTop],
        [ox + p.x, oy + p.y, oz + wallTop],
        [nx, ny, 0],
        [ao, ao, ao, ao],
        0,
        0,
        uLen,
        wallTop,
      )
      if (up) {
        const o1 = offs[i]
        const o2 = offs[(i + 1) % profile.length]
        const cn = Math.hypot(nx + 0, ny + 0, 1)
        pushQuad(
          builderForIndex(topI),
          [ox + p.x, oy + p.y, oz + wallTop],
          [ox + q.x, oy + q.y, oz + wallTop],
          [ox + o2.x, oy + o2.y, oz + 1],
          [ox + o1.x, oy + o1.y, oz + 1],
          [nx / cn, ny / cn, 1 / cn],
          [ao + 0.12, ao + 0.12, 1, 1],
          0,
          0,
          uLen,
          H,
        )
      }
    }

    // Top face: fan of the offset profile.
    if (up) {
      const topAo = topAoAt(isSolid, x, y, z)
      const cxm = cxCenter(offs)
      const cym = cyCenter(offs)
      for (let i = 0; i < offs.length; i++) {
        const p = offs[i]
        const q = offs[(i + 1) % offs.length]
        pushTri(
          builderForIndex(topI),
          [ox + cxm, oy + cym, oz + 1],
          [ox + p.x, oy + p.y, oz + 1],
          [ox + q.x, oy + q.y, oz + 1],
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

    // Bottom face, for floating blocks and cutaways.
    if (down) {
      const ao = 0.6
      const cxm = 0.5
      const cym = 0.5
      for (let i = 0; i < profile.length; i++) {
        const p = profile[(i + 1) % profile.length]
        const q = profile[i]
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

function cxCenter(pts: Pt[]): number {
  let s = 0
  for (const p of pts) s += p.x
  return s / pts.length
}

function cyCenter(pts: Pt[]): number {
  let s = 0
  for (const p of pts) s += p.y
  return s / pts.length
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
