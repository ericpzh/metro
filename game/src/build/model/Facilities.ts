// Build model: facilities — shop/toilet/office rooms, the booth, auto furniture (§5.7).

import type { Cell, Module, RoomKind } from '../../sim/types.ts';
import { virtualSolidAt } from '../../sim/ground.ts';
import { cellKey } from './Cells.ts';
import { nextModuleId } from './Equipment.ts';
import type { StationState } from './State.ts';

/* ---------------- shop, toilet, office & booth (facility rooms) */

/**
 * Facility room kind built by the zone tool's rectangle drag. `store`, `toilet`
 * and `office` are walled rooms: they share the `shop` module type and pick their
 * fit-out with `cfg.kind`. `ticket` is an open desk counter with no walls (the
 * `booth` module). The names are the brushes the rail hands the drag — the same
 * ids `FACILITY_OPTIONS` carries — so a brush and the piece it builds share one
 * vocabulary; only the *saved* module keeps its own `shop` / `booth` type.
 */
export type FacilityKind = 'store' | 'toilet' | 'office' | 'ticket';

/** The walled-room brushes, mapped to the module `cfg.kind` each one builds. */
const WALLED_ROOM: Record<'store' | 'toilet' | 'office', RoomKind> = {
  store: 'store',
  toilet: 'toilet',
  office: 'office',
};

/** True for a brush that builds a walled room — every facility kind but the booth. */
export function isWalledRoomKind(kind: FacilityKind): kind is 'store' | 'toilet' | 'office' {
  return kind !== 'ticket';
}

/** The fit-out of a walled room, defaulting legacy shops to a store. */
function roomKindOf(m: Module): string | undefined {
  return m.type === 'shop' ? (m.cfg.kind ?? 'store') : undefined;
}

/**
 * Identity a facility drag compares against. Two walled rooms merge only when
 * their `cfg.kind` matches, so a toilet drawn over a shop is a clash, not a
 * silent fit-out swap; anything of a different type (a booth, a retail shell)
 * is likewise a clash.
 */
function facilitySignature(type: string, roomKind?: string): string {
  return type === 'shop' ? `shop:${roomKind ?? 'store'}` : type;
}

/** The signature a brush builds — the twin of `facilitySignature`. */
function brushSignature(kind: FacilityKind): string {
  return isWalledRoomKind(kind) ? `shop:${WALLED_ROOM[kind]}` : 'booth';
}

/** Minimum room size: walls + at least 1 m of walkable interior. */
export const FACILITY_MIN = 3;

/** Wall height in blocks above the floor: a shop is a full room. */
export const SHOP_WALL_H = 3;

export interface FacilityRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  z: number;
}

/** Normalise two corners into an inclusive rect on one level. */
export function facilityRect(a: [number, number, number], b: [number, number, number], z: number): FacilityRect {
  return {
    x0: Math.min(a[0], b[0]),
    y0: Math.min(a[1], b[1]),
    x1: Math.max(a[0], b[0]),
    y1: Math.max(a[1], b[1]),
    z,
  };
}

function isPerimeter(r: FacilityRect, x: number, y: number): boolean {
  return x === r.x0 || x === r.x1 || y === r.y0 || y === r.y1;
}

/**
 * Does an existing wall already enclose this side? True when the cell just
 * outside the rect is solid AND has solid above it (a wall column, not open
 * floor). Open floor — solid with nothing above — still needs our own wall.
 */
function touchingExistingWall(solid: Set<string>, x: number, y: number, z: number): boolean {
  return solid.has(cellKey(x, y, z)) && solid.has(cellKey(x, y, z + 1));
}

function outsideOf(r: FacilityRect, x: number, y: number): [number, number] {
  if (x === r.x0) return [x - 1, y];
  if (x === r.x1) return [x + 1, y];
  if (y === r.y0) return [x, y - 1];
  return [x, y + 1];
}

/** The module's own rect on its floor level. */
export function facilityRectOf(mod: { x: number; y: number; z: number; w?: number; h?: number }): FacilityRect {
  const w = mod.w ?? 1;
  const h = mod.h ?? 1;
  return { x0: mod.x, y0: mod.y, x1: mod.x + w - 1, y1: mod.y + h - 1, z: mod.z };
}

/**
 * Does a drag rectangle cover the whole room? Then the right-click gesture
 * means "delete the store" rather than "cut an opening".
 */
