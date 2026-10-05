// Build model: equipment modules — placement payloads, posters, add/remove (§5).
// Sign-board repair lives here too: a 指示牌 is equipment with a document.

import { benchSpec } from '../../sim/benches.ts';
import { BILLBOARD_SPECS, billboardSpec, postersFor } from '../../sim/billboards.ts';
import { escalatorModule, type EscalatorDir } from '../../sim/escalators.ts';
import { exitFloorAt } from '../../sim/exits.ts';
import { liftModule } from '../../sim/lifts.ts';
import { carveRampOpenings } from '../../sim/openings.ts';
import { trackOriginForCentre } from '../../sim/track.ts';
import { STAIR_WIDTH_NARROW, stairFlightsFor, stairLandings, stairTurnCells } from '../../sim/stairs.ts';
import { makeSignBoards, settleSignBoards, signBoardsOf, type SignBoardsDraft, type SignLineSource } from '../../sim/sign.ts';
import type { BenchVariant, BillboardVariant, ExitBays, GateDoor, Module, StairStyle, StationData, Vec3i } from '../../sim/types.ts';
import { cellKey, cloneCell } from './Cells.ts';
import type { StationState } from './State.ts';

/**
 * A placed escalator is a fixed one-storey piece, the same footprint as a
 * straight stair: it rises `ESCALATOR_RUN` cells along the placement rotation.
 * `dir` chooses whether it carries people up (from the base to the top) or down
 * (from the top to the base) — the run itself always climbs from the cell it is
 * dropped on. The piece itself lives in `sim/escalators.ts`, so the builder and
 * the reference station place the exact same equipment.
 */
export { ESCALATOR_RISE, ESCALATOR_RUN, nextEscalatorDir } from '../../sim/escalators.ts';

/**
 * Where a 指示牌's composed layout reads its lines from: the station document
 * itself, or just its `lines` array. The placement tool holds the whole document
 * and the model tests hold an array, and neither should have to wrap the other.
 */
export type SignLineInput = StationData | ReadonlyArray<StationData['lines'][number]>;

function linesOf(source: SignLineInput): SignLineSource {
  return Array.isArray(source) ? { lines: source } : (source as StationData);
}/**
 * Build a fresh module payload for one cell. Shared by the placement tool and
 * the on-hover ghost, so the preview is the exact module the click would add.
 * `width` is the stair width — omitted, a stair is the narrow piece, exactly the
 * escalator's step band — `dir` the escalator direction and `door` the 闸机 piece
 * (a working lane or the fence machine, toggled with Tab); other types ignore
 * them. Returns null for a type the placement UI cannot create yet.
 *
 * A stair or escalator is a fixed-length piece: its base is the cell, and it
 * climbs one storey `STAIR_RUN` cells along the placement rotation.
 *
 * `lines` and `sign` are only read by a 指示牌. A fresh board is composed from the
 * station's own lines (`defaultSignLayout`) so the ghost a player hovers already
 * carries their 1号线的 colour and number instead of a placeholder; `sign` is the
 * **current** pair of boards (`store.currentBoards`), and a placed sign carries a
 * copy of it, so the player composes once and hangs as many signs as they like. A
 * 指示牌 placed without a `sign` still gets a readable default front — and, as ever,
 * an empty back.
 */
