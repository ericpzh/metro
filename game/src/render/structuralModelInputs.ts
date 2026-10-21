// Geometry dependencies shared with the production builders (§5.1, §5.4, §5.7).
// Compare derived inputs, rather than invalidating an entire equipment family.
import type { Module, StationData } from '../sim/types.ts'
import { thirdRailSide } from '../sim/track.ts'
import { pillarSupportsBridge } from '../sim/structures.ts'
import { hangerCells, hangerRoofZ } from '../sim/hangers.ts'
import { ceilingMountHeight, outdoorSurfaceHidden, moduleEnvelope } from '../sim/placement.ts'
import { neighboringGantryPosts } from './models/pieces/TrackGantry.ts'
import { roadInkIntervals, roadLayout } from '../sim/roads.ts'
import { getRoadNetwork, roadEdgeMovements, roadJunctionSides } from '../sim/roadNetwork.ts'
import { ROAD_CROSSWALK_DEPTH } from '../sim/constants.ts'

export function trackModelInputs(data: StationData, mod: Extract<Module, { type: 'track' }>): unknown {
  const edges = data.modules.filter(m => m.type === 'platform-edge')
  const line = data.lines.find(l => l.id === mod.cfg.line)
  return [thirdRailSide(mod, edges, line?.direction), mod.cfg.bridge
    ? neighboringGantryPosts(mod, data.modules.filter(m => m.type === 'track'), edges, data.lines) : []]
}

export function pillarModelInputs(data: StationData, mod: Module): unknown {
  return data.modules.find(m => pillarSupportsBridge(mod, m))?.z
}

export function hangerModelInputs(data: StationData, mod: Extract<Module, { type: 'hanger' }>): unknown {
  const run = hangerCells(mod)
  return [run[0]!, run[run.length - 1]!].map(([x, y]) => hangerRoofZ(data.cells, data.modules, mod, x, y))
}

export function ceilingModelInputs(data: StationData, mod: Module): unknown {
  return ceilingMountHeight(data.cells, mod, data.modules)
}

export function surfaceModelInputs(data: StationData, mod: Module): unknown {
  return outdoorSurfaceHidden(data.cells, data.modules, mod)
}

/** Opening readers are column-local. Keep a conservative margin for walls,
 * landing pads and adjacent stair lanes, and intentionally ignore elevation. */
export function nearbyOpening(a: Module, b: Module): boolean {
  const aa = moduleEnvelope(a), bb = moduleEnvelope(b)
  if (!aa || !bb) return true
  return aa.x0 <= bb.x1 + 3 && aa.x1 >= bb.x0 - 3 && aa.y0 <= bb.y1 + 3 && aa.y1 >= bb.y0 - 3
}

export function roadModelInputs(data: StationData, mod: Extract<Module, { type: 'road' }>): unknown {
  const { width, lanes, laneWidth } = roadLayout(mod)
  const across = [.16, width - .16]
  for (let lane = 1; lane < lanes; lane++) {
    if (mod.cfg.direction === 'two-way' && lane === lanes / 2) across.push(width / 2 - .13, width / 2 + .13)
    else across.push(lane * laneWidth)
  }
  const network = getRoadNetwork(data.modules)
  return [across.map(x => roadInkIntervals(mod, data.modules, x, ROAD_CROSSWALK_DEPTH + 1.5)),
    roadJunctionSides(network).filter(s => s.road === mod.id).map(({ junction, ...side }) => [side, network.junctions[junction]]),
    network.edges.filter(e => e.road.id === mod.id && e.junction < 0).map(e => {
      const connector = e.next.map(n => network.edges[n]).find(n => n.junction >= 0)
      return connector ? [e.lane, e.sign, e.axis, e.start, e.end, e.length,
        network.junctions[connector.junction], roadEdgeMovements(network, e)] : null
    })]
}
