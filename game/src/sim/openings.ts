// Ramps vs solid ground — GAME-SPEC §5.4 / §5.5.
//
// An escalator, stair or lift is placed as a `from`→`to` run, but the floor it
// climbs through has no opening in the cell data. Left alone, the ramp body
// draws straight through the slab ("escalators punching through solid ground").
//
// `carveRampOpenings` removes the solid cells a ramp passes through, so the run
// emerges from a real opening. It is deliberately conservative for stairs:
//   * only cells the ramp actually cuts *above its walking line* are removed;
//     the landing cells at both ends are kept, because the station graph needs
//     them as the ramp's edge nodes;
//   * a stair's treads stop half a landing cell short of each landing
//     (`stairTreadTrim`), so the run's own **body** — the slope it sweeps, which
//     `rampBodyBoxes` reports and equipment is tested against — leaves both landing
//     tiles as plain floor a 围栏 may stand on, and the slab a flight passes under
//     keeps its headroom;
//   * a vertical run (a lift shaft) is left alone — it spans the same column,
//     so there is nothing to carve cell-by-cell;
//   * an escalator cuts a taller corridor (ESCALATOR_HEADROOM) along its run,
//     so ceiling slabs and wall columns in the way are removed automatically.
//     Placement only needs both landings to be solid floor;
//   * the corridor is as wide as the whole assembly — balustrades and handrails
//     included — so the rails never surface through the blocks left and right
//     of the opening (`rampCorridorHalf`). Every piece is built to fit one cell,
//     so that corridor never reaches into the cell next door;
//   * pure data, no DOM, no three.

import { isWallBlock, packKey, shapeOf, type Cell, type CellShape, type FinishId, type Module, type Vec3i, type WallSide } from './types.ts'
import { ESCALATOR_BALUSTRADE, ESCALATOR_BAND, ESCALATOR_RAIL_PROUD, STAIR_RAIL_PROUD } from './constants.ts'
import { exitFloorAt } from './exits.ts'
import { virtualSolidAt } from './ground.ts'
import { STAIR_WIDTH_NARROW, stairFlightSlides, stairFlights, stairLandings, stairTreadTrim } from './stairs.ts'

/** Headroom above the walking line that must be clear, metres. */
const HEADROOM = 1.3
/**
 * Clearance an escalator cuts along its run, metres. Tall enough to clear a
 * person and the balustrade and to take out the storey's wall columns above the
 * walking line, so a run can punch through a wall as long as both landings are
 * solid floor. It must not reach the slab of the storey *above* the one the run
 * lands on: a run stops on top of a floor, so everything higher than headroom
 * over the landing belongs to the room it lands in, not to the shaft. The old
 * 3.2 m over-carve reached the concourse roof above the platform runs and the
 * plaza above the exit runs, punching holes in slabs the run never meets.
 * Stairs keep the conservative HEADROOM.
 */
export const ESCALATOR_HEADROOM = 2.2

/**
 * Tag on the lowest solid block directly above a column a ramp carve opened: it
 * is the opening's ceiling, not a plate hanging in space. The level slicer
 * (`render/scene.ts`) cuts it with the rest of the ceiling instead of ghosting
 * it over the active storey.
 */
export const OPENING_CEILING = 'opening-ceiling'
/** A cell must clear the line by this much before it counts as an obstruction. */
const EPS = 0.02
/**
 * How far a run's swept **body or handrail** must cross a block's near edge before
 * that block counts as reached, metres.
 *
 * A 双跑楼梯's run is built to fill whole blocks (`stairSwitchbackRunWidth`): its treads
 * and both of its balustrades end exactly on the cell edges of the blocks it stands in,
 * so its corridor half-width is exactly half a block per lane. A rail like that
 * *touches* the near face of every block beside it and enters none of them, and touching
 * is not being in: the wall a player pushes the piece flush against stays whole, with
 * nothing to make room for (`rampThinCells`). The tolerance is a micrometre of real
 * overlap — a hair of a body inside the neighbouring cell is still drawn as a half panel,
 * while float noise in a width the catalogue derived is not read as one.
 */
const REACH_EPS = 1e-6
/**
 * The handrail sweeps wider than the treads, so the opening has to clear the
 * whole assembly or the rails emerge through the floor blocks directly either
 * side of the run. An escalator's handrail stands `ESCALATOR_RAIL_PROUD` (0.15 m:
 * a 0.03 stand-off from the glass plus the 0.1 handrail section, a hair clear of
 * the skirt) proud of its step band, so the run sweeps
 * `ESCALATOR_BAND / 2 + 0.15` — 0.49 m, inside its own 1 m cell rather than into
 * the next one. `sim/exits.ts` opens its wellways with the same two numbers.
 */
const ESCALATOR_CORRIDOR_HALF = ESCALATOR_BAND / 2 + ESCALATOR_RAIL_PROUD

/**
 * Half-width a ramp sweeps, including its balustrade and handrail. Carving only
 * the tread width leaves the rails — which sit proud of the treads — poking
 * through the blocks to the left and right of the opening. Both pieces are built
 * to fit one cell, so this stays under 0.5: a block or a wall standing beside a
 * run is never reached, never carved and never thinned.
 */
export function rampCorridorHalf(m: Module): number {
  if (m.type === 'stair') return (m.cfg.width ?? STAIR_WIDTH_NARROW) / 2 + STAIR_RAIL_PROUD
  return ESCALATOR_CORRIDOR_HALF
}

/**
 * Half-width of a ramp's physical body — the treads / step band, without the
 * handrail. A block whose cell the body only *partially* overlaps (a 1.6 m stair
 * reaches 0.3 m into the columns either side) is kept and drawn as a half-metre
 * panel so the run still fits beside it (`rampThinCells`).
 */
export function rampBodyHalf(m: Module): number {
  if (m.type === 'stair') return (m.cfg.width ?? STAIR_WIDTH_NARROW) / 2
  // The escalator's step band is the shared `ESCALATOR_BAND`, so its half is
  // 0.34 m — well inside one cell, so an adjacent cell is not carved.
  return ESCALATOR_BAND / 2
}

/**
 * Half-width of the *core* opening: the cells the run's centreline actually
 * passes through. Only these are carved (and reserved); every other block the
 * body or rail reaches is kept and thinned instead, so the floor beside a wide
 * stair is not deleted and stays buildable.
 */
