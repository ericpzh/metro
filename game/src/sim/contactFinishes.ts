import { shapeOf, type Cell, type Face } from './types.ts'

const neighbours: ReadonlyArray<[Face, number, number, number]> = [
  ['e', 1, 0, 0], ['w', -1, 0, 0], ['n', 0, 1, 0],
  ['s', 0, -1, 0], ['top', 0, 0, 1], ['bottom', 0, 0, -1],
]
const key = (x: number, y: number, z: number) => `${x},${y},${z}`

/** Remove authored finishes from faces completely covered by another full block. */
export function clearContactFinishes(cells: Cell[]): Cell[] {
  const full = new Set<string>()
  for (const c of cells) if (c.fill === 'solid' && !shapeOf(c)) full.add(key(c.x, c.y, c.z))
  let changed = false
  const result = cells.map(c => {
    if (c.fill !== 'solid' || !c.finish || shapeOf(c)) return c
    let finish = c.finish
    for (const [face, dx, dy, dz] of neighbours) {
      if (finish[face] === undefined || !full.has(key(c.x + dx, c.y + dy, c.z + dz))) continue
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
