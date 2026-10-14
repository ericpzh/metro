import { msg } from './i18n.ts'
import type { BlockIndex } from './blockIndex.ts'
// Equipment footprints and collision, GAME-SPEC §5.
//
// Everything the builder drops is a module with a real plan footprint and a
// height. Two modules may not share space: a gate cannot be dropped inside a
// ticket machine, a second TVM cannot sit on the first, and an exit head-house
// keeps its whole enclosure clear. Ramps already had their own collision
// (`rampEnvelope` / `rampBlocked` in `openings.ts`, tuned for the vertical
// corridor); this module folds them into one envelope any equipment can be
// tested against, and adds the flat, floor-standing modules — with one exception:
// a **run** met by a flat piece is measured by the slope it actually draws
// (`rampBodyBoxes`), because a stair's treads stop at the edge of each landing tile
// and any floor a flight passes under keeps its headroom. Those blocks are floor, so
// a 围栏 may guard the head of a well or stand on the slab over a flight; two runs
// still meet on the full reservation, so runs can never be stacked.
//
// Pure data — no three, no DOM.

import { shelfSpec } from './shelves.ts'
import { extinguisherCells, extinguisherSpec } from './extinguishers.ts'
import { CHECKOUT_HEIGHT, DESK_HEIGHT } from './constants.ts'
import { hangerBoxes, hangerCells, hangerPostCells, hangerRoofMissing, hangerSupports } from './hangers.ts'
import { fenceArms, railLandingAt, type FenceNeighbours } from './fences.ts'
import { gateSolidFaces } from './gates.ts'
import { isPsdCornerPair, isPsdEndJoin, psdEndOffset, psdEndSpan, snapPsdEnd } from './psdEnds.ts'
import { floorDecorCells, floorDecorSpec, floorDecorBounds, isFloorSticker } from './floorDecor.ts'
import { VENT_WIDTH, VENT_DEPTH, ventCeilingZ } from './vents.ts'
import { LIGHT_DEPTH, lightCeilingZ, lightOffset, lightSpec } from './lights.ts'
import { pillarSupportsBridge, pillarWidth, pillarOffset, ROOF_THICKNESS, TRUSS_ROOF_BASE, trussRoofTop, BRIDGE_DECK_DEPTH, BRIDGE_MIN_Z, bridgeBarrierTop } from './structures.ts'
import { EXIT_L, exitSpan, exitBays, exitFloorAt, exitWidth } from './exits.ts'
import { calligraphyBottom, calligraphyCourses } from './calligraphy.ts'
import { GLASS_FRAME, glassModuleSpec, glassSpec, glassStandsOnFloor, glassWallCourses } from './glassPanels.ts'
import { doorSpec } from './doors.ts'
import { GROUND_Z, groundHoleAt, virtualSolidAt } from './ground.ts'
import { lineMapSpec, LINE_MAP_FRAME_PAD, lineMapWallCourses } from './linemaps.ts'
import { LIFT_SIZE, liftFootprintCells } from './lifts.ts'
import { billboardSpec } from './billboards.ts'
import { escalatorBasesSolid, rampBodyBoxes, rampEnvelope, rampOpeningAt } from './openings.ts'
import { escalatorLandings } from './escalators.ts'
import { PANEL_MIN_H, mountedSignBoards, signBoardsOf, signBoardsPanel, signMountOf, signMountSpec, signWallCourses } from './sign.ts'
import { BOOTH_SIGN_PANEL_Z, WALL_SIGN_STAND_OFF, boothSupportsSign, snapSignToBooth } from './boothSigns.ts'
import { PSD_FULL_HEIGHT, PSD_HALF_HEIGHT, LEVEL_STEPS, storeyBand } from './constants.ts'
import { edgeCells, normRot, rotateLocal, trackCellAt, trackCells } from './track.ts'
import { monitorCells } from './monitors.ts'
import { RAIL_SIGNAL_HEIGHT, RAIL_SIGNAL_SCALE } from './constants.ts'
import { tvBackToBack, tvFacing } from './tvs.ts'
import { halfWallSide, isWallBlock, type Cell, type GlassVariant, type Module, type Vec3i, type WallSide } from './types.ts'

/** An axis-aligned world-space box, half-open: [x0,x1) × [y0,y1) × [z0,z1). */
export interface ModuleBox {
  x0: number
  y0: number
  z0: number
  x1: number
  y1: number
  z1: number
}

/**
 * How far a 广告牌's housing stands off the wall it is bolted to, either side of the
 * wall's own face, metres. The drawn panel (`models/pieces/BillboardModel.ts`) hangs
 * from `−0.5` (the backing, on the wall's centre line) out to `−0.315` (the lit
 * face), so this is that housing with a little clearance. It makes the poster's
 * collision box a **slab on a wall** rather than a cell: the room in front of it,
 * three courses deep, is not the poster's to reserve.
 */
const PANEL_DEPTH = 0.25

/** Clearance round a 广告牌's poster for its frame and its 广告 bar, metres. */
const FRAME_PAD = 0.14

/** How tall a body of each flat module stands above its cell top, metres. */
const FLAT_HEIGHT: Record<'gate' | 'fence' | 'tvm' | 'vending' | 'bench' | 'desk' | 'checkout' | 'cubicle' | 'sink' | 'bin' | 'clock' | 'cctv' | 'tv' | 'sign' | 'retail' | 'shop' | 'booth' | 'platform-edge' | 'track', number> = {
  gate: 1.3,
  fence: 1.0,
  tvm: 1.9,
  vending: 1.9,
  bench: 1.0,
  desk: DESK_HEIGHT,
  checkout: CHECKOUT_HEIGHT,
  cubicle: 1.8,
  sink: 0.9,
  bin: 0.95,
  tv: 3.0,
  // A ceiling-hung 指示牌 / 电视 / 时钟 / 监控 spans the whole storey, from the floor
  // top to the ceiling one grid step up, so its envelope is the full column (and it
  // is found/blocked like any other equipment). The clock's dial and the camera's
  // head both sit inside that column — the piece is hung, so the air under it is
  // reserved rather than free floor.
  sign: 3.0,
  clock: 3.0,
  cctv: 3.0,
  retail: 3.6,
  shop: 3.6,
  booth: 2.4,
  'platform-edge': PSD_FULL_HEIGHT,
  track: 0.3,
}

/**
 * The axis-aligned world box covering a list of cells from `z0` to `z1`. A
 * quarter-turn keeps a track piece axis-aligned, so the bounding box of its
 * cells is exact rather than an over-estimate.
 */
function cellsAabb(cells: ReadonlyArray<[number, number, number]>, z0: number, z1: number): ModuleBox {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [x, y] of cells) {
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x + 1)
    y1 = Math.max(y1, y + 1)
  }
  return { x0, y0, z0, x1, y1, z1 }
}

/**
 * Every world cell a billboard's run covers: `w` cells along its local +x,
 * quarter-turned by `rot`. Mirrors `edgeCells` for a platform-edge.
 */
export function billboardCells(m: Extract<Module, { type: 'billboard' }>): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []
  for (let i = 0; i < m.w; i++) {
    const [dx, dy] = rotateLocal(m.rot, i, 0)
    out.push([m.x + dx, m.y + dy, m.z])
  }
  return out
}

/**
 * Every world cell a bench's run covers: `w` cells along its local +x,
 * quarter-turned by `rot`. Mirrors `billboardCells` for a platform-edge. A
 * legacy bench with no `w` is the single-cell 1 m piece.
 */
export function benchCells(m: Extract<Module, { type: 'bench' }>): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []
  const w = m.w ?? 1
  for (let i = 0; i < w; i++) {
    const [dx, dy] = rotateLocal(m.rot, i, 0)
    out.push([m.x + dx, m.y + dy, m.z])
  }
  return out
}

/** The same walk for one of the newer runs: `w` cells along local +x. */
function runCells(m: { x: number; y: number; z: number; w: number; rot?: number }): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []
  const w = m.w > 0 ? m.w : 1
  for (let i = 0; i < w; i++) {
    const [dx, dy] = rotateLocal(m.rot, i, 0)
    out.push([m.x + dx, m.y + dy, m.z])
  }
  return out
}

/** Every cell a 玻璃板's run covers (`w` cells along local +x). */
export function glassCells(m: Extract<Module, { type: 'glass' }>): Array<[number, number, number]> {
  return runCells({ x: m.x, y: m.y, z: m.z, w: m.w, rot: m.rot })
}

/**
 * Whether two floor-standing curtains occupy different sides of the same tile.
 * Opposite-facing panels share an axis but sit on opposite tile edges. A run can
 * meet another run in the middle of its length, so the shared cell need not be
 * an endpoint of either piece.
 */
export function curtainShareCrossTile(
  a: Extract<Module, { type: 'glass' }>,
  b: Extract<Module, { type: 'glass' }>,
): boolean {
  const aRot = normRot(a.rot)
  const bRot = normRot(b.rot)
  if (a.z !== b.z || aRot === bRot) return false
  if (!glassStandsOnFloor(glassModuleSpec(a.cfg?.variant, a.cfg?.curtainHeight))
    || !glassStandsOnFloor(glassModuleSpec(b.cfg?.variant, b.cfg?.curtainHeight))) return false
  const bCells = glassCells(b)
  return glassCells(a).some(([x, y]) => bCells.some(([bx, by]) => x === bx && y === by))
}

/** The end posts of `a` that enter `b`'s frame envelope at a shared crossing. */
export function curtainCornerJoin(
  a: Extract<Module, { type: 'glass' }>,
  b: Extract<Module, { type: 'glass' }>,
): Array<'start' | 'end'> {
  if (!curtainShareCrossTile(a, b)) return []
  const other = moduleEnvelope(b)
  if (!other) return []
  const postCenter = (m: Extract<Module, { type: 'glass' }>, end: 'start' | 'end'): [number, number] => {
    const w = m.w || glassModuleSpec(m.cfg?.variant, m.cfg?.curtainHeight).w
    const endX = end === 'start' ? -(w / 2 - GLASS_FRAME.post / 2) : w / 2 - GLASS_FRAME.post / 2
    const [ox, oy] = rotateLocal(m.rot, 0.5 + (w - 1) / 2, GLASS_FRAME.depth / 2 - 0.5)
    const [ex, ey] = rotateLocal(m.rot, endX, 0)
    return [m.x + ox + ex, m.y + oy + ey]
  }
  return (['start', 'end'] as const).filter((end) => {
    const [x, y] = postCenter(a, end)
    return x >= other.x0 && x < other.x1 && y >= other.y0 && y < other.y1
  })
}

/** Every cell a 门's run covers: one for a 单开 door, two for a 双开. */
export function doorCells(m: Extract<Module, { type: 'door' }>): Array<[number, number, number]> {
  return runCells({ x: m.x, y: m.y, z: m.z, w: m.w, rot: m.rot })
}

/** Snap a door dropped on a curtain to its axis and edge, centring its run on the hovered panel cell. */
export function snapDoorToCurtain(
  door: Extract<Module, { type: 'door' }>,
  glass: Extract<Module, { type: 'glass' }>,
  cell: [number, number],
): Extract<Module, { type: 'door' }> {
  if (glass.z !== door.z || !glassStandsOnFloor(glassModuleSpec(glass.cfg?.variant, glass.cfg?.curtainHeight))) return door
  const run = glassCells(glass)
  const index = run.findIndex(([x, y]) => x === cell[0] && y === cell[1])
  if (index < 0 || door.w > run.length) return door
  const first = Math.max(0, Math.min(run.length - door.w, index - Math.floor((door.w - 1) / 2)))
  const [dx, dy] = rotateLocal(glass.rot, first, 0)
  return { ...door, x: glass.x + dx, y: glass.y + dy, rot: glass.rot }
}

/** A door fitted into a floor-standing glass curtain: same storey and plane, with the door wholly inside the glass run. */
export function curtainDoorShare(a: Module, b: Module): boolean {
  const glass = a.type === 'glass' ? a : b.type === 'glass' ? b : undefined
  const door = a.type === 'door' ? a : b.type === 'door' ? b : undefined
  if (!glass || !door || glass.z !== door.z || normRot(glass.rot) !== normRot(door.rot)) return false
  if (!glassStandsOnFloor(glassModuleSpec(glass.cfg?.variant, glass.cfg?.curtainHeight))) return false
  const wallCells = new Set(glassCells(glass).map(([x, y]) => `${x},${y}`))
  return doorCells(door).every(([x, y]) => wallCells.has(`${x},${y}`))
}

/** Every cell a 站名's run covers — its panel is its run, in whole cells. */
export function calligraphyCells(m: Extract<Module, { type: 'calligraphy' }>): Array<[number, number, number]> {
  return runCells({ x: m.x, y: m.y, z: m.z, w: m.w, rot: m.rot })
}

/** Every cell a 线网图 covers: two cells for the wall board, one for the totem. */
export function lineMapCells(m: Extract<Module, { type: 'linemap' }>): Array<[number, number, number]> {
  return runCells({ x: m.x, y: m.y, z: m.z, w: m.w, rot: m.rot })
}

/**
 * The envelope of a **panel bolted to a wall**: the exact AABB of the run's own
 * cells, narrowed to the `PANEL_DEPTH` of the cell the panel hangs on — the wall's
 * own side of it (`wallSide`), so the box is the housing and not the room in front
 * of it. Three quarters of the cell therefore stay the room's, which is why a 座椅
 * stands under a 线网图 board and a 售票机 beneath an inscription hung above its head.
 * `zLo`/`zHi` are the band of wall the panel covers.
 *
 * The run's extent comes from the module's **own cells** (`glassCells` and its
 * siblings march the run the way the model draws it), because a quarter-turn sends a
 * run along −x or −y as readily as along +x or +y: reading `x + w` would put the
 * housing across the room on the rotations that run the other way.
 */
function wallPanelBox(m: Module, cells: ReadonlyArray<[number, number, number]>, zLo: number, zHi: number): ModuleBox {
  const box = cellsAabb(cells, zLo, zHi)
  const [wx, wy] = wallSide(m.rot)
  if (wx !== 0) {
    return wx > 0 ? { ...box, x1: box.x1, x0: box.x1 - PANEL_DEPTH } : { ...box, x0: box.x0, x1: box.x0 + PANEL_DEPTH }
  }
  return wy > 0 ? { ...box, y1: box.y1, y0: box.y1 - PANEL_DEPTH } : { ...box, y0: box.y0, y1: box.y0 + PANEL_DEPTH }
}

