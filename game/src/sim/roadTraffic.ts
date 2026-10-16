import { ROAD_STEP, ROAD_MAX_CATCHUP, ROAD_CROSSWALK_DEPTH, ROAD_FOLLOW_GAP, ROAD_TRAFFIC_SPEED, ROAD_TRAFFIC_CAPACITY, ROAD_TRAFFIC_SPACING, ROAD_TRAFFIC_DENSITY } from './constants.ts'
import { roadHash } from './roads.ts'
import { roadSignal, type RoadNetwork } from './roadNetwork.ts'

export interface RoadCar { id:number; edge:number; distance:number; previousEdge:number; previousDistance:number; size:number; kind:'car'|'bus'|'scooter'; held:number; tails:Array<{junction:number;remaining:number}> }
/** Small lane queues, fixed steps and exclusive junction reservations (§4.1).
 * Draw frequency never changes choices. Clock seeks reset within a bounded interval. */
export class RoadTraffic {
  cars:RoadCar[]=[]
  time=NaN
  private serial=0
  private tick=0
  private buckets:RoadCar[][]
  private locks=new Map<number,number>()
  readonly network:RoadNetwork
  readonly seed:number
  constructor(network:RoadNetwork,seed:number) { this.network=network;this.seed=seed;this.buckets=network.edges.map(()=>[]) }
  private car(edge:number,distance:number):RoadCar {
    const id=this.serial++, roll=roadHash(`${this.seed}:kind:${id}`)%10
    const kind=roll===0?'bus':roll<=6?'scooter':'car'
    return {id,edge,distance,previousEdge:edge,previousDistance:distance,kind,size:kind==='bus'?10:kind==='car'?4.2:1.9,held:-1,tails:[]}
  }
  private reset(time:number):void {
    this.cars=[];this.locks.clear();this.serial=0;this.tick=Math.floor(time/ROAD_STEP)
    this.time=this.tick*ROAD_STEP
    for(let i=0;i<this.network.edges.length && this.cars.length<ROAD_TRAFFIC_CAPACITY;i++) {
      const e=this.network.edges[i]
      if(e.junction>=0) continue
      for(let d=ROAD_TRAFFIC_SPACING/2;d<e.length-5 && this.cars.length<ROAD_TRAFFIC_CAPACITY;d+=ROAD_TRAFFIC_SPACING) {
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
    for(const b of this.buckets) b.sort((a,c)=>c.distance-a.distance)
    const dead=new Set<RoadCar>()
    const processed=new Set<number>()
    for(const b of this.buckets) {
      let leader:RoadCar|undefined
      for(const c of [...b]) {
        if(processed.has(c.id)) continue
        processed.add(c.id)
        const e=edges[c.edge],old=c.distance
        let limit=e.length-c.size/2
        const choice=e.next.length?e.next[roadHash(`${this.seed}:${c.id}:${c.edge}`)%e.next.length]:-1
        const next=edges[choice]
        let canLeave=!next
        if(next) {
          const tail=this.buckets[choice].filter(a=>a.edge===choice && !dead.has(a)).sort((a,b)=>a.distance-b.distance)[0]
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
        c.tails=c.tails.filter(t=>t.remaining>0)
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
    this.cars=this.cars.filter(c=>!dead.has(c))
    // Spawns occur at network boundaries only; interior road seams never emit cars.
    if(this.tick%Math.round(ROAD_TRAFFIC_SPACING/(ROAD_TRAFFIC_SPEED*ROAD_STEP)/ROAD_TRAFFIC_DENSITY)===0) for(const entry of this.network.entries) {
      if(this.cars.length>=ROAD_TRAFFIC_CAPACITY) break
      const e=edges[entry],c=this.car(entry,5)
      if(e.length<c.size || this.cars.some(a=>a.edge===entry && a.distance<(a.size+c.size)/2+ROAD_FOLLOW_GAP+5)) continue
      this.cars.push(c)
    }
  }
}
