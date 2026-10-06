// Build model: floors — the 方块 patch and its automatic wall ring (§4.1).

import { blockedCellsByLevel } from '../../sim/placement.ts';
import { blockReason } from '../validation.ts';
import { edgeCells, trackCells } from '../../sim/track.ts';
import type { Cell, Module } from '../../sim/types.ts';
import { cellKey, hasTag, NEIGH4, removeCells } from './Cells.ts';
import type { StationState } from './State.ts';
import { AUTO_WALL, AUTO_WALL_H } from './Walls.ts';

/**
 * Tag on a floor cell the 方块 tool drew. A patch is tracked by its cells
 * rather than by a module, so an L-shape or a drag that overlaps hand-built
 * ground all read as one continuous surface. Hand-built floor (the demo, a
 * saved station) is deliberately untagged: it is treated as ground the patch
 * can merge into, not as a patch of its own.
 */
export const AUTO_FLOOR = 'auto-floor';

/**
 * Every cell a placed track covers — a platform bed or a tunnel run. A rail
 * digs its bed, so those cells have left `state.cells` and read as void to the
 * wall flood; the 方块 auto merge treats the whole footprint as covered ground
 * instead of an opening to wall off (see `syncAutoWalls`).
 */
function trackFootprintKeys(modules: readonly Module[]): Set<string> {
  const out = new Set<string>();
  for (const m of modules) {
    if (m.type !== 'track') continue;
    for (const [x, y, z] of trackCells(m)) out.add(cellKey(x, y, z));
  }
  return out;
}

/**
 * Every floor cell a platform screen door stands on. The 方块 auto-wall ring
 * skips these, so a full track sliced through a patch never boards up the
 * screen doors derived along its platform edge.
 */
function platformDoorKeys(modules: readonly Module[]): Set<string> {
  const out = new Set<string>();
  for (const m of modules) {
    if (m.type !== 'platform-edge') continue;
    for (const [x, y, z] of edgeCells(m)) out.add(cellKey(x, y, z));
  }
  return out;
}

/**
 * The new wall columns a 方块 drag will raise: every pending floor cell on the
 * edge of the surface (a same-level neighbour is neither solid nor part of the
 * patch). Used for the live ghost, so the room-like shell shows before release.
 * `solid` is the current station; the patch is preview-only.
 */
export function plannedAutoWalls(
  solid: ReadonlySet<string>,
  floorCells: Array<[number, number, number]>,
  modules: readonly Module[] = [],
): Array<[number, number, number]> {
  const patch = new Set(floorCells.map(([x, y, z]) => cellKey(x, y, z)));
  // The platform/tunnel footprint is covered ground even though a rail dug its
  // bed out of `solid`, so the ghost never promises a wall along the platform
  // edge — that is exactly where the screen doors are derived.
  const covered = new Set(solid);
  for (const k of trackFootprintKeys(modules)) covered.add(k);
  const doors = platformDoorKeys(modules);
  // The cells a piece of equipment already holds, by level: a wall column may not
  // rise through a 闸机, a 售票机 or a 指示牌 any more than a hand-built course may.
  const occupiedAt = blockedCellsByLevel(modules);
  const out: Array<[number, number, number]> = [];
  for (const [x, y, z] of floorCells) {
    // Already-existing floor, or a rail's dug bed the release will skip: no
    // wall rises from a cell the patch does not actually lay.
    if (covered.has(cellKey(x, y, z))) continue;
    // A screen door already stands here: never raise a wall through it.
    if (doors.has(cellKey(x, y, z))) continue;
    let edge = false;
    for (const [dx, dy] of NEIGH4) {
      const k = cellKey(x + dx, y + dy, z);
      if (!covered.has(k) && !patch.has(k)) {
        edge = true;
        break;
      }
    }
    if (!edge) continue;
    for (let dz = 1; dz <= AUTO_WALL_H; dz++) {
      const wk = cellKey(x, y, z + dz);
      if (solid.has(wk)) continue;
      // The same rule set as everything else: the ring never boards up a reserved
      // opening and never rises through a piece of equipment. The patch is
      // preview-only, so the rule reads the station as it stands — a wall column
      // grows into void, and what refuses it is what is already there.
      if (!blockReason([], modules, x, y, z + dz, occupiedAt).ok) continue;
      out.push([x, y, z + dz]);
    }
  }
  return out;
}

