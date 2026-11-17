// The Unity shell's **tool adapter** (plan 27 §2): one typed two-way translation between the
// shared React UI's tool state and the host's committed tool session.
//
// Three rules make this a seam rather than glue:
//
// 1. **Canonical names.** The shell sends the shared UI's own `Tool` union (`block`, `wall`,
//    `zone`, `rail`, `tunnel`, …). The host normalizes the two legacy names this shell used
//    before (`floor` → `block`, `gate` → the 闸机 tile under `module`), so an older packaged
//    player still reaches a tool without teaching the UI two vocabularies.
// 2. **The host owns the committed tool.** A `tool.set` ack, or a `tool.get`, carries the
//    tool the host actually holds; `adoptHostTool` moves the store onto it without echoing a
//    second `tool.set` that would overwrite the host's own settings (`applyingHostTool`).
// 3. **Every setting travels.** A tool whose `R`/`Tab`/tile setting is missing from the
//    payload draws the wrong ghost under a still pointer, and nothing but a pointer move
//    would ever correct it. The list below is the whole of `ToolSlice`, `RailSlice` and
//    `PaintSlice`'s tool-relevant state, and `settingsKey` is what the shell compares so an
//    unchanged state never sends a command.

/** The shared UI's own tool union (a superset of what this host implements today). */
export type ShellTool = 'select' | 'pick' | 'move' | 'block' | 'wall' | 'delete' | 'module' | 'paint' | 'zone' | 'rail' | 'tunnel'

/** One scalar a tool setting carries. */
export type Setting = string | number | boolean | null

/**
 * The state the adapter reads. It is a structural slice of the app store, so a test can feed
 * it a literal and the production mount passes `useStore.getState()`. Every field is the
 * slice's own name — no second vocabulary.
 */
export interface ToolAdapterState {
  tool: ShellTool
  moduleType: string
  moduleRot: number
  gateDoor: Setting
  curtainWidth: Setting
  curtainHeight: Setting
  doorWide: Setting
  stairWidth: Setting
  stairBlockHeight: Setting
  pillarLength: Setting
  roofWidth: Setting
  roofPlateSnap: Setting
  escalatorDir: Setting
  escalatorWidth: Setting
  escalatorSpan: Setting
  rampLength: Setting
  doubleRampLength: Setting
  tripleRampLength: Setting
  liftInterval: Setting
  liftSize: Setting
  liftStyle: Setting
  walkwayLength: Setting
  bridgeLength: Setting
  bridgeRailing: Setting
  counterLength: Setting
  hangerLength: Setting
  psdEndHeight: Setting
  lightPosition: Setting
  calligraphyEnglish: Setting
  guideExitId: string | null
  roadWidth: Setting
  roadDirection: Setting
  lineSpacing: Setting
  zoneBrush: unknown
  facilityRot: Setting
  wallSnapCycle: number
  halfWall: boolean
  halfCorner: boolean
  triangles: boolean
  triKind: Setting
  autoWalls: boolean
  suspendedCeiling: boolean
  railLineId: string
  railDir: Setting
  railRot: number
  railCatenaryStyle: Setting
  tunnelLength: Setting
  paintMode: Setting
  paintBaseMode: Setting
  paintFinish: Setting
}

/** The `settings` object a `tool.set` carries. Keys are the host's own vocabulary. */
export type ToolSettings = Record<string, string | number | boolean | null>

