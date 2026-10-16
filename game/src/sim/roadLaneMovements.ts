// Lane permissions shared by routing and painted arrows (§4.1).
export type RoadTurn = 'left' | 'straight' | 'right'

/** Index is counted from the driver's left. An odd T approach shares its middle
 * lane, keeping both halves usable; a sole lane can carry every legal movement. */
export function roadLaneMovements(index: number, count: number, available: readonly RoadTurn[]): RoadTurn[] {
  const through = available.includes('straight')
  const split = !through && available.includes('left') && available.includes('right')
  return available.filter(turn => {
    if (turn === 'straight') return true
    if (split) return turn === 'left' ? index < Math.ceil(count / 2) : index >= Math.floor(count / 2)
    if (!through) return true
    return turn === 'left' ? index === 0 : index === count - 1
  })
}

export function roadTurn(inAxis: boolean, inSign: number, outAxis: boolean, outSign: number): RoadTurn | null {
  if (inAxis === outAxis) return inSign === outSign ? 'straight' : null
  const cross = (inAxis ? -1 : 1) * inSign * outSign
  return cross > 0 ? 'left' : 'right'
}

/** Increasing lane coordinates run rightward for +Y and leftward for +X. */
export function roadDriverLaneOrder(axis: boolean, sign: number): number {
  return (axis ? 1 : -1) * sign
}