export function createModule(
  type: string,
  x: number,
  y: number,
  z: number,
  id: string,
  rot = 0,
  width?: number,
  dir: EscalatorDir = 'up',
  door: GateDoor = 'lane',
  lines: SignLineInput = [],
  sign?: SignBoardsDraft,
): Module | null {
  switch (type) {
    case 'gate':
      return { id, type: 'gate', x, y, z, rot, cfg: { dir: 'both', door } };
    case 'fence':
      return { id, type: 'fence', x, y, z, rot, cfg: {} };
    case 'tvm':
      return { id, type: 'tvm', x, y, z, rot, cfg: {} };
    case 'vending':
      return { id, type: 'vending', x, y, z, rot, cfg: {} };
    case 'bench':
    case 'bench-steel-1':
    case 'bench-steel-2':
    case 'bench-seat-1':
    case 'bench-seat-2': {
      // The palette id names the variant; a bare `bench` (an old caller, or the
      // room builder's staff seat) is the 1 m stainless piece. A two-cell run is
      // centred on the hovered cell like a track piece, so it grows evenly.
      const variant: BenchVariant = type === 'bench' ? 'steel-1' : (type.slice('bench-'.length) as BenchVariant);
      const spec = benchSpec(variant);
      const [ox, oy] = trackOriginForCentre(rot, x, y, spec.w, 1);
      return { id, type: 'bench', x: ox, y: oy, z, rot, w: spec.w, cfg: { variant: spec.variant } };
    }
    case 'shelf':
      return { id, type: 'shelf', x, y, z, rot, cfg: {} };
    case 'desk':
      return { id, type: 'desk', x, y, z, rot, cfg: {} };
    case 'cubicle':
      return { id, type: 'cubicle', x, y, z, rot, cfg: {} };
    case 'sink':
      return { id, type: 'sink', x, y, z, rot, cfg: {} };
    case 'bin':
      // A litter bin (垃圾桶) and a fire-extinguisher cabinet (灭火器) are single
      // free-standing decorations: no variant, no `cfg`, turned by the hover
      // rotation like a shelf.
      return { id, type: 'bin', x, y, z, rot, cfg: {} };
    case 'extinguisher':
      return { id, type: 'extinguisher', x, y, z, rot, cfg: {} };
    case 'clock':
      // A station clock (时钟) and a ceiling camera (监控): no variant, no `cfg` —
      // the clock is round, so its rotation is purely cosmetic, and the camera's
      // rotation is the direction it watches. Unlike the bin and the cabinet these
      // two hang from the ceiling rather than standing on the floor
      // (`ceilingMountMissing`, `sim/placement.ts`).
      return { id, type: 'clock', x, y, z, rot, cfg: {} };
    case 'cctv':
      return { id, type: 'cctv', x, y, z, rot, cfg: {} };
    case 'billboard':
    case 'billboard-wide':
    case 'billboard-standard':
    case 'billboard-large':
    case 'billboard-panorama':
    case 'billboard-portrait':
    case 'billboard-square': {
      // The palette id names the variant; a bare `billboard` (an old caller)
      // falls back to the small landscape. The run is centred on the hovered
      // cell like a track piece, so a two-cell banner grows evenly either side.
      // No poster yet: `randomAdSlug` rolls one when the piece is committed, so
      // the hover ghost does not re-roll its artwork on every pointer move.
      const variant: BillboardVariant = type === 'billboard' ? 'wide' : (type.slice('billboard-'.length) as BillboardVariant);
      const spec = BILLBOARD_SPECS[variant] ?? BILLBOARD_SPECS.wide;
      const [ox, oy] = trackOriginForCentre(rot, x, y, spec.w, 1);
      return { id, type: 'billboard', x: ox, y: oy, z, rot, w: spec.w, cfg: { variant: spec.variant } };
    }
    case 'tv':
      return { id, type: 'tv', x, y, z, rot, cfg: {} };
    case 'sign': {
      // A board is born with a composed **front** (§5.8), not a blank face: the
      // station's first line is already on it, so a fresh sign is readable before
      // the player has opened its editor. The current pair, when there is one, is
      // what the piece actually hangs — copied, because the next sign must be free
      // to be composed differently without reprinting this one. The **back** is
      // empty unless the player has composed one: a sign is one-sided until it is
      // said otherwise.
      const boards = sign ? settleSignBoards(sign, linesOf(lines)) : makeSignBoards(undefined, linesOf(lines));
      return { id, type: 'sign', x, y, z, rot, cfg: { front: boards.front.map((c) => ({ ...c })), back: boards.back.map((c) => ({ ...c })) } };
    }
    case 'exit':
    case 'exit-covered-1':
    case 'exit-covered-2':
    case 'exit-covered-3':
    case 'exit-uncovered-1':
    case 'exit-uncovered-2':
    case 'exit-uncovered-3': {
      // The palette id names the variant: `exit` (or -covered-) is the 有盖
      // head-house and -uncovered- is the open 无盖 railing exit; the trailing
      // digit is the bay count (单向 / 双向 / 三向). A bare `exit` (an old caller
      // or save) is the reference covered two-bay piece.
      const parts = type.split('-');
      const covered = parts[1] !== 'uncovered';
      const n = Number(parts[2]);
      const bays: ExitBays = n === 1 || n === 3 ? n : 2;
      // The placeholder name is the fallback: the placement caller swaps in the
      // next free A ~ Z letter (`nextExitName`), so a fresh exit reads like real
      // signage. A save with no name, or all 26 letters used, keeps it.
      return { id, type: 'exit', x, y, z, rot, cfg: { name: '未命名口', inRate: 900, open: true, covered, bays } };
    }
    case 'escalator':
      // The one shared piece: the run always climbs from the dropped cell;
      // `dir` only orders from/to, which is what the sim reads as the one-way
      // travel and the label.
      return escalatorModule({ x, y, z }, rot, dir, id);
    case 'lift':
      // An elevator: one storey up from the dropped cell. The player grows the
      // shaft a storey at a time (`extendLift`), so a fresh piece is always two
      // stops.
      return liftModule({ x, y, z }, rot, id);
    case 'stair': {
      const style = 'straight' as StairStyle;
      const flights = stairFlightsFor({ x, y, z }, rot, style, width ?? STAIR_WIDTH_NARROW);
      return {
        id,
        type: 'stair',
        x,
        y,
        z,
        rot,
        from: flights[0].from,
        to: flights[flights.length - 1].to,
        cfg: { width: width ?? STAIR_WIDTH_NARROW, style, flights },
      };
    }
    case 'stair-straight':
    case 'stair-right90':
    case 'stair-left90':
    case 'stair-right180':
    case 'stair-left180': {
      const style = type.slice('stair-'.length) as StairStyle;
      const flights = stairFlightsFor({ x, y, z }, rot, style, width ?? STAIR_WIDTH_NARROW);
      return {
        id,
        type: 'stair',
        x,
        y,
        z,
        rot,
        from: flights[0].from,
        to: flights[flights.length - 1].to,
        cfg: { width: width ?? STAIR_WIDTH_NARROW, style, flights },
      };
    }
    default:
      return null;
  }
}

