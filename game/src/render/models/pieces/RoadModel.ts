import * as THREE from 'three'
import { modelNeighbours } from '../../modelNeighbours.ts'
import { surfaceModelDetail } from '../../modelDetail.ts'
import { batchStaticParts } from '../../batchStaticModule.ts'
import { PieceBuilder, slab, ownedMaterial } from '../PieceBuilder.ts'
import { roadLayout, roadPoint, roadInkIntervals } from '../../../sim/roads.ts'
import type { Road } from '../../../sim/roads.ts'
import { getRoadNetwork, roadLaneSign, roadEdgeMovements, roadJunctionSides } from '../../../sim/roadNetwork.ts'
import { ROAD_CROSSWALK_DEPTH } from '../../../sim/constants.ts'
import { TrafficLightModel } from './TrafficLightModel.ts'
import { roadArrowMarking } from './RoadArrowMarking.ts'

export class RoadModel extends PieceBuilder {
  readonly kind = 'road'
  build(r: Road): THREE.Group {
    const g = new THREE.Group()
    const asphalt = ownedMaterial(this.ctx, new THREE.MeshStandardMaterial({ color: 0x3b3f45, roughness: .96 }))
    const yellow = ownedMaterial(this.ctx, new THREE.MeshStandardMaterial({ color: 0xf7c83c, roughness: .8 }))
    // Surface tops coincide at every overlap; one plane avoids coplanar side faces.
    const surface = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.d), asphalt)
    surface.position.set(r.x + r.w / 2, r.y + r.d / 2, r.z + 1.025)
    g.add(surface)
    const { width, lanes, laneWidth, acrossX, length } = roadLayout(r)
    const ink = (across: number, dashed: boolean, material: THREE.Material) => {
      for (const [a, b] of roadInkIntervals(r, modelNeighbours(this.ctx, 'road'), across, ROAD_CROSSWALK_DEPTH+1.5)) {
        for (let from = dashed ? Math.floor(a / 6) * 6 : a; from < b; from += dashed ? 6 : length + 1) {
          const lo = Math.max(a, from), hi = Math.min(b, dashed ? from + 3 : b)
          if (hi <= lo) continue
          const [x, y] = roadPoint(r, across, (lo + hi) / 2)
          surfaceModelDetail(slab(g, material, x, y, r.z + 1.035, acrossX ? .12 : hi - lo, acrossX ? hi - lo : .12, .008), 'z', 1)
        }
      }
    }
    ink(.16, false, this.ctx.mats.white); ink(width - .16, false, this.ctx.mats.white)
    for (let lane = 1; lane < lanes; lane++) {
      if (r.cfg.direction === 'two-way' && lane === lanes / 2) {
        ink(width / 2 - .13, false, yellow); ink(width / 2 + .13, false, yellow)
      } else ink(lane * laneWidth, true, this.ctx.mats.white)
    }
    const arrows=new THREE.Group();arrows.name='road-direction-arrows'
    g.userData.roadArrows=[]
    // Preview arrows read only the candidate: no topology edits, routing rebuild
    // or junction search is needed for showing which side drives which way.
    if(this.ctx.preview) {
      for(let lane=0;lane<lanes;lane++) {
        const sign=roadLaneSign(r,lane),[x,y]=roadPoint(r,(lane+.5)*laneWidth,length/2)
        const scale=Math.min(1,laneWidth/3,length/3.2)
        arrows.add(roadArrowMarking(this.ctx.mats.white,['straight'],x,y,r.z+1.06,acrossX,sign,scale))
        g.userData.roadArrows.push({lane,sign,axis:acrossX,turns:['straight'],x,y,scale})
      }
      batchStaticParts(arrows);g.add(arrows);return g
    }
    // Arrival markings: one arrow set, stop line and pole per arriving approach,
    // shared by all its lanes. Derived geometry follows road undo/delete; nothing is
    // added to the authored document (§9.5).
    const network=getRoadNetwork(this.ctx.data.modules)
    const approaches=new Set<string>()
    const crossings=new THREE.Group();crossings.name='road-crosswalk'
    g.userData.roadSignals=[]
    g.userData.roadStopLines=[]
    g.userData.roadCrosswalks=[]
    // A zebra belongs to the intersection rather than to a direction of travel:
    // `roadJunctionSides` hands back every side of every junction, so a one-way street
    // keeps its crossing on both sides and a stem that only carries traffic away still
    // gets one at its mouth. Stop lines and poles below stay on arrivals.
    for(const side of roadJunctionSides(network)) {
      const junction=network.junctions[side.junction]
      if(junction.uncontrolled || junction.z!==r.z || side.road!==r.id) continue
      const along=side.boundary+side.out*(ROAD_CROSSWALK_DEPTH/2+.8)
      const roadAcross=side.axis?r.x:r.y,roadWidth=side.axis?r.w:r.d
      for(let across=.4;across<roadWidth-.3;across+=1) {
        slab(crossings,this.ctx.mats.white,side.axis?roadAcross+across:along,side.axis?along:roadAcross+across,r.z+1.045,
          side.axis?.5:ROAD_CROSSWALK_DEPTH,side.axis?ROAD_CROSSWALK_DEPTH:.5,.01).name='road-crosswalk'
      }
      g.userData.roadCrosswalks.push({axis:side.axis,out:side.out,along,across:roadAcross,width:roadWidth})
    }
    for(const e of network.edges) {
      if(e.road.id!==r.id || e.junction>=0) continue
      const connector=e.next.map(n=>network.edges[n]).find(n=>n.junction>=0)
      if(!connector) continue
      if(network.junctions[connector.junction].uncontrolled)continue
      const turns=roadEdgeMovements(network,e)
      if(e.length>ROAD_CROSSWALK_DEPTH+3) {
        const setback=Math.min(7,e.length-1.5),distance=Math.min(setback,(e.length+ROAD_CROSSWALK_DEPTH+1.5)/2)
        const x=e.end[0]-(e.axis?0:e.sign*distance),y=e.end[1]-(e.axis?e.sign*distance:0)
        const scale=Math.min(1,laneWidth/3,(e.length-ROAD_CROSSWALK_DEPTH-1.5)/3.2)
        arrows.add(roadArrowMarking(this.ctx.mats.white,turns,x,y,r.z+1.06,e.axis,e.sign,scale))
        g.userData.roadArrows.push({lane:e.lane,sign:e.sign,axis:e.axis,turns,x,y,scale})
      }
      const key=`${connector.junction}:${e.axis}:${e.sign}`
      if(approaches.has(key)) continue
      approaches.add(key)
      const along=(e.axis?e.end[1]:e.end[0])-e.sign*(ROAD_CROSSWALK_DEPTH/2+.8)
      const roadAcross=e.axis?r.x:r.y,roadWidth=e.axis?r.w:r.d
      const stop=along-e.sign*(ROAD_CROSSWALK_DEPTH/2+.5)
      const stopWidth=r.cfg.direction==='two-way'?roadWidth/2:roadWidth
      const stopAcross=roadAcross+(r.cfg.direction==='two-way'&&e.lane>=lanes/2?roadWidth/2:0)+stopWidth/2
      slab(crossings,this.ctx.mats.white,e.axis?stopAcross:stop,e.axis?stop:stopAcross,r.z+1.045,
        e.axis?stopWidth:.2,e.axis?.2:stopWidth,.01).name='road-stop-line'
      g.userData.roadStopLines.push({axis:e.axis,sign:e.sign,across:stopAcross,width:stopWidth,along:stop})
      const side=roadAcross+(e.sign*(e.axis?1:-1)>0?roadWidth+.5:-.5)
      const light=new TrafficLightModel(this.ctx).build({id:`auto-${r.id}-${key}`,type:'traffic-light',
        x:(e.axis?side:along)-.5,y:(e.axis?along:side)-.5,z:r.z,rot:e.axis?(e.sign>0?0:2):(e.sign>0?3:1),cfg:{}})
      light.name='road-traffic-light';g.add(light)
      const lenses=light.children.filter(o=>o.name.startsWith('traffic-lens-'))
      g.userData.roadSignals.push({junction:network.junctions[connector.junction],axis:e.axis,lenses})
    }
    if(crossings.children.length) {batchStaticParts(crossings);g.add(crossings)}
    if(arrows.children.length) {batchStaticParts(arrows);g.add(arrows)}
    return g
  }
}
