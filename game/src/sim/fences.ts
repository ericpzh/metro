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

import { stairFlights } from './stairs.ts'
import { escalatorLandings } from './escalators.ts'
import { walkwayLandings } from './walkways.ts'
import { gateSolidFaces } from './gates.ts'
import type { Module } from './types.ts'

type Fence = Extract<Module, { type: 'fence' }>
export interface FenceConnectionIndex {
  fencesAt(x: number, y: number, z: number): readonly Fence[]
  /** Direction from the neighbouring cell back to the fence being drawn. */
  connects(x: number, y: number, z: number, dx: number, dy: number): boolean
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
    const k = key(mod.x, mod.y, mod.z)
    if (mod.type === 'fence') {
      const at = fences.get(k) ?? []
      at.push(mod); fences.set(k, at)
    } else if (mod.type === 'gate') {
      const at = gates.get(k) ?? []
      at.push(mod); gates.set(k, at)
    } else if (mod.type === 'stair' && !mod.cfg.block) {
      for (const f of stairFlights(mod)) for (const p of [f.from, f.to]) landings.add(key(p.x, p.y, p.z))
    } else if (mod.type === 'escalator' || mod.type === 'walkway') {
      for (const p of mod.type === 'escalator' ? escalatorLandings(mod) : walkwayLandings(mod)) landings.add(key(p.x, p.y, p.z))
    }
  }
  const index: FenceConnectionIndex = {
    fencesAt: (x, y, z) => fences.get(key(x, y, z)) ?? [],
    connects: (x, y, z, dx, dy) => {
      const k = key(x, y, z)
      return fences.has(k) || landings.has(k) || (gates.get(k)?.some(m => gateSolidFaces(m, dx, dy)) ?? false)
    },
  }
  connectionIndexes.set(modules, index)
  return index
}

/**
 * True when a stair, escalator or 自动步道 has a landing on `(x, y, z)`. A fence
 * run may meet a run's balustrade at that cell, so the fence treats it as a
 * neighbour (drops its end cap and butts up to the rail) instead of stopping short.
 */
export function railLandingAt(modules: readonly Module[], x: number, y: number, z: number): boolean {
  for (const m of modules) {
    if (m.type === 'stair') {
      // A 楼梯块 is a stepped floor tile, not a ramp with a handrail to meet (§5.1–§5.2).
      if (m.cfg.block) continue
      for (const f of stairFlights(m)) {
        if ((f.from.x === x && f.from.y === y && f.from.z === z) || (f.to.x === x && f.to.y === y && f.to.z === z)) return true
      }
    } else if (m.type === 'escalator') {
      if (escalatorLandings(m).some((p) => p.x === x && p.y === y && p.z === z)) return true
    } else if (m.type === 'walkway') {
      if (walkwayLandings(m).some((p) => p.x === x && p.y === y && p.z === z)) return true
    }
  }
  return false
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
