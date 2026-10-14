import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createFemaleVariant} from '../src/characters/female.js';
import {HAIR_CHOICES,MALE_HAIRSTYLES,supportsBackpack} from '../src/characters/hairstyles.js';
import {MODEL_LIBRARY} from '../src/characters/library.js';

test('each sex has ten actual hair appearances with complete compatible bag choices',async()=>{
 const bytes=readFileSync(new URL('../../prototypes/trellis-passenger/passenger-b-walk-forward.glb',import.meta.url));
 for(const character of ['male','female']){
  assert.equal(HAIR_CHOICES[character].length,10,'ten adult hairstyle choices per sex');
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const rig=createFemaleVariant(gltf.scene,{male:character==='male'}),appearances=new Set(),sourceShapes=[];
  for(const style of HAIR_CHOICES[character]){
   rig.setBag(false);rig.setHairstyle(style);
   const hair=rig.model.getObjectByName(style==='original'?'Original male hair':style[0].toUpperCase()+style.slice(1)+' hairstyle');
   assert(hair?.visible,`${character}/${style}: the selected hair is visible`);
   const {position,color,skinIndex,skinWeight}=hair.geometry.attributes;
   const hash=createHash('sha256');hash.update(Buffer.from(position.array.buffer));hash.update(Buffer.from(color.array.buffer));
   const fingerprint=hash.digest('hex');assert(!appearances.has(fingerprint),`${character}/${style}: differs in shape or skin colour`);appearances.add(fingerprint);
   const used=new Set(hair.geometry.index.array);
   for(const i of used){
    assert(Number.isFinite(position.getX(i))&&Number.isFinite(position.getY(i))&&Number.isFinite(position.getZ(i)));
    assert(position.getY(i)>1.08&&position.getY(i)<1.77,`${character}/${style}: hair stays within the reviewed head/shoulder region`);
    if(character!=='male'||MALE_HAIRSTYLES[style].kind!=='source'){
     assert.equal(hair.skeleton.bones[skinIndex.getX(i)].name,'Head','authored hairstyles follow the head through walking');
     assert.equal(skinWeight.getX(i),1);
    }
   }
   if(character==='male'&&style!=='original'&&MALE_HAIRSTYLES[style].kind==='source'){
    sourceShapes.push([style,position.array.slice()]);
    assert.equal(used.size,14046,'new male hair retains all the original lock vertices');
    assert.equal(hair.geometry.index.count/3,20977,'new male hair retains the original lock topology');
    assert(Math.max(...[...used].map(i=>position.getY(i)))<=MALE_HAIRSTYLES[style].maxHeight+1e-6,'the new crown stays below the original 1.72 m peak');
    for(const i of used)for(let k=0;k<4;k++)if(skinWeight.array[i*4+k]>0)assert(['Head','Neck'].includes(hair.skeleton.bones[skinIndex.array[i*4+k]].name),'original head/neck attachments survive the deformation');
   }
   const entries=MODEL_LIBRARY.filter(m=>m.character===character&&m.hair===style);
   assert(entries.some(m=>!m.bag&&m.adultEligible));
   assert.equal(entries.filter(m=>m.bag&&!m.bagType).length,supportsBackpack(character,style)?4:0,'long shells never overlap backpack bodies');
   for(const bagStyle of ['standard','small','standard-87.5','standard-75']){
    rig.setBag(bagStyle);rig.setHairstyle(style);
    assert.equal(rig.hasBag(),supportsBackpack(character,style));
   }
  }
  for(let a=0;a<sourceShapes.length;a++)for(let b=a+1;b<sourceShapes.length;b++){
   const [nameA,p]=sourceShapes[a],[nameB,q]=sourceShapes[b];let largest=0;
   for(let k=0;k<p.length;k+=3)largest=Math.max(largest,Math.hypot(p[k]-q[k],p[k+1]-q[k+1],p[k+2]-q[k+2]));
   assert(largest>.01,`${nameA}/${nameB}: at least one lock differs by more than a centimetre, not just a label or tiny crown adjustment`);
  }
 }
 assert.equal(new Set(MODEL_LIBRARY.map(m=>m.id)).size,MODEL_LIBRARY.length);
 assert.equal(new Set(MODEL_LIBRARY.map(m=>m.file)).size,MODEL_LIBRARY.length);
});
