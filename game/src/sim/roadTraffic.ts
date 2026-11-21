import { ROAD_STEP, ROAD_MAX_CATCHUP, ROAD_CROSSWALK_DEPTH, ROAD_FOLLOW_GAP, ROAD_TRAFFIC_SPEED, ROAD_TRAFFIC_CAPACITY, ROAD_TRAFFIC_SPACING, ROAD_TRAFFIC_DENSITY, ROAD_SIGNAL_AMBER, ROAD_SIGNAL_CLEAR } from './constants.ts'
import { roadHash } from './roads.ts'
import { roadSignal, type RoadNetwork } from './roadNetwork.ts'

export interface RoadCar { id:number; edge:number; distance:number; previousEdge:number; previousDistance:number; size:number; kind:'car'|'bus'|'scooter'; held:number; tails:Array<{junction:number;remaining:number}> }
const BUS_LENGTH = 10
const DEFAULT_SPAWN_PERIOD = Math.round(ROAD_TRAFFIC_SPACING / (ROAD_TRAFFIC_SPEED * ROAD_STEP) / ROAD_TRAFFIC_DENSITY)

function trafficSchedule({edges, junctions, entries}: RoadNetwork) {
  const approaches = junctions.flatMap(junction => [junction, junction].map(() => ({junction, feeders: 0, longest: 0})))
  const approachIndex = (edge: RoadNetwork['edges'][number]) =>
    edge.junction * 2 + (edge.axis && !junctions[edge.junction].uncontrolled ? 1 : 0)
  const routes = entries.map(entry => {
    const reachable = new Set<number>()
    const visited = new Set<number>()
    const pending = [entry]
    while (pending.length) {
      const index = pending.pop()!
      if (visited.has(index)) continue
      visited.add(index)
      const edge = edges[index]
      if (edge.junction >= 0) {
        const approach = approachIndex(edge)
        reachable.add(approach)
        approaches[approach].longest = Math.max(approaches[approach].longest, edge.length)
      }
      for (const next of edge.next) pending.push(next)
    }
    for (const approach of reachable) approaches[approach].feeders++
    return reachable
  })

  const periods = approaches.map(({junction, feeders, longest}, index) => {
    // One reservation serves the crossing from the stop line until the rear clears.
    const headway = (longest + BUS_LENGTH + ROAD_CROSSWALK_DEPTH + 1.5 + ROAD_FOLLOW_GAP) / ROAD_TRAFFIC_SPEED + 2 * ROAD_STEP
    const {verticalGreen, horizontalGreen} = junction
    const green = index % 2 === 1 ? verticalGreen : horizontalGreen
    const continuous = junction.uncontrolled || verticalGreen === 0 || horizontalGreen === 0
    const cycle = verticalGreen + horizontalGreen + 2 * (ROAD_SIGNAL_AMBER + ROAD_SIGNAL_CLEAR)
    const secondsPerVehicle = continuous ? headway : cycle / Math.max(1, Math.floor(green / headway))
    // Leave headroom for uneven arrivals and vehicles clearing at a phase change.
    return Math.ceil(1.25 * feeders * secondsPerVehicle / ROAD_STEP)
  })

  const groups = new Map<number, number[]>()
  routes.forEach((route, index) => {
    let period = DEFAULT_SPAWN_PERIOD
    for (const approach of route) period = Math.max(period, periods[approach])
    const group = groups.get(period) ?? []
    group.push(index)
    groups.set(period, group)
  })
  const spawns: Array<{period: number; offset: number}> = []
  for (const [period, group] of groups) {
    const stagger = Math.max(1, Math.floor(period / group.length))
    group.forEach((index, order) => { spawns[index] = {period, offset: (order * stagger) % period} })
  }
  // Match the initial spacing on junction approaches to their metered arrival rate.
  const seedSpacing = edges.map(edge => {
    let period = DEFAULT_SPAWN_PERIOD
    for (const next of edge.next) {
      const connector = edges[next]
      if (connector.junction >= 0) period = Math.max(period, periods[approachIndex(connector)])
    }
    return ROAD_TRAFFIC_SPACING * period / DEFAULT_SPAWN_PERIOD
  })
  return {spawns, seedSpacing}
}

/** Small lane queues, fixed steps and exclusive junction reservations (§4.1).
 * Draw frequency never changes choices. Clock seeks reset within a bounded interval. */
