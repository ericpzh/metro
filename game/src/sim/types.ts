// Station data model. Pure types shared by the build tools, the sim graph and
// the save format (§10.5). Ids stay ASCII per §9.2 even though the UI is Chinese.

import type { ShelfVariant } from './shelves.ts'
import type { StockClass } from './stock.ts'
import type { SignLayout, SignMount } from './sign.ts'
import type { PeakWindows, TimeSpan } from './constants.ts'
import type { DemandKnobs } from './demand.ts'
import type { SimCalendar } from './clock.ts'

export type Fill = 'solid' | 'void'

/** The six faces of a cell, §4.1. `+z` is up; `n` is `+y`, `e` is `+x`. */
export type Face = 'top' | 'bottom' | 'n' | 'e' | 's' | 'w'
export const FACES: readonly Face[] = ['top', 'bottom', 'n', 'e', 's', 'w']

/** ASCII finish id, e.g. `floor.granite`. See `sim/finishes.ts`. */
export type FinishId = string

/**
 * Fare zones — GAME-SPEC.md §4.5. Every floor cell belongs to exactly one, and
 * a gate is the only legal crossing between `unpaid` and `paid`. A cell that
 * carries no label reads `none` — **无分区**: nobody has said what it is, and the
 * game does not guess (`zoneOf`, `sim/zones.ts`). 无分区 is on the unpaid side of
 * the fare line, so an unzoned station has no internal barriers.
 */
export type Zone = 'none' | 'outside' | 'unpaid' | 'paid' | 'platform' | 'restricted'
export const ZONES: readonly Zone[] = ['none', 'outside', 'unpaid', 'paid', 'platform', 'restricted']
/** The zone of a cell with no label of its own: **无分区** (`zoneOf`). */
export const DEFAULT_ZONE: Zone = 'none'

/**
 * A fare gate's pass policy, §4.5. `in` is entry only (unpaid → paid), `out` is
 * exit only (paid → unpaid) and `both` passes either — but only one direction at
 * a time, because a two-way turnstile is a single lane (§7.1).
 */
export type GateMode = 'in' | 'out' | 'both'
/**
 * What a 闸机 is: a working turnstile or the machine that closes a run. Cycled on
 * the rail with Tab. `lane` (the default) is the real gate — a machine body on
 * one half of the block and a lane, with its sliding leaf, on the other, so the
 * crowd passes through it. `fence` is the **doorless** machine: the same body on
 * the same half, with fence on the other half, so a 围栏 run carries on through
 * its own cell and nobody walks through it — it crosses no fare line either.
 *
 * Which *hand* the lane is on is not a setting: `R` turns the whole piece, so the
 * mirrored gate is one 180° rotation away (`rot` 2), and a quarter turn puts the
 * machine on either of the other two sides.
 */
export type GateDoor = 'lane' | 'fence'
/**
 * The door spelling an older save may still carry: the side it was on (`right` /
 * `left`) before the mirror became a rotation, or `none` for the doorless
 * machine. Read through `gateDoorOf`, never directly.
 */
export type GateDoorStored = GateDoor | 'right' | 'left' | 'none'
/**
 * Direction of a fare-line crossing: `1` entry, `-1` exit, `0` unknown (both
 * sides the same zone). See `crossingDir` in `sim/zones.ts`.
 */
export type GateDir = -1 | 0 | 1

/**
 * Pack an integer cell coordinate into one Number for `Set`/`Map` keys.
 * Number arithmetic, not bit shifts: `(x + 4096) << 20` overflows 32 bits and
 * makes neighbouring cells collide, which silently corrupts solidity and
 * finishes. Coordinates are limited to ±4096 m, which is far past any station.
 */
export function packKey(x: number, y: number, z: number): number {
  const OFF = 4096
  const SPAN = 8192
  return ((x + OFF) * SPAN + (y + OFF)) * SPAN + (z + OFF)
}

export interface Cell {
  x: number
  y: number
  z: number
  fill: Fill
  /**
   * Sparse per-face finish override (§4.1, §4.3). An absent face is that face's
   * family default, so untouched cells cost nothing in memory or in a save.
   */
  finish?: Partial<Record<Face, FinishId>>
  /**
   * Fare zone (§4.5). Absent = **无分区** (`DEFAULT_ZONE`): the cell carries no
   * label, and the game reads it as unzoned rather than guessing a fare side
   * (`zoneOf`, `sim/zones.ts`).
   */
  zone?: Zone
  tags?: string[]
}

export interface Vec3i {
  x: number
  y: number
  z: number
}

/**
 * A horizontal direction — `n` is `+y` and `e` is `+x`, the same convention the
 * faces use. It names the half of a cell a **半墙** (half-block wall) is flush to:
 * `w` is the cell's `x ∈ [x, x + 0.5]` half, `n` its `y ∈ [y + 0.5, y + 1]` half.
 * The 墙 tool's `WallDir` is this same union (`build/model.ts`).
 */
export type WallSide = 'n' | 'e' | 's' | 'w'

/**
 * Tag prefix on a 半墙 course: `half-wall:w`. A thin wall is an ordinary solid
 * wall cell — same course, same column lift, same slice — that draws half a block
 * thick (`render/chunkMesher.ts`), the way a facility room's own walls and the
 * panel a ramp leaves beside a run already do. The side is the face the panel
 * shows to open space, so the half of the cell a player built into is the half the
 * wall occupies and the clear half stays usable, which is the whole point of the
 * piece. Stored on the cell rather than derived, because a partition standing in
 * open floor has no geometry to derive a thickness from.
 */
