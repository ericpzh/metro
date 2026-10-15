// Fine corridor steering (§7.2): a shared coarse route is a corridor, not a
// single-file instruction. All lateral moves still traverse legal graph edges.
import { WALK_LANE_EDGE_INSET, WALK_LANE_REACH, WALK_LANE_FAN_SLOPE, WALK_SEGMENT_SAMPLE, PLATFORM_WAIT_RADIUS } from './constants.ts'
import { cellKey, EDGE_KIND, type StationGraph } from './station.ts'

function floorEdge(g: StationGraph, from: number, to: number): boolean {
  if (g.nodeZ[from] !== g.nodeZ[to] || g.nodeZone[from] !== g.nodeZone[to]) return false
  for (let e = g.adjStart[from]; e < g.adjStart[from + 1]; e++) {
    if (g.adjTo[e] === to && g.adjKind[e] === EDGE_KIND.walk && g.adjServer[e] < 0) return true
  }
  return false
}

/** Check the whole segment, including diagonal corner/fare/rail restrictions. */
export function clearWalkSegment(g: StationGraph, x: number, y: number, tx: number, ty: number, z: number): boolean {
  let from = g.nodeIndex.get(cellKey(Math.floor(x), Math.floor(y), Math.round(z) - 1))
  if (from === undefined) return false
  const steps = Math.max(1, Math.ceil(Math.hypot(tx - x, ty - y) / WALK_SEGMENT_SAMPLE))
  for (let i = 1; i <= steps; i++) {
    const to = g.nodeIndex.get(cellKey(Math.floor(x + (tx - x) * i / steps), Math.floor(y + (ty - y) * i / steps), Math.round(z) - 1))
    if (to === undefined) return false
    if (from !== to && (!floorEdge(g, from, to) || g.serverForNode.has(to))) return false
    from = to
  }
  return true
}

function laneFraction(id: number): number {
  return WALK_LANE_EDGE_INSET + ((id * 0.6180339887498949) % 1) * (1 - 2 * WALK_LANE_EDGE_INSET)
}

/** Return a real floor node across the route's width, keeping a stable lane. */
export function walkingLaneNode(g: StationGraph, route: Int32Array, index: number, id: number): number {
  const node = route[index]
  // Service approaches must converge on the actual entrance/landing. In particular
  // don't drift sideways across a ramp's body or change an upcoming gate approach.
  for (let i = Math.max(0, index - 1); i <= Math.min(route.length - 1, index + 2); i++) {
    if (g.serverForNode.has(route[i]) || g.nodeZ[route[i]] !== g.nodeZ[node]) return node
    if (i > 0 && !floorEdge(g, route[i - 1], route[i])) return node
  }
  if (index === route.length - 1) return node
  const next = route[index + 1]
  const dx = g.nodeX[next] - g.nodeX[node], dy = g.nodeY[next] - g.nodeY[node]
  if (index > 0) {
    const prev = route[index - 1]
    if (Math.abs((g.nodeX[node] - g.nodeX[prev]) * dy - (g.nodeY[node] - g.nodeY[prev]) * dx) > 0.01) return node
  }
  // Use world axes for the cross-section so opposite traffic keeps its lane.
  const sx = Math.abs(dy) > Math.abs(dx) ? 1 : 0, sy = sx === 0 ? 1 : 0
  const x = Math.floor(g.nodeX[node]), y = Math.floor(g.nodeY[node]), z = Math.round(g.nodeZ[node]) - 1
  let lo = 0, hi = 0
  for (const sign of [-1, 1]) {
    let prev = node
    for (let d = 1; d <= WALK_LANE_REACH; d++) {
      const n = g.nodeIndex.get(cellKey(x + sx * d * sign, y + sy * d * sign, z))
      if (n === undefined || g.serverForNode.has(n) || !floorEdge(g, prev, n)) break
      if (sign < 0) lo = -d
      else hi = d
      prev = n
    }
  }
  // Fan out gradually after an entrance and funnel back before a turn, endpoint
  // or service. A full-width sideways step at a short landing would stall it.
  let taper = Math.min(index, route.length - 1 - index) * WALK_LANE_FAN_SLOPE
  for (let i = index + 1; i < route.length && i <= index + WALK_LANE_REACH; i++) {
    const n = route[i], p = route[i - 1]
    const cross = (g.nodeX[n] - g.nodeX[p]) * dy - (g.nodeY[n] - g.nodeY[p]) * dx
    if (g.serverForNode.has(n) || !floorEdge(g, p, n) || Math.abs(cross) > 0.01) {
      taper = Math.min(taper, Math.max(0, i - index - 1) * WALK_LANE_FAN_SLOPE)
      break
    }
  }
  const offset = Math.round(Math.max(-taper, Math.min(taper, lo + laneFraction(id) * (hi - lo))))
  return g.nodeIndex.get(cellKey(x + sx * offset, y + sy * offset, z)) ?? node
}

/** Connected waiting floor local to a doorway; never cross a wall, fare line or ramp. */
export function platformWaitingNodes(g: StationGraph, door: number): Int32Array {
  const queue = [door], seen = new Set(queue)
  for (let i = 0; i < queue.length; i++) {
    const from = queue[i]
    for (let e = g.adjStart[from]; e < g.adjStart[from + 1]; e++) {
      const to = g.adjTo[e]
      if (seen.has(to) || g.serverForNode.has(to) || !floorEdge(g, from, to)) continue
      if (Math.hypot(g.nodeX[to] - g.nodeX[door], g.nodeY[to] - g.nodeY[door]) > PLATFORM_WAIT_RADIUS) continue
      // A waiting passenger must be able to walk directly to the doorway.
      if (!clearWalkSegment(g, g.nodeX[door], g.nodeY[door], g.nodeX[to], g.nodeY[to], g.nodeZ[door])) continue
      seen.add(to)
      queue.push(to)
    }
  }
  // Keep the entrance clear; waiting positions occupy the connected floor behind it.
  return Int32Array.from(queue.slice(1).sort((a, b) =>
    Math.hypot(g.nodeX[a] - g.nodeX[door], g.nodeY[a] - g.nodeY[door]) -
    Math.hypot(g.nodeX[b] - g.nodeX[door], g.nodeY[b] - g.nodeY[door]) || a - b))
}
