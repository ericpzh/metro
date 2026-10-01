// Street exit head-house (出入口) geometry — the numbers shared by the sim and
// the renderer, so the crowd and the drawing agree on where the opening is.
//
// The sim uses them to place the exit's street-opening node and to make the
// head-house solid: the crowd crosses at the opening and never through the glass
// sides or the back wall (§5.6). Pure data — no three, no DOM.

/** Width across the two escalator bays, metres. */
export const EXIT_W = 3.8
/** Length of the enclosed part: local y ∈ [−EXIT_L/2, +EXIT_L/2]. */
export const EXIT_L = 4.0
/** Canopy height above the walk, metres. */
export const EXIT_H = 3.2
/** How far the canopy reaches over the escalator run (−y), metres. */
export const EXIT_REACH = 5.6
/** Canopy overhang past the street doorway (+y), metres. */
export const EXIT_BACK = 2.3
/**
 * The street opening, in cells north of the module cell. The head-house is drawn
 * with its doorway at local +2, i.e. world y = module.y + 2.5 — the centre of the
 * cell two north of the module. That cell is the exit's graph node, so the crowd
 * walks in and out through the opening instead of teleporting under the canopy.
 */
export const EXIT_DOOR_Y = 2
/**
 * Back wall, local y. Lands on a cell boundary (world y = module.y − 5) so the
 * sim can drop the crossing row cleanly instead of sitting on a node.
 */
export const EXIT_BACK_Y = -5.5
/** Glass side planes, local x — just inside the frame. */
export const EXIT_SIDE = EXIT_W / 2 - 0.06
/** Glass sides, local y extent: the run's end up to just short of the doorway. */
export const EXIT_GLASS_Y0 = -5.5
export const EXIT_GLASS_Y1 = 1.8