export const RAMP_CORE_HALF = 0

/* ------------------------------------------------------- ramp collision box */

/**
 * Half-width a run reserves, metres: its own cell. A run is built to fit inside
 * one tile — body and handrails both — so its envelope is exactly that tile
 * column, and two runs in adjacent cells simply *touch*. The strict-overlap rule
 * therefore already lets a bank stand flush, with no special case: only a wider
 * piece (a 1.6 m stair, whose body genuinely crosses into the next cell) claims
 * more room than the tile it stands in.
 */
const RAMP_TILE_HALF = 0.5
/**
 * Truss depth below the walking line, metres: how far the body of a run — an
 * escalator's truss — hangs under the surface it carries. Shared by the collision
 * body (`flightBodyBoxes`) and the cut an **escalator** makes in the blocks under it
 * (`rampSlopeCuts`), so the space equipment is kept out of and the volume taken out
 * of a block are the same volume. A **stair** is not a truss box and hangs to
 * `STAIR_BODY_DROP` instead.
 */
export const RAMP_FOOT = 0.5

/**
 * How far a **stair**'s drawn body — the stringers and the soffit they carry — hangs
 * below its walking line, metres: the plane the ground under a stair is cut to
 * (`rampSlopeCuts`) and the line the model hangs its stringers and soffit from, so the
 * filling rises to the underside of the steps instead of stopping a hand's width below
 * it. One number for both, because a stair cut to an escalator's `RAMP_FOOT` (0.5 m)
 * leaves a slot of daylight between the steps and the ground that fills up to them —
 * which is exactly what an escalator, whose truss really is that deep and whose own
 * piece draws the body under it, does not.
 */
export const STAIR_BODY_DROP = 0.36
/** Balustrade height above the walking line, metres. */
const RAMP_HEADROOM = 1.2
/** Vertical padding, so a run never reads as touching the storey above/below. */
const RAMP_CLEAR = 0.15

export interface RampBox {
  x0: number
  y0: number
  z0: number
  x1: number
  y1: number
  z1: number
}

/**
 * The world-space bounding box a ramp occupies: its footprint widened by the
 * half-width, dropping the truss depth below the lower landing and rising the
 * balustrade above the higher one. A turning stair's box spans every flight, so
 * it reserves the whole corner it turns through.
 */
export function rampEnvelope(m: Module): RampBox | null {
  const segs = rampSegments(m)
  if (!segs) return null
  // A run reserves its own cell; only a body wider than a cell claims more.
  const half = Math.max(RAMP_TILE_HALF, rampBodyHalf(m))
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  let lo = Infinity
  let hi = -Infinity
  for (const s of segs) {
    const ax = s.from.x + 0.5 + (s.sx ?? 0)
    const ay = s.from.y + 0.5 + (s.sy ?? 0)
    const bx = s.to.x + 0.5 + (s.sx ?? 0)
    const by = s.to.y + 0.5 + (s.sy ?? 0)
    x0 = Math.min(x0, ax, bx)
    x1 = Math.max(x1, ax, bx)
    y0 = Math.min(y0, ay, by)
    y1 = Math.max(y1, ay, by)
    lo = Math.min(lo, s.from.z, s.to.z)
    hi = Math.max(hi, s.from.z, s.to.z)
  }
  return {
    x0: x0 - half,
    x1: x1 + half,
    y0: y0 - half,
    y1: y1 + half,
    z0: lo + 1 - RAMP_FOOT - RAMP_CLEAR,
    z1: hi + 1 + RAMP_HEADROOM + RAMP_CLEAR,
  }
}

function boxesOverlap(a: RampBox, b: RampBox): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0 && a.z0 < b.z1 && a.z1 > b.z0
}

/* ------------------------------------------- the volume a run takes out */

/**
 * The volume a run removes from a block under it: the top of the block is the
 * run's own underside, a plane sloping along one horizontal axis. In **cell-local**
 * units — 0 is the block's floor, 1 its ceiling — so a mesher can put a profile
 * point's top at `lo + (hi − lo) · t` without knowing anything about the run.
 *
 * `lo`/`hi` are the plane at the cell's two edges and are **not** clamped to the cell: a
 * plane that leaves through its floor or ceiling on one side still slopes, and flattening
 * that end would tip the whole plane up and poke it through the run at the other. The
 * reader clamps each point it draws, which leaves the slope exactly where the run put it.
 * They are held off the **base plane** the run stands on (`base`) instead: a stair's soffit
 * hangs below the landing it leaves, and ground cut to it there would be a wedge dipping
 * under the floor the piece is founded on rather than that floor's own level continuation.
 */
export interface SlopeCut {
  /** The axis the plane slopes along. */
  axis: 'x' | 'y'
  /** Height of the cut at the cell's low edge along `axis`. */
  lo: number
  /** The same at its high edge. */
  hi: number
  /**
   * The lowest plane this cut may reach, in the **same cell-local units** as `lo`/`hi`:
   * the run's own **base plane**, the surface of the landing it climbs from (world
   * `from.z + 1`).
   *
   * A **stair** sets it, and the reader clamps the cut up to it, because below that plane
   * there is no ground to take: the base landing is the floor the piece stands on, and the
   * ground under it is the floor the player walks across. A stair's body is steeper than
   * its run — the treads stop `stairTreadTrim` short of each landing but still carry the
   * whole rise — so near the foot its soffit hangs *below* the plane the piece stands on.
   * Cut without this and the block under the base comes out a tilted wedge that dips under
   * the floor beside it (`the block below the base of stair is not flat`): the base block
   * is a floor block, not a batten, and it has to stay level with the floor it continues.
   *
   * A cut that reaches this plane over a whole cell leaves that block **whole** — trim to
   * the plane and a level top is exactly what the cell already is.
   */
  base?: number
  /**
   * Half-width of the run's **drawn** body across that axis where it is narrower than
   * the cell — an escalator's truss box (`ESCALATOR_BALUSTRADE / 2`). Absent where the
   * body fills the cell, which is what a stair's treads do: they run out to the cell
   * edge, so a block under them is shaved across its whole footprint.
   *
   * The filling under a run reads this to be drawn *as the body* it hangs from rather
   * than as a block of the cell's size (`chunkMesher`'s `fill` path), so an escalator's
   * skirt meets its truss flush instead of stepping out 9 cm either side.
   */
  half?: number
  /**
   * The run's **own painted surface** (`cfg.finish`, the 材质 brush on the piece), when it has
   * one. The canvas the cut leaves — a shaved block's cap or the derived filling above it — is
   * part of that piece's surface rather than the ground's, so it is drawn in this finish
   * (`chunkMesher`'s cap): a 楼梯 painted with the 材质 brush takes the ground under it with it.
   */
  finish?: FinishId
  /**
   * The run leaves the ground under it **as it is**: no filling is derived over it
   * (`rampFillKeys`). A **楼梯** asks for this. It shaves the blocks its flight really meets —
   * the floor it climbs from, the slabs it passes through — and where there is no block the
   * flight hangs over its own well, open, instead of standing on a mass the renderer made up:
   * the course a filling would fill is the run's own carved passage, which no block fits in
   * and no 材质 brush can paint.
   */
  noFill?: boolean
  /**
   * The run's **own piece** draws the body that would be filled here — an escalator's
   * undercroft (`EscalatorModel.undercroftSolid`), which is cut to this very cell and plane.
   * `rampFillKeys` skips it: two bodies in one place are two coplanar faces, one of them
   * meshed from the ground's kit and one from the model's, and the pair flickers against each
   * other wherever they meet. The piece's solid stands there instead.
   */
  ownBody?: boolean
}

