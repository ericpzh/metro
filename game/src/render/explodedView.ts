import { STOREY_HEIGHT, storeyBand } from '../sim/constants.ts'
import type { Cell, Module, StationData } from '../sim/types.ts'
import { isWallBlock, packKey } from '../sim/types.ts'
import { moduleFootprint } from '../sim/placement.ts'
import { GROUND_Z } from '../sim/ground.ts'

const hiddenTypes = new Set(['roof', 'road', 'sidewalk', 'lawn', 'tree', 'traffic-light'])
const structureTypes = new Set(['exit', 'stair', 'escalator', 'walkway', 'lift', 'track', 'platform-edge', 'pillar', 'shop', 'retail', 'booth'])
const ceiling = (c: Cell): boolean => !!c.tags?.some(t => t === 'suspended-ceiling' || t === 'opening-ceiling')

/** A disposable presentation document. Never install this in the editor or worker. */
export function explodedView(data: StationData): { data: StationData; levels: number[]; offsets: ReadonlyMap<number, number>; direction: readonly [number, number] } {
  const base = data.levelBase ?? 0
  const band = (z: number): number => storeyBand(z, base, STOREY_HEIGHT)
  const solidKeys = new Set(data.cells.filter(c => c.fill === 'solid').map(c => packKey(c.x,c.y,c.z)))
  const floorUse = new Set(data.modules.filter(m => ['gate','tvm','vending','booth','shop','retail','platform-edge','track','bench'].includes(m.type)).map(m => m.z))
  const tunnelCaps = new Set(data.modules.filter(m => m.type === 'track' && m.cfg.tunnel).map(m => m.z + STOREY_HEIGHT))
  const landings = new Set<number>()
  for (const m of data.modules) if (m.type === 'stair' || m.type === 'escalator' || m.type === 'walkway' || m.type === 'lift') {
    for (const end of [m.from,m.to]) for (let x=-2;x<=2;x++) for(let y=-2;y<=2;y++) landings.add(packKey(end.x+x,end.y+y,end.z))
  }
  const solids = data.cells.filter(c => c.fill === 'solid' && !ceiling(c) &&
    // The street, including authored street plates, is hidden. A raised deck
    // at 1 m remains a station floor, not ground-level context.
    !(c.z === GROUND_Z && !solidKeys.has(packKey(c.x,c.y,c.z+1))) &&
    // Legacy tunnel caps share their plane with small intermediate landings.
    // Retain actual floor use/landings, rather than presenting the whole cap.
    !(c.z < GROUND_Z && tunnelCaps.has(c.z) && !floorUse.has(c.z) &&
      !solidKeys.has(packKey(c.x,c.y,c.z+1)) && !c.tags?.includes('auto-floor') &&
      !['paid','unpaid','platform'].includes(c.zone ?? '') && !landings.has(packKey(c.x,c.y,c.z))) &&
    // Earth-topped caps are terrain/room ceilings, not another usable floor.
    !(c.finish?.top === 'floor.soil' && !solidKeys.has(packKey(c.x,c.y,c.z+1))) &&
    // Legacy stations also have ordinary, untagged ceiling courses immediately
    // below the next floor. Keep the vertical enclosure, remove the horizontal cap.
    !(c.z === band(c.z) + STOREY_HEIGHT - 1 && !isWallBlock(c)))
  const modules = data.modules.filter(m => !hiddenTypes.has(m.type) &&
    (structureTypes.has(m.type) || m.z !== GROUND_Z))
  const modulePoints = new Map<number, Array<{ x: number; y: number }>>()
  for (const m of modules) {
    const points = modulePoints.get(band(m.z)) ?? []
    for (const [x, y] of moduleFootprint(m)) points.push({ x, y })
    modulePoints.set(band(m.z), points)
  }
  const byLevel = new Map<number, Cell[]>()
  for (const cell of solids) {
    const z = band(cell.z)
    const list = byLevel.get(z) ?? []
    list.push(cell)
    byLevel.set(z, list)
  }
  // A top slab without walls or equipment is the cap of the room below.
  const top = Math.max(...byLevel.keys())
  if (byLevel.size > 1 && !modules.some(m => band(m.z) === top) &&
    byLevel.get(top)?.every(c => c.z === top && c.tags?.some(t => t.startsWith('tunnel-shell:')))) byLevel.delete(top)
  for (const m of modules) if (!byLevel.has(band(m.z))) byLevel.set(band(m.z), [])
  const levels = [...byLevel.keys()].sort((a, b) => a - b)
  const floorsByLevel = new Map<number, Cell[]>()
  for (const z of levels) {
    const own = byLevel.get(z)!
    const surfaces = new Map<number, Cell[]>()
    for (const cell of own) {
      if (isWallBlock(cell) || cell.finish?.top?.startsWith('ceil.') ||
        solidKeys.has(packKey(cell.x,cell.y,cell.z+1))) continue
      const row = surfaces.get(cell.z) ?? []
      row.push(cell)
      surfaces.set(cell.z,row)
    }
    let floorCells: Cell[] = []
    for (const row of surfaces.values()) if(row.length > floorCells.length) floorCells = row
    floorsByLevel.set(z, floorCells.length ? floorCells : own.filter(c => c.z === z))
  }
  const offsets = new Map<number, number>()
  // Retain the station's longitudinal alignment. Explode across its narrow
  // axis, packing the actual floor tiles instead of their rectangular bounds.
  const solidFloors = [...floorsByLevel.values()].flat()
  const allPoints = solidFloors.length ? solidFloors : solids.length ? solids : [...modulePoints.values()].flat()
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const point of allPoints) {
    x0 = Math.min(x0, point.x); x1 = Math.max(x1, point.x)
    y0 = Math.min(y0, point.y); y1 = Math.max(y1, point.y)
  }
  const direction: readonly [number, number] = x1 - x0 >= y1 - y0 ? [0, 1] : [1, 0]
  const [dx, dy] = direction
  const occupied = new Set<string>()
  let previousOffset = 0, previousArea = 0, edge = -Infinity
  const cells: Cell[] = []
  for (const z of levels) {
    const own = byLevel.get(z)!
    const floorCells = floorsByLevel.get(z)!
    const floor = new Set(floorCells.map(c => `${c.x},${c.y}`))
    const floorKeys = new Set(floorCells.map(c => packKey(c.x,c.y,c.z)))
    const frontX = new Map<number, number>(), frontY = new Map<number, number>()
    let openMaxX = -Infinity, openMinY = Infinity
    for (const cell of floorCells) {
      // Find the room's open floor, excluding the whole thickness of wall bases.
      if (isWallBlock(cell) || solidKeys.has(packKey(cell.x,cell.y,cell.z+1))) continue
      frontX.set(cell.y, Math.max(frontX.get(cell.y) ?? -Infinity, cell.x))
      frontY.set(cell.x, Math.min(frontY.get(cell.x) ?? Infinity, cell.y))
      openMaxX = Math.max(openMaxX, cell.x)
      openMinY = Math.min(openMinY, cell.y)
    }
    // Equipment only stories (for example a rail deck) still have a real footprint.
    const points = floorCells.length ? floorCells : own.length ? own : modulePoints.get(z) ?? []
    const footprint = [...new Map(points.map(p => [`${p.x},${p.y}`, p])).values()]
    let offset = previousOffset
    if (occupied.size && footprint.length) {
      const allowedOverlap = Math.floor(Math.min(previousArea, footprint.length) * 0.15)
      let near = Infinity
      for (const point of footprint) near = Math.min(near, dx * point.x + dy * point.y)
      const stop = Math.max(offset, edge - near + 1)
      for (; offset <= stop; offset++) {
        let overlap = 0
        for (const point of footprint) {
          if (occupied.has(`${point.x + dx * offset},${point.y + dy * offset}`) && ++overlap > allowedOverlap) break
        }
        if (overlap <= allowedOverlap) break
      }
    }
    offsets.set(z, offset)
    for (const point of footprint) {
      occupied.add(`${point.x + dx * offset},${point.y + dy * offset}`)
      edge = Math.max(edge, dx * point.x + dy * point.y + offset)
    }
    previousOffset = offset
    previousArea = footprint.length
    for (const cell of own) {
      // The default isometric eye is +x/-y. Open those two perimeter sides,
      // retaining internal partitions and the far enclosure, including irregular plans.
      if (cell.z > z && !floorKeys.has(packKey(cell.x,cell.y,cell.z)) && (
        (frontX.has(cell.y) && cell.x > frontX.get(cell.y)!) ||
        (frontY.has(cell.x) && cell.y < frontY.get(cell.x)!) ||
        (frontX.size > 0 && !frontX.has(cell.y) && !frontY.has(cell.x) &&
          (cell.x > openMaxX || cell.y < openMinY)) ||
        (floor.has(`${cell.x},${cell.y}`) &&
          (!floor.has(`${cell.x + 1},${cell.y}`) || !floor.has(`${cell.x},${cell.y - 1}`)))
      )) continue
      cells.push({ ...cell, x: cell.x + dx * offset, y: cell.y + dy * offset })
    }
  }
  const pieces = modules.flatMap((m): Module[] => {
    if (m.type !== 'lift') return [m]
    const lo = Math.min(m.from.z, m.to.z), hi = Math.max(m.from.z, m.to.z)
    return levels.filter(z => z < hi && z + STOREY_HEIGHT > lo).map(z => {
      const from = Math.max(z, lo), to = Math.min(z + STOREY_HEIGHT, hi)
      return { ...m, id: `${m.id}:exploded:${z}`, z: from,
        from: { ...m.from, z: from }, to: { ...m.to, z: to },
        cfg: { ...m.cfg, rises: undefined } }
    })
  })
  const moved = pieces.map((m): Module => {
    const offset = offsets.get(band(m.z)) ?? 0
    const result = { ...m, x: m.x + dx * offset, y: m.y + dy * offset }
    // Endpoints are world coordinates; both ends move together so ramps retain
    // their authored rise, length and rotation instead of stretching between trays.
    if ('from' in result && 'to' in result) {
      result.from = { ...result.from, x: result.from.x + dx * offset, y: result.from.y + dy * offset }
      result.to = { ...result.to, x: result.to.x + dx * offset, y: result.to.y + dy * offset }
    }
    if (result.type === 'stair' && result.cfg.flights) {
      result.cfg = { ...result.cfg, flights: result.cfg.flights.map(flight => ({
        ...flight,
        from: { ...flight.from, x: flight.from.x + dx * offset, y: flight.from.y + dy * offset },
        to: { ...flight.to, x: flight.to.x + dx * offset, y: flight.to.y + dy * offset },
      })) }
    }
    return result
  })
  return { data: { ...data, cells, modules: moved }, levels, offsets, direction }
}

