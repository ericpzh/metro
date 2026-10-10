// Build model: zones — the zone brush, its bucket, the floor rule both of them
// publish, and the 分区 map (§4.5: a zone belongs to a floor cell, and the map
// draws one storey at a time).

import { finishOf, floorSpeed } from '../../sim/finishes.ts';
import { storeyBand } from '../../sim/constants.ts';
import { GROUND_Z, groundHoleAt } from '../../sim/ground.ts';
import { zoneIndexOf, zoneOf } from '../../sim/zones.ts';
import { DEFAULT_ZONE, type Cell, type Module, type Zone } from '../../sim/types.ts';
import { cellKey, NEIGH4 } from './Cells.ts';
import type { StationState } from './State.ts';

/* ----------------------------------------------------------- zones (§4.5) */

/**
 * True when a cell is **floor**: a solid whose top face is exposed and walkable
 * — or the bed of a track at the foot of its column, which is the `restricted`
 * zone's own floor. One definition, read by the 分区 brush and by the 分区 map
 * alike, so the ground a brush accepts is exactly the ground the overlay can
 * tint: a zone belongs to a floor cell (§4.5), never to a wall coping, a
 * ceiling, or the earth roof over a tunnel, where the paint would be a label
 * nothing on screen could show.
 */
function isFloorCell(cell: Cell, solid: ReadonlySet<string>): boolean {
  return (
    cell.fill === 'solid' &&
    !solid.has(cellKey(cell.x, cell.y, cell.z + 1)) &&
    (floorSpeed(cell) > 0 || (finishOf(cell, 'top') === 'floor.track' && !solid.has(cellKey(cell.x, cell.y, cell.z - 1))))
  );
}

/** The solid-cell keys the floor rule reads, built once for a whole cell list. */
function solidKeys(cells: readonly Cell[]): Set<string> {
  const out = new Set<string>();
  for (const c of cells) if (c.fill === 'solid') out.add(cellKey(c.x, c.y, c.z));
  return out;
}

/**
 * The floor rule with the solid set already built, for callers asking about many
 * cells (`paintZone`, `paintZoneCells`): the document's own record, or — for a
 * coordinate the document speaks for nowhere — the **street**, which is floor
 * unless the document or a module has opened a hole in it (`groundHoleAt`).
 */
function floorOf(
  solid: ReadonlySet<string>,
  byKey: ReadonlyMap<string, Cell>,
  cells: readonly Cell[],
  modules: readonly Module[],
  x: number,
  y: number,
  z: number,
): boolean {
  const cell = byKey.get(cellKey(x, y, z));
  if (cell) return isFloorCell(cell, solid);
  return z === GROUND_Z && !groundHoleAt(cells, modules, x, y);
}

/**
 * May the 分区 brush paint the cell at `(x, y, z)`? The floor rule as a **point**
 * query over the document, for a caller asking about one cell — the 信息 card's
 * 分区 control. A tool asks about a whole drag rectangle a pointer move at a
 * time and reads a prebuilt key set instead (`zoneFloorKeys`).
 */
export function zoneFloorAt(cells: readonly Cell[], modules: readonly Module[], x: number, y: number, z: number): boolean {
  const byKey = new Map<string, Cell>();
  for (const c of cells) byKey.set(cellKey(c.x, c.y, c.z), c);
  return floorOf(solidKeys(cells), byKey, cells, modules, x, y, z);
}

/**
 * Every key of `cells` the 分区 brush may paint, as an O(1) set a whole drag
 * rectangle can be filtered through. The caller passes the **effective** cell
 * list (`withGround`), because the street a zone may be painted onto is a plane
 * the document never stores.
 */
export function zoneFloorKeys(cells: readonly Cell[]): Set<string> {
  const solid = solidKeys(cells);
  const out = new Set<string>();
  for (const c of cells) if (isFloorCell(c, solid)) out.add(cellKey(c.x, c.y, c.z));
  return out;
}

/**
 * The zone of the cell at `(x, y, z)`: the label it carries, or **无分区** when it
 * carries none (`zoneOf`). A coordinate the document speaks for nowhere is the
 * street at the ground plane — which `withGround` labels 站外, because that plane
 * *is* the world outside the station — and nothing at all anywhere else, which is
 * 无分区: there is no cell there to have a zone.
 */
export function zoneAt(cells: Cell[], x: number, y: number, z: number): Zone {
  const cell = cells.find((c) => c.x === x && c.y === y && c.z === z);
  if (cell) return zoneOf(cell);
  return z === GROUND_Z ? 'outside' : DEFAULT_ZONE;
}

/**
 * Paint a zone. The spec's bucket tool (§4.5): flood-fill the connected floor
 * at the clicked level. `bucket: false` sets one cell.
 */
