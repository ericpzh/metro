// Equipment footprints and collision, GAME-SPEC §5.
//
// Everything the builder drops is a module with a real plan footprint and a
// height. Two modules may not share space: a gate cannot be dropped inside a
// ticket machine, a second TVM cannot sit on the first, and an exit head-house
// keeps its whole enclosure clear. Ramps already had their own collision
// (`rampEnvelope` / `rampBlocked` in `openings.ts`, tuned for the vertical
// corridor); this module folds them into one envelope any equipment can be
// tested against, and adds the flat, floor-standing modules — with one exception:
// a **run** met by a flat piece is measured by the slope it actually draws
// (`rampBodyBoxes`), because a stair's treads stop at the edge of each landing tile
// and any floor a flight passes under keeps its headroom. Those blocks are floor, so
// a 围栏 may guard the head of a well or stand on the slab over a flight; two runs
// still meet on the full reservation, so runs can never be stacked.
//
// Pure data — no three, no DOM.

import { EXIT_L, exitBays, exitFloorAt, exitWidth } from './exits.ts'
import { LIFT_SIZE, liftFootprintCells } from './lifts.ts'
import { rampBodyBoxes, rampEnvelope, rampOpeningAt } from './openings.ts'
import { PSD_FULL_HEIGHT, PSD_HALF_HEIGHT, LEVEL_STEPS } from './constants.ts'
import { edgeCells, rotateLocal, trackCellAt, trackCells } from './track.ts'
import { tvBackToBack, tvFacing } from './tvs.ts'
import { isWallBlock, type Cell, type Module, type Vec3i } from './types.ts'

/** An axis-aligned world-space box, half-open: [x0,x1) × [y0,y1) × [z0,z1). */
export interface ModuleBox {
  x0: number
  y0: number
  z0: number
  x1: number
  y1: number
  z1: number
}

/** How tall a body of each flat module stands above its cell top, metres. */
const FLAT_HEIGHT: Record<'gate' | 'fence' | 'tvm' | 'vending' | 'bench' | 'shelf' | 'desk' | 'cubicle' | 'sink' | 'bin' | 'extinguisher' | 'billboard' | 'tv' | 'sign' | 'retail' | 'shop' | 'booth' | 'platform-edge' | 'track', number> = {
  gate: 1.3,
  fence: 1.0,
  tvm: 1.9,
  vending: 1.9,
  bench: 1.0,
  shelf: 1.9,
  desk: 0.9,
  cubicle: 1.8,
  sink: 0.9,
  // 垃圾桶 / 灭火器: the drawn height of each piece (`models.ts` `buildBin` /
  // `buildExtinguisher`), so its collision box and its body agree.
  bin: 0.95,
  extinguisher: 1.1,
  billboard: 2.4,
  tv: 3.0,
  // A ceiling-hung sign or TV spans the whole storey, from the floor top to the
  // ceiling one grid step up, so its envelope is the full column (and it is
  // found/blocked like any other equipment).
  sign: 3.0,
  retail: 3.6,
  shop: 3.6,
  booth: 2.4,
  'platform-edge': PSD_FULL_HEIGHT,
  track: 0.3,
}

/**
 * The axis-aligned world box covering a list of cells from `z0` to `z1`. A
 * quarter-turn keeps a track piece axis-aligned, so the bounding box of its
 * cells is exact rather than an over-estimate.
 */
function cellsAabb(cells: ReadonlyArray<[number, number, number]>, z0: number, z1: number): ModuleBox {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [x, y] of cells) {
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x + 1)
    y1 = Math.max(y1, y + 1)
  }
  return { x0, y0, z0, x1, y1, z1 }
}

/**
 * Every world cell a billboard's run covers: `w` cells along its local +x,
 * quarter-turned by `rot`. Mirrors `edgeCells` for a platform-edge.
 */
export function billboardCells(m: Extract<Module, { type: 'billboard' }>): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []
  for (let i = 0; i < m.w; i++) {
    const [dx, dy] = rotateLocal(m.rot, i, 0)
    out.push([m.x + dx, m.y + dy, m.z])
  }
  return out
}

