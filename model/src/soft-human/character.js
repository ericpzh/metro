import * as T from 'three';
import {MarchingCubes} from 'three/addons/objects/MarchingCubes.js';
import {WALK_PROFILES} from '../../../game/src/sim/constants.ts';
import {poseRelaxedArm} from './relaxed-arms.js';

// Original implicit sculpt: smooth unions produce one skin, including the armpits
// and crotch. No downloaded game geometry or textures are used.
const smooth=(a,b,k=.075)=>{const h=Math.max(k-Math.abs(a-b),0)/k;return Math.min(a,b)-h*h*k*.25};
const ell=(x,y,z,c,r)=>{const q=[(x-c[0])/r[0],(y-c[1])/r[1],(z-c[2])/r[2]];return (Math.hypot(...q)-1)*Math.min(...r)};
const capsule=(p,a,b,r,endRadius=r)=>{const d=b.map((v,i)=>v-a[i]),v=p.map((v,i)=>v-a[i]);const t=T.MathUtils.clamp(v.reduce((s,v,i)=>s+v*d[i],0)/d.reduce((s,v)=>s+v*v,0),0,1);return Math.hypot(...v.map((v,i)=>v-d[i]*t))-T.MathUtils.lerp(r,endRadius,t)};
export function createSoftHuman(){
 const material=new T.MeshStandardMaterial({color:0xf2f1ed,roughness:.83});
 const n=96,mc=new MarchingCubes(n,material,false,false,100000);mc.isolation=0;
 const scale=1.23,center=.95;
 for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const p=[(x/n*2-1)*scale,(y/n*2-1)*scale+center,(z/n*2-1)*scale];
  // One unbroken torso profile avoids the chest/waist/hip lobes of joined
  // ellipsoids. The references have a soft tubular body, not defined anatomy.
  let d=capsule([p[0],p[1],p[2]/.72],[0,.75,0],[0,1.105,0],.195);
  d=smooth(d,capsule(p,[0,1.25,0],[0,1.43,0],.057),.035);
  d=smooth(d,ell(...p,[0,1.535,0],[.155,.175,.15]),.025);
  for(const s of [-1,1]){
   d=smooth(d,capsule(p,[s*.155,1.22,0],[s*.61,.76,.025],.064,.045),.09);
   d=smooth(d,ell(...p,[s*.62,.745,.03],[.048,.060,.046]),.018);
   d=smooth(d,capsule(p,[s*.11,.65,0],[s*.17,.10,.025],.079),.065);
  }
  mc.field[x+n*y+n*n*z]=-d;
 }
 mc.update();
 let geometry=new T.BufferGeometry();
 geometry.setAttribute('position',new T.Float32BufferAttribute(mc.positionArray.slice(0,mc.count*3),3));
 geometry.setAttribute('normal',new T.Float32BufferAttribute(mc.normalArray.slice(0,mc.count*3),3));geometry.normalizeNormals();geometry.scale(scale,scale,scale);geometry.translate(0,center,0);geometry=mergeVertices(geometry,1e-5);mc.geometry.dispose();
 const body=new T.SkinnedMesh(geometry,material);body.name='Soft human continuous skin';body.castShadow=true;
 const bones=[],segments=[];
 function bone(name,pos,parent,end){const b=new T.Bone();b.name=name;const world=new T.Vector3(...pos);b.position.copy(world);if(parent){b.position.sub(parent.userData.rest);parent.add(b)}else body.add(b);b.userData.rest=world;bones.push(b);segments.push([world,new T.Vector3(...end)]);return b}
 const hips=bone('Hips',[0,.72,0],null,[0,.97,0]);
 const chest=bone('Chest',[0,.98,0],hips,[0,1.3,0]);
 const head=bone('Head',[0,1.38,0],chest,[0,1.71,0]);
 const limbs=[];
 for(const s of [-1,1]){
  const arm=bone(`Arm${s}`,[s*.18,1.22,0],chest,[s*.41,1.03,0]);
  const fore=bone(`Forearm${s}`,[s*.41,1.03,0],arm,[s*.63,.74,.04]);
  const leg=bone(`Thigh${s}`,[s*.11,.65,0],hips,[s*.14,.4,0]);
  const shin=bone(`Shin${s}`,[s*.14,.4,0],leg,[s*.17,.1,.025]);limbs.push({s,arm,fore,leg,shin});
 }
 body.updateMatrixWorld(true);body.bind(new T.Skeleton(bones));
 const ids=[],weights=[],v=new T.Vector3(),closest=new T.Vector3(),line=new T.Line3();
 for(let i=0;i<geometry.attributes.position.count;i++){
  v.fromBufferAttribute(geometry.attributes.position,i);
  const ranked=segments.map(([a,b],j)=>{line.set(a,b);line.closestPointToPoint(v,true,closest);return {j,w:1/Math.pow(.035+v.distanceTo(closest),5)}}).sort((a,b)=>b.w-a.w).slice(0,4);
  const sum=ranked.reduce((s,x)=>s+x.w,0);for(const x of ranked){ids.push(x.j);weights.push(x.w/sum)}
 }
 geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute(ids,4));geometry.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));
 const cap=new T.Group();cap.name='Soft cap';
 const crown=new T.Mesh(new T.SphereGeometry(.164,40,24,0,Math.PI*2,0,Math.PI*.53),material);crown.scale.set(1,.65,1);crown.position.y=.24;cap.add(crown);
 const brim=new T.Mesh(new T.TorusGeometry(.16,.019,12,64),material);brim.rotation.x=Math.PI/2;brim.position.set(0,.23,.012);brim.scale.set(1,1.13,1);cap.add(brim);head.add(cap);
 const rig=new T.SkeletonHelper(body);rig.visible=false;
 const appearance={age:'adult'};
 function setAge(age){if(!['adult','child'].includes(age))throw Error('Unknown age');appearance.age=age;body.scale.set(age==='child'?.70:1,age==='child'?.65:1,age==='child'?.70:1);head.scale.setScalar(age==='child'?1.08:1);body.updateMatrixWorld(true)}
 return {body,hips,chest,head,limbs,cap,rig,bones,appearance,setAge};
}