export function facilityCovers(mod: { x: number; y: number; z: number; w?: number; h?: number }, r: FacilityRect): boolean {
  const own = facilityRectOf(mod);
  if (r.z !== own.z) return false;
  return r.x0 <= own.x0 && r.y0 <= own.y0 && r.x1 >= own.x1 && r.y1 >= own.y1;
}

/**
 * The facility room a cell belongs to — its floor or any of its walls — so a
 * right-click on a wall finds the store it should edit.
 */
export function facilityAt(state: StationState, x: number, y: number, z: number): Module | undefined {
  for (const m of state.modules) {
    if (m.type !== 'shop' && m.type !== 'booth' && m.type !== 'retail') continue;
    const w = (m as { w?: number }).w ?? 1;
    const h = (m as { h?: number }).h ?? 1;
    if (x >= m.x && x < m.x + w && y >= m.y && y < m.y + h && z >= m.z && z <= m.z + SHOP_WALL_H) return m;
  }
  return undefined;
}

/** True when two rects share at least one cell on the same level. */
function facilityOverlap(a: FacilityRect, b: FacilityRect): boolean {
  return a.z === b.z && a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
}

/** Facility rooms (shop / booth / retail) whose footprint overlaps `r`. */
export function facilitiesOverlapping(state: StationState, r: FacilityRect): Module[] {
  return state.modules.filter(
    (m) => (m.type === 'shop' || m.type === 'booth' || m.type === 'retail') && facilityOverlap(facilityRectOf(m), r),
  );
}

export interface FacilityPlan {
  /** The rect the room would occupy: the drawn rect merged with same-type rooms. */
  rect: FacilityRect;
  /** Same-type rooms a placement would absorb (their union is extended). */
  merge: Module[];
  /** A different-type room the drag overlaps, if any. */
  blockedBy: Module | null;
}

/**
 * What a facility rectangle drag would do. Overlapping a room of another type is
 * refused (`blockedBy`); overlapping rooms of the same kind (same module type
 * and, for walled rooms, the same fit-out) extend into a single room covering
 * the union, instead of stacking a second module on top.
 *
 * The union is grown repeatedly: extending two rooms can make the bounding box
 * overlap a room (or the void corner) the drag never touched, and that clash has
 * to refuse the placement rather than silently swallow it.
 */
export function facilityPlan(state: StationState, kind: FacilityKind, r: FacilityRect): FacilityPlan {
  const merge: Module[] = [];
  const seen = new Set<string>();
  const want = brushSignature(kind);
  let rect = r;
  for (;;) {
    const overlapping = facilitiesOverlapping(state, rect);
    const blockedBy = overlapping.find((m) => facilitySignature(m.type, roomKindOf(m)) !== want) ?? null;
    if (blockedBy) return { rect, merge, blockedBy };
    let grew = false;
    for (const m of overlapping) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      merge.push(m);
      const own = facilityRectOf(m);
      const grown: FacilityRect = {
        x0: Math.min(rect.x0, own.x0),
        y0: Math.min(rect.y0, own.y0),
        x1: Math.max(rect.x1, own.x1),
        y1: Math.max(rect.y1, own.y1),
        z: rect.z,
      };
      if (grown.x0 !== rect.x0 || grown.y0 !== rect.y0 || grown.x1 !== rect.x1 || grown.y1 !== rect.y1) grew = true;
      rect = grown;
    }
    if (!grew) break;
  }
  return { rect, merge, blockedBy: null };
}

/** One furniture unit's floor cell and quarter-turn, for the room layouts below. */
export interface FurnitureSpot {
  type: 'shelf' | 'desk' | 'cubicle' | 'sink' | 'bench';
  x: number;
  y: number;
  /**
   * 0 = run along x, 1 = along y, 2 = along x turned 180°, 3 = along y turned
   * 180°. A wall shelf uses the turn that backs its panel onto the wall (2 for
   * the −y wall, 0 for +y, 1 for −x, 3 for +x); desks, restroom fixtures and
   * benches use their own facing.
   */
  rot: number;
}

/**
 * Where a store's shelf units stand (§5.7): interior island rows inset one cell
 * from the walls with one aisle between rows, plus one unit against the inner
 * face of every straight (non-corner) wall run — including a side the room did
 * not wall itself because a pre-existing wall column already encloses it.
 * Door cells (cut openings) get no shelf. The room builder lays one `shelf`
 * module per spot, so every auto shelf is individually bulldozable.
 */