/**
 * Roll the poster a freshly placed ad screen prints. Deterministic in the module
 * id — `nextModuleId` never reuses one — so the same click in the same station
 * always hangs the same campaign, and an undo/redo pair does not reshuffle the
 * wall. The candidates are filtered to the panel's silhouette, so a landscape
 * panel is never asked to print a portrait poster.
 */
export function randomAdSlug(mod: Module): string {
  const shape = mod.type === 'billboard' ? billboardSpec(mod.cfg.variant).shape : 'landscape';
  const choices = postersFor(shape);
  let hash = 2166136261;
  for (let i = 0; i < mod.id.length; i++) {
    hash ^= mod.id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return choices[(hash >>> 0) % choices.length].slug;
}

/** True for an ad screen (广告牌 / 电视) that has no poster yet. */
function needsPoster(mod: Module): boolean {
  return (mod.type === 'billboard' || mod.type === 'tv') && mod.cfg.poster === undefined;
}

/**
 * Give every ad screen without one its placed poster: 广告牌 and 电视 print one
 * real campaign each, rolled when the piece is committed and then frozen. A
 * legacy save (or the demo) predates `cfg.poster` and is filled in here rather
 * than at draw time, so the poster is part of the document — it survives a save,
 * a reload and every later frame unchanged.
 *
 * The billboard and TV arms are written out separately because each has its own
 * `cfg` shape; a shared spread would have to describe both at once.
 */
export function assignAdPosters(modules: readonly Module[]): Module[] {
  let changed = false;
  const out = modules.map((mod): Module => {
    if (!needsPoster(mod)) return mod;
    changed = true;
    const poster = randomAdSlug(mod);
    if (mod.type === 'billboard') return { ...mod, cfg: { ...mod.cfg, poster } };
    if (mod.type === 'tv') return { ...mod, cfg: { ...mod.cfg, poster } };
    return mod;
  });
  return changed ? out : [...modules];
}

/**
 * Every 指示牌's two boards, repaired on the way in (§5.8).
 *
 * A sign saved before the board was a document carries no components at all; one
 * saved by an older build of the editor may carry a scale or a centre the panel can
 * no longer hold; and one saved before a sign had a **back** carries its two faces
 * folded into one list with a `side` on each mark. All three are fixed here, once,
 * rather than at draw time — the same reason `assignAdPosters` rolls a poster on
 * load instead of per frame. A sign that already has a usable pair is returned
 * untouched, so this is not a per-frame rewrite of the document.
 *
 * A component that names a line the station no longer has is **left alone**: the
 * shield prints the neutral plate until that line comes back, which is better
 * than silently rebinding a sign to another line.
 */
export function ensureSignLayouts(modules: readonly Module[], lines: SignLineSource): Module[] {
  let changed = false;
  const out = modules.map((mod): Module => {
    if (mod.type !== 'sign') return mod;
    const boards = signBoardsOf(mod.cfg, lines);
    const same =
      mod.cfg.components === undefined &&
      mod.cfg.front !== undefined &&
      mod.cfg.back !== undefined &&
      mod.cfg.front.length === boards.front.length &&
      mod.cfg.back.length === boards.back.length &&
      mod.cfg.front.every((c, i) => c === boards.front[i]) &&
      mod.cfg.back.every((c, i) => c === boards.back[i]);
    if (same) return mod;
    changed = true;
    // The legacy `components` list is dropped, not carried along: the pair now says
    // everything it said, and leaving it in place would let a later write put the
    // old single board back on the front.
    return { ...mod, cfg: { front: boards.front, back: boards.back } };
  });
  return changed ? out : [...modules];
}

/**
 * Append an equipment module. A stair also lays its own half/quarter landings as
 * floor cells, so a turning flight has a walkable node between its two flights
 * (the model draws the platform and the block mesher skips it). A ramp landing
 * on an exit's floor materialises that cell too: the exit covers it even where
 * a carve left a hole, so the graph keeps the ramp's edge nodes. A ramp
 * (escalator, stair, lift) then carves the slab it climbs through; flat
 * equipment is a plain append.
 *
 * The append is also where a 装饰 screen's poster is rolled (`assignAdPosters`),
 * so one click hangs one campaign for good.
 */
export function addEquipment(state: StationState, mod: Module): StationState {
  const modules = assignAdPosters([...state.modules, mod]);
  const isRamp = mod.type === 'escalator' || mod.type === 'stair' || mod.type === 'lift';
  if (!isRamp) return { ...state, modules };
  const cells = state.cells.map(cloneCell);
  const have = new Set(cells.filter((c) => c.fill === 'solid').map((c) => cellKey(c.x, c.y, c.z)));
  const lay = (p: Vec3i): void => {
    const k = cellKey(p.x, p.y, p.z);
    if (have.has(k)) return;
    have.add(k);
    cells.push({ x: p.x, y: p.y, z: p.z, fill: 'solid' });
  };
  if (mod.type === 'stair') {
    for (const p of stairTurnCells(mod)) lay(p);
  }
  // Landings on exit floor count even as holes: lay the cell so the graph can
  // stand on it. Laid before the carve, which protects landing cells.
  const landings: Vec3i[] =
    mod.type === 'stair' ? stairLandings(mod) : mod.type === 'escalator' || mod.type === 'lift' ? [mod.from, mod.to] : [];
  for (const p of landings) {
    if (!have.has(cellKey(p.x, p.y, p.z)) && exitFloorAt(modules, p.x, p.y, p.z)) lay(p);
  }
  carveRampOpenings(cells, modules);
  return { ...state, cells, modules };
}

/** Bulldoze one module, leaving the block it stood on. */
export function removeModule(state: StationState, id: string): StationState {
  const modules = state.modules.filter((m) => m.id !== id);
  return modules.length === state.modules.length ? state : { ...state, modules };
}

/**
 * Put a **moved** piece back into the station: the copy replaces the piece that
 * shares its id where it already sits, so the module list keeps its order and
 * nothing else is rebuilt. The piece never left the document — while it is in the
 * air 移动 only stops *drawing* it — so a move is one replacement, and a
 * single `Ctrl+Z` puts the piece back where it came from.
 */
export function replaceEquipment(state: StationState, moved: Module): StationState {
  if (!state.modules.some((m) => m.id === moved.id)) return state;
  return { ...state, modules: state.modules.map((m) => (m.id === moved.id ? moved : m)) };
}

/** A free `${type}-n` id, so bulldozing then placing again never reuses one. */
export function nextModuleId(modules: readonly Module[], type: string): string {
  const taken = new Set(modules.map((m) => m.id));
  let n = modules.length + 1;
  while (taken.has(`${type}-${n}`)) n++;
  return `${type}-${n}`;
}

/**
 * The default name for a freshly placed exit: the first free letter A ~ Z, as
 * `A口` / `B口` / … (GAME-SPEC.md §5.6). Real signage letters its exits rather
 * than leaving every one 未命名口, and a deleted exit frees its letter for reuse.
 * A rename to anything not starting A ~ Z simply keeps that name; once all 26
 * letters are taken the placeholder comes back.
 */
export function nextExitName(modules: readonly Module[]): string {
  const used = new Set<string>();
  for (const m of modules) {
    if (m.type !== 'exit') continue;
    const letter = m.cfg.name.trim().charAt(0).toUpperCase();
    if (letter >= 'A' && letter <= 'Z') used.add(letter);
  }
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i);
    if (!used.has(letter)) return `${letter}口`;
  }
  return '未命名口';
}

/**
 * The rotation for a dragged fence (围栏) run: the panel follows the drag
 * direction like the 墙 tool (§5.2) — an east–west drag lays panels along +x
 * (rot 0), a north–south drag along +y (rot 1). Ties go east–west, matching
 * `straightLineCells` in the viewport. A single cell returns `null`, so the
 * caller keeps the R rotation.
 *
 * The span is read from the full extent of the cells, never from the press cell
 * against a sorted end: a run laid toward −x/−y would otherwise be compared with
 * itself and turn crosswise (the zig-zag bug).
 */
export function fenceRotForLine(cells: ReadonlyArray<readonly [number, number, number]>): number | null {
  if (cells.length < 2) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of cells) {
    if (c[0] < minX) minX = c[0];
    if (c[0] > maxX) maxX = c[0];
    if (c[1] < minY) minY = c[1];
    if (c[1] > maxY) maxY = c[1];
  }
  return maxX - minX >= maxY - minY ? 0 : 1;
}