export const HALF_WALL = 'half-wall'

export function halfWallTag(side: WallSide): string {
  return `${HALF_WALL}:${side}`
}

const WALL_SIDES: readonly WallSide[] = ['n', 'e', 's', 'w']

/** The side a 半墙 cell's panel hugs, or null for any other block. */
export function halfWallSide(c: { tags?: string[] }): WallSide | null {
  const tags = c.tags
  if (!tags) return null
  for (const t of tags) {
    if (!t.startsWith(`${HALF_WALL}:`)) continue
    const side = t.slice(HALF_WALL.length + 1) as WallSide
    if (WALL_SIDES.includes(side)) return side
  }
  return null
}

/* ------------------------------------------------------ 三角 (triangle) blocks */

/**
 * The side of its cell a **三角** block stands its **full-height face** on — `w` is
 * the cell's west face, so the block is a whole metre tall there and its 45° cut
 * falls away to the east. It is the same four letters a **半墙** stores, because it
 * answers the same question — which side of the tile does this piece hug — and a
 * quarter-turn takes any of the four to the next, which is why **R** steps it.
 */
export type TriSide = WallSide

/**
 * The two cuts a **三角** block comes in, toggled on the rail. Both put the cell on
 * a 45° plane in **elevation**, so the piece is a wedge: one flat 1 m square in the
 * X-Y plane, the full-height square face on `side`, the 45° slope across the cell
 * and two sharp triangular ends. They differ in which half of the cell the wedge
 * is, which is what the rail's 三角上 / 三角下 names:
 *
 * * `upper` (三角上) — the **base is the floor**, the tip line at `+z`: the flat
 *   square lies in the X-Y plane at the cell's own floor, the block is a full metre
 *   tall along `side` and the slope runs from the top of that face down to the
 *   opposite floor edge. The lower half of the cell, so the piece is a ramp.
 * * `lower` (三角下) — the **base is the ceiling**, the tip line at `-z`: the flat
 *   square is the cell's ceiling, the full-height face is still on `side`, and the
 *   slope runs from that face's floor edge up to the opposite ceiling edge. The
 *   upper half of the cell, so the piece is the soffit under a diagonal.
 *
 * Four sides each, and the eight together are every way a cell admits this wedge.
 */
export type TriangleKind = 'upper' | 'lower'

/** Every side, in the order **R** steps them (a clockwise quarter-turn). */
export const TRI_SIDES: readonly TriSide[] = ['n', 'e', 's', 'w']

const TRI_SIDE_SET: readonly string[] = TRI_SIDES

/**
 * Tag prefix on a **三角** block: `tri-upper:w`. Two families rather than one
 * because the pair is two shapes, not one shape turned — 上 stands its base on the
 * floor and 下 hangs it from the ceiling, and no rotation makes one into the other.
 * **R** then steps the side the block hugs, so the two families together span the
 * eight wedges a cell admits.
 */
export const TRI_UPPER = 'tri-upper'
export const TRI_LOWER = 'tri-lower'

export function triangleTag(kind: TriangleKind, side: TriSide): string {
  return `${kind === 'upper' ? TRI_UPPER : TRI_LOWER}:${side}`
}

/**
 * The wedge a cell is, or null for any other block. The `kind` is which half of the
 * cell it is (base on the floor or on the ceiling) and the `side` the face it hugs.
 */
export function triangleOf(c: { tags?: string[] }): { kind: TriangleKind; side: TriSide } | null {
  const tags = c.tags
  if (!tags) return null
  for (const t of tags) {
    const at = t.indexOf(':')
    if (at < 0) continue
    const family = t.slice(0, at)
    if (family !== TRI_UPPER && family !== TRI_LOWER) continue
    const side = t.slice(at + 1)
    if (!TRI_SIDE_SET.includes(side)) continue
    return { kind: family === TRI_UPPER ? 'upper' : 'lower', side: side as TriSide }
  }
  return null
}

/**
 * Every block that is **not** a full cell, by packed cell key → the shape it draws
 * (`render/chunkMesher.ts`): a 半墙 panel or a 三角 wedge. One list, so the mesher,
 * the build ghost and the paint brush cannot disagree about which cells are cut.
 */
export type CellShape =
  | { kind: 'half'; side: WallSide }
  | { kind: 'triangle'; triangle: TriangleKind; side: TriSide }

/** The cut shape of a block, or null when it fills its whole cell. */
export function shapeOf(c: { tags?: string[] }): CellShape | null {
  const half = halfWallSide(c)
  if (half !== null) return { kind: 'half', side: half }
  const tri = triangleOf(c)
  if (tri !== null) return { kind: 'triangle', triangle: tri.kind, side: tri.side }
  return null
}

/** True when a cell draws a 半墙 panel rather than a whole cell. */
export function isHalfWallShape(shape: CellShape | null | undefined): shape is { kind: 'half'; side: WallSide } {
  return shape?.kind === 'half'
}

/**
 * True when a cell draws a **三角** wedge rather than a whole cell: the cell cut on
 * a 45° plane in elevation, so the piece is one flat 1 m square in the X-Y plane,
 * one full-height square, the slope across the cell and two sharp triangular ends.
 * It is a piece the player lays like a 半墙 — one click, one course — and a ramp
 * keeps it rather than carving it, exactly as it does a 半墙.
 */