export function storeShelfSpots(
  cells: readonly Cell[],
  rect: FacilityRect,
  doors: ReadonlySet<string> = new Set(),
): FurnitureSpot[] {
  const { x0, y0, x1, y1, z } = rect;
  const spots: FurnitureSpot[] = [];
  for (let y = y0 + 2; y <= y1 - 2; y += 2) {
    for (let x = x0 + 1; x <= x1 - 1; x++) spots.push({ type: 'shelf', x, y, rot: 0 });
  }
  const solid = new Set<string>();
  for (const c of cells) if (c.fill === 'solid') solid.add(cellKey(c.x, c.y, c.z));
  const walled = new Set<string>();
  for (const [x, y] of facilityWallCells(cells, { x: x0, y: y0, z, w: x1 - x0 + 1, h: y1 - y0 + 1, type: 'shop' })) {
    walled.add(`${x},${y}`);
  }
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      if (!isPerimeter(rect, x, y)) continue;
      if ((x === x0 || x === x1) && (y === y0 || y === y1)) continue;
      if (doors.has(`${x},${y}`)) continue;
      let run = walled.has(`${x},${y}`);
      if (!run) {
        const [ox, oy] = outsideOf(rect, x, y);
        run = touchingExistingWall(solid, ox, oy, z);
      }
      if (!run) continue;
      spots.push({ type: 'shelf', x, y, rot: y === y0 ? 2 : y === y1 ? 0 : x === x0 ? 1 : 3 });
    }
  }
  return spots;
}

/**
 * Where an office's desk units stand (§5.7): a grid inset one cell from the
 * walls, one aisle between rows and columns. Desks need no wall behind them,
 * so only the rect matters. The room builder lays one `desk` module per spot,
 * individually bulldozable like a shelf.
 */
export function officeDeskSpots(rect: FacilityRect): FurnitureSpot[] {
  const spots: FurnitureSpot[] = [];
  for (let y = rect.y0 + 1; y <= rect.y1 - 1; y += 2) {
    for (let x = rect.x0 + 1; x <= rect.x1 - 1; x += 2) spots.push({ type: 'desk', x, y, rot: 0 });
  }
  return spots;
}

/**
 * Where a restroom's units stand (§5.7): one `cubicle` (partition + WC + tank)
 * per back-row cell and one `sink` per front-row cell, both inset one cell
 * from the side walls. Door cells (cut openings) get no unit. The room builder
 * lays one module per spot, individually bulldozable like a shelf.
 */
export function restroomSpots(rect: FacilityRect, doors: ReadonlySet<string> = new Set()): FurnitureSpot[] {
  const spots: FurnitureSpot[] = [];
  for (let x = rect.x0 + 1; x <= rect.x1 - 1; x++) {
    if (!doors.has(`${x},${rect.y1 - 1}`)) spots.push({ type: 'cubicle', x, y: rect.y1 - 1, rot: 0 });
    if (!doors.has(`${x},${rect.y0}`)) spots.push({ type: 'sink', x, y: rect.y0, rot: 0 });
  }
  return spots;
}

/**
 * The booth's staff seats: one `bench` per back-row interior cell, facing the
 * front counter (rot 2). Mirrors the seats the booth model used to draw, so a
 * migrated booth reads exactly as before — except each seat is now its own
 * right-clickable module.
 */
export function boothBenchSpots(rect: FacilityRect): FurnitureSpot[] {
  const spots: FurnitureSpot[] = [];
  if (rect.y1 - 1 <= rect.y0) return spots;
  for (let x = rect.x0 + 1; x <= rect.x1 - 1; x++) spots.push({ type: 'bench', x, y: rect.y1 - 1, rot: 2 });
  return spots;
}

/**
 * Lay one auto furniture module (`cfg.auto`) per spot, skipping cells that
 * already hold a shelf or desk — a hand-placed 货架/办公桌 keeps its cell, and
 * a merge never stacks two units on each other.
 */