/**
 * Every world cell a bench's run covers: `w` cells along its local +x,
 * quarter-turned by `rot`. Mirrors `billboardCells` for a platform-edge. A
 * legacy bench with no `w` is the single-cell 1 m piece.
 */
export function benchCells(m: Extract<Module, { type: 'bench' }>): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []
  const w = m.w ?? 1
  for (let i = 0; i < w; i++) {
    const [dx, dy] = rotateLocal(m.rot, i, 0)
    out.push([m.x + dx, m.y + dy, m.z])
  }
  return out
}

/**
 * The plan box a flat, floor-standing module occupies. Modules anchor at their
 * cell and rise from its top (`z + 1`), matching `render/models.ts`. The exit's
 * canopy is longer than its enclosure, but the collision box is the head-house
 * proper, so an exit does not swallow the plaza on every side.
 */
function flatEnvelope(m: Module): ModuleBox | null {
  const z0 = m.z + 1
  switch (m.type) {
    case 'bench':
      // A bench runs `w` cells along local +x (a 2 m bench chains two seats),
      // so its box is the AABB of the whole run.
      return cellsAabb(benchCells(m), z0, z0 + FLAT_HEIGHT.bench)
    case 'gate':
    case 'tvm':
    case 'vending':
    case 'shelf':
    case 'desk':
    case 'cubicle':
    case 'sink':
    case 'bin':
    case 'extinguisher':
    case 'tv':
    case 'sign':
      return { x0: m.x, y0: m.y, z0, x1: m.x + 1, y1: m.y + 1, z1: z0 + FLAT_HEIGHT[m.type] }
    case 'billboard': {
      // A billboard runs `w` cells along local +x, so its box is the AABB of
      // the whole run (a quarter-turn keeps it axis-aligned).
      return cellsAabb(billboardCells(m), z0, z0 + FLAT_HEIGHT.billboard)
    }
    case 'fence': {
      // A 1 m high, very thin panel through the middle of its block (§5.2): the
      // thin axis follows the placement rotation, so a fence line reads as one
      // continuous barrier and a gate row can plug straight into it. Thin still
      // overlaps a full-cell box in the same cell (same-cell stacking is
      // refused) while adjacent cells stay legal.
      const z1 = z0 + FLAT_HEIGHT.fence
      const rot = (((m.rot ?? 0) % 4) + 4) % 4
      if (rot % 2 === 1) return { x0: m.x + 0.45, y0: m.y, z0, x1: m.x + 0.55, y1: m.y + 1, z1 }
      return { x0: m.x, y0: m.y + 0.45, z0, x1: m.x + 1, y1: m.y + 0.55, z1 }
    }
    case 'exit': {
      const rx = exitWidth(exitBays(m)) / 2
      const ry = EXIT_L / 2
      const cx = m.x + 0.5
      const cy = m.y + 0.5
      // Rotation snaps to quarter turns, so the largest axis extent bounds it.
      const half = Math.max(rx, ry)
      return { x0: cx - half, y0: cy - half, z0, x1: cx + half, y1: cy + half, z1: z0 + 3.4 }
    }
    case 'retail':
    case 'shop':
    case 'booth':
      return { x0: m.x, y0: m.y, z0, x1: m.x + m.w, y1: m.y + m.h, z1: z0 + FLAT_HEIGHT[m.type] }
    case 'platform-edge': {
      // The screen sits on the track-facing strip of its single-cell-deep run.
      // A half-height (半高) screen reserves only its real 1.5 m, so something
      // may stand in the headroom the full screen would have filled.
      const h = m.cfg.psd === 'half' ? PSD_HALF_HEIGHT : PSD_FULL_HEIGHT
      const box = cellsAabb(edgeCells(m), z0, z0 + h)
      return box.x1 - box.x0 <= 1.0001
        ? { ...box, x0: box.x0 + 0.16, x1: box.x1 - 0.16 }
        : { ...box, y0: box.y0 + 0.16, y1: box.y1 - 0.16 }
    }
    case 'track':
      // A dug track bed: the module owns the whole trench volume (bed slab +
      // rails) from the block top to the platform surface, so no equipment can
      // be dropped into it.
      return cellsAabb(trackCells(m), m.z, m.z + 1)
    default:
      return null
  }
}

