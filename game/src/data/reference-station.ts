// The reference station, §7.8 "Wusi Square" — three storeys, three exits, a
// gate line and a bank of escalators. Every number here is either the spec's
// reference peak or a consequence of it.
//
//   G   surface plaza      z = 0   walk at z = 1
//   B1  concourse          z = -4  walk at z = -3   (gate line at y = 12)
//   B2  platform           z = -8  walk at z = -7   (track at y = -7)
//
// The AM peak: alighting dumps ~200 people onto the platform every 150 s
// against ~225/min of escalator capacity, so the platform exit is the binding
// constraint — exactly the §7.8 conclusion, and it is bursty.
//
// Each surface exit is a covered head-house over its own up + down escalator
// pair, so the plaza is a row of three portals, each with a canopy that spans
// the run down to the concourse.
//
// The concourse and the platform are enclosed rooms, not floating floor plates:
// a wall shell wraps each, with doorways where the escalators pass, so the demo
// reads as a station cut out of the ground rather than a set of loose decks.

import type { Cell, LineDef, Module, StationData, StairStyle, Vec3i } from '../sim/types.ts'
import { carveRampOpenings } from '../sim/openings.ts'
import { ESCALATOR_RUN, escalatorModule } from '../sim/escalators.ts'
import { STAIR_RUN, STAIR_WIDTH_NARROW, stairFlightsFor } from '../sim/stairs.ts'

const Z_C = -4 // concourse floor block
const Z_P = -8 // platform floor block
const Z_G = 0 // surface slab

function rect(x0: number, x1: number, y0: number, y1: number, z: number, cells: Cell[], skip?: (x: number, y: number) => boolean): void {
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      if (skip && skip(x, y)) continue
      cells.push({ x, y, z, fill: 'solid' })
    }
  }
}

/**
 * One staircase, one storey, from a list of flights. `flights` is the ordered
 * run (bottom → top); a single entry is a straight stair, two entries make the
 * turn at the landing they share. `from`/`to` are the outer landings, so every
 * consumer that reads a stair as a plain run still works.
 */
function stair(id: string, flights: Array<[Vec3i, Vec3i]>, style: StairStyle, width = STAIR_WIDTH_NARROW): Module {
  const first = flights[0][0]
  const last = flights[flights.length - 1][1]
  return {
    id,
    type: 'stair',
    x: first.x,
    y: first.y,
    z: first.z,
    from: first,
    to: last,
    cfg: { width, style, flights: flights.map(([from, to]) => ({ from, to })) },
  }
}

/** Gate line across the concourse at y = 12, widest available row first. */
function gateLine(n: number): number[] {
  const order = [-1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6, 0, -7, 7]
  const out: number[] = []
  for (const x of order) {
    if (out.length >= n) break
    out.push(x)
  }
  return out.sort((a, b) => a - b)
}


export interface StationVariant {
  /** Number of up escalators from the platform to the concourse. Min 1, max 3. */
  upEscalators?: number
  /** Number of down escalators from the concourse to the platform. Min 1, max 3. */
  downEscalators?: number
  /** Set false for the under-built "before" station. */
  gates?: number
}

