// Which storey a drawn piece belongs to, and whether the level slicing shows it.
//
// This is the whole of the "显示其他层" rule, kept out of `scene.ts` as pure
// functions so it can be tested without a renderer.
//
// * **显示其他层 OFF is absolute.** Only the storey being edited is drawn — at
//   *any* camera angle. A side elevation, a top-down plan and a corner
//   isometric all show the same storey and nothing else.
// * **显示其他层 ON** draws the active storey crisp and the storeys **below** it
//   as 35% ghosts. Ghosts keep their true depth and are drawn as translucent
//   geometry, so a storey the active one covers simply loses the depth test.
//   **Nothing above the active storey is drawn once that storey has geometry**:
//   the floor over an occupied room is its ceiling, and ghosting the storeys over
//   it covers the room being edited (the crowd and trains already follow this
//   rule). An empty storey still ghosts the storeys above it, so the editor can
//   show where they are; `SliceOptions.hideAbove` carries the decision.
//   On a **dense** document (`DENSE_STATION_MODULES`, `detailPolicy.ts`) the
//   ghost slice is also bounded to the storey next to the active one: drawing
//   every distant storey had no cost bound and made a five-storey, 76k-module
//   station cost four extra storeys' draws.
// * **隐藏天花板** (off by default) only matters while the active storey is
//   **empty**: there the storeys above still ghost, and a slab one storey up is
//   the room's ceiling — the nearest thing to a top-down camera and the one thing
//   that hides the room you are about to build. With the toggle on, a storey
//   above keeps only the pieces with nothing under them — the street outside, a
//   canopy on its own columns — and loses its ceilings. With it off, the ceilings
//   draw with the rest of the storey. Once the active storey has geometry the
//   whole storey above is hidden, so the toggle has nothing to lift.

import { STOREY_HEIGHT, storeyBand } from '../sim/constants.ts'

/** Where a piece sits relative to the storey being edited. */
export type LevelSide = 'active' | 'below' | 'above'

/**
 * The side of the active storey a piece occupies. `levelsZ` is every storey the
 * piece touches (`moduleLevels`, `stairLevels`), so a ramp landing on two floors
 * and a lift shaft running through four are each one piece. A piece with no
 * level tag at all (a floor decal, furniture with no storey of its own) belongs
 * to the active storey: it is never ghosted away.
 *
 * A piece is `active` when its own span *covers* the active storey, not only
 * when it lands exactly on it: a lift running from -12 to -4 is the lift in the
 * room at -8, so it is drawn crisp there rather than treated as a neighbour.
 */
export function levelSide(levelsZ: readonly number[] | undefined, activeZ: number): LevelSide {
  if (levelsZ === undefined || levelsZ.length === 0) return 'active'
  let lo = Infinity
  let hi = -Infinity
  for (const z of levelsZ) {
    if (z < lo) lo = z
    if (z > hi) hi = z
  }
  if (lo <= activeZ && hi >= activeZ) return 'active'
  return hi < activeZ ? 'below' : 'above'
}

/** The toggles the slicing reads: 显示其他层, 隐藏天花板, and the piece itself. */
export interface SliceOptions {
  /** 显示其他层: draw the storeys that are not the active one. */
  ghost: boolean
  /** 隐藏天花板: drop the ceilings of the storey above the active one. */
  autoCeiling: boolean
  /**
   * The active storey has geometry of its own. When it does, **nothing above it
   * is drawn**: an occupied room's floor above is its ceiling, and a ghost of the
   * storeys over it covers the room instead of giving context. An empty storey
   * still ghosts them, so the editor can show where the floors above are.
   */
  hideAbove?: boolean
  /**
   * True for a piece with nothing under it — the chunk mesher's `float` plate,
   * a fixture whose column's lowest storey is above the active one. Only read
   * for a piece *above* the active storey.
   */
  unsupported?: boolean
}

/** What the view asks of the slice, before any one piece is looked at. */
export interface SliceToggles {
  /** 显示其他层: the storeys that are not the active one draw, as 35% ghosts. */
  ghost: boolean
  /** 隐藏天花板: the slab over the active room is lifted away. */
  autoCeiling: boolean
  /** 隐藏UI: the picture is the station as it is, not the storey being edited. */
  hideUI: boolean
  /** 剖切: a surface is cutting the station, so nothing else may hide anything. */
  cutaway: boolean
  /** The active storey has any built geometry (see `SliceOptions.hideAbove`). */
  built?: boolean
}

/**
 * The slice one frame of the scene asks for.
 *
 * **隐藏UI and 剖切 put the slice away, and the slice they ask for is
 * `ghost: true, autoCeiling: false`.**
 *
 * `ghost: true` does not mean "ghost the others" here — it is what `levelVisible`
 * reads as "the storeys that are not the active one are drawn at all" — and
 * `autoCeiling: false` stops the slab over the room from being lifted. Together
 * they are "every storey, ceiling and all", which is the point: the picture is the
 * station, and **while 剖切 is on the only thing allowed to hide anything is the
 * cut itself**. Leave the slice switched on and Q/E would still be choosing a
 * storey to ghost and a storey to draw, so a cut through a ghosted storey reads as
 * a cut through coloured glass.
 *
 * What makes the picture read as a building rather than as a drawing is then the
 * material: the caller skips the 35% ghost material and draws each piece as itself
 * (`LevelSystem.applyLevel`).
 *
 * 隐藏墙壁 is deliberately **not** here: it is a look-through of the station's own
 * walls rather than a way of drawing a storey, so it survives either mode.
 *
 * Pure, so which slice a mode asks for is checkable without a renderer
 * (`test/level-slicing.test.mjs`).
 */
