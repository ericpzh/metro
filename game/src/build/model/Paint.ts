// Build model: paint — face finishes, the 材质 brush and its floods (§4.3).

import { DEFAULT_FINISH, finishOf } from '../../sim/finishes.ts';
import { GROUND_Z, PAINTED_GROUND, withGround } from '../../sim/ground.ts';
import { blockIndex } from '../../sim/blockIndex.ts';
import { contactFaceCovered } from '../../sim/contactFinishes.ts';
import { blockReason } from '../validation.ts';
import {
  halfWallInnerFace,
  isHalfWallShape,
  isTriangleShape,
  triangleSlopeFace,
  type Cell,
  type CellShape,
  type Face,
  type FinishId,
} from '../../sim/types.ts';
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
 * exception a player could see the side of a 半墙 and not be able to paint it.
 *
 * A **三角** is the other, and for the same reason: its slope is a face of the
 * *piece*, drawn whether or not the cell it leans to is solid (`pushWedge`). A wedge
 * with a block in the cell above it — an ordinary ramp under a slab — therefore shows
 * a diagonal the boundary rule reports as covered, and the brush used to refuse the
 * one surface of the piece the player was pointing at. The slot is
 * `triangleSlopeFace` (`sim/types.ts`): the one the mesher draws the slope in and the
 * one the pointer reads off its 45° normal, so offering it here is the whole of "the
 * diagonal is paintable". The base square, the hugged face and the two ends are
 * ordinary cell faces and keep the boundary rule below.
 */
export function facePresent(
  solid: ReadonlySet<string>,
  thin: ReadonlyMap<string, CellShape>,
  x: number,
  y: number,
  z: number,
  face: Face,
  occupied: (x: number, y: number, z: number) => boolean = (nx, ny, nz) => solid.has(cellKey(nx, ny, nz)),
): boolean {
  const k = cellKey(x, y, z);
  if (!solid.has(k)) return false;
  const shape = thin.get(k);
  if (shape?.kind === 'corner' && ((shape.side === 'n' || shape.side === 'w' ? face === 'e' : face === 'w') || (shape.side === 'n' || shape.side === 'e' ? face === 's' : face === 'n'))) return true;
  if (isHalfWallShape(shape) && halfWallInnerFace(shape.side) === face) return true;
  if (isTriangleShape(shape) && triangleSlopeFace(shape.triangle) === face) return true;
  const step = FACE_STEP[face];
  const neighbourKey = cellKey(x + step[0], y + step[1], z + step[2]);
  if (!occupied(x + step[0], y + step[1], z + step[2])) return true;

  // Cut neighbours can cover only part of this face. Keep the exposed part
  // paintable, using the same geometric contact rule as finish cleanup.
  const neighbour = thin.get(neighbourKey);
  return neighbour !== undefined && !contactFaceCovered(shape ?? null, neighbour, face);
}

/* ---------------------------------------------------------- surfaces (§4.3) */

/** The finish override on one face, or undefined for the family default. */
export function faceOverride(cells: Cell[], x: number, y: number, z: number, face: Face): FinishId | undefined {
  return cells.find((c) => c.x === x && c.y === y && c.z === z)?.finish?.[face];
}

/** Paint one exposed face. Returns the same state when nothing changed. */
export function paintFace(state: StationState, x: number, y: number, z: number, face: Face, finish: FinishId): StationState {
  const i = state.cells.findIndex((c) => c.x === x && c.y === y && c.z === z);
  // A `void` record is the street's absence, not a surface: a hole takes no
  // finish, and painting one wrote ink onto a cell nothing draws — which the
  // block that later fills the hole back (`addCells`) then dropped on the floor
  // with the record it replaced.
  if (i >= 0 && state.cells[i].fill !== 'solid') return state;
  // Use the same materialisation and opening rules as a rectangle stroke.
  if (i < 0) {
    if (z !== GROUND_Z) return state;
    return paintFaces(state, [[x, y, z]], face, finish);
  }
  const cur = state.cells[i];
  if (cur.finish?.[face] === finish) return state;
  const cells = state.cells.slice();
  cells[i] = { ...cur, finish: { ...cur.finish, [face]: finish } };
  return { ...state, cells };
}

