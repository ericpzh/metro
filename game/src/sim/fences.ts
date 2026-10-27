// Fence joint geometry (围栏, §5.2). Pure: the renderer builds a fence panel
// from the arms this returns, and the tests can check every joint shape without
// three. A fence cell draws a half panel from its centre post to each edge a
// neighbour touches; a dead end caps to its far edge, and a lone panel caps both
// ends of its rotation axis. A junction never caps, so nothing overhangs past an
// L, T or + turn — which is what makes a clean 90° corner.
//
// A neighbour may also be a 闸机, but only on the side its machine body stands on
// (`gateSolidFaces` in `sim/gates.ts`): that is the face a run butts into, while
// the lane side is a doorway the run must end at. The caller resolves that — the
// booleans here are just "this side holds something a panel may meet".

import { stairFlights, stairFlightSlides, stairTreadWidth } from './stairs.ts'
import { escalatorLandings } from './escalators.ts'
import { walkwayLandings } from './walkways.ts'
import { gateSolidFaces } from './gates.ts'
import type { Module } from './types.ts'

type Fence = Extract<Module, { type: 'fence' }>
export interface FenceConnectionIndex {
  fencesAt(x: number, y: number, z: number): readonly Fence[]
  hasRailLanding(x: number, y: number, z: number): boolean
  /** Direction from the neighbouring cell back to the fence being drawn. */
  connects(x: number, y: number, z: number, dx: number, dy: number, excludeId?: string): boolean
}
const connectionIndexes = new WeakMap<readonly Module[], FenceConnectionIndex>()

/** Immutable document index: four cell lookups per fence, including ramp landings.
 * The preview layers its small candidate index over this prepared station index. */
export function fenceConnectionIndex(modules: readonly Module[]): FenceConnectionIndex {
  const cached = connectionIndexes.get(modules)
  if (cached) return cached
  const fences = new Map<string, Fence[]>()
  const gates = new Map<string, Extract<Module, { type: 'gate' }>[]>()
  const landings = new Set<string>()
  const key = (x: number, y: number, z: number): string => `${x},${y},${z}`
  for (const mod of modules) {
    if (mod.type === 'fence') {
      const k = key(mod.x, mod.y, mod.z)
      const at = fences.get(k) ?? []
      at.push(mod); fences.set(k, at)
    } else if (mod.type === 'gate') {
      const k = key(mod.x, mod.y, mod.z)
      const at = gates.get(k) ?? []
      at.push(mod); gates.set(k, at)
    } else if (mod.type === 'stair' && !mod.cfg.block) {
      const width = stairTreadWidth(mod)
      const flights = stairFlights(mod)
      const slides = stairFlightSlides(mod)
      // A landing's graph node is the first lane only; its rail spans the full
      // stair width. Read the cells from the band the flight actually draws
      // (`stairFlightSlides`) rather than stepping a fixed "right of the run":
      // a straight stair's band is slid to its own right, while a turning
      // stair's returning leg is slid the other way, so one signed step cannot
      // cover both. The band's centre is the end cell centre plus its slide, and
      // the cells it covers are the whole cells across its tread width.
      const addBand = (p: { x: number; y: number; z: number }, slide: { dx: number; dy: number }, acrossX: boolean): void => {
        if (acrossX) {
          const centre = p.x + 0.5 + slide.dx
          const lo = Math.floor(centre - width / 2 + 1e-9)
          const hi = Math.ceil(centre + width / 2 - 1e-9) - 1
          for (let x = lo; x <= hi; x++) landings.add(key(x, p.y, p.z))
        } else {
          const centre = p.y + 0.5 + slide.dy
          const lo = Math.floor(centre - width / 2 + 1e-9)
          const hi = Math.ceil(centre + width / 2 - 1e-9) - 1
          for (let y = lo; y <= hi; y++) landings.add(key(p.x, y, p.z))
        }
      }
      for (const [i, f] of flights.entries()) {
        const runDx = f.to.x - f.from.x
        const runDy = f.to.y - f.from.y
        if (runDx === 0 && runDy === 0) {
          landings.add(key(f.from.x, f.from.y, f.from.z))
          continue
        }
        const slide = slides[i] ?? { dx: 0, dy: 0 }
        // The width runs across the flight, so its own run picks the axis: a
        // flight along x spans cells in y, and one along y spans cells in x.
        const acrossX = Math.abs(runDx) < Math.abs(runDy)
        addBand(f.from, slide, acrossX)
        addBand(f.to, slide, acrossX)
      }
    } else if (mod.type === 'escalator' || mod.type === 'walkway') {
      for (const p of mod.type === 'escalator' ? escalatorLandings(mod) : walkwayLandings(mod)) landings.add(key(p.x, p.y, p.z))
    }
  }
  const index: FenceConnectionIndex = {
    fencesAt: (x, y, z) => fences.get(key(x, y, z)) ?? [],
    hasRailLanding: (x, y, z) => landings.has(key(x, y, z)),
    connects: (x, y, z, dx, dy, excludeId) => {
      const k = key(x, y, z)
      // `excludeId` is the caller's own piece (a hover being extended); unset means
      // nothing is excluded, so an imported module with no id still joins a run.
      const kept = (m: Module): boolean => excludeId === undefined || m.id !== excludeId
      return (fences.get(k)?.some(kept) ?? false) || landings.has(k)
        || (gates.get(k)?.some(m => kept(m) && gateSolidFaces(m, dx, dy)) ?? false)
    },
  }
  connectionIndexes.set(modules, index)
  return index
}

