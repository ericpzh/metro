// Face-plane cell math for the paint tool, moved verbatim from app/Viewport.tsx.
// A paint drag lives on the pressed face's plane — only the two in-plane axes
// change — and only cells that actually present that face are targets.

import { facePresent } from '../../../build/model.ts'
import type { Face, WallSide } from '../../../sim/types.ts'

/** The face a picked normal belongs to; rounded corners snap to the dominant axis. */
export function dominantFace(n: [number, number, number]): Face {
  const [nx, ny, nz] = n
  if (Math.abs(nz) >= Math.abs(nx) && Math.abs(nz) >= Math.abs(ny)) return nz >= 0 ? 'top' : 'bottom'
  if (Math.abs(nx) >= Math.abs(ny)) return nx >= 0 ? 'e' : 'w'
  return ny >= 0 ? 'n' : 's'
}

/** Outward normal of each face: the paint plane's axis and the quad orientation. */
export const FACE_NORMAL: Record<Face, [number, number, number]> = {
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  n: [0, 1, 0],
  s: [0, -1, 0],
  e: [1, 0, 0],
  w: [-1, 0, 0],
}

/**
 * The cells a paint drag covers: the rectangle between the pressed cell and the
 * pointer, on the pressed face's plane. Only the two in-plane axes change; the
 * plane's own coordinate is pinned to the anchor.
 */
export function planeCells(a: [number, number, number], b: [number, number, number], face: Face): Array<[number, number, number]> {
  const [nx, , nz] = FACE_NORMAL[face]
  const out: Array<[number, number, number]> = []
  if (nz !== 0) {
    for (let x = Math.min(a[0], b[0]); x <= Math.max(a[0], b[0]); x++)
      for (let y = Math.min(a[1], b[1]); y <= Math.max(a[1], b[1]); y++) out.push([x, y, a[2]])
  } else if (nx !== 0) {
    for (let y = Math.min(a[1], b[1]); y <= Math.max(a[1], b[1]); y++)
      for (let z = Math.min(a[2], b[2]); z <= Math.max(a[2], b[2]); z++) out.push([a[0], y, z])
  } else {
    for (let x = Math.min(a[0], b[0]); x <= Math.max(a[0], b[0]); x++)
      for (let z = Math.min(a[2], b[2]); z <= Math.max(a[2], b[2]); z++) out.push([x, a[1], z])
  }
  return out
}

/**
 * The cells of a rectangle that actually present the face: the same rule the 整面
 * flood fills by (`facePresent`), so a dragged rectangle and an `M` click offer one
 * surface. It is also what knows a 半墙's panel is half a block thick and that its
 * inner face sits inside its own cell rather than on the cell's boundary.
 */
export function faceTargets(
  cells: Array<[number, number, number]>,
  face: Face,
  solid: Set<string>,
  thin: Map<string, WallSide> = new Map(),
): Array<[number, number, number]> {
  return cells.filter(([x, y, z]) => facePresent(solid, thin, x, y, z, face))
}