/** The production `tool.set` payload builder: the whole of the tool state that shapes a ghost. */
export function settingsFor(state: ToolAdapterState): ToolSettings {
  return {
    moduleType: state.moduleType,
    rotation: state.moduleRot,
    rotationRail: state.railRot,
    lineId: state.railLineId,
    gateDoor: state.gateDoor,
    curtainWidth: state.curtainWidth,
    curtainHeight: state.curtainHeight,
    doorWide: state.doorWide,
    stairWidth: state.stairWidth,
    stairBlockHeight: state.stairBlockHeight,
    pillarLength: state.pillarLength,
    roofWidth: state.roofWidth,
    roofPlateSnap: state.roofPlateSnap,
    escalatorDir: state.escalatorDir,
    escalatorWidth: state.escalatorWidth,
    escalatorSpan: state.escalatorSpan,
    rampLength: state.rampLength,
    doubleRampLength: state.doubleRampLength,
    tripleRampLength: state.tripleRampLength,
    liftInterval: state.liftInterval,
    liftSize: state.liftSize,
    liftStyle: state.liftStyle,
    walkwayLength: state.walkwayLength,
    bridgeLength: state.bridgeLength,
    bridgeRailing: state.bridgeRailing,
    counterLength: state.counterLength,
    hangerLength: state.hangerLength,
    psdEndHeight: state.psdEndHeight,
    lightPosition: state.lightPosition,
    calligraphyEnglish: state.calligraphyEnglish,
    guideExitId: state.guideExitId,
    roadWidth: state.roadWidth,
    roadDirection: state.roadDirection,
    lineSpacing: state.lineSpacing,
    zoneBrush: typeof state.zoneBrush === 'string' ? state.zoneBrush : JSON.stringify(state.zoneBrush ?? null),
    facilityRot: state.facilityRot,
    // The 方块 brush's own modes: a cut piece, 生成墙壁 and the 吊顶 tile all change what the
    // same press lays, so all of them belong in the payload (`BlockTool` reads them per event).
    halfWall: state.halfWall,
    halfCorner: state.halfCorner,
    triangles: state.triangles,
    triKind: state.triKind,
    wallSnapCycle: state.wallSnapCycle,
    autoWalls: state.autoWalls,
    suspendedCeiling: state.suspendedCeiling,
    railDir: state.railDir,
    railCatenaryStyle: state.railCatenaryStyle,
    tunnelLength: state.tunnelLength,
    paintMode: state.paintMode,
    paintBaseMode: state.paintBaseMode,
    paintFinish: state.paintFinish,
  }
}

/** A command key: the tool and every setting, so an unchanged state never sends. */
export function settingsKey(tool: string, settings: ToolSettings): string {
  return `${tool}|${JSON.stringify(settings)}`
}

/**
 * The host's committed tool as a shell tool, or null when the name has no store equivalent
 * (`inspect` and the tools this host has not ported yet keep their own names in the store).
 */
export function shellToolFor(hostTool: string): ShellTool | null {
  switch (hostTool) {
    case 'select':
    case 'pick':
    case 'move':
    case 'block':
    case 'wall':
    case 'delete':
    case 'module':
    case 'paint':
    case 'zone':
    case 'rail':
    case 'tunnel':
      return hostTool
    default:
      return null
  }
}

export interface ToolAdapterOptions {
  /** The current tool state (production: `useStore.getState()`). */
  read: () => ToolAdapterState
  /** Send one `tool.set` to the host. */
  send: (tool: string, settings: ToolSettings) => void
  /** Subscribe to store changes. */
  subscribe: (listener: () => void) => () => void
  /** Move the store's tool onto the host's committed one (called on adoption). */
  applyHostTool?: (tool: ShellTool) => void
}

export interface ToolAdapter {
  /** Send a `tool.set` when the tool or any setting changed since the last send. */
  push(): void
  /**
   * Adopt the host's committed tool and settings generation from one state payload. Returns
   * true when the store was moved, so the caller can tell an echo from a real change.
   */
  adoptHostTool(hostTool: unknown): boolean
  /** Unsubscribe from the store. */
  dispose(): void
  /** The last command key sent (for a verifier or a test). */
  lastKey(): string
}

/**
 * Create the adapter and start forwarding store changes. `applyingHostTool` guards the echo:
 * a store change made by `adoptHostTool` must not send a `tool.set` that would replace the
 * host's own committed settings (a verifier or the desktop presenter may have set them).
 */
export function createToolAdapter(options: ToolAdapterOptions): ToolAdapter {
  let previousKey = ''
  let applyingHostTool = false
  let lastHostTool = ''

  const snapshot = (): { tool: string; settings: ToolSettings } => {
    const state = options.read()
    return { tool: state.tool, settings: settingsFor(state) }
  }

  const push = (): void => {
    const { tool, settings } = snapshot()
    const key = settingsKey(tool, settings)
    if (applyingHostTool) {
      previousKey = key
      return
    }
    if (key === previousKey) return
    previousKey = key
    options.send(tool, settings)
  }

  const adoptHostTool = (hostTool: unknown): boolean => {
    if (typeof hostTool !== 'string' || hostTool.length === 0) return false
    if (hostTool === lastHostTool) return false
    lastHostTool = hostTool
    const tool = shellToolFor(hostTool)
    if (tool === null) return false
    const current = options.read()
    if (current.tool === tool) return false
    applyingHostTool = true
    try {
      options.applyHostTool?.(tool)
    } finally {
      applyingHostTool = false
    }
    return true
  }

  push()
  const unsubscribe = options.subscribe(push)
  return {
    push,
    adoptHostTool,
    dispose: unsubscribe,
    lastKey: () => previousKey,
  }
}

/** True when the committed tool owns the secondary mouse button (`state.rightClaim`). */
export function rightClaimedByTool(claim: unknown): boolean {
  return claim === 'erase'
}