/**
 * The world box a module occupies — its ramp corridor or its flat body. A lift
 * is neither: it is a 2 × 2 m shaft rising two storeys, so it gets its own box
 * (the ramp envelope's thin vertical column would not reserve the whole plan).
 */
export function moduleEnvelope(m: Module): ModuleBox | null {
  if (m.type === 'lift') return liftEnvelope(m)
  return rampEnvelope(m) ?? flatEnvelope(m)
}

/** The 2 × 2 m shaft box of a lift, from its lower landing to above its top. */
function liftEnvelope(m: Extract<Module, { type: 'lift' }>): ModuleBox {
  const lo = Math.min(m.from.z, m.to.z)
  const hi = Math.max(m.from.z, m.to.z)
  return { x0: m.x, y0: m.y, z0: lo + 0.5, x1: m.x + LIFT_SIZE, y1: m.y + LIFT_SIZE, z1: hi + 1 + 0.6 }
}

/**
 * True when a cell's exposed top face is a rail track bed (§4.3). The track bed
 * is what sits under the rails: agents cannot walk on it (speed 0) and, by the
 * same rule, equipment must not be laid over it.
 */
export function isTrackBed(cells: readonly Cell[], x: number, y: number, z: number): boolean {
  const c = cells.find((cc) => cc.x === x && cc.y === y && cc.z === z)
  return c?.fill === 'solid' && c.finish?.top === 'floor.track'
}

/** Every cell a track module's bed covers — its run × depth at its own level. */
export function trackBedCells(m: Module): Array<[number, number, number]> {
  return m.type === 'track' ? trackCells(m) : []
}

/** The track module whose bed covers `(x, y, z)`, if any. */
export function trackAt(modules: readonly Module[], x: number, y: number, z: number): Module | undefined {
  for (const m of modules) {
    if (m.type === 'track' && trackCellAt(m, x, y, z)) return m
  }
  return undefined
}

/**
 * Keys of every track-bed cell, from the finish OR a track module's bed. A
 * placed rail digs its cells (they are void, so there is no finish left to
 * read); the finish path keeps the hand-built demo working unchanged.
 */
export function trackBedKeys(cells: readonly Cell[], modules: readonly Module[]): Set<string> {
  const out = new Set<string>()
  for (const c of cells) if (c.fill === 'solid' && c.finish?.top === 'floor.track') out.add(`${c.x},${c.y},${c.z}`)
  for (const m of modules) for (const [x, y, z] of trackBedCells(m)) out.add(`${x},${y},${z}`)
  return out
}

/** True when a cell is a track bed by either rule. */
export function isTrackCell(cells: readonly Cell[], modules: readonly Module[], x: number, y: number, z: number): boolean {
  return isTrackBed(cells, x, y, z) || trackAt(modules, x, y, z) !== undefined
}

/**
 * The floor cells a module stands on, at its own level. A room covers its whole
 * `w × h`; a platform-edge or track run is one cell deep along its local +x;
 * every other piece — gate, TVM, bench, ramp, exit — is anchored by its single
 * cell.
 */
function baseCells(m: Module): Array<[number, number]> {
  switch (m.type) {
    case 'retail':
    case 'shop':
    case 'booth': {
      const out: Array<[number, number]> = []
      for (let x = m.x; x < m.x + m.w; x++) for (let y = m.y; y < m.y + m.h; y++) out.push([x, y])
      return out
    }
    case 'platform-edge':
      return edgeCells(m).map(([x, y]) => [x, y] as [number, number])
    case 'billboard':
      return billboardCells(m).map(([x, y]) => [x, y] as [number, number])
    case 'bench':
      return benchCells(m).map(([x, y]) => [x, y] as [number, number])
    case 'track':
      return trackCells(m).map(([x, y]) => [x, y] as [number, number])
    case 'lift':
      return liftFootprintCells(m)
    default:
      return [[m.x, m.y]]
  }
}

