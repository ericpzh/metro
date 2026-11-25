// Shared booth monitor placement and overhead canopy ceiling-hang rules (§5).
// Pure simulation geometry so renderer, dependency invalidation, and tests agree.
import { GROUND_Z, virtualSolidAt } from './ground.ts'
import {
  BRIDGE_DECK_DEPTH,
  CANOPY_ROOF_DROP,
  TRUSS_ROOF_BASE,
  TRUSS_ROOF_EAVE,
  trussRoofRidge,
} from './structures.ts'
import { rotateLocal, trackCellAt } from './track.ts'
import type { Cell, Module } from './types.ts'

export type BoothModule = Extract<Module, { type: 'booth' }>

export const BOOTH_HEADER_BOTTOM = 2.08
export const BOOTH_HEADER_TOP = 2.4
/** Maximum vertical suspension distance from the top of the info canopy to a ceiling, metres. */
export const BOOTH_HEADER_MAX_HANG = 3

const EPS = 1e-6

export interface BoothScreenLayout {
  readonly y: number
  readonly xs: readonly number[]
}

export interface BoothSuspensionCorner {
  /** Local canonical offset relative to the booth footprint centre. */
  readonly lx: number
  readonly ly: number
  /** World document position of the corner suspension rod. */
  readonly wx: number
  readonly wy: number
  readonly cellX: number
  readonly cellY: number
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value))
}

/**
 * Smart counter monitor placement in canonical booth space (`x ∈ [x0, x1]`, `y ∈ [y0, y0 + h]`,
 * front face along `y0`). Keeps every monitor base and bezel on solid flat full-height counter
 * surface — never overhanging the info desk's sloped accessible shoulder, outer edges, or glazing,
 * and collapsing to one centred monitor when a narrow ticket booth cannot fit two cleanly.
 */
export function boothScreenPositions(
  info: boolean,
  w: number,
  h: number,
  x0: number,
  x1: number,
  y0: number,
): BoothScreenLayout {
  const depth = Math.min(0.55, w / 3, h / 3)
  const a = x0 + depth
  const b = x1 - depth
  const mid = (a + b) / 2
  const run = Math.max(0.1, b - a)

  // Monitor base is 0.18 m deep (±0.09). Keep it inside [y0 + frontClear, y0 + depth - 0.02].
  const minY = y0 + (info ? 0.04 : 0.07) + 0.09
  const maxY = y0 + depth - 0.09 - 0.02
  const y = minY <= maxY ? clamp(y0 + depth * 0.67, minY, maxY) : y0 + depth * 0.55

  if (info) {
    const lowWidth = Math.min(0.9, run * 0.36)
    const shoulder = Math.min(0.32, run * 0.16)
    const shoulderLeft = mid - lowWidth / 2 - shoulder
    // Left flat full-height counter spans [x0, shoulderLeft] (side run + left front wing).
    // Keep the 0.34 m bezel (±0.17) clear of both the outer edge and the sloped shoulder.
    const minX = x0 + 0.23
    const maxX = shoulderLeft - 0.21
    const preferred = a + run * 0.16
    if (minX <= maxX) return { y, xs: [clamp(preferred, minX, maxX)] }
    if (shoulderLeft - x0 >= 0.32) return { y, xs: [(x0 + shoulderLeft) / 2] }
    return { y, xs: [] }
  }

  // Ticket kiosk counter is flat between corner posts (0.08 m wide each side).
  const safeMin = x0 + 0.29
  const safeMax = x1 - 0.29
  const leftX = Math.max(safeMin, a + run * 0.2)
  const rightX = Math.min(safeMax, b - run * 0.2)
  if (rightX - leftX >= 0.44) return { y, xs: [leftX, rightX] }
  if (safeMin <= safeMax) return { y, xs: [mid] }
  return { y, xs: [] }
}

/**
 * The four suspension corners of a booth's overhead rectangular frame, in canonical
 * offsets and world document coordinates (accounting for `cfg.front`).
 */
export function boothSuspensionCorners(mod: BoothModule): readonly BoothSuspensionCorner[] {
  const front = ((mod.cfg.front ?? 0) % 4 + 4) % 4
  const cx = mod.x + mod.w / 2
  const cy = mod.y + mod.h / 2
  const w = front % 2 ? mod.h : mod.w
  const h = front % 2 ? mod.w : mod.h
  const hx = Math.max(0, w / 2 - 0.09)
  const hy = Math.max(0, h / 2 - 0.098)
  const locals: ReadonlyArray<readonly [number, number]> = [
    [-hx, -hy],
    [hx, -hy],
    [-hx, hy],
    [hx, hy],
  ]
  return locals.map(([lx, ly]) => {
    const [rx, ry] = rotateLocal(front, lx, ly)
    const wx = cx + rx
    const wy = cy + ry
    return {
      lx,
      ly,
      wx,
      wy,
      cellX: Math.floor(wx),
      cellY: Math.floor(wy),
    }
  })
}