export class RoadTraffic {
  cars:RoadCar[]=[]
  time=NaN
  private serial=0
  private tick=0
  private buckets:RoadCar[][]
  private locks=new Map<number,number>()
  private readonly schedule: ReturnType<typeof trafficSchedule>
  readonly network:RoadNetwork
  readonly seed:number
  constructor(network:RoadNetwork,seed:number) {
    this.network=network;this.seed=seed;this.buckets=network.edges.map(()=>[])
    this.schedule=trafficSchedule(network)
  }
  private car(edge:number,distance:number):RoadCar {
    const id=this.serial++, roll=roadHash(`${this.seed}:kind:${id}`)%10
    const kind=roll===0?'bus':roll<=6?'scooter':'car'
    return {id,edge,distance,previousEdge:edge,previousDistance:distance,kind,size:kind==='bus'?BUS_LENGTH:kind==='car'?4.2:1.9,held:-1,tails:[]}
  }
  private reset(time:number):void {
    this.cars=[];this.locks.clear();this.serial=0;this.tick=Math.floor(time/ROAD_STEP)
    this.time=this.tick*ROAD_STEP
    for(let i=0;i<this.network.edges.length && this.cars.length<ROAD_TRAFFIC_CAPACITY;i++) {
      const e=this.network.edges[i]
      if(e.junction>=0) continue
      // Stagger cars across the lanes of one road so multi-lane traffic does not
      // line up in lockstep on every lane.
      const laneOffset=e.lane*2
      for(let d=ROAD_TRAFFIC_SPACING/2+laneOffset;d<e.length-5 && this.cars.length<ROAD_TRAFFIC_CAPACITY;d+=this.schedule.seedSpacing[i]) {
        const c=this.car(i,d)
        if(roadHash(`${this.seed}:spawn:${c.id}`)%100<ROAD_TRAFFIC_DENSITY*100) this.cars.push(c)
      }
    }
  }
  advance(time:number):void {
    if(!Number.isFinite(this.time) || time<this.time-ROAD_STEP || time-this.time>ROAD_MAX_CATCHUP) this.reset(time)
    const target=Math.floor((time+1e-7)/ROAD_STEP)
    while(this.tick<target) { this.step();this.tick++;this.time=this.tick*ROAD_STEP }
  }
  private step():void {
    const {edges,junctions}=this.network
    for(const b of this.buckets) b.length=0
    for(const c of this.cars) { c.previousEdge=c.edge;c.previousDistance=c.distance;this.buckets[c.edge].push(c) }
    for(const b of this.buckets) if(b.length>1) b.sort((a,c)=>c.distance-a.distance)
    const dead=new Set<RoadCar>()
    const processed=new Set<number>()
    for(const b of this.buckets) {
      let leader:RoadCar|undefined
      // Cars arriving during this bucket's turn are appended. Visit the same
      // original range without copying the lane queue.
      for(let i=0,count=b.length;i<count;i++) {
        const c=b[i]
        if(processed.has(c.id)) continue
        processed.add(c.id)
        const e=edges[c.edge],old=c.distance
        let limit=e.length-c.size/2
        const choice=e.next.length?e.next[roadHash(`${this.seed}:${c.id}:${c.edge}`)%e.next.length]:-1
        const next=edges[choice]
        let canLeave=!next
        if(next) {
          let tail: RoadCar | undefined
          for (const car of this.buckets[choice]) {
            if (car.edge===choice && !dead.has(car) && (!tail || car.distance<tail.distance)) tail=car
          }
          const room=!tail || tail.distance-tail.size/2>c.size/2+ROAD_FOLLOW_GAP
          const j=next.junction
          if(j>=0) limit-=ROAD_CROSSWALK_DEPTH+1.5
          const signal=j<0 || c.held===j || roadSignal(junctions[j],e.axis,this.time)==='green'
          const reserved=j<0 || !this.locks.has(j) || this.locks.get(j)===c.id
          canLeave=room && signal && reserved
          if(canLeave) limit=e.length
        } else limit=e.length+c.size/2
        if(leader) limit=Math.min(limit,leader.distance-(leader.size+c.size)/2-ROAD_FOLLOW_GAP)
        c.distance=Math.max(old,Math.min(old+ROAD_TRAFFIC_SPEED*ROAD_STEP,limit))
        if(next?.junction>=0 && canLeave && c.distance>e.length-c.size/2-ROAD_CROSSWALK_DEPTH-1.5) {
          this.locks.set(next.junction,c.id);c.held=next.junction
        }
        const moved=c.distance-old
        for(const tail of c.tails) {
          tail.remaining-=moved
          if(tail.remaining<=0 && this.locks.get(tail.junction)===c.id) this.locks.delete(tail.junction)
        }
        if(c.tails.length) c.tails=c.tails.filter(t=>t.remaining>0)
        if(c.distance>=e.length && canLeave) {
          if(!next) {
            dead.add(c);if(c.held>=0)this.locks.delete(c.held)
            for(const tail of c.tails)this.locks.delete(tail.junction)
          }
          else {
            c.distance-=e.length;c.edge=choice
            if(e.junction>=0 && next.junction<0) {c.tails.push({junction:e.junction,remaining:c.size/2+ROAD_FOLLOW_GAP});c.held=-1}
            if(next.junction>=0) { this.locks.set(next.junction,c.id);c.held=next.junction }
            this.buckets[choice].push(c)
          }
        } else leader=c
      }
    }
    if(dead.size) this.cars=this.cars.filter(c=>!dead.has(c))
    // Spawns occur at network boundaries only; interior road seams never emit cars.
    for(let ei=0;ei<this.network.entries.length;ei++) {
      const entry=this.network.entries[ei]
      const {period, offset}=this.schedule.spawns[ei]
      if(this.tick%period!==offset) continue
      if(this.cars.length>=ROAD_TRAFFIC_CAPACITY) break
      const e=edges[entry],c=this.car(entry,5)
      if(e.length<c.size || this.cars.some(a=>a.edge===entry && a.distance<(a.size+c.size)/2+ROAD_FOLLOW_GAP+5)) continue
      this.cars.push(c)
    }
  }
}
