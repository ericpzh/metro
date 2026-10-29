import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createImportedSoftHuman,SOFT_BASE_URL} from '../src/soft-human/imported-base.js';
import {createWardrobe,OUTFITS} from '../src/soft-human/wardrobe.js';
import {createMotion} from '../src/soft-human/character.js';
import {skirtBodyGeometry,skinWeightsOf,SKIRT_BRIDGE_TOP,SKIRT_BRIDGE_HALF_WIDTH} from '../src/soft-human/skirt.js';
import {createSoftActivityPoser,SOFT_ACTIONS} from '../src/soft-human/activities.js';
const bytes=readFileSync(new URL('../public'+SOFT_BASE_URL,import.meta.url));
const create=()=>createImportedSoftHuman(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
const outfits=OUTFITS.filter(o=>o.skirt),key=(p,i)=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e6)).join(',');

test('zero-weight padding cannot erase the selected rig\'s real bone-zero hip influence',()=>{
 const weights=skinWeightsOf({ids:[0,1,0,0],ws:[.35,.65,0,0]});
 assert.equal(weights.get(0),.35);assert.equal(weights.get(1),.65);assert.equal([...weights.values()].reduce((a,b)=>a+b),1);
});

test('skirts preserve the original waist, hips and outer legs instead of adding another shell',()=>{
 const c=create(),source=c.body.geometry,a=source.attributes;
 for(const outfit of outfits){const g=skirtBodyGeometry(source,outfit),b=g.attributes,lookup=new Map();
  for(let i=0;i<b.position.count;i++)lookup.set(key(b.position,i),i);
  for(let i=0;i<a.position.count;i++)if(a.position.getY(i)>SKIRT_BRIDGE_TOP+.001||Math.abs(a.position.getX(i))>SKIRT_BRIDGE_HALF_WIDTH+.001||a.position.getY(i)<g.userData.skirt.hem-.001){
   const j=lookup.get(key(a.position,i));assert(j!==undefined,'all protected source vertices remain in place');
   assert(new T.Vector3().fromBufferAttribute(a.normal,i).dot(new T.Vector3().fromBufferAttribute(b.normal,j))>.99999,'source smooth normals survive');
   for(let k=0;k<4;k++){assert.equal(a.skinIndex.array[i*4+k],b.skinIndex.array[j*4+k]);assert(Math.abs(a.skinWeight.array[i*4+k]-b.skinWeight.array[j*4+k])<1e-6)}
  }
  assert.equal(g.userData.skirt.construction,'source-body-bridge');assert(g.userData.skirt.bridgeVertices>0&&g.userData.skirt.capVertices>0);g.dispose();
 }
});

test('shirt and skirt are painted on the same original waist edge, with no rim or overlapping mesh',()=>{
 const c=create(),w=createWardrobe(c);
 for(const outfit of outfits){w.set(outfit.id,'crossbody-right');assert.equal(w.state.sex,'female');assert.equal(w.skirt,c.body);assert.equal(c.body.children.filter(o=>o.userData.garment==='skirt').length,0);
  const g=c.body.geometry,a=g.attributes,upper=new Map(),lower=[];
  for(const group of g.groups)for(let i=group.start;i<group.start+group.count;i++)if(Math.abs(a.position.getY(i)-.64)<1e-6&&Math.abs(a.position.getX(i))<.34){
   if([1,4].includes(group.materialIndex))upper.set(key(a.position,i),i);if(group.materialIndex===2)lower.push(i);
  }
  assert(lower.length>50);for(const i of lower){const j=upper.get(key(a.position,i));assert(j!==undefined,'both colors share the same source seam vertex');assert(new T.Vector3().fromBufferAttribute(a.normal,i).distanceTo(new T.Vector3().fromBufferAttribute(a.normal,j))<1e-5)}
 }
 w.setSex('male');assert.equal(w.state.outfit,'commuter');assert.equal(w.skirt,null);assert.equal(c.body.userData.skirt,undefined);
});

