// Build model: paint — face finishes, the 材质 brush and its floods (§4.3).

import { finishOf } from '../../sim/finishes.ts';
import { halfWallInnerFace, isHalfWallShape, type Cell, type CellShape, type Face, type FinishId } from '../../sim/types.ts';
import { cellKey, cloneCell } from './Cells.ts';
import type { StationState } from './State.ts';
import { thinWallSideMap } from './Walls.ts';

/** The neighbour a face looks out on. */
const FACE_STEP: Record<Face, [number, number, number]> = {
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  n: [0, 1, 0],
  s: [0, -1, 0],
  e: [1, 0, 0],
  w: [-1, 0, 0],
};

/** The four in-plane neighbours of a face (used by the surface fill). */
const FACE_PLANE: Record<Face, Array<[number, number, number]>> = {
  top: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]],
  bottom: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]],
  e: [[0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]],
  w: [[0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]],
  n: [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]],
  s: [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]],
};

/**
 * True when a solid cell presents `face` to a paint brush: the face is on the
 * block's surface, with nothing standing across it. The viewport's `faceTargets`
 * and `fillSurface`'s flood both ask this, so the brush offers a face the flood
 * will accept and the two cannot disagree about what is paintable.
 *
 * A **半墙** is the case the cell boundary alone gets wrong. Its panel is half a
 * block thick, so the face looking across the cell's own clear half is a surface
 * *inside* this cell — a solid neighbour behind it does not cover it. Without that
 * exception a player could see the side of a 半墙 and not be able to paint it. A
 * **三角** needs no such exception: two of its three faces are on the cell boundary
 * like any block's, and its diagonal is a surface the boundary rule already reports
 * as exposed, because the corner it cuts away leaves that neighbour empty.
 */
export function facePresent(
  solid: ReadonlySet<string>,
  thin: ReadonlyMap<string, CellShape>,
  x: number,
  y: number,
  z: number,
  face: Face,
): boolean {
  const k = cellKey(x, y, z);
  if (!solid.has(k)) return false;
  const shape = thin.get(k);
  if (isHalfWallShape(shape) && halfWallInnerFace(shape.side) === face) return true;
  const step = FACE_STEP[face];
  return !solid.has(cellKey(x + step[0], y + step[1], z + step[2]));
}

/* ---------------------------------------------------------- surfaces (§4.3) */

/** The finish override on one face, or undefined for the family default. */
export function faceOverride(cells: Cell[], x: number, y: number, z: number, face: Face): FinishId | undefined {
  return cells.find((c) => c.x === x && c.y === y && c.z === z)?.finish?.[face];
}

/** Paint one exposed face. Returns the same state when nothing changed. */
export function paintFace(state: StationState, x: number, y: number, z: number, face: Face, finish: FinishId): StationState {
  const i = state.cells.findIndex((c) => c.x === x && c.y === y && c.z === z);
  if (i < 0) return state;
  const cur = state.cells[i];
  if (cur.finish?.[face] === finish) return state;
  const cells = state.cells.slice();
  cells[i] = { ...cur, finish: { ...cur.finish, [face]: finish } };
  return { ...state, cells };
}

/** Erase a face back to its family default. */
export function eraseFace(state: StationState, x: number, y: number, z: number, face: Face): StationState {
  const i = state.cells.findIndex((c) => c.x === x && c.y === y && c.z === z);
  if (i < 0) return state;
  const cur = state.cells[i];
  if (!cur.finish?.[face]) return state;
  const finish = { ...cur.finish };
  delete finish[face];
  const next = cloneCell(cur);
  if (finish && Object.keys(finish).length > 0) next.finish = finish;
  else delete next.finish;
  const cells = state.cells.slice();
  cells[i] = next;
  return { ...state, cells };
}

/**
 * Paint one face across many cells at once — the `N`/`M` drag rectangle (§9.5).
 * Cells absent from the list, or already wearing the finish, are left untouched.
 */
export function paintFaces(state: StationState, cells: Array<[number, number, number]>, face: Face, finish: FinishId): StationState {
  const keys = new Set(cells.map(([x, y, z]) => cellKey(x, y, z)));
  if (keys.size === 0) return state;
  let changed = false;
  const next = state.cells.map((c) => {
    if (!keys.has(cellKey(c.x, c.y, c.z)) || c.finish?.[face] === finish) return c;
    changed = true;
    return { ...c, finish: { ...c.finish, [face]: finish } };
  });
  return changed ? { ...state, cells: next } : state;
}