export function isTriangleShape(shape: CellShape | null | undefined): shape is { kind: 'triangle'; triangle: TriangleKind; side: TriSide } {
  return shape?.kind === 'triangle'
}

/**
 * The cell's own face a **三角**'s **slope** wears: `top` for 上, whose slope faces up
 * the way a floor does, and `bottom` for 下, whose slope faces down the way a ceiling
 * does. It is the horizontal face the diagonal leans to, and the one the pointer reads
 * off it — a 45° normal ties on two axes and `faceAxis` gives the vertical one
 * (`render/pickCell.ts`), so the brush and the mesher must name the same slot.
 *
 * The slope is a face of the **piece**, not of its cell, which is why the three rules
 * that touch it read it from here rather than from the cell's neighbours:
 * `pushWedge` draws it in this finish, `facePresent` (`build/model/Paint.ts`) offers it
 * as a surface to paint, and the paint ghost (`GhostSystem`) puts its quad on the sawn
 * plane. A wedge dropped with a block over it has a slope the boundary rule alone would
 * call covered — and one the player can still see and paint.
 */
export function triangleSlopeFace(kind: TriangleKind): 'top' | 'bottom' {
  return kind === 'upper' ? 'top' : 'bottom'
}

/**
 * The face of a 半墙 cell the panel turns **into its own cell**: the surface
 * looking across the clear half, half a block in from the cell's far side. It is a
 * real surface even when the neighbouring cell is solid — nothing can stand in the
 * clear half, because the clear half is inside this cell — which is why the paint
 * brush offers it (`faceTargets` / `fillSurface`) and why the mesher always draws
 * it. `render/scene.ts` insets the paint ghost onto it for the same reason.
 */
export function halfWallInnerFace(side: WallSide): WallSide {
  return side === 'n' ? 's' : side === 's' ? 'n' : side === 'e' ? 'w' : 'e'
}

/**
 * True when a cell is a wall the player or the 方块 tool raised, a 半墙, or a
 * tunnel's shell. The tag strings mirror `build/model.ts` (`WALL` / `AUTO_WALL` /
 * `HALF_WALL`) and `build/rail.ts` (`tunnel-shell:<id>`); they live here so the
 * pure sim can recognise a wall without importing `build/`. A plain block has no
 * tags and is not a wall.
 *
 * A 半墙 counts as a wall for every rule that asks about walls, because that is
 * what it is: a ramp keeps it instead of carving it (`carveRampOpenings`), a
 * wall-mounted 广告牌 may bolt to it (`wallMountMissing`), and the crowd is blocked
 * by its cell exactly as a full course blocks one. A **三角** is the same kind of
 * piece — a course the player laid, wearing a cut — so it answers here too, and the
 * wall tools can lift it like any other column.
 */
export function isWallBlock(c: { tags?: string[] }): boolean {
  const tags = c.tags
  if (!tags) return false
  for (const t of tags) {
    if (t === 'wall' || t === 'auto-wall' || t.startsWith('tunnel-shell:')) return true
    if (t.startsWith(`${HALF_WALL}:`) || t.startsWith(`${TRI_UPPER}:`) || t.startsWith(`${TRI_LOWER}:`)) return true
  }
  return false
}

/**
 * Number of escalator/stair bays an exit head-house opens (出入口 §5.6): one
 * (单向), two (双向, the reference head-house) or three (三向). The bays sit at
 * fixed local x offsets (`exitBayOffsets`), and the floor, walls and model all
 * widen to match, so the drawn openings and the sim barrier agree.
 */
export type ExitBays = 1 | 2 | 3

export interface ExitCfg {
  style?: 'doorway'
  name: string
  /** Street → station demand, pax/hour at peak. Outflow is unlimited: an exit
   *  is a pure opening and passes as many people as the corridors deliver. */
  inRate: number
  open: boolean
  /**
   * Whether the exit is a covered head-house. A head-house is solid in the sim:
   * the crowd crosses at the street opening and never through the glass sides or
   * the back wall, and the exit's node is that opening. Set `false` for a bare
   * portal (small test stations). Default `true`.
   */
  headHouse?: boolean
  /**
   * Whether the head-house has a canopy and walls. `true`/absent is the covered
   * portal (有盖); `false` is the open exit (无盖) that drops the walls and roof
   * for a railing round the pit. The railing is still a sim barrier, so only the
   * look changes.
   */
  covered?: boolean
  /** How many bays the head-house opens: 1, 2 (default) or 3. */
  bays?: ExitBays
}

export interface ModuleBase {
  id: string
  x: number
  y: number
  z: number
  rot?: number
}

/**
 * Fit-out of a walled facility room (the `shop` module type is the generic
 * walled room): a shop (商店), a toilet (厕所) or an office (办公室). The
 * rectangle-drag builder writes it into `shop.cfg.kind`, and the renderer picks
 * the interior and the sign from it, so all three share one wall/opening model.
 */
export type RoomKind = 'store' | 'toilet' | 'office'

/**
 * A billboard's format (装饰, §5.7). The variant fixes both the run length in
 * cells and the lit poster's aspect ratio, so one 广告牌 tool offers a small
 * landscape, a standard, a wide two-cell banner, a three-cell panoramic strip,
 * a tall portrait and a square.
 */
