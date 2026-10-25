import type { SlopeCut } from '../sim/openings.ts'

export interface SurfacePoint { x: number; y: number }
interface Plane { x: number; y: number; c: number }
export interface SurfaceRegion { polygon: SurfacePoint[]; height: (x: number, y: number) => number }
const EPS = 1e-9

function value(p: Plane, q: SurfacePoint): number { return p.x * q.x + p.y * q.y + p.c }

function clip(poly: SurfacePoint[], plane: Plane, sign: number): SurfacePoint[] {
  const out: SurfacePoint[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    const va = sign * value(plane, a), vb = sign * value(plane, b)
    if (va >= -EPS) out.push(a)
    if ((va > EPS && vb < -EPS) || (va < -EPS && vb > EPS)) {
      const t = va / (va - vb)
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    }
  }
  return out
}

/** Split at every footprint, clamp and plane intersection before triangulating.
 * Each resulting region is planar; no triangle can chord across a bend or gap.
 */
export function rampSurfaceRegions(outline: SurfacePoint[], cut: SlopeCut, partitions: SlopeCut[] = []): SurfaceRegion[] {
  const patches = cut.patches ?? [{ ...cut, x0: 0, x1: 1, y0: 0, y1: 1 }]
  const planes: Plane[] = [{ x: 0, y: 0, c: 0 }, { x: 0, y: 0, c: 1 }]
  const boundaries: Plane[] = []
  for (const p of [...patches, ...partitions.flatMap(c => c.patches ?? [{ ...c, x0: 0, x1: 1, y0: 0, y1: 1 }])]) {
    planes.push({ x: p.axis === 'x' ? p.hi - p.lo : 0, y: p.axis === 'y' ? p.hi - p.lo : 0, c: p.lo })
    if (p.base !== undefined) planes.push({ x: 0, y: 0, c: p.base })
    boundaries.push({ x: 1, y: 0, c: -p.x0 }, { x: 1, y: 0, c: -p.x1 }, { x: 0, y: 1, c: -p.y0 }, { x: 0, y: 1, c: -p.y1 })
  }
  for (let i = 0; i < planes.length; i++) for (let j = 0; j < i; j++) {
    boundaries.push({ x: planes[i].x - planes[j].x, y: planes[i].y - planes[j].y, c: planes[i].c - planes[j].c })
  }
  let polygons = [outline]
  for (const plane of boundaries) {
    polygons = polygons.flatMap((poly) => {
      const values = poly.map((p) => value(plane, p))
      return Math.min(...values) < -EPS && Math.max(...values) > EPS
        ? [clip(poly, plane, 1), clip(poly, plane, -1)] : [poly]
    })
  }
  return polygons.map((polygon) => {
    const cx = polygon.reduce((n, p) => n + p.x, 0) / polygon.length
    const cy = polygon.reduce((n, p) => n + p.y, 0) / polygon.length
    let selected: Plane = { x: 0, y: 0, c: 1 }
    for (const p of patches) {
      if (cx < p.x0 - EPS || cx > p.x1 + EPS || cy < p.y0 - EPS || cy > p.y1 + EPS) continue
      let candidate: Plane = { x: p.axis === 'x' ? p.hi - p.lo : 0, y: p.axis === 'y' ? p.hi - p.lo : 0, c: p.lo }
      if (p.base !== undefined && value(candidate, { x: cx, y: cy }) < p.base) candidate = { x: 0, y: 0, c: p.base }
      if (value(candidate, { x: cx, y: cy }) < value(selected, { x: cx, y: cy })) selected = candidate
    }
    if (value(selected, { x: cx, y: cy }) < 0) selected = { x: 0, y: 0, c: 0 }
    const plane = selected
    return { polygon, height: (x: number, y: number): number => Math.max(0, Math.min(1, plane.x * x + plane.y * y + plane.c)) }
  })
}

/** Height on the other side of an internal footprint edge. */
export function rampSurfaceHeight(cut: SlopeCut, x: number, y: number): number {
  let h = 1
  for (const p of cut.patches ?? [{ ...cut, x0: 0, x1: 1, y0: 0, y1: 1 }]) {
    if (x < p.x0 || x > p.x1 || y < p.y0 || y > p.y1) continue
    h = Math.min(h, Math.max(p.base ?? -Infinity, p.lo + (p.hi - p.lo) * (p.axis === 'x' ? x : y)))
  }
  return Math.max(0, h)
}
