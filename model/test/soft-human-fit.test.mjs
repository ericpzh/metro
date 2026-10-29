import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createImportedSoftHuman,SOFT_BASE_URL} from '../src/soft-human/imported-base.js';
import {createWardrobe,OUTFITS} from '../src/soft-human/wardrobe.js';
import {createMotion} from '../src/soft-human/character.js';
import {STRAP_TORSO} from '../src/soft-human/torso-fit.js';

const bytes=readFileSync(new URL('../public'+SOFT_BASE_URL,import.meta.url));
const create=()=>createImportedSoftHuman(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));

test('clothing covers the shoulder fan and ends at the measured narrow neck',()=>{
 const c=create(),w=createWardrobe(c),neck=c.anatomy;
 assert(neck.neck.radiusX<.07&&neck.neck.radiusZ<.09,'landmark is the narrow neck, not the shoulder fan');
 assert(neck.necklineY>1.20&&neck.necklineY<1.23);
 for(const outfit of OUTFITS.filter(o=>o.id!=='plain')){
  w.set(outfit.id,'none');const g=c.body.geometry,p=g.attributes.position;
  let collar=0;
  for(const group of g.groups)for(let i=group.start;i<group.start+group.count;i++){
   const x=p.getX(i),y=p.getY(i);
   if(group.materialIndex===0&&Math.abs(x)<.23&&y>1.10)assert(y>neck.necklineY-1e-6,`${outfit.id}: shoulder must be clothed`);
   if(group.materialIndex!==0&&Math.abs(y-neck.necklineY)<1e-6){collar++;assert(Math.abs(x)<.09,'collar hugs the small neck circumference')}
  }
  assert(collar>10,'neckline is split into exportable garment triangles');
 }
});

test('mathematical straps keep constant width, continuous frames and a level elliptical return',()=>{
 const c=create(),w=createWardrobe(c),m=createMotion(c),v=new T.Vector3();
 for(const bag of ['daypack','hiking','shoulder-left','shoulder-right','crossbody-left','crossbody-right']){
  c.setAge('adult');m.reset();w.set('commuter',bag);
  const spans=new Map();
  for(const strap of w.straps){
   const p=strap.geometry.attributes.position,centers=strap.userData.centerline.map(p=>new T.Vector3(...p));let lastAcross;
   assert(strap.userData.mathematicalStrap,'constructed directly from the mathematical path');
   for(let row=0;row<centers.length;row++){
    const a=new T.Vector3().fromBufferAttribute(p,row*4),b=new T.Vector3().fromBufferAttribute(p,row*4+1),across=b.sub(a).normalize();
    assert(Math.abs(new T.Vector3().fromBufferAttribute(p,row*4).distanceTo(v.fromBufferAttribute(p,row*4+1))-strap.userData.width)<1e-6,'constant band width');
    if(lastAcross)assert(across.dot(lastAcross)>.95,`${bag}: ribbon frame cannot flip or twist at row ${row}`);lastAcross=across;
   }
   if(bag==='daypack'||bag==='hiking'){
    const lower=centers.filter(p=>Math.abs(p.y-STRAP_TORSO.returnY)<1e-8);assert(lower.length>10);
    for(const p of lower)assert(Math.abs(Math.abs(p.x/STRAP_TORSO.returnWidth)**STRAP_TORSO.exponent+Math.abs((p.z-STRAP_TORSO.returnCenterZ)/STRAP_TORSO.returnDepth)**STRAP_TORSO.exponent-1)<1e-6,'lower return is one exact superellipse, without local bumps');
   }
   const ring=row=>{const q=new T.Vector3();for(let i=0;i<4;i++)q.add(new T.Vector3().fromBufferAttribute(p,row*4+i));return q.multiplyScalar(.25)};spans.set(strap,ring(50).distanceTo(ring(100)));
  }
  for(const age of ['adult','child'])for(const mode of ['idle','walk-slow','walk','walk-fast','reach','float'])for(const t of [.2,1,2]){
   c.setAge(age);m.state.mode=mode;m.seek(t);w.update();
   for(const strap of w.straps){
    const center=row=>{const p=new T.Vector3();for(let i=0;i<4;i++)p.add(strap.getVertexPosition(row*4+i,v));return p.multiplyScalar(.25)};
    assert(Math.abs(center(50).distanceTo(center(100))-spans.get(strap))<1e-6,'arm gestures cannot stretch or pull out a torso-owned strap');
    if(bag==='daypack'||bag==='hiking'){
     const inner=strap.getVertexPosition(0,new T.Vector3()).add(strap.getVertexPosition(1,v)).multiplyScalar(.5).applyMatrix4(strap.matrixWorld);
     const attachment=w.pack.localToWorld(new T.Vector3(...strap.children[0].userData.bagAnchor));
     assert(inner.distanceTo(attachment)<1e-5,'upper ribbon endpoint remains inside the actual bag attachment');
    }else{
     for(const link of strap.children){
      const row=link.userData.strapRow,inner=strap.getVertexPosition(row*4,new T.Vector3()).add(strap.getVertexPosition(row*4+1,v)).multiplyScalar(.5).applyMatrix4(strap.matrixWorld);
      const attachment=w.pack.localToWorld(new T.Vector3(...link.userData.bagAnchor));
      assert(inner.distanceTo(attachment)<1e-5,`${bag}/${age}/${mode}: both ends stay exactly on the bag anchors`);
     }
    }
   }
  }
 }
});

