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
export function createInteractionEquipment(scene,{softBody=false}={}){
 const mats=createModelMaterials(),ctx={mats,preview:true,data:{name:'Model station',modules:[],cells:[],lines:[]},trackCells:new Set(),finish:()=>mats.steel,owned:[]};
 const root=new THREE.Group();scene.add(root);
 let current,gate,door,doorRest,water,escalator,rail,seatSurface,washStep,seatStep;
 function clear(){
  const geometries=new Set(),materials=new Set(ctx.owned),textures=new Set();ctx.owned.length=0;
  root.traverse(n=>{if(!n.isMesh)return;geometries.add(n.geometry);for(const m of Array.isArray(n.material)?n.material:[n.material])if(!Object.values(mats).includes(m)){materials.add(m);if(m.map)textures.add(m.map)}});
  geometries.forEach(g=>g.dispose());materials.forEach(m=>{if(m.map)textures.add(m.map);m.dispose()});textures.forEach(t=>t.dispose());root.clear();gate=door=water=escalator=rail=seatSurface=washStep=seatStep=null;
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
  if(id==='sit'){const bench=build(BenchModel,'bench',{variant:'steel-1'},[0,0,-.13],0);seatSurface=bench.children.find(n=>n.isMesh&&Math.abs(n.geometry.parameters?.depth-.06)<.001);}
  if(id==='shop')build(ShelfModel,'shelf',{variant:'white-tall'});
  if(id==='ticket')build(TvmModel,'tvm');
  if(id==='vending')build(VendingModel,'vending');
  if(id==='qr'||id==='card')gate=build(GateModel,'gate',{variant:'old',dir:'both'},[.01,0,.85]);
  if(id==='wash'){
   build(SinkModel,'sink',{},[0,0,.5],0);water=box(.012,.17,.012,0x96ccdf);water.name='interaction-water';water.position.set(0,.89,.59);root.add(water);
   if(softBody){washStep=new THREE.Group();washStep.name='child-wash-step';root.add(washStep);const top=box(.46,.05,.48,0x9a8062);top.name='child-wash-platform';top.position.set(0,.255,.12);washStep.add(top);for(const x of [-.18,.18])for(const z of [-.06,.30]){const leg=box(.04,.23,.04,0x756451);leg.position.set(x,.115,z);washStep.add(leg)}washStep.visible=false;}
  }
  if(id==='toilet'){
   const toilet=build(CubicleModel,'cubicle',{},[0,0,-.03],0);
   seatSurface=toilet.children.find(n=>n.geometry?.type==='TorusGeometry');
   // Cutaway inspection retains the actual sanitary fixture.
   toilet.traverse(n=>{if(['cubicle-partition','cubicle-door','cubicle-header','cubicle-jamb'].includes(n.name)||Math.abs(n.position.x)>.29)n.visible=false});
  }
  if(id==='door'){
   const object=build(DoorModel,'door',{variant:'wood-1'},[0,0,.85]);
   if(object.userData.swingDoors?.length){door=object.userData.swingDoors[0].pivot;door.name='interaction-door-hinge';doorRest=door.rotation.z;}
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
 return {root,select,anchors(id,t,dimensions=null){
  if((id==='sit'||id==='toilet')&&seatSurface){
   root.updateMatrixWorld(true);const b=new THREE.Box3().setFromObject(seatSurface),height=dimensions&&dimensions.y<.9?Math.max(0,b.max.y-.555*dimensions.y+.045):0;
   if(softBody&&dimensions){if(!seatStep){seatStep=box(.44,1,.24,0x9a8062);seatStep.name='child-seat-step';root.add(seatStep)}seatStep.visible=height>0;seatStep.scale.y=Math.max(height,.001);seatStep.position.set(0,height/2,b.max.z+.12)}
   return {seatHeight:b.max.y,seatFront:b.max.z,seatBack:b.min.z,seatCenter:(b.max.z+b.min.z)/2,seatStepHeight:height};
  }
  if(id==='wash'&&dimensions&&washStep){washStep.visible=dimensions.y<.9;return {washStepHeight:washStep.visible?.28:0};}
  if(id==='door'&&dimensions){root.updateMatrixWorld(true);let thresholdHeight=0;root.traverseVisible(n=>{if(!n.isMesh||n.geometry.type!=='BoxGeometry')return;const b=new THREE.Box3().setFromObject(n);if(b.max.y<.15&&b.min.x<-.2&&b.max.x>.2)thresholdHeight=Math.max(thresholdHeight,b.max.y)});return {thresholdHeight};}
  if(id==='lift'&&dimensions){root.updateMatrixWorld(true);let floorHeight=0;root.traverseVisible(n=>{if(!n.isMesh||n.geometry.type!=='BoxGeometry')return;const b=new THREE.Box3().setFromObject(n);if(b.max.y<.30&&b.min.x<-.12&&b.max.x>.12&&b.min.z<.12&&b.max.z>0)floorHeight=Math.max(floorHeight,b.max.y)});return {floorHeight};}
  if(id!=='escalator'||!rail)return {};
  t=interactionFrame(id,t).t;
  root.updateMatrixWorld(true);
  // The rail is offset along the incline's normal, which puts it behind the
  // foot at the same longitudinal parameter. Reach farther up the belt so
  // the palm rests ahead of the shoulder, with room left before the end curve.
  const len=rail.geometry.parameters.width,along=.15+(len-1.3)*smooth(1,9,t),lead=dimensions&&dimensions.y<.9?.55:1;
  const foot=escalator.localToWorld(new THREE.Vector3(along,0,0));
  const hand=escalator.localToWorld(new THREE.Vector3(along+lead,rail.position.y,rail.position.z+.055));
  const tangent=new THREE.Vector3(1,0,0).transformDirection(escalator.matrixWorld);
  const normal=new THREE.Vector3(0,0,1).transformDirection(escalator.matrixWorld),surface=escalator.localToWorld(new THREE.Vector3(along+lead,rail.position.y,rail.position.z+.04));
  const outward=new THREE.Vector3(0,Math.sign(rail.position.y),0).transformDirection(escalator.matrixWorld);
  // Keep the wrist and cuff inside the balustrade. The empty hand reaches
  // sideways over the inner edge, instead of sending the whole forearm through.
  hand.addScaledVector(outward,-.08);
  // The rendered band has horizontal treads, not a smooth ramp. Support the
  // complete foot footprint on the highest step/comb it overlaps, including
  // the short periods in which the footprint straddles a riser.
  if(dimensions){const supportPoint=foot.clone(),matrix=new THREE.Matrix4(),instance=new THREE.Matrix4();let top=-Infinity;
  root.traverseVisible(n=>{if(!n.isMesh||n.geometry.type!=='BoxGeometry')return;n.geometry.computeBoundingBox();for(let i=0;i<(n.isInstancedMesh?n.count:1);i++){
   matrix.copy(n.matrixWorld);if(n.isInstancedMesh){n.getMatrixAt(i,instance);matrix.multiply(instance)}const b=n.geometry.boundingBox.clone().applyMatrix4(matrix);
   if(b.max.x<foot.x-.26*dimensions.x||b.min.x>foot.x+.26*dimensions.x||b.max.z<foot.z-.065*dimensions.z||b.min.z>foot.z+.12*dimensions.z||b.max.y>supportPoint.y+.35)continue;top=Math.max(top,b.max.y);
  }});
  foot.y=(Number.isFinite(top)?top:foot.y)-.018*dimensions.y+.006;}
  const bounds=new THREE.Box3().setFromObject(rail),inner=Math.min(Math.abs(bounds.min.x),Math.abs(bounds.max.x));
  if(dimensions)hand.x=Math.sign(hand.x)*(inner-.075*dimensions.x-.012-(dimensions.y<.9?.02:0));
  return {foot:foot.toArray(),rail:hand.toArray(),railInner:inner,railTangent:tangent.toArray(),railNormal:normal.toArray(),railOutward:outward.toArray(),railSurface:surface.toArray()};
 },update(id,t){
  t=interactionFrame(id,t).t;
  if(gate)setGateWing(gate,smooth(3.5,4.5,t)*(1-smooth(7,7.8,t)));
  if(door)door.rotation.z=doorRest+(softBody?1.4:-1.4)*smooth(2,4,t)*(1-smooth(7.5,9,t));
  if(water)water.visible=t>2&&t<8;

 }};
}