/**
 * The plan box a flat, floor-standing module occupies. Modules anchor at their
 * cell and rise from its top (`z + 1`), matching `render/models.ts`. The exit's
 * canopy is longer than its enclosure, but the collision box is the head-house
 * proper, so an exit does not swallow the plaza on every side.
 */
function flatEnvelope(m: Module): ModuleBox | null {
  const z0 = m.z + 1
  switch (m.type) {
    case 'hanger': {
      const boxes = hangerBoxes(m)
      return {
        x0: Math.min(...boxes.map((b) => b.x0)), x1: Math.max(...boxes.map((b) => b.x1)),
        y0: Math.min(...boxes.map((b) => b.y0)), y1: Math.max(...boxes.map((b) => b.y1)),
        z0: Math.min(...boxes.map((b) => b.z0)), z1: Math.max(...boxes.map((b) => b.z1)),
      }
    }
    case 'bench':
      // A bench runs `w` cells along local +x (a 2 m bench chains two seats),
      // so its box is the AABB of the whole run.
      return cellsAabb(benchCells(m), z0, z0 + FLAT_HEIGHT.bench)
    case 'door': {
      // A 门 **stands on the floor**: it is a doorway of its own — threshold, posts,
      // head and the leaves between them — so it reserves its run, from the floor top
      // to the top of its head, like a 货架, and needs nothing behind it. The height is
      // the variant's own `DoorSpec.h` (`sim/doors.ts`), which is the height
      // `DoorModel` draws it to: one table, so the box and the model cannot drift.
      const spec = doorSpec(m.cfg?.variant)
      return cellsAabb(doorCells(m), z0, z0 + spec.h)
    }
    case 'guidepost':
      return { x0: m.x, y0: m.y, z0, x1: m.x + 1, y1: m.y + 1, z1: z0 + 4 }
    case 'busstop':
      return cellsAabb(trackCells(m), z0, z0 + 3)
    case 'gate':
    case 'tvm':
    case 'vending':
    case 'desk':
    case 'checkout':
    case 'cubicle':
    case 'sink':
    case 'bin':
    case 'clock':
    case 'cctv':
    case 'tv':
      return { x0: m.x, y0: m.y, z0, x1: m.x + 1, y1: m.y + 1, z1: z0 + FLAT_HEIGHT[m.type] }
    case 'extinguisher':
      return cellsAabb(extinguisherCells(m), z0, z0 + extinguisherSpec(m.cfg.variant).height)
    case 'shelf':
      return { x0: m.x, y0: m.y, z0, x1: m.x + 1, y1: m.y + 1, z1: z0 + shelfSpec(m.cfg.variant).height }
    case 'ac-unit':
    case 'electrical-cabinet':
    case 'tactile':
      return cellsAabb(floorDecorCells(m).map(([x, y]) => [x, y, m.z]), z0, z0 + floorDecorSpec(m).h)
    case 'floor-mark':
      return floorDecorBounds(m)
    case 'vent': {
      const half = VENT_WIDTH / 2
      // The grille's own band under the storey's ceiling line. (A grille hung under a **top block**
      // draws at that block, one cell over its own; the envelope still reserves the nominal line,
      // which is the reservation a hanging fitting has always taken.)
      const ceiling = ventCeilingZ(m)
      return { x0: m.x + 0.5 - half, y0: m.y + 0.5 - half, z0: ceiling - VENT_DEPTH, x1: m.x + 0.5 + half, y1: m.y + 0.5 + half, z1: ceiling }
    }
    case 'light': {
      const { width, depth } = lightSpec(m)
      const offset = lightOffset(m)
      const cx = m.x + 0.5 + offset.x
      const cy = m.y + 0.5 + offset.y
      const ceiling = lightCeilingZ(m)
      return { x0: cx - width / 2, y0: cy - depth / 2, z0: ceiling - LIGHT_DEPTH, x1: cx + width / 2, y1: cy + depth / 2, z1: ceiling }
    }
    case 'sign': {
      // A **hanging** 指示牌 spans the whole storey column, like the 电视 and the
      // clock above. A **wall** board reserves only its printed sheet's 3 mm stand-off
      // on the wall and the band the panel crosses; the air below and in front stays
      // available, which is the whole difference between the two mounts.
      if (isCeilingHung(m)) return { x0: m.x, y0: m.y, z0, x1: m.x + 1, y1: m.y + 1, z1: z0 + FLAT_HEIGHT.sign }
      const spec = signMountSpec(m.cfg.mount)
      const half = PANEL_MIN_H / 2
      const panelZ = m.cfg.boothId ? BOOTH_SIGN_PANEL_Z : spec.panelZ
      const width = signBoardsPanel(mountedSignBoards('wall', signBoardsOf(m.cfg))).w
      if (m.cfg.boothId) {
        const dx = m.cfg.boothOffset?.x ?? 0, dy = m.cfg.boothOffset?.y ?? 0
        const rot = normRot(m.rot)
        const cx = m.x + 0.5 + dx, cy = m.y + 0.5 + dy
        const [sx, sy] = wallSide(rot)
        const bx = cx + sx * 0.5, by = cy + sy * 0.5
        // Reserve only the tiny gap from the header to the printed sheet.
        return { x0: rot % 2 ? Math.min(bx, bx - sx * WALL_SIGN_STAND_OFF) : cx - width / 2,
          x1: rot % 2 ? Math.max(bx, bx - sx * WALL_SIGN_STAND_OFF) : cx + width / 2,
          y0: rot % 2 ? cy - width / 2 : Math.min(by, by - sy * WALL_SIGN_STAND_OFF),
          y1: rot % 2 ? cy + width / 2 : Math.max(by, by - sy * WALL_SIGN_STAND_OFF),
          z0: z0 + panelZ - half, z1: z0 + panelZ + half }
      }
      // A wall-mounted wayfinding sign is just its printed sheet, held 3 mm clear
      // of the backing to prevent z-fighting; reserve that thin plane, not a box.
      const rot = normRot(m.rot)
      const [sx, sy] = wallSide(rot)
      const cx = m.x + 0.5, cy = m.y + 0.5
      const wallX = cx + sx * 0.5, wallY = cy + sy * 0.5
      return {
        x0: rot % 2 ? Math.min(wallX, wallX - sx * WALL_SIGN_STAND_OFF) : cx - width / 2,
        x1: rot % 2 ? Math.max(wallX, wallX - sx * WALL_SIGN_STAND_OFF) : cx + width / 2,
        y0: rot % 2 ? cy - width / 2 : Math.min(wallY, wallY - sy * WALL_SIGN_STAND_OFF),
        y1: rot % 2 ? cy + width / 2 : Math.max(wallY, wallY - sy * WALL_SIGN_STAND_OFF),
        z0: z0 + panelZ - half, z1: z0 + panelZ + half,
      }
    }
    case 'billboard': {
      // A 广告牌 is **bolted to a wall**, so what it reserves is the panel on that
      // wall: a thin housing a hand's width off the backing, spanning the run along
      // its local +x and only the band of wall the poster really covers. The
      // variants sit at `panelZ` 1.55–1.7 m with `panelH` 0.48–1.16 m, so the lowest
      // panel's skirt is more than two metres above the floor — the air under every
      // one of them is the room's, which is why a 座椅, a 售票机 or a 闸机 against the
      // same wall is not "in the way" of a poster five feet above it.
      const spec = billboardSpec(m.cfg?.variant)
      const pz = m.z + 1 + spec.panelZ
      const half = spec.panelH / 2 + FRAME_PAD
      return wallPanelBox(m, billboardCells(m), pz - half, pz + half)
    }
    case 'glass': {
      // A 玻璃板 reserves a **slab on an edge** rather than a cell: the run along
      // local +x and a thin strip on its local −y edge (`wallSide`). A short 玻璃板
      // is cladding bolted to the wall behind it, so that strip hugs the wall;
      // 玻璃幕墙 variants stand on the floor edge like a doorway, so the strip is
      // their leading edge with no wall behind them. Either way the strip is the
      // housing the model draws (`GlassModel`), and the air beside it is the
      // room's — which is why a 围栏 through the middle of the same tile co-exists
      // with a parallel panel (centre 0.45–0.55 vs edge 0–0.25) while a crossing
      // one still overlaps and is refused. Nothing is exempted by hand: the boxes
      // decide.
      const spec = glassModuleSpec(m.cfg?.variant, m.cfg?.curtainHeight)
      return wallPanelBox(m, glassCells(m), z0, z0 + spec.h)
    }
    case 'calligraphy': {
      // A 站名 hangs at eye height (横排) or climbs the wall from near the floor
      // (竖排), so its slab is the band between `bottom` and `bottom + panelH` — the
      // same shape as the 广告牌's, at the height the inscription is written.
      const bottom = calligraphyBottom(m.cfg?.axis)
      return wallPanelBox(m, calligraphyCells(m), z0 + bottom, z0 + bottom + m.panelH)
    }
    case 'monitor':
      return m.cfg.mount === 'wall'
        ? wallPanelBox(m, monitorCells(m), z0 + 0.5, z0 + 2.5)
        : { x0: m.x, y0: m.y, z0: z0 + 1.7, x1: m.x + 1, y1: m.y + 1, z1: z0 + 3 }
    case 'rail-signal': {
      const half = 0.38 * RAIL_SIGNAL_SCALE
      return { x0: m.x + 0.5 - half, y0: m.y + 0.5 - half, z0, x1: m.x + 0.5 + half, y1: m.y + 0.5 + half, z1: z0 + RAIL_SIGNAL_HEIGHT }
    }
    case 'linemap': {
      const spec = lineMapSpec(m.cfg?.mount)
      // The totem is floor-standing, so it reserves its **whole run** from the floor up
      // to its own head — two cells of concourse, not one. The wall board is the panel's
      // band on the wall, with the frame's clearance the board's own housing has.
      if (spec.mount === 'stand') return cellsAabb(lineMapCells(m), z0, z0 + spec.height)
      const bottom = spec.panelZ - spec.panelH / 2
      return wallPanelBox(m, lineMapCells(m), z0 + bottom - LINE_MAP_FRAME_PAD, z0 + bottom + spec.panelH + LINE_MAP_FRAME_PAD)
    }
    case 'psd-end': {
      const h = m.cfg.psd === 'half' ? PSD_HALF_HEIGHT : PSD_FULL_HEIGHT
      const [ox, oy] = psdEndOffset(m)
      const [a, b] = psdEndSpan(m)
      // The model trims the corner's length and clips its cap to the tile too.
      // Neighbouring blocks must see the same bounded footprint (§5.3).
      const corners = [[a + ox, Math.max(-0.5, -0.48 + oy)], [b + ox, Math.min(0.5, -0.20 + oy)]]
        .map(([x, y]) => rotateLocal(m.rot, x, y))
      return {
        x0: m.x + 0.5 + Math.min(...corners.map((p) => p[0])),
        x1: m.x + 0.5 + Math.max(...corners.map((p) => p[0])),
        y0: m.y + 0.5 + Math.min(...corners.map((p) => p[1])),
        y1: m.y + 0.5 + Math.max(...corners.map((p) => p[1])),
        z0, z1: z0 + h,
      }
    }
    case 'fence': {
      // A 1 m high, very thin panel through the middle of its block (§5.2): the
      // thin axis follows the placement rotation, so a fence line reads as one
      // continuous barrier and a gate row can plug straight into it. Thin still
      // overlaps a full-cell box in the same cell (same-cell stacking is
      // refused) while adjacent cells stay legal.
      const z1 = z0 + FLAT_HEIGHT.fence
      const rot = (((m.rot ?? 0) % 4) + 4) % 4
      if (rot % 2 === 1) return { x0: m.x + 0.45, y0: m.y, z0, x1: m.x + 0.55, y1: m.y + 1, z1 }
      return { x0: m.x, y0: m.y + 0.45, z0, x1: m.x + 1, y1: m.y + 0.55, z1 }
    }
    case 'pillar': {
      const half = pillarWidth(m) / 2
      const offset = pillarOffset(m)
      const height = m.cfg.height - (m.cfg.bridgeId ? BRIDGE_DECK_DEPTH + 1 : 0)
      return { x0: m.x + 0.5 + offset.x - half, y0: m.y + 0.5 + offset.y - half, x1: m.x + 0.5 + offset.x + half, y1: m.y + 0.5 + offset.y + half, z0, z1: z0 + height }
    }
    case 'roof':
      if (!m.cfg.variant && m.cfg.plateSnap) {
        const centre = m.z + (m.cfg.plateSnap === 'lower' ? 0.125 : 0.875)
        return cellsAabb(trackCells(m), centre - ROOF_THICKNESS / 2, centre + ROOF_THICKNESS / 2)
      }
      return cellsAabb(trackCells(m), z0 + TRUSS_ROOF_BASE, z0 + (m.cfg.variant ? trussRoofTop(m.d) : TRUSS_ROOF_BASE + ROOF_THICKNESS))
    case 'exit': {
      if (m.cfg.style === 'virtual') {
        // 虚拟 exit is a 1×1 导向柱 on the surface: same reservation as the pillar.
        return { x0: m.x, y0: m.y, z0, x1: m.x + 1, y1: m.y + 1, z1: z0 + 4 }
      }
      if (m.cfg.style === 'doorway') {
        const { centre, half } = exitSpan(m)
        const cells: Array<[number, number, number]> = []
        for (let x = Math.ceil(centre - half - 1e-6); x < Math.ceil(centre + half - 1e-6); x++) {
          const [dx, dy] = rotateLocal(m.rot, x, 0)
          cells.push([m.x + dx, m.y + dy, m.z])
        }
        // The header is attached to the exact 1 m block course it was dropped on.
        const panelBottom = m.cfg.mountZ ?? z0
        return wallPanelBox(m, cells, panelBottom + 0.04, panelBottom + 0.96)
      }
      const rx = exitWidth(exitBays(m)) / 2
      const ry = EXIT_L / 2
      const cx = m.x + 0.5
      const cy = m.y + 0.5
      // Rotation snaps to quarter turns, so the largest axis extent bounds it.
      const half = Math.max(rx, ry)
      return { x0: cx - half, y0: cy - half, z0, x1: cx + half, y1: cy + half, z1: z0 + 3.4 }
    }
    case 'retail':
    case 'shop':
    case 'booth':
      return { x0: m.x, y0: m.y, z0, x1: m.x + m.w, y1: m.y + m.h, z1: z0 + FLAT_HEIGHT[m.type] }
    case 'platform-edge': {
      // The screen sits on the track-facing strip of its single-cell-deep run.
      // A half-height (半高) screen reserves only its actual height, so something
      // may stand in the headroom the full screen would have filled.
      const h = m.cfg.psd === 'half' ? PSD_HALF_HEIGHT : PSD_FULL_HEIGHT
      const box = cellsAabb(edgeCells(m), z0, z0 + h)
      return box.x1 - box.x0 <= 1.0001
        ? { ...box, x0: box.x0 + 0.16, x1: box.x1 - 0.16 }
        : { ...box, y0: box.y0 + 0.16, y1: box.y1 - 0.16 }
    }
    case 'track':
      // A dug track bed: the module owns the whole trench volume (bed slab +
      // rails) from the block top to the platform surface, so no equipment can
      // be dropped into it.
      return cellsAabb(trackCells(m), m.z - (m.cfg.bridge ? BRIDGE_DECK_DEPTH : 0), m.z + (m.cfg.bridge ? bridgeBarrierTop(m.cfg.bridgeRailing) : 1))
    default:
      return null
  }
}

