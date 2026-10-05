// Which storey a drawn piece belongs to, and whether the level slicing shows it.
//
// This is the whole of the "显示其他层" rule, kept out of `scene.ts` as pure
// functions so it can be tested without a renderer.
//
// * **显示其他层 OFF is absolute.** Only the storey being edited is drawn — at
//   *any* camera angle. A side elevation, a top-down plan and a corner
//   isometric all show the same storey and nothing else.
// * **显示其他层 ON** draws the active storey crisp and every other storey as a
//   35% ghost. Ghosts keep their true depth and are drawn as translucent
//   geometry, so a storey the active one covers simply loses the depth test:
//   the ghost shows wherever it does not block the depth you are working on.
// * **隐藏天花板** (on by default) is the single exception, and only for storeys
//   *above* the active one. A slab one storey up is the active room's ceiling,
//   so it is the nearest thing to a top-down camera and the one thing that
//   hides the room you are building. With the toggle on, a storey above keeps
//   only the pieces with nothing under them — the street outside, a canopy on
//   its own columns — and loses its ceilings. With it off, the ceilings draw
//   with the rest of the storey.

import { storeyBand } from '../sim/constants.ts'

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
  /** 沉浸: the eye is standing inside the room (`LevelSystem.setImmersive`). */
  immersive: boolean
}

/**
 * The slice one frame of the scene asks for.
 *
 * **隐藏UI and 沉浸 both put the slice away, and the slice is `ghost: true,
 * autoCeiling: false`.** Ghost on is what "every storey draws" means: with it
 * off the active storey would be the only one left, which is the opposite of
 * what a player who turned the storey slice off asked for. Ceilings off stops
 * the slab over the active room from being lifted. What makes the picture read
 * as a building rather than as a drawing is then **the material**: the mode's
 * caller skips the 35% ghost material and draws each piece as itself
 * (`LevelSystem.applyLevel`), because the translucent sheet lying over the floor
 * under the camera *is* the ghost, not anything the station hides.
 *
 * One function for the two modes because they are not two slices: they are one
 * picture, asked for from the rail and from inside the room.
 *
 * 隐藏墙壁 is deliberately **not** here: it is a look-through of the station's own
 * walls rather than a way of drawing a storey, so it survives either mode.
 *
 * Pure, so which slice a mode asks for is checkable without a renderer
 * (`test/grid-visibility.test.mjs`).
 */
export function sliceOptions(toggles: SliceToggles): SliceOptions {
  if (toggles.hideUI || toggles.immersive) return { ghost: true, autoCeiling: false }
  return { ghost: toggles.ghost, autoCeiling: toggles.autoCeiling }
}

/**
 * Whether the level slicing draws a piece on `side`.
 *
 * The two modes that put the slice away — 隐藏UI and 沉浸 — do not arrive here as
 * a flag: `sliceOptions` clears `ghost` and `autoCeiling` for them, and
 * `LevelSystem` then skips this walk's materials for every piece. The material,
 * and not only the visibility, has to be the mode's business: a flag here could
 * turn a piece on, but it could not undo the 35% ghost material the slice had
 * already assigned it.
 */
export function levelVisible(side: LevelSide, opts: SliceOptions): boolean {
  if (side === 'active') return true
  if (!opts.ghost) return false
  if (side === 'below') return true
  return !opts.autoCeiling || opts.unsupported === true
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
 * `showEveryStorey` is 隐藏UI or 沉浸 (`LevelSystem` passes either, `CrowdSystem`
 * asks per agent): both draw every storey, so both draw everyone on them — the
 * people on the floor above are exactly what a station drawn whole shows.
 */
export function crowdVisible(z: number, activeZ: number, ghost: boolean, showEveryStorey = false): boolean {
  if (showEveryStorey) return true
  const side = levelSide([storeyBand(z)], activeZ)
  return side === 'active' || (ghost && side === 'below')
}