export function sliceOptions(toggles: SliceToggles): SliceOptions {
  if (toggles.hideUI || toggles.cutaway) return { ghost: true, autoCeiling: false, hideAbove: false }
  return { ghost: toggles.ghost, autoCeiling: toggles.autoCeiling, hideAbove: toggles.ghost && toggles.built === true }
}

/**
 * Whether the level slicing draws a piece on `side`.
 *
 * 隐藏UI does not arrive here as a flag: `sliceOptions` clears `ghost` and
 * `autoCeiling` for it, and `LevelSystem` hands every mesh its base material back
 * rather than the 35% ghost. The material, and not only the visibility, has to be
 * the mode's business: a flag here could turn a piece on, but it could not undo
 * the ghost material the slice had already assigned it — and going through the
 * flag *alone* is what left the storeys below wearing that ghost.
 */
export function levelVisible(side: LevelSide, opts: SliceOptions): boolean {
  if (side === 'active') return true
  if (!opts.ghost) return false
  if (side === 'below') return true
  // An occupied storey hides everything above it: the floor over the room is its
  // ceiling, and ghosting the storeys above would cover the room being edited
  // (crowd and trains already follow this rule). An empty storey still ghosts
  // them so the editor can show where the floors above are.
  if (opts.hideAbove === true) return false
  return !opts.autoCeiling || opts.unsupported === true
}

/**
 * True when any storey a piece occupies is next to the active one. A ramp that
 * spans several storeys counts when one of them is a neighbour, so a lift or a
 * stair still ghosts from the storey above the room it serves.
 */
export function storeyNear(levelsZ: readonly number[] | undefined, activeZ: number, height = STOREY_HEIGHT): boolean {
  if (levelsZ === undefined || levelsZ.length === 0) return true
  for (const z of levelsZ) if (Math.abs(z - activeZ) <= height) return true
  return false
}

/**
 * Whether a slice **piece** (a chunk mesh or a fixture root) draws on its side.
 * It is `levelVisible` plus the dense-station bound: on a large document, 显示其他层
 * keeps the storeys next to the active one and drops the distant ones
 * (`DENSE_STATION_MODULES`, `detailPolicy.ts`). Hidden UI and 剖切 bypass
 * the bound — they draw every storey as itself, which is their whole point.
 */
export function boundedLevelVisible(
  side: LevelSide,
  levelsZ: readonly number[] | undefined,
  activeZ: number,
  opts: SliceOptions,
  dense: boolean,
): boolean {
  if (dense && side !== 'active' && !storeyNear(levelsZ, activeZ)) return false
  return levelVisible(side, opts)
}

/**
 * A fixture's version of the chunk mesher's `float` flag: it stands on a plate
 * that is itself above the active storey, so there is nothing between it and
 * that lower room's ceiling to hide behind. `groundBand` is the lowest storey
 * of the module's column (`SceneRenderer.groundOf`).
 */
export function unsupportedAbove(activeZ: number, groundBand: number | undefined): boolean {
  return groundBand !== undefined && groundBand > activeZ
}

/**
 * A consist is parked between services by `setTrains` (its `visible` flag is the
 * sim's, not the slicing's), so a train is drawn when the slicing allows it *and*
 * the sim has it on the road. A train never shows from a storey above the active
 * one: its own floor is not drawn there, so it would hang in mid-air.
 */
export function trainVisible(side: LevelSide, ghost: boolean, parked: boolean): boolean {
  if (parked) return false
  return side === 'active' || (ghost && side === 'below')
}

/**
 * Whether the crowd on walk-surface `z` is drawn. The same rule as the geometry
 * (and the depth test behind it hides a lower floor's crowd under the slab above
 * it); a storey above the active one never shows its crowd, because a floor that
 * is not drawn would leave the people standing on nothing.
 *
 * `showEveryStorey` is 隐藏UI's doing (`CrowdSystem` asks per agent): the mode
 * draws every storey, so it draws everyone on them — the people on the floor
 * above are exactly what a station drawn whole shows.
 */
export function crowdVisible(z: number, activeZ: number, ghost: boolean, showEveryStorey = false, base = 0, height = STOREY_HEIGHT): boolean {
  if (showEveryStorey) return true
  const side = levelSide([storeyBand(z, base, height)], activeZ)
  return side === 'active' || (ghost && side === 'below')
}

/** Contact shadows ground the active storey; ghosted storeys draw without them. */
export function contactShadowVisible(z: number, activeZ: number, showEveryStorey = false, base = 0, height = STOREY_HEIGHT): boolean {
  return showEveryStorey || storeyBand(z, base, height) === activeZ
}
