// Station data model. Pure types shared by the build tools, the sim graph and
// the save format (§10.5). Ids stay ASCII per §9.2 even though the UI is Chinese.

export type Fill = 'solid' | 'void'

export interface Cell {
  x: number
  y: number
  z: number
  fill: Fill
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
  inRate: number
  outRate: number
  open: boolean
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
  | (ModuleBase & { type: 'gate'; cfg: { dir: 'both' | 'in' | 'out' } })
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
  dwellBase: number
  dwellPerPax: number
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