/** Erase one face across many cells at once, back to the family default. */
export function eraseFaces(state: StationState, cells: Array<[number, number, number]>, face: Face): StationState {
  const keys = new Set(cells.map(([x, y, z]) => cellKey(x, y, z)));
  if (keys.size === 0) return state;
  let changed = false;
  const next = state.cells.map((c) => {
    if (!keys.has(cellKey(c.x, c.y, c.z)) || !c.finish?.[face]) return c;
    changed = true;
    const finish = { ...c.finish };
    delete finish[face];
    if (Object.keys(finish).length === 0) {
      const copy = cloneCell(c);
      delete copy.finish;
      return copy;
    }
    return { ...c, finish };
  });
  return changed ? { ...state, cells: next } : state;
}

/**
 * Paint — or clear — a **stair's walking surface** (§4.3, 材质): its treads, the
 * risers under them and the half-landing platform, which `render/models.ts` draws
 * from one material (`stairSurface`).
 *
 * Without this a stair can only wear the top finish of the floor it climbs from,
 * so there is no way to say "this staircase is granite" — or to keep a stair
 * tiled after the floor around it changes. `finish` is the finish the brush
 * holds, or `null` to hand the surface back to the floor beneath it. Only the
 * named piece is touched, and the same state comes back when nothing changed, so
 * a no-op brush is never an undo step.
 */
export function paintStairSurface(state: StationState, id: string, finish: FinishId | null): StationState {
  let changed = false;
  const modules = state.modules.map((m): typeof m => {
    if (m.type !== 'stair' || m.id !== id) return m;
    if ((m.cfg.finish ?? null) === finish) return m;
    changed = true;
    const cfg = { ...m.cfg };
    if (finish === null) delete cfg.finish;
    else cfg.finish = finish;
    return { ...m, cfg };
  });
  return changed ? { ...state, modules } : state;
}

/**
 * Flood-fill the connected exposed region of a face's plane with a finish
 * (§4.3, the `M` 整面 tool). The region stops at unexposed faces and at the
 * plane's edge, not at a change of current finish — you are painting a floor.
 *
 * A **半墙**'s inner face counts as exposed even when the cell across it is solid:
 * the panel is half a block thick, so that surface looks into its own cell's clear
 * half and nothing can stand across it. Flooding from one column of a run
 * therefore paints the whole run, which is the surface the player sees.
 */
export function fillSurface(state: StationState, x: number, y: number, z: number, face: Face, finish: FinishId): StationState {
  const solid = new Set(state.cells.filter((c) => c.fill === 'solid').map((c) => cellKey(c.x, c.y, c.z)));
  const thin = thinWallSideMap(state.cells, state.modules);
  const exposed = (px: number, py: number, pz: number): boolean => facePresent(solid, thin, px, py, pz, face);
  if (!exposed(x, y, z)) return state;
  const seen = new Set<string>([cellKey(x, y, z)]);
  const queue: Array<[number, number, number]> = [[x, y, z]];
  const region: Array<[number, number, number]> = [];
  const plane = FACE_PLANE[face];
  while (queue.length > 0 && region.length < 20000) {
    const [cx, cy, cz] = queue.pop() as [number, number, number];
    region.push([cx, cy, cz]);
    for (const [dx, dy, dz] of plane) {
      const nx = cx + dx;
      const ny = cy + dy;
      const nz = cz + dz;
      const k = cellKey(nx, ny, nz);
      if (seen.has(k) || !exposed(nx, ny, nz)) continue;
      seen.add(k);
      queue.push([nx, ny, nz]);
    }
  }
  const inRegion = new Set(region.map(([rx, ry, rz]) => cellKey(rx, ry, rz)));
  let changed = false;
  const cells = state.cells.map((c) => {
    if (!inRegion.has(cellKey(c.x, c.y, c.z))) return c;
    if (c.finish?.[face] === finish) return c;
    changed = true;
    return { ...c, finish: { ...c.finish, [face]: finish } };
  });
  return changed ? { ...state, cells } : state;
}

/** The finish a face currently wears — used by the eyedropper. */
export function faceFinish(cells: Cell[], x: number, y: number, z: number, face: Face): FinishId {
  const c = cells.find((cc) => cc.x === x && cc.y === y && cc.z === z);
  return c ? finishOf(c, face) : 'floor.granite';
}
