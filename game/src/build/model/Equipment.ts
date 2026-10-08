// Build model: equipment modules — placement payloads, posters, add/remove (§5).
// Sign-board repair lives here too: a 指示牌 is equipment with a document.

import { benchSpec } from '../../sim/benches.ts';
import { BILLBOARD_SPECS, billboardSpec, postersFor } from '../../sim/billboards.ts';
import {
  CALLIGRAPHY_FALLBACK_NAME,
  DEFAULT_CALLIGRAPHY_AXIS,
  DEFAULT_CALLIGRAPHY_STYLE,
  calligraphyGeometry,
  isCalligraphyAxis,
  isCalligraphyStyle,
} from '../../sim/calligraphy.ts';
import { escalatorModule, type EscalatorDir } from '../../sim/escalators.ts';
import { exitFloorAt, exitFootprintCells } from '../../sim/exits.ts';
import { DEFAULT_GLASS_VARIANT, glassSpec } from '../../sim/glassPanels.ts';
import { DEFAULT_DOOR_VARIANT, doorSpec } from '../../sim/doors.ts';
import { DEFAULT_LINE_MAP_VARIANT, lineMapSpec } from '../../sim/linemaps.ts';
import { liftModule, liftFootprintCells } from '../../sim/lifts.ts';
import { carveRampOpenings } from '../../sim/openings.ts'
import { rotateLocal } from '../../sim/track.ts'
import {
  benchCells,
  billboardCells,
  calligraphyCells,
  doorCells,
  glassCells,
  lineMapCells,
  moduleFootprint,
} from '../../sim/placement.ts';
import { trackCells, trackOriginForCentre, edgeCells } from '../../sim/track.ts';
import { TRUSS_ROOF_BAY, supportedRoofWidth } from '../../sim/structures.ts';
import { STAIR_WIDTH_NARROW, stairBuildWidth, stairFlightsFor, stairLandings, stairTurnCells } from '../../sim/stairs.ts';
import { makeSignBoards, settleSignBoards, signBoardsOf, signMountSpec, DEFAULT_SIGN_MOUNT, type SignBoardsDraft, type SignLineSource, type SignMount } from '../../sim/sign.ts';
import type { BenchVariant, BillboardVariant, CalligraphyAxis, CalligraphyStyle, DoorVariant, ExitBays, GateDoor, GlassVariant, LineMapVariant, Module, StairStyle, StationData, Vec3i } from '../../sim/types.ts';
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
}

/**
 * The station name a fresh 站名 is cut for. The placement caller hands over the
 * whole station document (the same `StationData` a 指示牌 reads its lines from), so
 * the inscription is sized from the name it will print; a caller with only a line
 * array (a unit test, a thumbnail) gets the neutral fallback, and the piece is then
 * cut for that name's own length.
 */