/**
 * Rebuild the automatic wall ring around every 方块 floor patch. A patch cell on
 * the outer edge of its surface earns a full-height wall column; an auto wall
 * whose cell became interior — covered by a later drag — or whose floor was dug
 * away is dropped. Hand-placed walls are never added to or removed from,
 * because only `AUTO_WALL` cells are touched.
 *
 * This is the room-union rule applied to floors: overlap or abut two patches
 * and the shared edge inside the union loses its wall while the new outer edge
 * gains one. Only the *outer* edge is walled — a hole dug through the middle of
 * a patch stays open (the void flood cannot reach it), so a stair opening is
 * not silently boarded up. A placed rail digs its bed, so the platform/tunnel
 * footprint is folded into the covered ground too: a full track sliced through
 * a patch reads as part of the surface, not as an opening to wall — otherwise
 * the flood would pour down the trench and board up every screen door along the
 * platform edge. Returns the same state when nothing changed, so a no-op stays
 * out of the undo stack.
 */
export function syncAutoWalls(state: StationState): StationState {
  const solid = new Set<string>();
  for (const c of state.cells) if (c.fill === 'solid') solid.add(cellKey(c.x, c.y, c.z));
  // A dug bed reads as void in `cells`, but it is covered ground for the merge.
  const covered = new Set(solid);
  for (const k of trackFootprintKeys(state.modules)) covered.add(k);
  // Screen-door cells stay unwalled even when they sit on the patch's edge.
  const doors = platformDoorKeys(state.modules);
  // The cells a piece of equipment holds, by level: the ring may no more rise
  // through a 指示牌 or a 售票机 than the live ghost's may (`plannedAutoWalls`).
  const occupiedAt = blockedCellsByLevel(state.modules);
  // Group the tracked floor by level: walls only answer a same-level edge.
  const byLevel = new Map<number, Array<[number, number]>>();
  for (const c of state.cells) {
    if (c.fill !== 'solid' || !hasTag(c, AUTO_FLOOR)) continue;
    const arr = byLevel.get(c.z);
    if (arr) arr.push([c.x, c.y]);
    else byLevel.set(c.z, [[c.x, c.y]]);
  }
  const wanted = new Map<string, [number, number, number]>();
  for (const [z, cells] of byLevel) {
    const patch = new Set(cells.map(([x, y]) => `${x},${y}`));
    // Bounding box padded by one, to bound the exterior flood.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of cells) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    minX--;
    minY--;
    maxX++;
    maxY++;
    // Flood void inward from the padded border, stopping at patch, covered
    // ground (solid or a track footprint). Reached void is outside the surface;
    // an unreached pocket is an interior hole, and earns no wall.
    const seen = new Set<string>();
    const stack: Array<[number, number]> = [];
    const pushVoid = (x: number, y: number): void => {
      if (x < minX || x > maxX || y < minY || y > maxY) return;
      const k = `${x},${y}`;
      if (seen.has(k) || patch.has(k) || covered.has(cellKey(x, y, z))) return;
      seen.add(k);
      stack.push([x, y]);
    };
    for (let x = minX; x <= maxX; x++) {
      pushVoid(x, minY);
      pushVoid(x, maxY);
    }
    for (let y = minY; y <= maxY; y++) {
      pushVoid(minX, y);
      pushVoid(maxX, y);
    }
    while (stack.length > 0) {
      const [x, y] = stack.pop() as [number, number];
      pushVoid(x + 1, y);
      pushVoid(x - 1, y);
      pushVoid(x, y + 1);
      pushVoid(x, y - 1);
    }
    for (const [x, y] of cells) {
      // A platform screen door stands on this cell: no auto wall may rise
      // through it, even when the cell is also on the patch's outer edge.
      if (doors.has(cellKey(x, y, z))) continue;
      let edge = false;
      for (const [dx, dy] of NEIGH4) {
        if (seen.has(`${x + dx},${y + dy}`)) {
          edge = true;
          break;
        }
      }
      if (!edge) continue;
      for (let dz = 1; dz <= AUTO_WALL_H; dz++) {
        // Never board up a reserved opening, and never rise through a piece of
        // equipment: the ghost (`plannedAutoWalls`) leaves the same cells
        // unwalled, and both ask the one rule set.
        if (!blockReason(state.cells, state.modules, x, y, z + dz, occupiedAt).ok) continue;
        wanted.set(cellKey(x, y, z + dz), [x, y, z + dz]);
      }
    }
  }
  let changed = false;
  const kept: Cell[] = [];
  for (const c of state.cells) {
    const k = cellKey(c.x, c.y, c.z);
    if (hasTag(c, AUTO_WALL) && !wanted.has(k)) {
      changed = true;
      continue;
    }
    kept.push(c);
  }
  const have = new Set(kept.map((c) => cellKey(c.x, c.y, c.z)));
  for (const [k, p] of wanted) {
    if (have.has(k)) continue;
    kept.push({ x: p[0], y: p[1], z: p[2], fill: 'solid', tags: [AUTO_WALL] });
    changed = true;
  }
  return changed ? { ...state, cells: kept } : state;
}

