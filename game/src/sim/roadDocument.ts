// Authored road graph (§4.1/§9.5). Nodes are owned by endpoint references, never
// independent orphan objects. Rectangle surfaces remain the render/placement adapter.
import type { Module } from './types.ts'
import { roadLayout, type Road } from './roads.ts'
import { ROAD_NODE_SNAP_RADIUS } from './constants.ts'

export type RoadPosition = [number,number]
export interface RoadNode { id:string; x:number; y:number; z:number; segments:string[] }
export interface RoadSegment { road:Road; sourceId:string; from:string; to:string }
export interface RoadDocument { modules:Module[]; nodes:Map<string,RoadNode>; segments:RoadSegment[]; byId:Map<string,RoadSegment> }
const cache=new WeakMap<readonly Module[],RoadDocument>()
export const roadNodeId=(p:RoadPosition,z:number)=>`road-node:${z}:${p[0]}:${p[1]}`
export function roadEndpoints(r:Road):[RoadPosition,RoadPosition] {
  const valid=(p:unknown):p is RoadPosition=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)
  if(valid(r.cfg.from)&&valid(r.cfg.to)&&(r.cfg.from[0]===r.cfg.to[0]||r.cfg.from[1]===r.cfg.to[1])) return [r.cfg.from,r.cfg.to]
  const {acrossX,width,length}=roadLayout(r),inset=Math.min(width/2,length/2)
  return acrossX?[[r.x+width/2,r.y+inset],[r.x+width/2,r.y+length-inset]]:
    [[r.x+inset,r.y+width/2],[r.x+length-inset,r.y+width/2]]
}
/** Axis-aligned segment with a shared square cap at each node. Caps belong to
 * every incident segment, so deleting an arm cannot punch a hole in the junction. */
export function roadBetween(from:RoadPosition,to:RoadPosition,z:number,width:number,direction:Road['cfg']['direction'],reverse:boolean,id:string):Road {
  const vertical=from[0]===to[0],half=width/2
  const x=Math.floor(Math.min(from[0],to[0])-half),y=Math.floor(Math.min(from[1],to[1])-half)
  return {id,type:'road',x,y,z,w:Math.ceil(Math.max(from[0],to[0])+half)-x,d:Math.ceil(Math.max(from[1],to[1])+half)-y,
    rot:(vertical?0:1)+(reverse?2:0),cfg:{direction,from:[...from],to:[...to]}}
}
const between=(n:number,a:number,b:number)=>n>=Math.min(a,b)-1e-6&&n<=Math.max(a,b)+1e-6
export function getRoadDocument(modules:readonly Module[]):RoadDocument {
  const held=cache.get(modules);if(held)return held
  const roads:Road[]=[],nonRoads:Module[]=[],ids=new Set<string>()
  for(const m of modules){ids.add(m.id);if(m.type==='road')roads.push(m);else nonRoads.push(m)}
  const ends=roads.map(roadEndpoints),cuts=ends.map(([a,b])=>[a,b])
  const add=(i:number,p:RoadPosition)=>{if(!cuts[i].some(q=>q[0]===p[0]&&q[1]===p[1]))cuts[i].push(p)}
  for(let i=0;i<roads.length;i++)for(let j=i+1;j<roads.length;j++) {
    if(roads[i].z!==roads[j].z)continue
    const [a,b]=ends[i],[c,d]=ends[j],v=a[0]===b[0],w=c[0]===d[0]
    if(v!==w) {
      const p:RoadPosition=v?[a[0],c[1]]:[c[0],a[1]]
      if(between(p[0],a[0],b[0])&&between(p[1],a[1],b[1])&&between(p[0],c[0],d[0])&&between(p[1],c[1],d[1])) {add(i,p);add(j,p)}
    } else if(v?a[0]===c[0]:a[1]===c[1]) {
      for(const p of ends[j])if(between(p[0],a[0],b[0])&&between(p[1],a[1],b[1]))add(i,p)
      for(const p of ends[i])if(between(p[0],c[0],d[0])&&between(p[1],c[1],d[1]))add(j,p)
    }
  }
  const nodes=new Map<string,RoadNode>(),segments:RoadSegment[]=[],result:Module[]=nonRoads,seen=new Set<string>()
  const attach=(p:RoadPosition,z:number,id:string)=> {
    const key=roadNodeId(p,z),node=nodes.get(key)??{id:key,x:p[0],y:p[1],z,segments:[]}
    if(!node.segments.includes(id))node.segments.push(id)
    nodes.set(key,node);return key
  }
  roads.forEach((r,i)=> {
    const {acrossX,width}=roadLayout(r),axis=acrossX?1:0
    const points=cuts[i].sort((a,b)=>a[axis]-b[axis])
    if(points.length===2&&points[0][0]===points[1][0]&&points[0][1]===points[1][1])points.pop()
    for(let part=0;part<Math.max(1,points.length-1);part++) {
      const from=points[part],to=points[part+1]??from
      const signature=JSON.stringify([r.z,from,to,width,r.cfg.direction,r.cfg.direction==='one-way'?r.rot??0:0])
      if(seen.has(signature))continue
      seen.add(signature)
      let id=r.id
      if(part>0) {let suffix=part;while(ids.has(`${r.id}-segment-${suffix}`))suffix++;id=`${r.id}-segment-${suffix}`;ids.add(id)}
      // Keep the old road's exterior edges exactly; only interior nodes gain
      // overlapping caps. Width, finishes and traffic direction are unchanged.
      const lo=part===0?(acrossX?r.y:r.x):Math.floor(from[axis]-width/2)
      const hi=part===points.length-2||points.length===1?(acrossX?r.y+r.d:r.x+r.w):Math.ceil(to[axis]+width/2)
      const same=r.cfg.from&&r.cfg.to&&points.length===2&&r.cfg.from[0]===from[0]&&r.cfg.from[1]===from[1]&&r.cfg.to[0]===to[0]&&r.cfg.to[1]===to[1]
      const road:Road=same?r:{...r,id,x:acrossX?r.x:lo,y:acrossX?lo:r.y,w:acrossX?r.w:hi-lo,d:acrossX?hi-lo:r.d,cfg:{...r.cfg,from:[...from],to:[...to]}}
      result.push(road);segments.push({road,sourceId:r.id,from:attach(from,r.z,id),to:attach(to,r.z,id)})
    }
  })
  const graph={modules:result,nodes,segments,byId:new Map(segments.map(s=>[s.road.id,s]))};cache.set(modules,graph);return graph
}

