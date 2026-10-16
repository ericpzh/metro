// Derived lane topology for the street plane (§4.1). No document writes or passenger RNG.
import type { Module } from './types.ts'
import { roadHash, roadLayout, roadPoint, type Road } from './roads.ts'
import { ROAD_SIGNAL_GREEN, ROAD_SIGNAL_AMBER, ROAD_SIGNAL_CLEAR, ROAD_NETWORK_CACHE_LIMIT } from './constants.ts'
import { roadDriverLaneOrder, roadLaneMovements, roadTurn, type RoadTurn } from './roadLaneMovements.ts'
import { getRoadDocument } from './roadDocument.ts'

export type Point = [number, number]
export interface RoadJunction { x0: number; y0: number; x1: number; y1: number; z: number; id: string; uncontrolled?:boolean }
export interface RoadEdge {
  road: Road; lane: number; sign: number; axis: boolean; start: Point; end: Point
  length: number; next: number[]; junction: number; control?: Point
}
export interface RoadNetwork { roads: Road[]; junctions: RoadJunction[]; edges: RoadEdge[]; entries: number[] }
const cache = new WeakMap<readonly Module[], RoadNetwork>()
const recentNetworks = new Map<string,RoadNetwork>()
export function roadLaneSign(r: Road, lane: number): number {
  const {acrossX,lanes}=roadLayout(r)
  // A half turn reverses a one-way road, but never changes which side of a
  // two-way road drives forward. Rotations 0/2 and 1/3 share one handedness.
  if(r.cfg.direction==='two-way') return (lane < lanes / 2 ? -1 : 1)*(acrossX?1:-1)
  return (r.rot??0)>=2?-1:1
}
export function roadSignal(j: RoadJunction, axis: boolean, time: number): 'red' | 'amber' | 'green' {
  if(j.uncontrolled)return 'green'
  const half = ROAD_SIGNAL_GREEN + ROAD_SIGNAL_AMBER + ROAD_SIGNAL_CLEAR
  const phase = ((time + roadHash(j.id) % half) % (half * 2) + half * 2) % (half * 2)
  const local = phase - (axis ? 0 : half)
  return local >= 0 && local < ROAD_SIGNAL_GREEN ? 'green' : local >= ROAD_SIGNAL_GREEN && local < ROAD_SIGNAL_GREEN + ROAD_SIGNAL_AMBER ? 'amber' : 'red'
}
const near = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]) < .01
export function getRoadNetwork(modules: readonly Module[]): RoadNetwork {
  const old = cache.get(modules)
  if (old) return old
  const roads = modules.filter((m): m is Road => m.type === 'road').sort((a,b) => a.id.localeCompare(b.id))
  const signature=JSON.stringify(roads.map(r=>[r.id,r.x,r.y,r.z,r.rot??0,r.w,r.d,r.cfg.direction,r.cfg.from,r.cfg.to]))
  const recent=recentNetworks.get(signature)
  if(recent) { recentNetworks.delete(signature);recentNetworks.set(signature,recent);cache.set(modules,recent);return recent }
  // Coalesce same-width collinear strokes, so shared pavement has one lane queue
  // and adjacent pieces have no artificial spawn/exit seam.
  for(let a=0;a<roads.length;a++) for(let b=a+1;b<roads.length;b++) {
    const r=roads[a],s=roads[b],axis=roadLayout(r).acrossX
    if(r.z!==s.z || r.cfg.direction!==s.cfg.direction) continue
    const rotationMod=r.cfg.direction==='two-way'?2:4
    if((r.rot??0)%rotationMod!==(s.rot??0)%rotationMod) continue
    if(axis?r.x!==s.x||r.w!==s.w||r.y>s.y+s.d||s.y>r.y+r.d:r.y!==s.y||r.d!==s.d||r.x>s.x+s.w||s.x>r.x+r.w) continue
    roads[a]={...r,x:Math.min(r.x,s.x),y:Math.min(r.y,s.y),w:Math.max(r.x+r.w,s.x+s.w)-Math.min(r.x,s.x),d:Math.max(r.y+r.d,s.y+s.d)-Math.min(r.y,s.y)}
    roads.splice(b,1);a=-1;break
  }
  const junctions: RoadJunction[] = [], edges: RoadEdge[] = []
  // Authored shared nodes also connect straight segments of different widths.
  // These are lane merges, without signals or zebra crossings.
  const roadDoc=getRoadDocument(modules)
  for(const node of roadDoc.nodes.values()) {
    const connected=node.segments.map(id=>roadDoc.byId.get(id)!.road)
    if(connected.length<2)continue
    const layouts=connected.map(roadLayout)
    if(!layouts.every(l=>l.acrossX===layouts[0].acrossX)||layouts.every(l=>l.width===layouts[0].width))continue
    const half=Math.max(...layouts.map(l=>l.width))/2
    junctions.push({x0:node.x-half,y0:node.y-half,x1:node.x+half,y1:node.y+half,z:node.z,id:`road-merge:${node.id}`,uncontrolled:true})
  }
  for (let a = 0; a < roads.length; a++) for (let b = a + 1; b < roads.length; b++) {
    const r = roads[a], s = roads[b]
    if (r.z !== s.z || roadLayout(r).acrossX === roadLayout(s).acrossX) continue
    const x0 = Math.max(r.x,s.x), y0 = Math.max(r.y,s.y), x1 = Math.min(r.x+r.w,s.x+s.w), y1 = Math.min(r.y+r.d,s.y+s.d)
    if (x1 > x0 && y1 > y0) {
      // A T stroke may stop at the receiving road's centre. Its junction still
      // spans that road's full carriageway, so both legal turns remain reachable.
      const vertical=roadLayout(r).acrossX?r:s,horizontal=vertical===r?s:r
      const j={x0:vertical.x,y0:horizontal.y,x1:vertical.x+vertical.w,y1:horizontal.y+horizontal.d,z:r.z,id:''}
      j.id=`${j.z}:${j.x0}:${j.y0}:${j.x1}:${j.y1}`;junctions.push(j)
    }
  }
  // Overlapping crossing rectangles form one controlled junction, including split roads.
  for (let a=0;a<junctions.length;a++) for(let b=a+1;b<junctions.length;b++) {
    const j=junctions[a],k=junctions[b]
    if(j.z===k.z && j.x0<=k.x1 && j.x1>=k.x0 && j.y0<=k.y1 && j.y1>=k.y0) {
      j.x0=Math.min(j.x0,k.x0);j.y0=Math.min(j.y0,k.y0);j.x1=Math.max(j.x1,k.x1);j.y1=Math.max(j.y1,k.y1)
      j.uncontrolled=!!j.uncontrolled&&!!k.uncontrolled
      j.id=`${j.z}:${j.x0}:${j.y0}:${j.x1}:${j.y1}`;junctions.splice(b,1);a=-1;break
    }
  }
  const incoming: number[][] = junctions.map(()=>[]), outgoing: number[][] = junctions.map(()=>[])
  for(const r of roads) {
    const {acrossX:axis,length,lanes,laneWidth}=roadLayout(r)
    for(let lane=0;lane<lanes;lane++) {
      const across=(lane+.5)*laneWidth, sign=roadLaneSign(r,lane), origin=axis?r.y:r.x
      const cuts=junctions.flatMap((j,index)=> {
        const cross=(axis?r.x:r.y)+across
        if(j.z!==r.z || cross<=(axis?j.x0:j.y0) || cross>=(axis?j.x1:j.y1)) return []
        const lo=Math.max(0,(axis?j.y0:j.x0)-origin),hi=Math.min(length,(axis?j.y1:j.x1)-origin)
        return hi>lo?[{lo,hi,index}]:[]
      }).sort((a,b)=>a.lo-b.lo)
      let from=0, prev=-1
      const segment=(to:number,next:number)=> {
        if(to-from<.01) return
        const start=roadPoint(r,across,sign>0?from:to),end=roadPoint(r,across,sign>0?to:from)
        const id=edges.length
        edges.push({road:r,lane,sign,axis,start,end,length:to-from,next:[],junction:-1})
        if(prev>=0) (sign>0?outgoing:incoming)[prev].push(id)
        if(next>=0) (sign>0?incoming:outgoing)[next].push(id)
      }
      for(const c of cuts) { segment(c.lo,c.index);from=c.hi;prev=c.index }
      segment(length,-1)
    }
  }
  const straights=edges.length
  // Exact endpoint joins keep adjacent collinear road pieces continuous.
  const starts=new Map<string,number[]>()
  const key=(p:Point,z:number)=>`${z}:${p[0]}:${p[1]}`
  for(let i=0;i<straights;i++) { const e=edges[i],k=key(e.start,e.road.z);starts.set(k,[...(starts.get(k)??[]),i]) }
  for(let i=0;i<straights;i++) {
    const e=edges[i]
    e.next=(starts.get(key(e.end,e.road.z))??[]).filter(n=>n!==i && edges[n].axis===e.axis && edges[n].sign===e.sign)
  }
  junctions.forEach((_,j)=> {
    for(const i of incoming[j]) {
      const a=edges[i],destinations=new Map<RoadTurn,number[]>()
      const laneOrder=roadDriverLaneOrder(a.axis,a.sign)
      const approach=incoming[j].filter(n=>edges[n].road.id===a.road.id && edges[n].axis===a.axis && edges[n].sign===a.sign)
        .sort((l,r)=>(edges[l].lane-edges[r].lane)*laneOrder)
      for(const o of outgoing[j]) {
        const b=edges[o]
        const turn=roadTurn(a.axis,a.sign,b.axis,b.sign)
        if(!turn) continue // no U turns
        const list=destinations.get(turn)??[];list.push(o);destinations.set(turn,list)
      }
      const index=approach.indexOf(i)
      const permitted=roadLaneMovements(index,approach.length,[...destinations.keys()])
      for(const turn of permitted) {
        const list=destinations.get(turn)!
        list.sort((l,r)=>(edges[l].lane-edges[r].lane)*roadDriverLaneOrder(edges[l].axis,edges[l].sign))
        const target=turn==='left'?0:turn==='right'?list.length-1:Math.min(list.length-1,Math.floor((index+.5)*list.length/approach.length))
        const o=list[target]
        const b=edges[o],control:Point|undefined=a.axis===b.axis?undefined:a.axis?[a.end[0],b.start[1]]:[b.start[0],a.end[1]]
        if(near(a.end,b.start)) { a.next.push(o);continue }
        const connector:RoadEdge={road:a.road,lane:a.lane,sign:a.sign,axis:a.axis,start:a.end,end:b.start,control,length:0,next:[o],junction:j}
        let prev=connector.start
        for(let s=1;s<=16;s++) { const p=roadEdgePoint(connector,s/16);connector.length+=Math.hypot(p[0]-prev[0],p[1]-prev[1]);prev=p }
        a.next.push(edges.length);edges.push(connector)
      }
    }
  })
  const reached=new Set(edges.flatMap(e=>e.next))
  const departures=new Set(outgoing.flat())
  const network={roads,junctions,edges,entries:edges.flatMap((e,i)=>e.junction<0&&!reached.has(i)&&!departures.has(i)?[i]:[])}
  cache.set(modules,network);recentNetworks.set(signature,network)
  if(recentNetworks.size>ROAD_NETWORK_CACHE_LIMIT) recentNetworks.delete(recentNetworks.keys().next().value!)
  return network
}
/** Read the actual connectors, so painted permissions cannot disagree with cars. */
export function roadEdgeMovements(network: RoadNetwork, edge: RoadEdge): RoadTurn[] {
  const result=new Set<RoadTurn>()
  for(const n of edge.next) {
    const connector=network.edges[n]
    const exit=connector.junction>=0?network.edges[connector.next[0]]:connector
    const turn=roadTurn(edge.axis,edge.sign,exit.axis,exit.sign)
    if(turn) result.add(turn)
  }
  return [...result]
}
export function roadEdgePoint(e:RoadEdge,t:number):Point {
  const u=1-t,c=e.control
  return c?[u*u*e.start[0]+2*u*t*c[0]+t*t*e.end[0],u*u*e.start[1]+2*u*t*c[1]+t*t*e.end[1]]:[e.start[0]+(e.end[0]-e.start[0])*t,e.start[1]+(e.end[1]-e.start[1])*t]
}