test('the new connector fills the original crotch gap on front and back with normalized leg weights',()=>{
 const c=create(),source=c.body.geometry,ray=new T.Raycaster(),original=new T.Mesh(source,new T.MeshBasicMaterial({side:T.DoubleSide}));original.updateMatrixWorld();
 for(const outfit of outfits){const g=skirtBodyGeometry(source,outfit),mesh=new T.Mesh(g,new T.MeshBasicMaterial({side:T.DoubleSide})),a=g.attributes,meta=g.userData.skirt;mesh.updateMatrixWorld();
  let added=0;for(const y of [meta.hem+.015,(meta.hem+.40)/2,.43])for(const front of [true,false]){
   ray.set(new T.Vector3(0,y,front?1:-1),new T.Vector3(0,0,front?-1:1));const hit=ray.intersectObject(mesh,false)[0];assert(hit,'bridge fills the leg gap');assert(Math.abs(hit.point.z)<.24,'bridge stays within the original body depth');if(!ray.intersectObject(original,false).length)added++;
  }
  assert(added>0,'this replaces an actual hole between the source legs');
  for(let i=meta.bridgeStart;i<meta.bridgeStart+meta.bridgeVertices;i++){let sum=0;for(let k=0;k<4;k++){const w=a.skinWeight.array[i*4+k];assert(w>=0);sum+=w}assert(Math.abs(sum-1)<1e-6)}
  assert(a.position.array.every(Number.isFinite));g.dispose();mesh.material.dispose();
 }
});

test('one-skin skirts animate deterministically through every gait and station action at both ages',()=>{
 const c=create(),w=createWardrobe(c),motion=createMotion(c),pose=createSoftActivityPoser(c),point=new T.Vector3();
 for(const outfit of outfits){w.set(outfit.id,'daypack');const bind=c.body.geometry.attributes.position.array.slice();
  for(const age of ['adult','child']){c.setAge(age);
   for(const mode of ['walk-slow','walk','walk-fast'])for(const t of [.2,.7,1.3]){motion.state.mode=mode;motion.seek(t);w.update();assert.deepEqual(c.body.geometry.attributes.position.array,bind,'ordinary skinning owns garment motion');for(const i of [0,1000,Math.floor(bind.length/3)-1])assert(c.body.getVertexPosition(i,point).toArray().every(Number.isFinite))}
   for(const action of SOFT_ACTIONS.filter(a=>a.activity)){pose(action.id,3.5,{foot:[0,.146,.13],rail:[.2255,1.288,.122]});w.update();const first=c.bones.map(b=>b.matrixWorld.toArray());pose(action.id,3.5,{foot:[0,.146,.13],rail:[.2255,1.288,.122]});w.update();assert.deepEqual(c.bones.map(b=>b.matrixWorld.toArray()),first);assert.deepEqual(c.body.geometry.attributes.position.array,bind)}
  }
 }
});

test('the integrated child skirt survives the real posed GLB export with its original body and rig',async()=>{
 globalThis.FileReader??=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(data=>{this.result=data;this.onloadend?.()})}};
 const c=create(),w=createWardrobe(c);w.set('blouse-skirt','crossbody-right');c.setAge('child');createSoftActivityPoser(c)('sit',4);w.update();
 const i=c.body.geometry.groups.find(g=>g.materialIndex===2).start,bind=new T.Vector3().fromBufferAttribute(c.body.geometry.attributes.position,i),expected=c.body.getVertexPosition(i,new T.Vector3()).applyMatrix4(c.body.matrixWorld);
 const data=await new GLTFExporter().parseAsync(c.body,{binary:true}),loaded=await new GLTFLoader().parseAsync(data,'');loaded.scene.updateMatrixWorld(true);let metadata,matched=false;
 loaded.scene.traverse(o=>{if(o.userData.skirt)metadata=o.userData.skirt;if(!o.isSkinnedMesh)return;o.skeleton.update();assert.equal(o.skeleton.bones.length,16);const p=o.geometry.attributes.position;
  for(let j=0;j<p.count;j++)if(new T.Vector3().fromBufferAttribute(p,j).distanceToSquared(bind)<1e-12&&o.getVertexPosition(j,new T.Vector3()).applyMatrix4(o.matrixWorld).distanceTo(expected)<1e-5){matched=true;break}
 });
 assert.equal(metadata?.construction,'source-body-bridge');assert(matched,'the original body surface and posed weights round-trip');
});
