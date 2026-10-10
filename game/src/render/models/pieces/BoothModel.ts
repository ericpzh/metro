// Ticket booth (售票亭) builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { PieceBuilder, slab } from '../PieceBuilder.ts'
import type { ModuleContext } from '../PieceBuilder.ts'
import type { Module } from '../../../sim/types.ts'

/**
 * Ticket booth (售票亭): a service desk ringing the floor, with a glass screen
 * above the counter. There is no solid voxel base and no doorway — the desk is
 * a thin counter the crowd is served across, open overhead. Like a walled room,
 * the booth wears **no name plate**: a desk with a glass screen already reads as
 * a service point, and a 1.8 m 售票 board over it only repeated the palette tile
 * it was built from.
 *
 * The ring is a **closed box**, and every side of it is measured *inward from that
 * side's own outer face* — the module's cell boundary. That one rule is what the
 * four sides of the box share, and it is what the earlier pass got wrong: the east
 * run measured outward from the boundary and hung its counter and screen 0.55 m
 * out in the next cell, the north run measured from its last cell instead of the
 * boundary and stood a whole cell inside the room, and the capping boards stood a
 * lip proud of every face. Nothing on the piece may leave the cells the module
 * reserves, so every run now draws between its face and its face ± its depth.
 *
 * The counter is laid the way a picture frame is: the west and east runs own the
 * four corner squares and the north and south runs stop one counter depth short of
 * them, so the desk band is one connected ring with no overlapping slab at a corner
 * — drawing both runs through a corner is what used to make a 1 × 1 m pad of desk
 * there. (The boards butt at the corner squares rather than lapping over each other,
 * so they stay inside the footprint and the band still reads as one frame.)
 *
 * The screens are the box's own four walls: each side's screen stands against its
 * outer face across the whole run, and the north and south sheets run out to the
 * **inner face** of the west and east sheets, so two screens meet and butt at every
 * corner instead of stopping a counter-depth short with a hole beside them. A
 * corner mullion caps each of those joints. World space, origin at the floor.
 */
function buildBooth(ctx: ModuleContext, mod: Extract<Module, { type: 'booth' }>): THREE.Group {
  const mats = ctx.mats
  const g = new THREE.Group()
  const z0 = mod.z + 1
  const glazed = mod.cfg.kind !== 'info'
  // The room's own rectangle in world space: `x0`/`y0` are the module's first cells
  // and `x1`/`y1` the outer faces one cell past its last, which is where every run
  // measures its depth from.
  const x0 = mod.x
  const y0 = mod.y
  const x1 = mod.x + mod.w
  const y1 = mod.y + mod.h
  const DESK = 0.9 // counter height, metres
  const GLASS_TOP = 2.0
  /** Counter depth — a desk, not a wall: also the size of a corner square. */
  const DEPTH = 0.55
  /** The capping board's thickness. */
  const CAP_T = 0.06
  /** The screen stands against the counter's outer face. */
  const GLASS_T = 0.04
  const GLASS_INSET = 0.02
  /** Widest bar in the screen band: the screen's own top rail. */
  const RAIL = 0.07
  /** The corner mullion's width: wider than the screen band on both axes. */
  const POST = 0.09
  /** The screen's inner face — where a screen meeting it butts. */
  const GLASS_END = GLASS_INSET + GLASS_T
  /** How far the screen's foot is buried in the counter's board, so no faces meet. */
  const GLASS_FOOT = 0.01

  /**
   * One side of the ring. `side` names the outer face the run stands on; its counter,
   * board and screen all measure **inward** from that face, so no piece can leave the
   * module's cells. `a`/`b` are the counter's span along the side and `ga`/`gb` the
   * screen's — the two differ at a corner, where the side meeting another gives up the
   * joint to `GLASS_END` so the sheets butt instead of crossing.
   */
  const counterRun = (side: 's' | 'n' | 'w' | 'e', a: number, b: number, ga: number, gb: number): void => {
    // `at(u, v)` maps "u along the side, v inward from its outer face" to world x/y.
    const at = (u: number, v: number): [number, number] =>
      side === 'w' ? [x0 + v, u] : side === 'e' ? [x1 - v, u] : side === 's' ? [u, y0 + v] : [u, y1 - v]
    const alongX = side === 's' || side === 'n'
    // Desk: its span along the side, DEPTH across it, its outer face on the wall line.
    const len = b - a
    const [dx, dy] = at((a + b) / 2, DEPTH / 2)
    slab(g, mats.steel, dx, dy, z0 + DESK / 2, alongX ? len : DEPTH, alongX ? DEPTH : len, DESK)
    // The capping board sits **on** the desk rather than let into it (the old board
    // was centred on the counter top, and once its `LIP` was gone its outer face lay
    // in the desk's own plane — steel against dark steel, fighting for the depth).
    slab(g, mats.darkSteel, dx, dy, z0 + DESK + CAP_T / 2, alongX ? len : DEPTH, alongX ? DEPTH : len, CAP_T)
    // The screen: against the outer face, its foot inside that board and its head
    // inside the rail, so it only ever shows a clean sheet of glass in between.
    const gLen = gb - ga
    const [gx, gy] = at((ga + gb) / 2, GLASS_INSET + GLASS_T / 2)
    if (glazed) {
      const h = GLASS_TOP - DESK - GLASS_FOOT
      slab(g, mats.glass, gx, gy, z0 + DESK + GLASS_FOOT + h / 2, alongX ? gLen : GLASS_T, alongX ? GLASS_T : gLen, h)
      slab(g, mats.darkSteel, gx, gy, z0 + GLASS_TOP, alongX ? gLen : RAIL, alongX ? RAIL : gLen, CAP_T)
    }
  }

  // The west and east runs close all four corners; the south and north runs butt
  // between them, and their screens run out to the west and east screens' inner faces.
  for (const side of ['w', 'e'] as const) counterRun(side, y0, y1, y0, y1)
  for (const side of ['s', 'n'] as const) counterRun(side, x0 + DEPTH, x1 - DEPTH, x0 + GLASS_END, x1 - GLASS_END)
  // A mullion on each corner, standing over the joint where two screens meet: wider
  // than the screen band on both axes and reaching the outer faces, so the corner is
  // filled rather than notched, and buried in the board at its foot like the screens.
  // It may lie in the board's own planes (they are the same dark steel, so a shared
  // plane is one surface drawn twice and cannot flicker); what it must never share is
  // a plane with the steel desk or the `DoubleSide` glass.
  for (const cx of glazed ? [x0, x1 - POST] : []) {
    for (const cy of [y0, y1 - POST]) {
      slab(
        g,
        mats.darkSteel,
        cx + POST / 2,
        cy + POST / 2,
        z0 + DESK + GLASS_FOOT + (GLASS_TOP - DESK - GLASS_FOOT) / 2,
        POST,
        POST,
        GLASS_TOP - DESK - GLASS_FOOT,
      )
    }
  }
  // The staff benches are `bench` modules of their own, so each is
  // individually deletable; nothing solid is drawn inside the counter.
  return g
}

export class BoothModel extends PieceBuilder {
  readonly kind = 'booth'
  build(mod: Extract<Module, { type: 'booth' }>): THREE.Group {
    return buildBooth(this.ctx, mod)
  }
}