export type BillboardVariant = 'wide' | 'standard' | 'large' | 'panorama' | 'portrait' | 'square'

/**
 * The poster silhouette a billboard format is cut for (`sim/billboards.ts`).
 * Distinct from `BillboardVariant` because two formats may share one silhouette
 * (大横版 and 标准 both play a landscape) while a variant names one exact piece
 * of furniture. The renderer only needs the silhouette: the poster table filters
 * its slugs by it so a chosen poster is the right shape for the panel.
 */
export type BillboardShape = 'landscape' | 'wide' | 'panorama' | 'portrait' | 'square'

/**
 * A bench's variant (装饰 座椅, §5.7). Two families — a plain stainless bench
 * with no back and an upholstered seat with a back and arm rests that chains
 * into a row — each in a 1 m and a 2 m width, so one 座椅 tool offers four
 * pieces (`sim/benches.ts`).
 */
export type BenchVariant = 'steel-1' | 'steel-2' | 'seat-1' | 'seat-2'

/**
 * A glass panel's size (装饰 玻璃板, §5.7): the run in cells by the height in
 * metres, as `1x1` … `4x4`. The short sizes are wall-mounted; the 4 m panels stand
 * on floor edges like a doorway (`sim/glassPanels.ts`).
 */
export type GlassVariant = '1x1' | '2x1' | '3x1' | '1x2' | '2x2' | '3x2' | '2x4' | '3x4' | '4x4'

/**
 * The two things a 门 is made of (装饰, §5.7): the leaf count and the material. A
 * 单开 door is one leaf and one cell wide, a 双开 a pair meeting in the middle over
 * two cells; the material is 不锈钢 or 木, which is the finish of the frame, the
 * leaves and the handle together (`sim/doors.ts` paints both from one table).
 */
export type DoorMaterial = 'steel' | 'wood'

/**
 * A swing door's variant (装饰 门, §5.7): `<material>-<leaves>`, as `steel-1` …
 * `wood-2`. The piece is the same framed door the 办公室 closes its doorway with
 * (`render/models/pieces/DoorModel.ts`), so the variant names one piece of
 * furniture rather than a mount.
 */
export type DoorVariant = 'steel-1' | 'steel-2' | 'wood-1' | 'wood-2'

/**
 * The hand a 站名 inscription is written in (§5.7): 楷书, 行书, 隶书, 魏碑, 黑体
 * or 宋体. The hand is a font stack, an ink and a stroke treatment
 * (`sim/calligraphy.ts`), so the same station name reads six different ways.
 */
export type CalligraphyStyle = 'kai' | 'xing' | 'li' | 'wei' | 'hei' | 'song'

/**
 * Which way a 站名 runs: `h` 横排 along the wall, `v` 竖排 down it.
 */
export type CalligraphyAxis = 'h' | 'v'

/**
 * How a 线网图 is mounted (§5.7): `wall` is the framed board bolted flat to a wall
 * and read from one side, `stand` the free-standing double-sided totem that
 * reserves its own cell of floor.
 */
export type LineMapVariant = 'wall' | 'stand'

/**
 * A staircase's plan shape (§5.1). A stair always climbs exactly one storey;
 * the style decides how the flights turn. `straight` is one run, the `90`
 * styles climb one flight, turn, then climb a second, and the `180`s are
 * switchbacks: two parallel flights with a half-landing between them, which
 * differ only in the hand the return flight is on — `right180` turns the run
 * back on its right, `left180` on its left.
 */
export type StairStyle = 'straight' | 'right90' | 'left90' | 'right180' | 'left180'

/** One flight of a stair: a straight run of treads from one landing to the next. */
export interface StairFlight {
  from: Vec3i
  to: Vec3i
}

export type BridgeRailing = 'railing' | 'sound-barrier-half' | 'sound-barrier'

