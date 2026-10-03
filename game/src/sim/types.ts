// Station data model. Pure types shared by the build tools, the sim graph and
// the save format (§10.5). Ids stay ASCII per §9.2 even though the UI is Chinese.

import type { StockClass } from './stock.ts'

export type Fill = 'solid' | 'void'

/** The six faces of a cell, §4.1. `+z` is up; `n` is `+y`, `e` is `+x`. */
export type Face = 'top' | 'bottom' | 'n' | 'e' | 's' | 'w'
export const FACES: readonly Face[] = ['top', 'bottom', 'n', 'e', 's', 'w']

/** ASCII finish id, e.g. `floor.granite`. See `sim/finishes.ts`. */
export type FinishId = string

/**
 * Fare zones — GAME-SPEC.md §4.5. Every floor cell belongs to exactly one, and
 * a gate is the only legal crossing between `unpaid` and `paid`. The default is
 * `unpaid`, so an unzoned station has a single zone and no internal barriers.
 */
export type Zone = 'outside' | 'unpaid' | 'paid' | 'platform' | 'restricted'
export const ZONES: readonly Zone[] = ['outside', 'unpaid', 'paid', 'platform', 'restricted']
export const DEFAULT_ZONE: Zone = 'unpaid'

/**
 * A fare gate's pass policy, §4.5. `in` is entry only (unpaid → paid), `out` is
 * exit only (paid → unpaid) and `both` passes either — but only one direction at
 * a time, because a two-way turnstile is a single lane (§7.1).
 */
export type GateMode = 'in' | 'out' | 'both'
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
  /** Fare zone (§4.5). Absent = `DEFAULT_ZONE`. */
  zone?: Zone
  tags?: string[]
}

export interface Vec3i {
  x: number
  y: number
  z: number
}

/**
 * True when a cell is a wall the player or the 地基 tool raised, or a tunnel's
 * shell. The tag strings mirror `build/model.ts` (`WALL` / `AUTO_WALL`) and
 * `build/rail.ts` (`tunnel-shell:<id>`); they live here so the pure sim can
 * recognise a wall without importing `build/`. A plain block has no tags and is
 * not a wall.
 */
export function isWallBlock(c: { tags?: string[] }): boolean {
  const tags = c.tags
  if (!tags) return false
  for (const t of tags) {
    if (t === 'wall' || t === 'auto-wall' || t.startsWith('tunnel-shell:')) return true
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
 * landscape, a tall portrait, a square and a wide two-cell banner.
 */
export type BillboardVariant = 'wide' | 'portrait' | 'square' | 'large'

/** The poster aspect set a billboard variant draws from (`sim/billboards.ts`). */
export type BillboardAspect = 'wide' | 'square' | 'portrait'

/**
 * A bench's variant (装饰 座椅, §5.7). Two families — a plain stainless bench
 * with no back and an upholstered seat with a back and arm rests that chains
 * into a row — each in a 1 m and a 2 m width, so one 座椅 tool offers four
 * pieces (`sim/benches.ts`).
 */
export type BenchVariant = 'steel-1' | 'steel-2' | 'seat-1' | 'seat-2'

/**
 * A staircase's plan shape (§5.1). A stair always climbs exactly one storey;
 * the style decides how the flights turn. `straight` is one run, the `90`
 * styles climb one flight, turn, then climb a second, and `right180` is a
 * switchback: two parallel flights with a half-landing between them.
 */
export type StairStyle = 'straight' | 'right90' | 'left90' | 'right180'

/** One flight of a stair: a straight run of treads from one landing to the next. */
export interface StairFlight {
  from: Vec3i
  to: Vec3i
}

export type Module =
  | (ModuleBase & { type: 'exit'; cfg: ExitCfg })
  | (ModuleBase & { type: 'gate'; cfg: { dir: GateMode } })
  | (ModuleBase & { type: 'fence'; cfg: Record<string, never> })
  | (ModuleBase & { type: 'escalator'; from: Vec3i; to: Vec3i; cfg: { dir: 'up' | 'down' } })
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
        width: number
        style?: StairStyle
        /** Ordered flight segments, bottom → top. Defaults to one straight run. */
        flights?: StairFlight[]
      }
    })
  | (ModuleBase & { type: 'lift'; from: Vec3i; to: Vec3i; cfg: Record<string, never> })
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
  | (ModuleBase & { type: 'shelf'; cfg: { auto?: boolean } })
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
   * Wall-mounted decoration (装饰): a lightbox advertisement (广告牌). It is fixed
   * to the wall block behind it — the placement rotation names which face — so it
   * may only be dropped on a floor cell with a solid block at the first course of
   * the facing neighbour. It runs `w` cells along its local +x and picks its
   * poster aspect from `cfg.variant` (`sim/billboards.ts`).
   */
  | (ModuleBase & { type: 'billboard'; w: number; cfg: { variant: BillboardVariant } })
  /**
   * An advertising screen (电视, 装饰): a screen playing ads, hung by rods from
   * the storey ceiling like the 指示牌 and readable from both faces, so it is
   * ceiling-mounted (`ceilingMountMissing`), not fixed to a wall.
   */
  | (ModuleBase & { type: 'tv'; cfg: Record<string, never> })
  /**
   * An overhead wayfinding sign (指示牌, 装饰): a lit directional board hung by
   * rods from the storey ceiling, readable from both faces. It is not
   * wall-mounted — `ceilingMountMissing` (`sim/placement.ts`) refuses it unless a
   * solid slab sits one storey up (`z + 4`, the fixed `LEVEL_STEPS` grid), which
   * is the ceiling the rods bolt to.
   */
  | (ModuleBase & { type: 'sign'; cfg: Record<string, never> })
  | (ModuleBase & { type: 'retail'; w: number; h: number; cfg: { kind: 'store' | 'cafe' | 'restroom'; bare?: boolean; stocked?: boolean } })
  | (ModuleBase & { type: 'shop'; w: number; h: number; cfg: { kind?: RoomKind; door?: Array<[number, number]>; bare?: boolean; stocked?: boolean } })
  | (ModuleBase & { type: 'booth'; w: number; h: number; cfg: { kind?: 'ticket'; door?: Array<[number, number]>; stocked?: boolean } })
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
      cfg: { line: string; power: 'third-rail' | 'catenary'; dir?: LineDirection; tunnel?: boolean }
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
  seed: number
  cells: Cell[]
  modules: Module[]
  lines: LineDef[]
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
