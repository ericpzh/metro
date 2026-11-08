import {
  cutInnerFaces,
  cutRectangles,
  halfCornerMask,
  packKey,
  shapeOf,
  triangleSlopeFace,
  wallShapeBounds,
  type Cell,
  type CellShape,
  type Face,
} from './types.ts'

const neighbours: ReadonlyArray<[Face, number, number, number]> = [
  ['e', 1, 0, 0], ['w', -1, 0, 0], ['n', 0, 1, 0],
  ['s', 0, -1, 0], ['top', 0, 0, 1], ['bottom', 0, 0, -1],
]
const key = (x: number, y: number, z: number) => `${x},${y},${z}`
type Point = [number, number, number]

/** A convex piece contains this point in its own unit cell. */
function contains(shape: CellShape | null, [x, y, z]: Point): boolean {
  if (!shape) return true
  if (shape.kind === 'triangle') {
    const height = shape.side === 'n' ? y : shape.side === 's' ? 1 - y : shape.side === 'e' ? x : 1 - x
    return shape.triangle === 'upper' ? z <= height : z >= 1 - height
  }
  if (shape.kind === 'cuts') {
    if (z < -1e-9 || z > 1 + 1e-9 || x < -1e-9 || x > 1 + 1e-9 || y < -1e-9 || y > 1 + 1e-9) return false
    // A cut fills whole quarters; a point on a quarter line belongs to either side.
    const side = y >= 0.5 ? (x >= 0.5 ? 'e' : 'n') : (x >= 0.5 ? 's' : 'w')
    return (shape.mask & halfCornerMask(side)) !== 0
  }
  const b = wallShapeBounds(shape)!
  return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1
}

/** The corners of every quarter a compound cut presents on one cell boundary. */
function cutBoundaryFace(mask: number, face: Face): Point[] {
  const points: Point[] = []
  const push = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void => {
    for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) points.push([x, y, z])
  }
  for (const r of cutRectangles(mask)) {
    if (face === 'top' || face === 'bottom') {
      const z = face === 'top' ? 1 : 0
      push(r.x0, r.x1, r.y0, r.y1, z, z)
    } else if (face === 'n' && r.y1 === 1) push(r.x0, r.x1, 1, 1, 0, 1)
    else if (face === 's' && r.y0 === 0) push(r.x0, r.x1, 0, 0, 0, 1)
    else if (face === 'e' && r.x1 === 1) push(1, 1, r.y0, r.y1, 0, 1)
    else if (face === 'w' && r.x0 === 0) push(0, 0, r.y0, r.y1, 0, 1)
  }
  return points
}

/** Vertices of the piece's actual face on the cell boundary; inset/slope faces have none. */
function boundaryFace(shape: CellShape | null, face: Face): Point[] {
  if (shape?.kind === 'triangle' && triangleSlopeFace(shape.triangle) === face) return []
  if (shape?.kind === 'cuts') return cutBoundaryFace(shape.mask, face)
  const b = wallShapeBounds(shape) ?? { x0: 0, x1: 1, y0: 0, y1: 1 }
  if ((face === 'e' && b.x1 < 1) || (face === 'w' && b.x0 > 0) ||
      (face === 'n' && b.y1 < 1) || (face === 's' && b.y0 > 0)) return []
  const xs = face === 'e' ? [1] : face === 'w' ? [0] : [b.x0, b.x1]
  const ys = face === 'n' ? [1] : face === 's' ? [0] : [b.y0, b.y1]
  const zs = face === 'top' ? [1] : face === 'bottom' ? [0] : [0, 1]
  const points: Point[] = []
  for (const x of xs) for (const y of ys) for (const z of zs) {
    const point: Point = [x, y, z]
    if (contains(shape, point)) points.push(point)
  }
  // A wedge's zero-area edge is not a paintable face.
  return points.length >= 3 ? points : []
}

/** Whether the adjacent convex block covers the whole boundary face. */
export function contactFaceCovered(shape: CellShape | null, neighbour: CellShape | null, face: Face): boolean {
  // A compound cut may paint an inner half-cell face in the same slot as its
  // boundary face. That inner surface is never covered by the neighbour, so the
  // slot's finish must survive even when the boundary part is fully hidden.
  if (shape?.kind === 'cuts' && cutInnerFaces(shape.mask).includes(face)) return false
  const direction = neighbours.find(([name]) => name === face)!
  const [, dx, dy, dz] = direction
  const points = boundaryFace(shape, face)
  return points.length > 0 && points.every(([x, y, z]) => contains(neighbour, [x - dx, y - dy, z - dz]))
}

/** Clear wholly covered solid faces; suspended ceilings retain finishes on both sides. */
export function clearContactFinishes(cells: Cell[]): Cell[] {
  // Leave one course for neighbour probes. Imported coordinates outside the
  // packed grid still need exact, non-aliasing keys.
  const packable = (n: number): boolean => Number.isInteger(n) && n >= -4095 && n <= 4094
  const keyOf = cells.every(c => packable(c.x) && packable(c.y) && packable(c.z)) ? packKey : key
  const solids = new Map<number | string, CellShape | null>()
  for (const c of cells) if (c.fill === 'solid' && !c.tags?.includes('suspended-ceiling')) solids.set(keyOf(c.x, c.y, c.z), shapeOf(c))
  let changed = false
  const result = cells.map(c => {
    if (c.fill !== 'solid' || !c.finish || c.tags?.includes('suspended-ceiling')) return c
    const shape = shapeOf(c)
    let finish = c.finish
    for (const [face, dx, dy, dz] of neighbours) {
      if (finish[face] === undefined) continue
      const neighbourKey = keyOf(c.x + dx, c.y + dy, c.z + dz)
      if (!solids.has(neighbourKey)) continue
      if (!contactFaceCovered(shape, solids.get(neighbourKey)!, face)) continue
      if (finish === c.finish) finish = { ...finish }
      delete finish[face]
    }
    if (finish === c.finish) return c
    changed = true
    if (Object.keys(finish).length) return { ...c, finish }
    const { finish: _removed, ...withoutFinish } = c
    return withoutFinish
  })
  return changed ? result : cells
}