/**
 * The world box a module occupies — its ramp corridor or its flat body. A lift
 * is neither: it is a 2 × 2 m shaft rising two storeys, so it gets its own box
 * (the ramp envelope's thin vertical column would not reserve the whole plan).
 */
export function moduleEnvelope(m: Module): ModuleBox | null {
  if (m.type === 'stair' && m.cfg.block) return { x0: m.x, y0: m.y, z0: m.z + 1, x1: m.x + 1, y1: m.y + 1, z1: m.z + 1 + (m.cfg.blockHeight ?? 1) }
  if (m.type === 'lift') return liftEnvelope(m)
  return rampEnvelope(m) ?? flatEnvelope(m)
}

/** The 2 × 2 m shaft box of a lift, from its lower landing to above its top. */
function liftEnvelope(m: Extract<Module, { type: 'lift' }>): ModuleBox {
  const lo = Math.min(m.from.z, m.to.z)
  const hi = Math.max(m.from.z, m.to.z)
  return { x0: m.x, y0: m.y, z0: lo + 0.5, x1: m.x + LIFT_SIZE, y1: m.y + LIFT_SIZE, z1: hi + 1 + 0.6 }
}

/**
 * True when a cell's exposed top face is a rail track bed (§4.3). The track bed
 * is what sits under the rails: agents cannot walk on it (speed 0) and, by the
 * same rule, equipment must not be laid over it.
 */
export function isTrackBed(cells: readonly Cell[], x: number, y: number, z: number): boolean {
  const c = cells.find((cc) => cc.x === x && cc.y === y && cc.z === z)
  return c?.fill === 'solid' && c.finish?.top === 'floor.track'
}

/** Every cell a track module's bed covers — its run × depth at its own level. */
export function trackBedCells(m: Module): Array<[number, number, number]> {
  return m.type === 'track' ? trackCells(m) : []
}

/** The track module whose bed covers `(x, y, z)`, if any. */
export function trackAt(modules: readonly Module[], x: number, y: number, z: number): Module | undefined {
  for (const m of modules) {
    if (m.type === 'track' && trackCellAt(m, x, y, z)) return m
  }
  return undefined
}

/**
 * Keys of every track-bed cell, from the finish OR a track module's bed. A
 * placed rail digs its cells (they are void, so there is no finish left to
 * read); the finish path keeps the hand-built demo working unchanged.
 */
export function trackBedKeys(cells: readonly Cell[], modules: readonly Module[]): Set<string> {
  const out = new Set<string>()
  for (const c of cells) if (c.fill === 'solid' && c.finish?.top === 'floor.track') out.add(`${c.x},${c.y},${c.z}`)
  for (const m of modules) for (const [x, y, z] of trackBedCells(m)) out.add(`${x},${y},${z}`)
  return out
}

/** True when a cell is a track bed by either rule. */
export function isTrackCell(cells: readonly Cell[], modules: readonly Module[], x: number, y: number, z: number): boolean {
  return isTrackBed(cells, x, y, z) || trackAt(modules, x, y, z) !== undefined
}

/**
 * The floor cells a module stands on, at its own level — the **public** footprint.
 * A room covers its whole `w × h`; a 2 × 2 电梯 its four cells; a rail its bed, a
 * 站台门 its screened strip, a 座椅 and a 广告牌 the run of cells they span; a
 * **run** its two **landings**, which is the floor a 楼梯 or 扶梯 really stands on
 * (its corridor between them is `reservedOpening`'s business, and the ground under
 * its slope is floor a block belongs on). Everything else — a gate, a TVM, a hung
 * piece — is anchored by its single cell.
 *
 * `baseCells` below is the same list narrowed to each piece's anchor cell, for the
 * callers that ask about a module *as a candidate* (a rail's bed is one object, not
 * one cell per metre).
 */
export function moduleFootprint(m: Module): Array<[number, number]> {
  switch (m.type) {
    case 'extinguisher': return extinguisherCells(m).map(([x, y]) => [x, y])
    case 'hanger': return hangerCells(m)
    case 'ac-unit':
    case 'electrical-cabinet':
    case 'tactile':
    case 'floor-mark':
      return floorDecorCells(m)
    case 'retail':
    case 'shop':
    case 'booth': {
      const out: Array<[number, number]> = []
      for (let x = m.x; x < m.x + m.w; x++) for (let y = m.y; y < m.y + m.h; y++) out.push([x, y])
      return out
    }
    case 'platform-edge':
      return edgeCells(m).map(([x, y]) => [x, y] as [number, number])
    case 'billboard':
      return billboardCells(m).map(([x, y]) => [x, y] as [number, number])
    case 'glass':
      return glassCells(m).map(([x, y]) => [x, y] as [number, number])
    case 'door':
      return doorCells(m).map(([x, y]) => [x, y] as [number, number])
    case 'calligraphy':
      return calligraphyCells(m).map(([x, y]) => [x, y] as [number, number])
    case 'monitor':
      return monitorCells(m).map(([x, y]) => [x, y] as [number, number])
    case 'linemap':
      return lineMapCells(m).map(([x, y]) => [x, y] as [number, number])
    case 'bench':
      return benchCells(m).map(([x, y]) => [x, y] as [number, number])
    case 'busstop':
    case 'roof':
    case 'track':
      return trackCells(m).map(([x, y]) => [x, y] as [number, number])
    case 'lift':
      return liftFootprintCells(m)
    case 'stair':
      if (m.cfg.block) return [[m.x, m.y]]
      return [m.from, m.to].map((p) => [p.x, p.y] as [number, number])
    case 'escalator':
      return escalatorLandings(m).map((p) => [p.x, p.y] as [number, number])
    default:
      return [[m.x, m.y]]
  }
}

/**
 * The floor cells a module is **anchored** by, for the rules that ask about the
 * piece as a whole: a rail's dug bed is one object rather than one cell per metre,
 * and a run is the single cell it was dropped on (its landings are `moduleFootprint`
 * when a caller needs the floor it stands on).
 */
function baseCells(m: Module): Array<[number, number]> {
  switch (m.type) {
    case 'exit':
      // The wall support is one block; the exit's ground opening is derived separately.
      return [[m.x, m.y]]
    case 'retail':
    case 'shop':
    case 'booth':
    case 'platform-edge':
    case 'billboard':
    case 'glass':
    case 'calligraphy':
    case 'linemap':
    case 'monitor':
    case 'busstop':
    case 'bench':
    case 'extinguisher':
    case 'hanger':
    case 'door':
    case 'track':
    case 'lift':
      return moduleFootprint(m)
    default:
      return [[m.x, m.y]]
  }
}

/**
 * True when a candidate would stand on a rail track bed. `placementBlocked`
 * only sees other modules; the block under a track bed is solid and looks like
 * floor, so this is the surface rule that sits beside it. The builder refuses
 * these placements even though nothing else occupies the space.
 */
export function placementOnTrack(cells: readonly Cell[], candidate: Module, modules: readonly Module[] = []): boolean {
  for (const [x, y] of baseCells(candidate)) {
    if (isTrackBed(cells, x, y, candidate.z)) return true
    // A dug bed leaves no finish: the module covers the cell, and its own bed
    // base is the block just under it, so test the candidate's cell and the one
    // above (the trench).
    if (trackAt(modules, x, y, candidate.z) || trackAt(modules, x, y, candidate.z + 1)) return true
  }
  return false
}

/**
 * True when a solid block may not be built at `(x, y, z)` because it is a
 * reserved opening: the corridor a ramp carves (stair/escalator/lift) or the
 * floor an exit head-house lays over a hole. Equipment already refuses these
 * spaces through `placementBlocked` / `placementOnTrack`; the block brush needs
 * the same guard, or a hand-built cell seals a run the player can see through.
 */
export function reservedOpening(modules: readonly Module[], x: number, y: number, z: number): boolean {
  return rampOpeningAt(modules, x, y, z) || exitFloorAt(modules, x, y, z)
}

/* ------------------------------------------------------- wall-mounted decor */

/**
 * Decoration types that must be fixed to a wall block behind them (§5.7): the
 * 广告牌, the 玻璃板, the 站名 and the wall-mounted 线网图. A 线网图's **stand** variant is
 * the one exception — it is a totem on the floor — so the test is the placed module's
 * own, not just its type (`isWallMounted`). A **指示牌** joins them from its own
 * `cfg.mount`, which is why it is not in this set either: a hanging sign wants the
 * ceiling, and only the wall board wants a wall.
 *
 * A **门 is not here**: it carries its own threshold, posts and head, so it stands on the
 * floor like a 货架 and asks the ground rules for a tile, not the wall's for backing.
 */
const WALL_MOUNTED: ReadonlySet<string> = new Set(['billboard', 'glass', 'calligraphy', 'linemap'])

/**
 * Decoration types that hang by rods from the ceiling slab above them (§5.7). A **sign**
 * is deliberately not in this set: its hanging mount and its wall mount are two pieces
 * behind one type, so `isCeilingHung` answers a sign (and the bare `sign-ceiling` id)
 * from `cfg.mount` before this lookup.
 */
const CEILING_MOUNTED: ReadonlySet<string> = new Set(['tv', 'clock', 'cctv', 'cctv-ptz', 'cctv-dome', 'light', 'light-circular', 'light-rectangular', 'vent'])

/**
 * True when a piece is bolted flat to a wall. Every wall-mounted type is, except
 * the 线网图's free-standing totem: it stands on the floor on its own plinth, so it
 * answers to the ground rules like a 售票机 and never to the wall's
 * (`equipmentReason`). A 指示牌 answers from its own mount: the wall board is, the
 * hanging one is not. 地面 出入口 uses its doorway style as a wall-mounted exit panel.
 */
export function isWallMounted(m: Module): boolean {
  if (m.type === 'monitor') return m.cfg.mount === 'wall'
  if (m.type === 'exit') return m.cfg.style === 'doorway'
  if (m.type === 'sign') return !signMountSpec(m.cfg.mount).hung
  if (!WALL_MOUNTED.has(m.type)) return false
  if (m.type === 'glass') return !glassStandsOnFloor(glassModuleSpec(m.cfg.variant, m.cfg.curtainHeight))
  return m.type === 'linemap' ? lineMapSpec(m.cfg.mount).mount === 'wall' : true
}

/**
 * The wall courses (local, 0 = the first metre above the floor) a wall-mounted
 * piece needs solid backing on, from the table that owns the piece's own height:
 * a 广告牌 and a 1 m 玻璃板 want the first course, a 2 m panel the first two, a
 * 站名 and a wall 线网图 the band their panel really crosses, and a wall 指示牌 the
 * band its own 0.7 m board is bolted at. 地面 出入口 needs only the first course.
 *
 * One list per type, because "how tall is this panel and where does it sit" is the
 * table's business and this is the rule that reads it — a piece whose courses and
 * whose drawn body disagreed would hang half a metre into thin air.
 */
export function wallMountCourses(m: Module): number[] {
  switch (m.type) {
    case 'monitor': return m.cfg.mount === 'wall' ? [0, 1, 2] : []
    case 'billboard':
      // A poster is one course: the billboard's variants hang inside the first
      // metre of their wall whatever their panel size.
      return [0]
    case 'exit':
      // 地面 exits use the anchor block as their single wall attachment.
      return m.cfg.style === 'doorway' ? [0] : []
    case 'glass':
      return glassWallCourses(glassModuleSpec(m.cfg?.variant, m.cfg?.curtainHeight))
    case 'door':
      // A 门 stands on the floor, so it wants no wall behind it at all.
      return []
    case 'calligraphy':
      return calligraphyCourses(calligraphyBottom(m.cfg?.axis), m.panelH)
    case 'linemap':
      return lineMapWallCourses(lineMapSpec(m.cfg?.mount))
    case 'sign':
      return signWallCourses(m.cfg.mount)
    default:
      return []
  }
}

/**
 * True when a piece hangs from the slab overhead — a hanging 指示牌, a 电视, a 时钟 or a
 * 监控. Such a piece wants the **air** at the top of its column, not the cell, so it
 * shares a tile with whatever stands on the floor or is bolted to the wall
 * (`placementBlocked`), and a block laid in that cell is the slab it hangs from
 * rather than something in its way. A **wall** 指示牌 is its opposite number and is
 * not hung.
 *
 * The test reads a **palette id** as readily as a placed module, because the
 * placement tool is armed with the id before there is a module to ask: a 指示牌's two
 * mounts are two tiles (`sign-ceiling` / `sign-wall`) and neither carries a `cfg` yet,
 * so `sign-ceiling` answers for the hanging board and `sign-wall` — like the wall
 * board itself — answers no.
 */
