import { STAIR_AVOID_S, WALK_SPEED } from './constants.ts'
import { EDGE_KIND, gateApproach, liftPenalty, queueWait, type PathFinder, type RouteSearch, type StationGraph } from './station.ts'

export interface WasmRouter {
  search(start: number, goal: number, stepFree: boolean, liftPenalty: number,
    congestion: Float32Array, waits: Float64Array, gates: Float64Array): number
  route(): Int32Array
  free(): void
}

export type WasmRouterConstructor = new (
  starts: Int32Array, destinations: Int32Array, costs: Float32Array, kinds: Uint8Array,
  edgeServers: Int32Array, nodeServers: Int32Array, gateDirections: Int8Array,
  x: Float32Array, y: Float32Array, z: Float32Array,
  walkSpeed: number, stairPenalty: number, escalator: number, stair: number, lift: number,
) => WasmRouter

export class WasmRouting {
  private graph: StationGraph | undefined
  private router: WasmRouter | undefined
  private waits = new Float64Array()
  private gates = new Float64Array()
  private readonly noGates = new Float64Array()

  constructor(Router: WasmRouterConstructor) {
    this.Router = Router
  }

  private readonly Router: WasmRouterConstructor

  install(graph: StationGraph): void {
    if (this.graph === graph) return
    this.dispose()
    const nodeServers = new Int32Array(graph.nodeCount).fill(-1)
    for (const [node, server] of graph.serverForNode) nodeServers[node] = server

    const directions = new Int8Array(graph.adjTo.length).fill(2)
    for (let from = 0; from < graph.nodeCount; from++) {
      for (let edge = graph.adjStart[from]; edge < graph.adjStart[from + 1]; edge++) {
        const to = graph.adjTo[edge]
        if (graph.servers[nodeServers[to]]?.kind === 'gate') directions[edge] = gateApproach(graph, from, to)
      }
    }
    this.waits = new Float64Array(graph.servers.length)
    this.gates = new Float64Array(graph.servers.length * 3)
    this.router = new this.Router(
      graph.adjStart, graph.adjTo, graph.adjCost, graph.adjKind, graph.adjServer, nodeServers, directions,
      graph.nodeX, graph.nodeY, graph.nodeZ, WALK_SPEED, STAIR_AVOID_S,
      EDGE_KIND.escalator, EDGE_KIND.stair, EDGE_KIND.lift,
    )
    this.graph = graph
  }

  dispose(): void {
    const router = this.router
    this.router = undefined
    this.graph = undefined
    router?.free()
  }

  search: RouteSearch = (path: PathFinder, start, goal, needs) => {
    const router = this.router
    if (!router || path.graph !== this.graph) throw new Error('WASM routing graph is stale')
    const { servers, nodeCount } = path.graph
    for (let i = 0; i < servers.length; i++) {
      const server = servers[i]
      this.waits[i] = queueWait(server)
      if (path.gateWait && server.kind === 'gate') {
        this.gates[i * 3] = path.gateWait(server, -1)
        this.gates[i * 3 + 1] = path.gateWait(server, 0)
        this.gates[i * 3 + 2] = path.gateWait(server, 1)
      }
    }
    const status = router.search(start, goal, needs.stepFree, liftPenalty(needs),
      path.congestion, this.waits, path.gateWait ? this.gates : this.noGates)
    if (!Number.isInteger(status) || status < 0 || status > nodeCount) throw new Error('Invalid WASM route status')
    if (status === 0) return null
    // wasm-bindgen copies the returned vector into JS-owned storage after the call.
    const route = router.route()
    if (!(route instanceof Int32Array) || route.length !== status ||
      route[0] !== start || route[status - 1] !== goal || route.some(node => node < 0 || node >= nodeCount)) {
      throw new Error('Invalid WASM route')
    }
    return route
  }
}
