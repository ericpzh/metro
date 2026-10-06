// The whole cell a pointer hit hands a tool: which block it is on, and which
// block a placement against that surface takes.
//
// `CameraSystem.pick` reads the *drawn* mesh, and `THREE.Intersection.face.normal`
// is the **triangle's own** geometric normal (`Triangle.getNormal`), not the cell
// face's axis. Two of the faces this game draws are deliberately off-axis:
//
//   * the block under a 楼梯 / 扶梯 is meshed as a wedge — its top is the run's
//     sloping underside (`rampSlopeCuts`, `chunkMesher`), and
//   * every exposed block edge is rounded, so a corner arc faces diagonally.
//
// A tool that placed at `cell + face.normal` therefore asked for a **fraction**:
// hovering the block under an escalator and laying a 方块 block beside it
// committed (4.44, −0.15, 1.89) instead of a cell. The game addresses whole cells
// only (`build/model/Grid.ts`), so a fraction is invisible to every tool from then
// on — `removeCells` matches exact coordinates — and the grid repair drops it on
// the next load, so the block the player just laid disappears with the save. The
// pick is the one place that must never hand one out: `game/test/pick-cell.test.mjs`
// rays a real chunk mesh to pin it, `game/test/grid.test.mjs` guards the commands
// downstream of it.
//
// `faceAxis` is the tie rule — the axis the normal most points along, ties going
// up/across in that order — and it is the *one* copy of it: the 材质 brush reads
// the same function through `dominantFace`, so the face a paint stroke lands on
// and the cell a block lands in can never disagree.

/** The three axes a cell face can point along. */
export type FaceAxis = 'x' | 'y' | 'z'

/**
 * Which way a face normal points, snapped to the axis it most points along, with
 * the sign it points in. A normal of zero reads as `+z` (the work plane's own
 * face), which is the only answer that keeps a caller on the grid.
 */
export function faceAxis(n: readonly number[]): { axis: FaceAxis; positive: boolean } {
  const [nx, ny, nz] = [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0]
  const ax = Math.abs(nx)
  const ay = Math.abs(ny)
  const az = Math.abs(nz)
  if (az >= ax && az >= ay) return { axis: 'z', positive: nz >= 0 }
  if (ax >= ay) return { axis: 'x', positive: nx >= 0 }
  return { axis: 'y', positive: ny >= 0 }
}

/** The whole cell step along `faceAxis` — the neighbour a placement cell is in. */
export function faceStep(n: readonly number[]): [number, number, number] {
  const { axis, positive } = faceAxis(n)
  const s = positive ? 1 : -1
  return axis === 'x' ? [s, 0, 0] : axis === 'y' ? [0, s, 0] : [0, 0, s]
}

/** A solid hit, in whole cells. */
export interface PickCells {
  /** The block the surface belongs to. */
  cell: [number, number, number]
  /** The block a placement against that surface takes: `cell` one step out. */
  place: [number, number, number]
  /** The face's outward normal, snapped to the cell axis it faces. */
  normal: [number, number, number]
}

/** How far inside the hit surface the block is read from, metres. */
const INSIDE = 0.02

/**
 * The cells a solid hit names, from the hit `point` and the drawn face `normal`.
 *
 * The block itself is read from a hair **inside** the surface, stepped against the
 * normal as drawn — a ray that grazes a cell boundary (or lands on a rounded
 * corner, or on a slope) then still answers the block it actually hit. Only the
 * placement step is snapped: a wedge's top hands back the block above the wedge,
 * a rounded corner hands back the neighbour along whichever of the two faces it
 * leans to, and both are ordinary cells.
 */
export function pickCells(point: readonly number[], normal: readonly number[]): PickCells {
  const len = Math.hypot(normal[0] ?? 0, normal[1] ?? 0, normal[2] ?? 0) || 1
  const x = Math.floor(point[0] - ((normal[0] ?? 0) / len) * INSIDE)
  const y = Math.floor(point[1] - ((normal[1] ?? 0) / len) * INSIDE)
  const z = Math.floor(point[2] - ((normal[2] ?? 0) / len) * INSIDE)
  const step = faceStep(normal)
  return {
    cell: [x, y, z],
    place: [x + step[0], y + step[1], z + step[2]],
    normal: step,
  }
}