/** Erase a face back to its family default. */
export function eraseFace(state: StationState, x: number, y: number, z: number, face: Face): StationState {
  const i = state.cells.findIndex((c) => c.x === x && c.y === y && c.z === z);
  if (i < 0 || state.cells[i].fill !== 'solid') return state;
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
 * Untargeted cells, openings and cells already wearing the finish stay as they are.
 */
export function paintFaces(state: StationState, cells: Array<[number, number, number]>, face: Face, finish: FinishId): StationState {
  const keys = new Set(cells.map(([x, y, z]) => cellKey(x, y, z)));
  if (keys.size === 0) return state;
  const missing = new Set(keys);
  let changed = false;
  const next = state.cells.map((c) => {
    const key = cellKey(c.x, c.y, c.z);
    missing.delete(key);
    // A hole is not a surface (`paintFace`): only a block takes a finish.
    if (c.fill !== 'solid' || !keys.has(key) || c.finish?.[face] === finish) return c;
    changed = true;
    return { ...c, finish: { ...c.finish, [face]: finish } };
  });
  // The underside already exists beneath street fixtures. Materialising it
  // records a finish without introducing new volume or changing its outside zone.
  const level = blockIndex(state.cells, state.modules);
  for (const [x, y, z] of cells) {
    const k = cellKey(x, y, z);
    if (!missing.delete(k) || !level.ground(x, y, z)) continue;
    if (face !== 'bottom' && !blockReason(state.cells, state.modules, x, y, z, level).ok) continue;
    changed = true;
    next.push({
      x, y, z, fill: 'solid', finish: { [face]: finish },
      ...(face === 'bottom' ? { zone: 'outside', tags: [PAINTED_GROUND] } : {}),
    });
  }
  return changed ? { ...state, cells: next } : state;
}

/** Erase one face across many cells at once, back to the family default. */
export function eraseFaces(state: StationState, cells: Array<[number, number, number]>, face: Face): StationState {
  const keys = new Set(cells.map(([x, y, z]) => cellKey(x, y, z)));
  if (keys.size === 0) return state;
  let changed = false;
  const next = state.cells.map((c) => {
    if (c.fill !== 'solid' || !keys.has(cellKey(c.x, c.y, c.z)) || !c.finish?.[face]) return c;
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

/** Paint the visible body of a pillar; its steel collars keep their own finish. */
export function paintPillarSurface(state: StationState, id: string, finish: FinishId | null): StationState {
  let changed = false;
  const modules = state.modules.map((m): typeof m => {
    if (m.type !== 'pillar' || m.id !== id) return m;
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
 * (§4.3, the 整面 brush). The region stops at unexposed faces and at the
 * plane's edge, not at a change of current finish — you are painting a floor.
 *
 * A **半墙**'s inner face counts as exposed even when the cell across it is solid:
 * the panel is half a block thick, so that surface looks into its own cell's clear
 * half and nothing can stand across it. Flooding from one column of a run
 * therefore paints the whole run, which is the surface the player sees.
 *
 * A **三角**'s slope is the same kind of exception (`facePresent`): it is a face of
 * the piece, so a flood over it carries on into the horizontal faces wearing the same
 * slot (`triangleSlopeFace`) beside it — the diagonal and the floor or ceiling it
 * leans to are one surface to the brush, which is the only reading the palette has of
 * "the same face".
 *
 * The region is bounded by the connected surface. A fixed cell budget would
 * cut off a depth-first walk in an order the player cannot see: a large
 * floor could lose cells beside the one that was clicked while the rest painted.
 */
export function fillSurface(state: StationState, x: number, y: number, z: number, face: Face, finish: FinishId): StationState {
  const index = blockIndex(state.cells, state.modules);
  let solid = index.solid;
  if (z === GROUND_Z && face === 'bottom') {
    // Include the same generated pavement the editor meshes. A floor below is
    // irrelevant to whether this ceiling is present or connected.
    const effective = withGround(state.cells, state.modules);
    solid = new Set(solid);
    for (let i = state.cells.length; i < effective.length; i++) {
      const c = effective[i];
      solid.add(cellKey(c.x, c.y, c.z));
    }
  }
  const thin = thinWallSideMap(state.cells, state.modules);
  // Generated street outside the flood still occludes other faces. Treating it
  // as air lets a wall flood bridge a buried row at z=0.
  const step = FACE_STEP[face];
  const vertical = step[2] === 0;
  const ceilings = new Set<string>();
  const ceilingLevels = new Map<string, number[]>();
  if (vertical) for (const c of state.cells) {
    if (c.fill !== 'solid' || !c.tags?.includes('suspended-ceiling')) continue;
    ceilings.add(cellKey(c.x, c.y, c.z));
    // Index the wall column facing this ceiling. Its ceiling course may be
    // painted, but the flood cannot travel to the other side of that course.
    const column = cellKey(c.x - step[0], c.y - step[1], 0);
    const levels = ceilingLevels.get(column) ?? [];
    levels.push(c.z);
    ceilingLevels.set(column, levels);
  }
  const occupied = (px: number, py: number, pz: number): boolean =>
    (!ceilings.has(cellKey(px, py, pz)) && solid.has(cellKey(px, py, pz))) || index.ground(px, py, pz);
  const exposed = (px: number, py: number, pz: number): boolean => {
    const levels = ceilingLevels.get(cellKey(px, py, 0));
    if (levels?.some(level => z <= level ? pz > level : pz <= level)) return false;
    return facePresent(solid, thin, px, py, pz, face, occupied);
  };
  const inset = (px: number, py: number, pz: number): boolean => {
    const shape = thin.get(cellKey(px, py, pz));
    return (shape?.kind === 'corner' && ((shape.side === 'n' || shape.side === 'w' ? face === 'e' : face === 'w') || (shape.side === 'n' || shape.side === 'e' ? face === 's' : face === 'n'))) || (isHalfWallShape(shape) && halfWallInnerFace(shape.side) === face);
  };
  if (!exposed(x, y, z)) return state;
  const seen = new Set<string>([cellKey(x, y, z)]);
  const queue: Array<[number, number, number]> = [[x, y, z]];
  const region: Array<[number, number, number]> = [];
  const plane = FACE_PLANE[face];
  while (queue.length > 0) {
    const [cx, cy, cz] = queue.pop() as [number, number, number];
    region.push([cx, cy, cz]);
    for (const [dx, dy, dz] of plane) {
      const nx = cx + dx;
      const ny = cy + dy;
      const nz = cz + dz;
      const k = cellKey(nx, ny, nz);
      if (seen.has(k) || !exposed(nx, ny, nz) || inset(cx, cy, cz) !== inset(nx, ny, nz)) continue;
      seen.add(k);
      queue.push([nx, ny, nz]);
    }
  }
  return paintFaces(state, region, face, finish);
}

/** The finish a face currently wears — used by the eyedropper. */
export function faceFinish(cells: Cell[], x: number, y: number, z: number, face: Face): FinishId {
  const c = cells.find((cc) => cc.x === x && cc.y === y && cc.z === z);
  return c ? finishOf(c, face) : DEFAULT_FINISH[face];
}