/**
 * The ground a run's truss hangs into, where no block was laid: every cell
 * `rampSlopeCuts` names that is **void**, stands on a **solid** block, and whose run
 * leaves its ground alone (`SlopeCut.ownBody` / `noFill`) — the wedge between the top of the
 * ground below and the run's underside, by packed cell key.
 *
 * Nothing is added to the station. Where a run keeps this course the brush may not lay it
 * (its nominal top would sit above the walking line, where the crowd's own floor is
 * measured), so the gap under the run would stay open to the storey below. The renderer
 * draws it instead: the cut that would shave a block laid there shaves this filling the same
 * way, so the ground reads as rising to the run, and it appears and disappears with the
 * ground and the run on its own (`thinWallCells` is the same kind of derived surface).
 *
 * Two things derive nothing. A cell with **no ground directly under it is deliberately left
 * alone**: a run over void is a run over void, and inventing a column of solid under it would
 * be the renderer making up a building the player never laid. And a **楼梯** leaves its
 * ground alone everywhere (`SlopeCut.noFill`): it shaves the blocks its flight really meets —
 * the floor it climbs from, the slabs it passes through — and where there is no block it
 * hangs over its own well, open. The course a filling would stand in there is the run's own
 * **carved passage**, a mass no block would fit in and no 材质 brush can paint, so a stair's
 * under-side is exactly its ground: the block below the first step, shaved, and nothing else.
 *
 * `solid` holds packed cell keys, and a cell's own key minus one is the cell directly
 * under it (`packKey`'s z term is the last one it adds), so the block below is found
 * without unpacking a coordinate.
 */
export function rampFillKeys(solid: ReadonlySet<number>, slopes: ReadonlyMap<number, SlopeCut>): Set<number> {
  const out = new Set<number>()
  for (const [k, cut] of slopes) {
    // A run whose own piece draws this body gets no filling: the piece's solid is already there,
    // and a second one on the same plane is a face that flickers against it. A stair asks for
    // none at all — its flight hangs over its own well rather than on a mass the renderer made.
    if (cut.ownBody || cut.noFill) continue
    if (solid.has(k)) continue
    if (!solid.has(k - 1)) continue
    out.add(k)
  }
  return out
}

/**
 * Every block a run cuts through, by packed cell key: the volume a 楼梯 or 扶梯
 * takes out of the ground it climbs over.
 *
 * The cut is the run's **body** seen from underneath: the same tiles
 * `rampBodyBoxes` reserves for collision, with the truss depth (`RAMP_FOOT`) taken
 * off the local walking line, so the block under a run ends on the slope its truss
 * hangs from instead of bulging up through it as a full cube. Nothing is added to
 * the station — a cut is derived from the runs, so it follows a move or a delete
 * like every other derived surface (`thinWallCells`), and there is no filling-block
 * piece to keep in step with the run that made it.
 *
 * Three things keep it to the handful of blocks that really touch a run rather
 * than a trench along its whole length:
 *   * only the column the run's own walking line passes through is cut — the same
 *     one `carveRampOpenings` opens above the line. A block beside a wide stair is
 *     kept and thinned (`rampThinCells`), never cut;
 *   * a **stair** is measured over the tiles its treads actually sweep, so its
 *     landing tiles are not cut — the treads stop at their edge;
 *   * the two **landing columns** of any run are left alone, exactly as the carve
 *     protects their cells: they are the run's graph nodes and the floor the crowd
 *     stands on at the foot of the run, so a block there stays level with that
 *     surface rather than being cut on a slope.
 *
 * A cell the plane only clips a corner of is cut too, and one it passes clean
 * under is not reported at all — so a block deeper down, or one the slope has
 * already cleared, is left exactly as the player built it.
 */
