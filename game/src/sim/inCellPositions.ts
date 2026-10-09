/** Plan order: centre, then the surrounding 3×3 spots in reading order (+y is up). */
export const IN_CELL_POSITIONS = [
  [0, 0], [-1, 1], [0, 1], [1, 1], [-1, 0], [1, 0], [-1, -1], [0, -1], [1, -1],
] as const

export function inCellOffset(position: number, width: number, depth = width): { x: number; y: number } {
  const [x, y] = IN_CELL_POSITIONS[((position % 9) + 9) % 9]
  return { x: x * (1 - width) / 2, y: y * (1 - depth) / 2 }
}