/**
 * Add the floor a 方块 rectangle drag drew, tag it as an auto-floor patch, and
 * rebuild the wall ring. Cells the drag covers that already exist are left
 * alone, so extending into hand-built ground is seamless. A single click (a
 * plain block) does not come through here — only a deliberate drag turns into a
 * walled surface.
 *
 * Every cell the drag covers is a candidate the preview judged (`checkBlockCells`
 * over the same `blockReason`), so the two can be compared: the patch lays exactly
 * the accepted cells, and a caller that walked the raw rectangle can see what was
 * refused by comparing the two lists.
 */
export function addFloor(state: StationState, cells: Array<[number, number, number]>): StationState {
  const have = new Set(state.cells.map((c) => cellKey(c.x, c.y, c.z)));
  const level = blockedCellsByLevel(state.modules);
  const grown: Cell[] = [];
  for (const [x, y, z] of cells) {
    const k = cellKey(x, y, z);
    if (have.has(k)) continue;
    // The same rule set the brush and the live ghost ask: a floor drag carries on
    // around a reserved opening, a piece of equipment or a rail's dug bed rather
    // than pouring a block into any of them. The wall ring then wraps the whole
    // patch+track footprint (see `syncAutoWalls`).
    if (!blockReason(state.cells, state.modules, x, y, z, level).ok) continue;
    have.add(k);
    grown.push({ x, y, z, fill: 'solid', tags: [AUTO_FLOOR] });
  }
  if (grown.length === 0) return state;
  return syncAutoWalls({ ...state, cells: [...state.cells, ...grown] });
}

/**
 * Remove blocks a 方块 drag marked, then rebuild the wall ring only if one of
 * them was an auto-floor cell. Removing a hand-placed block, or an auto wall
 * itself, leaves the ring alone so a wall the player deliberately dug out is
 * not silently restored.
 */
export function removeFloor(state: StationState, remove: Array<[number, number, number]>): StationState {
  const killed = new Set(remove.map(([x, y, z]) => cellKey(x, y, z)));
  const droppedFloor = state.cells.some((c) => killed.has(cellKey(c.x, c.y, c.z)) && hasTag(c, AUTO_FLOOR));
  const next = removeCells(state, remove);
  return droppedFloor ? syncAutoWalls(next) : next;
}
