// Stair builder. Lane E split of render/models.ts: moved verbatim, see PieceBuilder.ts.

import * as THREE from 'three'
import { modelNeighbours } from '../../modelNeighbours.ts'
import { DEFAULT_MATERIAL } from '../../../sim/finishes.ts'
import { exitLandingHeight } from './ExitLanding.ts'
import { StairBlockModel } from './StairBlockModel.ts'
import { PieceBuilder, slab, finishSlab } from '../PieceBuilder.ts'
import type { ModelMaterials, ModuleContext } from '../PieceBuilder.ts'
import { STAIR_BODY_DROP } from '../../../sim/rampSurface.ts'
import { stairTreadWidth, stairFlightSlides, stairFlights, stairLaneMates, stairLandingShape, stairLandingWalls, stairTreadTrim, stairWallSides } from '../../../sim/stairs.ts'
import type { StairFlightSlide, StairLaneMate, StairLandingShape, StairLandingWalls, StairWallSides } from '../../../sim/stairs.ts'
import type { Module, Vec3i } from '../../../sim/types.ts'
import { omitModelDetail, setModelDetail, surfaceModelDetail, tubeModelDetail } from '../../modelDetail.ts'

// Procedural module models — the art pass behind PLAN §3 item 6 ("modules are
// ad-hoc boxes") and the reference photos in `docs/`. Every module the builder
// can place is a small three.js group built from boxes and planes, sharing one
// set of materials so the whole catalogue reads as one kit of steel, enamel,
// glass and screens.
//
//   TVM        售票机     stainless body, green housing, an LCD and a 车票 sign
//   vending    自动售货机  white cabinet, glass drink display, face-pay strip
//   gate       闸机      navy head, screen / reader / QR, red leaf, lane arrow
//   escalator  扶梯      truss, steps, glass balustrade, black handrail
//   exit       出入口    红色钢架, glass walls, a canopy over an up/down pair
//   PSD        站台门    glass screen, white mullions, orange header, red band
//   train      车辆      A/B/C/L stock, window band, livery, doors, two cabs
//
// Coordinate convention matches the mesher: cell (x,y,z) occupies
// [x,x+1]×[y,y+1]×[z,z+1], +z up. A module at (x,y,z) stands on top of its
// block, so its local origin is the cell centre at height z+1. Escalators, PSDs
// and trains are built in world space because they span more than one cell.


/** A flight whose treads are centred on its own walking line. */
const NO_STAIR_SLIDE: StairFlightSlide = { dx: 0, dy: 0 }

/**
 * A staircase (楼梯). One storey of *real* steps, walked both ways: level treads
 * with a riser under each leading edge, not a ramp with grooves. A straight
 * stair is a single flight; a turning style is two flights meeting at a half or
 * quarter landing, which the model draws as a platform in the same surface and
 * the same slab thickness as the treads (the caller keeps the sim nodes).
 *
 * The stair wears the floor it climbs from — the top finish of its lower
 * landing — so a granite hall gets a granite staircase, not a steel one.
 *
 * A narrow stair fits inside one tile, handrails included, so it keeps both
 * of its railings and may stand flush against an escalator or another stair:
 * each run's own balustrade is the barrier between them. New wide stairs span their
 * full width as one model. Legacy lanes of the *same* wide flight are the exception — they drop the rail along the seam and run their
 * treads together, so a 2- or 3-lane stair reads as one wide flight with rails
 * only at its outer edges (`stairLaneMates`). So is a side a **wall hugs from
 * bottom to top** (`stairWallSides`): the wall is the barrier there, so the
 * flight keeps only the stringer it meets the wall with, and grows no handrail,
 * rail posts or newel return of its own — a staircase in a stairwell is railed on
 * its open side alone.
 */