/**
 * True when a candidate would stand on a rail track bed. `placementBlocked`
 * only sees other modules; the block under a track bed is solid and looks like
 * floor, so this is the surface rule that sits beside it. The builder refuses
 * these placements even though nothing else occupies the space.
 */
export function placementOnTrack(cells: readonly Cell[], candidate: Module, modules: readonly Module[] = []): boolean {
  for (const [x, y] of baseCells(candidate)) {
    if (isTrackBed(cells, x, y, candidate.z)) return true
    // A dug bed leaves no finish: the module covers the cell, and its own bed
    // base is the block just under it, so test the candidate's cell and the one
    // above (the trench).
    if (trackAt(modules, x, y, candidate.z) || trackAt(modules, x, y, candidate.z + 1)) return true
  }
  return false
}

/**
 * True when a solid block may not be built at `(x, y, z)` because it is a
 * reserved opening: the corridor a ramp carves (stair/escalator/lift) or the
 * floor an exit head-house lays over a hole. Equipment already refuses these
 * spaces through `placementBlocked` / `placementOnTrack`; the block brush needs
 * the same guard, or a hand-built cell seals a run the player can see through.
 */
export function reservedOpening(modules: readonly Module[], x: number, y: number, z: number): boolean {
  return rampOpeningAt(modules, x, y, z) || exitFloorAt(modules, x, y, z)
}

/* ------------------------------------------------------- wall-mounted decor */

/** Decoration types that must be fixed to a wall block behind them (§5.7). */
const WALL_MOUNTED: ReadonlySet<string> = new Set(['billboard'])

/** Decoration types that hang by rods from the ceiling slab above them (§5.7). */
const CEILING_MOUNTED: ReadonlySet<string> = new Set(['sign', 'tv'])

/**
 * The cell step from a wall-mounted module to the wall it hangs on. The model
 * is built against its local −y face and `placeLocal` turns it by `rot`, so the
 * wall lies at (0,−1) rotated: rot 0 → −y, 1 → +x, 2 → +y, 3 → −x.
 */
export function wallSide(rot: number | undefined): [number, number] {
  const [dx, dy] = rotateLocal(rot, 0, -1)
  // Normalise −0 to 0 so callers (and their tests) see plain integers.
  return [dx === 0 ? 0 : dx, dy === 0 ? 0 : dy]
}

/**
 * The cell a wall-mounted piece stands in. Normally the hovered cell itself; but
 * when the pointer is on a wall — the station wall across the track, where there
 * is no walkable floor in front — it is the face-adjacent `place` cell in front
 * of that wall. The caller still checks `wallMountMissing` for the backing.
 */
export function wallMountStandCell(
  cells: readonly Cell[],
  cell: readonly [number, number, number],
  place: readonly [number, number, number],
): [number, number, number] {
  const hit = cells.find((c) => c.x === cell[0] && c.y === cell[1] && c.z === cell[2])
  const onWall = hit !== undefined && hit.fill === 'solid' && isWallBlock(hit)
  return onWall ? [place[0], place[1], place[2]] : [cell[0], cell[1], cell[2]]
}

/**
 * True when a wall-mounted decoration has no wall behind it. The backing is the
 * first course of the facing neighbour (`z + 1`): auto walls and the 墙 tool
 * both rise from the floor's top, so a solid block there is a wall the panel can
 * bolt onto. Every cell of a multi-cell billboard run needs its own wall, or the
 * banner would hang off the end. Non-wall-mounted modules are never refused.
 */
export function wallMountMissing(cells: readonly Cell[], candidate: Module): boolean {
  if (!WALL_MOUNTED.has(candidate.type)) return false
  const [dx, dy] = wallSide(candidate.rot)
  const nz = candidate.z + 1
  for (const [bx, by] of baseCells(candidate)) {
    const nx = bx + dx
    const ny = by + dy
    if (!cells.some((c) => c.fill === 'solid' && c.x === nx && c.y === ny && c.z === nz)) return true
  }
  return false
}