function addAutoFurniture(state: StationState, z: number, spots: readonly FurnitureSpot[]): StationState {
  const taken = new Set<string>();
  for (const m of state.modules) {
    if ((m.type === 'shelf' || m.type === 'desk' || m.type === 'cubicle' || m.type === 'sink' || m.type === 'bench') && m.z === z) {
      taken.add(`${m.x},${m.y}`);
    }
  }
  const modules = [...state.modules];
  for (const s of spots) {
    const k = `${s.x},${s.y}`;
    if (taken.has(k)) continue;
    taken.add(k);
    if (s.type === 'shelf') {
      modules.push({ id: nextModuleId(modules, 'shelf'), type: 'shelf', x: s.x, y: s.y, z, rot: s.rot, cfg: { auto: true } });
    } else if (s.type === 'desk') {
      modules.push({ id: nextModuleId(modules, 'desk'), type: 'desk', x: s.x, y: s.y, z, rot: s.rot, cfg: { auto: true } });
    } else if (s.type === 'cubicle') {
      modules.push({ id: nextModuleId(modules, 'cubicle'), type: 'cubicle', x: s.x, y: s.y, z, rot: s.rot, cfg: { auto: true } });
    } else if (s.type === 'sink') {
      modules.push({ id: nextModuleId(modules, 'sink'), type: 'sink', x: s.x, y: s.y, z, rot: s.rot, cfg: { auto: true } });
    } else {
      modules.push({ id: nextModuleId(modules, 'bench'), type: 'bench', x: s.x, y: s.y, z, rot: s.rot, cfg: { auto: true } });
    }
  }
  return modules.length === state.modules.length ? state : { ...state, modules };
}

/**
 * Drop a room's auto-generated furniture (`cfg.auto`), leaving hand-placed
 * 货架/办公桌 where they stand. Used when the room itself goes away.
 */
function dropAutoFurniture(state: StationState, rect: FacilityRect): StationState {
  const kill = new Set<string>();
  for (const m of state.modules) {
    if (m.type !== 'shelf' && m.type !== 'desk' && m.type !== 'cubicle' && m.type !== 'sink' && m.type !== 'bench') continue;
    if (!m.cfg.auto) continue;
    if (m.z !== rect.z) continue;
    if (m.x >= rect.x0 && m.x <= rect.x1 && m.y >= rect.y0 && m.y <= rect.y1) kill.add(m.id);
  }
  if (kill.size === 0) return state;
  return { ...state, modules: state.modules.filter((m) => !kill.has(m.id)) };
}

/** Mark a walled room, retail shell or booth as furniture-materialised. */
function markRoomStocked(state: StationState, id: string): StationState {
  const modules = state.modules.map((m): Module => {
    if (m.id !== id) return m;
    if (m.type === 'shop') return { ...m, cfg: { ...m.cfg, stocked: true } };
    if (m.type === 'retail') return { ...m, cfg: { ...m.cfg, stocked: true } };
    if (m.type === 'booth') return { ...m, cfg: { ...m.cfg, stocked: true } };
    return m;
  });
  return { ...state, modules };
}

/**
 * Bring legacy rooms up to the furniture-module model: a store-kind room drawn
 * before auto shelves became individually placed pieces gets one `shelf`
 * module per layout spot, an office one `desk` per grid spot, a restroom its
 * cubicles and sinks, and a booth its staff benches. A room the player already
 * cleared of its drawn shelving (the old `cfg.bare`) just has the flag
 * consumed. Rooms that already went through this carry `cfg.stocked` and are
 * left alone, so re-running never duplicates a unit — deleting every unit
 * stays deleted across a reload.
 * Returns the same state when nothing changed.
 */
export function ensureRoomFurniture(state: StationState): StationState {
  let next = state;
  let changed = false;
  for (const m of state.modules) {
    if (m.type !== 'shop' && m.type !== 'retail' && m.type !== 'booth') continue;
    // What the room stocks: a retail shell is a store, a booth is a ticket desk,
    // and a walled room says so itself in `cfg.kind`.
    const fitOut = m.type === 'retail' ? 'store' : m.type === 'booth' ? 'ticket' : (m.cfg.kind ?? 'store');
    if ((fitOut !== 'store' && fitOut !== 'office' && fitOut !== 'toilet' && fitOut !== 'ticket') || m.cfg.stocked) continue;
    // The old clear-the-room flag only ever existed on stores; booths never had it.
    const bare = m.type !== 'booth' && m.cfg.bare === true;
    if (bare) {
      next = markRoomStocked(next, m.id);
    } else {
      const rect = facilityRectOf(m);
      if (fitOut === 'store') {
        const doorPairs: Array<[number, number]> = m.type === 'shop' ? (m.cfg.door ?? []) : [];
        const doors = new Set(doorPairs.map(([x, y]) => `${x},${y}`));
        next = addAutoFurniture(next, m.z, storeShelfSpots(next.cells, rect, doors));
      } else if (fitOut === 'office') {
        next = addAutoFurniture(next, m.z, officeDeskSpots(rect));
      } else if (fitOut === 'toilet') {
        const doorPairs: Array<[number, number]> = m.type === 'shop' ? (m.cfg.door ?? []) : [];
        const doors = new Set(doorPairs.map(([x, y]) => `${x},${y}`));
        next = addAutoFurniture(next, m.z, restroomSpots(rect, doors));
      } else {
        next = addAutoFurniture(next, m.z, boothBenchSpots(rect));
      }
      next = markRoomStocked(next, m.id);
    }
    changed = true;
  }
  return changed ? next : state;
}

