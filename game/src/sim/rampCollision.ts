// Continuous passenger clearance against the graph's ramp rails (§5.1 / §10.3).
import { RAMP_BODY_RADIUS, RAMP_OUTSIDE_CLEARANCE } from './constants.ts'

export interface RampWall {
  ax: number
  ay: number
  bx: number
  by: number
  z0: number
  z1: number
  inwardX: number
  inwardY: number
}

function pointDistance2(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay
  const length2 = dx * dx + dy * dy
  const t = length2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length2)) : 0
  return (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2
}

function crosses(x: number, y: number, nx: number, ny: number, w: RampWall): boolean {
  const dx = nx - x, dy = ny - y
  const wx = w.bx - w.ax, wy = w.by - w.ay
  const det = dx * wy - dy * wx
  if (Math.abs(det) < 1e-12) return false
  const t = ((w.ax - x) * wy - (w.ay - y) * wx) / det
  const u = ((w.ax - x) * dy - (w.ay - y) * dx) / det
  return t >= 0 && t <= 1 && u >= 0 && u <= 1
}

/** Swept body clearance: checking only the destination lets a shove tunnel through a rail. */
export function rampMoveClear(walls: readonly RampWall[], x: number, y: number, nx: number, ny: number, floorZ: number): boolean {
  for (const w of walls) {
    if (floorZ < w.z0 || floorZ > w.z1) continue
    const inside = (x - w.ax) * w.inwardX + (y - w.ay) * w.inwardY >= 0
    const radius = inside ? RAMP_BODY_RADIUS : RAMP_OUTSIDE_CLEARANCE
    if (Math.max(x, nx) < Math.min(w.ax, w.bx) - radius || Math.min(x, nx) > Math.max(w.ax, w.bx) + radius ||
        Math.max(y, ny) < Math.min(w.ay, w.by) - radius || Math.min(y, ny) > Math.max(w.ay, w.by) + radius) continue
    if (crosses(x, y, nx, ny, w)) return false
    const before = pointDistance2(x, y, w.ax, w.ay, w.bx, w.by)
    const after = pointDistance2(nx, ny, w.ax, w.ay, w.bx, w.by)
    // A previously crowded/restored body may retreat out of contact, never deeper in.
    if (before < radius * radius - 1e-9) {
      if (after < before - 1e-9) return false
      continue
    }
    const swept = Math.min(before, after,
      pointDistance2(w.ax, w.ay, x, y, nx, ny), pointDistance2(w.bx, w.by, x, y, nx, ny))
    if (swept < radius * radius - 1e-9) return false
  }
  return true
}
