import test from 'node:test'
import assert from 'node:assert/strict'
import {getRoadDocument,roadBetween,roadNodeId,roadSnap} from '../src/sim/roadDocument.ts'
import {addRoadSegment,removeRoadSegment,toState} from '../src/build/model.ts'
import {emptyStation} from '../src/data/reference-station.ts'
import {serialize,parse} from '../src/persistence/save.ts'
import {getRoadNetwork} from '../src/sim/roadNetwork.ts'
import {RoadTool} from '../src/app/tools/RoadTool.ts'
import {DeleteTool} from '../src/app/tools/DeleteTool.ts'
import {useStore} from '../src/app/store.ts'
import * as THREE from 'three'
import {GhostSystem} from '../src/render/scene/systems/GhostSystem.ts'
import {roadContainsPoint,roadLayout} from '../src/sim/roads.ts'
import {ROAD_NODE_HANDLE_CAPACITY} from '../src/sim/constants.ts'
const road=(from,to,id='a',z=0)=>roadBetween(from,to,z,6,'two-way',false,id)
const state=(modules=[])=>({...toState(emptyStation()),modules})
const event=(x,y,button=0)=>({clientX:x,clientY:y,button,buttons:button===2?2:1,shiftKey:false,preventDefault(){},hit:{point:[x,y,1.025],cell:[Math.floor(x),Math.floor(y),0],place:[Math.floor(x),Math.floor(y),1],solid:true}})

test('inspector reverses only the selected one-way segment and undo restores its traffic',()=>{
  const before=useStore.getState()
  try {
    const a=roadBetween([0,0],[0,30],0,6,'one-way',false,'one-way'),b=road([20,0],[20,30],'two-way')
    useStore.setState({station:state([a,b]),past:[],future:[],selected:{kind:'module',key:a.id,label:'道路'}})
    const original=getRoadNetwork(useStore.getState().station.modules)
    useStore.getState().switchRoadDirection(a.id)
    const reversed=useStore.getState(),r=reversed.station.modules[0]
    assert.equal(r.rot,2)
    assert.deepEqual({...r,rot:a.rot},a,'nodes, footprint and settings stay unchanged')
    assert.equal(reversed.station.modules[1],b)
    assert.equal(reversed.selected.key,a.id)
    assert.equal(reversed.past.length,1)
    assert.notEqual(getRoadNetwork(reversed.station.modules),original,'traffic topology invalidates')
    useStore.getState().undo()
    assert.deepEqual(useStore.getState().station.modules[0],a)
    useStore.getState().redo()
    assert.equal(useStore.getState().station.modules[0].rot,2)
    const held=useStore.getState().station
    useStore.getState().switchRoadDirection(b.id)
    useStore.getState().switchRoadDirection('missing')
    assert.equal(useStore.getState().station,held,'two-way/missing roads do not add edits')
  } finally {useStore.setState(before)}
})

test('crossings split four editable segments around a shared node; deletion removes only an arm',()=>{
  const a=road([0,0],[0,30]),b=road([-20,15],[20,15],'b'),initial=state([a,b])
  const graph=getRoadDocument(initial.modules),centre=roadNodeId([0,15],0)
  assert.equal(graph.segments.length,4);assert.equal(graph.nodes.size,5);assert.equal(graph.nodes.get(centre).segments.length,4)
  assert.deepEqual(initial.modules,[a,b],'deriving topology never mutates the save')
  let next=removeRoadSegment(initial,[0,25],0,'a')
  let g=getRoadDocument(next.modules)
  assert.equal(g.segments.length,3);assert.equal(g.nodes.get(centre).segments.length,3)
  assert.equal(g.nodes.has(roadNodeId([0,30],0)),false,'a disconnected endpoint disappears')
  next=removeRoadSegment(next,[15,15],0);g=getRoadDocument(next.modules)
  assert.equal(g.nodes.get(centre).segments.length,2)
  next=removeRoadSegment(next,[-15,15],0);g=getRoadDocument(next.modules)
  assert.equal(g.nodes.get(centre).segments.length,1,'the junction remains while its last segment exists')
  for(const [dx,dy] of [[-2.9,-2.9],[-2.9,2.9],[2.9,-2.9],[2.9,2.9]])assert.ok(roadContainsPoint(g.segments.map(s=>s.road),dx,15+dy,0),'the final attached arm still owns the whole junction square')
  next=removeRoadSegment(next,[0,5],0);g=getRoadDocument(next.modules)
  assert.equal(g.nodes.size,0);assert.equal(g.segments.length,0)
})

