// Build model: zones — the zone brush, its bucket, and the zone map (§4.5).

import { finishOf, floorSpeed } from '../../sim/finishes.ts';
import { zoneIndex } from '../../sim/zones.ts';
import { DEFAULT_ZONE, type Cell, type Module, type Zone } from '../../sim/types.ts';
import { cellKey, NEIGH4 } from './Cells.ts';
import type { StationState } from './State.ts';

/* ----------------------------------------------------------- zones (§4.5) */
export function zoneAt(cells: Cell[], x: number, y: number, z: number): Zone {
  return cells.find((c) => c.x === x && c.y === y && c.z === z)?.zone ?? DEFAULT_ZONE;
}

/**
 * Paint a zone. The spec's bucket tool (§4.5): flood-fill the connected floor
 * at the clicked level. `bucket: false` sets one cell.
 */
export function paintZone(state: StationState, x: number, y: number, z: number, zone: Zone, bucket = true): StationState {
  const solid = new Map<string, number>();
  state.cells.forEach((c, i) => {
    if (c.fill === 'solid') solid.set(cellKey(c.x, c.y, c.z), i);
  });
  const targets = new Set<number>();
  const start = solid.get(cellKey(x, y, z));
  if (start === undefined) return state;
  if (!bucket) {
    targets.add(start);
  } else {
    // Flood the connected floor, but stop at an existing zone line so a region
    // can be repainted once its boundary has been drawn.
    const startZone = state.cells[start].zone ?? DEFAULT_ZONE;
    const sameZone = (cx: number, cy: number, cz: number): boolean => {
      const idx = solid.get(cellKey(cx, cy, cz));
      return idx !== undefined && (state.cells[idx].zone ?? DEFAULT_ZONE) === startZone;
    };
    const seen = new Set<string>([cellKey(x, y, z)]);
    const queue: Array<[number, number, number]> = [[x, y, z]];
    while (queue.length > 0 && targets.size < 20000) {
      const [cx, cy, cz] = queue.pop() as [number, number, number];
      const idx = solid.get(cellKey(cx, cy, cz));
      if (idx === undefined) continue;
      targets.add(idx);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const k = cellKey(cx + dx, cy + dy, cz);
        if (seen.has(k) || !sameZone(cx + dx, cy + dy, cz)) continue;
        seen.add(k);
        queue.push([cx + dx, cy + dy, cz]);
      }
    }
  }
  let changed = false;
  const cells = state.cells.map((c, i) => {
    if (!targets.has(i) || (c.zone ?? DEFAULT_ZONE) === zone) return c;
    changed = true;
    return { ...c, zone };
  });
  return changed ? { ...state, cells } : state;
}

/**
 * Set one zone across a set of cells at once — the zone tool's rectangle drag.
 * Only solid cells that are not already in the zone change, and void cells the
 * rectangle covers are ignored, so the drag reads as "tint this patch".
 */
export function paintZoneCells(
  state: StationState,
  cells: Array<[number, number, number]>,
  zone: Zone,
): StationState {
  if (cells.length === 0) return state;
  const keys = new Set(cells.map(([x, y, z]) => cellKey(x, y, z)));
  let changed = false;
  const next = state.cells.map((c) => {
    if (c.fill !== 'solid' || !keys.has(cellKey(c.x, c.y, c.z))) return c;
    if ((c.zone ?? DEFAULT_ZONE) === zone) return c;
    changed = true;
    return { ...c, zone };
  });
  return changed ? { ...state, cells: next } : state;
}

/* ---------------------------------------------------- zone map (§4.5 overlay) */

/**
 * The cells a zone map draws on: the walkable floor, never a roof or a wall top.
 * A cell qualifies when its top face is exposed and walkable, or is a track bed
 * sitting at the foot of its column (the restricted zone). The earth roof over
 * a tunnel and the coping on top of a wall are structure — tinting those is what
 * used to put the zone map on the ceiling instead of the floor.
 */
export function zoneMapFloors(cells: readonly Cell[], modules: readonly Module[] = []): Cell[] {
  const solid = new Set<string>();
  for (const c of cells) if (c.fill === 'solid') solid.add(cellKey(c.x, c.y, c.z));
  const out = cells.filter(
    (c) =>
      c.fill === 'solid' &&
      !solid.has(cellKey(c.x, c.y, c.z + 1)) &&
      (floorSpeed(c) > 0 || (finishOf(c, 'top') === 'floor.track' && !solid.has(cellKey(c.x, c.y, c.z - 1)))),
  );
  // A placed rail digs its bed, so those cells are gone from `cells`. Add the
  // module footprint back as a synthetic restricted cell, so the zone map still
  // tints and names the track.
  const have = new Set(out.map((c) => cellKey(c.x, c.y, c.z)));
  for (const m of modules) {
    if (m.type !== 'track') continue;
    const d = m.d ?? 1;
    for (let x = m.x; x < m.x + m.w; x++) {
      for (let y = m.y; y < m.y + d; y++) {
        const k = cellKey(x, y, m.z);
        if (have.has(k)) continue;
        have.add(k);
        out.push({ x, y, z: m.z, fill: 'solid', finish: { top: 'floor.track' }, zone: 'restricted' });
      }
    }
  }
  return out;
}

/** A zone-name label for the zone map, in world coordinates. */
export interface ZoneLabel {
  x: number;
  y: number;
  z: number;
  /** Dense zone index (see `ZONE_INDEX`). */
  zone: number;
}

/** Smallest area that earns a text label, so stray single cells stay unlabelled. */
const LABEL_MIN_CELLS = 6;

/**
 * One label per contiguous same-zone floor patch, at the patch's centre. The
 * zone map then names each area (付费区, 站台 …) instead of leaving the player to
 * read colours — the text is what makes it a map.
 */
export function zoneRegionLabels(floors: readonly Cell[]): ZoneLabel[] {
  const byKey = new Map<string, Cell>();
  for (const c of floors) byKey.set(cellKey(c.x, c.y, c.z), c);
  const seen = new Set<string>();
  const labels: ZoneLabel[] = [];
  for (const start of floors) {
    const startKey = cellKey(start.x, start.y, start.z);
    if (seen.has(startKey)) continue;
    const zone = zoneIndex(start.zone);
    const stack: Cell[] = [start];
    seen.add(startKey);
    const region: Cell[] = [];
    let sx = 0;
    let sy = 0;
    while (stack.length > 0) {
      const cur = stack.pop() as Cell;
      region.push(cur);
      sx += cur.x + 0.5;
      sy += cur.y + 0.5;
      for (const [dx, dy] of NEIGH4) {
        const k = cellKey(cur.x + dx, cur.y + dy, cur.z);
        const nb = byKey.get(k);
        if (!nb || seen.has(k) || zoneIndex(nb.zone) !== zone) continue;
        seen.add(k);
        stack.push(nb);
      }
    }
    if (region.length < LABEL_MIN_CELLS) continue;
    // Centroid, then snap to the region cell nearest it, so the label always
    // sits on the area (and its tint) rather than floating over a concavity.
    const cx = sx / region.length;
    const cy = sy / region.length;
    let best = region[0];
    let bestD = Infinity;
    for (const c of region) {
      const d = (c.x + 0.5 - cx) ** 2 + (c.y + 0.5 - cy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    labels.push({ x: best.x + 0.5, y: best.y + 0.5, z: best.z + 1.06, zone });
  }
  return labels;
}