export function rampSlopeCuts(modules: readonly Module[]): Map<number, SlopeCut> {
  const out = new Map<number, SlopeCut>()
  const protect = new Set<string>()
  const protectPoint = (p: Vec3i): void => {
    protect.add(`${p.x},${p.y}`)
  }
  for (const m of modules) {
    // Only a run that climbs: a lift's shaft is vertical, so it has no walking line
    // to hang anything under and nothing to cut.
    if (m.type !== 'stair' && m.type !== 'escalator') continue
    // The landing columns are graph nodes and walkable floor: a block under one is
    // left level with the surface the crowd walks on, never cut on the run's slope.
    if (m.type === 'stair') {
      for (const p of stairLandings(m)) protectPoint(p)
    } else {
      protectPoint(m.from)
      protectPoint(m.to)
    }
    const segs = rampSegments(m)
    if (!segs) continue
    const trimLandings = m.type === 'stair'
    // How deep the body under the line really hangs: an escalator's truss box, or a
    // stair's stringers and soffit. The ground is cut to *that*, or the filling stops
    // in mid-air below the steps it is supposed to carry.
    const foot = m.type === 'stair' ? STAIR_BODY_DROP : RAMP_FOOT
    for (const s of segs) {
      const tiles = flightTiles(s, trimLandings)
      if (!tiles) continue
      /**
       * The plane the ground under this flight may not be cut below — the **base plane**
       * of the flight, the surface of the landing it climbs from. A stair's body line is
       * steeper than its run (the treads are trimmed, the rise is not), so it leaves the
       * landing already below that surface and the first columns past the landing would
       * otherwise be shaved into a wedge that dips under the floor beside them. Trimming
       * the cut to the plane the piece stands on keeps the block under the base a floor
       * block: level, at the level of the landing it continues (`SlopeCut.base`).
       *
       * `FlightTile.a`/`b` are the line's own output at the tile's edges, so this needs
       * nothing applied to them: the lowest point of the treads' line *is* the surface the
       * piece stands on.
       */
      const base = trimLandings ? Math.min(...tiles.map((t) => Math.min(t.a, t.b))) : undefined
      for (const t of tiles) {
        const axis: 'x' | 'y' = t.alongX ? 'x' : 'y'
        // Which way round `a`/`b` sit only decides which end of the block is the
        // high one; the block is cut by the plane either way.
        const ua = t.a - foot
        const ub = t.b - foot
        // The cells the underside passes through: the deepest one it enters, up to
        // the highest one it has not left again. A block entirely under the plane
        // is never reached, and one entirely above it is not reported.
        const first = Math.floor(Math.min(ua, ub) + 1e-9)
        const last = Math.ceil(Math.max(ua, ub) - 1e-9) - 1
        for (const [x, y] of cellsOnLine(t)) {
          if (protect.has(`${x},${y}`)) continue
          for (let z = first; z <= last; z++) {
            // The plane where it crosses this block, kept unclamped so its slope is the
            // run's: the reader flattens whatever falls outside the block it draws.
            const lo = ua - z
            const hi = ub - z
            // A plane entirely past the block's ceiling cuts nothing; one entirely
            // under its floor has already taken the whole block, which is the carve's
            // business (the run's own cell), not a shave.
            if (lo >= 1 && hi >= 1) continue
            if (lo <= 0 && hi <= 0) continue
            // A stair never takes ground below its own base plane (`SlopeCut.base`): an edge of the
            // plane **at or under** it is raised to it, and a cell the plane reaches nowhere above
            // it is left as the whole, level block it is — no shave below the floor the piece stands
            // on. The edge that merely *touches* the plane counts: the treads' own soffit starts
            // there, so the ground beside it is already under the body the flight hangs.
            const baseZ = base === undefined ? undefined : base - z
            const raised = (v: number): number | undefined =>
              baseZ !== undefined && v <= baseZ + 1e-9 ? baseZ : undefined
            const loRaised = raised(lo)
            const hiRaised = raised(hi)
            const local = loRaised ?? lo
            const localHi = hiRaised ?? hi
            const k = packKey(x, y, z)
            const prev = out.get(k)
            // Two runs over one block — an exit crossed by a stair — are settled by
            // whichever bites deeper, so the block clears both.
            if (prev !== undefined && Math.min(prev.lo, prev.hi) <= Math.min(local, localHi)) continue
            const cut: SlopeCut = { axis, lo: local, hi: localHi }
            // The plane is named only where the clamp really holds it: a cut already clear of the
            // base plane is the run's own body, and saying otherwise would tell the reader — and
            // the tests — that a cell was raised when it was not.
            if (baseZ !== undefined && (loRaised !== undefined || hiRaised !== undefined)) cut.base = baseZ
            // An escalator's body is its truss box, narrower than the cell: the filling
            // under it is drawn as that box. A stair's treads run out to the cell edge, so
            // its cut stays cell-wide.
            if (m.type === 'escalator') {
              cut.half = ESCALATOR_BALUSTRADE / 2
              // …and the 扶梯 draws that body itself now, so no filling is derived over it.
              cut.ownBody = true
            }
            if (m.type === 'stair') {
              // A stair leans on the ground it really has and on nothing else: the blocks its
              // flight meets are shaved, the carved passage under it stays open (its own well).
              cut.noFill = true
              // A painted **楼梯** (`cfg.finish`, the 材质 brush on the piece) paints the ground
              // it stands on: the canvas its cut leaves is part of that piece's surface, so it
              // wears the piece's own finish unless the block's own top face was painted.
              if (m.cfg.finish) cut.finish = m.cfg.finish
            }
            out.set(k, cut)
          }
        }
      }
    }
  }
  return out
}

/* ------------------------------------------------------- a run's own body */

/**
 * The boxes a **run's own body** fills, for collisions with flat equipment: one
 * per tile the run sweeps, each cut to the slope *at that tile* — the truss under
 * the local walking line up to the handrail over it (`flightBodyBoxes`).
 *
 * Two things follow, and both are what the builder asks for:
 *   * a **stair**'s treads stop half a landing cell short of each landing
 *     (`stairTreadTrim`), so its landing tiles hold no run at all — the block at
 *     the head (or the foot) of a well is floor a 围栏 may stand on;
 *   * a slab a run merely climbs **underneath** keeps its headroom, so the block
 *     over the lower half of a flight is floor too. A box spanning the whole run
 *     would cover both — the *reservation* (`rampEnvelope`) does, because a second
 *     run must never be dropped through the first, and two runs meet on it.
 *
 * An **escalator** keeps its landing tiles: its truss, step band and balustrades
 * are built from landing centre to landing centre (`render/models.ts`), so its
 * body covers every tile of its run, landings included. A lift is not here at all —
 * its space is the 2 × 2 shaft (`placement.ts`).
 *
 * Returns nothing for a piece that is neither, and for a flight it cannot measure —
 * the caller must then keep the envelope rather than read emptiness as clear space.
 */
export function rampBodyBoxes(m: Module): RampBox[] {
  if (m.type !== 'stair' && m.type !== 'escalator') return []
  const segs = rampSegments(m)
  if (!segs) return []
  // A legacy 1.6 m stair's body crosses into the cells either side of it; every
  // lane-sized piece (the builder's wide stair is lanes) stays inside its own tile.
  const extra = Math.max(0, rampBodyHalf(m) - RAMP_TILE_HALF)
  const drop = m.type === 'stair' ? STAIR_BODY_DROP : RAMP_FOOT
  const out: RampBox[] = []
  for (const s of segs) {
    const boxes = flightBodyBoxes(s, m.type === 'stair', extra, drop)
    if (!boxes) return []
    out.push(...boxes)
  }
  return out
}