export type Module =
  | (ModuleBase & { type: 'pillar'; cfg: { size: 'slim' | 'thick'; height: number; finish?: FinishId; bridgeId?: string } })
  | (ModuleBase & { type: 'roof'; w: number; d: number; cfg: { variant?: 'shell' | 'truss' | 'tapered-truss'; finish?: FinishId } })
  | (ModuleBase & { type: 'exit'; cfg: ExitCfg })
  | (ModuleBase & { type: 'gate'; cfg: { dir: GateMode; door?: GateDoor } })
  | (ModuleBase & { type: 'psd-end'; cfg: { psd: 'half' | 'full'; offset?: [number, number]; corner?: string } })
  | (ModuleBase & { type: 'fence'; cfg: Record<string, never> })
  | (ModuleBase & { type: 'escalator'; from: Vec3i; to: Vec3i; cfg: { dir: 'up' | 'down'; width?: 1 | 2 } })
  | (ModuleBase & {
      type: 'stair'
      /**
       * The first and last landings — kept for every consumer that reads a stair
       * as a plain run. `cfg.flights` is the authoritative geometry: `from` is
       * `flights[0].from` and `to` is `flights[last].to`.
       */
      from: Vec3i
      to: Vec3i
        cfg: {
          /** A solid 1×1×1 m stepped block, without rails or a carved well. */
          block?: boolean
          /** Height of a small stair block; existing saves default to 1 m. */
          blockHeight?: 0.5 | 1
          width: number
        style?: StairStyle
        /** Ordered flight segments, bottom → top. Defaults to one straight run. */
        flights?: StairFlight[]
        /**
         * The token every lane of one wide flight carries, so a 2- or 3-lane
         * stair placed in one action is known to be **one staircase**: the rail
         * along a seam between lanes that share it is dropped and the steps run
         * across. Lanes placed separately never share one, so their rails stay —
         * two 0.7 m stairs you drop side by side are two staircases whose steps
         * happen to meet, not one 1.4 m stair (`sim/stairs.ts`).
         */
        flight?: string
        /**
         * The finish a player has **painted on the stair's walking surface**
         * (§4.3, 材质): its treads, their risers and the half-landing platform are
         * drawn from one material, and this names it. Absent — the usual case —
         * the stair wears the top finish of the floor it climbs from, so a
         * staircase in a granite hall is granite and a tiled one is tiled; a
         * painted stair keeps its own finish wherever it stands. Purely cosmetic:
         * a flight is walked at `STAIR_SPEED` whatever it is finished with.
         */
        finish?: FinishId
      }
    })
  | (ModuleBase & { type: 'lift'; from: Vec3i; to: Vec3i; cfg: { style?: 'glass' | 'steel' } })
  | (ModuleBase & { type: 'tvm'; cfg: Record<string, never> })
  /**
   * A drinks vending machine (自动贩卖机): the same 1 × 1 m equipment footprint
   * and stop behaviour as a TVM, with a different cabinet — a glass display of
   * drinks beside a face-pay control strip. A distinct type so the renderer can
   * draw it and the label reads 自动贩卖机.
   */
  | (ModuleBase & { type: 'vending'; cfg: Record<string, never> })
  /**
   * A bench (座椅, 装饰): the platform bench as a free-standing piece. `cfg.variant`
   * picks the look and width — a plain stainless bench with no back or an
   * upholstered seat with a back and arm rests, each 1 m or 2 m wide
   * (`sim/benches.ts`). `w` is the run length in cells along local +x, kept on the
   * module so the collision envelope and the drawn run cannot disagree; a legacy
   * bench with neither field is the 1 m stainless piece. `cfg.auto` marks a staff
   * bench the room builder laid out itself.
   */
  | (ModuleBase & { type: 'bench'; w?: number; cfg: { auto?: boolean; variant?: BenchVariant } })
  /**
   * A goods shelf (货架, 装饰): the same unit the 商店 fit-out stocks along its
   * island rows and wall runs (§5.7), as a free-standing floor piece. It turns
   * with the placement rotation like any equipment and may stand inside a
   * walled room (see the shelf ↔ room exemption in `placementBlocked`).
   * `cfg.auto` marks a shelf the room builder laid out itself, so bulldozing
   * the room takes its own shelves but leaves hand-placed ones behind.
   */
  | (ModuleBase & { type: 'shelf'; cfg: { auto?: boolean; variant?: ShelfVariant } })
  /**
   * An office desk (办公桌, 装饰): the desk + monitor + chair unit the 办公室
   * fit-out stocks on its grid (§5.7), as a free-standing floor piece. Like a
   * shelf it turns with the placement rotation, may stand inside a walled room,
   * and `cfg.auto` marks a unit the room builder laid out itself.
   */
  | (ModuleBase & { type: 'desk'; cfg: { auto?: boolean } })
  /**
   * One cubicle of a restroom (隔间, 装饰): the partition + WC + tank unit the
   * 厕所 fit-out stocks along its back row (§5.7), as a free-standing floor
   * piece. Turns with the placement rotation, may stand inside a walled room,
   * and `cfg.auto` marks a unit the room builder laid out.
   */
  | (ModuleBase & { type: 'cubicle'; cfg: { auto?: boolean } })
  /**
   * A wash basin (洗手池, 装饰): the basin + tap unit the 厕所 fit-out stocks
   * along its front wall (§5.7). Same rules as a cubicle.
   */
  | (ModuleBase & { type: 'sink'; cfg: { auto?: boolean } })
  /**
   * A litter bin (垃圾桶, 装饰): the stainless double bin of the reference — two
   * compartments under one stainless top, a dark liner behind an open front with
   * a centre divider and a perforated drain tray, and the 可回收物 / 其它垃圾 marks
   * printed on the front band above the openings. A free-standing floor piece
   * that turns with the placement rotation like any equipment, and purely
   * cosmetic: it is no server and no stop, so it never changes the crowd.
   */
  | (ModuleBase & { type: 'guidepost'; cfg: { exitId?: string } })
  | (ModuleBase & { type: 'busstop'; w: number; d: number; cfg: { variant: 'short' | 'long'; poster?: string } })
  | (ModuleBase & { type: 'bin'; cfg: Record<string, never> })
  /**
   * A fire-extinguisher cabinet (灭火器, 装饰): the red steel box on four legs of
   * the reference — a slight lid overhang, a two-door front carrying 灭火器箱 /
   * FIRE EXTINGUISHER BOX over 火119警 in white, and a recessed side handle.
   * Free-standing and rotatable; cosmetic, like the bin.
   */
  | (ModuleBase & { type: 'extinguisher'; cfg: Record<string, never> })
  /**
   * A station clock (时钟, 装饰): the white-faced analogue clock of the reference,
   * hung by a rod from the storey ceiling. The dial is a **round** cylinder — face
   * down, so the hall below reads it — in a dark bezel ring, with black hour
   * markers and hands and no numerals or branding anywhere on it, which is what the
   * reference face shows: marks alone.
   *
   * It is ceiling-mounted (`ceilingMountMissing`), not fixed to a wall and not
   * standing on the floor, and purely cosmetic like every other 装饰 piece. `rot`
   * is meaningless to a round dial and is kept only so it turns with every other
   * piece.
   */
  | (ModuleBase & { type: 'ac-unit'; cfg: Record<string, never> })
  | (ModuleBase & { type: 'electrical-cabinet'; cfg: Record<string, never> })
  | (ModuleBase & { type: 'tactile'; cfg: { variant: 'guide' | 'warning' } })
  | (ModuleBase & { type: 'floor-mark'; cfg: { variant: 'boarding' | 'waiting' | 'direction'; line?: string; edgeId?: string; offset?: { x: number; y: number } } })
  | (ModuleBase & { type: 'vent'; cfg: Record<string, never> })
  | (ModuleBase & { type: 'light'; cfg: { variant: 'circular' | 'rectangular'; position?: number } })
  | (ModuleBase & { type: 'clock'; cfg: Record<string, never> })
  /**
   * A ceiling camera (监控, 装饰): the bracket-and-swivel housing of the reference,
   * a rounded white housing with a central dark optical panel, IR ring and curved sun hood,
   * carried on a steel arm from a ceiling plate. `rot` aims it — the head looks
   * along the piece's local −y, the same face a 电视 and a 指示牌 print on — so a
   * camera dropped at a corridor mouth can be turned to watch it.
   *
   * `cfg.variant` selects 枪机 (bullet, also the legacy default), 球机 (ptz) or
   * 半球机 (dome). Ceiling-mounted (`ceilingMountMissing`) and cosmetic: a camera is a prop, not
   * a line of sight, so it never changes what an agent sees or where one walks.
   */
  | (ModuleBase & { type: 'cctv'; cfg: { variant?: 'bullet' | 'ptz' | 'dome' } })
  /**
   * Wall-mounted decoration (装饰): a lightbox advertisement (广告牌). It is fixed
   * to the wall block behind it — the placement rotation names which face — so it
   * may only be dropped on a floor cell with a solid block at the first course of
   * the facing neighbour. It runs `w` cells along its local +x, picks its panel
   * size from `cfg.variant`, and prints `cfg.poster` on the lit face
   * (`sim/billboards.ts`, `render/adArt.ts`).
   *
   * `cfg.poster` is the placed poster's slug, drawn once at placement
   * (`randomAdSlug`) and then frozen: an ad screen is *not* an animation, so a
   * billboard shows the same artwork for as long as it stands. Legacy saves
   * without one are backfilled in `toState`, so a panel never re-rolls per frame.
   */
  | (ModuleBase & { type: 'billboard'; w: number; cfg: { variant: BillboardVariant; poster?: string } })
  /**
   * A wall-mounted glass panel (玻璃板, 装饰): a sheet of glass held by an **outer
   * frame only** and bolted flat to a wall — the 围栏's wall-mounted cousin, and
   * the piece that makes the difference visible. A fence stands a post and a pair
   * of rails *per cell*, so a run of them is a row of 1 m panels; a glass panel
   * has one sill, one head and two end posts around the whole run and one pane
   * between them, so a three-cell panel is a single glazed opening.
   *
   * It runs `w` cells along its local +x and stands `cfg.variant`'s height
   * (`sim/glassPanels.ts`) from the floor top up, so a 1 m panel is cladding and a
   * 2 m one is a full-height pane. Wall-mounted: it needs solid backing on **every course
   * the panel crosses** (`wallMountMissing`), and it may hang over a track like a
   * 广告牌, where there is no floor in front of the station wall at all.
   */
  | (ModuleBase & { type: 'glass'; w: number; cfg: { variant: GlassVariant } })
  /**
   * A free-standing swing door (门, 装饰): a doorway of its own — a threshold, a post
   * at each end, a head across them and the leaf hung between — standing on a floor
   * tile like a 货架, with nothing behind it. `cfg.variant` names the four pieces
   * (`sim/doors.ts`): 单开 or 双开 × 不锈钢 or 木, so a single door is one cell wide
   * with one leaf and a double one two cells wide with a pair meeting in the middle.
   *
   * It carries **its own frame**, which is why it asks the ground rules for a tile
   * and not the wall's for backing: it is *not* wall-mounted (`isWallMounted`,
   * `wallMountCourses`), it reserves its whole cells from the floor top to its head
   * (`sim/placement.ts`), and it may stand across a corridor or at a room's mouth as
   * readily as in the open.
   *
   * The **office reuses it**: a walled room's own doorway is drawn by the same
   * builder (`render/models/pieces/DoorModel.ts`), at the opening's width and in
   * the stainless finish, so the door a player hangs and the door a room closes
   * itself with are one drawing rather than two.
   */
  | (ModuleBase & { type: 'door'; w: number; cfg: { variant: DoorVariant } })
  /**
   * Station-name calligraphy (站名, 装饰): the station's own name
   * (`StationData.name`) drawn as a large ink inscription and bolted to a wall —
   * the brush lettering a real station wears beside its name plate.
   *
   * The piece holds **no text**: it names the hand it is written in
   * (`cfg.style`, `sim/calligraphy.ts` — 楷书 / 行书 / 隶书 / 魏碑 / 黑体 / 宋体) and
   * the way it runs (`cfg.axis` — 横排 along the wall, 竖排 down it), and
   * `render/calligraphyFace.ts` prints the live station name into the panel. A
   * rename therefore reprints every inscription in the station without touching
   * one module.
   *
   * `w` is the run in cells and `panelH` the panel's height in metres, both fixed
   * **when the piece is placed** from the name it carried then: a wider
   * inscription is a wider piece of wall (more cells needing solid backing), so a
   * later rename sets smaller type inside the same panel rather than silently
   * rebuilding a different wall behind a placed piece. Wall-mounted, on every
   * course the panel crosses.
   */
  | (ModuleBase & { type: 'calligraphy'; w: number; panelH: number; cfg: { style: CalligraphyStyle; axis: CalligraphyAxis } })
  /**
   * A line system map (线网图, 装饰): the network diagram drawn from the station's
   * **own lines** — one coloured band per line, its stations ticked along it, its
   * interchanges ringed (`render/lineMapFace.ts`) — so recolouring a line or
   * adding a station repaints every map in the station.
   *
   * `cfg.mount` is the two variants' whole difference (`sim/linemaps.ts`): `wall`
   * is a framed landscape board bolted flat to a wall on every course it crosses
   * and read from one side, `stand` a free-standing portrait totem printed on
   * **both** faces, which is floor-standing instead — it needs floor under it and
   * reserves its own cell like a 售票机.
   */
  | (ModuleBase & { type: 'linemap'; w: number; cfg: { mount: LineMapVariant } })
  /**
   * A passenger-information screen (电视, 装饰): the station board and the network
   * feed's window over one tile, hung by rods from the storey ceiling, lit on one
   * face. It is ceiling-mounted (`ceilingMountMissing`), not fixed to a wall.
   * `cfg.poster` is the opening frame the content window plays; the scene re-points
   * that window at another catalogue poster on its own cadence.
   *
   * Two of them may share one tile turned to face **opposite** ways
   * (`sim/tvs.ts`): back to back they are one object — a single housing with a
   * screen each side — so the pair is exempt from the usual one-piece-per-cell
   * rule and `render/models.ts` draws the shared housing once.
   */
  | (ModuleBase & { type: 'tv'; cfg: { poster?: string } })
  /**
   * A wayfinding sign (指示牌, 装饰), in one of the two mounts §5.8 allows: a lit
   * directional board **hung** by rods from the storey ceiling and readable from both
   * faces, or the same board **bolted flat to a wall** and read from the room it
   * faces (`sim/sign.ts`'s `SignMount`).
   *
   * A **hanging** sign is not wall-mounted — `ceilingMountMissing` (`sim/placement.ts`)
   * refuses it unless a solid slab sits one storey up (`z + 4`, the fixed `LEVEL_STEPS`
   * grid), which is the ceiling the rods bolt to. A **wall** sign is the reverse: it
   * needs no slab at all and wants solid backing behind it on the courses its panel
   * crosses (`signWallCourses`), and the wall it is bolted to is the local −y face of
   * its `rot`, exactly as a 广告牌's is.
   *
   * The two faces are **two boards**, and each prints its own: `cfg.front` is
   * 正面, the side a passenger approaching the sign reads, and `cfg.back` is 背面,
   * which may be empty — an empty face mounts no plate at all and shows the
   * piece's own black lightbox, which is what a one-sided sign looks like from
   * behind. A wall board has a wall behind it rather than a second face, so it
   * mounts 正面 alone and never reads `cfg.back` (`signMountSpec(...).doubleSided`).
   * A board is an ordered list of draggable parts — arrows, the bound
   * line's own shield, typed text and pictograms — laid out by `sim/sign.ts` and
   * drawn by `render/signFace.ts`, and the two faces share one panel, as wide as
   * the longer of them (`signBoardsPanel`).
   *
   * `cfg.components` is the **older** single-board form, kept so that a save
   * written before the back existed still loads: `toState`/`signBoardsOf` fold its
   * per-component `side` into the pair once, and a board with no `components`,
   * `front` or `back` at all is backfilled with `defaultSignLayout` on the front.
   * `cfg.mount` is the same story for the hang: absent — every save written before
   * the wall board existed — reads as the overhead board it was.
   */
  | (ModuleBase & { type: 'sign'; cfg: { mount?: SignMount; components?: SignLayout; front?: SignLayout; back?: SignLayout } })
  | (ModuleBase & { type: 'retail'; w: number; h: number; cfg: { kind: 'store' | 'cafe' | 'restroom'; bare?: boolean; stocked?: boolean } })
  | (ModuleBase & { type: 'shop'; w: number; h: number; cfg: { kind?: RoomKind; door?: Array<[number, number]>; bare?: boolean; stocked?: boolean } })
  | (ModuleBase & { type: 'booth'; w: number; h: number; cfg: { kind?: 'ticket' | 'info'; door?: Array<[number, number]>; stocked?: boolean } })
  | (ModuleBase & {
      type: 'platform-edge'
      /** Length in cells along +x from (x, y, z). */
      w: number
      cfg: {
        name: string
        line: string
        dir: LineDirection
        side: 'left' | 'right'
        /**
         * 屏蔽门 height copied from the bound line when the edge is derived: a
         * full-height screen fills the storey, a half-height (半高) one stops at
         * 1.5 m. Read by the renderer and the collision envelope alike, so the
         * screen cannot look tall but collide short.
         */
        psd?: PsdHeight
        /** The track module this edge was auto-derived from, for regeneration. */
        from?: string
      }
    })
  | (ModuleBase & {
      type: 'track'
      /** Length in cells along +x from (x, y, z). */
      w: number
      /** Bed depth in cells across the run (+y). Defaults to 1. */
      d?: number
      /** A pure tunnel run: an extension of a line's track, never platform doors. */
      cfg: { line: string; power: 'third-rail' | 'catenary'; dir?: LineDirection; tunnel?: boolean; bridge?: boolean; bridgeRailing?: BridgeRailing; bridgeFinish?: FinishId; removedBridgePillars?: string[] }
    })

