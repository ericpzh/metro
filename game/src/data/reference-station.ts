// The reference station, §7.8 "Wusi Square" — three levels, three exits, a
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

import type { Cell, LineDef, Module, StationData, Vec3i } from '../sim/types.ts'
import { carveRampOpenings } from '../sim/openings.ts'

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

function esc(id: string, from: Vec3i, to: Vec3i, dir: 'up' | 'down'): Module {
  return { id, type: 'escalator', x: from.x, y: from.y, z: from.z, from, to, cfg: { dir } }
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
  // Concourse: 15 x 25 m box, split by the gate line at y = 12.
  const gateXs = gateLine(gates)
  rect(-7, 7, 0, 24, Z_C, cells, (_x, y) => y === 12)
  for (const gx of gateXs) cells.push({ x: gx, y: 12, z: Z_C, fill: 'solid' })
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
    cfg: { name: '1站台', line: '2', dir: 'eastbound', side: 'left' },
  })
  modules.push({
    id: 'track-1',
    type: 'track',
    x: -70,
    y: -8,
    z: Z_P,
    w: 140,
    cfg: { line: '2', power: 'third-rail' },
  })

  // --- exits (surface, §5.6) ---------------------------------------------
  // Each exit is a covered head-house over its own pair of escalators: a down
  // run and an up run, side by side two metres apart, climbing out of a hole in
  // the plaza that the exit roof covers. This is what a street exit is — you
  // walk under the canopy, onto the escalator, and down into the station.
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
    // Surface <-> concourse, one pair per exit. The down run is the west bay and
    // the up run the east bay; both land on the exit's own row, so the roof the
    // exit draws sits over them.
    modules.push(esc(`esc-gc-down-${e.id}`, { x: e.x - 1, y: e.y, z: Z_G }, { x: e.x - 1, y: e.y - 7, z: Z_C }, 'down'))
    modules.push(esc(`esc-gc-up-${e.id}`, { x: e.x + 1, y: e.y - 7, z: Z_C }, { x: e.x + 1, y: e.y, z: Z_G }, 'up'))
  }

  // --- vertical circulation ----------------------------------------------
  // Down and up runs live in separate columns, two metres apart. Two ramps in
  // the same column stack on top of one another (their decks end up ~0.6 m
  // apart), which is impossible and ugly; `rampBlocked` enforces the same rule
  // for ramps placed by the builder.
  const cpDownX = [-6, -4]
  const cpUpX = [-2, 0, 2, 4, 6]
  for (let i = 0; i < cpDownX.length && i < down; i++) {
    const x = cpDownX[i]
    modules.push(esc(`esc-cp-down-${i}`, { x, y: 2, z: Z_C }, { x, y: -3, z: Z_P }, 'down'))
  }
  for (let i = 0; i < cpUpX.length && i < up; i++) {
    const x = cpUpX[i]
    modules.push(esc(`esc-cp-up-${i}`, { x, y: -2, z: Z_P }, { x, y: 3, z: Z_C }, 'up'))
  }

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

  // --- enclosure ---------------------------------------------------------
  // The concourse is a room, not a floating floor plate: §4.3's wall blocks
  // movement and sight. Run a wall shell one block outside the floor slab so the
  // whole 15 x 25 m hall keeps its floor, four blocks tall from the slab base to
  // the surface (B1 has 3 m of clear headroom under the plaza slab). The surface
  // escalators climb out through doorways cut in the north wall where they land;
  // the ring is then capped with surface blocks, so the wall tops read as the
  // ground around the station box rather than as loose, walkable parapets.
  const WALL_TOP = Z_C + 3
  const escalatorX = new Set<number>()
  for (const e of exitDefs) {
    escalatorX.add(e.x - 1)
    escalatorX.add(e.x + 1)
  }
  for (let z = Z_C; z <= WALL_TOP; z++) {
    rect(-8, 8, -1, -1, z, cells) // south, behind the paid hall
    rect(-8, 8, 25, 25, z, cells, (x) => escalatorX.has(x)) // north: the escalator doorways
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

  const lines: LineDef[] = [
    {
      id: '2',
      name: '2号线',
      colour: '#2f7ef2',
      stock: 'B',
      cars: 6,
      power: 'third-rail',
      headwayProfile: { peak: 150, offpeak: 240, late: 480 },
      alightPerTrain: 200,
      terminus: 'through',
      direction: 'eastbound',
      stations: ['edge-1'],
    },
  ]

  return {
    name: '五四广场',
    seed: 1234567,
    levels: [
      { id: 'G', z: Z_G, kind: 'at-grade', height: 4 },
      { id: 'B1', z: Z_C, kind: 'underground', height: 4.5 },
      { id: 'B2', z: Z_P, kind: 'underground', height: 4.5 },
    ],
    cells,
    modules,
    lines,
  }
}

/** The 2x2 at-grade seed a new station starts from (§3 step 1, §4.1). */
export function emptyStation(name = '未命名车站'): StationData {
  return {
    name,
    seed: 7654321,
    levels: [{ id: 'G', z: 0, kind: 'at-grade', height: 4.5 }],
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
