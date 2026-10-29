import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createImportedSoftHuman,SOFT_BASE_URL} from '../src/soft-human/imported-base.js';
import {createWardrobe,OUTFITS,SEXES,outfitsForSex} from '../src/soft-human/wardrobe.js';
import {createMotion} from '../src/soft-human/character.js';

const bytes=readFileSync(new URL('../public'+SOFT_BASE_URL,import.meta.url));
const create=()=>createImportedSoftHuman(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
const casual=OUTFITS.filter(o=>o.shortsHem!==undefined);

test('categories contain twenty outfits, male-only Summer stripes and female-only skirts',()=>{
 assert.equal(casual.length,10);
 assert.equal(new Set(OUTFITS.map(o=>o.id)).size,OUTFITS.length);
 for(const {id} of SEXES){
  const choices=outfitsForSex(id);assert.equal(choices.length,20);assert(!choices.some(o=>o.baseOnly));
  assert(choices.every(o=>o.label.includes(' / ')));
 }
 assert(outfitsForSex('female').some(o=>o.id==='trail'));assert(!outfitsForSex('male').some(o=>o.id==='trail'));
 assert(outfitsForSex('male').some(o=>o.id==='beach'));assert(!outfitsForSex('female').some(o=>o.id==='beach'));
 const skirts=OUTFITS.filter(o=>o.skirt);assert.equal(skirts.length,4);assert(skirts.every(o=>outfitsForSex('female').includes(o)&&!outfitsForSex('male').includes(o)));
});

test('category changes preserve shared outfits, age, bag and motion while replacing ineligible clothing',()=>{
 const c=create(),w=createWardrobe(c),m=createMotion(c);c.setAge('child');w.set('tee-shorts','crossbody-right');m.seek(1.25);
 const beforeTime=m.time,before=c.bones.map(b=>b.quaternion.toArray());w.setSex('female');
 assert.deepEqual(w.state,{sex:'female',outfit:'tee-shorts',backpack:'crossbody-right'});assert.equal(c.appearance.age,'child');assert.equal(m.time,beforeTime);assert.deepEqual(c.bones.map(b=>b.quaternion.toArray()),before);
 w.set('trail');assert.equal(w.state.sex,'female');w.setSex('male');assert.equal(w.state.outfit,'commuter');assert.equal(w.state.backpack,'crossbody-right');
 w.set('casual-shirt');w.setSex('female');assert.equal(w.state.outfit,'commuter');
 assert.throws(()=>w.setSex('unknown'));assert.equal(w.state.sex,'female');
});

function area(g){const p=g.attributes.position,a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3();let sum=0;for(let i=0;i<p.count;i+=3){a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);sum+=b.sub(a).cross(c.sub(a)).length()/2}return sum}

test('T-shirts have perpendicular sleeve edges and shorts have clean hems without losing skin or rig weights',()=>{
 const c=create(),originalArea=area(c.body.geometry),w=createWardrobe(c),m=createMotion(c);
 for(const outfit of casual){
  w.set(outfit.id,'daypack');const g=c.body.geometry,p=g.attributes.position,ids=g.attributes.skinIndex,weights=g.attributes.skinWeight;
  assert(Math.abs(area(g)-originalArea)<1e-5,'clipping preserves the complete source surface');
  let hem=0;const cuffs=[0,0];
  for(const group of g.groups)for(let i=group.start;i<group.start+group.count;i+=3){
   const points=[0,1,2].map(j=>[p.getX(i+j),p.getY(i+j),p.getZ(i+j)]);
   if(points.every(p=>Math.abs(p[0])<.34&&p[1]<.55)){
    const distances=points.map(p=>p[1]-outfit.shortsHem);
    assert(!distances.some(d=>d<-.000001)||!distances.some(d=>d>.000001),'no triangle straddles the shorts hem');
    if(distances.reduce((a,b)=>a+b,0)<-1e-5)assert.equal(group.materialIndex,0,'lower legs are skin coloured');
    if(group.materialIndex===2)hem+=distances.filter(d=>Math.abs(d)<1e-6).length;
   }
   const arm=points.map((_,j)=>[0,1,2,3].reduce((sum,k)=>sum+(/Arm|Forearm/.test(c.bones[ids.array[(i+j)*4+k]].name)?weights.array[(i+j)*4+k]:0),0));
   if(arm.every(w=>w>.75)){
    const side=points[0][0]>0?1:-1,cuff=c.anatomy.sleeves.find(c=>c.side===side),distances=points.map(cuff.field);
    assert(!distances.some(d=>d<-.000001)||!distances.some(d=>d>.000001),'no triangle straddles the sleeve cut');
    if(distances.reduce((a,b)=>a+b,0)>1e-5)assert.equal(group.materialIndex,0,'forearms and hands remain skin coloured');
    if(group.materialIndex===1)cuffs[side>0?1:0]+=distances.filter(d=>Math.abs(d)<1e-6).length;
   }
  }
  assert(hem>10&&cuffs.every(n=>n>5),'both sleeve loops and shorts hem exist');
  for(const age of ['adult','child']){c.setAge(age);for(const mode of ['idle','walk-slow','walk','walk-fast','reach']){m.state.mode=mode;m.seek(1.5);w.update();assert(c.bones.every(b=>b.matrixWorld.elements.every(Number.isFinite)))}}
 }
});

test('casual outfit, category metadata and skin palette survive a posed child GLB round trip',async()=>{
 globalThis.FileReader??=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(data=>{this.result=data;this.onloadend?.()})}};
 const c=create(),w=createWardrobe(c),m=createMotion(c);c.setAge('child');w.setSex('female');w.set('polo-shorts','crossbody-right');m.seek(.7);w.update();
 const data=await new GLTFExporter().parseAsync(c.body,{binary:true}),loaded=await new GLTFLoader().parseAsync(data,'');
 let metadata;const colors=new Set(),skins=[];
 loaded.scene.traverse(o=>{if(o.userData.wardrobe)metadata=o.userData.wardrobe;if(o.isSkinnedMesh){skins.push(o);for(const m of Array.isArray(o.material)?o.material:[o.material])colors.add(m.color.getHexString())}});
 assert.deepEqual(metadata,w.state);assert(skins.length&&skins.every(o=>o.skeleton.bones.length===16));
 const outfit=OUTFITS.find(o=>o.id==='polo-shorts');for(const tone of [outfit.top,outfit.bottom,'#f2f1ed'])assert(colors.has(new T.Color(tone).getHexString()));
});