/**
 * Place a walled room (商店 / 厕所 / 办公室) or a booth, or extend a room of
 * the same kind when the drag overlaps one (a different kind is never overlapped
 * — `facilityPlan` reports the clash so the UI can explain).
 *
 * A **walled room** is a small building: full-height solid walls around its
 * floor. There is deliberately **no doorway** — the player right-clicks the wall
 * to cut an opening afterwards, so the room is exactly as sealed as they made
 * it. Walls are skipped where an existing wall column already encloses that
 * side. The brush (`kind`) picks the fit-out the renderer draws via `cfg.kind`.
 *
 * A **booth** is not a walled room at all: just a desk counter around the floor
 * (a thin model, no voxel base) enclosing a staff area the crowd is served from
 * outside. It has no opening and never gets one.
 *
 * Requires open floor under the whole rect; returns the unchanged state when
 * the rect is too small, has no floor, or overlaps another room kind.
 */
export function placeFacility(
  state: StationState,
  kind: FacilityKind,
  r: FacilityRect,
  id?: string,
): StationState {
  const plan = facilityPlan(state, kind, r);
  if (plan.blockedBy) return state;
  const rect = plan.rect;
  // Absorbed same-type rooms go first, so their walls are rebuilt around the
  // extended footprint instead of being left stranded inside it.
  const base = plan.merge.length > 0 ? removeFacilitySet(state, new Set(plan.merge.map((m) => m.id))) : state;
  const w = rect.x1 - rect.x0 + 1;
  const h = rect.y1 - rect.y0 + 1;
  if (w < FACILITY_MIN || h < FACILITY_MIN) return state;
  if (w * h > 400) return state;
  const solid = new Set(base.cells.filter((c) => c.fill === 'solid').map((c) => cellKey(c.x, c.y, c.z)));
  // Every rect cell must already be floor — and at z = 0 the implicit street
  // (`sim/ground.ts`) is floor, so a room may be drawn on virgin ground. A cell
  // the player dug through is not: the hole is the one thing the plane withholds.
  for (let x = rect.x0; x <= rect.x1; x++) {
    for (let y = rect.y0; y <= rect.y1; y++) {
      if (!solid.has(cellKey(x, y, rect.z)) && !virtualSolidAt(base.cells, base.modules, x, y, rect.z)) return state;
    }
  }
  // Openings inherited from a room being extended, kept only where they still
  // sit on the new perimeter; an opening that becomes interior vanishes with the
  // wall it was cut from.
  const doors = new Set<string>();
  for (const m of plan.merge) {
    if (m.type !== 'shop' && m.type !== 'booth') continue;
    for (const [dx, dy] of m.cfg.door ?? []) doors.add(`${dx},${dy}`);
  }
  const add: Cell[] = [];
  const keptDoors: Array<[number, number]> = [];
  if (isWalledRoomKind(kind)) {
    const have = new Set(solid);
    for (let x = rect.x0; x <= rect.x1; x++) {
      for (let y = rect.y0; y <= rect.y1; y++) {
        if (!isPerimeter(rect, x, y)) continue;
        if (doors.has(`${x},${y}`)) {
          keptDoors.push([x, y]);
          continue;
        }
        // Skip a side an existing wall column already encloses.
        const [ox, oy] = outsideOf(rect, x, y);
        if (touchingExistingWall(solid, ox, oy, rect.z)) continue;
        for (let dz = 1; dz <= SHOP_WALL_H; dz++) {
          const kk = cellKey(x, y, rect.z + dz);
          if (have.has(kk)) continue;
          have.add(kk);
          add.push({ x, y, z: rect.z + dz, fill: 'solid' });
        }
      }
    }
  }
  // Keep the original room's id when extending, so selection and saves follow it.
  const modId = id ?? plan.merge[0]?.id ?? nextModuleId(state.modules, kind);
  // A store stocks its own shelves as individual `shelf` modules, an office
  // its desks as `desk` modules, a restroom its cubicles and sinks, and a
  // booth its staff benches — one module per layout spot — so every unit is
  // right-clickable on its own. Absorbed rooms bring no auto furniture along
  // (their walls move); hand-placed pieces stay, and fresh units skip cells a
  // hand-placed unit already holds.
  const fitOut = isWalledRoomKind(kind) ? WALLED_ROOM[kind] : null;
  const stocksShelves = fitOut === 'store';
  const stocksDesks = fitOut === 'office';
  const stocksRestroom = fitOut === 'toilet';
  // The one brush that is not a walled room — so it is the one that stocks seats.
  const stocksBooth = kind === 'ticket';
  const stocked = stocksShelves || stocksDesks || stocksRestroom || stocksBooth;
  const module = (
    isWalledRoomKind(kind)
      ? {
          id: modId,
          type: 'shop',
          x: rect.x0,
          y: rect.y0,
          z: rect.z,
          w,
          h,
          cfg: { kind: WALLED_ROOM[kind], door: keptDoors, ...(stocked ? { stocked: true } : {}) },
        }
      : { id: modId, type: 'booth', x: rect.x0, y: rect.y0, z: rect.z, w, h, cfg: { kind: 'ticket', stocked: true } }
  ) as StationState['modules'][number];
  let next = { ...base, cells: [...base.cells, ...add], modules: [...base.modules, module] };
  if (stocksShelves) {
    const doorKeys = new Set(keptDoors.map(([x, y]) => `${x},${y}`));
    next = addAutoFurniture(next, rect.z, storeShelfSpots(next.cells, rect, doorKeys));
  } else if (stocksDesks) {
    next = addAutoFurniture(next, rect.z, officeDeskSpots(rect));
  } else if (stocksRestroom) {
    const doorKeys = new Set(keptDoors.map(([x, y]) => `${x},${y}`));
    next = addAutoFurniture(next, rect.z, restroomSpots(rect, doorKeys));
  } else if (stocksBooth) {
    next = addAutoFurniture(next, rect.z, boothBenchSpots(rect));
  }
  return next;
}

