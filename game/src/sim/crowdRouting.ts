// Local walking choices (§7.2–7.3): keep the itinerary and service choices,
// but let a committed walker step around a crowd that formed after planning.
import type { Needs } from './agents.ts'
import { CONGESTION_S, CROWD_LOOKAHEAD, CROWD_REPLAN_MIN_BODIES, CROWD_ROUTE_GAIN_S } from './constants.ts'
import { EDGE_KIND, type PathFinder } from './station.ts'

/** Cost only uninterrupted floor walking; services remain their owner's decision. */
function walkCost(finder: PathFinder, route: Int32Array): number {
  const g = finder.graph
  let cost = 0
  for (let i = 0; i < route.length; i++) {
    if (g.serverForNode.has(route[i])) return Infinity
    if (i === 0) continue
    const from = route[i - 1], to = route[i]
    let edge = -1
    for (let e = g.adjStart[from]; e < g.adjStart[from + 1]; e++) {
      if (g.adjTo[e] === to && g.adjKind[e] === EDGE_KIND.walk) { edge = e; break }
    }
    if (edge < 0) return Infinity
    cost += g.adjCost[edge] + finder.congestion[to]
  }
  return cost
}

/** Find a nearby rejoin point without crossing a queue, ramp or fare gate. */
export function crowdedWalkEnd(finder: PathFinder, route: Int32Array, start: number): number {
  const g = finder.graph
  let distance = 0, crowded = false, end = start
  if (g.serverForNode.has(route[start])) return start
  for (let i = start + 1; i < route.length; i++) {
    const from = route[i - 1], to = route[i]
    if (g.serverForNode.has(to) || g.nodeZ[to] !== g.nodeZ[from]) break
    // A same-height edge can still be a service edge: check the real graph.
    if (!Number.isFinite(walkCost(finder, route.subarray(i - 1, i + 1)))) break
    distance += Math.hypot(g.nodeX[to] - g.nodeX[from], g.nodeY[to] - g.nodeY[from])
    if (distance > CROWD_LOOKAHEAD) break
    end = i
    if (finder.congestion[to] >= CROWD_REPLAN_MIN_BODIES * CONGESTION_S) crowded = true
  }
  return crowded ? end : start
}

/** Called on a ration, at a reached waypoint; never mutate shared cached paths. */
export function spreadWalkRoute(finder: PathFinder, route: Int32Array, start: number, end: number, needs: Needs): Int32Array | null {
  const candidate = finder.search(route[start], route[end], needs)
  if (!candidate || walkCost(finder, candidate) + CROWD_ROUTE_GAIN_S >= walkCost(finder, route.subarray(start, end + 1))) return null
  const result = new Int32Array(candidate.length + route.length - end - 1)
  result.set(candidate)
  result.set(route.subarray(end + 1), candidate.length)
  return result
}
