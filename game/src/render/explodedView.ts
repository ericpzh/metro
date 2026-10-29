import { STOREY_HEIGHT, storeyBand } from '../sim/constants.ts'
import type { Cell, Module, StationData } from '../sim/types.ts'
import { isWallBlock, packKey } from '../sim/types.ts'
import { moduleFootprint } from '../sim/placement.ts'
import { GROUND_Z } from '../sim/ground.ts'

const hiddenTypes = new Set(['roof', 'road', 'sidewalk', 'lawn', 'tree', 'traffic-light'])
const structureTypes = new Set(['exit', 'stair', 'escalator', 'walkway', 'lift', 'track', 'platform-edge', 'shop', 'retail', 'booth'])
const ceiling = (c: Cell): boolean => !!c.tags?.some(t => t === 'suspended-ceiling' || t === 'opening-ceiling')

/** Try cardinal and diagonal translations against tiles, including concave plans. */
function packFloors(plans: ReadonlyArray<ReadonlyArray<{x:number;y:number}>>, preferred: readonly [number,number]):
  {direction: readonly [number,number]; shifts:number[]} {
  let best: {direction: readonly [number,number]; shifts:number[]; score:number} | undefined
  const concave = plans.some(plan => {
    let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity
    for (const p of plan) {x0=Math.min(x0,p.x);x1=Math.max(x1,p.x);y0=Math.min(y0,p.y);y1=Math.max(y1,p.y)}
    return plan.length > 0 && plan.length < (x1-x0+1)*(y1-y0+1)*0.7
  })
  // Rectangular platforms retain their familiar short-axis alignment.
  const candidates: ReadonlyArray<readonly [number,number]> = concave ?
    [preferred, [preferred[1],preferred[0]], [1,1], [1,-1]] : [preferred]
  for (const direction of candidates) {
    const [dx,dy] = direction, occupied = new Set<string>(), shifts:number[] = []
    let previous = 0, edge = -Infinity, x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity
    for (const plan of plans) {
      let offset = previous
      if (occupied.size && plan.length) {
        let near = Infinity
        for (const p of plan) near = Math.min(near, dx*p.x+dy*p.y)
        const stop = Math.max(offset, Math.ceil((edge-near+1)/(dx*dx+dy*dy)))
        for (;offset<=stop;offset++) {
          if (!plan.some(p=>occupied.has(`${p.x+dx*offset},${p.y+dy*offset}`))) break
        }
      }
      shifts.push(offset)
      previous = offset
      for (const p of plan) {
        const x=p.x+dx*offset, y=p.y+dy*offset
        occupied.add(`${x},${y}`)
        edge=Math.max(edge,dx*x+dy*y)
        // Screen-space extents for the viewer's +x/-1.2y isometric eye.
        const sx=1.2*x+y, sy=-x+1.2*y
        x0=Math.min(x0,sx);x1=Math.max(x1,sx)
        y0=Math.min(y0,sy);y1=Math.max(y1,sy)
      }
    }
    const score=(x1-x0+2.2)*(y1-y0+2.2)
    if (!best || score < best.score - 1e-6) best={direction,shifts,score}
  }
  return best!
}