/**
 * One tile a flight's body sweeps: the column the run's own walking line passes
 * through, and the line's height where it enters and leaves that column.
 *
 * This is the single sweep both the collision body (`flightBodyBoxes`) and the cut
 * a run makes in the block under it (`rampSlopeCuts`) are read off, so the space
 * equipment is kept out of and the volume removed from a block can never disagree
 * about where a run is.
 */
interface FlightTile {
  x: number
  y: number
  /** True when the run travels along x, so its line slopes along x. */
  alongX: boolean
  /** The walking line at the tile's low edge along the run's axis, metres. */
  a: number
  /** The same at its high edge — `x + 1` when `alongX`, else `y + 1`. */
  b: number
  /** How far the body is slid across from the flight's own walking line, cells. */
  sx: number
  sy: number
}

/**
 * The tiles one flight sweeps, in order. `trimLandings` is the difference between
 * the two kinds of run: a stair's treads stop half a landing cell short at each
 * end (`stairTreadTrim`), an escalator's truss runs landing centre to landing
 * centre and so covers them.
 */
function flightTiles(s: Ramp, trimLandings: boolean): FlightTile[] | null {
  const dx = s.to.x - s.from.x
  const dy = s.to.y - s.from.y
  // Every flight is axis-aligned (a stair turns by quarter turns, an escalator
  // runs along its placement rotation); anything else keeps its envelope.
  if (dx !== 0 && dy !== 0) return null
  const len = Math.hypot(dx, dy)
  // A run with no horizontal sweep has no tiles to sweep: it is a shaft, and
  // every tile question about it is meaningless rather than merely empty.
  if (len < 1e-6) return null
  const ux = dx === 0 ? 0 : Math.sign(dx)
  const uy = dy === 0 ? 0 : Math.sign(dy)
  // The treads cover the span [trim, len − trim] from the lower landing's centre;
  // a cell's own span is (i − 0.5, i + 0.5), so the indices it meets are these.
  // The epsilons keep a span that ends exactly on a cell edge off that cell.
  const trim = trimLandings ? stairTreadTrim(len) : 0
  const first = Math.floor(trim - 0.5 + 1e-9) + 1
  const last = Math.ceil(len - trim + 0.5 - 1e-9) - 1
  if (last < first) return null
  const line = walkLine(s, trimLandings)
  const alongX = dx !== 0
  // `i + 0.5` is the far edge of the tile in **run order**; when the run travels
  // the negative way that edge is the cell's own low edge, so the two heights swap
  // and `a` is always on the cell's low side.
  const forward = (alongX ? ux : uy) > 0
  const [sx, sy] = [s.sx ?? 0, s.sy ?? 0]
  const out: FlightTile[] = []
  for (let i = first; i <= last; i++) {
    const near = line(i - 0.5)
    const far = line(i + 0.5)
    out.push({
      x: s.from.x + ux * i,
      y: s.from.y + uy * i,
      alongX,
      a: forward ? near : far,
      b: forward ? far : near,
      sx,
      sy,
    })
  }
  return out
}

/**
 * The cells one flight tile's own **walking line** passes through, as `[x, y]`.
 *
 * Usually the tile's single column — the line runs down the middle of the cell the
 * tile names. A flight **slid across its run** (`sx` / `sy`, `stairFlightSlides`) is the
 * exception, and the reason this is not just `[t.x, t.y]`: a block-grid switchback's
 * runs stand half a block off their landing cells, so each flight's walking line runs
 * exactly along a **block boundary**, and a line on an edge belongs to the cells it
 * borders — the rule the carve applies (`within`'s `RAMP_CORE_HALF` test, whose
 * `gap === 0` case is exactly "the line merely divides this cell"). Cutting only the
 * column the tile is named for left the band's second block standing inside the
 * flight's soffit, up to the body's own drop of ground poking through the treads.
 *
 * This is the same test the carve makes, read off the tile instead of a cell list: a
 * cell counts when its centre is no further than half a cell from the line.
 */
function cellsOnLine(t: FlightTile): Array<[number, number]> {
  const across = t.alongX ? t.y + 0.5 + t.sy : t.x + 0.5 + t.sx
  const out: Array<[number, number]> = []
  for (let i = Math.floor(across - 0.5); i <= Math.ceil(across - 0.5); i++) {
    if (Math.abs(i + 0.5 - across) > 0.5 + 1e-9) continue
    out.push(t.alongX ? [t.x, i] : [i, t.y])
  }
  return out
}

/**
 * The walking line of one flight, `u` cells along the run from the lower landing's
 * centre, as an **absolute** height (the landing surfaces are `from.z + 1` / `to.z + 1`).
 *
 * A **stair** is the exception, and the reason this is not one line: its treads stop
 * `stairTreadTrim` short of each landing centre but still carry the whole rise, so the
 * body under them — stringers and soffit, which the model hangs from that same line —
 * is *steeper* than the landing-to-landing line. Cutting the ground to the shallow line
 * leaves a wedge of daylight under a flight's upper steps and buries the plane in its
 * lower ones; the closer the trim is to a third of the run (a 3-cell turn flight is
 * trimmed by a sixth of it each end), the worse it gets. An escalator's truss really does
 * run landing centre to landing centre, so it keeps the line.
 *
 * It is also what the flight's **base plane** is read off (`rampSlopeCuts`): the line at
 * the lower end of the treads is where the piece stands, and the ground under a stair is
 * never cut below it.
 */
function walkLine(s: Ramp, trimLandings: boolean): (u: number) => number {
  const len = Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y)
  const az = s.from.z + 1
  const bz = s.to.z + 1
  const trim = trimLandings ? stairTreadTrim(len) : 0
  const span = len - trim * 2
  return (u: number): number => (trimLandings ? az + (bz - az) * ((u - trim) / span) : az + (bz - az) * (u / len))
}