export function isCeilingHung(m: { type: string; cfg?: object }): boolean {
  if (m.type === 'monitor-ceiling' || m.type === 'monitor') return (m.cfg as { mount?: string } | undefined)?.mount !== 'wall'
  if (m.type === 'hanger-roof' || m.type.startsWith('hanger-roof-')) return true
  if (m.type === 'hanger') return (m.cfg as { mount?: string } | undefined)?.mount === 'roof'
  if (m.type === 'sign' || m.type === 'sign-ceiling') return signMountSpec(signMountOf(m.cfg)).hung
  return CEILING_MOUNTED.has(m.type)
}

/**
 * The cell step from a wall-mounted module to the wall it hangs on. The model
 * is built against its local −y face and `placeLocal` turns it by `rot`, so the
 * wall lies at (0,−1) rotated: rot 0 → −y, 1 → +x, 2 → +y, 3 → −x.
 */
export function wallSide(rot: number | undefined): [number, number] {
  const [dx, dy] = rotateLocal(rot, 0, -1)
  // Normalise −0 to 0 so callers (and their tests) see plain integers.
  return [dx === 0 ? 0 : dx, dy === 0 ? 0 : dy]
}

/**
 * The cell a wall-mounted piece stands in, from the pointer's hit (`cell`, the
 * block under it) and `place = cell + face normal` (`pickCells`, §9.5's "click the
 * host face").
 *
 *   * **A side face is a wall** — whatever tags the block carries. The piece
 *     stands in the `place` cell in front of that face, on the storey the face
 *     belongs to (`storeyBand`): a hover on an upper wall course anchors the
 *     panel to the floor below, not to a floating course height. The station wall
 *     across the track is the case the mount was built for (there is no walkable
 *     floor in front of it), and a wall raised with the 方块 brush is the same
 *     surface as one the 墙 tool tagged — a plain block is not a wall to
 *     `isWallBlock`, so without this the panel stood *inside* the block it was
 *     aimed at and could hug either of two neighbours.
 *   * **A top or bottom face is not a wall**: the piece is aimed at the hovered cell
 *     itself, the floor it stands on. A ground exit may still ask for the storey snap
 *     there (`snapToSolidBlock`), and a wall-tagged cell gets it; a plain block keeps
 *     the exact height it was hit at, so a raised slab is not dragged to the grid.
 *   * `levelBase` is the station's 基准高度: the 4 m editing grid is shifted by it,
 *     so the storey floor a course anchors to is asked with it — never the fixed
 *     0 / 4 / 8 lines.
 *   * `followCourse` is for a piece that is **cladding from its base** — the 玻璃板
 *     (`wallMountFollowsCourse`). Its body starts at its cell's floor top, so the
 *     cell one below the block that was hit puts the pane over exactly the course the
 *     pointer is on: aim at a wall's third course and the window covers the third
 *     course, aim at the first and the answer is the storey floor it has always been.
 *     Only a **wall course** counts (something solid over it): a floor slab's own edge
 *     is not a band of wall to cover, so that half keeps the storey reading.
 */
export function wallMountStandCell(
  cells: readonly Cell[],
  cell: readonly [number, number, number],
  place: readonly [number, number, number],
  snapToSolidBlock = false,
  levelBase = 0,
  followCourse = false,
): [number, number, number] {
  const hit = cells.find((c) => c.x === cell[0] && c.y === cell[1] && c.z === cell[2])
  // 地面 exits attach to an ordinary block face too; they do not require the
  // block to carry one of the station-wall tags used by wall decorations.
  const onWall = hit !== undefined && hit.fill === 'solid' && (snapToSolidBlock || isWallBlock(hit))
  const side = place[0] !== cell[0] || place[1] !== cell[1]
  if (side) {
    // A **wall course** is a block with a block over it — the document's own cells,
    // which is what a wall column is; the street plane over a course below grade reads
    // as uncovered, and only decides between the aimed course and the storey floor.
    const coveredAbove = cells.some((c) => c.fill === 'solid' && c.x === cell[0] && c.y === cell[1] && c.z === cell[2] + 1)
    if (followCourse && coveredAbove) return [place[0], place[1], cell[2] - 1]
    return [place[0], place[1], storeyBand(cell[2], levelBase)]
  }
  if (!onWall) return [cell[0], cell[1], cell[2]]
  return [place[0], place[1], storeyBand(place[2], levelBase)]
}

/**
 * True for a wall-mounted piece that is **cladding from its base**: its body starts at
 * the floor top of its own cell and rises its own height (`moduleEnvelope`'s `z0`),
 * which is the 玻璃板 — the one wall piece whose size is a *band* of wall. Such a piece
 * **hangs over the course the pointer is on** (`wallMountStandCell`'s `followCourse`),
 * so a 玻璃板 is a window you place where you aim it rather than floor cladding wherever
 * the pointer happens to be.
 *
 * The 广告牌, the 站名, the 线网图 and the wall 指示牌 are drawn at a `panelZ` of their own
 * instead, so following the pointer would float them a metre above it: those keep the
 * storey floor as their anchor, which is what puts a poster at eye height wherever on
 * the wall it is aimed. A **floor-standing** 玻璃幕墙 is not wall-mounted at all.
 *
 * Answers a **palette id** (`glass-2x2`) as readily as a placed module, because the tool
 * asks it before the module it is about to build exists.
 */
export function wallMountFollowsCourse(m: { type: string; cfg?: object }): boolean {
  const cfg = m.cfg as { variant?: GlassVariant; curtainHeight?: number } | undefined
  if (m.type === 'glass') return !glassStandsOnFloor(glassModuleSpec(cfg?.variant, cfg?.curtainHeight as 2 | 3 | 4 | undefined))
  if (!m.type.startsWith('glass-')) return false
  return !glassStandsOnFloor(glassSpec(m.type.slice('glass-'.length) as GlassVariant))
}

/** A unit cell step as the side it names (`+y` is `n`, `+x` is `e`). */
function stepSide(dx: number, dy: number): WallSide {
  if (dx > 0) return 'e'
  if (dx < 0) return 'w'
  return dy > 0 ? 'n' : 's'
}

/**
 * The floor cell a ceiling-hung piece (指示牌, 电视, 时钟, 监控) hangs over, from a
 * pointer hit anywhere on the storey: the floor, the ceiling slab overhead, or a
 * wall course between them. `place - cell` is the face normal (`pickCells`), so:
 *
 *   * bottom face (`dz === -1`) — the underside of the ceiling slab — anchors one
 *     storey down (`cell.z - 4`), the floor that slab is the ceiling of;
 *   * top face (`dz === +1`) — a floor top — anchors the hit cell itself;
 *   * side face — a wall course or a slab edge — anchors the face-adjacent cell,
 *     dropped to its own storey floor (`storeyBand`), the same floor a wall panel
 *     takes from the same hover (`wallMountStandCell`).
 *
 * On a bottom-face hit, the nearest exposed floor in that column wins, even when
 * the ceiling span is taller than one storey. Hovering void (the work plane)
 * already names the floor, so it passes through. The caller checks
 * `ceilingMountMissing` for the slab above the anchor.
 */
export function ceilingMountStandCell(
  cell: readonly [number, number, number],
  place: readonly [number, number, number],
  levelBase = 0,
  cells?: readonly Cell[],
): [number, number, number] {
  const dz = place[2] - cell[2]
  if (dz === -1) {
    const floorCells = cells ?? []
    const floor = floorCells
      .filter((c) => c.fill === 'solid' && c.x === cell[0] && c.y === cell[1] && c.z < cell[2] && !isWallBlock(c))
      .filter((c) => !floorCells.some((above) => above.fill === 'solid' && above.x === c.x && above.y === c.y && above.z === c.z + 1))
      .sort((a, b) => b.z - a.z)[0]
    return [cell[0], cell[1], floor?.z ?? storeyBand(cell[2] - 1, levelBase)]
  }
  if (dz === 1) return [cell[0], cell[1], cell[2]]
  return [place[0], place[1], storeyBand(place[2], levelBase)]
}

/**
 * The cell a **hung** piece takes from the pointer's hit: the free cell directly under the **top
 * block** of that column — the block below the ceiling — which is where a hanging item always
 * lives, `top block - 1`, whether the pointer is on the floor, on a wall course between them or on
 * the slab's own underside. `place` names the column for a side face, so a board hangs in front of
 * the wall it was aimed at.
 *
 * Nothing solid over the pointer (an open hall, a doorway) leaves the storey's own floor, and
 * `ceilingMountMissing` decides the piece from there: a hung item with no ceiling is refused.
 */
export function hungCeilingAim(
  cell: readonly [number, number, number],
  place: readonly [number, number, number],
  levelBase = 0,
  cells: readonly Cell[] = [],
): [number, number, number] {
  const side = place[0] !== cell[0] || place[1] !== cell[1]
  const x = side ? place[0] : cell[0]
  const y = side ? place[1] : cell[1]
  // Only a **slab's own underside** aimed at can be the ceiling itself; every other hit looks above
  // the block the pointer is on, so a wall's course and a floor slab are never mistaken for one.
  const from = !side && place[2] < cell[2] ? cell[2] : cell[2] + 1
  const top = topBlockZ(cells, cell[0], cell[1], from)
  if (top === null) return [x, y, storeyBand(cell[2], levelBase)]
  return [x, y, top - 1]
}

/**
 * The **ceiling** of the space a pointer is in: the lowest solid cell of a column at or above
 * `from` whose own cell below it is open air — the first **underside** overhead. A wall's own
 * courses are skipped, each sitting on another course, so aiming anywhere on a wall that reaches
 * the slab still finds the slab; a column with nothing overhead reads `null`.
 */
export function topBlockZ(cells: readonly Cell[], x: number, y: number, from: number): number | null {
  let top: number | null = null
  for (const c of cells) {
    if (c.fill !== 'solid' || c.x !== x || c.y !== y || c.z < from) continue
    if (top !== null && c.z >= top) continue
    if (cells.some((b) => b.fill === 'solid' && b.x === x && b.y === y && b.z === c.z - 1)) continue
    top = c.z
  }
  return top
}

/**
 * True when a solid cell sits **directly over** the piece's own cell — the top block a hung piece
 * hangs from when it was aimed at a column (`hungCeilingAim`). Such a piece needs no storey slab:
 * the block over it *is* its ceiling.
 */
export function topBlockOver(cells: readonly Cell[], m: { x: number; y: number; z: number }): boolean {
  return cells.some((c) => c.fill === 'solid' && c.x === m.x && c.y === m.y && c.z === m.z + 1)
}

/**
 * The local height — above the cell's own floor top — of the surface a **hung** piece hangs from.
 *
 * A piece aimed at a column takes the free cell under that column's **top block**
 * (`hungCeilingAim`), so the block over it *is* its ceiling and the mount sits at the cell's own
 * top: local zero, with the body hanging the short drop the piece's model gives it — which is what
 * puts a 指示牌's board just under the slab and lets it hug a taller room.
 *
 * A piece anchored on a floor instead — an older save, a hall whose only ceiling is the street
 * plane — reads the real slab overhead (`ceilingMountHeight`), and `fallback` covers a build with
 * no slab to read at all (a ghost in an empty station).
 */
export function hangCeilingLocal(m: Module, cells: readonly Cell[], modules: readonly Module[] = [], fallback = 3): number {
  if (topBlockOver(cells, m)) return 0
  return ceilingMountHeight(cells, m, modules) ?? fallback
}

/**
 * True when a wall-mounted decoration has no wall behind it. Every cell of the run
 * needs its own backing — three cells wide needs three — and so does **every
 * course the panel crosses** (`wallMountCourses`): a poster wants the first metre
 * of its wall, a 2 m 玻璃板 the first two, and a 竖排 inscription the band its column
 * climbs, so a wall that stops after one metre carries the poster and refuses the
 * glass. Auto walls and the 墙 tool both lay four courses from the floor's top,
 * which is why a plainly built wall backs every one of them.
 *
 * A **半墙** is only a wall on the half of its cell it keeps: its face on the far
 * side is half a block away, so a panel bolted there would hang in mid-air. The
 * backing therefore has to keep the half that faces the panel — which is a
 * function of the panel's own `rot`, like everything else about the mount, so
 * `autofaceWallMount` can simply turn the piece to a side that really backs it.
 */
export function wallMountMissing(cells: readonly Cell[], candidate: Module, modules: readonly Module[] = []): boolean {
  if (!isWallMounted(candidate)) return false
  if (candidate.type === 'sign' && candidate.cfg.boothId) {
    return !modules.some((m) => boothSupportsSign(m, candidate))
  }
  const [dx, dy] = wallSide(candidate.rot)
  // The half of the backing cell the panel's own back plane touches.
  const needed = stepSide(-dx, -dy)
  for (const course of wallMountCourses(candidate)) {
    const nz = candidate.type === 'exit' && candidate.cfg.style === 'doorway'
      ? candidate.cfg.mountZ ?? candidate.z + 1 + course
      : candidate.z + 1 + course
    for (const [bx, by] of baseCells(candidate)) {
      const back = cells.find((c) => c.fill === 'solid' && c.x === bx + dx && c.y === by + dy && c.z === nz)
      // The 地面 exit is a shallow sign on the face of any solid 1 m block.
      // Its support is only the existence of that block, not wall tags or half-wall facing.
      if (candidate.type === 'exit' && candidate.cfg.style === 'doorway') {
        if (back === undefined) return true
        continue
      }
      // A wall course at street level may be backed by the virtual street
      // itself — the slab edge the panel bolts to — unless it is a dug hole.
      if (back === undefined && (nz !== GROUND_Z || groundHoleAt(cells, modules, bx + dx, by + dy))) return true
      if (back === undefined) continue
      const side = halfWallSide(back)
      if (side !== null && side !== needed) return true
    }
  }
  return false
}