function buildStair(ctx: ModuleContext, mod: Extract<Module, { type: 'stair' }>): THREE.Group {
  if (mod.cfg.block) return new StairBlockModel(ctx).build(mod)
  const g = new THREE.Group()
  const width = stairTreadWidth(mod)
  const surface = stairSurface(ctx, mod)
  const flights = stairFlights(mod)
  // Only the module's outer landings stand on a floor of their own; an interior
  // turn landing carries the rail around the corner, so a return there would drop
  // a newel in the middle of the platform.
  const outer = new Set([mod.from, mod.to].map((p) => `${p.x},${p.y},${p.z}`))
  const mates = stairLaneMates(modelNeighbours(ctx, 'stair'), mod)
  // A switchback's return run is slid flush against the first (`stairFlightSlides`):
  // the treads, the rails and the landing platform follow the band, while the
  // flight's own landings stay on the cells the graph walks.
  const slides = stairFlightSlides(mod)
  for (const [i, f] of flights.entries()) {
    const from = { x: f.from.x, y: f.from.y, z: f.from.z }
    const to = { x: f.to.x, y: f.to.y, z: f.to.z }
    // Rendering, carving and collision share the same block-aligned band.
    const slide = slides[i] ?? NO_STAIR_SLIDE
    const walls = stairWallSides(ctx.data.cells, from, to, width, slide)
    const renderOuter = new Set([from, to].filter((p) => outer.has(`${p.x},${p.y},${p.z}`)).map((p) => `${p.x},${p.y},${p.z + exitLandingHeight(modelNeighbours(ctx, 'exit'), p)}`))
    from.z += exitLandingHeight(modelNeighbours(ctx, 'exit'), f.from)
    to.z += exitLandingHeight(modelNeighbours(ctx, 'exit'), f.to)
    g.add(buildStairFlight(ctx.mats, surface, from, to, width, renderOuter, mates, walls, slide))
  }
  for (let i = 0; i + 1 < flights.length; i++) {
    g.add(buildStairLanding(ctx.mats, surface, flights[i], flights[i + 1], stairLandingShape(mod, i), stairLandingWalls(ctx.data.cells, mod, i), { width, incoming: slides[i], outgoing: slides[i + 1] }))
  }
  return g
}

/** Tread slab thickness — the stair's walking surface matches a floor slab. */
const STAIR_TREAD_T = 0.09
/** Target riser height; the flight's rise is divided into whole steps. */
const STAIR_RISE = 1 / 6
/** Depth of a side stringer, metres: it carries the treads down to `STAIR_BODY_DROP`. */
const STAIR_STRINGER_T = 0.32
/** Thickness of the soffit under the treads, metres: its underside is the body line. */
const STAIR_SOFFIT_T = 0.06
/** A turn landing's own platform depth, metres: a half-block slab, never a placed block. */
const STAIR_LANDING_T = 0.5

/**
 * The finish a stair wears: the one painted on the piece itself (`cfg.finish`,
 * 材质), or else the top finish of the cell at its lower landing, falling back to
 * concrete. So a stair in a tiled hall is tiled — unless the player has finished
 * the staircase by hand, in which case that is what its treads, their risers and
 * its half-landing are made of wherever it stands.
 */
function stairSurface(ctx: ModuleContext, mod: Extract<Module, { type: 'stair' }>): THREE.Material {
  if (mod.cfg.finish) return ctx.finish(mod.cfg.finish)
  const at = ctx.data.cells.find((c) => c.x === mod.from.x && c.y === mod.from.y && c.z === mod.from.z)
  return ctx.finish(at?.finish?.top ?? DEFAULT_MATERIAL)
}

/**
 * One straight flight, in world space, with +x up the horizontal run and +z up.
 * `run` is the horizontal distance, `rise` the storey climb; the treads stay
 * level and the risers stand on each leading edge, so it reads as a staircase.
 * Both sides carry a stringer and a handrail, and each handrail levels off at
 * its landing and turns down into a newel post on the floor.
 *
 * `mates` are the lane flights standing flush beside this one
 * (`stairLaneMates`). Every one of them **joins the steps**: this lane's treads
 * and risers run out to the cell edge, so two lanes side by side never leave a
 * gap between them. Only a mate of the *same* flight — the same `cfg.flight`
 * token, i.e. another lane of one wide stair placed in a single action — also
 * loses this side's stringer, handrail and posts, so a 2- or 3-lane stair reads
 * as one wide flight railed at its outer edges, while two stairs dropped
 * separately keep the rail down the middle between their joined steps. `local +y`
 * is `(-uy, ux)` in world space, which is how a world step becomes a local side.
 *
 * `walls` are the sides a wall hugs from bottom to top (`stairWallSides`), which
 * keep their stringer but lose the handrail, its posts and its newel return: the
 * wall is the barrier on that side, and a rail standing against it is the same
 * balustrade drawn twice — the treads still stop at their own edge, so the
 * stringer stays to meet the wall.
 */