/**
 * One flight's body boxes, one per swept tile. The tile is widened across the run
 * only for a body wider than a cell, and slid bodily when the body stands off its
 * own walking line.
 *
 * `drop` is how deep the body really hangs under its line, and it is the **drawn**
 * number, not one shared depth: an escalator's truss by `RAMP_FOOT`, a stair's
 * stringers and soffit by `STAIR_BODY_DROP` (`rampSlopeCuts` cuts the ground to the
 * same one). Reserving a stair at the truss's depth kept a bench or a 围栏 out of a
 * 0.29 m band the stair's own model leaves clear.
 */
function flightBodyBoxes(s: Ramp, trimLandings: boolean, extra: number, drop: number): RampBox[] | null {
  const tiles = flightTiles(s, trimLandings)
  if (!tiles) return null
  return tiles.map((t) => {
    const lo = Math.min(t.a, t.b)
    const hi = Math.max(t.a, t.b)
    return {
      x0: t.x - (t.alongX ? 0 : extra) + (t.alongX ? 0 : t.sx),
      y0: t.y - (t.alongX ? extra : 0) + (t.alongX ? t.sy : 0),
      x1: t.x + 1 + (t.alongX ? 0 : extra) + (t.alongX ? 0 : t.sx),
      y1: t.y + 1 + (t.alongX ? extra : 0) + (t.alongX ? t.sy : 0),
      z0: lo - drop - RAMP_CLEAR,
      z1: hi + RAMP_HEADROOM + RAMP_CLEAR,
    }
  })
}

/**
 * True when a candidate ramp would share space with an existing one — the rule
 * that stops a second escalator being dropped immediately below a first. Two
 * runs in adjacent cells are not a clash: each reserves its own tile, so their
 * boxes touch rather than overlap, and a bank of escalators and stairs stands
 * flush with every run keeping its own balustrade. That balustrade is also the
 * barrier the crowd walks around (`rampWalls` in `sim/station.ts`).
 */
export function rampBlocked(modules: readonly Module[], candidate: Module): boolean {
  const c = rampEnvelope(candidate)
  if (!c) return false
  for (const m of modules) {
    if (m === candidate || (candidate.id && m.id === candidate.id)) continue
    const e = rampEnvelope(m)
    if (e && boxesOverlap(c, e)) return true
  }
  return false
}

interface Ramp {
  from: Vec3i
  to: Vec3i
  /** Vertical clearance above the walking line this run carves, metres. */
  headroom?: number
  /** Half-width of the physical body (treads / step band), metres. */
  bodyHalf: number
  /** Half-width the handrail sweeps, metres. */
  railHalf: number
  /**
   * How far the run's **body** is slid across from its own centreline, in world
   * cells (`stairFlightSlides`). A switchback's return run slides until its
   * balustrade meets the first run's, so its treads, its rails and the corridor it
   * carves all stand off the cell its landings sit on.
   */
  sx?: number
  sy?: number
}

/**
 * Both ends of an escalator run must stand on solid floor — the lower base and
 * the upper landing — or on an exit's floor: any cell an exit covers counts,
 * even a hole a ramp carved there. Everything in between (ceiling slabs, wall
 * columns) is carved on placement, so intermediate solids never block it.
 */
export function escalatorBasesSolid(cells: readonly Cell[], modules: readonly Module[], m: Module): boolean {
  if (m.type !== 'escalator') return true
  const has = (p: Vec3i): boolean =>
    cells.some((c) => c.fill === 'solid' && c.x === p.x && c.y === p.y && c.z === p.z) ||
    exitFloorAt(modules, p.x, p.y, p.z) ||
    virtualSolidAt(cells, modules, p.x, p.y, p.z)
  return has(m.from) && has(m.to)
}

/**
 * The straight segments a ramp sweeps: an escalator or lift has one, a stair
 * has one per flight (its turn is a landing the flights meet at). A stair flight
 * also carries the slide of its body from its own walking line, so a switchback's
 * flush return run is carved and reserved where its treads really stand.
 */
function rampSegments(m: Module): Ramp[] | null {
  if (m.type === 'stair' && m.cfg.block) return null
  const bodyHalf = rampBodyHalf(m)
  const railHalf = rampCorridorHalf(m)
  if (m.type === 'escalator' || m.type === 'lift') return [{ from: m.from, to: m.to, bodyHalf, railHalf }]
  if (m.type === 'stair') return stairSegments(m)
  return null
}

/** A stair's flights as ramp segments, each with its own body slide. */
function stairSegments(m: Extract<Module, { type: 'stair' }>): Ramp[] {
  if (m.cfg.block) return []
  const bodyHalf = rampBodyHalf(m)
  const railHalf = rampCorridorHalf(m)
  const slides = stairFlightSlides(m)
  return stairFlights(m).map((f, i) => ({ from: f.from, to: f.to, bodyHalf, railHalf, sx: slides[i].dx, sy: slides[i].dy }))
}

/**
 * Every corridor the placed ramps carve, with the per-type headroom `intrudes`
 * reads: an escalator cuts the taller wall/ceiling corridor, a stair or lift the
 * conservative one. The carve and the block-brush reservation share this single
 * list, so a hand-built block is refused in exactly the cells the carve opens.
 */
function rampList(modules: readonly Module[]): Ramp[] {
  const ramps: Ramp[] = []
  for (const m of modules) {
    if (m.type === 'stair') {
      ramps.push(...stairSegments(m))
    } else if (m.type === 'escalator' || m.type === 'lift') {
      const headroom = m.type === 'escalator' ? ESCALATOR_HEADROOM : undefined
      ramps.push({ from: m.from, to: m.to, headroom, bodyHalf: rampBodyHalf(m), railHalf: rampCorridorHalf(m) })
    }
  }
  return ramps
}

/**
 * True when a solid cell lies within `half` of a ramp's centreline and above its
 * walking line by no more than the headroom — i.e. the run has to pass through
 * it. The lateral test uses the cell's *near edge* (half a cell closer than its
 * centre), so a block only counts when the swept half-width crosses into it.
 * `headroom` is the clearance above the line; escalators use
 * ESCALATOR_HEADROOM so wall columns along the way are cleared, stairs keep the
 * conservative HEADROOM. A vertical run (lift) has no sweep.
 *
 * `half` decides what "reaches" means, because the two callers ask two different
 * questions:
 *
 *   * `RAMP_CORE_HALF` (0) asks for the cell the run's own **line** passes through.
 *     A line that runs exactly along a cell edge belongs to the cell it borders: a
 *     switchback's runs are slid half a block off their landing cells
 *     (`stairFlightSlides`), so each flight stands its walking line on a block
 *     boundary and the opening is the pair of blocks that line divides.
 *   * a **swept width** (a body, or a handrail) is a volume, and it reaches a block
 *     only when it crosses that block's near edge — merely touching the face of it
 *     is not being inside it (`REACH_EPS`).
 */