/**
 * The same module turned to face a wall it can actually hang on — the piece's
 * orientation is an **output** of the wall, never an input the player must get
 * right first (the mirror of the 墙 tool's snap in `build/model.ts`).
 *
 * `wallMountMissing` already reduces "which way does it hang?" to `rot` alone, so
 * the orientation is not a free choice: a panel bolted flat to a wall faces that
 * wall and nothing else. Which wall, then, when the tile has two of them?
 *
 * **The camera answers** (`facing`, the piece-to-eye step `moduleAt` also takes, so
 * the look direction is its opposite): the wall the player can see is the wall they
 * mean. A piece that already carries a turn fitting a wall does not get to hide the
 * other one — the pointer cannot tell them apart (hovering a wall face puts the hit
 * anywhere along it, and the neighbour beside the piece won every time), so the view
 * decides and the orbit is the way to choose. The carried turn still settles a view
 * that cannot tell two walls apart (a corner met square on), the pointer's own hit
 * point (`near`) settles that, and the rotation order settles the last tie — so the
 * aim is a ranking, stable rather than flickering between two walls, and a caller
 * with no camera at all (a head-less tool, a test) keeps the old behaviour.
 *
 * The one mount the view may not re-aim is one the player bolted to a **named piece
 * of the document**: a board on a booth header, and a 地面出入口 whose own
 * `cfg.mountZ` names the course its block face is on. Those are the caller's to keep
 * (see `EquipmentTool.wallMountPlacement`), because the camera can see the block but
 * cannot know which one the pointer clicked.
 *
 * Returns the module unchanged when it is not wall-mounted, or when no direction
 * has backing at all — that case is a genuine refusal, and
 * `wallMountMissing` reports it rather than being papered over here.
 */
export function autofaceWallMount(cells: readonly Cell[], candidate: Module, near?: readonly [number, number], modules: readonly Module[] = [], facing?: readonly [number, number]): Module {
  if (!isWallMounted(candidate)) return candidate
  if (candidate.type === 'sign' && candidate.cfg.boothId) return candidate

  const [bx, by] = baseCells(candidate)[0] ?? [candidate.x, candidate.y]
  // The camera's own look direction, in world space: `facing` is the step from the
  // piece to the eye, so the view looks the other way (see `render/pickFacing.ts`).
  const lookX = facing ? -facing[0] : 0
  const lookY = facing ? -facing[1] : 0
  // `wallSide` is the wall step for a given rot, so inverting it is the whole
  // search: rot 0 → −y, 1 → +x, 2 → +y, 3 → −x.
  const options: Array<{ rot: number; d: number; aim: number; held: number }> = []
  for (let rot = 0; rot < 4; rot++) {
    // A direction only counts as a wall when **every** cell of the run and every
    // course the panel crosses is really backed — the refusal's own verdict, so a
    // 半墙 facing the other way is not a wall here either and the turn this picks
    // is a turn that hangs.
    if (wallMountMissing(cells, { ...candidate, rot }, modules)) continue
    const [dx, dy] = wallSide(rot)
    const d = near === undefined ? 0 : Math.abs(bx + dx - near[0]) + Math.abs(by + dy - near[1])
    // How squarely the camera looks at that wall: the wall behind the piece — the
    // one whose face the player is looking at — is the one the view points *into*.
    options.push({
      rot,
      d,
      aim: dx * lookX + dy * lookY,
      held: rot === (candidate.rot ?? 0) ? 1 : 0,
    })
  }
  if (options.length === 0) return candidate

  options.sort((a, b) => b.aim - a.aim || b.held - a.held || a.d - b.d || a.rot - b.rot)
  return { ...candidate, rot: options[0].rot }
}

/* ------------------------------------------------------ ceiling-hung decor */

/**
 * True when a **hanging** decoration (a 指示牌 on its ceiling mount, a 电视, a 时钟 or a
 * 监控) has no ceiling above it. The ceiling is the nearest common slab over its
 * footprint, wherever that slab sits: the suspension rods bolt to it. A piece with
 * nothing overhead has nowhere to hang, so the
 * builder refuses it. A **wall** 指示牌 is bolted instead of hung and asks for backing
 * (`wallMountMissing`), and wall-mounted and floor-standing modules are never refused
 * here either.
 *
 * Every cell of the piece needs a slab at the same height, asked through `baseCells`
 * so a future multi-cell hung fitting is covered rather than only its anchor.
 */
export function ceilingMountMissing(cells: readonly Cell[], candidate: Module, modules: readonly Module[] = []): boolean {
  if (candidate.type === 'hanger') return hangerRoofMissing(cells, modules, candidate)
  if (!isCeilingHung(candidate)) return false
  // A piece hung under a **top block** (`hungCeilingAim`) hangs from that block, one cell over it,
  // so the storey-slab rule below does not apply to it.
  if (topBlockOver(cells, candidate)) return false
  if (modules.some((m) => hangerSupports(m, candidate))) return false
  return ceilingMountHeight(cells, candidate, modules) === null
}

/**
 * Local height from a module's floor top to the underside of its actual ceiling.
 * Read the nearest common slab over the whole footprint instead of assuming a
 * fixed 4 m room; the model uses this to extend its suspension up to that slab.
 */
export function ceilingMountHeight(cells: readonly Cell[], candidate: Module, modules: readonly Module[] = []): number | null {
  if (!isCeilingHung(candidate)) return null
  if (modules.some((m) => hangerSupports(m, candidate))) return 3
  const footprint = baseCells(candidate)
  const [firstX, firstY] = footprint[0] ?? [candidate.x, candidate.y]
  const candidates = new Set(cells
    // The first three courses above a floor are a wall, not a ceiling slab.
    .filter((c) => c.fill === 'solid' && c.x === firstX && c.y === firstY && c.z >= candidate.z + 4)
    .map((c) => c.z))
  // The street plane can ceiling the storey immediately below grade, but it
  // cannot stand in for a missing concourse slab several storeys underground.
  if (virtualSolidAt(cells, modules, firstX, firstY, GROUND_Z) && GROUND_Z === candidate.z + 4) candidates.add(GROUND_Z)
  const ceilingZ = [...candidates].sort((a, b) => a - b).find((z) =>
    footprint.every(([x, y]) =>
      cells.some((c) => c.fill === 'solid' && c.x === x && c.y === y && c.z === z) ||
      virtualSolidAt(cells, modules, x, y, z),
    ),
  )
  return ceilingZ === undefined ? null : ceilingZ - candidate.z - 1
}

/** Strict overlap, so modules in adjacent cells (a gate line) do not collide. */
export function boxesOverlap(a: ModuleBox, b: ModuleBox): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0 && a.z0 < b.z1 && a.z1 > b.z0
}

/**
 * Which of a fence cell's four same-level sides hold something its panel meets —
 * the placement-side mirror of the renderer's neighbour read (`FenceModel`): an
 * adjacent 围栏, a 闸机 on its machine side (`gateSolidFaces`), or a stair /
 * escalator landing whose handrail the run butts into (`railLandingAt`). Glass
 * never counts: it stands on the tile edge, not in the run.
 */
function fenceNeighbourFlags(modules: readonly Module[], fence: Module): FenceNeighbours {
  const joined = (x: number, y: number): boolean => {
    for (const m of modules) {
      if (m.z !== fence.z || m.id === fence.id || m.x !== x || m.y !== y) continue
      if (m.type === 'fence') return true
      if (m.type === 'gate' && gateSolidFaces(m, fence.x - x, fence.y - y)) return true
    }
    return railLandingAt(modules, x, y, fence.z)
  }
  return { e: joined(fence.x + 1, fence.y), w: joined(fence.x - 1, fence.y), n: joined(fence.x, fence.y + 1), s: joined(fence.x, fence.y - 1) }
}

/**
 * The thin boxes a fence really draws in its cell, one per arm `fenceArms`
 * describes — the same arms the renderer builds, at the same half-thickness the
 * envelope reserves (0.45–0.55). A lone or straight run is exactly its envelope;
 * an L / T / + junction is only the halves it reaches, so a 玻璃板 on a side no
 * arm touches is parallel clearance, not a crossing.
 */
function fenceArmBoxes(fence: Module, nb: FenceNeighbours): ModuleBox[] {
  const arms = fenceArms(fence.rot, nb)
  const cx = fence.x + 0.5
  const cy = fence.y + 0.5
  const z0 = fence.z + 1
  const z1 = z0 + FLAT_HEIGHT.fence
  const t = 0.05
  const out: ModuleBox[] = []
  if (arms.x1 > arms.x0) out.push({ x0: cx + arms.x0, x1: cx + arms.x1, y0: cy - t, y1: cy + t, z0, z1 })
  if (arms.y1 > arms.y0) out.push({ x0: cx - t, x1: cx + t, y0: cy + arms.y0, y1: cy + arms.y1, z0, z1 })
  return out
}

/** True for a 围栏↔玻璃板 pair, in either order. */
function isFenceGlassPair(a: Module, b: Module): boolean {
  return (a.type === 'fence' && b.type === 'glass') || (a.type === 'glass' && b.type === 'fence')
}

/**
 * True when a fence and a glass panel in one verdict share space — asked of the
 * arms the fence draws rather than of its full-cell envelope, so a panel on the
 * edge of a turning cell co-exists with the run unless an arm really pierces it.
 * `sources` is the neighbour list the fence reads: placed modules for a placed
 * fence, placed-minus-origin for a lifted or fresh candidate.
 */
function fenceGlassBlocked(sources: readonly Module[], fence: Module, glass: Module): boolean {
  const g = moduleEnvelope(glass)
  if (!g) return false
  const nb = fenceNeighbourFlags(sources, fence)
  return fenceArmBoxes(fence, nb).some((a) => boxesOverlap(a, g))
}

/** A floor-standing 玻璃幕墙 shares its tile with a 围栏; their frames meet at the crossing. */
function fenceCurtainShareTile(fence: Module, glass: Module): boolean {
  if (fence.type !== 'fence' || glass.type !== 'glass' || fence.z !== glass.z) return false
  if (!glassStandsOnFloor(glassModuleSpec(glass.cfg?.variant, glass.cfg?.curtainHeight))) return false
  return glassCells(glass).some(([x, y]) => fence.x === x && fence.y === y)
}

/**
 * Every cell a module **stands in**: its own base cells (a room's whole plan, a
 * rail's bed, a bench's run) plus its anchor — the single cell every other piece
 * is dropped on. A **run** is the exception, and deliberately so: only its two
 * landings are floor it stands on, and those are exactly the cells `reservedOpening`
 * already protects, so a run is named by its anchor alone. Asking `baseCells` about
 * a 楼梯 or 扶梯 would walk the whole flight and answer with the run's own corridor.
 */
function occupyingCells(m: Module): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [[m.x, m.y, m.z]]
  for (const [x, y] of baseCells(m)) if (x !== m.x || y !== m.y) out.push([x, y, m.z])
  return out
}

/**
 * The two pieces whose cells a block rule leaves to the rule that owns them.
 *
 * A rail **digs** its bed, so its cells are void rather than blocks and
 * `isTrackCell` refuses them either way — but its envelope is a car-width bed of
 * three cells, and reading that as "occupied" would make the 方块 drag refuse the
 * platform strip beside the rails, which is exactly where the floor has to be laid.
 * A **站台门** is derived from that rail and stands on the same strip, and the wall
 * ring already knows not to rise through it (`platformDoorKeys`).
 *
 * A **run** is here for the same reason one storey up: its two landings are floor
 * the crowd stands on and the ground under its slope is the filling §5.1 says the
 * block brush is *for*, while the corridor between them is `reservedOpening`'s
 * answer — asked of the carve, which is the rule that really draws the opening.
 */
const RUN_OR_RAIL: ReadonlySet<string> = new Set(['stair', 'escalator', 'lift', 'platform-edge', 'track'])

/**
 * The cells a **block** may not be built in, at `z` exactly: every cell a placed
 * module stands in, and the first storey of the column a flat piece fills above it
 * — a 闸机, a 售票机, a 座椅, a 货架, a 广告牌 on its wall, a 房间's whole plan, and a
 * hung 指示牌's own ceiling column.
 *
 * `reservedOpening` covers the ramp carve (from the walking line **up**) and the
 * floor a head-house lays, but nothing covered the rest: `placementBlocked` only
 * ever compares two *modules*, so the block brush had no way to see the equipment
 * already standing in the cell it was about to pour a block into. This is that
 * rule — a block and a piece never share a cell.
 *
 * A **run**, a rail and the screen doors beside it are left to `RUN_OR_RAIL`'s own
 * rules; everything else claims its cell and the column above it.
 */
export function moduleBlockedCells(modules: readonly Module[], z: number): Set<string> {
  const out = new Set<string>()
  for (const m of modules) {
    if (RUN_OR_RAIL.has(m.type) && !(m.type === 'stair' && m.cfg.block)) continue
    if (m.type === 'hanger') {
      for (const box of hangerBoxes(m)) {
        if (box.z1 <= z || box.z0 >= z + 1) continue
        for (let x = Math.floor(box.x0); x < Math.ceil(box.x1); x++) {
          for (let y = Math.floor(box.y0); y < Math.ceil(box.y1); y++) out.add(`${x},${y},${z}`)
        }
      }
      continue
    }
    for (const [x, y, mz] of occupyingCells(m)) if (mz === z) out.add(`${x},${y},${z}`)
    const e = moduleEnvelope(m)
    // A module with no envelope reserves nothing — its own cell is already in the
    // set above, and it lays no block column either.
    if (e && e.z1 > z && e.z0 < z + 1) {
      for (let x = Math.floor(e.x0); x < Math.ceil(e.x1); x++) {
        for (let y = Math.floor(e.y0); y < Math.ceil(e.y1); y++) out.add(`${x},${y},${z}`)
      }
    }
  }
  return out
}

/**
 * `moduleBlockedCells` for a whole drag, cached per level. A wall ring asks about
 * one level at a time (`plannedAutoWalls`, `syncAutoWalls`), a floor patch and its
 * live ghost ask about one, and a block rectangle may span several — so the set is
 * built once per level asked about rather than once per cell. The returned map is
 * the caller's own scratch space; the sets in it are not to be mutated.
 */
export function blockedCellsByLevel(modules: readonly Module[]): (z: number) => Set<string> {
  const byLevel = new Map<number, Set<string>>()
  return (z: number): Set<string> => {
    let s = byLevel.get(z)
    if (s === undefined) {
      s = moduleBlockedCells(modules, z)
      byLevel.set(z, s)
    }
    return s
  }
}

/** Why a cell refuses a block. */
export type BlockRefusal = 'opening' | 'equipment' | 'track'

