import { roadSurfaceReason } from './roadPlacement.ts'
import { MAX_DRAG_CELLS, ROAD_LANE_WIDTH, STOREY_HEIGHT, TRAFFIC_LIGHT_HEIGHT } from './constants.ts'
import { msg } from './i18n.ts'
import { solidCellsInBounds } from './solidCellIndex.ts'
import { noiseBarrierVariant, noiseBarrierHeight, noiseBarrierOffset } from './noiseBarriers.ts'
import { blockIndex, type BlockIndex } from './blockIndex.ts'
import { isOutdoorSurface, outdoorSurfaceIndex, surfaceKey } from './outdoorSurfaces.ts'
export { isOutdoorSurface } from './outdoorSurfaces.ts'
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
import { fenceArms, fenceConnectionIndex, type FenceNeighbours } from './fences.ts'
import { isPsdCornerPair, isPsdEndCoverSupport, isPsdEndJoin, psdEndOffset, psdEndSpan, snapPsdEnd, snapPsdEndCover } from './psdEnds.ts'
import { floorDecorCells, floorDecorSpec, floorDecorBounds, isFloorSticker } from './floorDecor.ts'
import { VENT_WIDTH, VENT_DEPTH, ventCeilingZ } from './vents.ts'
import { LIGHT_DEPTH, lightCeilingZ, lightOffset, lightSpec } from './lights.ts'
import { canopyBodyBoxes, canopyPostCells, CANOPY_ROOF_DROP, pillarSupportsBridge, pillarWidth, pillarOffset, ROOF_THICKNESS, TRUSS_ROOF_BASE, trussRoofTop, BRIDGE_DECK_DEPTH, BRIDGE_MIN_Z, bridgeBarrierTop } from './structures.ts'
import { EXIT_L, exitSpan, exitBays, exitFloorAt, exitWidth, isExitHeadHouse } from './exits.ts'
import { calligraphyBottom, calligraphyCourses } from './calligraphy.ts'
import { GLASS_FRAME, glassModuleSpec, glassSpec, glassStandsOnFloor, glassWallCourses } from './glassPanels.ts'
import { doorSpec } from './doors.ts'
import { GROUND_Z, groundHoleAt, virtualSolidAt } from './ground.ts'
import { lineMapSpec, LINE_MAP_FRAME_PAD, lineMapWallCourses } from './linemaps.ts'
import { liftFootprintCells, liftSizeOf } from './lifts.ts'
import { billboardSpec } from './billboards.ts'
import { escalatorBasesSolid, rampBodyBoxes, rampEnvelope, rampOpeningAt } from './openings.ts'
import { escalatorLandings } from './escalators.ts'
import { walkwayCoveredCells, walkwayLandings } from './walkways.ts'
import { PANEL_MIN_H, mountedSignBoards, signBoardsOf, signBoardsPanel, signMountOf, signMountSpec, signWallCourses } from './sign.ts'
import { BOOTH_SIGN_PANEL_Z, WALL_SIGN_STAND_OFF, boothHoldsSign, boothSignFits, boothSupportsSign, snapSignToBooth } from './boothSigns.ts'
import { PSD_FULL_HEIGHT, psdFullHeight, PSD_HALF_HEIGHT } from './constants.ts'
import { edgeCells, normRot, rotateLocal, trackCellAt, trackCells } from './track.ts'
import { monitorCells } from './monitors.ts'
import { RAIL_SIGNAL_HEIGHT, RAIL_SIGNAL_SCALE } from './constants.ts'
import { tvBackToBack, tvFacing } from './tvs.ts'
import { OUTDOOR_SURFACE_HEIGHT } from './constants.ts'
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
  tv: 4.0,
  // A ceiling-hung 指示牌 / 电视 / 时钟 / 监控 spans the whole storey, from the floor
  // top to the ceiling one grid step up, so its envelope is the full column (and it
  // is found/blocked like any other equipment). The clock's dial and the camera's
  // head both sit inside that column — the piece is hung, so the air under it is
  // reserved rather than free floor.
  sign: 4.0,
  clock: 4.0,
  cctv: 4.0,
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

/**
 * Floor decor drawn offset against a wall edge (§5.7): the bin, the extinguisher
 * cabinet, the shelf, the TVM and the vending machine. Each is built with its
 * back on its tile's trailing edge (`placeLocalAtEdge`), so it reads as furniture
 * pushed against a wall.
 */
const EDGE_DECOR_TYPES: ReadonlySet<string> = new Set(['bin', 'extinguisher', 'shelf', 'tvm', 'vending'])

/** True for floor decor whose model sits against its tile's trailing edge. */
export function isEdgeDecor(m: { type: string }): boolean {
  return EDGE_DECOR_TYPES.has(m.type)
}

/**
 * How far an edge-decor piece shifts towards its tile centre when its back is
 * against a floor-standing 玻璃幕墙, metres. The curtain frame is 0.1 m deep on the
 * tile edge; the shift clears it with a little air, so the cabinet back never
 * intersects the glazing.
 */
export const EDGE_DECOR_CURTAIN_SHIFT = 0.15

/**
 * An edge-decor piece backed against a floor-standing 玻璃幕墙 in the same tile:
 * same storey, the decor footprint overlaps the curtain run, and the decor back
 * faces the curtain edge — `wallSide` opposite, so the two backs coincide on one
 * tile edge. Either side of the pair may be the candidate.
 */
export function edgeDecorCurtainShare(a: Module, b: Module): boolean {
  const glass = a.type === 'glass' ? a : b.type === 'glass' ? b : undefined
  const decor = a.type !== 'glass' && isEdgeDecor(a) ? a : b.type !== 'glass' && isEdgeDecor(b) ? b : undefined
  if (!glass || !decor || glass.z !== decor.z) return false
  if (!glassStandsOnFloor(glassModuleSpec(glass.cfg?.variant, glass.cfg?.curtainHeight))) return false
  const [gx, gy] = wallSide(glass.rot)
  const [dx, dy] = wallSide(decor.rot)
  if (dx !== -gx || dy !== -gy) return false
  const curtainCells = new Set(glassCells(glass).map(([x, y]) => `${x},${y}`))
  return moduleFootprint(decor).some(([x, y]) => curtainCells.has(`${x},${y}`))
}

/**
 * The plan shift an edge-decor piece takes towards its tile centre when backed
 * against a curtain in `modules` — `[0, 0]` when it stands alone. Read by the
 * piece models (`placeLocalAtEdge`), so what is drawn is what the placement
 * verdict allows.
 */
