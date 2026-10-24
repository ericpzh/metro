import * as THREE from 'three';
import {createModelMaterials} from '../../game/src/render/models/PieceBuilder.ts';
import {BenchModel} from '../../game/src/render/models/pieces/BenchModel.ts';
import {ShelfModel} from '../../game/src/render/models/pieces/ShelfModel.ts';
import {TvmModel} from '../../game/src/render/models/pieces/TvmModel.ts';
import {VendingModel} from '../../game/src/render/models/pieces/VendingModel.ts';
import {GateModel,setGateWing} from '../../game/src/render/models/pieces/GateModel.ts';
import {SinkModel} from '../../game/src/render/models/pieces/SinkModel.ts';
import {CubicleModel} from '../../game/src/render/models/pieces/CubicleModel.ts';
import {DoorModel} from '../../game/src/render/models/pieces/DoorModel.ts';
import {EscalatorModel} from '../../game/src/render/models/pieces/EscalatorModel.ts';
import {LiftModel} from '../../game/src/render/models/pieces/LiftModel.ts';
import {PsdModel} from '../../game/src/render/models/pieces/PsdModel.ts';
import {smooth,interactionFrame} from './animation/interactions.js';

// Reuse production builders without touching the station document or worker.
export function createInteractionEquipment(scene){
 const mats=createModelMaterials(),ctx={mats,preview:true,data:{name:'Model station',modules:[],cells:[],lines:[]},trackCells:new Set(),finish:()=>mats.steel,owned:[]};
 const root=new THREE.Group();scene.add(root);
 let current,gate,door,doorRest,water,escalator,rail;
 function clear(){
  const geometries=new Set(),materials=new Set(ctx.owned),textures=new Set();ctx.owned.length=0;
  root.traverse(n=>{if(!n.isMesh)return;geometries.add(n.geometry);for(const m of Array.isArray(n.material)?n.material:[n.material])if(!Object.values(mats).includes(m)){materials.add(m);if(m.map)textures.add(m.map)}});
  geometries.forEach(g=>g.dispose());materials.forEach(m=>{if(m.map)textures.add(m.map);m.dispose()});textures.forEach(t=>t.dispose());root.clear();gate=door=water=escalator=rail=null;
 }
 function build(Builder,type,cfg={},position=[0,0,.85],rotation=Math.PI){
  const mod={id:'interaction-preview',type,x:0,y:0,z:-1,rot:0,w:1,h:1,cfg,from:{x:0,y:0,z:-1},to:{x:3,y:0,z:0}};
  if(type==='lift')mod.to={x:0,y:0,z:4};
  if(type==='platform-edge'){mod.w=3;mod.cfg={side:'left',psd:'half',...cfg};}
  const object=new Builder(ctx).build(mod);object.position.set(0,0,0);
  const axes=new THREE.Group();axes.rotation.x=-Math.PI/2;axes.add(object);
  const placed=new THREE.Group();placed.add(axes);placed.rotation.y=rotation;placed.position.set(...position);root.add(placed);return object;
 }
 function box(w,h,d,color){return new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshBasicMaterial({color}));}
 function select(id){
  if(current===id)return;current=id;clear();
  if(id==='sit')build(BenchModel,'bench',{variant:'steel-1'},[0,0,-.13],0);
  if(id==='shop')build(ShelfModel,'shelf',{variant:'white-tall'});
  if(id==='ticket')build(TvmModel,'tvm');
  if(id==='vending')build(VendingModel,'vending');
  if(id==='qr'||id==='card')gate=build(GateModel,'gate',{variant:'old',dir:'both'},[.01,0,.85]);
  if(id==='wash'){
   build(SinkModel,'sink',{},[0,0,.5],0);water=box(.012,.17,.012,0x96ccdf);water.position.set(0,.89,.59);root.add(water);
  }
  if(id==='toilet'){
   const toilet=build(CubicleModel,'cubicle',{},[0,0,-.03],0);
   // Cutaway inspection retains the actual sanitary fixture.
   toilet.traverse(n=>{if(['cubicle-partition','cubicle-door','cubicle-header','cubicle-jamb'].includes(n.name)||Math.abs(n.position.x)>.29)n.visible=false});
  }
  if(id==='door'){
   const object=build(DoorModel,'door',{variant:'wood-1'},[0,0,.85]);
   // Put moving fittings on the same hinge as the broad leaf.
   const meshes=object.children.filter(n=>n.isMesh),leaf=meshes.find(n=>n.geometry.parameters?.depth>1&&n.geometry.parameters?.width>.5);
   if(leaf){door=new THREE.Group();door.name='interaction-door-hinge';door.position.set(-.42,leaf.position.y,0);object.add(door);object.updateMatrixWorld(true);for(const n of meshes)if(n===leaf||(n.geometry.parameters?.depth<.5&&n.geometry.parameters?.width<.9&&n.position.z>=.15&&Math.abs(n.position.y-leaf.position.y)<.12))door.attach(n);doorRest=door.rotation.z;}
  }
  if(id==='escalator'){escalator=build(EscalatorModel,'escalator',{width:1,dir:'up'},[0,0,0],-Math.PI/2);escalator.children.filter(n=>n.material===mats.ledGreen).forEach(n=>n.visible=false);root.updateMatrixWorld(true);rail=escalator.children.filter(n=>n.material===mats.handrail&&n.geometry.parameters?.width>1).find(n=>n.getWorldPosition(new THREE.Vector3()).x>0);}
  if(id==='lift'){
   const lift=build(LiftModel,'lift',{style:'steel',stops:[-1,4]},[0,0,.85]);
   // Inspect the cabin through its outer shell.
   lift.traverse(n=>{if(n.isMesh&&(n.geometry.parameters?.depth>2.5||n.name.includes('door-leaf')))n.visible=false});
   const panel=box(.16,.42,.035,0x343b45);panel.position.set(.42,1.12,.59);root.add(panel);
   for(let i=0;i<4;i++){const button=box(.045,.045,.015,i===1?0x79c2a4:0xd2d7d9);button.position.set((i%2-.5)*.065,Math.floor(i/2)*.08-.04,-.025);panel.add(button);}
  }
  if(id==='queue'){const psd=build(PsdModel,'platform-edge',{},[-1,0,1.4]);psd.position.z=-1;}

 }
 return {root,select,anchors(id,t){
  if(id!=='escalator'||!rail)return {};
  t=interactionFrame(id,t).t;
  root.updateMatrixWorld(true);
  // The rail is offset along the incline's normal, which puts it behind the
  // foot at the same longitudinal parameter. Reach farther up the belt so
  // the palm rests ahead of the shoulder, with room left before the end curve.
  const len=rail.geometry.parameters.width,along=.15+(len-1.3)*smooth(1,9,t),lead=1;
  const foot=escalator.localToWorld(new THREE.Vector3(along,0,0));
  const hand=escalator.localToWorld(new THREE.Vector3(along+lead,rail.position.y,rail.position.z+.055));
  const tangent=new THREE.Vector3(1,0,0).transformDirection(escalator.matrixWorld);
  const normal=new THREE.Vector3(0,0,1).transformDirection(escalator.matrixWorld),surface=escalator.localToWorld(new THREE.Vector3(along+lead,rail.position.y,rail.position.z+.04));
  const outward=new THREE.Vector3(0,Math.sign(rail.position.y),0).transformDirection(escalator.matrixWorld);
  // Keep the wrist and cuff inside the balustrade. The empty hand reaches
  // sideways over the inner edge, instead of sending the whole forearm through.
  hand.addScaledVector(outward,-.08);
  return {foot:foot.toArray(),rail:hand.toArray(),railTangent:tangent.toArray(),railNormal:normal.toArray(),railOutward:outward.toArray(),railSurface:surface.toArray()};
 },update(id,t){
  if(gate)setGateWing(gate,smooth(3.5,4.5,t)*(1-smooth(7,7.8,t)));
  if(door)door.rotation.z=doorRest-1.4*smooth(2,4,t)*(1-smooth(7.5,9,t));
  if(water)water.visible=t>2&&t<8;

 }};
}