/** A block candidate's verdict: whether it may be laid, and what refuses it. */
export interface BlockCheck {
  cell: [number, number, number]
  ok: boolean
  reason: BlockRefusal | ''
  /** The placed pieces that fired the refusal — for a preview's red boxes. */
  blockers: Module[]
}

/**
 * May a **block** be laid at `(x, y, z)`, and what refuses it? The same three rules
 * the release applies, in the order it applies them:
 *
 *   1. `opening`   — a reserved opening: the corridor a 楼梯 / 扶梯 / 电梯 carves from
 *      its walking line up, or the floor an 出入口 head-house lays. A block there
 *      would seal a run the player can see through.
 *   2. `equipment` — a piece already stands in the cell (`moduleBlockedCells`): the
 *      column a 闸机 / 售票机 / 座椅 fills, a 房间's plan, a hung 指示牌's own column.
 *      A block and a piece never share a cell.
 *   3. `track`     — a rail's dug bed or the `floor.track` finish: covered ground,
 *      built on by neither.
 *
 * `blockers` is the equipment that fired rule 2, found by the piece's **own**
 * footprint rather than by its reservation, so a stair over the cell is in the way
 * and the ground under its slope is not.
 */
export function blockReason(
  cells: readonly Cell[],
  modules: readonly Module[],
  x: number,
  y: number,
  z: number,
  level?: ((z: number) => Set<string>) | BlockIndex,
): BlockCheck {
  const cell: [number, number, number] = [x, y, z]
  const index = level && 'opening' in level ? level : undefined
  if (index ? index.opening(x, y, z) : reservedOpening(modules, x, y, z)) return { cell, ok: false, reason: 'opening', blockers: [] }
  const occupied = (level ?? blockedCellsByLevel(modules))(z)
  if (occupied.has(`${x},${y},${z}`)) return { cell, ok: false, reason: 'equipment', blockers: equipmentBlockingCell(modules, x, y, z) }
  if (index ? index.track.has(`${x},${y},${z}`) : isTrackCell(cells, modules, x, y, z)) return { cell, ok: false, reason: 'track', blockers: [] }
  return { cell, ok: true, reason: '', blockers: [] }
}

/**
 * Every piece standing in cell `(x, y, z)` — the pieces a refused block check names.
 * Asked through the modules rather than through the occupancy set, because the set
 * answers with a cell key and a preview needs the object: the collision highlight
 * boxes a module group by id, and a notice names the piece.
 */
export function equipmentBlockingCell(modules: readonly Module[], x: number, y: number, z: number): Module[] {
  const out: Module[] = []
  const occupied = moduleBlockedCells(modules, z)
  if (!occupied.has(`${x},${y},${z}`)) return out
  // The 1 m box of the block the cell would hold, in world space.
  const box: ModuleBox = { x0: x, y0: y, z0: z, x1: x + 1, y1: y + 1, z1: z + 1 }
  for (const m of modules) {
    if (m.type === 'hanger') {
      if (hangerBoxes(m).some((b) => boxesOverlap(b, box))) out.push(m)
      continue
    }
    // The piece's own space, **not** its anchor's z: a 闸机 dropped on the floor at
    // z stands in the column above it (`m.z + 1` and up), and a run reaches the
    // storeys it climbs through. Asking `m.z === z` would find only the piece
    // dropped on this very course and miss every piece standing on the one below.
    // A stair is only its slope (`rampBodyBoxes`), never the vertical column
    // beneath it — otherwise every block under its upper half names it.
    if (m.type === 'stair' && !m.cfg.block) {
      if (rampBodyBoxes(m).some((b) => boxesOverlap(b, box))) out.push(m)
      continue
    }
    const e = moduleEnvelope(m)
    if (e && boxesOverlap(e, box)) out.push(m)
  }
  return out
}

/**
 * True when a candidate module would share space with one already placed — the
 * rule the builder enforces before it commits a placement. A module never
 * conflicts with itself (matched by id), so re-checking is safe.
 *
 * An exit is a special case: stairs and escalators may pass through it, so an
 * exit ↔ stair/escalator overlap never blocks placement. Everything else must
 * keep out of each other's boxes — which is enough for a bank of runs, because a
 * run is built to fit inside one tile: two runs in adjacent cells reserve
 * adjacent (touching, not overlapping) boxes, so escalators and stairs stand
 * flush without a special case, and a wall, fence or gate may be built right up
 * against a run the same way (a fence drawn up to a landing still butts onto its
 * handrail in the renderer, which reads the neighbours rather than this rule). A
 * 1.6 m stair is the exception that proves it: its body crosses into the next
 * cell, so it still collides with whatever is there.
 *
 * A **run** (a stair or an escalator) is measured against flat equipment by the
 * body it draws (`collisionBoxes` → `rampBodyBoxes`), not by its reservation: the
 * body is the slope the run sweeps, tile by tile, so a stair's landing tiles — the
 * treads stop at their edge — and any slab a flight climbs *underneath* are floor a
 * 围栏, a gate or a bench may stand on. Stairs and escalators use that same slope
 * even against another run, so an escalator does not reserve the vertical column
 * above its lower section. Their actual body volumes still collide where they overlap.
 *
 * A shelf or desk is the other exception: room furniture, so it may stand
 * inside a walled room or booth (either side of the pair may be the
 * candidate).
 *
 * The one cell-sharing exemption that is **not** a pair of different kinds is the
 * back-to-back 电视 (`sim/tvs.ts`): two screens facing opposite ways on one tile
 * are one object — a single housing with a lit face each side — so they share the
 * cell deliberately. Only that arrangement is exempt; two 电视 a quarter-turn
 * apart would cross inside the block, and two facing the same way would duplicate a
 * panel, so both still collide.
 *
 * A **ceiling-hung** piece — a hanging 指示牌, a 电视, a 时钟, a 监控 — is the other one,
 * and for a different reason: it hangs from the slab overhead, so the air under it
 * belongs to the room, not to the fitting. A chair on the floor, a poster on the back
 * wall and a clock on the ceiling are three pieces in three different places, and they
 * share a tile in a real station. A hung piece therefore ignores every flat piece
 * (floor-standing, wall-mounted, a room, a rail) and every such piece ignores it;
 * it still collides with another hung piece, because those really do want the same
 * air, and with a **run** — a 楼梯 / 扶梯 / 电梯 shaft passes through the storey the
 * piece hangs in and its headroom is not negotiable. A **wall** 指示牌 is not hung and
 * takes no part in this: it is a panel on a wall, and the boxes say so.
 *
 * A **wall-mounted** 广告牌 is the same idea one step lower: `flatEnvelope` gives it
 * the band of wall it really covers rather than the cell it hangs over, so a 座椅 on
 * the floor under it, or a 时钟 over it, is not in its way — while a 售票机 tall enough
 * to reach the panel still is. The **wall** 指示牌 is measured exactly the same way.
 * Nothing is exempted by hand: the boxes decide.
 */
export function placementBlocked(modules: readonly Module[], candidate: Module): boolean {
  return placementColliders(modules, candidate).length > 0
}

/**
 * Every placed module the candidate would share space with — the offending
 * pieces a blocked preview collides with. Same rule as `placementBlocked`,
 * but returns the modules instead of a boolean so the builder can highlight
 * them alongside the red ghost (§9.5).
 */
export function placementColliders(modules: readonly Module[], candidate: Module): Module[] {
  const out: Module[] = []
  const c = moduleEnvelope(candidate)
  if (!c) return out
  for (const m of modules) {
    if (m === candidate || (candidate.id && m.id === candidate.id)) continue
    if (boothSupportsSign(m, candidate) || boothSupportsSign(candidate, m)) continue
    if (hangerSupports(m, candidate) || hangerSupports(candidate, m)) continue
    // The thin support is intentionally allowed to pass through a trussed roof.
    // Its narrow shaft can share the roof volume without changing either piece.
    if ((m.type === 'pillar' && m.cfg.size === 'slim' && candidate.type === 'roof' && candidate.cfg.variant)
      || (candidate.type === 'pillar' && candidate.cfg.size === 'slim' && m.type === 'roof' && m.cfg.variant)) continue
    if (pillarSupportsBridge(m, candidate) || pillarSupportsBridge(candidate, m)) continue
    if (isExitRampPair(m, candidate)) continue
    if (isFurnitureRoomPair(m, candidate)) continue
    // Floor vinyl can run along a screen-door strip; the glass stands above it (§9.5).
    if ((isFloorSticker(m) && candidate.type === 'platform-edge') || (isFloorSticker(candidate) && m.type === 'platform-edge')) continue
    // The gate leaf clears the pavement (§5.2): tactile tiles and floor vinyl
    // fit underneath in either placement order, while other equipment still collides.
    if ((isFloorSticker(m) && candidate.type === 'fence' && candidate.cfg.variant === 'gate')
      || (isFloorSticker(candidate) && m.type === 'fence' && m.cfg.variant === 'gate')) continue
    if (isPsdCornerPair(m, candidate) || isPsdEndJoin(m, candidate)) continue
    if (isTvPair(m, candidate)) continue
    if (isHangingShare(m, candidate)) continue
    if (curtainDoorShare(m, candidate)) continue
    if (m.type === 'glass' && candidate.type === 'glass' && curtainShareCrossTile(m, candidate)) continue
    // A station-side 广告牌 can sit on the wall behind the platform screen doors.
    // Their coarse envelopes overlap in height, but the poster is mounted at the
    // back wall while the doors occupy the track edge; they are separated across
    // the platform and must coexist.
    if ((m.type === 'billboard' && candidate.type === 'platform-edge')
      || (candidate.type === 'billboard' && m.type === 'platform-edge')) continue
    // A 围栏 meets a 玻璃板 arm to edge-strip, not envelope to strip: a panel on
    // the edge of a turning cell shares the tile unless an arm pierces it.
    if (isFenceGlassPair(m, candidate)) {
      const fence = m.type === 'fence' ? m : candidate
      const glass = m.type === 'fence' ? candidate : m
      // On a shared curtain tile the crossing is the intended frame connection.
      if (fenceCurtainShareTile(fence, glass)) continue
      const sources = fence === candidate ? modules.filter((s) => s.id !== fence.id) : modules
      if (fenceGlassBlocked(sources, fence, glass)) out.push(m)
      continue
    }
    const e = moduleEnvelope(m)
    if (!e) continue
    let hit = false
    for (const a of collisionBoxes(candidate, c)) {
      if (hit) break
      for (const b of collisionBoxes(m, e)) {
        if (boxesOverlap(a, b)) {
          hit = true
          break
        }
      }
    }
    if (hit) out.push(m)
  }
  // A fresh fence can turn a placed one toward placed glass: the run it joins
  // grows a new arm, and that arm may pierce a panel the old run cleared. Read
  // the neighbours as they will be after the commit (the lifted origin excluded,
  // the candidate included) so both build orders answer alike.
  if (candidate.type === 'fence') {
    const glasses = modules.filter((m) => m.type === 'glass' && m.id !== candidate.id)
    if (glasses.length > 0) {
      const after = [...modules.filter((m) => m.id !== candidate.id), candidate]
      for (const m of modules) {
        if (m.type !== 'fence' || m.id === candidate.id || out.includes(m)) continue
        if (m.z !== candidate.z || Math.abs(m.x - candidate.x) + Math.abs(m.y - candidate.y) !== 1) continue
        if (glasses.some((g) => fenceGlassBlocked(after, m, g))) out.push(m)
      }
    }
  }
  return out
}

/**
 * A **ceiling-hung** piece and any flat one share a tile: the hung piece is up
 * under the slab and the flat piece is on the floor or against the wall, so one
 * column of air holds both and neither is in the other's way. Either side of the
 * pair may be the candidate, so the test asks about both.
 *
 * The exemption stops at a **run**: a stair's treads, an escalator's step band or
 * a lift's shaft passes through that same storey, and a 指示牌 hung into its
 * headroom is a sign nobody can walk under. Hanging the two 电视 back to back is
 * still its own arrangement (`isTvPair`), and two hung pieces still want the same
 * air, so neither pair is let through here.
 */
function isHangingShare(a: Module, b: Module): boolean {
  if (a.type === 'hanger' || b.type === 'hanger') return false
  const hung = isCeilingHung(a) ? a : isCeilingHung(b) ? b : null
  if (hung === null) return false
  if (a.type === 'light' || b.type === 'light' || a.type === 'vent' || b.type === 'vent') return false
  const other = hung === a ? b : a
  return !isCeilingHung(other) && !isRunPiece(other)
}

/**
 * The volume one side of a pair is tested with. Normally the module's own
 * envelope; but a run facing a **flat** piece is reduced to the body it draws
 * (`rampBodyBoxes`), because a run only fills the slope it sweeps: a stair's
 * landing tiles hold no tread at all — the flight stops at their edge — and a slab
 * a flight climbs *underneath* keeps its headroom. A fence that guards the head of
 * a well, or stands on the floor over the low half of the flight, is exactly that.
 *
 * The pairing stays symmetric: whichever piece was placed first, the question is
 * the same one. A stair or escalator uses its slope even against another run, so
 * the space beneath an elevated section stays free. A run the box list cannot
 * measure falls back to its envelope, so a degenerate piece is never read as clear
 * space.
 */
function collisionBoxes(m: Module, envelope: ModuleBox): ModuleBox[] {
  if (m.type === 'hanger') return hangerBoxes(m)
  if (!isRampRun(m)) return [envelope]
  // Stairs and escalators occupy their per-tile body slope, even against another
  // run. This leaves the space below an elevated section free while preserving
  // collisions where the actual bodies or landings overlap.
  const body = rampBodyBoxes(m)
  return body.length > 0 ? body : [envelope]
}

/** A run whose body is the slope it sweeps: a stair or an escalator. */
function isRampRun(m: Module): boolean {
  return (m.type === 'stair' && !m.cfg.block) || m.type === 'escalator'
}

/** A piece whose own space is a run: a stair, an escalator or a lift shaft. */
function isRunPiece(m: Module): boolean {
  return m.type === 'stair' || m.type === 'escalator' || m.type === 'lift'
}

/**
 * An exit head-house may be crossed by a stair or escalator run: that pair is
 * allowed to share space. Anything else — exit vs exit, ramp vs ramp, ramp vs
 * flat equipment — still collides.
 */