function stationNameOf(source: SignLineInput): string {
  return Array.isArray(source) ? CALLIGRAPHY_FALLBACK_NAME : ((source as StationData).name || CALLIGRAPHY_FALLBACK_NAME);
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
    case 'pillar':
    case 'pillar-slim':
    case 'pillar-thick':
      return { id, type: 'pillar', x, y, z, rot, cfg: { size: type === 'pillar-thick' ? 'thick' : 'slim', height: 4 } };
    case 'roof':
      return { id, type: 'roof', x, y, z, rot, w: 1, d: 1, cfg: {} };
    case 'roof-truss':
      return { id, type: 'roof', x, y, z, rot, w: TRUSS_ROOF_BAY, d: supportedRoofWidth(width), cfg: { variant: 'truss' } };
    case 'roof-tapered':
      return { id, type: 'roof', x, y, z, rot, w: TRUSS_ROOF_BAY, d: supportedRoofWidth(width), cfg: { variant: 'tapered-truss' } };
    case 'bridge':
      return { id, type: 'track', x, y, z, rot, w: 12, d: 3, cfg: { line: '1', power: 'third-rail', bridge: true } };
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
    case 'glass':
    case 'glass-1x1':
    case 'glass-2x1':
    case 'glass-3x1':
    case 'glass-1x2':
    case 'glass-2x2':
    case 'glass-3x2': {
      // The palette id names the size; a bare `glass` (an old caller) is the
      // single-cell 1 m panel. The run is centred on the hovered cell like a
      // billboard's, so a three-cell window grows evenly either side of the pointer.
      const variant: GlassVariant = type === 'glass' ? DEFAULT_GLASS_VARIANT : (type.slice('glass-'.length) as GlassVariant);
      const spec = glassSpec(variant);
      const [ox, oy] = trackOriginForCentre(rot, x, y, spec.w, 1);
      return { id, type: 'glass', x: ox, y: oy, z, rot, w: spec.w, cfg: { variant: spec.variant } };
    }
    case 'door':
    case 'door-steel-1':
    case 'door-steel-2':
    case 'door-wood-1':
    case 'door-wood-2': {
      // The palette id names the variant; a bare `door` (an old caller, or the
      // room builder's own doorway) is the single stainless piece. The run is
      // centred on the hovered cell like a 玻璃板's, so a 双开 door grows evenly
      // either side of the pointer rather than off to one hand.
      const variant: DoorVariant = type === 'door' ? DEFAULT_DOOR_VARIANT : (type.slice('door-'.length) as DoorVariant);
      const spec = doorSpec(variant);
      const [ox, oy] = trackOriginForCentre(rot, x, y, spec.w, 1);
      return { id, type: 'door', x: ox, y: oy, z, rot, w: spec.w, cfg: { variant: spec.variant } };
    }
    case 'calligraphy':
    case 'calligraphy-kai-h':
    case 'calligraphy-kai-v':
    case 'calligraphy-xing-h':
    case 'calligraphy-xing-v':
    case 'calligraphy-li-h':
    case 'calligraphy-li-v':
    case 'calligraphy-wei-h':
    case 'calligraphy-wei-v':
    case 'calligraphy-hei-h':
    case 'calligraphy-hei-v':
    case 'calligraphy-song-h':
    case 'calligraphy-song-v': {
      // The palette id names the hand and the axis (`calligraphy-<style>-<axis>`);
      // a bare `calligraphy` is 楷书 横排. The panel is cut **now**, from the name
      // the station carries at this moment: it is the piece's own wall footprint
      // (`w` cells, `panelH` metres), and it stays that size for good — a later
      // rename reprints the ink inside it rather than rebuilding a different wall
      // behind a placed piece (`sim/calligraphy.ts`).
      const parts = type.split('-');
      const style = (isCalligraphyStyle(parts[1]) ? parts[1] : DEFAULT_CALLIGRAPHY_STYLE) as CalligraphyStyle;
      const axis = (isCalligraphyAxis(parts[2]) ? parts[2] : DEFAULT_CALLIGRAPHY_AXIS) as CalligraphyAxis;
      const geo = calligraphyGeometry(stationNameOf(lines), axis);
      const [ox, oy] = trackOriginForCentre(rot, x, y, geo.cells, 1);
      return { id, type: 'calligraphy', x: ox, y: oy, z, rot, w: geo.cells, panelH: geo.panelH, cfg: { style, axis } };
    }
    case 'linemap':
    case 'linemap-wall':
    case 'linemap-stand': {
      // The palette id names the mount; a bare `linemap` (an old caller) is the wall
      // board. The wall board is centred on the hovered cell like a billboard; the
      // totem is a single cell, so its own cell is its anchor.
      const mount: LineMapVariant = type === 'linemap-stand' ? 'stand' : DEFAULT_LINE_MAP_VARIANT;
      const spec = lineMapSpec(mount);
      const [ox, oy] = trackOriginForCentre(rot, x, y, spec.w, 1);
      return { id, type: 'linemap', x: ox, y: oy, z, rot, w: spec.w, cfg: { mount: spec.variant } };
    }
    case 'sign':
    case 'sign-ceiling':
    case 'sign-wall': {
      // A board is born with a composed **front** (§5.8), not a blank face: the
      // station's first line is already on it, so a fresh sign is readable before
      // the player has opened its editor. The current pair, when there is one, is
      // what the piece actually hangs — copied, because the next sign must be free
      // to be composed differently without reprinting this one. The **back** is
      // empty unless the player has composed one: a sign is one-sided until it is
      // said otherwise — and a **wall** sign has no back at all, because the wall is
      // behind it (`signMountSpec(...).doubleSided`), so only 正面 is carried.
      const mount: SignMount = type === 'sign-wall' ? 'wall' : DEFAULT_SIGN_MOUNT
      const boards = sign ? settleSignBoards(sign, linesOf(lines)) : makeSignBoards(undefined, linesOf(lines))
      return {
        id,
        type: 'sign',
        x,
        y,
        z,
        rot,
        cfg: {
          mount,
          front: boards.front.map((c) => ({ ...c })),
          back: signMountSpec(mount).doubleSided ? boards.back.map((c) => ({ ...c })) : [],
        },
      }
    }
    case 'exit':
    case 'exit-covered-1':
    case 'exit-covered-2':
    case 'exit-covered-3':
    case 'exit-uncovered-1':
    case 'exit-uncovered-2':
    case 'exit-doorway-1':
    case 'exit-doorway-2':
    case 'exit-doorway-3':
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
      return { id, type: 'exit', x, y, z, rot, cfg: { name: '未命名口', inRate: 900, open: true, covered, bays, ...(parts[1] === 'doorway' ? { style: 'doorway' as const } : {}) } };
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
    case 'stair-block': {
      const [dx, dy] = rotateLocal(rot, 1, 0);
      const blockHeight = width === 0.5 ? 0.5 : 1;
      return { id, type: 'stair', x, y, z, rot,
        from: { x: x - dx, y: y - dy, z }, to: { x: x + dx, y: y + dy, z: z + 1 },
        cfg: { width: 1, block: true, blockHeight } };
    }
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
      // The **size** lays the flights (a switchback's two runs stand `stairLanes` cells
      // apart); the piece is then built at the width that size means — a 双跑楼梯's runs
      // are block-wide, so its two flush runs fill whole blocks (`stairBuildWidth`).
      const size = width ?? STAIR_WIDTH_NARROW;
      const flights = stairFlightsFor({ x, y, z }, rot, style, size);
      return {
        id,
        type: 'stair',
        x,
        y,
        z,
        rot,
        from: flights[0].from,
        to: flights[flights.length - 1].to,
        cfg: { width: stairBuildWidth(style, size), style, flights },
      };
    }
    default:
      return null;
  }
}

