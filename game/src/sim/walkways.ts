// Moving walkways (自动步道) — GAME-SPEC §5.1 / §7.8.
//
// A moving walkway is the **level** member of the ramp family: the escalator's
// own piece with no climb. It carries people along a flat run at `WALKWAY_SPEED`
// — the free walking speed plus the 0.5 m/s the belt adds — the way an escalator
// carries them up an incline. Every piece of its body (the moving band, the
// skirt, the glass balustrade, the handrail and the newels) comes from
// `sim/escalators.ts`, so a walkway *looks* like a flat escalator and banks of
// the two stand flush.
//
// Two differences from the escalator:
//   * it is **flat** (rise 0), so it has no truss under it and carves no slab —
//     it lies on the floor, and the floor it lies on must be there for its whole
//     length (the run is not a hole; the belt is a surface over solid ground);
//   * its ends are the **only** way on. The belt's interior is not walkable: the
//     covered cells are excluded from the graph (`sim/station.ts`), so the crowd
//     enters and leaves at the two landings and is carried between them.
//
// The run comes in three lengths — 短 30 m, 中 60 m, 长 90 m — read from the two
// endpoints like the escalator's, so a piece loaded from a save needs no `cfg`
// flag. Pure data — no three, no DOM.

import type { Module, Vec3i } from './types.ts'
import { msg } from './i18n.ts'
import type { MessageKey } from './i18n.ts'
import { escalatorLandings, escalatorRun } from './escalators.ts'
import { stairFacing } from './stairs.ts'

export type Walkway = Extract<Module, { type: 'walkway' }>

/** Travel direction: `up` runs from the dropped cell to the far end, `down` back. */
export type WalkwayDir = 'up' | 'down'

/** The three level run lengths a 自动步道 is built at, metres of travel. */
export type WalkwayLength = 'short' | 'medium' | 'long'

export interface WalkwayLengthSpec {
  id: WalkwayLength
  /** Cells of level run between the two landings. */
  run: number
  label: MessageKey
}

export const WALKWAY_LENGTHS: readonly WalkwayLengthSpec[] = [
  { id: 'short', run: 30, label: 'short' },
  { id: 'medium', run: 60, label: 'medium' },
  { id: 'long', run: 90, label: 'long' },
]

/**
 * 短 (30 m) by default. A walkway is dropped into a concourse that already exists
 * — the shortest useful belt — and the player grows it, so the fresh piece is the
 * least intrusive of the three rather than the middle one the escalator defaults
 * to (its 中 is the one-storey piece the station is built around).
 */
export const WALKWAY_LENGTH_DEFAULT: WalkwayLength = 'short'

/** The catalogue entry for `id`; an id a save cannot spell falls back to 短. */
export function walkwayLengthSpec(id: WalkwayLength | undefined): WalkwayLengthSpec {
  return WALKWAY_LENGTHS.find((s) => s.id === id) ?? WALKWAY_LENGTHS[0]
}

/** The next length the action tile cycles to (短 → 中 → 长 → 短). */
export function nextWalkwayLength(id: WalkwayLength): WalkwayLength {
  const i = WALKWAY_LENGTHS.findIndex((s) => s.id === id)
  return WALKWAY_LENGTHS[(i + 1) % WALKWAY_LENGTHS.length].id
}

/** The name the Tab tile wears for a length: 短 / 中 / 长. */
export function walkwayLengthLabel(id: WalkwayLength | undefined): string {
  return msg(walkwayLengthSpec(id).label)
}

/** The other travel direction, cycled with Tab. */
export function nextWalkwayDir(dir: WalkwayDir): WalkwayDir {
  return dir === 'up' ? 'down' : 'up'
}

/**
 * `base` is one landing (the cell dropped on), and `length` picks 短 30 m / 中
 * 60 m / 长 90 m of level run (`WALKWAY_LENGTHS`). `dir` orders `from`/`to`
 * (up: base → far end, down: far end → base) without moving the run, so up and
 * down share one footprint. The other landing lands on the block grid at
 * `base + facing * run`.
 */
export function walkwayModule(
  base: Vec3i,
  rot: number,
  dir: WalkwayDir,
  id: string,
  width: 1 | 2 = 1,
  length: WalkwayLength = WALKWAY_LENGTH_DEFAULT,
): Module {
  const [dx, dy] = stairFacing(rot)
  const run = walkwayLengthSpec(length).run
  const near: Vec3i = { x: base.x, y: base.y, z: base.z }
  const far: Vec3i = { x: base.x + dx * run, y: base.y + dy * run, z: base.z }
  const up = dir !== 'down'
  return {
    id,
    type: 'walkway',
    x: base.x,
    y: base.y,
    z: base.z,
    rot,
    from: up ? near : far,
    to: up ? far : near,
    cfg: { dir: up ? 'up' : 'down', ...(width === 2 ? { width } : {}) },
  }
}

/**
 * Endpoints are authoritative, including pieces loaded from older saves: the
 * length is the level span between the two landings, matched to the nearest
 * catalogue entry. A run the catalogue never built still arms the closest tile.
 */
export function walkwayLengthOf(m: Walkway): WalkwayLength {
  const run = Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y)
  let best: WalkwayLength = WALKWAY_LENGTH_DEFAULT
  let bestError = Infinity
  for (const s of WALKWAY_LENGTHS) {
    const error = Math.abs(s.run - run)
    if (error < bestError) {
      bestError = error
      best = s.id
    }
  }
  return best
}

/** All floor cells supporting the two ends of this single piece. */
export function walkwayLandings(m: Walkway): Vec3i[] {
  return escalatorLandings(m)
}

/**
 * The two columns of the run's plan, one pair of landings each: the near/far
 * ends, plus (for a wide piece) the lane one cell across, taken from the run's
 * own centring shift so the pair matches what `escalatorLandings` reports.
 */
function walkwayColumns(m: Walkway): Array<[Vec3i, Vec3i]> {
  if (m.cfg.width !== 2) return [[m.from, m.to]]
  const run = escalatorRun(m)
  const qx = 2 * (run.from.x - m.from.x)
  const qy = 2 * (run.from.y - m.from.y)
  const across = (p: Vec3i): Vec3i => ({ x: p.x + qx, y: p.y + qy, z: p.z })
  return [[m.from, m.to], [across(m.from), across(m.to)]]
}

/**
 * Every cell the moving band covers **between** its two landings, across every
 * lane — the belt's interior. The graph leaves these out (`sim/station.ts`), so
 * the crowd is carried along the belt rather than free to walk its length, and
 * the landings stay nodes at both ends. The landings themselves are not covered.
 */
export function walkwayCoveredCells(m: Walkway): Vec3i[] {
  const out: Vec3i[] = []
  const seen = new Set<string>()
  for (const [a, b] of walkwayColumns(m)) {
    const stepX = Math.sign(b.x - a.x)
    const stepY = Math.sign(b.y - a.y)
    const span = Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
    for (let i = 1; i < span; i++) {
      const x = a.x + stepX * i
      const y = a.y + stepY * i
      const key = `${x},${y},${a.z}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ x, y, z: a.z })
    }
  }
  // Canonical order (x then y), so up and down report the same belt.
  out.sort((p, q) => (p.x - q.x) || (p.y - q.y))
  return out
}