/**
 * The same module turned to face a wall it can actually hang on — the piece's
 * orientation is an **output** of the wall, never an input the player must get
 * right first (the mirror of the 墙 tool's snap in `build/model.ts`).
 *
 * `wallMountMissing` already reduces "which way does it hang?" to `rot` alone, so
 * the orientation is not a free choice: a panel bolted flat to a wall faces that
 * wall and nothing else. This keeps the player's current turn when it is already
 * valid (so a deliberately flipped panel is respected), and otherwise takes the
 * first direction that has real backing, nearest-to-`near` first so a panel
 * dropped in a corner picks the wall the pointer is looking at.
 *
 * Returns the module unchanged when it is not wall-mounted, or when no direction
 * has backing at all — that case is a genuine refusal, and
 * `wallMountMissing` reports it rather than being papered over here.
 */
export function autofaceWallMount(cells: readonly Cell[], candidate: Module, near?: readonly [number, number]): Module {
  if (!WALL_MOUNTED.has(candidate.type)) return candidate
  if (!wallMountMissing(cells, candidate)) return candidate

  const [bx, by] = baseCells(candidate)[0] ?? [candidate.x, candidate.y]
  // `wallSide` is the wall step for a given rot, so inverting it is the whole
  // search: rot 0 → −y, 1 → +x, 2 → +y, 3 → −x.
  const options: Array<{ rot: number; d: number }> = []
  for (let rot = 0; rot < 4; rot++) {
    const [dx, dy] = wallSide(rot)
    const nz = candidate.z + 1
    const backed = baseCells(candidate).every(([cx, cy]) =>
      cells.some((c) => c.fill === 'solid' && c.x === cx + dx && c.y === cy + dy && c.z === nz),
    )
    if (!backed) continue
    const d = near === undefined ? 0 : Math.abs(bx + dx - near[0]) + Math.abs(by + dy - near[1])
    options.push({ rot, d })
  }
  if (options.length === 0) return candidate

  options.sort((a, b) => a.d - b.d || a.rot - b.rot)
  return { ...candidate, rot: options[0].rot }
}

/* ------------------------------------------------------ ceiling-hung decor */

/**
 * True when a ceiling-hung decoration (指示牌 or 电视) has no ceiling above it.
 * The ceiling is the first storey grid line above the piece's floor
 * (`LEVEL_STEPS`, one storey = 4 m in the built grid): the slab the suspension
 * rods bolt to. A piece with nothing overhead has nowhere to hang, so the
 * builder refuses it. Wall-mounted and floor-standing modules are never refused.
 */
export function ceilingMountMissing(cells: readonly Cell[], candidate: Module): boolean {
  if (!CEILING_MOUNTED.has(candidate.type)) return false
  const ceilingZ = LEVEL_STEPS.find((z) => z > candidate.z)
  if (ceilingZ === undefined) return true
  return !cells.some(
    (c) => c.fill === 'solid' && c.x === candidate.x && c.y === candidate.y && c.z === ceilingZ,
  )
}

/** Strict overlap, so modules in adjacent cells (a gate line) do not collide. */
export function boxesOverlap(a: ModuleBox, b: ModuleBox): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0 && a.z0 < b.z1 && a.z1 > b.z0
}