function buildStairFlight(
  mats: ModelMaterials,
  surface: THREE.Material,
  from: Vec3i,
  to: Vec3i,
  width: number,
  outer: ReadonlySet<string> = new Set(),
  mates: readonly StairLaneMate[] = [],
  walls: StairWallSides = { left: false, right: false },
  slide: StairFlightSlide = NO_STAIR_SLIDE,
): THREE.Group {
  const lower = from.z <= to.z ? from : to
  const upper = from.z <= to.z ? to : from
  const dx = upper.x - lower.x
  const dy = upper.y - lower.y
  const run = Math.hypot(dx, dy)
  const rise = upper.z - lower.z
  const g = new THREE.Group()
  // The band stands `slide` cells across from the flight's own walking line: a
  // switchback's return run is drawn flush against the first, its rails meeting
  // back to back on the seam.
  g.position.set(lower.x + 0.5 + slide.dx, lower.y + 0.5 + slide.dy, lower.z + 1)
  g.rotation.z = Math.atan2(dy, dx) // +x now points up the run

  const half = width / 2
  // `joinSides` reach the cell edge so the steps meet; `openSides` go further and
  // give up their rail, because they are the same staircase as the lane there.
  // `wallSides` give up only the rail, posts and return: a wall hugs them.
  const joinSides = new Set<number>()
  const openSides = new Set<number>()
  const wallSides = new Set<number>()
  if (run > 1e-6) {
    const ux = dx / run
    const uy = dy / run
    for (const mate of mates) {
      const s = Math.sign(mate.step[0] * -uy + mate.step[1] * ux)
      if (s === 0) continue
      joinSides.add(s)
      if (mate.sameFlight) openSides.add(s)
    }
    // Local +y is the run's left (`-stairRight`), which is the side `walls.left`
    // names; the sides are otherwise the same numbers the mates above are.
    if (walls.left) wallSides.add(1)
    if (walls.right) wallSides.add(-1)
  }
  const yLo = joinSides.has(-1) ? -0.5 : -half
  const yHi = joinSides.has(1) ? 0.5 : half
  const yMid = (yLo + yHi) / 2
  const yWide = yHi - yLo
  // Trim half a landing cell at each end, so the treads start at the edge of the
  // floor the flight leaves and stop at the edge of the floor it reaches —
  // otherwise the top tread is coplanar with the landing slab and z-fights it.
  // Shared with `rampBodyBoxes`, which reserves exactly the tiles this sweeps, so
  // a landing tile really is free floor in the collision model too.
  const inner = stairTreadTrim(run)
  const stairRun = run - inner * 2
  if (stairRun < 0.2 || rise < 1e-3) {
    // Degenerate flight: a level platform, so the piece is never invisible.
    finishSlab(g, surface, Math.max(run, 0.5) / 2, yMid, -STAIR_TREAD_T / 2, Math.max(run, 0.5), yWide, STAIR_TREAD_T)
    return g
  }

  const steps = Math.max(2, Math.round(rise / STAIR_RISE))
  const stepRise = rise / steps
  const going = stairRun / steps
  for (let i = 0; i < steps; i++) {
    // Tread: level, its top on the step line.
    const tread = finishSlab(g, surface, inner + i * going + going / 2, yMid, (i + 1) * stepRise - STAIR_TREAD_T / 2, going + 0.002, yWide, STAIR_TREAD_T)
    tread.name = 'stair-tread'
    setModelDetail(tread, new THREE.PlaneGeometry(going + 0.002, yWide).translate(0, 0, STAIR_TREAD_T / 2))
    // Riser under the leading edge, from the tread below up to this one.
    const riser = finishSlab(g, surface, inner + i * going, yMid, i * stepRise + stepRise / 2, 0.05, yWide, stepRise)
    riser.name = 'stair-riser'
    // Retain a vertical face; omit the five hidden sides of each thin slab.
    setModelDetail(riser, new THREE.PlaneGeometry(yWide, stepRise).rotateX(Math.PI / 2).rotateZ(-Math.PI / 2).translate(-0.025, 0, 0))
  }

  // Side stringers, a soffit and a handrail run the incline. `theta` tilts a
  // beam about the width axis so its length follows the slope. Both the stringer
  // and the soffit hang to `STAIR_BODY_DROP` below the walking line — the same
  // plane the ground under the run is cut to (`rampSlopeCuts`), so the ground
  // rises to the underside of the steps instead of stopping short of them.
  //
  // Both beams are **rotated** boxes, so their end faces are square to the slope and their
  // upper corner swings `T·tan θ` past the end of their length. Both are trimmed by exactly
  // that, so the upper corner of each end lands on the treads' own edge — the lower corner
  // stays inside the treads, below the landing's floor — and no part of the flight enters the
  // landing's block: a landing column is deliberately never cut (`rampSlopeCuts` keeps it
  // level: it is the floor the crowd stands on at the foot of the run), so a beam that
  // reached into it was swallowed by the floor it stands on. An overhang *past* the treads
  // (`+0.12`/`+0.06` here once) is the same mistake the other way round: the stringer's low
  // corner ended up 0.37 m inside a block the cut never touches.
  const midX = inner + stairRun / 2
  const theta = Math.atan2(rise, stairRun)
  const slopeLen = Math.hypot(stairRun, rise)
  const underside = rise / 2 - STAIR_BODY_DROP
  /** The length that puts a beam's square-cut lower corner on the treads' edge. */
  const beamLen = (thickness: number): number => slopeLen - thickness * Math.tan(theta)
  // Interior joints meet a vertical landing fascia. Extend the square-cut beam
  // corners to that plane, preserving the sloping top and underside.
  const fitLandingEnds = (mesh: THREE.Mesh): void => {
    const positions = mesh.geometry.getAttribute('position')
    const point = new THREE.Vector3()
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i)
      const side = point.x < 0 ? -1 : 1
      point.applyAxisAngle(new THREE.Vector3(0, 1, 0), -theta)
      const end = side < 0 ? lower : upper
      if (!outer.has(`${end.x},${end.y},${end.z}`)) {
        const x = side * stairRun / 2
        point.z += (x - point.x) * Math.tan(theta)
        point.x = x
      }
      point.applyAxisAngle(new THREE.Vector3(0, 1, 0), theta)
      positions.setXYZ(i, point.x, point.y, point.z)
    }
    mesh.geometry.computeVertexNormals()
    mesh.geometry.computeBoundingBox()
    mesh.geometry.computeBoundingSphere()
  }
  for (const s of [1, -1]) {
    if (openSides.has(s)) continue
    // The stringer runs the incline on every side the flight keeps, a walled one
    // included: the treads stop at their own edge, so the stringer is what meets
    // the wall.
    // Its outer face meets the rail's outer face, including when a wall replaces
    // the rail: no strip of exposed ground between the stair and its block edge.
    const beam = slab(g, mats.darkSteel, midX, s * (half + 0.05), underside + STAIR_STRINGER_T / (2 * Math.cos(theta)), beamLen(STAIR_STRINGER_T), 0.11, STAIR_STRINGER_T)
    beam.rotation.y = -theta
    beam.name = 'stair-stringer'
    fitLandingEnds(beam)
    surfaceModelDetail(beam, 'y')
    // A wall hugging this side is already the barrier: no handrail, no rail posts.
    if (wallSides.has(s)) continue
    // The rail keeps the full incline: it is in the air, so its square ends pass over the
    // landings harmlessly, and the end posts below it stay under the rail.
    const rail = slab(g, mats.handrail, midX, s * (half + 0.07), rise / 2 + 0.95, slopeLen, 0.07, 0.07)
    rail.rotation.y = -theta
    tubeModelDetail(rail)
    for (let i = 0; i <= 2; i++) {
      const u = inner + (i / 2) * stairRun
      const post = slab(g, mats.steel, u, s * (half + 0.07), ((u - inner) / stairRun) * rise + 0.47, 0.05, 0.05, 0.94)
      omitModelDetail(post)
    }
    // Vertical panel ends meet the uprights; the top and bottom follow the
    // incline, keeping glass above the treads and below the handrail (§5.1).
    for (let i = 0; i < 2; i++) {
      const x0 = inner + i * stairRun / 2 + 0.03
      const x1 = inner + (i + 1) * stairRun / 2 - 0.03
      const z0 = (x0 - inner) / stairRun * rise
      const z1 = (x1 - inner) / stairRun * rise
      stairGlass(g, mats.glass, s * (half + 0.07), [
        [x0, z0 + 0.09], [x1, z1 + 0.09],
        [x1, z1 + STAIR_RAIL_H - 0.06], [x0, z0 + STAIR_RAIL_H - 0.06],
      ])
    }
  }
  // The soffit runs under the whole joined width, overhanging only on a free
  // side — and never past a cell edge, where the neighbouring lane's own soffit
  // carries on. Its own underside is the body line the ground is cut to.
  const sLo = yLo - (joinSides.has(-1) ? 0 : 0.03)
  const sHi = yHi + (joinSides.has(1) ? 0 : 0.03)
  const soffit = slab(g, mats.darkSteel, midX, (sLo + sHi) / 2, underside + STAIR_SOFFIT_T / (2 * Math.cos(theta)), beamLen(STAIR_SOFFIT_T), sHi - sLo, STAIR_SOFFIT_T)
  soffit.rotation.y = -theta
  soffit.name = 'stair-soffit'
  fitLandingEnds(soffit)
  surfaceModelDetail(soffit, 'z', -1)
  // The outer handrails level off at each landing and turn down into a newel
  // post on the floor, so a stair rail wraps round and reaches the ground instead
  // of stopping dead above the last tread — a walled side has no rail to return.
  // `o` is the outward direction along the run: the lower landing is −x, the
  // upper +x.
  const returnStart = g.children.length
  for (const s of [1, -1]) {
    if (openSides.has(s) || wallSides.has(s)) continue
    const y = s * (half + 0.07)
    for (const o of [-1, 1]) {
      const end = o < 0 ? lower : upper
      if (!outer.has(`${end.x},${end.y},${end.z}`)) continue
      const xEnd = o < 0 ? inner : inner + stairRun
      const floor = o < 0 ? 0 : rise // the landing this end stands on
      const zEnd = floor + STAIR_RAIL_H
      // The horizontal over-run (overlapping the inclined rail's tip, so the
      // mitre between the two leaves no gap), the quarter turn, and the post it
      // turns into.
      slab(g, mats.handrail, xEnd + o * (STAIR_LEAD / 2 - 0.02), y, zEnd, STAIR_LEAD, 0.07, 0.07)
      const turn = new THREE.Mesh(stairReturnGeo(), mats.handrail)
      turn.position.set(xEnd + o * STAIR_LEAD, y, zEnd - STAIR_RETURN_R)
      if (o < 0) turn.rotation.z = Math.PI // bulge outward at both ends
      g.add(turn)
      setModelDetail(turn, new THREE.TorusGeometry(STAIR_RETURN_R, 0.035, 3, 1, Math.PI / 2).rotateX(Math.PI / 2))
      const post = zEnd - STAIR_RETURN_R - floor
      slab(g, mats.steel, xEnd + o * (STAIR_LEAD + STAIR_RETURN_R), y, floor + post / 2, 0.07, 0.07, post)
      const panelEnd = STAIR_LEAD + STAIR_RETURN_R - 0.04
      const points: Array<[number, number]> = [
        [xEnd + o * 0.03, floor + 0.09], [xEnd + o * panelEnd, floor + 0.09],
      ]
      // Follow the curved return right up to the newel, with a small clearance
      // beneath the black rail instead of leaving its landing extension open.
      for (let i = 8; i >= 0; i--) {
        const u = STAIR_LEAD + (panelEnd - STAIR_LEAD) * i / 8
        const h = STAIR_RAIL_H - STAIR_RETURN_R
          + Math.sqrt(STAIR_RETURN_R ** 2 - (u - STAIR_LEAD) ** 2) - 0.06
        points.push([xEnd + o * u, floor + h])
      }
      points.push([xEnd + o * 0.03, floor + STAIR_RAIL_H - 0.06])
      stairGlass(g, mats.glass, y, points)
    }
  }
  // The continuous incline rail and infill carry the Low silhouette. Its short
  // landing returns, newels and round elbows are fine hardware at this scale.
  for (const part of g.children.slice(returnStart)) omitModelDetail(part, true)
  return g
}