test('extension reuses an endpoint, preserves its identity after deletion and keeps traffic continuous',()=>{
  const initial=state([road([0,0],[0,30])]),key=roadNodeId([0,30],0)
  const next=addRoadSegment(initial,road([0,30],[0,60],'extension')),g=getRoadDocument(next.modules)
  assert.equal(g.nodes.size,3);assert.equal(g.nodes.get(key).segments.length,2)
  assert.deepEqual(roadSnap(g,[.7,31],0).point,[0,30])
  assert.equal(getRoadNetwork(next.modules).entries.length,2,'a segment seam is not a traffic spawn point')
  const removed=removeRoadSegment(next,[0,50],0),remaining=getRoadDocument(removed.modules)
  assert.equal(remaining.nodes.get(key).segments.length,1)
  const saved=parse(serialize(next));assert.ok(saved.ok)
  assert.equal(saved.droppedModules,0);assert.equal(getRoadDocument(saved.state.modules).nodes.get(key).segments.length,2)
  const wider=addRoadSegment(initial,roadBetween([0,30],[0,60],0,12,'two-way',false,'wide'))
  const traffic=getRoadNetwork(wider.modules)
  assert.equal(traffic.entries.length,3,'a width change has only three incoming boundary lanes, with no interior spawns')
  assert.equal(traffic.junctions.length,1);assert.equal(traffic.junctions[0].uncontrolled,true)
})

test('legacy rectangular roads migrate without changing their outer pavement, and graph preparation is cached',()=>{
  const a={id:'legacy',type:'road',x:0,y:0,z:0,rot:0,w:6,d:40,cfg:{direction:'two-way'}}
  let scans=0
  const modules=new Proxy([a],{get(t,k,r){if(k==='filter')scans++;return Reflect.get(t,k,r)}})
  const g=getRoadDocument(modules),prepared=scans
  for(let i=0;i<1000;i++)assert.equal(getRoadDocument(modules),g)
  assert.equal(scans,prepared,'warm previews never scan or split the document again')
  assert.deepEqual([g.segments[0].road.x,g.segments[0].road.y,g.segments[0].road.w,g.segments[0].road.d],[0,0,6,40])
  assert.deepEqual(g.segments[0].road.cfg.from,[3,3]);assert.deepEqual(g.segments[0].road.cfg.to,[3,37])
  const migrated=addRoadSegment(state([a]),road([3,20],[25,20],'branch'))
  assert.equal(getRoadDocument(migrated.modules).nodes.get(roadNodeId([3,20],0)).segments.length,3)
  const same=getRoadDocument(migrated.modules)
  assert.equal(getRoadDocument(same.modules).segments.length,same.segments.length,'splitting is idempotent')
  const duplicate=addRoadSegment(state([road([0,0],[0,30])]),road([0,0],[0,30],'duplicate'))
  assert.equal(getRoadDocument(duplicate.modules).segments.length,1)
  assert.equal(getRoadDocument([road([0,0],[0,30]),road([-20,15],[20,15],'upper',4)]).nodes.size,4)
})