/**
 * True when a candidate module would share space with one already placed — the
 * rule the builder enforces before it commits a placement. A module never
 * conflicts with itself (matched by id), so re-checking is safe.
 *
 * An exit is a special case: stairs and escalators may pass through it, so an
 * exit ↔ stair/escalator overlap never blocks placement. Everything else must
 * keep out of each other's boxes — which is enough for a bank of runs, because a
 * run is built to fit inside one tile: two runs in adjacent cells reserve
 * adjacent (touching, not overlapping) boxes, so escalators and stairs stand
 * flush without a special case, and a wall, fence or gate may be built right up
 * against a run the same way (a fence drawn up to a landing still butts onto its
 * handrail in the renderer, which reads the neighbours rather than this rule). A
 * 1.6 m stair is the exception that proves it: its body crosses into the next
 * cell, so it still collides with whatever is there.
 *
 * A **run** (a stair or an escalator) is measured against flat equipment by the
 * body it draws (`collisionBoxes` → `rampBodyBoxes`), not by its reservation: the
 * body is the slope the run sweeps, tile by tile, so a stair's landing tiles — the
 * treads stop at their edge — and any slab a flight climbs *underneath* are floor a
 * 围栏, a gate or a bench may stand on. The reservation still decides every pairing
 * of two runs, so a second run can never be dropped through the first or share its
 * landing.
 *
 * A shelf or desk is the other exception: room furniture, so it may stand
 * inside a walled room or booth (either side of the pair may be the
 * candidate).
 *
 * The one cell-sharing exemption that is **not** a pair of different kinds is the
 * back-to-back 电视 (`sim/tvs.ts`): two screens facing opposite ways on one tile
 * are one object — a single housing with a lit face each side — so they share the
 * cell deliberately. Only that arrangement is exempt; two 电视 a quarter-turn
 * apart would cross inside the block, and two facing the same way would duplicate a
 * panel, so both still collide.
 */
export function placementBlocked(modules: readonly Module[], candidate: Module): boolean {
  return placementColliders(modules, candidate).length > 0
}

/**
 * Every placed module the candidate would share space with — the offending
 * pieces a blocked preview collides with. Same rule as `placementBlocked`,
 * but returns the modules instead of a boolean so the builder can highlight
 * them alongside the red ghost (§9.5).
 */
export function placementColliders(modules: readonly Module[], candidate: Module): Module[] {
  const out: Module[] = []
  const c = moduleEnvelope(candidate)
  if (!c) return out
  for (const m of modules) {
    if (m === candidate || (candidate.id && m.id === candidate.id)) continue
    if (isExitRampPair(m, candidate)) continue
    if (isFurnitureRoomPair(m, candidate)) continue
    if (isTvPair(m, candidate)) continue
    const e = moduleEnvelope(m)
    if (!e) continue
    let hit = false
    for (const a of collisionBoxes(candidate, m, c)) {
      if (hit) break
      for (const b of collisionBoxes(m, candidate, e)) {
        if (boxesOverlap(a, b)) {
          hit = true
          break
        }
      }
    }
    if (hit) out.push(m)
  }
  return out
}

/**
 * The volume one side of a pair is tested with. Normally the module's own
 * envelope; but a run facing a **flat** piece is reduced to the body it draws
 * (`rampBodyBoxes`), because a run only fills the slope it sweeps: a stair's
 * landing tiles hold no tread at all — the flight stops at their edge — and a slab
 * a flight climbs *underneath* keeps its headroom. A fence that guards the head of
 * a well, or stands on the floor over the low half of the flight, is exactly that.
 *
 * The pairing stays symmetric: whichever piece was placed first, the question is
 * the same one, and two runs (a stair, an escalator or a lift shaft) always meet
 * on their full envelopes so they can never be stacked or share a landing. A run
 * the box list cannot measure falls back to its envelope, so a degenerate piece is
 * never read as clear space.
 */
function collisionBoxes(m: Module, other: Module, envelope: ModuleBox): ModuleBox[] {
  if (!isRampRun(m) || isRunPiece(other)) return [envelope]
  const body = rampBodyBoxes(m)
  return body.length > 0 ? body : [envelope]
}

/** A run whose body is the slope it sweeps: a stair or an escalator. */
function isRampRun(m: Module): boolean {
  return m.type === 'stair' || m.type === 'escalator'
}

/** A piece whose own space is a run: a stair, an escalator or a lift shaft. */
function isRunPiece(m: Module): boolean {
  return m.type === 'stair' || m.type === 'escalator' || m.type === 'lift'
}

/**
 * An exit head-house may be crossed by a stair or escalator run: that pair is
 * allowed to share space. Anything else — exit vs exit, ramp vs ramp, ramp vs
 * flat equipment — still collides.
 */