/**
 * The plan a catalogue piece occupies: every floor cell it stands on, at the
 * origin, read from the builders that place it — so a 单跑楼梯 is its seven cells of
 * run and an 电梯 its 2 × 2 shaft, and neither a palette row's `w`/`h` nor a
 * hand-kept table can drift from the geometry. A caller takes the bounding box of
 * these cells when it wants the footprint a card prints; the list is returned
 * rather than the box because a caller may equally want to draw them.
 *
 * Reading the cells takes more than `moduleFootprint`, which is the **collision**
 * rule and answers with each piece's anchor points: a 双跑楼梯's two landings are two
 * cells a run apart, though the pair of flights stands four cells wide, and an
 * 出入口's cells fall to `exitFloorAt` there so its own floor pad stays free for the
 * ramp that descends through it. So the rooms, the panel runs and the ramps are
 * read through the same rules the tool draws them with (`stairFlightsFor`: every
 * landing, not just the first and the last), and only the fixed 1 × 1 pieces fall
 * back to `moduleFootprint`.
 *
 * `variant` is the piece's size where one exists — a bench's run in metres, a
 * 广告牌's cells, a 扶梯's step band — and is ignored by every fixed piece, exactly
 * as in `createModule`.
 */
export function footprintCellsOf(type: string, variant?: number): Array<[number, number]> {
  const anchor = { x: 0, y: 0, z: 0 };
  const id = 'footprint';
  const mod =
    type === 'escalator' ? escalatorModule(anchor, 0, 'up', id)
    : type === 'lift' ? liftModule(anchor, 0, id)
    : createModule(type, 0, 0, 0, id, 0, variant);
  if (!mod) return [[0, 0]];
  switch (mod.type) {
    case 'retail':
    case 'shop':
    case 'booth': {
      const out: Array<[number, number]> = [];
      for (let x = 0; x < mod.w; x++) for (let y = 0; y < mod.h; y++) out.push([x, y]);
      return out;
    }
    case 'roof':
    case 'track':
      return trackCells(mod).map(([x, y]) => [x, y] as [number, number]);
    case 'platform-edge':
      return edgeCells(mod).map(([x, y]) => [x, y] as [number, number]);
    case 'exit':
      return exitFootprintCells(mod).map(([x, y]) => [x, y] as [number, number]);
    case 'stair':
    case 'escalator': {
      if (mod.type === 'stair' && mod.cfg.block) return [[0, 0]];
      // Every landing of the run: a switchback's two flights stand a run apart, and
      // the ground the pair covers is the pair, not the cells it starts and stops on.
      const seen = new Set<string>();
      const out: Array<[number, number]> = [];
      for (const f of [mod.from, mod.to, ...(mod.type === 'stair' ? (mod.cfg.flights ?? []).flatMap((f) => [f.from, f.to]) : [])]) {
        const key = `${f.x},${f.y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push([f.x, f.y]);
      }
      return out;
    }
    case 'lift':
      return liftFootprintCells(mod);
    case 'bench':
      return benchCells(mod).map(([x, y]) => [x, y] as [number, number]);
    case 'billboard':
      return billboardCells(mod).map(([x, y]) => [x, y] as [number, number]);
    case 'glass':
      return glassCells(mod).map(([x, y]) => [x, y] as [number, number]);
    case 'door':
      return doorCells(mod).map(([x, y]) => [x, y] as [number, number]);
    case 'calligraphy':
      return calligraphyCells(mod).map(([x, y]) => [x, y] as [number, number]);
    case 'linemap':
      return lineMapCells(mod).map(([x, y]) => [x, y] as [number, number]);
    default:
      return moduleFootprint(mod);
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
    // old single board back on the front. The **mount** is the piece's own and travels
    // exactly as written — including absent, which is the hanging board a sign saved
    // before the wall variant existed is, and a sign this repair never has to touch.
    const cfg: Extract<Module, { type: 'sign' }>['cfg'] = { front: boards.front, back: boards.back };
    if (mod.cfg.mount !== undefined) cfg.mount = mod.cfg.mount;
    return { ...mod, cfg };
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
  if (!isRamp || (mod.type === 'stair' && mod.cfg.block)) return { ...state, modules };
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

/**
 * The floor a stair lays for **its own turn landing** (`stairTurnCells`): the walkable node
 * between its two flights, which the block mesher skips while the model draws the platform
 * there. A straight stair lays none.
 */
function stairLandingCells(mod: Module): Vec3i[] {
  return mod.type === 'stair' ? stairTurnCells(mod) : [];
}

/**
 * The cells a set of modules needs as their own floor: **every cell of each piece's
 * footprint** (`moduleFootprint` — a 2 m bench's two cells, a 双开 门's pair, a rail's bed,
 * a room's whole plan), plus every stair's turn landing.
 *
 * The footprint, not the anchor: a landing cell is floor like any other, and a piece that
 * merely *starts* somewhere else still stands on the cells it spans. Protecting anchors
 * alone left the floor under a bench's far half to be bulldozed away with the stair, so
 * the bench stood over void.
 */
function cellsInUse(modules: readonly Module[]): Set<string> {
  const held = new Set<string>();
  for (const m of modules) {
    for (const [x, y] of moduleFootprint(m)) held.add(cellKey(x, y, m.z));
    for (const p of stairLandingCells(m)) held.add(cellKey(p.x, p.y, p.z));
  }
  return held;
}

/**
 * Bulldoze one module, leaving the block it stood on — **except** the floor a 楼梯 laid for
 * its own turn landing. That cell is the stair's platform: the mesher skips it and the model
 * draws the slab there, so left behind on its own it is a stray block in the middle of the
 * station with no stair to turn on. A straight stair lays none, so nothing changes for it; a
 * cell another piece still stands on, or another stair still turns on, is kept.
 */
export function removeModule(state: StationState, id: string): StationState {
  const gone = state.modules.find((m) => m.id === id);
  const modules = state.modules.filter((m) => m.id !== id);
  if (modules.length === state.modules.length) return state;
  if (!gone) return { ...state, modules };
  const keep = cellsInUse(modules);
  const kill = new Set(
    stairLandingCells(gone)
      .map((p) => cellKey(p.x, p.y, p.z))
      .filter((k) => !keep.has(k)),
  );
  if (kill.size === 0) return { ...state, modules };
  const cells = state.cells.filter((c) => !kill.has(cellKey(c.x, c.y, c.z)));
  return { ...state, cells, modules };
}

/**
 * Put a **moved** piece back into the station: the copy replaces the piece that
 * shares its id where it already sits, so the module list keeps its order and
 * nothing else is rebuilt. The piece never left the document — while it is in the
 * air 移动 only stops *drawing* it — so a move is one replacement, and a
 * single `Ctrl+Z` puts the piece back where it came from.
 *
 * A 楼梯 is not moved this way (`isMovableModule`: its derived turn-landing floor would
 * be stranded by a translation), so a stair leaves and returns through `removeModule`
 * and `addEquipment`, which take its landing floor out and lay it again. An exit's
 * floor pad is derived from the module's live footprint, so replacing it moves the pad.
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
