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
import { stairFlights, stairFlightSlides, stairTreadWidth, stairWallSides, stairLandingWalls } from '../sim/stairs.ts'
import { DEFAULT_MATERIAL } from '../sim/finishes.ts'

const stairInputs = new WeakMap<StationData, Map<string, unknown>>()
/** Cell inputs read by StairModel and the stair side of RampJoinModel. Modules
 * are unchanged on this path, so endpoint, exit, lane and join ownership inputs
 * are already identical. Keep the same wall/landing predicates as the builders. */
export function rampCellModelInputs(data: StationData, mod: Module): unknown {
  if(mod.type==='escalator')return data.modules.filter(m=>m.type==='stair'&&nearbyOpening(mod,m)).map(m=>[m.id,rampCellModelInputs(data,m)])
  if(mod.type!=='stair'||mod.cfg.block)return null
  let cached=stairInputs.get(data)
  if(!cached)stairInputs.set(data,cached=new Map())
  if(cached.has(mod.id))return cached.get(mod.id)
  const flights=stairFlights(mod),slides=stairFlightSlides(mod)
  const box=moduleEnvelope(mod)!
  let x0=box.x0,x1=box.x1,y0=box.y0,y1=box.y1
  for(const f of flights){x0=Math.min(x0,f.from.x,f.to.x);x1=Math.max(x1,f.from.x,f.to.x);y0=Math.min(y0,f.from.y,f.to.y);y1=Math.max(y1,f.from.y,f.to.y)}
  // These predicates probe only the flight/landing columns. Retain every
  // height, including shifted and turning flights, without constructing their
  // wall sets from an unrelated station's entire floor catalogue.
  const cells=data.cells.filter(c=>c.x>=x0-3&&c.x<=x1+3&&c.y>=y0-3&&c.y<=y1+3)
  const floor=cells.find(c=>c.x===mod.from.x&&c.y===mod.from.y&&c.z===mod.from.z)
  const result=[mod.cfg.finish??floor?.finish?.top??DEFAULT_MATERIAL,
    flights.map((f,i)=>stairWallSides(cells,f.from,f.to,stairTreadWidth(mod),slides[i])),
    flights.slice(1).map((_,i)=>stairLandingWalls(cells,mod,i))]
  cached.set(mod.id,result)
  return result
}

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