export function paintZone(state: StationState, x: number, y: number, z: number, zone: Zone, bucket = true): StationState {
  // **无分区 is a reading, not a record.** Asking to paint it would write a label
  // that says "no label" onto cells that already read it, so the paint is refused:
  // the way to 无分区 is `eraseZoneCells`, which takes a record away.
  if (zone === DEFAULT_ZONE) return state;
  // Explicit cells only: a bucket flood must not materialise the infinite
  // street (the plane is one uniform zone already). The rectangle drag
  // (`paintZoneCells`) is the bounded way to zone ground.
  const solid = new Map<string, number>();
  state.cells.forEach((c, i) => {
    if (c.fill === 'solid') solid.set(cellKey(c.x, c.y, c.z), i);
  });
  // §4.5: a zone belongs to a floor cell. The pressed cell has to be one, and
  // the flood stops at every cell that is not — a wall column stands *in* the
  // floor cell under it, so that cell's top is buried and takes no zone.
  const floors = solidKeys(state.cells);
  const targets = new Set<number>();
  const start = solid.get(cellKey(x, y, z));
  if (start === undefined || !isFloorCell(state.cells[start], floors)) return state;
  if (!bucket) {
    targets.add(start);
  } else {
    // Flood the connected floor, but stop at an existing zone line so a region
    // can be repainted once its boundary has been drawn.
    const startZone = zoneOf(state.cells[start]);
    const sameZone = (cx: number, cy: number, cz: number): boolean => {
      const idx = solid.get(cellKey(cx, cy, cz));
      return (
        idx !== undefined &&
        zoneOf(state.cells[idx]) === startZone &&
        isFloorCell(state.cells[idx], floors)
      );
    };
    const seen = new Set<string>([cellKey(x, y, z)]);
    const queue: Array<[number, number, number]> = [[x, y, z]];
    while (queue.length > 0 && targets.size < 20000) {
      const [cx, cy, cz] = queue.pop() as [number, number, number];
      const idx = solid.get(cellKey(cx, cy, cz));
      if (idx === undefined || !isFloorCell(state.cells[idx], floors)) continue;
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
    if (!targets.has(i) || zoneOf(c) === zone) return c;
    changed = true;
    return { ...c, zone };
  });
  return changed ? { ...state, cells } : state;
}

/**
 * Set one zone across a set of cells at once — the zone tool's rectangle drag.
 * §4.5: a zone belongs to a **floor** cell, so the rectangle is filtered by the
 * same rule the 分区 map draws with (`isFloorCell`): a drag that crosses a wall
 * coping, a ceiling or the earth over a tunnel drops those cells rather than
 * writing a zone nothing on screen could show. Only solid cells that are not
 * already in the zone change, and void cells the rectangle covers are ignored,
 * so the drag reads as "tint this patch".
 */
export function paintZoneCells(
  state: StationState,
  cells: Array<[number, number, number]>,
  zone: Zone,
): StationState {
  if (cells.length === 0) return state;
  // See `paintZone`: 无分区 is what a cell reads with no label, so a brush that
  // asks for it is refused — taking a label off is `eraseZoneCells`.
  if (zone === DEFAULT_ZONE) return state;
  const byKey = new Map<string, Cell>();
  for (const c of state.cells) byKey.set(cellKey(c.x, c.y, c.z), c);
  const solid = solidKeys(state.cells);
  const keys = new Set<string>();
  for (const [x, y, z] of cells) {
    if (keys.has(cellKey(x, y, z))) continue;
    if (floorOf(solid, byKey, state.cells, state.modules, x, y, z)) keys.add(cellKey(x, y, z));
  }
  if (keys.size === 0) return state;
  let changed = false;
  const next = state.cells.map((c) => {
    if (c.fill !== 'solid' || !keys.has(cellKey(c.x, c.y, c.z))) return c;
    if (zoneOf(c) === zone) return c;
    changed = true;
    return { ...c, zone };
  });
  // Virgin street in the rectangle materialises wearing the zone, like the
  // bucket; a dug hole takes no zone because it is not floor.
  for (const [x, y, z] of cells) {
    const k = cellKey(x, y, z);
    if (!keys.has(k) || byKey.has(k)) continue;
    changed = true;
    next.push({ x, y, z, fill: 'solid', zone });
  }
  return changed ? { ...state, cells: next } : state;
}

/**
 * Take the zone label **off** a set of cells — the 分区 folder's **无分区** brush,
 * and the 信息 card's own chip of that name. The cells do not get a zone: with the
 * label gone they read **无分区** (`zoneOf`), which is what an unpainted cell is,
 * rather than being handed a fare side nobody chose.
 *
 * Nothing is validated here, and nothing needs to be: removing a label is legal
 * wherever a label is, so this is the one zone edit that does not ask whether the
 * cell is floor.
 *
 * A surface cell the zone brush **materialised** (`paintZoneCells` gives virgin
 * street a record so it can carry a label) goes with its label: with nothing left
 * on it — no finish, no tags — the record *is* the street the document stores
 * inverted (`sim/ground.ts`), so dropping it hands the coordinate back to the
 * plane, which reads 站外 in exactly the same way. A cell that carries anything of
 * its own keeps its record and loses only the label.
 */