/** Reuse one output buffer per stream; never modify worker-owned coordinates. */
export function explodedPoses(source: Float32Array, stride: number, offsets: ReadonlyMap<number, number>,
  base: number, floorLift: number, target: Float32Array = new Float32Array(source.length), roundFloor = false, direction: readonly [number, number] = [1, 1]): Float32Array {
  if (target.length !== source.length) target = new Float32Array(source.length)
  target.set(source)
  for (let i = 0; i + stride <= source.length; i += stride) {
    const floor = source[i + 2] - floorLift
    const offset = offsets.get(storeyBand(roundFloor ? Math.round(floor) : floor, base, STOREY_HEIGHT)) ?? 0
    target[i] += direction[0] * offset
    target[i + 1] += direction[1] * offset
  }
  return target
}

/** Presentation-only flag above the two native landing-door side bits. */
export const EXPLODED_LIFT_ABSENT = 4

export function explodedLiftPoses(source: Float32Array, offsets: ReadonlyMap<number, number>, direction: readonly [number, number] = [1, 1]): Float32Array {
  const rows: number[] = []
  for (let i = 0; i + 7 <= source.length; i += 7) {
    const lo = source[i + 2], hi = source[i + 3], cabin = source[i + 4]
    for (const [z, offset] of offsets) {
      const from = Math.max(lo, z), to = Math.min(hi, z + STOREY_HEIGHT)
      if (from >= to) continue
      const present = cabin >= from + 1 && (cabin < to + 1 || (to === hi && cabin <= to + 1))
      rows.push(source[i] + direction[0] * offset, source[i + 1] + direction[1] * offset, from, to, cabin,
        present ? source[i + 5] : 0, source[i + 6] | (present ? 0 : EXPLODED_LIFT_ABSENT))
    }
  }
  return new Float32Array(rows)
}