export function referenceStation(variant: StationVariant = {}): StationData {
  // The demo default is deliberately under-built on the platform exit: one up
  // escalator against ~3.6 arrivals/s. That is the station that breaks, and the
  // UI's "add an escalator" is the fix (§7.8, V4).
  const up = variant.upEscalators ?? 1
  const down = variant.downEscalators ?? 2
  const gates = variant.gates ?? 12

  const cells: Cell[] = []
  const modules: Module[] = []

  // Platform: 121 m of floor, 7 m wide, one edge adjacent to the track.
  rect(-60, 60, -6, 0, Z_P, cells)
  // Concourse: 15 x 25 m box, split by the gate line at y = 12. The floor is
  // continuous across the gate row — the fare line is a zone boundary in the
  // graph, so the gates are the only legal crossing without a gap in the slab.
  // (The old skip left three orphaned roof blocks floating over the row.)
  const gateXs = gateLine(gates)
  rect(-7, 7, 0, 24, Z_C, cells)
  // Surface plaza — wide enough for the three exit head-houses in a row and the
  // openings their escalators climb out of.
  rect(-8, 8, 24, 36, Z_G, cells)

  // Track bed (a solid strip beside the platform) and the platform edge. The
  // bed is three cells (3 m) wide so a 2.8 m Type-B car sits fully inside it,
  // clear of the screen doors on the platform side.
  rect(-70, 70, -9, -7, Z_P, cells)
  modules.push({
    id: 'edge-1',
    type: 'platform-edge',
    x: -60,
    y: -6,
    z: Z_P,
    w: 121,
    cfg: { name: '1站台', line: '2', dir: 'up', side: 'left' },
  })
  // The bed is owned by a track module now; placing one digs its cells, so the
  // platform edge reads as a half-metre drop rather than a flush floor.
  modules.push({
    id: 'track-1',
    type: 'track',
    x: -70,
    y: -9,
    z: Z_P,
    w: 140,
    d: 3,
    cfg: { line: '2', power: 'third-rail', dir: 'up' },
  })

  // --- exits (surface, §5.6) ---------------------------------------------
  // Each exit is a covered head-house over a descending run and an up run, side
  // by side two metres apart, climbing out of a hole in the plaza that the exit
  // roof covers. This is what a street exit is — you walk under the canopy, onto
  // the run, and down into the station. Exit A's descending run is a staircase.
  const exitDefs = [
    { id: 'exit-a', x: -5, y: 30, name: 'A口', inRate: 900 },
    { id: 'exit-b', x: 0, y: 30, name: 'B口', inRate: 900 },
    { id: 'exit-c', x: 5, y: 30, name: 'C口', inRate: 900 },
  ]
  for (const e of exitDefs) {
    modules.push({
      id: e.id,
      type: 'exit',
      x: e.x,
      y: e.y,
      z: Z_G,
      cfg: { name: e.name, inRate: e.inRate, open: true },
    })
    // Surface <-> concourse, one pair per exit, each bay the equipment's fixed
    // one-storey run: the 扶梯 button's exact piece, `ESCALATOR_RUN` cells of run
    // over one storey of climb. The down run is the west bay and the up run the
    // east bay; both land on the exit's own row, so the roof the exit draws sits
    // over them. Exit A's west bay is a staircase instead of an escalator — a
    // narrow (escalator-width) straight stair beside the up run, the
    // reference-art mixed entrance (§3, §5.1).
    if (e.id === 'exit-a') {
      const base = { x: e.x - 1, y: e.y - STAIR_RUN, z: Z_C }
      const flights = stairFlightsFor(base, 0, 'straight')
      modules.push(stair(`stair-gc-${e.id}`, [[flights[0].from, flights[0].to]], 'straight', STAIR_WIDTH_NARROW))
    } else {
      modules.push(escalatorModule({ x: e.x - 1, y: e.y - ESCALATOR_RUN, z: Z_C }, 0, 'down', `esc-gc-down-${e.id}`))
    }
    modules.push(escalatorModule({ x: e.x + 1, y: e.y - ESCALATOR_RUN, z: Z_C }, 0, 'up', `esc-gc-up-${e.id}`))
  }

  // --- vertical circulation ----------------------------------------------
  // Down and up runs live in separate columns, two metres apart. Two ramps in
  // the same column stack on top of one another (their decks end up ~0.6 m
  // apart), which is impossible and ugly; `rampBlocked` enforces the same rule
  // for ramps placed by the builder. Each run is the equipment's fixed
  // one-storey escalator: based on the platform, landing one storey up on the
  // concourse.
  const cpDownX = [-6, -4]
  const cpUpX = [-2, 0, 2, 4, 6]
  for (let i = 0; i < cpDownX.length && i < down; i++) {
    const x = cpDownX[i]
    modules.push(escalatorModule({ x, y: -3, z: Z_P }, 0, 'down', `esc-cp-down-${i}`))
  }
  for (let i = 0; i < cpUpX.length && i < up; i++) {
    const x = cpUpX[i]
    modules.push(escalatorModule({ x, y: -3, z: Z_P }, 0, 'up', `esc-cp-up-${i}`))
  }

  // --- staircases (楼梯, §5.1) --------------------------------------------
  // The only pre-placed stair is the straight run that replaces exit A's down
  // escalator (added in the exit loop above). No free-standing turning stairs:
  // every stair in the demo surfaces under an exit head-house.

  // --- fare control -------------------------------------------------------
  for (let i = 0; i < gateXs.length; i++) {
    modules.push({ id: `gate-${i}`, type: 'gate', x: gateXs[i], y: 12, z: Z_C, cfg: { dir: 'both' } })
  }

  // --- service points (§7.4a stops) ---------------------------------------
  // Ticket machines line the side walls and face into the hall, the way art/01
  // draws them ("ticket machines against the back wall"). They sit in the unpaid
  // zone (§4.5) where a passenger buys a ticket before the gates.
  modules.push({ id: 'tvm-1', type: 'tvm', x: -7, y: 16, z: Z_C, rot: 1, cfg: {} })
  modules.push({ id: 'tvm-2', type: 'tvm', x: 7, y: 16, z: Z_C, rot: -1, cfg: {} })
  modules.push({ id: 'bench-1', type: 'bench', x: 0, y: 8, z: Z_C, cfg: {} })
  modules.push({ id: 'bench-2', type: 'bench', x: -8, y: -4, z: Z_P, cfg: {} })

  // --- facility rooms: one shop + one ticket booth (zone-tool rectangles) ---
  // Same geometry the builder's `placeFacility` produces for a shop: a module
  // plus walls stacked above the perimeter, skipped where an existing wall
  // already touches. The demo authors a door opening by leaving a gap (the tool
  // builds shops sealed; the player cuts openings with a right-click). A booth
  // has no voxel walls at all — just a desk counter the renderer draws — so it
  // adds no cells. Built inline (this file feeds `build/model.ts`, so it cannot
  // import the builder).
  {
    const solid = new Set(cells.map((c) => `${c.x},${c.y},${c.z}`))
    const has = (x: number, y: number, z: number): boolean => solid.has(`${x},${y},${z}`)
    const wallColumn = (x: number, y: number, z: number): boolean => has(x, y, z) && has(x, y, z + 1)
    const buildRoom = (
      id: string,
      kind: 'shop' | 'booth',
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      z: number,
      door: Array<[number, number]>,
    ): void => {
      const wallH = kind === 'shop' ? 3 : 0
      const doorKeys = new Set(door.map(([x, y]) => `${x},${y},${z}`))
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          if (!(x === x0 || x === x1 || y === y0 || y === y1)) continue
          if (doorKeys.has(`${x},${y},${z}`)) continue
          // Skip where an existing wall already touches from the outside.
          const out: [number, number] = x === x0 ? [x - 1, y] : x === x1 ? [x + 1, y] : y === y0 ? [x, y - 1] : [x, y + 1]
          if (wallColumn(out[0], out[1], z)) continue
          for (let dz = 1; dz <= wallH; dz++) {
            if (has(x, y, z + dz)) continue
            cells.push({ x, y, z: z + dz, fill: 'solid' })
            solid.add(`${x},${y},${z + dz}`)
          }
        }
      }
      modules.push(
        kind === 'shop'
          ? { id, type: 'shop', x: x0, y: y0, z, w: x1 - x0 + 1, h: y1 - y0 + 1, cfg: { kind: 'store', door } }
          : { id, type: 'booth', x: x0, y: y0, z, w: x1 - x0 + 1, h: y1 - y0 + 1, cfg: { kind: 'ticket' } },
      )
    }
    // Shop against the east wall of the paid hall (touches the existing ring,
    // so that side needs no new wall). Kept clear of the escalator landings
    // (y <= 3) so the platform exit stays connected. Its street-side opening is
    // the authored gap at x = 3, y = 5..6.
    buildRoom('shop-1', 'shop', 3, 4, 7, 7, Z_C, [[3, 5], [3, 6]])
    // Ticket booth in the middle of the unpaid hall, between the gate line
    // (y = 12) and the surface escalators (y ~ 23). A desk ring, served from
    // outside (the crowd stays out of the staff floor).
    buildRoom('booth-1', 'booth', -4, 14, -1, 17, Z_C, [])
  }

  // --- enclosure ---------------------------------------------------------
  // The concourse is a room, not a floating floor plate: §4.3's wall blocks
  // movement and sight. Run a wall shell one block outside the floor slab so the
  // whole 15 x 25 m hall keeps its floor, four blocks tall from the slab base to
  // the surface (B1 has 3 m of clear headroom under the plaza slab). The north
  // wall runs solid and the surface escalators carve their own doorways through
  // it at the exact handrail width (`carveRampOpenings`); the ring is then capped
  // with surface blocks, so the wall tops read as the ground around the station
  // box rather than as loose, walkable parapets.
  const WALL_TOP = Z_C + 3
  for (let z = Z_C; z <= WALL_TOP; z++) {
    rect(-8, 8, -1, -1, z, cells) // south, behind the paid hall
    rect(-8, 8, 25, 25, z, cells) // north: the escalators carve their doorways
    rect(-8, -8, 0, 24, z, cells) // west
    rect(8, 8, 0, 24, z, cells) // east
  }
  // Roof the hall and cap the ring: the surface slab over the concourse is the
  // concourse ceiling (its underside is the baffle, §4.3), and it is what makes
  // the wall tops read as the ground around the station box. The plaza already
  // roofs y 24..36.
  rect(-8, 8, -1, 23, Z_G, cells)

  // --- platform tunnel ---------------------------------------------------
  // B2 is a tunnel, not an open shelf: a wall behind the platform and a wall
  // behind the track, open at the ends where the line runs on. The concourse
  // escalator bank passes through a doorway left in the platform wall. Wall
  // copings wear the track-bed finish, so a loose wall top never becomes a
  // walkable node or a depth level of its own.
  const platformDoorX = new Set<number>()
  for (const m of modules) {
    if (m.type !== 'escalator') continue
    if ((m.from.z === Z_P && m.to.z === Z_C) || (m.from.z === Z_C && m.to.z === Z_P)) platformDoorX.add(m.x)
  }
  const P_WALL_TOP = Z_P + 3
  for (let z = Z_P; z <= P_WALL_TOP; z++) {
    rect(-70, 70, 1, 1, z, cells, (x) => platformDoorX.has(x)) // behind the platform
    rect(-70, 70, -10, -10, z, cells) // behind the track
  }
  // The platform ceiling is the B1 slab over the tunnel: the ground floor the
  // concourse stands on, carried south across the platform and track. It is the
  // one place rows must be shared carefully — the wall ring owns y = -1 and the
  // wall ring plus the concourse floor own y = 0, so those rows are only filled
  // beyond them.
  rect(-70, 70, -9, -2, Z_C, cells)
  rect(-70, 70, -1, -1, Z_C, cells, (x) => x >= -8 && x <= 8)
  rect(-70, 70, 0, 0, Z_C, cells, (x) => x >= -8 && x <= 8)

  // Cut the slabs the ramps climb through, so no escalator emerges through a
  // solid floor. This is the same carve the builder does when a ramp is placed.
  carveRampOpenings(cells, modules)

  // Surface finishes (§4.3). The platform and concourse get granite, the plaza
  // tile, and the track strip a track bed — which is also the first walk-speed
  // rule in the game: nobody routes onto the rails.
  for (const c of cells) {
    if (c.z === Z_G) {
      c.finish = { top: 'floor.tile' }
      c.zone = 'outside'
    } else if (c.z === Z_C) {
      c.finish = { top: 'floor.granite' }
      // The fare line is the row of gates at y = 12: everything north of it
      // (toward the street escalators) is unpaid, everything south is paid.
      c.zone = c.y >= 12 ? 'unpaid' : 'paid'
    } else if (c.z === (Z_C + Z_G) / 2) {
      // Half/quarter landings of player-placed turning stairs: concourse
      // granite in the unpaid hall.
      c.finish = { top: 'floor.granite' }
      c.zone = 'unpaid'
    } else if (c.z === Z_P) {
      c.finish = { top: c.y <= -7 ? 'floor.track' : 'floor.granite' }
      c.zone = c.y <= -7 ? 'restricted' : 'platform'
    }
  }
  // Tunnel copings are not floors: keep the platform wall tops out of the graph
  // (a walkable wall top would invent a depth level of its own).
  for (const c of cells) {
    if (c.z === P_WALL_TOP && (c.y === 1 || c.y === -10)) c.finish = { ...c.finish, top: 'floor.track' }
  }
  // The B1 ground south of the hall is the tunnel's roof: earth, not concourse
  // floor, so it neither reads as the room nor becomes a place to walk.
  for (const c of cells) {
    if (c.z === Z_C && (c.y < 0 || Math.abs(c.x) > 7)) c.finish = { ...c.finish, top: 'floor.soil' }
  }
  // Dig the track bed the module covers (the same one-course dig `placeRail`
  // performs), so the platform edge drops to the recessed slab instead of a
  // flush floor.
  const bed = modules.find((m) => m.type === 'track')
  if (bed && bed.type === 'track') {
    const bd = bed.d ?? 1
    const kill = new Set<string>()
    for (let x = bed.x; x < bed.x + bed.w; x++) for (let y = bed.y; y < bed.y + bd; y++) kill.add(`${x},${y},${bed.z}`)
    for (let i = cells.length - 1; i >= 0; i--) if (kill.has(`${cells[i].x},${cells[i].y},${cells[i].z}`)) cells.splice(i, 1)
  }

  const lines: LineDef[] = [
    {
      id: '2',
      name: '2号线',
      colour: '#00679e',
      stock: 'B',
      cars: 6,
      power: 'third-rail',
      headwayProfile: { peak: 150, offpeak: 240, late: 480 },
      alightPerTrain: 200,
      terminus: 'through',
      direction: 'up',
      travelSign: 1,
      stations: ['edge-1'],
    },
  ]

  return {
    name: '嘉禾望岗',
    seed: 1234567,
    cells,
    modules,
    lines,
  }
}

/**
 * Cold-boot runtime for the demo: 07:27, no warmup, so the page opens with an
 * empty floor exactly as the first train arrives. The seed lives on the station
 * (`referenceStation().seed`). Reused by 示例车站 so a switch matches a cold boot.
 */
export const REFERENCE_BOOT = { startSeconds: 7.45 * 3600, warmup: 0 } as const

/** The 2x2 at-grade seed a new station starts from (§3 step 1, §4.1). */
export function emptyStation(name = '未命名车站'): StationData {
  return {
    name,
    seed: 7654321,
    cells: [
      { x: 0, y: 0, z: 0, fill: 'solid' },
      { x: 1, y: 0, z: 0, fill: 'solid' },
      { x: 0, y: 1, z: 0, fill: 'solid' },
      { x: 1, y: 1, z: 0, fill: 'solid' },
    ],
    modules: [],
    lines: [],
  }
}