/**
 * Every wall cell a walled room currently has — its whole wall ring. Empty for
 * a booth (its desk is a model, not voxels) or a room whose walls have all been
 * opened.
 */
export function facilityWallCells(
  cells: readonly Cell[],
  mod: { x: number; y: number; z: number; w?: number; h?: number; type: string },
): Array<[number, number, number]> {
  if (mod.type !== 'shop') return [];
  const own = facilityRectOf(mod);
  const solid = new Set<string>();
  for (const c of cells) if (c.fill === 'solid') solid.add(cellKey(c.x, c.y, c.z));
  const out: Array<[number, number, number]> = [];
  for (let x = own.x0; x <= own.x1; x++) {
    for (let y = own.y0; y <= own.y1; y++) {
      if (!isPerimeter(own, x, y)) continue;
      for (let dz = 1; dz <= SHOP_WALL_H; dz++) {
        if (solid.has(cellKey(x, y, own.z + dz))) out.push([x, y, own.z + dz]);
      }
    }
  }
  return out;
}

/** Every floor cell of a facility's footprint. */
export function facilityFloorCells(mod: { x: number; y: number; z: number; w?: number; h?: number }): Array<[number, number, number]> {
  const own = facilityRectOf(mod);
  const out: Array<[number, number, number]> = [];
  for (let x = own.x0; x <= own.x1; x++) for (let y = own.y0; y <= own.y1; y++) out.push([x, y, own.z]);
  return out;
}

/**
 * The wall cells a right-click drag would cut open. Only wall columns directly
 * above the room's perimeter floor cells the drag touches are returned, so an
 * opening is exactly where the player dragged — any run length, and any number
 * of separate openings.
 */
export function facilityOpeningCells(
  cells: readonly Cell[],
  mod: { x: number; y: number; z: number; w?: number; h?: number; type: string },
  r: FacilityRect,
): Array<[number, number, number]> {
  return facilityWallCells(cells, mod).filter(([x, y]) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);
}