function isExitRampPair(a: Module, b: Module): boolean {
  const isExit = (m: Module): boolean => m.type === 'exit'
  const isRamp = (m: Module): boolean => (m.type === 'stair' && !m.cfg.block) || m.type === 'escalator'
  return (isExit(a) && isRamp(b)) || (isExit(b) && isRamp(a))
}

/**
 * A shelf, desk, cubicle, sink, bench, bin or 灭火器箱 standing inside a walled
 * room or booth: that pair never collides, so room furniture can be arranged
 * (and re-arranged) after the room is drawn. The bin and the extinguisher are
 * room furniture in the ordinary sense — a shop or an office holds both — and
 * without this a room's envelope would refuse them its whole floor.
 */
function isFurnitureRoomPair(a: Module, b: Module): boolean {
  const isFurniture = (m: Module): boolean =>
    m.type === 'shelf' ||
    m.type === 'desk' ||
    m.type === 'checkout' ||
    m.type === 'cubicle' ||
    m.type === 'sink' ||
    m.type === 'bench' ||
    m.type === 'bin' ||
    m.type === 'extinguisher' || m.type === 'ac-unit' || m.type === 'electrical-cabinet' || isFloorSticker(m)
  const isRoom = (m: Module): boolean => m.type === 'shop' || m.type === 'booth' || m.type === 'retail'
  return (isFurniture(a) && isRoom(b)) || (isRoom(a) && isFurniture(b))
}

/**
 * Two 电视 set back to back on one tile, facing opposite ways: one housing with a
 * lit face each side, so the pair never collides however their envelopes overlap.
 * Everything else about a 电视 is unchanged — it still hangs from the ceiling over
 * its own cell (`ceilingMountMissing`) and still blocks a gate, a 指示牌 or a third
 * 电视 that is not its opposite number.
 */
function isTvPair(a: Module, b: Module): boolean {
  return a.type === 'tv' && b.type === 'tv' && tvBackToBack(a, b)
}

/**
 * The module standing on cell `(x, y, z)`, for right-click bulldozing. The test
 * volume is the **air of that cell's own storey** — from the block's top to the next
 * 4 m grid line — so a multi-cell module (an exit, a PSD run, a ramp) is found from
 * any of the cells it covers, and a wall-mounted panel is found from the floor cell
 * it hangs over even when its body is in the upper half of the room (a 广告牌 at
 * 1.4 m, a 站名 横排 at 2.5 m). A room's
 * envelope covers its whole floor, so furniture standing inside it is preferred:
 * the first pass skips walled rooms and booths, and only when nothing smaller
 * matches does the room itself answer.
 *
 * The one cell that can hold two pieces is a back-to-back 电视 pair, and there the
 * pair is one object seen from two sides: `facing` — the direction the caller is
 * looking from, in world space — picks the panel that is actually on screen, so a
 * click on either face bulldozes the 电视 the player is pointing at. Without a
 * direction (a caller that has no ray) the document's own order decides, as
 * everywhere else.
 */
export function moduleAt(
  modules: readonly Module[],
  x: number,
  y: number,
  z: number,
  facing?: readonly [number, number],
): Module | undefined {
  // The test volume is the **air of the cell's own storey**, not just the first
  // metre above its block: a 广告牌 hangs from 1.36 m up, but a 站名 横排 is written
  // at 2.5 m and a totem's board is above its plinth, and a piece whose body is
  // entirely in the upper half of the storey has to be found from the cell it
  // stands on like any other. The band stops at the next storey grid line
  // (`LEVEL_STEPS`), so a piece one floor up is still not this cell's.
  const ceiling = LEVEL_STEPS.find((v) => v > z) ?? z + 4
  const cell: ModuleBox = { x0: x, y0: y, z0: z + 1, x1: x + 1, y1: y + 1, z1: ceiling }
  const hits = (skipRooms: boolean): Module | undefined => {
    for (const m of modules) {
      if (skipRooms && (m.type === 'shop' || m.type === 'booth' || m.type === 'retail')) continue
      if (skipRooms && m.type === 'hanger') continue
      const e = moduleEnvelope(m)
      if (e && boxesOverlap(e, cell)) return m
    }
    return undefined
  }
  const found = hits(true) ?? hits(false)
  if (!found || found.type !== 'tv' || !facing) return found
  // The other screen on the same cell, when they are a pair: whoever looks back
  // along the caller's line of sight owns the face under the pointer.
  const mate = modules.find(
    (m): m is Extract<Module, { type: 'tv' }> =>
      m.type === 'tv' && m.id !== found.id && m.x === found.x && m.y === found.y && m.z === found.z && tvBackToBack(found, m),
  )
  if (!mate) return found
  const mine = tvFacing(found.rot)
  const theirs = tvFacing(mate.rot)
  const towards = (f: readonly [number, number]): number => f[0] * facing[0] + f[1] * facing[1]
  return towards(theirs) > towards(mine) ? mate : found
}

/**
 * The 支柱 standing on `(x, y)` under the pointer's own storey band, if any.
 * Both the extension hover and the release ask this, so what the ghost grows is
 * what the click grows.
 *
 * A pillar's own shaft is thin, but a turning stair's `rampEnvelope` spans the
 * whole corner it turns through — so a generic `moduleAt` at the pillar's own
 * cell finds the stair first whenever the stair is earlier in the document, and
 * the extension snap never fires. The anchor cell is the pillar's own, so it
 * decides before the envelope overlap does; the band test is `moduleAt`'s own,
 * read off the pillar's drawn envelope.
 */
export function pillarAt(
  modules: readonly Module[],
  x: number,
  y: number,
  z: number,
): Extract<Module, { type: 'pillar' }> | undefined {
  const ceiling = LEVEL_STEPS.find((v) => v > z) ?? z + 4
  const cell: ModuleBox = { x0: x, y0: y, z0: z + 1, x1: x + 1, y1: y + 1, z1: ceiling }
  return modules.find(
    (m): m is Extract<Module, { type: 'pillar' }> => {
      if (m.type !== 'pillar' || m.x !== x || m.y !== y) return false
      const e = moduleEnvelope(m)
      return !!e && boxesOverlap(e, cell)
    },
  )
}

/* -------------------------------------------------------- moving a piece */

/**
 * The equipment and decoration pieces the 移动 tool may lift, plus the 出入口
 * head-house and the two **runs** — a 楼梯 and a 扶梯.
 *
 * An exit has a live footprint derived from its position, so moving one carries its
 * floor pad with it without leaving carved cells behind. A run is the piece whose own
 * **cells** are the document's: a turning stair lays its half-landing floor when it is
 * placed and takes it back out when it goes (`addEquipment` / `removeModule`), and both
 * kinds carve the opening they climb through. A 移动 of one is therefore a **teardown and
 * a rebuild** (`moveRebuilds`, driven by `moveEquipment` in `build/model/Equipment.ts`) —
 * the very pair of calls a player would make by hand — and its `from`/`to` are world cells
 * of their own, so `movedModule` re-lays those too. Without both, a run would arrive
 * drawn, carved and walked at the cell it came from.
 *
 * The other structural pieces are refused, by the same rule that keeps the delete tool
 * from sweeping one (§9.5): a room owns the walls around it, a 轨道 / 站台门 is sized and
 * derived from its line, a bridge-owned pier (`cfg.bridgeId`) is spaced by its bridge,
 * and a 电梯's landings are grown a storey at a time (`LIFT_EXTEND`
 * never asks for floor), so no single verdict can say where a moved shaft lands. Those
 * are torn down and built again by hand.
 *
 * A free-standing 支柱 is the exception: it owns no document cells, carves nothing
 * and derives nothing, so a 移动 is a plain translation (`movedModule`'s default
 * branch) re-checked by `moveDropReason` at the drop.
 */
const MOVABLE_TYPES: ReadonlySet<string> = new Set([
  'monitor', 'rail-signal',
  'hanger',
  'ac-unit', 'electrical-cabinet', 'tactile', 'floor-mark',
  'gate',
  'psd-end',
  'fence',
  'tvm',
  'vending',
  'bench',
  'shelf',
  'desk',
  'checkout',
  'cubicle',
  'sink',
  'guidepost',
  'busstop',
  'bin',
  'extinguisher',
  'vent',
  'light',
  'clock',
  'cctv',
  'billboard',
  'glass',
  'door',
  'calligraphy',
  'linemap',
  'tv',
  'sign',
  'exit',
  // A free-standing 支柱: no own cells, no carve, no derived geometry — a plain
  // translation. A bridge-owned pier (`cfg.bridgeId`) stays put: it is spaced by
  // its bridge (`syncBridgePillars`), so moving it would orphan the bay or fork
  // the pier id.
  'pillar',
  // The two runs: a 楼梯 (the 1 × 1 楼梯块 included) and a 扶梯. Both are re-laid through
  // their own tear-down — a turning stair's half-landing floor is the stair's own cell,
  // and both carve the slab they climb through.
  'stair',
  'escalator',
])

/** True when 移动 may lift this placed piece (the tile and 信息 card ask). */
export function isMovableModule(m: Module): boolean {
  if (!MOVABLE_TYPES.has(m.type)) return false
  // A bridge-owned pier is spaced by its bridge, not placed by hand.
  if (m.type === 'pillar' && m.cfg.bridgeId) return false
  return true
}

/**
 * True when a 移动 of this piece is a **teardown and a rebuild** rather than a
 * translation: a 楼梯 (bar the 1 × 1 楼梯块, which owns no cell of the document's and
 * carves nothing) or a 扶梯.
 *
 * Both are re-laid where they land rather than translated, and for two reasons: a turning
 * stair owns floor the document holds for it — its half-landing, laid by `addEquipment` and
 * taken back out by `removeModule` — and either kind opens the slab it climbs through, so the
 * piece has to be out of `modules` while it is in the air and in them again before the carve
 * runs at its new cell. That is exactly the pair a player would drive by hand
 * (`moveEquipment`), and it is one commit: one `Ctrl+Z` puts the run back, landing floor and
 * all. The opening a run **carved** where it stood is left behind, exactly as it is when a run
 * is deleted; a 方块 may be laid in it again (it is no longer a reserved opening).
 */
export function moveRebuilds(m: Module): boolean {
  return (m.type === 'stair' && m.cfg.block !== true) || m.type === 'escalator'
}

/**
 * The same piece moved to `at` and turned to `rot`. Nothing else is touched: the
 * id and the whole `cfg` — a 闸机's lane, a 指示牌's printed boards, a 广告牌's
 * poster, a 楼梯's size and painted surface — travel with it, so what comes up is what
 * goes down.
 *
 * A **run** is the piece whose own geometry is world cells: a 楼梯's `from`/`to` (and
 * every flight of a turn) and a 扶梯's two landings are absolute, so they are re-laid
 * here — turned about the piece's **anchor** (the cell it was dropped on, which is its
 * lower landing) and shifted with it. Rewriting `x`/`y`/`z` alone would leave the run
 * drawn, carved and walked at the cell it came from.
 *
 * The quarter turn is stepped in the piece's own convention, because the two kinds do not
 * share one: a 楼梯 and a 扶梯 climb along `stairFacing`, whose next turn is
 * `(x, y) → (y, −x)`, while a 楼梯块 is laid on `rotateLocal`, whose is
 * `(x, y) → (−y, x)`. Turning the run it *has* — rather than rebuilding one from its
 * settings — keeps a piece that was never on the grid (an older, off-grid 双跑楼梯) exactly
 * as wide and as slid as it was placed.
 */
export function movedModule(m: Module, at: Vec3i, rot: number): Module {
  if (m.type === 'exit' && m.cfg.style === 'doorway' && m.cfg.mountZ !== undefined) {
    return {
      ...m,
      x: at.x,
      y: at.y,
      z: at.z,
      rot,
      cfg: { ...m.cfg, mountZ: at.z + (m.cfg.mountZ - m.z) },
    }
  }
  if (m.type === 'stair' || m.type === 'escalator') {
    const steps = (((normRot(rot) - normRot(m.rot)) % 4) + 4) % 4
    const blocky = m.type === 'stair' ? m.cfg.block === true : false
    const shift = (p: Vec3i): Vec3i => {
      let dx = p.x - m.x
      let dy = p.y - m.y
      for (let i = 0; i < steps; i++) {
        const nx = blocky ? -dy : dy
        const ny = blocky ? dx : -dx
        dx = nx
        dy = ny
      }
      return { x: at.x + dx, y: at.y + dy, z: at.z + (p.z - m.z) }
    }
    if (m.type === 'escalator') {
      return { ...m, x: at.x, y: at.y, z: at.z, rot, from: shift(m.from), to: shift(m.to) }
    }
    return {
      ...m,
      x: at.x,
      y: at.y,
      z: at.z,
      rot,
      from: shift(m.from),
      to: shift(m.to),
      cfg: m.cfg.flights
        ? { ...m.cfg, flights: m.cfg.flights.map((f) => ({ from: shift(f.from), to: shift(f.to) })) }
        : m.cfg,
    }
  }
  return { ...m, x: at.x, y: at.y, z: at.z, rot }
}

/** True when every cell of a module's footprint is solid floor or an exit's floor. */
export function moduleFloorOk(cells: readonly Cell[], modules: readonly Module[], candidate: Module): boolean {
  // A staircase is founded at its foot. Its upper landing and intermediate
  // turn platform are part of the stair it places, so requiring pre-existing
  // floor at those cells incorrectly rejects turns whose foot is supported.
  const footprint = candidate.type === 'hanger'
    ? hangerPostCells(candidate)
    : candidate.type === 'stair' && !candidate.cfg.block
      ? [[candidate.x, candidate.y] as [number, number]]
      : moduleFootprint(candidate)
  for (const [bx, by] of footprint) {
    const floor =
      cells.some((c) => c.fill === 'solid' && c.x === bx && c.y === by && c.z === candidate.z) ||
      exitFloorAt(modules, bx, by, candidate.z) ||
      virtualSolidAt(cells, modules, bx, by, candidate.z)
    if (!floor) return false
  }
  return true
}