/** Handrail height above the walking line — the escalator's black rail height. */
const STAIR_RAIL_H = 0.95
/** How far a stair handrail runs level over its landing, metres. */
const STAIR_LEAD = 0.34
/** Radius of the turn that carries it down into the newel, metres. */
const STAIR_RETURN_R = 0.25

/** A thin glass infill in the flight's x-z plane, centred under its rail. */
function stairGlass(g: THREE.Group, material: THREE.Material, y: number, points: Array<[number, number]>): void {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z)))
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: false, steps: 1 })
  geo.rotateX(Math.PI / 2)
  const pane = new THREE.Mesh(geo, material)
  pane.position.y = y + 0.0125
  g.add(pane)
  const corners = points.length > 4 ? [points[0], points[1], points[2], points[points.length - 1]] : points
  const low = new THREE.ExtrudeGeometry(new THREE.Shape(corners.map(([x, z]) => new THREE.Vector2(x, z))), { depth: .025, bevelEnabled: false, steps: 1 })
  low.rotateX(Math.PI / 2)
  const temporary = new THREE.Mesh(low, material)
  surfaceModelDetail(temporary, 'y')
  const detail = temporary.userData.lowDetailGeometry as THREE.BufferGeometry
  // Transfer ownership to the full pane; the temporary source is no longer used.
  setModelDetail(pane, detail.clone()); low.dispose()
}

