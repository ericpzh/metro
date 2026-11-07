import { shapeOf, triangleSlopeFace, wallShapeBounds, type Cell, type CellShape, type Face } from './types.ts'

const neighbours: ReadonlyArray<[Face, number, number, number]> = [
  ['e', 1, 0, 0], ['w', -1, 0, 0], ['n', 0, 1, 0],
  ['s', 0, -1, 0], ['top', 0, 0, 1], ['bottom', 0, 0, -1],
]
const key = (x: number, y: number, z: number) => `${x},${y},${z}`
type Point = [number, number, number]

/** A convex piece contains this point in its own unit cell. */
function contains(shape: CellShape | null, [x, y, z]: Point): boolean {
  if (!shape) return true
  if (shape.kind !== 'triangle') {
    const b = wallShapeBounds(shape)!
    return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1
  }
  const height = shape.side === 'n' ? y : shape.side === 's' ? 1 - y : shape.side === 'e' ? x : 1 - x
  return shape.triangle === 'upper' ? z <= height : z >= 1 - height
}

/** Vertices of the piece's actual face on the cell boundary; inset/slope faces have none. */
function boundaryFace(shape: CellShape | null, face: Face): Point[] {
  if (shape?.kind === 'triangle' && triangleSlopeFace(shape.triangle) === face) return []
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
  const direction = neighbours.find(([name]) => name === face)!
  const [, dx, dy, dz] = direction
  const points = boundaryFace(shape, face)
  return points.length > 0 && points.every(([x, y, z]) => contains(neighbour, [x - dx, y - dy, z - dz]))
}

/** Clear wholly covered solid faces; suspended ceilings retain finishes on both sides. */
export function clearContactFinishes(cells: Cell[]): Cell[] {
  const solids = new Map<string, CellShape | null>()
  for (const c of cells) if (c.fill === 'solid' && !c.tags?.includes('suspended-ceiling')) solids.set(key(c.x, c.y, c.z), shapeOf(c))
  let changed = false
  const result = cells.map(c => {
    if (c.fill !== 'solid' || !c.finish || c.tags?.includes('suspended-ceiling')) return c
    const shape = shapeOf(c)
    let finish = c.finish
    for (const [face, dx, dy, dz] of neighbours) {
      if (finish[face] === undefined) continue
      const neighbourKey = key(c.x + dx, c.y + dy, c.z + dz)
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