function within(c: Cell, r: Ramp, half: number): boolean {
  const ax = r.from.x + 0.5
  const ay = r.from.y + 0.5
  const az = r.from.z + 1
  const dx = r.to.x + 0.5 - ax
  const dy = r.to.y + 0.5 - ay
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-6) return false
  // The body's own line: the centreline slid across by the run's `sx`/`sy`, which
  // is where a switchback's flush return run really sweeps.
  const px = c.x + 0.5 - (r.sx ?? 0)
  const py = c.y + 0.5 - (r.sy ?? 0)
  const t = ((px - ax) * dx + (py - ay) * dy) / len2
  if (t < 0 || t > 1) return false
  const lateral = Math.abs((px - ax) * dy - (py - ay) * dx) / Math.sqrt(len2)
  // How far the run's line is clear of the cell's near edge. The core test keeps a
  // cell the line merely divides (`gap === 0`); a swept width has to cross it, so a
  // run built to the block grid — whose rail ends exactly on the edge — reaches
  // nothing beside its own blocks and leaves the wall there whole.
  const gap = Math.max(0, lateral - 0.5)
  if (half > 0 ? gap >= half - REACH_EPS : gap > 0) return false
  const h = az + (r.to.z + 1 - az) * t
  const headroom = r.headroom ?? HEADROOM
  // Above the line (so the ramp surfaces through it) but within headroom, and
  // strictly inside the cell rather than exactly at its top (the landing).
  return c.z + 1 > h + EPS && c.z < h + headroom
}

/**
 * The true opening: the cell the run's centreline passes through, so it must be
 * carved (a floor/ceiling) — unless it is a wall, which is kept and thinned.
 *
 * This is the cell whose top the run's walking line has already crossed. The cell
 * *below* it — the one only the truss reaches into — is deliberately not an
 * opening: it is the block the cut shaves (`rampSlopeCuts`), which fills the space
 * under the slope instead of leaving it as a second course of hole. The crowd's
 * model of a block is its top face (`z + 1`), so a cell left solid under a run is a
 * floor the sim can walk on; it must therefore stay at or below the walking line,
 * which is exactly where this boundary is.
 */
function intrudes(c: Cell, r: Ramp): boolean {
  return within(c, r, RAMP_CORE_HALF)
}

/**
 * A partial overlap: the ramp's body (or, for a wall, its handrail) reaches **into**
 * this cell — crosses its near edge, rather than merely touching the face of it
 * (`REACH_EPS`). The block is kept and drawn half a metre thick instead of fully
 * carved, so a wide stair's side columns stay as floor and a railing fits
 * against a wall.
 */
function overlaps(c: Cell, r: Ramp, wall: boolean): boolean {
  return within(c, r, wall ? r.railHalf : r.bodyHalf)
}

/**
 * True when a hand-built solid block at `(x, y, z)` would sit inside a ramp's
 * opening — the corridor `carveRampOpenings` clears for a stair, escalator or
 * lift. The block brush asks this before it lays a cell, so a player cannot cover
 * up an auto-generated hole and seal a run in. A protected landing never answers
 * true: it sits exactly on the walking line, not above it.
 *
 * The space *under* a run is not an opening and never was: a block there is floor,
 * and `rampSlopeCuts` shaves its top to the truss's underside so it reads as the
 * filling under the slope. Only from the walking line up does a block stop being
 * floor under the run and start being an obstruction inside it.
 */
export function rampOpeningAt(modules: readonly Module[], x: number, y: number, z: number): boolean {
  if (modules.length === 0) return false
  const cell: Cell = { x, y, z, fill: 'solid' }
  for (const r of rampList(modules)) {
    if (intrudes(cell, r)) return true
  }
  return false
}

/**
 * Remove every solid cell that a ramp passes through, in place. Returns how many
 * were removed. Safe to call more than once (idempotent once carved).
 */
export function carveRampOpenings(cells: Cell[], modules: readonly Module[]): number {
  const ramps = rampList(modules)
  // Landing cells are the ramp's graph nodes; never carve them, even when two
  // runs share a column (an up and a down escalator side by side), and never
  // carve a stair's half/quarter landing between two flights.
  const protect = new Set<string>()
  const protectPoint = (p: Vec3i): void => {
    protect.add(`${p.x},${p.y},${p.z}`)
  }
  for (const m of modules) {
    if (m.type === 'stair') {
      // A stair's half/quarter landings are its interior graph nodes — never carve them.
      for (const p of stairLandings(m)) protectPoint(p)
    } else if (m.type === 'escalator' || m.type === 'lift') {
      // An escalator cuts the full wall/ceiling corridor along its run; only
      // its two landing cells are kept as graph nodes.
      protectPoint(m.from)
      protectPoint(m.to)
    }
  }
  if (ramps.length === 0) return 0
  const kill = new Set<number>()
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]
    if (c.fill !== 'solid') continue
    if (protect.has(`${c.x},${c.y},${c.z}`)) continue
    // A wall is never carved: the ramp's rail is allowed to touch it. It is
    // drawn half a metre thick instead (`rampThinWalls`), so the wall stays
    // solid and the run still fits beside it.
    if (isWallBlock(c)) continue
    for (const r of ramps) {
      if (intrudes(c, r)) {
        kill.add(i)
        break
      }
    }
  }
  if (kill.size === 0) return 0
  // Remember how high the carve opened each column, before compaction.
  const opened = new Map<string, number>()
  for (const i of kill) {
    const c = cells[i]
    const col = `${c.x},${c.y}`
    const prev = opened.get(col)
    if (prev === undefined || c.z > prev) opened.set(col, c.z)
  }
  let w = 0
  for (let i = 0; i < cells.length; i++) {
    if (kill.has(i)) continue
    cells[w++] = cells[i]
  }
  cells.length = w
  // Tag the lowest solid block left directly above each opening. Removing the
  // support leaves it looking like a plate hanging in space, but it is really
  // the ceiling over the shaft and must be cut with the storey it covers.
  const ceiling = new Map<string, number>()
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]
    const openedZ = opened.get(`${c.x},${c.y}`)
    if (openedZ === undefined || c.z <= openedZ) continue
    const prev = ceiling.get(`${c.x},${c.y}`)
    if (prev === undefined || c.z < cells[prev].z) ceiling.set(`${c.x},${c.y}`, i)
  }
  for (const i of ceiling.values()) {
    const c = cells[i]
    if (c.tags?.includes(OPENING_CEILING)) continue
    cells[i] = { ...c, tags: [...(c.tags ?? []), OPENING_CEILING] }
  }
  return kill.size
}

