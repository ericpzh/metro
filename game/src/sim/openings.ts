// Ramps vs solid ground — GAME-SPEC §5.4 / §5.5.
//
// An escalator, stair or lift is placed as a `from`→`to` run, but the floor it
// climbs through has no opening in the cell data. Left alone, the ramp body
// draws straight through the slab ("escalators punching through solid ground").
//
// `carveRampOpenings` removes the solid cells a ramp passes through, so the run
// emerges from a real opening. It is deliberately conservative:
//
//   * only cells the ramp actually cuts *above its walking line* are removed;
//     the landing cells at both ends are kept, because the station graph needs
//     them as the ramp's edge nodes;
//   * a vertical run (a lift shaft) is left alone — it spans the same column,
//     so there is nothing to carve cell-by-cell;
//   * pure data, no DOM, no three.

import type { Cell, Module, Vec3i } from './types.ts'

/** Headroom above the walking line that must be clear, metres. */
const HEADROOM = 1.3
/** Half-width of the swept corridor, metres. */
const HALF_WIDTH = 0.9
/** A cell must clear the line by this much before it counts as an obstruction. */
const EPS = 0.02

/* ------------------------------------------------------- ramp collision box */

/** Half-width of a ramp's envelope, metres (an escalator is ~1.2 m overall). */
const RAMP_HALF = 0.7
/** Truss depth below the walking line, metres. */
const RAMP_FOOT = 0.5
/** Balustrade height above the walking line, metres. */
const RAMP_HEADROOM = 1.2
/** Padding so two ramps in adjacent columns do not read as touching. */
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
 * balustrade above the higher one.
 */
export function rampEnvelope(m: Module): RampBox | null {
  if (m.type !== 'escalator' && m.type !== 'stair' && m.type !== 'lift') return null
  const ax = m.from.x + 0.5
  const ay = m.from.y + 0.5
  const bx = m.to.x + 0.5
  const by = m.to.y + 0.5
  const lo = Math.min(m.from.z, m.to.z) + 1
  const hi = Math.max(m.from.z, m.to.z) + 1
  return {
    x0: Math.min(ax, bx) - RAMP_HALF - RAMP_CLEAR,
    x1: Math.max(ax, bx) + RAMP_HALF + RAMP_CLEAR,
    y0: Math.min(ay, by) - RAMP_HALF - RAMP_CLEAR,
    y1: Math.max(ay, by) + RAMP_HALF + RAMP_CLEAR,
    z0: lo - RAMP_FOOT - RAMP_CLEAR,
    z1: hi + RAMP_HEADROOM + RAMP_CLEAR,
  }
}

function boxesOverlap(a: RampBox, b: RampBox): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0 && a.z0 < b.z1 && a.z1 > b.z0
}

/**
 * True when a candidate ramp would share space with an existing one — the rule
 * that stops a second escalator being dropped immediately below a first.
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
}

function rampOf(m: Module): Ramp | null {
  if (m.type === 'escalator' || m.type === 'stair' || m.type === 'lift') return { from: m.from, to: m.to }
  return null
}

/**
 * True when a solid cell intrudes into the headroom above a ramp's walking
 * line — i.e. the ramp has to pass through it to surface.
 */
function intrudes(c: Cell, r: Ramp): boolean {
  const ax = r.from.x + 0.5
  const ay = r.from.y + 0.5
  const az = r.from.z + 1
  const dx = r.to.x + 0.5 - ax
  const dy = r.to.y + 0.5 - ay
  const len2 = dx * dx + dy * dy
  // A vertical run (lift) has no horizontal sweep: nothing to carve.
  if (len2 < 1e-6) return false
  const px = c.x + 0.5
  const py = c.y + 0.5
  const t = ((px - ax) * dx + (py - ay) * dy) / len2
  if (t < 0 || t > 1) return false
  const lateral = Math.abs((px - ax) * dy - (py - ay) * dx) / Math.sqrt(len2)
  if (lateral > HALF_WIDTH) return false
  const h = az + (r.to.z + 1 - az) * t
  // Above the line (so the ramp surfaces through it) but within headroom, and
  // strictly inside the cell rather than exactly at its top (the landing).
  return c.z + 1 > h + EPS && c.z < h + HEADROOM
}

/**
 * Remove every solid cell that a ramp passes through, in place. Returns how
 * many were removed. Safe to call more than once (idempotent once carved).
 */
export function carveRampOpenings(cells: Cell[], modules: readonly Module[]): number {
  const ramps: Ramp[] = []
  // Landing cells are the ramp's graph nodes; never carve them, even when two
  // runs share a column (an up and a down escalator side by side).
  const protect = new Set<string>()
  for (const m of modules) {
    const r = rampOf(m)
    if (!r) continue
    ramps.push(r)
    protect.add(`${r.from.x},${r.from.y},${r.from.z}`)
    protect.add(`${r.to.x},${r.to.y},${r.to.z}`)
  }
  if (ramps.length === 0) return 0
  const kill = new Set<number>()
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]
    if (c.fill !== 'solid') continue
    if (protect.has(`${c.x},${c.y},${c.z}`)) continue
    for (const r of ramps) {
      if (intrudes(c, r)) {
        kill.add(i)
        break
      }
    }
  }
  if (kill.size === 0) return 0
  let w = 0
  for (let i = 0; i < cells.length; i++) {
    if (kill.has(i)) continue
    cells[w++] = cells[i]
  }
  cells.length = w
  return kill.size
}
