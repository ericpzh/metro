// Fence joint geometry (围栏, §5.2). Pure: the renderer builds a fence panel
// from the arms this returns, and the tests can check every joint shape without
// three. A fence cell draws a half panel from its centre post to each edge a
// neighbour touches; a dead end caps to its far edge, and a lone panel caps both
// ends of its rotation axis. A junction never caps, so nothing overhangs past an
// L, T or + turn — which is what makes a clean 90° corner.

import { stairFlights } from './stairs.ts'
import type { Module } from './types.ts'

/**
 * True when a stair or escalator has a landing on `(x, y, z)`. A fence run may
 * meet a stair's handrail at that cell, so the fence treats it as a neighbour
 * (drops its end cap and butts up to the rail) instead of stopping short.
 */
export function railLandingAt(modules: readonly Module[], x: number, y: number, z: number): boolean {
  for (const m of modules) {
    if (m.type === 'stair') {
      for (const f of stairFlights(m)) {
        if ((f.from.x === x && f.from.y === y && f.from.z === z) || (f.to.x === x && f.to.y === y && f.to.z === z)) return true
      }
    } else if (m.type === 'escalator') {
      if ((m.from.x === x && m.from.y === y && m.from.z === z) || (m.to.x === x && m.to.y === y && m.to.z === z)) return true
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