test('crossbody front edges clear the shirt throughout walking at both ages',()=>{
 const c=create(),w=createWardrobe(c),m=createMotion(c),ray=new T.Raycaster();
 for(const bag of ['crossbody-left','crossbody-right'])for(const age of ['adult','child'])for(const mode of ['idle','walk-slow','walk','walk-fast'])for(const t of [.2,.7,1.3]){
  c.setAge(age);w.set('commuter',bag);m.state.mode=mode;m.seek(t);w.update();c.body.computeBoundingSphere();
  for(const strap of w.straps)for(let row=0;row<=192;row+=4)for(const edge of [0,1]){
   const point=strap.getVertexPosition(row*4+edge,new T.Vector3()).applyMatrix4(strap.matrixWorld),local=c.body.worldToLocal(point.clone());
   if(local.z<.02||local.y<.76||local.y>1.09||Math.abs(local.x)>.27)continue;
   ray.set(c.body.localToWorld(new T.Vector3(local.x,local.y,1)),new T.Vector3(0,0,-1));const hit=ray.intersectObject(c.body,false)[0];
   if(hit)assert(point.z-hit.point.z>.002,`${bag}/${age}/${mode}/${t}: front ribbon edge stays outside the shirt`);
  }
 }
});

test('backpacks sit behind the torso instead of hiding the strap joins inside it',()=>{
 const c=create(),w=createWardrobe(c);
 for(const bag of ['daypack','hiking']){
  w.set('commuter',bag);w.update();const body=w.pack.getObjectByName('Pack body'),box=new T.Box3().setFromObject(body);
  assert(box.max.z<-.215,'body-facing bag surface clears the back of the torso');
  for(const strap of w.straps){
   const anchor=w.pack.localToWorld(new T.Vector3(...strap.children[0].userData.bagAnchor));
   assert(anchor.z<-.215,'upper attachment stays outside the torso');assert(box.containsPoint(anchor),'attachment is buried slightly inside the bag shell');
  }
 }
});

test('sleeve cuffs use one plane perpendicular to each forearm',()=>{
 const c=create(),w=createWardrobe(c);
 for(const outfit of OUTFITS.filter(o=>!['plain','beach'].includes(o.id)&&o.sleeve!=='short')){
  w.set(outfit.id,'none');const g=c.body.geometry,p=g.attributes.position;
  for(const cuff of c.anatomy.cuffs){
   let boundary=0;
   for(const group of g.groups)for(let i=group.start;i<group.start+group.count;i+=3){
    const points=[0,1,2].map(j=>[p.getX(i+j),p.getY(i+j),p.getZ(i+j)]);
    if(points.some(p=>p[0]*cuff.side<.37))continue;
    const distances=points.map(cuff.field);
    assert(!distances.some(d=>d<-.000001)||!distances.some(d=>d>.000001),'triangles are clipped at the wrist plane');
    if(distances.reduce((a,b)=>a+b,0)>1e-5)assert.equal(group.materialIndex,0,'no sleeve fragments on the hand');
    if(group.materialIndex!==0)boundary+=distances.filter(d=>Math.abs(d)<1e-6).length;
   }
   assert(boundary>5,'complete clean cuff boundary is present');
  }
 }
});

test('new shoulder-fit ribbons and short connections survive a posed GLB export',async()=>{
 globalThis.FileReader??=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(data=>{this.result=data;this.onloadend?.()})}};
 const c=create(),w=createWardrobe(c),m=createMotion(c);
 for(const [age,bag,mode] of [['adult','hiking','walk'],['child','crossbody-right','reach']]){
  c.setAge(age);w.set('commuter',bag);m.state.mode=mode;m.seek(1);w.update();
  const expected=w.straps.map(strap=>({name:strap.name.replaceAll(' ','_'),points:[0,80,200].map(i=>strap.getVertexPosition(i,new T.Vector3()).applyMatrix4(strap.matrixWorld))}));
  const bytes=await new GLTFExporter().parseAsync(c.body,{binary:true}),loaded=await new GLTFLoader().parseAsync(bytes,'');
  loaded.scene.updateMatrixWorld(true);loaded.scene.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.update()});
  for(const entry of expected){
   const strap=loaded.scene.getObjectByName(entry.name);assert(strap?.isSkinnedMesh);assert.equal(strap.children.length,2);
   [0,80,200].forEach((i,j)=>assert(strap.getVertexPosition(i,new T.Vector3()).applyMatrix4(strap.matrixWorld).distanceTo(entry.points[j])<1e-5,'downloaded strap keeps the live shoulder fit'));
  }
 }
});