export type ModuleType = Module['type']

/**
 * A line's running direction (§6.3). 上行 / 下行 is the metro convention: the
 * player assigns a track to one of a line's two directions, and the train's
 * travel sign comes from the line, not from sniffing a compass word.
 */
export type LineDirection = 'up' | 'down'

/**
 * Platform screen door (屏蔽门) height, a per-line option. `full` is the
 * full-height screen that fills the storey with a printed header band on top;
 * `half` is the 1.5 m half-height screen (半高), whose line header moves onto
 * the glass as stickers. Absent means `full`, so old saves keep their screens.
 */
export type PsdHeight = 'full' | 'half'

export interface LineDef {
  id: string
  name: string
  colour: string
  stock: StockClass
  cars: number
  power: 'third-rail' | 'catenary'
  /** 屏蔽门 全高 / 半高. Defaults to `full` when unset. */
  psd?: PsdHeight
  headwayProfile: { peak: number; offpeak: number; late: number }
  /** Passengers dumped onto the platform per train arrival (the demo slider). */
  alightPerTrain: number
  terminus: 'reverse' | 'through'
  direction: LineDirection
  /**
   * The terminating station printed on a platform screen's direction sticker
   * (§5.4): the 上行 / 下行 destination this line runs toward. A screen reads its
   * own line's terminus by its `dir`, so the header is real signal, not a
   * hardcoded place name. Empty falls back to the shield's own direction word.
   */
  upTerminus: string
  downTerminus: string
  /** Which way along +x a train runs: +1 approaches from −x, −1 from +x. */
  travelSign: 1 | -1
  stations: string[]
}