/**
 * One solid block a ramp has kept and must draw half a block thick, and the half
 * of its cell the panel keeps.
 */
export interface RampThin {
  x: number
  y: number
  z: number
  /**
   * The side the keep-half is on: `e` when the ramp is on the −x side, `w` when it
   * is on +x, and the same for y. The half a metre nearest the ramp is left clear
   * for the body and its handrail. The same vocabulary a player's **半墙** stores
   * (`sim/types.ts` `WallSide`), because the mesher draws both the same way.
   */
  side: WallSide
}

/** A unit cell step as the side it names, for `RampThin.side`. */
function stepSide(sx: number, sy: number): WallSide {
  if (sx > 0) return 'e'
  if (sx < 0) return 'w'
  return sy > 0 ? 'n' : 's'
}

/** The outward side of a cell from a ramp segment, snapped to the dominant axis. */
function outwardSide(c: Cell, r: Ramp): WallSide | null {
  const ax = r.from.x + 0.5
  const ay = r.from.y + 0.5
  const dx = r.to.x + 0.5 - ax
  const dy = r.to.y + 0.5 - ay
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-6) return null
  const px = c.x + 0.5
  const py = c.y + 0.5
  const t = ((px - ax) * dx + (py - ay) * dy) / len2
  const cx = ax + t * dx
  const cy = ay + t * dy
  let nx = -dy
  let ny = dx
  const nl = Math.hypot(nx, ny)
  if (nl < 1e-6) return null
  nx /= nl
  ny /= nl
  const d = (px - cx) * nx + (py - cy) * ny
  if (Math.abs(d) < 1e-3) return null
  const s = d > 0 ? 1 : -1
  if (Math.abs(nx) >= Math.abs(ny)) return stepSide(nx * s > 0 ? 1 : -1, 0)
  return stepSide(0, ny * s > 0 ? 1 : -1)
}

/**
 * Every solid block a ramp has kept, with the side the half-block panel goes on.
 * The mesher draws the cell half a block thick on that side (`thinWallCells`
 * hands it over with the player's own 半墙 cells), so the run's body and handrail
 * sit in the clear half while the block the player built stays solid. A wall is
 * thinned when the handrail reaches into it; a floor is thinned only when the body
 * genuinely reaches past its cell boundary (a wide stair — an escalator's 0.9 m
 * band does not, so its side floor stays a full block). Both draw identically
 * now, so the derivation reports the side and nothing else. Derived from
 * cells+modules, so it follows an edit without the document storing anything
 * extra. A **半墙** is the one block it leaves alone: that cell is already drawn
 * half a block thick, on the side the player chose.
 *
 * **A 双跑楼梯 reaches nothing beside its runs**, and that is by construction rather
 * than by luck: a switchback's run is laid at the width of the blocks it fills
 * (`stairSwitchbackRunWidth`, 0.79 / 1.79 / 2.79 m), so its treads and both
 * balustrades end exactly on the cell edges and the wall a player pushes the piece
 * flush against is kept **whole** — the wall the piece hugs is the barrier there,
 * and the model drops the handrail on that side (`stairWallSides`). Only a piece
 * genuinely wider than its own blocks — a 中 / 宽 90° turn, an old off-grid 1.6 m
 * stair — has a body that crosses into the column beside it.
 */
export function rampThinCells(cells: readonly Cell[], modules: readonly Module[]): RampThin[] {
  const ramps = rampList(modules)
  if (ramps.length === 0) return []
  const out: RampThin[] = []
  for (const cell of cells) {
    if (cell.fill !== 'solid') continue
    // A piece the player already cut is left alone: a 半墙 is a half-metre panel
    // standing where they put it, and a 三角 is the 45° wedge they chose, so a ramp
    // never re-derives either one's shape — that would move a block they built. (The
    // carve still keeps the cell — see `carveRampOpenings` — so a cut block beside a
    // run is never opened up.)
    if (shapeOf(cell) !== null) continue
    const wall = isWallBlock(cell)
    for (const r of ramps) {
      if (!overlaps(cell, r, wall)) continue
      // A non-wall block only needs thinning when the body crosses into it; if
      // the body stays within its own cell, a full block is the correct floor.
      if (!wall && r.bodyHalf <= 0.5 + 1e-9) continue
      const side = outwardSide(cell, r)
      if (side) out.push({ x: cell.x, y: cell.y, z: cell.z, side })
      break
    }
  }
  return out
}

/**
 * Every cell the renderer must draw as **less than a whole block**, and the shape
 * it draws: a 半墙 the player laid (the `half-wall:<side>` tag it stores), a **三角**
 * wedge (`tri-upper:<side>` / `tri-lower:<side>`), plus every block a ramp kept
 * (`rampThinCells`, which skips the tagged ones). One list, so the mesher that draws
 * them, the build ghost that previews them and the 材质 brush that paints their faces
 * cannot disagree about which cells are cut — the defect that left a stair's own half
 * wall unpaintable was the brush not knowing about the derived ones.
 */
export function thinWallCells(cells: readonly Cell[], modules: readonly Module[]): Array<{ x: number; y: number; z: number; shape: CellShape }> {
  const out: Array<{ x: number; y: number; z: number; shape: CellShape }> = []
  for (const cell of cells) {
    const shape = shapeOf(cell)
    if (shape !== null) out.push({ x: cell.x, y: cell.y, z: cell.z, shape })
  }
  for (const t of rampThinCells(cells, modules)) out.push({ x: t.x, y: t.y, z: t.z, shape: { kind: 'half', side: t.side } })
  return out
}