export function edgeDecorCurtainOffset(modules: readonly Module[], decor: Module): [number, number] {
  if (!isEdgeDecor(decor)) return [0, 0]
  for (const m of outdoorSurfaceIndex(modules).glass) {
    if (m.id === decor.id || m.type !== 'glass') continue
    if (edgeDecorCurtainShare(m, decor)) {
      const [sx, sy] = wallSide(decor.rot)
      return [sx * EDGE_DECOR_CURTAIN_SHIFT, sy * EDGE_DECOR_CURTAIN_SHIFT]
    }
  }
  return [0, 0]
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
  // A ceiling-hung piece that hangs from the plane directly over its cell (a 吊顶,
  // or any top block the aim found) reserves the room under that plane. A 悬挂架 is
  // not that shape: it is steel carried by a roof a whole storey up (`hangerRoofZ`),
  // and its own box is the truth, whether or not it hangs under a 吊顶.
  if (m.ceilingAnchored && m.type !== 'hanger' && isCeilingHung(m) && m.type !== 'light' && m.type !== 'vent') {
    return { x0: m.x, y0: m.y, x1: m.x + 1, y1: m.y + 1, z0: z0 - 3, z1: z0 }
  }
  switch (m.type) {
    case 'sidewalk':
    case 'lawn': return { x0: m.x, x1: m.x + 1, y0: m.y, y1: m.y + 1, z0, z1: z0 + OUTDOOR_SURFACE_HEIGHT }
    case 'tree': return { x0: m.x + .3, x1: m.x + .7, y0: m.y + .3, y1: m.y + .7, z0, z1: z0 + 4.5 }
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
      return { x0: m.x, y0: m.y, z0, x1: m.x + 1, y1: m.y + 1, z1: z0 + (m.type === 'cctv' && m.cfg.variant === 'post' ? 4 : FLAT_HEIGHT[m.type]) }
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
    case 'traffic-light': return { x0: m.x + .2, y0: m.y + .2, z0, x1: m.x + .8, y1: m.y + .8, z1: z0 + TRAFFIC_LIGHT_HEIGHT }
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
      if (m.cfg.variant === 'cover') {
        const side = m.cfg.side === 'right' ? 1 : -1
        const [cx, cy] = rotateLocal(m.rot, m.cfg.offset?.[0] ?? 0, side * 0.34 + (m.cfg.offset?.[1] ?? 0))
        const [axX, axY] = rotateLocal(m.rot, 1, 0), [ayX, ayY] = rotateLocal(m.rot, 0, 1)
        const rx = Math.abs(axX) * (m.cfg.width ?? 1) * 0.5 + Math.abs(ayX) * (m.cfg.depth ?? 0.24) * 0.5
        const ry = Math.abs(axY) * (m.cfg.width ?? 1) * 0.5 + Math.abs(ayY) * (m.cfg.depth ?? 0.24) * 0.5
        return { x0: m.x + 0.5 + cx - rx, y0: m.y + 0.5 + cy - ry, z0: m.z,
          x1: m.x + 0.5 + cx + rx, y1: m.y + 0.5 + cy + ry, z1: m.z + 1 }
      }
      const h = m.cfg.psd === 'half' ? PSD_HALF_HEIGHT : psdFullHeight(m.storeyHeight)
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
      const variant = noiseBarrierVariant(m)
      const z1 = z0 + (variant ? noiseBarrierHeight(variant) : FLAT_HEIGHT.fence)
      const rot = (((m.rot ?? 0) % 4) + 4) % 4
      if (variant) {
        const [dx, dy] = noiseBarrierOffset(rot)
        if (rot % 2 === 1) return { x0: m.x + 0.44 + dx, y0: m.y, z0, x1: m.x + 0.56 + dx, y1: m.y + 1, z1 }
        return { x0: m.x, y0: m.y + 0.44 + dy, z0, x1: m.x + 1, y1: m.y + 0.56 + dy, z1 }
      }
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
      if (m.cfg.variant === 'canopy') return cellsAabb(trackCells(m), z0, z0 + trussRoofTop(m.d) - CANOPY_ROOF_DROP)
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
      if (m.cfg.psd === 'none') return null
      // The screen sits on the track-facing strip of its single-cell-deep run.
      // A half-height (半高) screen reserves only its actual height, so something
      // may stand in the headroom the full screen would have filled.
      const h = m.cfg.psd === 'half' ? PSD_HALF_HEIGHT : psdFullHeight(m.storeyHeight)
      const box = cellsAabb(edgeCells(m), z0, z0 + h)
      return box.x1 - box.x0 <= 1.0001
        ? { ...box, x0: box.x0 + 0.16, x1: box.x1 - 0.16 }
        : { ...box, y0: box.y0 + 0.16, y1: box.y1 - 0.16 }
    }
    case 'track':
      // A dug track bed: the module owns the whole trench volume (bed slab +
      // rails) from the block top to the platform surface, so no equipment can
      // be dropped into it.
      return cellsAabb(trackCells(m), m.z - (m.cfg.bridge ? BRIDGE_DECK_DEPTH : 1), m.z + (m.cfg.bridge ? bridgeBarrierTop(m.cfg.bridgeRailing) : 1))
    default:
      return null
  }
}

const NO_SURFACE_CELLS: readonly Cell[] = []

/** §4.1/§4.3: exits own their floor and wellways; a finish cannot cap that opening. */
export function outdoorSurfaceHidden(cells: readonly Cell[], modules: readonly Module[], m: Module): boolean {
  const occupied = blockIndex(cells, modules)
  return occupied.opening(m.x, m.y, m.z)
    || (!occupied.solid.has(surfaceKey(m.x, m.y, m.z)) && !occupied.ground(m.x, m.y, m.z))
}

/** §4.3/§5: floor equipment follows its raised finish, including existing pieces. */
export function outdoorSurfaceLift(modules: readonly Module[], m: Module): number {
  if (m.type === 'exit' && isExitHeadHouse(m)) return 0
  if (!modules.length || isOutdoorSurface(m) || isWallMounted(m) || isCeilingHung(m)
    || ['road', 'roof', 'track', 'stair', 'escalator', 'walkway', 'lift'].includes(m.type)) return 0
  const box = flatEnvelope(m)
  if (!box || Math.abs(box.z0 - m.z - 1) > .01) return 0
  const { tiles } = outdoorSurfaceIndex(modules)
  for (let x = Math.floor(box.x0); x < Math.ceil(box.x1); x++) for (let y = Math.floor(box.y0); y < Math.ceil(box.y1); y++) {
    if (tiles.has(surfaceKey(x, y, m.z)) && !blockIndex(NO_SURFACE_CELLS, modules).opening(x, y, m.z)) return OUTDOOR_SURFACE_HEIGHT
  }
  return 0
}

/**
 * The world box a module occupies — its ramp corridor or its flat body. A lift
 * is neither: it is a 2 × 2 m shaft rising two storeys, so it gets its own box
 * (the ramp envelope's thin vertical column would not reserve the whole plan).
 */
export function moduleEnvelope(m: Module, modules: readonly Module[] = []): ModuleBox | null {
  const box = rawModuleEnvelope(m)
  const lift = outdoorSurfaceLift(modules, m)
  return box && lift ? { ...box, z0: box.z0 + lift, z1: box.z1 + lift } : box
}

function rawModuleEnvelope(m: Module): ModuleBox | null {
  if (m.type === 'road') return { x0: m.x, y0: m.y, z0: m.z + 1.01, x1: m.x + m.w, y1: m.y + m.d, z1: m.z + 1.07 }
  if (m.type === 'stair' && m.cfg.block) return { x0: m.x, y0: m.y, z0: m.z + 1, x1: m.x + 1, y1: m.y + 1, z1: m.z + 1 + (m.cfg.blockHeight ?? 1) }
  if (m.type === 'lift') return liftEnvelope(m)
  return rampEnvelope(m) ?? flatEnvelope(m)
}

