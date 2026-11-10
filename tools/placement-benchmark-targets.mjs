// Keep the benchmark's authored targets even when the visible grid gains cells.
export function selectPlacementTargets(points, expected, count) {
  if (!expected) throw new Error('Demo/camera placement targets changed; review the pinned interior/ground-edge workload')
  const key = cell => JSON.stringify(cell)
  const pinned = expected.slice(0, Math.min(count, 5)).map(cell => points.find(point => key(point.cell) === key(cell)))
  if (pinned.some(point => !point)) throw new Error('Demo/camera placement targets changed; review the pinned interior/ground-edge workload')
  const pinnedKeys = new Set(pinned.map(point => key(point.cell)))
  return [...pinned, ...points.filter(point => !pinnedKeys.has(key(point.cell)))]
}
