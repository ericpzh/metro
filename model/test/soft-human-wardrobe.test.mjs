import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createSoftHuman,createMotion} from '../src/soft-human/character.js';
import {createWardrobe,OUTFITS,BACKPACKS} from '../src/soft-human/wardrobe.js';
function area(g){const p=g.attributes.position,i=g.index,a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3();let sum=0;for(let n=0;n<(i?i.count:p.count);n+=3){a.fromBufferAttribute(p,i?i.getX(n):n);b.fromBufferAttribute(p,i?i.getX(n+1):n+1);c.fromBufferAttribute(p,i?i.getX(n+2):n+2);sum+=b.sub(a).cross(c.sub(a)).length()/2}return sum}
test('mitten tips remain skin coloured and backpack loops return above the waist',()=>{
 const c=createSoftHuman(),w=createWardrobe(c);
 for(const outfit of OUTFITS){w.set(outfit.id,'daypack');const g=c.body.geometry,p=g.attributes.position;
  for(const group of g.groups)for(let i=group.start;i<group.start+group.count;i++)if(Math.abs(p.getX(i))>.58&&p.getY(i)<.80)assert.equal(group.materialIndex,0,'no trouser-coloured fragments on hands');
  for(const s of w.straps){assert.equal(s.children.length,2,'both ends connect into the pack');const pos=s.geometry.attributes.position;for(let i=0;i<pos.count;i++)assert(pos.getY(i)>.87,'underarm loop must not descend to the waist')}
 }
});
test('all wardrobe combinations preserve skin area, weights and torso pack ownership',()=>{const c=createSoftHuman(),originalArea=area(c.body.geometry),wardrobe=createWardrobe(c),motion=createMotion(c);
 for(const outfit of OUTFITS)for(const bag of BACKPACKS.filter(b=>['none','daypack','hiking'].includes(b.id))){wardrobe.set(outfit.id,bag.id);const g=c.body.geometry;assert(Math.abs(area(g)-originalArea)<1e-5,'garment clipping must preserve the skin without holes or duplicate faces');const w=g.attributes.skinWeight.array;for(let i=0;i<w.length;i+=4)assert(Math.abs(w[i]+w[i+1]+w[i+2]+w[i+3]-1)<1e-6);assert.equal(c.chest.children.filter(x=>x.name.startsWith('Backpack-')).length,bag.id==='none'?0:1);if(bag.id!=='none'){assert.equal(wardrobe.pack.parent,c.chest);assert.equal(wardrobe.straps.length,2)}for(const mode of ['walk','reach','float']){motion.state.mode=mode;motion.update(.1);c.body.updateMatrixWorld(true);assert(c.bones.every(b=>b.matrixWorld.elements.every(Number.isFinite)))}}
});
test('selected outfit and hiking pack survive GLB round trip',async()=>{globalThis.FileReader??=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.()})}};const c=createSoftHuman(),wardrobe=createWardrobe(c);wardrobe.set('trail','hiking');const m=createMotion(c);m.state.mode='reach';for(let i=0;i<240;i++)m.update(1/120);wardrobe.update();const expected=wardrobe.straps.map(s=>({name:s.name.replaceAll(' ','_'),point:s.getVertexPosition(80,new T.Vector3()).applyMatrix4(s.matrixWorld)}));const bytes=await new GLTFExporter().parseAsync(c.body,{binary:true}),loaded=await new GLTFLoader().parseAsync(bytes,'');const skins=[];loaded.scene.traverse(o=>{if(o.isSkinnedMesh)skins.push(o)});assert(skins.length);assert(skins.every(s=>s.skeleton.bones.length===11));assert(loaded.scene.getObjectByName('Backpack-hiking'));assert(skins.flatMap(s=>s.material).some(m=>m.color.getHexString()==='cc3c70'));assert(skins.every(s=>s.geometry.attributes.skinWeight));loaded.scene.updateMatrixWorld(true);for(const s of skins)s.skeleton.update();for(const e of expected){const s=loaded.scene.getObjectByName(e.name);assert(s,'exported strap exists');const p=s.getVertexPosition(80,new T.Vector3()).applyMatrix4(s.matrixWorld);assert(p.distanceTo(e.point)<1e-5,'posed strap placement survives export')} });



