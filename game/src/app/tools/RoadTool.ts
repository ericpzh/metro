import { msg } from '../../sim/i18n.ts'
import { roadLayout, type Road } from '../../sim/roads.ts'
import { getRoadDocument, roadBetween, roadSnap, roadSegmentAt, type RoadPosition, type RoadSegment } from '../../sim/roadDocument.ts'
import { equipmentReason, equipmentRefusalNotice } from '../../sim/placement.ts'
import { ROAD_NODE_SNAP_RADIUS } from '../../sim/constants.ts'
import { addRoadSegment, nextModuleId } from '../../build/model.ts'
import { useStore } from '../store.ts'
import { ToolController } from './ToolController.ts'
import type { PointerInfo } from './ToolContext.ts'

/** Drag a centreline between nodes; preview never splits or commits the document. */
export class RoadTool extends ToolController {
  readonly tool = 'module' as const
  private shown=(segment:RoadSegment):boolean=>this.ctx.scene()?.isModuleVisible?.(segment.sourceId)??true
  previewDelete(info:PointerInfo,pickedId:string|null):void {
    if(!info.hit)return
    const p:RoadPosition=[info.hit.point?.[0]??info.hit.cell[0],info.hit.point?.[1]??info.hit.cell[1]]
    const segment=roadSegmentAt(getRoadDocument(useStore.getState().station.modules),p,info.hit.cell[2],pickedId??undefined)
    this.ctx.scene()?.setModulePreview(segment&&this.shown(segment)?segment.road:null,true)
    this.ctx.scene()?.setGhost([], 'remove');this.ctx.scene()?.setCursor(null)
  }
  beginDelete(info:PointerInfo,pickedId:string|null):void { this.begin(info,pickedId,true) }
  onDown(info:PointerInfo):void { if(info.hit)this.begin(info,this.pickModuleAt(info),info.button===2) }
  private begin(info:PointerInfo,pickedId:string|null,remove:boolean):void {
    if(!info.hit)return
    info.preventDefault()
    const s=useStore.getState(),picked=s.station.modules.find(m=>m.id===pickedId&&m.type==='road')
    const z=picked?.z??info.hit.cell[2],graph=getRoadDocument(s.station.modules),p:RoadPosition=[info.hit.point?.[0]??info.hit.cell[0],info.hit.point?.[1]??info.hit.cell[1]]
    const snap=roadSnap(graph,[Math.round(p[0]),Math.round(p[1])],z,ROAD_NODE_SNAP_RADIUS,this.shown),start=snap.point
    const segment=remove?roadSegmentAt(graph,p,z,pickedId??undefined):undefined
    if(remove&&(!segment||!this.shown(segment))){s.setNotice(msg('no_road_to_remove'));return}
    if(!remove&&snap.road) useStore.setState({roadWidth:roadLayout(snap.road).width,roadDirection:snap.road.cfg.direction})
    this.ctx.drag.current={active:true,road:true,button:info.button,mode:remove?'remove':'add',anchor:[start[0],start[1],z],roadStart:start,
      roadRemoveId:segment?.road.id,z,shift:false,sx:info.clientX,sy:info.clientY,downTime:performance.now()}
    this.onMove(info)
  }
  onMove(info:PointerInfo):void {
    if(!info.hit)return
    this.ctx.hover.current={cell:info.hit.cell,place:info.hit.place,solid:info.hit.solid,point:[info.hit.point?.[0]??info.hit.cell[0],info.hit.point?.[1]??info.hit.cell[1]]}
    const d=this.ctx.drag.current
    if(d?.road){d.lx=info.clientX;d.ly=info.clientY}
    this.draw()
    if(!d)this.ctx.showMeasure(info.clientX,info.clientY,msg('road_node_hint'))
  }
  override refreshHover():void {
    const s=useStore.getState()
    if(s.tool==='module'&&s.moduleType==='road'&&this.ctx.hover.current)this.draw()
  }
  private candidate(id:string):Road|null {
    const s=useStore.getState(),d=this.ctx.drag.current,hover=this.ctx.hover.current
    if(!hover)return null
    const z=d?.road?d.z:hover.cell[2],graph=getRoadDocument(s.station.modules)
    const raw=hover.point??[hover.cell[0],hover.cell[1]],grid:RoadPosition=[Math.round(raw[0]),Math.round(raw[1])]
    const snap=roadSnap(graph,grid,z,ROAD_NODE_SNAP_RADIUS,this.shown)
    const start=d?.roadStart??snap.point,target=d?.road?snap.point:start
    const vertical=Math.abs(target[1]-start[1])>=Math.abs(target[0]-start[0])
    const end:RoadPosition=vertical?[start[0],target[1]]:[target[0],start[1]]
    const reverse=(vertical?end[1]<start[1]:end[0]<start[0])!==(s.moduleRot>=2)
    return roadBetween(start,end,z,s.roadWidth,s.roadDirection,reverse,id)
  }
  private draw():void {
    const s=useStore.getState(),d=this.ctx.drag.current,scene=this.ctx.scene(),graph=getRoadDocument(s.station.modules)
    let r:Road|undefined
    if(d?.mode==='remove'&&d.road)r=graph.segments.find(segment=>segment.road.id===d.roadRemoveId)?.road
    else r=this.candidate('road-preview')??undefined
    scene?.setGhost([], 'add');scene?.setCursor(null)
    scene?.setModulePreview(r?[r]:null,d?.mode==='remove'||!!(r&&equipmentReason(s.station.cells,s.station.modules,r)))
    scene?.setRoadNodePreview?.([...graph.nodes.values()].filter(n=>n.z===(d?.z??this.ctx.hover.current?.cell[2])&&n.segments.some(id=>this.shown(graph.byId.get(id)!))),r?.cfg.from,r?.cfg.to,r?.z)
    if(d?.road&&r)this.ctx.showMeasure(d.lx??d.sx,d.ly??d.sy,msg('road_measure',r.w,r.d,roadLayout(r).lanes))
  }
  onUp(info:PointerInfo):void {
    const d=this.ctx.drag.current;if(!d?.road)return
    if(info.hit)this.ctx.hover.current={cell:info.hit.cell,place:info.hit.place,solid:info.hit.solid,point:[info.hit.point?.[0]??info.hit.cell[0],info.hit.point?.[1]??info.hit.cell[1]]}
    const s=useStore.getState(),r=this.candidate(nextModuleId(s.station.modules,'road'))
    this.ctx.drag.current=null;this.ctx.clearMeasure();this.ctx.scene()?.setModulePreview(null)
    if(d.mode==='remove') {
      const graph=getRoadDocument(s.station.modules)
      if(graph.segments.some(segment=>segment.road.id===d.roadRemoveId))s.commit({...s.station,modules:graph.modules.filter(m=>m.id!==d.roadRemoveId)})
      else s.setNotice(msg('no_road_to_remove'))
      return
    }
    if(!r||!r.cfg.from||!r.cfg.to||Math.hypot(r.cfg.to[0]-r.cfg.from[0],r.cfg.to[1]-r.cfg.from[1])<1){s.setNotice(msg('road_nodes_distinct'));return}
    const why=equipmentReason(s.station.cells,s.station.modules,r)
    if(why)s.setNotice(equipmentRefusalNotice(why))
    else s.commit(addRoadSegment(s.station,r))
  }
}