/** Why a module may not be placed, or `''` when it may. */
export type EquipmentRefusal =
  | ''
  | 'exit-on-slab'
  | 'exit-below-ground'
  | 'bridge-below-ground'
  | 'outdoor-below-ground'
  | 'floor'
  | 'track'
  | 'occupied'
  | 'wall'
  | 'ceiling'
  | 'escalator-bases'
  | 'lift-footprint'

/**
 * May `candidate` stand where it is? The **one** rule set for a module: the
 * equipment hover, the release, a fence run's own cells and a lifted piece's drop
 * all ask this, so a ghost can never promise a piece the release refuses.
 *
 * Every rule here was already enforced by the builder, gathered rather than
 * changed: the ground under every cell the piece stands on, the storey an 出入口
 * belongs to (`layer`: true only while placing, so a 移动 of an existing one is not
 * refused for where it already is), the rails, the space another piece holds, a
 * 广告牌's wall, a hung piece's slab, a 扶梯's two landings and a 电梯's 2 × 2
 * footprint. The ground is the **floor-standing** pieces' rule: a hung piece is
 * anchored to the floor cell it hangs over (`ceilingMountStandCell`) but does not
 * stand on it, so the slab overhead is its whole structural requirement.
 *
 * `candidate` carries the resolution the tool already did to it — a 广告牌 turned to
 * face its wall (`autofaceWallMount`), a run snapped into an exit bay — because
 * those produce the piece, not the verdict.
 */
export function equipmentReason(cells: readonly Cell[], modules: readonly Module[], candidate: Module, layer = false): EquipmentRefusal {
  if (candidate.type === 'hanger') {
    if (hangerRoofMissing(cells, modules, candidate)) return 'ceiling'
    if (!moduleFloorOk(cells, modules, candidate)) return 'floor'
    const boxes = hangerBoxes(candidate)
    if (cells.some((c) => c.fill === 'solid' && boxes.some((box) => boxesOverlap(box, { x0: c.x, y0: c.y, z0: c.z, x1: c.x + 1, y1: c.y + 1, z1: c.z + 1 })))) return 'occupied'
    if (placementOnTrack(cells, candidate, modules)) return 'track'
    return placementColliders(modules, candidate).length > 0 ? 'occupied' : ''
  }
  if (candidate.type === 'rail-signal' || candidate.type === 'shelf' || candidate.type === 'checkout' || candidate.type === 'desk' || candidate.type === 'ac-unit' || candidate.type === 'electrical-cabinet' || isFloorSticker(candidate)) {
    const box = moduleEnvelope(candidate)!
    if (cells.some((c) => c.fill === 'solid' && boxesOverlap(box, { x0: c.x, y0: c.y, z0: c.z, x1: c.x + 1, y1: c.y + 1, z1: c.z + 1 }))) return 'occupied'
  }
  if ((candidate.type === 'guidepost' || candidate.type === 'busstop') && candidate.z < 0) return 'outdoor-below-ground'
  if (candidate.type === 'exit' && (candidate.cfg as { style?: string }).style === 'virtual' && candidate.z < 0) return 'outdoor-below-ground'
  if (candidate.type === 'track' && candidate.cfg.bridge && candidate.z < BRIDGE_MIN_Z) return 'bridge-below-ground'
  if (candidate.type === 'stair' && candidate.cfg.block && cells.some((c) => c.fill === 'solid' && c.x === candidate.x && c.y === candidate.y && c.z === candidate.z + 1)) return 'occupied'
  if ((candidate.type === 'pillar' || (candidate.type === 'roof' && candidate.cfg.variant)) && candidate.z < 0) return 'exit-on-slab'
  if (candidate.type === 'roof') {
    if (placementColliders(modules, candidate).length > 0) return 'occupied'
    const box = moduleEnvelope(candidate)!
    for (const c of cells) {
      if (c.fill === 'solid' && boxesOverlap(box, { x0: c.x, y0: c.y, z0: c.z, x1: c.x + 1, y1: c.y + 1, z1: c.z + 1 })) return 'occupied'
    }
    return ''
  }
  if (candidate.type === 'pillar') {
    const box = moduleEnvelope(candidate)!
    for (const c of cells) {
      if (c.fill === 'solid' && boxesOverlap(box, { x0: c.x, y0: c.y, z0: c.z, x1: c.x + 1, y1: c.y + 1, z1: c.z + 1 })) return 'occupied'
    }
  }
  if (layer && candidate.type === 'exit') {
    if (candidate.cfg.style === 'doorway') {
      if (candidate.z < 0) return 'exit-below-ground'
    } else if (candidate.cfg.style === 'virtual') {
      // 虚拟 is a surface pillar like a 导向柱: any floor at 0 m or above.
      if (candidate.z < 0) return 'outdoor-below-ground'
    } else if (candidate.z < 0 || candidate.z > 3) return 'exit-on-slab'
  }
  // A wall-mounted 装饰 — a 广告牌, a 玻璃板, a 站名 or the wall 线网图 — bolts to a
  // wall and may hang over the track where there is no floor in front of it, so it
  // is resolved from its backing and never from the ground. A **线网图's totem** is
  // not: it stands on the floor like a 售票机, so it falls through to the rules below.
  if (isWallMounted(candidate)) {
    if (wallMountMissing(cells, candidate, modules)) return 'wall'
    return placementColliders(modules, candidate).length > 0 ? 'occupied' : ''
  }
  // A **hung** 装饰 — a 指示牌, 电视, 时钟 or 监控 — is the wall panel's twin one step
  // higher: its rods bolt to the slab overhead, so the floor cell it is anchored to
  // (`ceilingMountStandCell`, the storey the save reads) is the room's, not its own,
  // and the ground rule would refuse it over a well or over the rails where a slab
  // really does hang it — with a notice about floor under a piece three metres up.
  // It is still refused on a track bed, in another piece's space and under open sky.
  if (!isCeilingHung(candidate) && !moduleFloorOk(cells, modules, candidate)) {
    return candidate.type === 'lift' ? 'lift-footprint' : 'floor'
  }
  if (placementOnTrack(cells, candidate, modules)) return 'track'
  if (placementColliders(modules, candidate).length > 0) return 'occupied'
  if (wallMountMissing(cells, candidate, modules)) return 'wall'
  if (ceilingMountMissing(cells, candidate, modules)) return 'ceiling'
  // A 扶梯 punches through whatever is in its way; only its lower base needs support.
  // (A 电梯's bay is already answered above: `moduleFloorOk` is its whole footprint,
  // so a lift short of floor reports 'lift-footprint', never the generic 'floor'.)
  if (candidate.type === 'escalator' && !escalatorBasesSolid(cells, modules, candidate)) return 'escalator-bases'
  return ''
}

/** A module refusal, in the words the notice bar uses.
 *
 * `blockers` names the pieces standing in the way (`placementColliders` /
 * `equipmentBlockingCell`): when a placement is refused for `occupied` the
 * notice says which conflict it is — `被闸机阻挡` — instead of only saying
 * the cell is held. The base sentence is kept verbatim so the reason stays
 * searchable, and an empty list leaves it unchanged. */
export function equipmentRefusalNotice(reason: EquipmentRefusal, blockers: readonly Module[] = []): string {
  const base = (() => {
    switch (reason) {
      case 'exit-on-slab':
        return msg('entrances_must_be_placed_at_ground_level')
      case 'exit-below-ground':
        return msg('ground_entrances_must_be_at_0_m_or_above')
      case 'bridge-below-ground':
        return msg('the_bridge_underside_must_be_above_ground')
      case 'outdoor-below-ground':
        return msg('wayfinding_posts_and_bus_stops_need_a_floor_at_0_m_or_above')
      case 'floor':
        return msg('equipment_needs_a_solid_floor_here')
      case 'track':
        return msg('cannot_place_equipment_on_track')
      case 'occupied':
        return msg('equipment_already_occupies_this_location')
      case 'wall':
        return msg('wall_decorations_need_a_solid_wall_behind_them')
      case 'ceiling':
        return msg('hung_signs_tvs_clocks_and_cameras_need_a_slab_4_m_above_wall_sig')
      case 'escalator-bases':
        return msg('the_escalator_bottom_needs_a_solid_floor')
      case 'lift-footprint':
        return msg('a_lift_needs_a_floor_in_all_four_cells_of_its_2_2_m_footprint')
      default:
        return ''
    }
  })()
  if (base === '' || blockers.length === 0) return base
  // Only the collision names a piece; every other rule already names its own
  // cause (no floor, no wall, no ceiling, the rails).
  if (reason !== 'occupied') return base
  return msg('value_blocked_by_value', base, blockerLabels(blockers))
}

/**
 * Friendly name for a placed piece, for a refusal notice. Pure data, kept in
 * `sim/` so the verdict layer can name the conflict without importing the app's
 * catalogue (`build/` may not import `app/`, and `sim/` imports nothing at all).
 * Mirrors `app/store/catalog.ts`'s `MODULE_LABELS`.
 */
export function moduleTypeLabel(m: Module): string {
  if (m.type === 'fence') return m.cfg.variant === 'gate' ? msg('door') : m.cfg.variant === 'iron' ? msg('iron_fence') : msg('glass_fence')
  if (m.type === 'shop') {
    const kind = (m.cfg as { kind?: string } | undefined)?.kind
    if (kind === 'toilet') return msg('restroom')
    if (kind === 'office') return msg('office')
    return msg('store')
  }
  if (m.type === 'booth' && (m.cfg as { kind?: string } | undefined)?.kind === 'info') return msg('information_desk')
  if (m.type === 'cctv') {
    const variant = (m.cfg as { variant?: string } | undefined)?.variant
    if (variant === 'ball') return msg('ptz_camera')
    if (variant === 'dome') return msg('dome_camera')
    return msg('cctv')
  }
  return MODULE_TYPE_LABELS[m.type] ?? m.type
}

/** Friendly name per module type, for refusal notices (§9.5). */
const MODULE_TYPE_LABELS: Record<string, string> = {
  hanger: msg('hanger'),
  pillar: msg('support_pillar'),
  roof: msg('station_roof'),
  gate: msg('fare_gate'),
  'psd-end': msg('screen_end_door'),
  fence: msg('glass_fence'),
  tvm: msg('ticket_machine'),
  vending: msg('vending_machine'),
  bench: msg('bench'),
  shelf: msg('shelf'),
  desk: msg('desk'),
  checkout: msg('checkout'),
  cubicle: msg('toilet_cubicle'),
  sink: msg('sink'),
  guidepost: msg('wayfinding_post'),
  busstop: msg('bus_stop'),
  bin: msg('bin'),
  extinguisher: msg('extinguisher'),
  'ac-unit': msg('air_conditioner'),
  'electrical-cabinet': msg('equipment_cabinet'),
  tactile: msg('tactile_paving'),
  'floor-mark': msg('floor_markings'),
  vent: msg('vent'),
  light: msg('light'),
  clock: msg('clock'),
  cctv: msg('cctv'),
  billboard: msg('billboard'),
  glass: msg('glass_panel'),
  door: msg('door'),
  calligraphy: msg('station_name'),
  linemap: msg('network_map'),
  tv: msg('tv'),
  monitor: msg('monitor'),
  'rail-signal': msg('rail_signal'),
  sign: msg('sign'),
  exit: msg('entrances'),
  escalator: msg('escalator'),
  stair: msg('stairs'),
  lift: msg('lift'),
  retail: msg('shop'),
  shop: msg('store'),
  booth: msg('ticket_booth'),
  'platform-edge': msg('platform_doors'),
  track: msg('track'),
}

/**
 * Which pieces a refusal names: unique labels in document order, at most three,
 * then `等N件`. Capped so a drag across a gate line does not print the whole row.
 */
export function blockerLabels(blockers: readonly Module[]): string {
  const seen: string[] = []
  for (const b of blockers) {
    const label = moduleTypeLabel(b)
    if (!seen.includes(label)) seen.push(label)
    if (seen.length >= 3 && blockers.length > 3) break
  }
  const shown = blockers.length > 3 ? seen.slice(0, 3) : [...new Set(blockers.map(moduleTypeLabel))].slice(0, 3)
  if (blockers.length > 3) return msg('value_and_value_items', shown.join('、'), blockers.length)
  return shown.join('、')
}

/**
 * Why a lifted piece may not be dropped as `candidate`, or `''` when it may.
 *
 * The question itself is the one rule set above, so a lifted piece and a fresh
 * placement can never be judged differently — this function only turns that verdict
 * into the sentence the 信息 card shows. It is asked of a piece that already exists,
 * so the copy still standing at the piece's origin never counts as the obstacle
 * (`placementBlocked` matches a candidate to itself by id), and the **layer** is not
 * re-checked: a 移动 may not be refused for where the piece already is.
 */
export function moveDropReason(cells: readonly Cell[], modules: readonly Module[], candidate: Module): string {
  const reason = equipmentReason(cells, modules, candidate)
  if (reason === '') return ''
  return equipmentRefusalNotice(reason, placementColliders(modules, candidate))
}

/**
 * The piece a lifted module becomes at `at` with rotation `rot`, and why that
 * drop is refused (`''` when it is legal). One function answers for the
 * translucent ghost under the pointer, the `信息` card's 确认 and the commit
 * itself, so what the player sees in the air is exactly what lands.
 *
 * The rotation is the carried one; a wall-mounted piece is turned to face its
 * wall first (`autofaceWallMount`), because which way a panel bolted to a wall
 * faces is the wall's answer, never the player's problem: the wall the **camera**
 * is looking at wins, the carried turn settles a view that cannot tell two of them
 * apart.
 */
export function moveCandidate(
  cells: readonly Cell[],
  modules: readonly Module[],
  mod: Module,
  at: Vec3i,
  rot: number,
  near?: readonly [number, number],
  facing?: readonly [number, number],
): { module: Module; reason: string } {
  let moved = movedModule(mod, at, rot)
  if (moved.type === 'sign' && moved.cfg.mount === 'wall') {
    moved = snapSignToBooth(modules, moved, near ?? [at.x + 0.5, at.y + 0.5], at.z)
  }
  moved = autofaceWallMount(cells, moved, near, modules, facing)
  if (moved.type === 'psd-end') moved = snapPsdEnd(moved, modules)
  return { module: moved, reason: moveDropReason(cells, modules, moved) }
}