/**
 * Cut the openings a right-click drag planned, and remember them on the room.
 * A walled room is a building: once its last wall is opened the room is gone, so
 * it is removed too (leaving only the floor it stood on).
 */
export function carveFacilityOpenings(
  state: StationState,
  id: string,
  cells: Array<[number, number, number]>,
): StationState {
  if (cells.length === 0) return state;
  const kill = new Set(cells.map(([x, y, z]) => cellKey(x, y, z)));
  const nextCells = state.cells.filter((c) => !kill.has(cellKey(c.x, c.y, c.z)));
  if (nextCells.length === state.cells.length) return state;
  const opened = new Map<string, [number, number]>();
  for (const [x, y] of cells) opened.set(`${x},${y}`, [x, y]);
  const modules = state.modules.map((m) => {
    if (m.id !== id || m.type !== 'shop') return m;
    const have = new Set((m.cfg.door ?? []).map(([x, y]) => `${x},${y}`));
    const door = [...(m.cfg.door ?? [])];
    for (const [k, pair] of opened) {
      if (have.has(k)) continue;
      have.add(k);
      door.push(pair);
    }
    return { ...m, cfg: { ...m.cfg, door } };
  });
  const result = { ...state, cells: nextCells, modules };
  // A room with no wall left is not a room: drop it — and the auto furniture it
  // stocked, while hand-placed 货架/办公桌 stay as furniture on the remaining floor.
  const updated = modules.find((m) => m.id === id);
  if (updated && updated.type === 'shop' && facilityWallCells(nextCells, updated).length === 0) {
    const dropped = { ...result, modules: result.modules.filter((m) => m.id !== id) };
    return dropAutoFurniture(dropped, facilityRectOf(updated));
  }
  return result;
}

/**
 * Remove a set of facility rooms and the auto walls only they need. A wall cell
 * a surviving walled room still needs is kept, and floors are never touched.
 * A removed room's auto-generated furniture goes with it; hand-placed 货架/办公桌 stay —
 * except on the extend path, where `placeFacility` re-stocks the union fresh
 * (absorbed rooms' units are dropped first, so a merge never stacks two units
 * on one cell).
 */
function removeFacilitySet(state: StationState, ids: ReadonlySet<string>): StationState {
  const kill = new Set<string>();
  const rooms: Array<{ x: number; y: number; z: number; w: number; h: number }> = [];
  for (const m of state.modules) {
    if (!ids.has(m.id) || (m.type !== 'shop' && m.type !== 'booth')) continue;
    if (m.type === 'shop') {
      for (const [x, y, z] of facilityWallCells(state.cells, m)) kill.add(cellKey(x, y, z));
    }
    rooms.push({ x: m.x, y: m.y, z: m.z, w: m.w, h: m.h });
  }
  // Never remove a wall cell a surviving walled room still needs.
  const keep = new Set<string>();
  for (const m of state.modules) {
    if (ids.has(m.id) || m.type !== 'shop') continue;
    for (const [x, y, z] of facilityWallCells(state.cells, m)) keep.add(cellKey(x, y, z));
  }
  const cells = state.cells.filter((c) => {
    const k = cellKey(c.x, c.y, c.z);
    return !(kill.has(k) && !keep.has(k));
  });
  let next: StationState = { ...state, cells, modules: state.modules.filter((m) => !ids.has(m.id)) };
  for (const r of rooms) {
    next = dropAutoFurniture(next, { x0: r.x, y0: r.y, x1: r.x + r.w - 1, y1: r.y + r.h - 1, z: r.z });
  }
  return next;
}

/**
 * Bulldoze a walled room, booth or retail shell. A walled room's auto walls —
 * the solid cells stacked above its own perimeter — are removed too, but never
 * a wall another room still needs, and never the floor. A removed room's
 * auto-generated furniture goes with it while hand-placed pieces stay behind
 * on the floor.
 */
export function removeFacility(state: StationState, id: string): StationState {
  const mod = state.modules.find((m) => m.id === id);
  if (!mod || (mod.type !== 'shop' && mod.type !== 'booth' && mod.type !== 'retail')) return state;
  if (mod.type === 'shop') return removeFacilitySet(state, new Set([id]));
  const dropped: StationState = { ...state, modules: state.modules.filter((m) => m.id !== id) };
  return dropAutoFurniture(dropped, facilityRectOf(mod));
}