function isExitRampPair(a: Module, b: Module): boolean {
  const isExit = (m: Module): boolean => m.type === 'exit'
  const isRamp = (m: Module): boolean => m.type === 'stair' || m.type === 'escalator'
  return (isExit(a) && isRamp(b)) || (isExit(b) && isRamp(a))
}

/**
 * A shelf, desk, cubicle, sink, bench, bin or 灭火器箱 standing inside a walled
 * room or booth: that pair never collides, so room furniture can be arranged
 * (and re-arranged) after the room is drawn. The bin and the extinguisher are
 * room furniture in the ordinary sense — a shop or an office holds both — and
 * without this a room's envelope would refuse them its whole floor.
 */
function isFurnitureRoomPair(a: Module, b: Module): boolean {
  const isFurniture = (m: Module): boolean =>
    m.type === 'shelf' ||
    m.type === 'desk' ||
    m.type === 'cubicle' ||
    m.type === 'sink' ||
    m.type === 'bench' ||
    m.type === 'bin' ||
    m.type === 'extinguisher'
  const isRoom = (m: Module): boolean => m.type === 'shop' || m.type === 'booth' || m.type === 'retail'
  return (isFurniture(a) && isRoom(b)) || (isRoom(a) && isFurniture(b))
}

/**
 * Two 电视 set back to back on one tile, facing opposite ways: one housing with a
 * lit face each side, so the pair never collides however their envelopes overlap.
 * Everything else about a 电视 is unchanged — it still hangs from the ceiling over
 * its own cell (`ceilingMountMissing`) and still blocks a gate, a 指示牌 or a third
 * 电视 that is not its opposite number.
 */
function isTvPair(a: Module, b: Module): boolean {
  return a.type === 'tv' && b.type === 'tv' && tvBackToBack(a, b)
}

/**
 * The module standing on cell `(x, y, z)`, for right-click bulldozing. The test
 * volume is the 1 m column just above the block top, so a multi-cell module (an
 * exit, a PSD run, a ramp) is found from any of the cells it covers. A room's
 * envelope covers its whole floor, so furniture standing inside it is preferred:
 * the first pass skips walled rooms and booths, and only when nothing smaller
 * matches does the room itself answer.
 *
 * The one cell that can hold two pieces is a back-to-back 电视 pair, and there the
 * pair is one object seen from two sides: `facing` — the direction the caller is
 * looking from, in world space — picks the panel that is actually on screen, so a
 * click on either face bulldozes the 电视 the player is pointing at. Without a
 * direction (a caller that has no ray) the document's own order decides, as
 * everywhere else.
 */
export function moduleAt(
  modules: readonly Module[],
  x: number,
  y: number,
  z: number,
  facing?: readonly [number, number],
): Module | undefined {
  const cell: ModuleBox = { x0: x, y0: y, z0: z + 1, x1: x + 1, y1: y + 1, z1: z + 2 }
  const hits = (skipRooms: boolean): Module | undefined => {
    for (const m of modules) {
      if (skipRooms && (m.type === 'shop' || m.type === 'booth' || m.type === 'retail')) continue
      const e = moduleEnvelope(m)
      if (e && boxesOverlap(e, cell)) return m
    }
    return undefined
  }
  const found = hits(true) ?? hits(false)
  if (!found || found.type !== 'tv' || !facing) return found
  // The other screen on the same cell, when they are a pair: whoever looks back
  // along the caller's line of sight owns the face under the pointer.
  const mate = modules.find(
    (m): m is Extract<Module, { type: 'tv' }> =>
      m.type === 'tv' && m.id !== found.id && m.x === found.x && m.y === found.y && m.z === found.z && tvBackToBack(found, m),
  )
  if (!mate) return found
  const mine = tvFacing(found.rot)
  const theirs = tvFacing(mate.rot)
  const towards = (f: readonly [number, number]): number => f[0] * facing[0] + f[1] * facing[1]
  return towards(theirs) > towards(mine) ? mate : found
}

/* -------------------------------------------------------- moving a piece */