/**
 * True when a stair, escalator or 自动步道 has a landing on `(x, y, z)`. Stair
 * landings include every lane under the full-width rail. A fence
 * run may meet a run's balustrade at that cell, so the fence treats it as a
 * neighbour (drops its end cap and butts up to the rail) instead of stopping short.
 */
export function railLandingAt(modules: readonly Module[], x: number, y: number, z: number): boolean {
  return fenceConnectionIndex(modules).hasRailLanding(x, y, z)
}

/** Which of a fence cell's four same-level sides hold a fence or a gate. */
export interface FenceNeighbours {
  e: boolean
  w: boolean
  n: boolean
  s: boolean
}

/**
 * The X and Y extents a fence panel runs along, in metres from the cell centre
 * (so ±0.5 is a cell edge), plus which ends carry an end post. A single cell
 * (`rot` even = +x axis) is a full panel on that axis; a run end extends to its
 * far edge; a junction has no caps.
 */
export interface FenceArms {
  x0: number
  x1: number
  y0: number
  y1: number
  capE: boolean
  capW: boolean
  capN: boolean
  capS: boolean
}

export function fenceArms(rot: number | undefined, nb: FenceNeighbours): FenceArms {
  const rotEven = ((((rot ?? 0) % 4) + 4) % 4) % 2 === 0
  const degree = (nb.e ? 1 : 0) + (nb.w ? 1 : 0) + (nb.n ? 1 : 0) + (nb.s ? 1 : 0)
  let capE = false
  let capW = false
  let capN = false
  let capS = false
  if (degree === 0) {
    // A lone panel: full length on its rotation axis, a post at each end.
    if (rotEven) capE = capW = true
    else capN = capS = true
  } else if (degree === 1) {
    // A run end: cap the far edge opposite the single neighbour, on that axis.
    if (nb.e) capW = true
    else if (nb.w) capE = true
    else if (nb.n) capS = true
    else if (nb.s) capN = true
  }
  return {
    x0: nb.w || capW ? -0.5 : 0,
    x1: nb.e || capE ? 0.5 : 0,
    y0: nb.s || capS ? -0.5 : 0,
    y1: nb.n || capN ? 0.5 : 0,
    capE,
    capW,
    capN,
    capS,
  }
}