export function roadSnap(graph:RoadDocument,p:RoadPosition,z:number,radius=ROAD_NODE_SNAP_RADIUS,visible:(s:RoadSegment)=>boolean=()=>true):{point:RoadPosition;road?:Road;node?:RoadNode} {
  let best=radius,found:RoadNode|undefined
  for(const node of graph.nodes.values()) {
    if(node.z!==z)continue
    if(!node.segments.some(id=>visible(graph.byId.get(id)!)))continue
    const distance=Math.hypot(p[0]-node.x,p[1]-node.y)
    if(distance<=best){best=distance;found=node}
  }
  if(found)return {point:[found.x,found.y],node:found,road:found.segments.map(id=>graph.byId.get(id)!).find(visible)?.road}
  let projection:RoadPosition|undefined,road:Road|undefined,projectBest=Infinity
  for(const segment of graph.segments) {
    if(!visible(segment))continue
    const r=segment.road;if(r.z!==z)continue
    const [a,b]=roadEndpoints(r),vertical=a[0]===b[0],axis=vertical?1:0
    const along=Math.max(Math.min(a[axis],b[axis]),Math.min(Math.max(a[axis],b[axis]),Math.round(p[axis]*2)/2))
    const q:RoadPosition=vertical?[a[0],along]:[along,a[1]],distance=Math.hypot(q[0]-p[0],q[1]-p[1])
    if(distance<=Math.max(radius,roadLayout(r).width/2+.5)&&distance<projectBest){projectBest=distance;projection=q;road=r}
  }
  return {point:projection??p,road}
}

/** Prefer a segment body over a shared cap when the pointer is near a node. */
export function roadSegmentAt(graph:RoadDocument,p:RoadPosition,z:number,sourceId?:string):RoadSegment|undefined {
  let best=Infinity,result:RoadSegment|undefined
  for(const segment of graph.segments) {
    const r=segment.road
    if(r.z!==z || (sourceId&&segment.sourceId!==sourceId&&r.id!==sourceId))continue
    if(p[0]<r.x||p[0]>=r.x+r.w||p[1]<r.y||p[1]>=r.y+r.d)continue
    const [a,b]=roadEndpoints(r),axis=roadLayout(r).acrossX?1:0,other=1-axis
    const outside=Math.max(Math.min(a[axis],b[axis])-p[axis],0,p[axis]-Math.max(a[axis],b[axis]))
    const distance=Math.abs(p[other]-a[other])+outside*2
    if(distance<best){best=distance;result=segment}
  }
  return result
}