// Fixed-step damped angular servos illustrate pose-following lag. These are not
// collision-solving rigid bodies; full active ragdolls need joint constraints.
export function createMotion(character){
 const channels=new Map();let time=0,acc=0;
 const state={mode:'walk',softness:.65,speed:1};
 const idleWrists=character.restArmAngle===0?character.limbs.map(l=>{const end=new T.Object3D();end.position.copy(l.wrist);l.fore.add(end);return end}):[];
 function idleArms(){
  if(state.mode!=='idle'||!idleWrists.length)return;
  character.limbs.forEach((l,i)=>{l.arm.rotation.set(0,0,0);l.fore.rotation.set(0,0,0);poseRelaxedArm(character,l,idleWrists[i])});
  character.body.updateMatrixWorld(true);character.body.skeleton.update();
 }
 function drive(b,axis,target,dt){const key=b.name+axis;let c=channels.get(key);if(!c){c={x:0,v:0};channels.set(key,c)}const k=110-85*state.softness,d=2*Math.sqrt(k)*(.95-.4*state.softness);c.v+=(k*(target-c.x)-d*c.v)*dt;c.x+=c.v*dt;b.rotation[axis]=c.x}
 function step(dt){time+=dt*state.speed;const profile=WALK_PROFILES[state.mode==='walk-slow'?0:state.mode==='walk-fast'?2:1],stride=profile.speed/WALK_PROFILES[1].speed,p=time*Math.PI*2/profile.cycleSeconds,w=['walk','walk-slow','walk-fast'].includes(state.mode),reach=state.mode==='reach',fall=state.mode==='float';
  drive(character.hips,'z',w?.07*Math.sin(p):fall?.24*Math.sin(p*.5):.025*Math.sin(p*.4),dt);
  drive(character.chest,'z',0,dt);drive(character.chest,'x',w?.09:fall?-.22:0,dt);drive(character.head,'z',-.09*Math.sin(p*.5),dt);
  character.body.position.y=(fall?.30+.08*Math.sin(p*.6):w?.028*(1-Math.cos(p*2)):0)*character.body.scale.y;
  for(const {s,arm,fore,leg,shin} of character.limbs){const a=p+(s<0?Math.PI:0);
   if(idleWrists.length){arm.rotation.y=0;fore.rotation.y=fore.rotation.z=0;}
   drive(leg,'x',w?.45*stride*Math.sin(a):fall?.3*Math.sin(a*.6):0,dt);
   drive(shin,'x',w?Math.max(0,-Math.sin(a))*.65:fall?.3:0,dt);
   const carrying=character.carry?.side===s;
   drive(arm,'x',w?-.4*stride*Math.sin(a-.35):reach?-.35:fall?-.5:0,dt);
   // The selected FBX already has the outward A-pose baked into its bind
   // geometry. Only swing forward/back; do not lower that rest angle again.
   drive(arm,'z',reach?s*1.75:fall?s*.7:-s*(character.restArmAngle??.60),dt);
   drive(fore,'x',reach?-.25:w?-.15-.18*Math.sin(a-.7):fall?-.4:-.08,dt);
  }
  idleArms();
 }
 function reset(){time=acc=0;channels.clear();character.resetPose?.();for(const b of character.bones)b.rotation.set(0,0,0);character.hips.position.copy(character.hips.userData.rest);character.body.position.set(0,0,0);character.body.rotation.set(0,0,0);idleArms()}
 return {state,update(dt){acc+=Math.min(Math.max(dt,0),.1);while(acc>=1/120){step(1/120);acc-=1/120}},push(){for(const b of [character.chest,character.head,...character.limbs.map(x=>x.arm)]){const key=b.name+'z';let c=channels.get(key);if(!c){c={x:0,v:0};channels.set(key,c)}c.v+=5}},reset,seek(t){reset();const speed=state.speed;state.speed=1;for(let i=0;i<Math.round(Math.max(0,Math.min(t,12))*120);i++)step(1/120);state.speed=speed},get time(){return time}};
}

import {mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';