export interface StationData {
  name: string
  /** English station name printed below the Chinese exit banner name. */
  nameEn?: string
  seed: number
  /** 0–3 m base of the 4 m editing storey grid. */
  levelBase?: number
  cells: Cell[]
  modules: Module[]
  lines: LineDef[]
  /**
   * The station's **operating hours** (§9.6C 营业时间). Optional on the wire — a save or
   * a demo file written before the window existed has none, and loads with
   * `DEFAULT_SERVICE` — but always present on a `StationState`, which is the document
   * the player edits.
   */
  service?: TimeSpan
  /** The two **peak windows** (§9.6C 高峰时段): 早高峰 then 晚高峰. Same rule as `service`. */
  peaks?: PeakWindows
  /**
   * The **客流曲线** knobs (§9.6C: 早高峰量 / 晚高峰量 / 波形陡峭度). Partial on the wire so a
   * file that carries one of them still loads; finished by `normalizeDemand`.
   */
  demand?: Partial<DemandKnobs>
  /**
   * The station's **calendar** (§9.6C 日期类型 / 日历系数): which date day 0 is, and which dates
   * are 节假日 and 调休上班日. The day type the crowd's multiplier keys on is *derived* from it,
   * so a station run on a Saturday runs a Saturday. Optional on the wire like the rest of the
   * authored day; `toState` gives a file without one the shipped 2026 calendar.
   */
  calendar?: SimCalendar
}