/** The shaft box of a lift — the whole 2 × 2 小 or 3 × 3 大 plan — from its lower landing to above its top. */
function liftEnvelope(m: Extract<Module, { type: 'lift' }>): ModuleBox {
  const lo = Math.min(m.from.z, m.to.z)
  const hi = Math.max(m.from.z, m.to.z)
  const size = liftSizeOf(m)
  return { x0: m.x, y0: m.y, z0: lo + 0.5, x1: m.x + size, y1: m.y + size, z1: hi + 1 + 0.6 }
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
 * A room covers its whole `w × h`; a 电梯 its 2 × 2 小 or 3 × 3 大 cells; a rail its bed, a
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
  if (m.type === 'road') return Array.from({ length: m.w * m.d }, (_, i) => [m.x + i % m.w, m.y + Math.floor(i / m.w)])
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
    case 'walkway':
      return walkwayLandings(m).map((p) => [p.x, p.y] as [number, number])
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
 *
 * A **hung** fitting under a 站台 or 轨道桥 is not standing on the bed: the
 * deck over its cell is its ceiling (`ceilingMountMissing`), so only the bed's
 * own level refuses it — never the trench check one above, which is exactly
 * the under-deck cell it hangs in.
 */
export function placementOnTrack(cells: readonly Cell[], candidate: Module, modules: readonly Module[] = []): boolean {
  const hung = isCeilingHung(candidate)
  for (const [x, y] of baseCells(candidate)) {
    if (isTrackBed(cells, x, y, candidate.z)) return true
    // A dug bed leaves no finish: the module covers the cell, and its own bed
    // base is the block just under it, so test the candidate's cell and the one
    // above (the trench).
    if (trackAt(modules, x, y, candidate.z)) return true
    if (!hung && trackAt(modules, x, y, candidate.z + 1)) return true
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
  if (m.type === 'tv-double') return true
  if (m.type === 'cctv-post' || (m.type === 'cctv' && (m.cfg as { variant?: string } | undefined)?.variant === 'post')) return false
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

/** Resolve a wall mount from its real backing column and adjacent exposed floor. Glass cladding follows the aimed course; other panels use the actual wall base. Legacy editing-base arguments never affect the result. */
export function wallMountStandCell(
  cells: readonly Cell[],
  cell: readonly [number, number, number],
  place: readonly [number, number, number],
  snapToSolidBlock = false,
  _levelBase = 0,
  followCourse = false,
  _storeyHeight = STOREY_HEIGHT,
  modules: readonly Module[] = [],
): [number, number, number] {
  const hit = cells.find((c) => c.x === cell[0] && c.y === cell[1] && c.z === cell[2])
  // 地面 exits attach to an ordinary block face too; they do not require the
  // block to carry one of the station-wall tags used by wall decorations.
  const onWall = hit !== undefined && hit.fill === 'solid' && (snapToSolidBlock || isWallBlock(hit))
  const side = place[0] !== cell[0] || place[1] !== cell[1]
  if (side) {
    // A **wall course** is a block with a block over it — the document's own cells,
    // which is what a wall column is; the street plane over a course below grade reads
    // as uncovered, and only decides between the aimed course and the actual floor.
    const coveredAbove = cells.some((c) => c.fill === 'solid' && c.x === cell[0] && c.y === cell[1] && c.z === cell[2] + 1)
    const columnBelow = followCourse && hit?.fill === 'solid'
      && cells.some((c) => c.fill === 'solid' && c.x === cell[0] && c.y === cell[1] && c.z === cell[2] - 1)
    // The top course of a wall is still an aimed course. Requiring a block
    // above it made a held pane jump back down to the actual floor at the top.
    if (followCourse && (onWall || coveredAbove || columnBelow)) return [place[0], place[1], cell[2] - 1]
    return [place[0], place[1], wallAnchorZ(cells, modules, cell, place)]
  }
  if (!onWall) return [cell[0], cell[1], cell[2]]
  return [cell[0], cell[1], exposedFloorZ(cells, modules, cell[0], cell[1], cell[2]) ?? wallBaseZ(cells, cell) ?? cell[2]]
}

/** Highest exposed support at/below the aim, including authored decks and street.
 * No editing-storey arithmetic: changing the view base cannot move a support. */
export function exposedFloorZ(cells: readonly Cell[], modules: readonly Module[], x: number, y: number, below: number): number | undefined {
  let best: number | undefined
  const accept = (z: number): void => {
    if (z <= below && (best === undefined || z > best)
      && !cells.some(c => c.fill === 'solid' && c.x === x && c.y === y && c.z === z + 1)) best = z
  }
  for (const c of cells) if (c.fill === 'solid' && c.x === x && c.y === y && !isWallBlock(c)) accept(c.z)
  for (const m of modules) {
    if ((m.type === 'track' && trackCellAt(m, x, y, m.z)) || (m.type === 'exit' && exitFloorAt([m], x, y, m.z))) accept(m.z)
  }
  if (virtualSolidAt(cells, modules, x, y, GROUND_Z)) accept(GROUND_Z)
  return best
}

/** With no adjacent floor, use the bottom of the actual contiguous wall. */
function wallBaseZ(cells: readonly Cell[], cell: readonly [number, number, number]): number | undefined {
  const column = new Map(cells.filter(c => c.fill === 'solid' && c.x === cell[0] && c.y === cell[1]).map(c => [c.z, c]))
  if (!column.has(cell[2])) return undefined
  let z = cell[2]
  while (column.has(z - 1)) z--
  return isWallBlock(column.get(z)!) || column.has(z + 1) ? z - 1 : z
}

function wallAnchorZ(cells: readonly Cell[], modules: readonly Module[], cell: readonly [number, number, number], place: readonly [number, number, number]): number {
  const z = Math.max(exposedFloorZ(cells, modules, place[0], place[1], cell[2]) ?? -Infinity, wallBaseZ(cells, cell) ?? -Infinity)
  return Number.isFinite(z) ? z : cell[2]
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
 * actual floor as their anchor, which is what puts a poster at eye height wherever on
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

/** Resolve a ceiling support to its exposed floor using actual cells, decks and street. A floor top or empty work plane keeps its exact height. With no floor beneath a slab, retain the aimed free cell instead of inventing a storey. */
export function ceilingMountStandCell(
  cell: readonly [number, number, number],
  place: readonly [number, number, number],
  _levelBase = 0,
  cells?: readonly Cell[],
  _storeyHeight = STOREY_HEIGHT,
  modules: readonly Module[] = [],
): [number, number, number] {
  const dz = place[2] - cell[2]
  if (dz === -1) {
    return [cell[0], cell[1], exposedFloorZ(cells ?? [], modules, cell[0], cell[1], cell[2] - 1) ?? place[2]]
  }
  if (dz === 1) return [cell[0], cell[1], cell[2]]
  if (place[0] === cell[0] && place[1] === cell[1]) return [...cell]
  return [place[0], place[1], wallAnchorZ(cells ?? [], modules, cell, place)]
}

/**
 * A rail bed that can ceiling a hung fitting: a 站台 (platform) or an 轨道桥
 * (bridge). A tunnel already raises its own shell ceiling, so it is left to
 * the solid rule. The bed is dug where a platform sits, so no solid cell marks
 * the deck — the module itself is the slab overhead.
 */
export function isCeilingTrack(m: Module): boolean {
  return m.type === 'track' && !(m.cfg as { tunnel?: boolean }).tunnel
}

/**
 * The underside a ceiling track hangs a fitting from. The platform bed fills
 * the excavated course below its anchor; a bridge carries the same one-metre
 * deck below its anchor (`BRIDGE_DECK_DEPTH`).
 */
export function trackCeilingUnderside(m: Module): number | null {
  if (!isCeilingTrack(m)) return null
  return m.z - BRIDGE_DECK_DEPTH
}

/** True when a ceiling track's bed covers `(x, y)` with its underside at `z`. */
function trackCeilingAt(modules: readonly Module[], x: number, y: number, z: number): boolean {
  for (const m of modules) {
    if (trackCeilingUnderside(m) !== z) continue
    if (m.type === 'track' && trackCellAt(m as Extract<Module, { type: 'track' }>, x, y, m.z)) return true
  }
  return false
}

/** Aim one cell below the nearest actual exposed underside in the face-adjacent column. With no ceiling, retain the real floor or pointer height; support validation refuses unsupported pieces. */
export function hungCeilingAim(
  cell: readonly [number, number, number],
  place: readonly [number, number, number],
  levelBase = 0,
  cells: readonly Cell[] = [],
  modules: readonly Module[] = [],
  storeyHeight = STOREY_HEIGHT,
): [number, number, number] {
  const side = place[0] !== cell[0] || place[1] !== cell[1]
  const x = side ? place[0] : cell[0]
  const y = side ? place[1] : cell[1]
  // Only a **slab's own underside** aimed at can be the ceiling itself; every other hit looks above
  // the block the pointer is on, so a wall's course and a floor slab are never mistaken for one.
  const from = !side && place[2] < cell[2] ? cell[2] : cell[2] + 1
  const top = topBlockZ(cells, x, y, from, modules)
  if (top === null) return ceilingMountStandCell(cell, place, levelBase, cells, storeyHeight, modules)
  return [x, y, top - 1]
}

/**
 * The **ceiling** of the space a pointer is in: the lowest solid cell of a column at or above
 * `from` whose own cell below it is open air — the first **underside** overhead. A wall's own
 * courses are skipped, each sitting on another course, so aiming anywhere on a wall that reaches
 * the slab still finds the slab; a column with nothing overhead reads `null`.
 *
 * A 站台 or 轨道桥 bed counts as a top block too: a platform digs its bed course,
 * so no solid cell marks the deck, and a bridge hangs over void. The deck's
 * underside is the ceiling there, with the same open-air-below rule as a slab.
 */
export function topBlockZ(cells: readonly Cell[], x: number, y: number, from: number, modules: readonly Module[] = []): number | null {
  let top: number | null = null
  for (const c of cells) {
    if (c.fill !== 'solid' || c.x !== x || c.y !== y || c.z < from) continue
    if (top !== null && c.z >= top) continue
    if (cells.some((b) => b.fill === 'solid' && b.x === x && b.y === y && b.z === c.z - 1)) continue
    top = c.z
  }
  for (const m of modules) {
    const underside = trackCeilingUnderside(m)
    if (underside === null || underside < from) continue
    if (m.type !== 'track' || !trackCellAt(m as Extract<Module, { type: 'track' }>, x, y, m.z)) continue
    if (top !== null && underside >= top) continue
    if (cells.some((b) => b.fill === 'solid' && b.x === x && b.y === y && b.z === underside - 1)) continue
    top = underside
  }
  if (GROUND_Z >= from && (top === null || GROUND_Z < top) && virtualSolidAt(cells, modules, x, y, GROUND_Z)
    && !cells.some(c => c.fill === 'solid' && c.x === x && c.y === y && c.z === GROUND_Z - 1)) top = GROUND_Z
  return top
}

/**
 * True when a solid cell sits **directly over** the piece's own cell — the top block a hung piece
 * hangs from when it was aimed at a column (`hungCeilingAim`). Such a piece needs no storey slab:
 * the block over it *is* its ceiling. A 站台 or 轨道桥 bed directly over the cell
 * counts the same way: the deck over the cell is its ceiling.
 */
export function topBlockOver(cells: readonly Cell[], m: { x: number; y: number; z: number }, modules: readonly Module[] = []): boolean {
  if (cells.some((c) => c.fill === 'solid' && c.x === m.x && c.y === m.y && c.z === m.z + 1)) return true
  return virtualSolidAt(cells, modules, m.x, m.y, m.z + 1) || trackCeilingAt(modules, m.x, m.y, m.z + 1)
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
export function hangCeilingLocal(m: Module, cells: readonly Cell[], modules: readonly Module[] = [], fallback?: number): number {
  if (m.ceilingAnchored) return 0
  if (topBlockOver(cells, m, modules)) return 0
  const resolvedFallback = fallback ?? ((m as { storeyHeight?: number }).storeyHeight ?? STOREY_HEIGHT) - 1
  return ceilingMountHeight(cells, m, modules) ?? resolvedFallback
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
  // so the storey-slab rule below does not apply to it. A 站台 or 轨道桥 deck over
  // the cell counts as that block.
  if (topBlockOver(cells, candidate, modules)) return false
  if (modules.some((m) => hangerSupports(m, candidate))) return false
  return ceilingMountHeight(cells, candidate, modules) === null
}

/**
 * Local height from a module's floor top to the underside of its actual ceiling.
 * Read the nearest common slab over the whole footprint instead of assuming a
 * fixed five-metre room; the model uses this to extend its suspension up to that slab.
 * A 站台 or 轨道桥 bed counts as a slab: a platform digs its course, so the
 * cells alone show a hole where the deck hangs, and a bridge hangs over void.
 * The deck's underside is the ceiling there — the bed level for a platform, one
 * below it for a bridge's 1 m deck.
 */
const ceilingCells = new WeakMap<readonly Cell[], { solid: Set<string>; undersides: Map<string, number[]> }>()
const ceilingModules = new WeakMap<readonly Module[], { hangers: Module[]; tracks: Module[] }>()

/** Immutable document arrays share support discovery across all hanging fixtures.
 * Keep the full occupied set: a lower course can hide the underside above it. */
function ceilingCellIndex(cells: readonly Cell[]) {
  let index = ceilingCells.get(cells)
  if (index) return index
  const solid = new Set<string>()
  const undersides = new Map<string, number[]>()
  for (const c of cells) if (c.fill === 'solid') solid.add(surfaceKey(c.x, c.y, c.z))
  for (const c of cells) {
    if (c.fill !== 'solid' || solid.has(surfaceKey(c.x, c.y, c.z - 1))) continue
    const key = `${c.x},${c.y}`
    let column = undersides.get(key)
    if (!column) undersides.set(key, column = [])
    column.push(c.z)
  }
  index = { solid, undersides }
  ceilingCells.set(cells, index)
  return index
}

export function ceilingMountHeight(cells: readonly Cell[], candidate: Module, modules: readonly Module[] = []): number | null {
  if (!isCeilingHung(candidate)) return null
  let supports = ceilingModules.get(modules)
  if (!supports) {
    supports = { hangers: modules.filter(m => m.type === 'hanger'), tracks: modules.filter(isCeilingTrack) }
    ceilingModules.set(modules, supports)
  }
  if (supports.hangers.some((m) => hangerSupports(m, candidate))) return 3
  const index = ceilingCellIndex(cells)
  const ground = (x: number, y: number, z: number): boolean => z === GROUND_Z &&
    (Number.isInteger(x) && Number.isInteger(y) ? blockIndex(cells, modules).ground(x, y, z) : virtualSolidAt(cells, modules, x, y, z))
  const footprint = baseCells(candidate)
  const [firstX, firstY] = footprint[0] ?? [candidate.x, candidate.y]
  const candidates = new Set((index.undersides.get(`${firstX},${firstY}`) ?? []).filter(z => z > candidate.z + 1))
  // A rail deck is horizontal cladding, never a wall course: any underside with
  // headroom counts, even at wall height. Both the platform bed and bridge deck
  // extend one metre below their anchor.
  for (const m of supports.tracks) {
    const underside = trackCeilingUnderside(m)
    if (underside === null || underside < candidate.z + 2) continue
    if (m.type !== 'track' || !trackCellAt(m as Extract<Module, { type: 'track' }>, firstX, firstY, m.z)) continue
    candidates.add(underside)
  }
  // The real street underside is valid at any room height unless excavated.
  if (GROUND_Z > candidate.z + 1 && ground(firstX, firstY, GROUND_Z)) candidates.add(GROUND_Z)
  const ceilingZ = [...candidates].sort((a, b) => a - b).find((z) =>
    footprint.every(([x, y]) =>
      index.solid.has(surfaceKey(x, y, z)) ||
      ground(x, y, z) ||
      trackCeilingAt(supports.tracks, x, y, z),
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
function fenceNeighbourFlags(modules: readonly Module[], fence: Module, excludeId?: string, proposed?: Module): FenceNeighbours {
  const index = fenceConnectionIndex(modules)
  const joined = (x: number, y: number): boolean => index.connects(x, y, fence.z, fence.x - x, fence.y - y, excludeId)
    || (proposed?.type === 'fence' && proposed.x === x && proposed.y === y && proposed.z === fence.z)
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
function fenceGlassBlocked(sources: readonly Module[], fence: Module, glass: Module, excludeId?: string, proposed?: Module): boolean {
  const g = moduleEnvelope(glass)
  if (!g) return false
  // Every possible arm stays inside its fence tile, even when a neighbour
  // turns it away from the nominal envelope's axis (§5.2). Reject distant
  // glass before asking for joints; a curtain hover must not resolve every
  // fence's neighbours across the whole station.
  if (!boxesOverlap(g, { x0: fence.x, x1: fence.x + 1, y0: fence.y, y1: fence.y + 1,
    z0: fence.z + 1, z1: fence.z + 1 + FLAT_HEIGHT.fence })) return false
  const nb = fenceNeighbourFlags(sources, fence, excludeId, proposed)
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
const blockedLevelCache = new WeakMap<readonly Module[], Map<number, Set<string>>>()

export function moduleBlockedCells(modules: readonly Module[], z: number): Set<string> {
  let levels = blockedLevelCache.get(modules)
  if (!levels) blockedLevelCache.set(modules, levels = new Map())
  const held = levels.get(z)
  // Shared immutable snapshot data: callers must not mutate these sets.
  if (held) return held
  const out = new Set<string>()
  for (const m of modules) {
    if (RUN_OR_RAIL.has(m.type) && !(m.type === 'stair' && m.cfg.block)) continue
    if (m.type === 'hanger' || (m.type === 'roof' && m.cfg.variant === 'canopy')) {
      for (const box of m.type === 'hanger' ? hangerBoxes(m) : canopyBodyBoxes(m)) {
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
  levels.set(z, out)
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
 *      its underside up, except cells retaining a calculated wedge, or the floor an 出入口 head-house lays. A block there
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
  const key = `${x},${y},${z}`
  const index = level && 'opening' in level ? level : undefined
  const held = index?.checks.get(key)
  if (held) return held
  const cell: [number, number, number] = [x, y, z]
  let check: BlockCheck
  if (index ? index.opening(x, y, z) : reservedOpening(modules, x, y, z)) check = { cell, ok: false, reason: 'opening', blockers: [] }
  else if ((level ?? blockedCellsByLevel(modules))(z).has(key)) check = { cell, ok: false, reason: 'equipment', blockers: equipmentBlockingCell(modules, x, y, z) }
  else if (index ? index.track.has(key) : isTrackCell(cells, modules, x, y, z)) check = { cell, ok: false, reason: 'track', blockers: [] }
  else check = { cell, ok: true, reason: '', blockers: [] }
  if (index) {
    // The immutable snapshot keeps exact witnesses, including refused cells,
    // across growing/shrinking drags. Bound retained verdicts on a long-lived save.
    if (index.checks.size >= 2 * MAX_DRAG_CELLS) index.checks.delete(index.checks.keys().next().value!)
    index.checks.set(key, check)
  }
  return check
}

/**
 * Every piece standing in cell `(x, y, z)` — the pieces a refused block check names.
 * Asked through the modules rather than through the occupancy set, because the set
 * answers with a cell key and a preview needs the object: the collision highlight
 * boxes a module group by id, and a notice names the piece.
 */
interface BlockBody { module: Module; boxes: ModuleBox[]; bounds: ModuleBox; order: number }
const BLOCK_BODY_BUCKET = 16
const blockBodyCache = new WeakMap<readonly Module[], { bodies: BlockBody[]; levels: Map<number, { buckets: Map<string, BlockBody[]>; broad: BlockBody[] }> }>()

/** Exact block blockers, prepared once per immutable module snapshot (§5/§9.5). */
function blockBodiesAt(modules: readonly Module[], x: number, y: number, z: number): BlockBody[] {
  let index = blockBodyCache.get(modules)
  if (!index) {
    const bodies: BlockBody[] = []
    for (const module of modules) {
      let boxes: ModuleBox[]
      if (module.type === 'hanger') boxes = hangerBoxes(module)
      else if (module.type === 'roof' && module.cfg.variant === 'canopy') boxes = canopyBodyBoxes(module)
      else if (module.type === 'stair' && !module.cfg.block) boxes = rampBodyBoxes(module)
      else {
        const envelope = moduleEnvelope(module)
        boxes = envelope ? [envelope] : []
      }
      const bounds = collisionBounds(boxes)
      if (bounds) bodies.push({ module, boxes, bounds, order: bodies.length })
    }
    index = { bodies, levels: new Map() }
    blockBodyCache.set(modules, index)
  }
  let level = index.levels.get(z)
  if (!level) {
    level = { buckets: new Map(), broad: [] }
    for (const body of index.bodies) {
      const box = body.bounds
      if (box.z1 <= z || box.z0 >= z + 1) continue
      const x0 = Math.floor(box.x0 / BLOCK_BODY_BUCKET), x1 = Math.ceil(box.x1 / BLOCK_BODY_BUCKET) - 1
      const y0 = Math.floor(box.y0 / BLOCK_BODY_BUCKET), y1 = Math.ceil(box.y1 / BLOCK_BODY_BUCKET) - 1
      // Imported large envelopes cannot allocate an unbounded empty grid.
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4096) { level.broad.push(body); continue }
      for (let by = y0; by <= y1; by++) for (let bx = x0; bx <= x1; bx++) {
        const key = `${bx},${by}`
        let bucket = level.buckets.get(key)
        if (!bucket) level.buckets.set(key, bucket = [])
        bucket.push(body)
      }
    }
    index.levels.set(z, level)
  }
  const bucket = level.buckets.get(`${Math.floor(x / BLOCK_BODY_BUCKET)},${Math.floor(y / BLOCK_BODY_BUCKET)}`) ?? []
  if (!level.broad.length) return bucket
  // Preserve document order even for broad imported bodies.
  return [...bucket, ...level.broad].sort((a, b) => a.order - b.order)
}

export function equipmentBlockingCell(modules: readonly Module[], x: number, y: number, z: number): Module[] {
  if (!moduleBlockedCells(modules, z).has(`${x},${y},${z}`)) return []
  const box: ModuleBox = { x0: x, y0: y, z0: z, x1: x + 1, y1: y + 1, z1: z + 1 }
  const out: Module[] = []
  for (const body of blockBodiesAt(modules, x, y, z)) {
    if (boxesOverlap(body.bounds, box) && body.boxes.some(part => boxesOverlap(part, box))) out.push(body.module)
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
interface PlacedCollision { module: Module; boxes: ModuleBox[]; bounds: ModuleBox | null; order: number }
const collisionCache = new WeakMap<readonly Module[], PlacedCollision[]>()

function collisionBounds(boxes: ModuleBox[]): ModuleBox | null {
  if (!boxes.length) return null
  const bounds = { ...boxes[0] }
  for (const box of boxes) {
    bounds.x0 = Math.min(bounds.x0, box.x0); bounds.x1 = Math.max(bounds.x1, box.x1)
    bounds.y0 = Math.min(bounds.y0, box.y0); bounds.y1 = Math.max(bounds.y1, box.y1)
    bounds.z0 = Math.min(bounds.z0, box.z0); bounds.z1 = Math.max(bounds.z1, box.z1)
  }
  return bounds
}

function placedCollisionBoxes(modules: readonly Module[]): PlacedCollision[] {
  let entries = collisionCache.get(modules)
  if (!entries) {
    entries = modules.map((module, order) => {
      const envelope = moduleEnvelope(module, modules)
      const boxes = envelope ? collisionBoxes(module, envelope) : []
      return { module, boxes, bounds: collisionBounds(boxes), order }
    })
    collisionCache.set(modules, entries)
  }
  return entries
}

/** Fence joints can leave the nominal rotated strip, but never their tile. */
function collisionSearchBounds(module: Module, bounds: ModuleBox): ModuleBox {
  if (module.type !== 'fence') return bounds
  return { x0: Math.min(bounds.x0, module.x), x1: Math.max(bounds.x1, module.x + 1),
    y0: Math.min(bounds.y0, module.y), y1: Math.max(bounds.y1, module.y + 1),
    z0: Math.min(bounds.z0, module.z + 1), z1: Math.max(bounds.z1, module.z + 1 + FLAT_HEIGHT.fence) }
}

const collisionSpatialCache = new WeakMap<readonly Module[], {
  buckets: Map<string, PlacedCollision[]>; broad: PlacedCollision[]; order: Map<Module, number>
}>()

/** All equipment previews and release checks share this immutable broad phase.
 * Huge imported pieces use a bounded overflow list instead of huge bucket grids. */
function collisionCandidates(modules: readonly Module[], bounds: ModuleBox): PlacedCollision[] {
  let index = collisionSpatialCache.get(modules)
  const entries = placedCollisionBoxes(modules)
  if (!index) {
    index = { buckets: new Map(), broad: [], order: new Map() }
    for (const entry of entries) {
      index.order.set(entry.module, entry.order)
      if (!entry.bounds) continue
      const box = collisionSearchBounds(entry.module, entry.bounds)
      const x0 = Math.floor(box.x0 / BLOCK_BODY_BUCKET), x1 = Math.ceil(box.x1 / BLOCK_BODY_BUCKET) - 1
      const y0 = Math.floor(box.y0 / BLOCK_BODY_BUCKET), y1 = Math.ceil(box.y1 / BLOCK_BODY_BUCKET) - 1
      const count = (x1 - x0 + 1) * (y1 - y0 + 1)
      if (!Number.isFinite(count) || count > BLOCK_BODY_BUCKET ** 2) { index.broad.push(entry); continue }
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const key = `${x},${y}`, bucket = index.buckets.get(key) ?? []
        bucket.push(entry); index.buckets.set(key, bucket)
      }
    }
    collisionSpatialCache.set(modules, index)
  }
  const x0 = Math.floor(bounds.x0 / BLOCK_BODY_BUCKET), x1 = Math.ceil(bounds.x1 / BLOCK_BODY_BUCKET) - 1
  const y0 = Math.floor(bounds.y0 / BLOCK_BODY_BUCKET), y1 = Math.ceil(bounds.y1 / BLOCK_BODY_BUCKET) - 1
  const count = (x1 - x0 + 1) * (y1 - y0 + 1)
  if (!Number.isFinite(count) || count > Math.max(entries.length, 1)) return entries
  const local = new Set(index.broad)
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    for (const entry of index.buckets.get(`${x},${y}`) ?? []) local.add(entry)
  }
  return [...local].sort((a, b) => a.order - b.order)
}

export function placementColliders(modules: readonly Module[], candidate: Module): Module[] {
  const out: Module[] = []
  const c = moduleEnvelope(candidate, modules)
  if (!c) return out
  const candidateBoxes = collisionBoxes(candidate, c)
  const bounds = collisionBounds(candidateBoxes)
  if (!bounds) return out
  for (const { module: m, boxes, bounds: placedBounds } of collisionCandidates(modules, collisionSearchBounds(candidate, bounds))) {
    if ((isOutdoorSurface(m) && !isOutdoorSurface(candidate) && candidate.type !== 'road')
      || (isOutdoorSurface(candidate) && !isOutdoorSurface(m) && m.type !== 'road')) continue
    if (m.type === 'road' && candidate.type === 'road') continue
    if (m === candidate || (candidate.id && m.id === candidate.id)) continue
    if (!isFenceGlassPair(m, candidate) && (!placedBounds || !boxesOverlap(bounds, placedBounds))) continue
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
    if (isPsdCornerPair(m, candidate) || isPsdEndJoin(m, candidate) || isPsdEndCoverSupport(m, candidate)) continue
    if (isTvPair(m, candidate)) continue
    if (isHangingShare(m, candidate)) continue
    // A hung fitting hangs *from* a 站台 or 轨道桥 deck: the deck over its cell
    // is its ceiling, not something in its way. The nominal flush band of a
    // light/vent still overlaps the deck volume, so the pair is let through
    // here — standing on the bed itself stays refused via `placementOnTrack`.
    if ((isCeilingHung(m) && isCeilingTrack(candidate)) || (isCeilingHung(candidate) && isCeilingTrack(m))) continue
    if (curtainDoorShare(m, candidate)) continue
    if (edgeDecorCurtainShare(m, candidate)) continue
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
      if (fenceGlassBlocked(modules, fence, glass, fence === candidate ? fence.id : undefined)) out.push(m)
      continue
    }
    let hit = false
    for (const a of candidateBoxes) {
      if (hit) break
      for (const b of boxes) {
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
    const connections = fenceConnectionIndex(modules), neighbours = new Set<Module>()
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (const fence of connections.fencesAt(candidate.x + dx, candidate.y + dy, candidate.z)) neighbours.add(fence)
    }
    const order = collisionSpatialCache.get(modules)!.order
    for (const fence of [...neighbours].sort((a, b) => order.get(a)! - order.get(b)!)) {
      if (fence.id === candidate.id || out.includes(fence)) continue
      const box = moduleEnvelope(fence, modules)
      if (!box) continue
      const glasses = collisionCandidates(modules, collisionSearchBounds(fence, box))
        .filter(entry => entry.module.type === 'glass' && entry.module.id !== candidate.id)
      if (glasses.some(({ module }) => fenceGlassBlocked(modules, fence, module, candidate.id, candidate))) out.push(fence)
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
  if (m.type === 'roof' && m.cfg.variant === 'canopy') return canopyBodyBoxes(m)
  if (m.type === 'hanger') {
    const boxes = hangerBoxes(m)
    const lift = envelope.z0 - Math.min(...boxes.map(b => b.z0))
    return lift ? boxes.map(b => ({ ...b, z0: b.z0 + lift, z1: b.z1 + lift })) : boxes
  }
  if (!isRampRun(m)) return [envelope]
  // Stairs and escalators occupy their per-tile body slope, even against another
  // run. This leaves the space below an elevated section free while preserving
  // collisions where the actual bodies or landings overlap.
  const body = rampBodyBoxes(m)
  return body.length > 0 ? body : [envelope]
}

/** A run whose body is the slope it sweeps: a stair, an escalator or a level 自动步道. */
function isRampRun(m: Module): boolean {
  return (m.type === 'stair' && !m.cfg.block) || m.type === 'escalator' || m.type === 'walkway'
}

/** A piece whose own space is a run: a stair, an escalator, a 自动步道 or a lift shaft. */
function isRunPiece(m: Module): boolean {
  return m.type === 'stair' || m.type === 'escalator' || m.type === 'walkway' || m.type === 'lift'
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

/** Find a module in the air cell or attached to this exact floor anchor. Same-floor elevated models remain addressable without extending the query to a nominal storey boundary. */
export function moduleAt(
  modules: readonly Module[],
  x: number,
  y: number,
  z: number,
  facing?: readonly [number, number],
  _levelBase = 0,
  _storeyHeight = STOREY_HEIGHT,
  eligible?: (module: Module) => boolean,
): Module | undefined {
  // Exact air-cell overlap; same-anchor models may extend above this cell.
  const cell: ModuleBox = { x0: x, y0: y, z0: z + 1, x1: x + 1, y1: y + 1, z1: z + 2 }
  const hits = (skipRooms: boolean): Module | undefined => {
    for (const m of modules) {
      if (eligible && !eligible(m)) continue
      if (skipRooms && (m.type === 'shop' || m.type === 'booth' || m.type === 'retail')) continue
      if (skipRooms && m.type === 'hanger') continue
      const e = moduleEnvelope(m)
      if (e && boxesOverlap(e, m.z === z ? { ...cell, z1: Math.max(cell.z1, e.z1) } : cell)) return m
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

/** Resolve the pillar at this horizontal anchor only when its physical shaft overlaps the pointed air cell. */
export function pillarAt(
  modules: readonly Module[],
  x: number,
  y: number,
  z: number,
  _levelBase = 0,
  _storeyHeight = STOREY_HEIGHT,
): Extract<Module, { type: 'pillar' }> | undefined {
  const cell: ModuleBox = { x0: x, y0: y, z0: z + 1, x1: x + 1, y1: y + 1, z1: z + 2 }
  return modules.find(
    (m): m is Extract<Module, { type: 'pillar' }> => {
      if (m.type !== 'pillar' || m.x !== x || m.y !== y) return false
      const e = moduleEnvelope(m)
      return !!e && boxesOverlap(e, cell)
    },
  )
}

/** Resolve a lift footprint only when its physical shaft overlaps the pointed air cell. */
export function liftAt(
  modules: readonly Module[],
  x: number,
  y: number,
  z: number,
  _levelBase = 0,
  _storeyHeight = STOREY_HEIGHT,
): Extract<Module, { type: 'lift' }> | undefined {
  const cell: ModuleBox = { x0: x, y0: y, z0: z + 1, x1: x + 1, y1: y + 1, z1: z + 2 }
  return modules.find(
    (m): m is Extract<Module, { type: 'lift' }> => {
      if (m.type !== 'lift') return false
      // The anchor cell owns the whole assembly: the pointer may be on any of
      // its 2 × 2 or 3 × 3 columns and on any storey the shaft reaches.
      const size = liftSizeOf(m)
      if (x < m.x || x >= m.x + size || y < m.y || y >= m.y + size) return false
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
 * and a 电梯's landings are stacked an interval at a time (`liftExtendedUp`/`Down`
 * never ask for floor), so no single verdict can say where a moved shaft lands. Those
 * are torn down and built again by hand.
 *
 * A free-standing 支柱 is the exception: it owns no document cells, carves nothing
 * and derives nothing, so a 移动 is a plain translation (`movedModule`'s default
 * branch) re-checked by `moveDropReason` at the drop.
 */
const MOVABLE_TYPES: ReadonlySet<string> = new Set([
  'tree',
  'monitor', 'traffic-light', 'rail-signal',
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
  // A 自动步道 is a level run: it owns no floor of its own (the floor under it is
  // there for its whole length) and carves nothing, so it rebuilds on a move for
  // one reason — the run's `from`/`to` are world cells and have to be re-laid.
  'walkway',
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
 * carves nothing), a 扶梯, or a 自动步道.
 *
 * The three are re-laid where they land rather than translated, because a stair or
 * escalator opens the slab it climbs through, so the piece has to be out of `modules`
 * while it is in the air and in them again before the carve runs at its new cell. (A
 * walkway carves nothing, but its `from`/`to` still have to move with it.) A legacy
 * save's turning stair may also still own the half-landing block the old builder laid;
 * `removeModule` takes that back out as the piece leaves. That is exactly the pair a
 * player would drive by hand (`moveEquipment`), and it is one commit: one `Ctrl+Z` puts
 * the run back, a legacy landing block and all. The opening a run **carved** where it
 * stood is left behind, exactly as it is when a run is deleted; a 方块 may be laid in it
 * again (it is no longer a reserved opening).
 */
export function moveRebuilds(m: Module): boolean {
  return (m.type === 'stair' && m.cfg.block !== true) || m.type === 'escalator' || m.type === 'walkway'
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
  if (m.type === 'stair' || m.type === 'escalator' || m.type === 'walkway') {
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
    if (m.type === 'escalator' || m.type === 'walkway') {
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
  const footprint = candidate.type === 'roof' && candidate.cfg.variant === 'canopy' ? canopyPostCells(candidate) : candidate.type === 'hanger'
    ? hangerPostCells(candidate)
    : candidate.type === 'stair' && !candidate.cfg.block
      ? [[candidate.x, candidate.y] as [number, number]]
      // A 自动步道 lies on the ground for its whole length: the belt covers every
      // cell between its landings, so all of them need floor, not just the two ends.
      : candidate.type === 'walkway'
        ? [...walkwayLandings(candidate), ...walkwayCoveredCells(candidate)].map((p) => [p.x, p.y] as [number, number])
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
  | 'road-width' | 'road-ground' | 'opening'
  | ''
  | 'exit-on-slab'
  | 'exit-below-ground'
  | 'bridge-below-ground'
  | 'outdoor-below-ground'
  | 'floor'
  | 'track'
  | 'occupied'
  | 'wall'
  | 'booth-width'
  | 'ceiling'
  | 'escalator-bases'
  | 'lift-footprint'

/**
 * May `candidate` stand where it is? The **one** rule set for a module: the
 * equipment hover, the release, a fence run's own cells and a lifted piece's drop
 * all ask this, so a ghost can never promise a piece the release refuses.
 *
 * Every rule here was already enforced by the builder, gathered rather than
 * changed: the ground under each full floor-standing footprint (ramps check their
 * own footing), the storey an 出入口
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
  if (candidate.type === 'psd-end' && candidate.cfg.variant === 'cover' &&
    !modules.some((m) => isPsdEndCoverSupport(candidate, m))) return 'floor'
  if (isOutdoorSurface(candidate)) {
    if (candidate.z < 0) return 'outdoor-below-ground'
    const { x, y, z } = candidate, occupied = blockIndex(cells, modules)
    if (occupied.opening(x, y, z)) return 'opening'
    if (occupied.solid.has(surfaceKey(x, y, z + 1))) return 'occupied'
    if (!occupied.solid.has(surfaceKey(x, y, z)) && !occupied.ground(x, y, z) && !exitFloorAt(modules, x, y, z)) return 'floor'
    if (occupied.track.has(surfaceKey(x, y, z))) return 'track'
    const index = outdoorSurfaceIndex(modules)
    // §4.3/§9.5: a tile carries **one** finish, and laying the other kind on it is a
    // **replacement**, not a collision — the release deletes the finish under the
    // candidate before it lays this one (`editOutdoorSurfaces`), so the ghost and the
    // release agree that the tile changes hands. Laying the *same* kind back is that
    // drag's "already here" no-op rather than a replacement, and stays a collision.
    const existing = index.tiles.get(surfaceKey(x, y, z))
    if (existing && existing.id !== candidate.id && existing.type === candidate.type) return 'occupied'
    const box = moduleEnvelope(candidate)!
    if (index.roads.some(road => boxesOverlap(box, moduleEnvelope(road)!))) return 'occupied'
    return ''
  }
  if (candidate.type === 'tree' && candidate.z < 0) return 'outdoor-below-ground'
  if (isOutdoorSurface(candidate) || candidate.type === 'tree') {
    const box = moduleEnvelope(candidate, modules)!
    if (cells.some(c => c.fill === 'solid' && boxesOverlap(box, { x0: c.x, x1: c.x + 1, y0: c.y, y1: c.y + 1, z0: c.z, z1: c.z + 1 }))) return 'occupied'
  }
  if (candidate.type === 'road') {
    const width = (candidate.rot ?? 0) % 2 ? candidate.d : candidate.w
    if (width < (candidate.cfg.direction === 'two-way' ? ROAD_LANE_WIDTH * 2 : ROAD_LANE_WIDTH)) return 'road-width'
    const surface = roadSurfaceReason(cells, modules, candidate)
    if (surface) return surface
    return placementColliders(modules, candidate).length ? 'occupied' : ''
  }

  if (candidate.type === 'hanger') {
    if (hangerRoofMissing(cells, modules, candidate)) return 'ceiling'
    if (!moduleFloorOk(cells, modules, candidate)) return 'floor'
    const boxes = hangerBoxes(candidate)
    if (cells.some((c) => c.fill === 'solid' && boxes.some((box) => boxesOverlap(box, { x0: c.x, y0: c.y, z0: c.z, x1: c.x + 1, y1: c.y + 1, z1: c.z + 1 })))) return 'occupied'
    if (placementOnTrack(cells, candidate, modules)) return 'track'
    return placementColliders(modules, candidate).length > 0 ? 'occupied' : ''
  }
  if (candidate.type === 'traffic-light' || candidate.type === 'rail-signal' || candidate.type === 'shelf' || candidate.type === 'checkout' || candidate.type === 'desk' || candidate.type === 'ac-unit' || candidate.type === 'electrical-cabinet' || isFloorSticker(candidate)) {
    const box = moduleEnvelope(candidate, modules)!
    if (cells.some((c) => c.fill === 'solid' && boxesOverlap(box, { x0: c.x, y0: c.y, z0: c.z, x1: c.x + 1, y1: c.y + 1, z1: c.z + 1 }))) return 'occupied'
  }
  if (((candidate.type === 'cctv' && candidate.cfg.variant === 'post') || candidate.type === 'traffic-light' || candidate.type === 'guidepost' || candidate.type === 'busstop') && candidate.z < 0) return 'outdoor-below-ground'
  if (candidate.type === 'exit' && (candidate.cfg as { style?: string }).style === 'virtual' && candidate.z < 0) return 'outdoor-below-ground'
  if (candidate.type === 'track' && candidate.cfg.bridge && candidate.z < BRIDGE_MIN_Z) return 'bridge-below-ground'
  if (candidate.type === 'stair' && candidate.cfg.block && cells.some((c) => c.fill === 'solid' && c.x === candidate.x && c.y === candidate.y && c.z === candidate.z + 1)) return 'occupied'
  if (candidate.type === 'roof' && candidate.cfg.variant && candidate.z < 0) return 'exit-on-slab'
  if (candidate.type === 'roof') {
    if (candidate.cfg.variant === 'canopy' && !moduleFloorOk(cells, modules, candidate)) return 'floor'
    if (placementColliders(modules, candidate).length > 0) return 'occupied'
    const box = moduleEnvelope(candidate, modules)!
    const boxes = collisionBoxes(candidate, box)
    for (const c of solidCellsInBounds(cells, box)) {
      if (c.fill === 'solid' && boxes.some(b => boxesOverlap(b, { x0: c.x, y0: c.y, z0: c.z, x1: c.x + 1, y1: c.y + 1, z1: c.z + 1 }))) return 'occupied'
    }
    return ''
  }
  if (candidate.type === 'pillar') {
    const box = moduleEnvelope(candidate, modules)!
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
    if (wallMountMissing(cells, candidate, modules)) {
      // A board bolted to the right booth face, at the right height, that this booth
      // cannot hold is a **width** problem. Saying "no solid wall behind it" would
      // send the player looking for a wall behind a header that already backs it.
      const booth = candidate.type === 'sign' && candidate.cfg.boothId
        ? modules.find((m) => m.type === 'booth' && m.id === candidate.cfg.boothId)
        : undefined
      if (booth && boothHoldsSign(booth, candidate) && !boothSignFits(booth, candidate)) return 'booth-width'
      return 'wall'
    }
    return placementColliders(modules, candidate).length > 0 ? 'occupied' : ''
  }
  // A **hung** 装饰 — a 指示牌, 电视, 时钟 or 监控 — is the wall panel's twin one step
  // higher: its rods bolt to the slab overhead, so the floor cell it is anchored to
  // (`ceilingMountStandCell`, the storey the save reads) is the room's, not its own,
  // and the ground rule would refuse it over a well or over the rails where a slab
  // really does hang it — with a notice about floor under a piece three metres up.
  // It is still refused standing on a track bed, in another piece's space and
  // under open sky — but a 站台 or 轨道桥 deck over its cell is its ceiling, not
  // the bed it stands on (`placementOnTrack` lets a hung fitting hang under one).
  if (!(candidate.type === 'psd-end' && candidate.cfg.variant === 'cover' && modules.some((m) => isPsdEndCoverSupport(candidate, m))) &&
    !isCeilingHung(candidate) && candidate.type !== 'escalator' && !moduleFloorOk(cells, modules, candidate)) {
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
      case 'opening': return msg('keep_openings_clear_do_not_cover_stairs_escalators_or_entrances_')
      case 'road-width': return msg('road_width_refusal')
      case 'road-ground': return msg('road_ground_refusal')
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
      case 'booth-width':
        return msg('the_board_is_wider_than_the_booth_header_remove_some_content_or_build_a')
      case 'ceiling':
        return msg('hung_signs_tvs_clocks_and_cameras_need_a_slab_4_m_above_wall_sig')
      case 'escalator-bases':
        return msg('the_escalator_bottom_needs_a_solid_floor')
      case 'lift-footprint':
        return msg('a_lift_needs_a_floor_under_its_whole_footprint')
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
  if (m.type === 'psd-end' && m.cfg.variant === 'cover') return msg('screen_door_cover')
  if (m.type === 'fence') return m.cfg.variant === 'sound-barrier' ? msg('full_height_noise_barrier') : m.cfg.variant === 'sound-barrier-half' ? msg('half_height_noise_barrier') : m.cfg.variant === 'bridge-railing' ? msg('railing') : m.cfg.variant === 'gate' ? msg('door') : m.cfg.variant === 'iron' ? msg('iron_fence') : msg('glass_fence')
  if (m.type === 'shop') {
    const kind = (m.cfg as { kind?: string } | undefined)?.kind
    if (kind === 'toilet') return msg('restroom')
    if (kind === 'office') return msg('office')
    return msg('store')
  }
  if (m.type === 'booth' && (m.cfg as { kind?: string } | undefined)?.kind === 'info') return msg('information_desk')
  if (m.type === 'cctv') {
    if (m.cfg.variant === 'post') return msg('post_camera')
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
  sidewalk: msg('sidewalk'), lawn: msg('lawn'), tree: msg('tree'),
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
  road: msg('road'),
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
  'traffic-light': msg('traffic_light'),
  'rail-signal': msg('rail_signal'),
  sign: msg('sign'),
  exit: msg('entrances'),
  escalator: msg('escalator'),
  walkway: msg('walkway'),
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
  if (moved.type !== 'hanger' && isCeilingHung(moved)) moved = {
    ...moved, ceilingAnchored: topBlockOver(cells, moved, modules) || undefined,
  }
  if (moved.type === 'sign' && moved.cfg.mount === 'wall') {
    moved = snapSignToBooth(modules, moved, near ?? [at.x + 0.5, at.y + 0.5], at.z)
  }
  moved = autofaceWallMount(cells, moved, near, modules, facing)
  if (moved.type === 'psd-end') moved = moved.cfg.variant === 'cover'
    ? snapPsdEndCover(moved, modules) ?? moved
    : snapPsdEnd(moved, modules)
  return { module: moved, reason: moveDropReason(cells, modules, moved) }
}