/**
 * The pieces the 信息 card's **移动** may lift: the flat 设备 and 装饰 that stand on a
 * cell and whose whole state is a `cfg` plus a rotation — a 闸机's lane, a
 * 售票机, a 座椅, a 广告牌's frozen poster, a 指示牌's printed boards.
 *
 * A structural piece is refused, by the same rule that keeps the delete tool from
 * sweeping one (§9.5): a 楼梯 / 扶梯 / 电梯 is a run whose **openings are carved**
 * when it is placed, a 出入口 lays its own head-house floor over a hole, a room
 * owns the walls around it, and a 轨道 / 站台门 is sized and derived from its line.
 * A translation would leave every hole it cut behind and strand the geometry
 * derived from it, so those are torn down and built again instead.
 */
const MOVABLE_TYPES: ReadonlySet<string> = new Set([
  'gate',
  'fence',
  'tvm',
  'vending',
  'bench',
  'shelf',
  'desk',
  'cubicle',
  'sink',
  'bin',
  'extinguisher',
  'billboard',
  'tv',
  'sign',
])

/** True when 移动 may lift this placed piece (the 信息 card's button asks). */
export function isMovableModule(m: Module): boolean {
  return MOVABLE_TYPES.has(m.type)
}

/**
 * The same piece moved to `at` and turned to `rot`. Nothing else is touched: the
 * id and the whole `cfg` — a 闸机's lane, a 指示牌's printed boards, a 广告牌's
 * poster — travel with it, so what comes up is what goes down.
 */
export function movedModule(m: Module, at: Vec3i, rot: number): Module {
  return { ...m, x: at.x, y: at.y, z: at.z, rot }
}

/**
 * Why a lifted piece may not be dropped as `candidate`, or `''` when it may. The
 * same rules a fresh placement answers to — floor under every cell it stands on,
 * no track bed, nothing already in the space, a wall behind a 广告牌, a ceiling
 * over a 指示牌 / 电视 — asked of a piece that already exists, so the copy still
 * standing at the piece's origin never counts as the obstacle (`placementBlocked`
 * matches a candidate to itself by id).
 */
export function moveDropReason(cells: readonly Cell[], modules: readonly Module[], candidate: Module): string {
  // A 广告牌 bolts to a wall and may hang over the track where there is no floor
  // in front of that wall, so it is resolved from its backing alone — exactly as
  // the placement tool resolves it (`placeModule`).
  if (WALL_MOUNTED.has(candidate.type)) {
    if (wallMountMissing(cells, candidate)) return '广告牌要贴在墙上：先砌一堵墙'
    return placementBlocked(modules, candidate) ? '这儿已经有设备了，换个地方' : ''
  }
  for (const [x, y] of baseCells(candidate)) {
    const floor =
      cells.some((c) => c.fill === 'solid' && c.x === x && c.y === y && c.z === candidate.z) ||
      exitFloorAt(modules, x, y, candidate.z)
    if (!floor) return '这儿没有地板，设备要站在实心地板上'
  }
  if (placementOnTrack(cells, candidate, modules)) return '轨道上不能放设备'
  if (placementBlocked(modules, candidate)) return '这儿已经有设备了，换个地方'
  if (ceilingMountMissing(cells, candidate)) return '指示牌和电视要吊在天花板下：上面得有一层楼板（四米高）'
  return ''
}

/**
 * The piece a lifted module becomes at `at` with rotation `rot`, and why that
 * drop is refused (`''` when it is legal). One function answers for the
 * translucent ghost under the pointer, the `信息` card's 确认 and the commit
 * itself, so what the player sees in the air is exactly what lands.
 *
 * The rotation is the carried one; a wall-mounted piece is turned to face its
 * wall first (`autofaceWallMount` keeps the carried turn whenever that turn is
 * backed), because which way a panel bolted to a wall faces is the wall's answer,
 * never the player's problem.
 */
export function moveCandidate(
  cells: readonly Cell[],
  modules: readonly Module[],
  mod: Module,
  at: Vec3i,
  rot: number,
): { module: Module; reason: string } {
  const moved = autofaceWallMount(cells, movedModule(mod, at, rot))
  return { module: moved, reason: moveDropReason(cells, modules, moved) }
}