test('fitted strap edges remain outside the skinned torso across complete motion cycles',()=>{
 const c=createSoftHuman(),wardrobe=createWardrobe(c),motion=createMotion(c);
 const surface=new T.SkinnedMesh(wardrobe.source);c.body.add(surface);surface.bind(c.body.skeleton,c.body.bindMatrix);surface.visible=false;
 const a=new T.Vector3(),b=new T.Vector3(),d=new T.Vector3(),point=new T.Vector3(),normal=new T.Vector3(),strapPoint=new T.Vector3();let minimum=Infinity,maximum=0;
 for(const [age,bag] of ['adult','child'].flatMap(age=>['daypack','hiking','shoulder-left','shoulder-right','crossbody-left','crossbody-right'].map(bag=>[age,bag]))){c.setAge(age);wardrobe.set('commuter',bag);surface.geometry=c.body.geometry;for(const mode of ['idle','walk','reach','float']){motion.state.mode=mode;motion.reset();for(let frame=0;frame<24;frame++){
  for(let i=0;i<10;i++)motion.update(1/120);c.body.updateMatrixWorld(true);c.body.skeleton.update();wardrobe.update();
  for(const strap of wardrobe.straps){assert(strap.isSkinnedMesh);strap.userData.surfaceAnchors.forEach(({triangle,barycentric},i)=>{
   surface.getVertexPosition(triangle[0],a);surface.getVertexPosition(triangle[1],b);surface.getVertexPosition(triangle[2],d);point.set(0,0,0).addScaledVector(a,barycentric[0]).addScaledVector(b,barycentric[1]).addScaledVector(d,barycentric[2]);normal.copy(b).sub(a).cross(d.clone().sub(a)).normalize();strap.getVertexPosition(i,strapPoint);const clearance=strapPoint.sub(point).dot(normal);minimum=Math.min(minimum,clearance);maximum=Math.max(maximum,clearance);
  })}
 }}}
 assert(minimum>.003,`minimum strap clearance ${minimum}`);assert(maximum<.035,`strap should stay fitted, maximum gap ${maximum}`);
 console.log(`Strap/torso clearance across both packs and all poses: ${(minimum*1000).toFixed(2)}–${(maximum*1000).toFixed(2)} mm`);
});





test('carried bag anchors and child sizing remain correct through every action',()=>{
 const c=createSoftHuman(),w=createWardrobe(c),m=createMotion(c);const point=new T.Vector3();
 for(const age of ['adult','child']){c.setAge(age);assert.equal(c.body.scale.y,age==='child'?.65:1);
  for(const bag of BACKPACKS.filter(b=>b.type)){w.set('navy-suit',bag.id);assert.equal(w.pack.userData.carriedBag.type,bag.type);const held=['purse','handbag'].includes(bag.type);assert.equal(w.pack.parent,held?c.limbs.find(x=>x.s===(bag.side==='left'?-1:1)).fore:c.chest);assert.equal(w.straps.length,held?0:1);
   for(const mode of ['idle','walk','reach','float']){m.state.mode=mode;m.reset();for(let i=0;i<120;i++)m.update(1/120);w.update();assert(w.pack.matrixWorld.elements.every(Number.isFinite));if(held){const grip=w.pack.getWorldPosition(point);const wrist=w.pack.parent.localToWorld(new T.Vector3((bag.side==='left'?-1:1)*.21,-.295,.03));assert(grip.distanceTo(wrist)<1e-6)}}
  }
 }
 for(const outfit of OUTFITS.filter(o=>o.formal)){w.set(outfit.id,'none');assert(c.body.geometry.groups.some(g=>g.materialIndex===6),'formal tie has a real exportable material region');assert(c.body.geometry.groups.some(g=>g.materialIndex===7),'lapels have a real material region')}
});