/**
 * The quarter-turn a stair handrail makes into its newel post: an arc in the
 * x-z plane from the +x side (tangent vertical, where the post is) up to the top
 * (tangent horizontal, where the level over-run is). Built fresh per use — the
 * caller disposes a module's geometry with its group, so it must not be shared.
 */
function stairReturnGeo(): THREE.TorusGeometry {
  const geo = new THREE.TorusGeometry(STAIR_RETURN_R, 0.035, 8, 12, Math.PI / 2)
  geo.rotateX(Math.PI / 2) // into the x-z plane: +x → +z
  return geo
}

/**
 * A stair's turn landing: a platform spanning the two flight ends — one block deep along
 * the way the agent crosses it for a 180's half-landing, and the `lanes × lanes` square
 * the two legs meet on for a 90° turn — so the perpendicular width never pinches at the
 * corner. It is **the stair's own equipment**, not a floor block: the platform is a
 * 0.5 m slab (the tread surface over a shallow frame) that hangs at half the stair's
 * rise, and the graph walks it as the stair's virtual landing. Built from the same
 * surface as the treads.
 * A balustrade runs the edges a flight does not attach to, wrapping the outside of the
 * turn and carrying the flight handrails around it — **except** a side a wall hugs
 * (`stairLandingWalls`): the wall is the barrier there, and a rail against it is
 * the same balustrade drawn twice, poking through the wall.
 */