export function eraseZoneCells(state: StationState, cells: Array<[number, number, number]>): StationState {
  if (cells.length === 0) return state;
  const keys = new Set(cells.map(([x, y, z]) => cellKey(x, y, z)));
  let changed = false;
  const next: Cell[] = [];
  for (const c of state.cells) {
    if (c.zone === undefined || !keys.has(cellKey(c.x, c.y, c.z))) {
      next.push(c);
      continue;
    }
    changed = true;
    // The plane must really be solid there, too: a coordinate a ramp or an exit
    // opens (`groundHoleAt`) is a hole, and a record standing in one is a block
    // the player laid rather than street — it keeps its record either way.
    const isStreet =
      c.z === GROUND_Z &&
      c.fill === 'solid' &&
      c.finish === undefined &&
      c.tags === undefined &&
      !groundHoleAt(state.cells, state.modules, c.x, c.y);
    if (isStreet) continue;
    const kept: Cell = { ...c };
    delete kept.zone;
    next.push(kept);
  }
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
  // Explicit cells only: the overlay tints the floor a player built. The
  // infinite street would add tens of thousands of quads to every map for a
  // plane that is one uniform, unlabelled zone already.
  const all = cells;
  const solid = solidKeys(all);
  const out = all.filter((c) => isFloorCell(c, solid));
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

/**
 * The zone map of **one storey**: the floor the level being edited holds. The map
 * follows the Z axis — Q/E steps the storey and the map steps with it — so the
 * tint and its labels describe the floor under the camera instead of stacking
 * every storey's paint into one picture.
 *
 * A storey here is `storeyBand`'s, not the raw z: a cell belongs to the grid line
 * at or below it, which is the rule the level slice keys every mesh by
 * (`render/levelSlicing.ts`). A slab that sits off the 4 m grid — the demo's −6
 * landings — is therefore drawn with its −8 storey *and* tinted with it, instead
 * of being paint no storey would ever show. The labels come off the same floors,
 * and no region ever spanned storeys (`zoneRegionLabels` walks the four in-plane
 * neighbours), so they follow for free.
 */
export function zoneMapFloorsAt(cells: readonly Cell[], z: number, modules: readonly Module[] = [], base = 0): Cell[] {
  const storey = storeyBand(z, base);
  return zoneMapFloors(cells, modules).filter((c) => storeyBand(c.z, base) === storey);
}

/** A zone-name label for the zone map, in world coordinates. */
export interface ZoneLabel {
  x: number;
  y: number;
  z: number;
  /** Dense zone index (see `ZONE_INDEX`). */
  zone: number;
  /** Facility name, when the label names a room instead of a fare zone. */
  label?: string;
}

/** Smallest area that earns a text label, so stray single cells stay unlabelled. */
const LABEL_MIN_CELLS = 6;

/**
 * One label per contiguous same-zone floor patch, at the patch's centre. The
 * zone map then names each area (付费区, 站台 …) instead of leaving the player to
 * read colours — the text is what makes it a map.
 */
export function zoneRegionLabels(floors: readonly Cell[], modules: readonly Module[] = []): ZoneLabel[] {
  const byKey = new Map<string, Cell>();
  for (const c of floors) byKey.set(cellKey(c.x, c.y, c.z), c);
  const seen = new Set<string>();
  const labels: ZoneLabel[] = [];
  for (const start of floors) {
    const startKey = cellKey(start.x, start.y, start.z);
    if (seen.has(startKey)) continue;
    const zone = zoneIndexOf(start);
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
        if (!nb || seen.has(k) || zoneIndexOf(nb) !== zone) continue;
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
  for (const m of modules) {
    if (m.type !== 'shop') continue;
    const kind = m.cfg.kind ?? 'store';
    const label = kind === 'store' ? '商店' : kind === 'toilet' ? '厕所' : kind === 'office' ? '办公室' : undefined;
    if (!label) continue;
    const cx = m.x + (m.w ?? 1) / 2;
    const cy = m.y + (m.h ?? 1) / 2;
    // A room can sit on the implicit street plane, which deliberately has no
    // materialised floor cells. Its name must still appear on the zone map.
    const roomFloors = floors.filter((c) => c.z === m.z && c.x >= m.x && c.x < m.x + (m.w ?? 1) && c.y >= m.y && c.y < m.y + (m.h ?? 1));
    let best = roomFloors[0];
    if (!best) {
      labels.push({ x: cx, y: cy, z: m.z + 1.08, zone: zoneIndexOf({}), label });
      continue;
    }
    let bestD = Infinity;
    for (const c of roomFloors) {
      const d = (c.x + 0.5 - cx) ** 2 + (c.y + 0.5 - cy) ** 2;
      if (d < bestD) { bestD = d; best = c; }
    }
    labels.push({ x: best.x + 0.5, y: best.y + 0.5, z: best.z + 1.08, zone: zoneIndexOf(best), label });
  }
  return labels;
}