test('a snapped start keeps the selected width and direction, previews without edits, commits a branch once and undoes/redoes shared nodes',()=>{
  const initial=state([road([0,0],[0,30])]),drag={current:null},hover={current:null};let picks=0,preview,nodes
  const scene={setGhost(){},setCursor(){},setModulePreview(m){preview=m},setRoadNodePreview(n){nodes=n}}
  useStore.setState({station:initial,past:[],future:[],tool:'module',moduleType:'road',roadWidth:18,roadDirection:'one-way',moduleRot:0})
  const tool=new RoadTool({scene:()=>scene,pickModule:()=>{picks++;return 'a'},drag,hover,clearMeasure(){},showMeasure(){}})
  tool.onDown(event(0,15));tool.onMove(event(20,15))
  assert.equal(picks,1);assert.equal(useStore.getState().roadWidth,18);assert.equal(useStore.getState().roadDirection,'one-way')
  assert.deepEqual(preview[0].cfg.from,[0,15]);assert.deepEqual(preview[0].cfg.to,[20,15]);assert.equal(nodes.length,2)
  assert.equal(roadLayout(preview[0]).width,18,'starting on a road body keeps the selected width')
  assert.equal(preview[0].cfg.direction,'one-way','and the selected traffic direction')
  assert.equal(useStore.getState().past.length,0);assert.equal(useStore.getState().station,initial)
  tool.onUp(event(20,15));assert.equal(useStore.getState().past.length,1)
  const g=getRoadDocument(useStore.getState().station.modules),built=g.segments.find(s=>s.road.cfg.from?.[1]===15&&s.road.cfg.to?.[0]===20)
  assert.equal(roadLayout(built.road).width,18,'the committed branch keeps the selected width too')
  assert.equal(built.road.cfg.direction,'one-way')
  assert.equal(g.nodes.get(roadNodeId([0,15],0)).segments.length,3)
  useStore.getState().undo();assert.deepEqual(useStore.getState().station,initial)
  useStore.getState().redo();assert.equal(getRoadDocument(useStore.getState().station.modules).segments.length,3)
})

test('starting on a node keeps the selected width and direction rather than the incident arm settings',()=>{
  const initial=state([road([0,0],[0,30])]),drag={current:null},hover={current:null};let preview
  const scene={setGhost(){},setCursor(){},setModulePreview(m){preview=m},setRoadNodePreview(){}}
  useStore.setState({station:initial,past:[],future:[],tool:'module',moduleType:'road',roadWidth:18,roadDirection:'one-way',moduleRot:0})
  const tool=new RoadTool({scene:()=>scene,pickModule:()=>null,drag,hover,clearMeasure(){},showMeasure(){}})
  tool.onDown(event(0,30));assert.deepEqual(drag.current.roadStart,[0,30],'the endpoint node inside the snap radius is reused')
  tool.onMove(event(20,30))
  assert.equal(useStore.getState().roadWidth,18);assert.equal(useStore.getState().roadDirection,'one-way')
  assert.equal(roadLayout(preview[0]).width,18);assert.equal(preview[0].cfg.direction,'one-way')
  tool.onUp(event(20,30))
  const g=getRoadDocument(useStore.getState().station.modules)
  assert.equal(g.nodes.get(roadNodeId([0,30],0)).segments.length,2,'the branch shares the snapped node')
  const built=g.segments.find(s=>s.road.cfg.from?.[0]===0&&s.road.cfg.from?.[1]===30)
  assert.equal(roadLayout(built.road).width,18,'a 6 m incident arm does not rewrite the selected width')
  assert.equal(built.road.cfg.direction,'one-way','nor its two-way traffic direction')
})