function buildStairLanding(
  mats: ModelMaterials,
  surface: THREE.Material,
  fin: { from: Vec3i; to: Vec3i },
  fout: { from: Vec3i; to: Vec3i },
  shape: StairLandingShape,
  walls: StairLandingWalls,
  forward?: { width: number; incoming: StairFlightSlide; outgoing: StairFlightSlide },
): THREE.Group {
  const g = new THREE.Group()
  g.name = 'stair-landing'
  const a = fin.to
  const { x0, y0, x1, y1 } = shape
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const sx = x1 - x0
  const sy = y1 - y0
  const top = a.z + 1
  // The platform's own 0.5 m depth: a tread-thick walking surface over a shallow
  // frame, so the landing is part of the piece rather than a placed block.
  const surfaceTop = finishSlab(g, surface, cx, cy, top - STAIR_TREAD_T / 2, sx, sy, STAIR_TREAD_T)
  surfaceTop.name = 'stair-landing-surface'
  const frame = slab(g, mats.darkSteel, cx, cy, top - STAIR_TREAD_T - (STAIR_LANDING_T - STAIR_TREAD_T) / 2, sx, sy, STAIR_LANDING_T - STAIR_TREAD_T)
  frame.name = 'stair-landing-frame'

  // Which perimeter edges a flight attaches to: the side the flight body sits
  // on, snapped to the dominant axis. The others get a balustrade — unless a wall
  // hugs them, because then the balustrade would be the barrier drawn twice.
  const attached = new Set<string>()
  const attachEdge = (from: Vec3i, to: Vec3i): void => {
    const dx = to.x - from.x
    const dy = to.y - from.y
    attached.add(Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : dy > 0 ? 'n' : 's')
  }
  attachEdge(fin.to, fin.from) // the incoming flight, behind the landing
  attachEdge(fout.from, fout.to) // the outgoing flight, beyond the landing

  const RAIL = 0.95
  // Each platform axis may end at a tread edge or a whole landing-cell edge.
  // Resolve its rail line from the adjoining flight rather than a fixed inset.
  const railLine = (axis: 'x' | 'y', edge: number): number => {
    const candidates: number[] = []
    for (const [f, slide] of [[fin, forward?.incoming], [fout, forward?.outgoing]] as const) {
      if (!forward || f.from[axis] !== f.to[axis]) continue
      const centre = f.from[axis] + 0.5 + (axis === 'x' ? slide?.dx ?? 0 : slide?.dy ?? 0)
      candidates.push(centre - forward.width / 2 - 0.07, centre + forward.width / 2 + 0.07)
    }
    const closest = candidates.sort((a, b) => Math.abs(a - edge) - Math.abs(b - edge))[0]
    return closest !== undefined && Math.abs(closest - edge) < 0.22 ? closest : edge
  }
  const rx0 = railLine('x', x0), rx1 = railLine('x', x1)
  const ry0 = railLine('y', y0), ry1 = railLine('y', y1)
  const rail = (edge: string, lo?: number, hi?: number): void => {
    const horizontal = edge === 's' || edge === 'n'
    const start = lo ?? (horizontal ? rx0 : ry0)
    const end = hi ?? (horizontal ? rx1 : ry1)
    const length = end - start
    const mid = (start + end) / 2
    if (edge === 's' || edge === 'n') {
      const y = edge === 's' ? ry0 : ry1
      slab(g, mats.handrail, mid, y, top + RAIL, length, 0.06, 0.06)
      slab(g, mats.glass, mid, y, top + RAIL / 2, Math.max(0.01, length - 0.2), 0.025, RAIL - 0.16)
      for (const px of [start + 0.07, end - 0.07]) omitModelDetail(slab(g, mats.steel, px, y, top + RAIL / 2, 0.05, 0.05, RAIL))
    } else {
      const x = edge === 'w' ? rx0 : rx1
      slab(g, mats.handrail, x, mid, top + RAIL, 0.06, length, 0.06)
      slab(g, mats.glass, x, mid, top + RAIL / 2, 0.025, Math.max(0.01, length - 0.2), RAIL - 0.16)
      for (const py of [start + 0.07, end - 0.07]) omitModelDetail(slab(g, mats.steel, x, py, top + RAIL / 2, 0.05, 0.05, RAIL))
    }
  }
  const edges: Array<keyof StairLandingWalls> = ['s', 'n', 'w', 'e']
  for (const edge of edges) {
    if (walls[edge]) continue
    if (!attached.has(edge)) { rail(edge); continue }
    if (!forward || (fin.to.x - fin.from.x) * (fout.to.x - fout.from.x)
      + (fin.to.y - fin.from.y) * (fout.to.y - fout.from.y) <= 0) continue
    // Forward offset flights attach to opposite halves; rail the exposed remainder.
    const horizontal = edge === 's' || edge === 'n'
    const incomingEdge = Math.abs(fin.from.x - a.x) >= Math.abs(fin.from.y - a.y)
      ? (fin.from.x > a.x ? 'e' : 'w') : (fin.from.y > a.y ? 'n' : 's')
    const end = edge === incomingEdge ? fin.to : fout.from
    const slide = edge === incomingEdge ? forward.incoming : forward.outgoing
    const centre = horizontal ? end.x + 0.5 + slide.dx : end.y + 0.5 + slide.dy
    const lo = horizontal ? x0 : y0
    const hi = horizontal ? x1 : y1
    const openLo = centre - forward.width / 2
    const openHi = centre + forward.width / 2
    if (openLo - lo > 0.1) rail(edge, horizontal ? rx0 : ry0, openLo - 0.07)
    if (hi - openHi > 0.1) rail(edge, openHi + 0.07, horizontal ? rx1 : ry1)
  }
  return g
}

export class StairModel extends PieceBuilder {
  readonly kind = 'stair'
  build(mod: Extract<Module, { type: 'stair' }>): THREE.Group {
    return buildStair(this.ctx, mod)
  }
}