function hasSolidCell(cells: readonly Cell[], x: number, y: number, z: number): boolean {
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]!
    if (c.fill === 'solid' && c.x === x && c.y === y && c.z === z) return true
  }
  return false
}

function roofUndersideAt(roof: Extract<Module, { type: 'roof' }>, wx: number, wy: number, cellX: number, cellY: number): number | null {
  const [cellLocalX, cellLocalY] = rotateLocal(-(roof.rot ?? 0), cellX - roof.x, cellY - roof.y)
  if (cellLocalX < -EPS || cellLocalX >= roof.w - EPS || cellLocalY < -EPS || cellLocalY >= roof.d - EPS) return null
  if (!roof.cfg.variant) {
    if (roof.cfg.plateSnap === 'lower') return roof.z
    if (roof.cfg.plateSnap === 'upper') return roof.z + 0.75
    return roof.z + 1 + TRUSS_ROOF_BASE
  }
  const [, localY] = rotateLocal(-(roof.rot ?? 0), wx - (roof.x + 0.5), wy - (roof.y + 0.5))
  const drop = roof.cfg.variant === 'canopy' ? CANOPY_ROOF_DROP : 0
  const ridgeZ = trussRoofRidge(roof.d) - drop
  const eaveZ = TRUSS_ROOF_EAVE - drop
  const crestY = (roof.d - 1) / 2
  const span = Math.min(1, Math.abs(localY - crestY) / (roof.d / 2))
  return roof.z + 1 + ridgeZ - (ridgeZ - eaveZ) * span
}

/**
 * Lowest real ceiling underside above `(wx, wy)` within `[barTop, barTop + BOOTH_HEADER_MAX_HANG]`.
 * Checks solid slabs (with open air below), the unexcavated virtual street plane, non-tunnel
 * track decks, and roof/canopy modules. Returns `null` when nothing hangs within 3 m.
 */
export function boothCeilingZ(
  cells: readonly Cell[],
  modules: readonly Module[],
  mod: BoothModule,
  wx: number,
  wy: number,
): number | null {
  const minZ = mod.z + 1 + BOOTH_HEADER_TOP
  const maxZ = minZ + BOOTH_HEADER_MAX_HANG
  const cellX = Math.floor(wx)
  const cellY = Math.floor(wy)
  let best: number | null = null
  const offer = (z: number): void => {
    if (z < minZ - EPS || z > maxZ + EPS) return
    if (best === null || z < best) best = z
  }

  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]!
    if (c.fill !== 'solid' || c.x !== cellX || c.y !== cellY) continue
    if (c.z < minZ - EPS || c.z > maxZ + EPS) continue
    if (best !== null && c.z >= best) continue
    if (hasSolidCell(cells, cellX, cellY, c.z - 1)) continue
    offer(c.z)
  }

  if (GROUND_Z >= minZ - EPS && GROUND_Z <= maxZ + EPS
    && (best === null || GROUND_Z < best)
    && virtualSolidAt(cells, modules, cellX, cellY, GROUND_Z)
    && !hasSolidCell(cells, cellX, cellY, GROUND_Z - 1)) {
    offer(GROUND_Z)
  }

  for (let i = 0; i < modules.length; i++) {
    const m = modules[i]!
    if (m.type === 'track') {
      if (m.cfg.tunnel) continue
      const underside = m.z - BRIDGE_DECK_DEPTH
      if (underside < minZ - EPS || underside > maxZ + EPS) continue
      if (best !== null && underside >= best) continue
      if (!trackCellAt(m, cellX, cellY, m.z)) continue
      if (hasSolidCell(cells, cellX, cellY, underside - 1)) continue
      offer(underside)
    } else if (m.type === 'roof') {
      const underside = roofUndersideAt(m, wx, wy, cellX, cellY)
      if (underside !== null) offer(underside)
    }
  }

  return best
}

/**
 * Ceiling underside elevation at each of the four overhead-frame corners for an `info` booth,
 * or `null` if any corner lacks a ceiling within `BOOTH_HEADER_MAX_HANG` (3 m).
 */
export function boothHeaderHang(
  cells: readonly Cell[],
  modules: readonly Module[],
  mod: BoothModule,
): readonly [number, number, number, number] | null {
  if (mod.cfg.kind !== 'info') return null
  const corners = boothSuspensionCorners(mod)
  const zs: number[] = []
  for (let i = 0; i < corners.length; i++) {
    const corner = corners[i]!
    const z = boothCeilingZ(cells, modules, mod, corner.wx, corner.wy)
    if (z === null) return null
    zs.push(z)
  }
  return [zs[0]!, zs[1]!, zs[2]!, zs[3]!]
}