test('the delete tool resolves one scene pick and removes a single virtual legacy segment',()=>{
  const a={id:'legacy',type:'road',x:0,y:0,z:0,rot:0,w:6,d:40,cfg:{direction:'two-way'}},b={...a,id:'cross',x:-15,y:15,w:36,d:6,rot:1}
  const initial=state([a,b]),drag={current:null},hover={current:null};let picks=0,preview
  const scene={setGhost(){},setCursor(){},setCollisionHighlight(){},setModulePreview(m){preview=m},setRoadNodePreview(){}}
  useStore.setState({station:initial,past:[],future:[],tool:'delete'})
  const tool=new DeleteTool({scene:()=>scene,pickModule:()=>{picks++;return 'legacy'},drag,hover,clearMeasure(){},showMeasure(){}})
  tool.onDown(event(3,30));assert.equal(picks,1);assert.ok(preview[0].d<40)
  tool.onUp(event(3,30))
  const g=getRoadDocument(useStore.getState().station.modules)
  assert.equal(g.segments.length,3);assert.equal(g.nodes.get(roadNodeId([3,18],0)).segments.length,3)
  assert.equal(useStore.getState().past.length,1)
})

test('node handles reuse instance buffers, hold unchanged uploads and disappear on cancellation',()=>{
  const ctx={scene:new THREE.Scene(),activeZ:0},ghost=new GhostSystem(ctx)
  ghost.clocks={previewRigs:[]}
  ghost.modules={fenceGroups:[]}
  const nodes=[{x:0,y:0,z:0},{x:0,y:20,z:0}]
  ghost.setRoadNodePreview(nodes,[0,0],[0,30],0)
  const mesh=ctx.scene.children.find(o=>o.isInstancedMesh),geometry=mesh.geometry,version=mesh.instanceMatrix.version
  assert.equal(mesh.count,3);assert.equal(mesh.visible,true)
  ghost.setRoadNodePreview(nodes,[0,0],[0,30],0)
  assert.equal(mesh.instanceMatrix.version,version)
  ghost.clearModulePreview();assert.equal(mesh.visible,false)
  ghost.setRoadNodePreview(nodes,[0,0],[0,30],0)
  assert.equal(mesh.visible,true);assert.equal(mesh.geometry,geometry);assert.equal(mesh.instanceMatrix.version,version)
  ghost.setRoadNodePreview(Array.from({length:3000},(_,i)=>({x:i,y:0,z:0})),[5000,0],[5000,20],0)
  assert.equal(mesh.count,ROAD_NODE_HANDLE_CAPACITY);assert.equal(mesh.geometry,geometry)
  const selected=new THREE.Matrix4();mesh.getMatrixAt(0,selected)
  assert.equal(selected.elements[12],5000,'selected endpoints survive marker-capacity truncation')
  let disposed=0;mesh.addEventListener('dispose',()=>disposed++)
  ghost.dispose();assert.equal(disposed,1);assert.ok(!ctx.scene.children.includes(mesh))
})

test('hidden road nodes cannot snap or delete, and a refused segment makes no edit',()=>{
  const initial=state([road([0,0],[0,30])]),drag={current:null},hover={current:null};let preview
  const scene={isModuleVisible:()=>false,setGhost(){},setCursor(){},setModulePreview(m){preview=m},setRoadNodePreview(){}}
  useStore.setState({station:initial,past:[],future:[],tool:'module',moduleType:'road',roadWidth:6,roadDirection:'two-way',moduleRot:0})
  const tool=new RoadTool({scene:()=>scene,pickModule:()=>null,drag,hover,clearMeasure(){},showMeasure(){}})
  tool.onDown(event(0,31,2));assert.equal(drag.current,null);assert.equal(useStore.getState().past.length,0)
  tool.onDown(event(1,31));assert.deepEqual(drag.current.roadStart,[1,31])
  tool.onUp(event(1,31));assert.equal(useStore.getState().past.length,0)
  const hole=state([]);hole.cells=[{x:0,y:10,z:0,fill:'void'}]
  useStore.setState({station:hole,past:[],future:[]})
  tool.onDown(event(0,0));tool.onMove(event(0,20));assert.ok(preview)
  tool.onUp(event(0,20));assert.equal(useStore.getState().past.length,0);assert.ok(useStore.getState().notice)
})