/** Numeric agent states, §7.1. Const object rather than enum (erasable syntax). */
export const AgentState = {
  Arriving: 0,
  Walking: 1,
  Queuing: 2,
  Buying: 3,
  Browsing: 4,
  Waiting: 5,
  Riding: 6,
  Alighting: 7,
  Leaving: 8,
} as const
export type AgentStateValue = (typeof AgentState)[keyof typeof AgentState]

export const STATE_LABEL: Record<number, string> = {
  0: 'arriving',
  1: 'walking',
  2: 'queuing',
  3: 'buying',
  4: 'browsing',
  5: 'waiting',
  6: 'riding',
  7: 'alighting',
  8: 'leaving',
}

/** A trip, §7.1. Endpoints are node ids of any kind. */
export interface Trip {
  origin: string
  stops: string[]
  dest: string
}

export interface SavedAgent {
  id: number
  seed: number
  x: number
  y: number
  z: number
  state: number
  speed: number
  trip: Trip
  legIdx: number
  pathIdx: number
  patience: number
}

export interface SaveDoc {
  format: 'metro-save'
  formatVersion: 1
  gameVersion: string
  savedAt: string
  name: string
  seed: number
  tick: number
  dayType: 'weekday'
  config: {
    demand: {
      peakWindows: Array<[string, string]>
      alightShare: number
      boardShare: number
    }
    lines: LineDef[]
  }
  static: {
    cells: Cell[]
    modules: Module[]
    track: { alignments: never[]; junctions: never[] }
  }
  dynamic: {
    rng: number
    agents: SavedAgent[]
    trains: unknown[]
    queues: unknown[]
    spawns: Record<string, { nextT: number }>
  }
}
