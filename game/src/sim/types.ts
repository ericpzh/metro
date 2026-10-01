// Station data model. Pure types shared by the build tools, the sim graph and
// the save format (§10.5). Ids stay ASCII per §9.2 even though the UI is Chinese.

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

export interface LevelDef {
  id: string
  z: number
  kind: 'underground' | 'at-grade' | 'viaduct'
  height: number
}

export interface Vec3i {
  x: number
  y: number
  z: number
}

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
}

export interface ModuleBase {
  id: string
  x: number
  y: number
  z: number
  rot?: number
}

export type Module =
  | (ModuleBase & { type: 'exit'; cfg: ExitCfg })
  | (ModuleBase & { type: 'gate'; cfg: { dir: GateMode } })
  | (ModuleBase & { type: 'escalator'; from: Vec3i; to: Vec3i; cfg: { dir: 'up' | 'down' } })
  | (ModuleBase & { type: 'stair'; from: Vec3i; to: Vec3i; cfg: { width: number } })
  | (ModuleBase & { type: 'lift'; from: Vec3i; to: Vec3i; cfg: Record<string, never> })
  | (ModuleBase & { type: 'tvm'; cfg: Record<string, never> })
  | (ModuleBase & { type: 'bench'; cfg: Record<string, never> })
  | (ModuleBase & { type: 'retail'; w: number; h: number; cfg: { kind: 'store' | 'cafe' | 'restroom' } })
  | (ModuleBase & {
      type: 'platform-edge'
      /** Length in cells along +x from (x, y, z). */
      w: number
      cfg: { name: string; line: string; dir: string; side: 'left' | 'right' }
    })
  | (ModuleBase & {
      type: 'track'
      /** Length in cells along +x from (x, y, z). */
      w: number
      cfg: { line: string; power: 'third-rail' | 'catenary' }
    })

export type ModuleType = Module['type']

export interface LineDef {
  id: string
  name: string
  colour: string
  stock: 'A' | 'B' | 'C'
  cars: number
  power: 'third-rail' | 'catenary'
  headwayProfile: { peak: number; offpeak: number; late: number }
  /** Passengers dumped onto the platform per train arrival (the demo slider). */
  alightPerTrain: number
  terminus: 'reverse' | 'through'
  direction: string
  stations: string[]
}

export interface StationData {
  name: string
  seed: number
  levels: LevelDef[]
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
    levels: LevelDef[]
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