/** A disposable presentation document. Never install this in the editor or worker. */
export function explodedView(data: StationData): { data: StationData; levels: number[]; offsets: ReadonlyMap<number, number>; direction: readonly [number, number] } {
  const base = data.levelBase ?? 0
  const band = (z: number): number => storeyBand(z, base, STOREY_HEIGHT)
  const solidKeys = new Set(data.cells.filter(c => c.fill === 'solid').map(c => packKey(c.x,c.y,c.z)))
  // Authored station rooms can share the street's height. Their semantic floor
  // labels distinguish usable interiors from outdoor paving and bridge piers.
  const groundRooms = new Set(data.cells.filter(c => c.fill === 'solid' && c.z === GROUND_Z && !ceiling(c) &&
    (c.room || ['paid','unpaid','platform','restricted'].includes(c.zone ?? '') || c.tags?.includes('auto-floor')))
    .map(c => packKey(c.x,c.y,c.z)))
  const floorUse = new Set(data.modules.filter(m => ['gate','tvm','vending','booth','shop','retail','platform-edge','track','bench'].includes(m.type)).map(m => m.z))
  const tunnelCaps = new Set(data.modules.filter(m => m.type === 'track' && m.cfg.tunnel).map(m => m.z + STOREY_HEIGHT))
  const landings = new Set<number>()
  for (const m of data.modules) if (m.type === 'stair' || m.type === 'escalator' || m.type === 'walkway' || m.type === 'lift') {
    for (const end of [m.from,m.to]) for (let x=-2;x<=2;x++) for(let y=-2;y<=2;y++) landings.add(packKey(end.x+x,end.y+y,end.z))
  }
  const capRooms = new Map<number, Set<number>>()
  const enclosedCapFloors = new Set<number>()
  for (const z of tunnelCaps) if (z < GROUND_Z && !floorUse.has(z)) capRooms.set(z,new Set())
  // A tunnel roof can share its elevation with an unlabelled transfer room.
  // Clear headroom beneath the next ceiling is physical evidence of that room;
  // the mere presence of a wall on the roof is not.
  const clearCapFloors = new Set<number>(), roomSeeds: Cell[] = []
  for (const c of data.cells) if (capRooms.has(c.z) && c.fill === 'solid' && !ceiling(c) && !isWallBlock(c) &&
    ![1,2,3].some(dz => solidKeys.has(packKey(c.x,c.y,c.z + dz)))) {
    clearCapFloors.add(packKey(c.x,c.y,c.z))
    if (solidKeys.has(packKey(c.x,c.y,c.z + STOREY_HEIGHT - 1))) roomSeeds.push(c)
  }
  // Follow the room's clear floor through ceiling openings. Walls and solid
  // tunnel shells stop the search; an isolated roof ring never seeds it.
  for (let i=0;i<roomSeeds.length;i++) {
    const c=roomSeeds[i], key=packKey(c.x,c.y,c.z)
    if (!clearCapFloors.delete(key)) continue
    enclosedCapFloors.add(key)
    for (const [x,y] of [[c.x+1,c.y],[c.x-1,c.y],[c.x,c.y+1],[c.x,c.y-1]]) {
      if (clearCapFloors.has(packKey(x,y,c.z))) roomSeeds.push({...c,x,y})
    }
  }
  for (const c of data.cells) {
    const room = capRooms.get(c.z)
    if (!room || c.fill !== 'solid' || ceiling(c) || !(c.room || c.tags?.includes('auto-floor') ||
      ['paid','unpaid','platform','restricted'].includes(c.zone ?? '') || landings.has(packKey(c.x,c.y,c.z)) ||
      enclosedCapFloors.has(packKey(c.x,c.y,c.z)))) continue
    // Keep a one-cell enclosure around actual mezzanine floors/landings, not
    // the roof ring and its walls merely because another course sits above it.
    for (let x=-1;x<=1;x++) for(let y=-1;y<=1;y++) room.add(packKey(c.x+x,c.y+y,c.z))
  }
  const withinCapRoom = (x:number,y:number,z:number): boolean => {
    const cap = band(z), room = capRooms.get(cap)
    return !room || room.has(packKey(x,y,cap))
  }
  let solids = data.cells.filter(c => c.fill === 'solid' && !ceiling(c) &&
    withinCapRoom(c.x,c.y,c.z) &&
    // The street, including authored street plates, is hidden. A raised deck
    // at 1 m remains a station floor, not ground-level context.
    !(c.z === GROUND_Z && !groundRooms.has(packKey(c.x,c.y,c.z)) && !solidKeys.has(packKey(c.x,c.y,c.z+1))) &&
    // Legacy tunnel caps share their plane with small intermediate landings.
    // Retain actual floor use/landings, rather than presenting the whole cap.
    !(c.z < GROUND_Z && tunnelCaps.has(c.z) && !floorUse.has(c.z) &&
      !solidKeys.has(packKey(c.x,c.y,c.z+1)) && !c.tags?.includes('auto-floor') &&
      !['paid','unpaid','platform'].includes(c.zone ?? '') && !landings.has(packKey(c.x,c.y,c.z)) &&
      !enclosedCapFloors.has(packKey(c.x,c.y,c.z))) &&
    // Earth-topped caps are terrain/room ceilings, not another usable floor.
    !(c.finish?.top === 'floor.soil' && !solidKeys.has(packKey(c.x,c.y,c.z+1))) &&
    // Legacy stations also have ordinary, untagged ceiling courses immediately
    // below the next floor. Keep the vertical enclosure, remove the horizontal cap.
    !(c.z === band(c.z) + STOREY_HEIGHT - 1 && !isWallBlock(c)))
  const labelledFloor = (c: Cell): boolean => !!(c.room || ['paid','unpaid','platform','restricted'].includes(c.zone ?? '') || c.tags?.includes('auto-floor'))
  const roomPlans = new Map<number, Set<number>>()
  // Authored floor labels distinguish rooms from bridge foundations and rooftop
  // machinery, even when connected by a beam. A pier must not borrow a platform's
  // floor from the story above it. Unlabelled legacy documents
  // keep their existing presentation rather than losing unfurnished floors.
  const classifyAboveGround = solids.some(c => c.z > GROUND_Z && labelledFloor(c))
  if (classifyAboveGround) {
    for (const c of solids) if(c.z >= GROUND_Z && labelledFloor(c)) {
      const z=band(c.z), plan=roomPlans.get(z)??new Set<number>()
      for(let x=-1;x<=1;x++) for(let y=-1;y<=1;y++) plan.add(packKey(c.x+x,c.y+y,z))
      roomPlans.set(z,plan)
    }
    solids = solids.filter(c => c.z < GROUND_Z || roomPlans.get(band(c.z))?.has(packKey(c.x,c.y,band(c.z))))
  }
  const atRoom = (x:number,y:number,z:number): boolean => !classifyAboveGround || z < GROUND_Z || !!roomPlans.get(band(z))?.has(packKey(x,y,band(z)))
  const connectsRoom = (m: Module): boolean => {
    if (m.type === 'stair' || m.type === 'escalator' || m.type === 'walkway' || m.type === 'lift') {
      return [m.from,m.to].some(p => atRoom(p.x,p.y,p.z))
    }
    return moduleFootprint(m).some(([x,y]) => atRoom(x,y,m.z))
  }
  const retainedRamps = data.modules.filter(m => ['stair','escalator','walkway'].includes(m.type) && connectsRoom(m))
  const modules = data.modules.filter(m => !hiddenTypes.has(m.type) &&
    (m.type === 'track' || m.type === 'platform-edge' || connectsRoom(m) ||
      (m.type === 'exit' && retainedRamps.some(r => 'from' in r && [r.from,r.to].some(p => p.z===m.z && Math.abs(p.x-m.x)<=3 && Math.abs(p.y-m.y)<=3)))) &&
    (structureTypes.has(m.type) || moduleFootprint(m).some(([x,y]) => withinCapRoom(x,y,m.z))) &&
    (structureTypes.has(m.type) || m.z !== GROUND_Z ||
      moduleFootprint(m).some(([x,y]) => groundRooms.has(packKey(x,y,GROUND_Z)))))
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
    const roomFloors = (surfaces.get(GROUND_Z) ?? []).filter(c => groundRooms.has(packKey(c.x,c.y,c.z)))
    floorsByLevel.set(z, floorCells.length ? [...new Set([...floorCells,...roomFloors])] : own.filter(c => c.z === z))
  }
  const offsets = new Map<number, number>()
  // Compare diagonals with the short axis so L-shaped trays can nest in their
  // empty corners. All candidates keep every floor tile free of overlap.
  const solidFloors = [...floorsByLevel.values()].flat()
  const allPoints = solidFloors.length ? solidFloors : solids.length ? solids : [...modulePoints.values()].flat()
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const point of allPoints) {
    x0 = Math.min(x0, point.x); x1 = Math.max(x1, point.x)
    y0 = Math.min(y0, point.y); y1 = Math.max(y1, point.y)
  }
  const footprints = levels.map(z => {
    const floor = floorsByLevel.get(z)!, own = byLevel.get(z)!
    const points = floor.length ? floor : own.length ? own : modulePoints.get(z) ?? []
    return [...new Map(points.map(p => [`${p.x},${p.y}`, p])).values()]
  })
  const packed = packFloors(footprints, x1-x0 >= y1-y0 ? [0,1] : [1,0])
  const direction = packed.direction
  const [dx, dy] = direction
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
    const offset = packed.shifts[offsets.size]
    offsets.set(z, offset)
    for (const cell of own) {
      // The default isometric eye is +x/-y. Open those two perimeter sides,
      // retaining internal partitions and the far enclosure, including irregular plans.
      // A cap-band wall foundation is also overhead relative to the room below.
      // Opening only its upper courses leaves a floating concrete perimeter strip.
      const wallCourse = cell.z > z || (capRooms.has(z) && solidKeys.has(packKey(cell.x,cell.y,cell.z+1)))
      if (wallCourse && !floorKeys.has(packKey(cell.x,cell.y,cell.z)) && (
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
