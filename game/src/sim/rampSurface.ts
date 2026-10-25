// Shared physical dimensions. Depths are vertical, not normal to the incline.
/** Escalator underside below its walking line, measured vertically. */
export const RAMP_FOOT = 0.5
/** Stair stringer and soffit underside below the trimmed tread line. */
export const STAIR_BODY_DROP = 0.36
export const ESCALATOR_TRUSS_DEPTH = 0.34

/** Normal offset that puts the rotated box's bottom on walkHeight − RAMP_FOOT. */
export function escalatorTrussOffset(horizontalCosine: number): number {
  return RAMP_FOOT * horizontalCosine - ESCALATOR_TRUSS_DEPTH / 2
}

/** A clipped underside plane, in cell-local coordinates. Bounds are half-open. */
export interface RampSurfacePatch {
  axis: 'x' | 'y'
  lo: number
  hi: number
  base?: number
  x0: number
  x1: number
  y0: number
  y1: number
}

/** Whether an underside cut leaves any block volume, rather than only a face.
 * Subtract each patch's footprint where its plane is at/below the cell floor.
 * Keeping separate polygons also handles partial footprints and crossing runs.
 */
export function rampSurfaceRetainsVolume(patches: readonly RampSurfacePatch[]): boolean {
  type Point = { x: number; y: number }
  type Plane = (p: Point) => number
  const clip = (poly: Point[], plane: Plane, sign: number): Point[] => {
    const out: Point[] = []
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length]
      const va = sign * plane(a), vb = sign * plane(b)
      if (va >= 0) out.push(a)
      if ((va > 0 && vb < 0) || (va < 0 && vb > 0)) {
        const t = va / (va - vb)
        out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) })
      }
    }
    return out
  }
  const hasArea = (poly: Point[]): boolean => {
    let twiceArea = 0
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length]
      twiceArea += a.x * b.y - a.y * b.x
    }
    return Math.abs(twiceArea) > 1e-10
  }
  let pieces = [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]]
  for (const p of patches) {
    if (p.base !== undefined && p.base > 0) continue
    const planes: Plane[] = [q => q.x - p.x0, q => p.x1 - q.x, q => q.y - p.y0, q => p.y1 - q.y,
      q => -(p.lo + (p.hi - p.lo) * (p.axis === 'x' ? q.x : q.y))]
    const kept: Point[][] = []
    for (const poly of pieces) {
      let inside = poly
      for (const plane of planes) {
        const outside = clip(inside, plane, -1)
        if (inside.some(q => plane(q) < -1e-10) && hasArea(outside)) kept.push(outside)
        inside = clip(inside, plane, 1)
        if (!hasArea(inside)) break
      }
    }
    pieces = kept
    if (pieces.length === 0) return false
  }
  return pieces.length > 0
}
