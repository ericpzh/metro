import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {AnimationMixer,Color,SRGBColorSpace,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {OUTFITS,applyOutfit} from '../src/characters/outfits.js';
import {MODEL_LIBRARY} from '../src/characters/library.js';
import {createFemaleVariant} from '../src/characters/female.js';
import {createWalkClips} from '../src/animation/walk-clips.js';
import {WALK_PROFILES} from '../../game/src/sim/constants.ts';

test('twenty approved outfits replace the jacket, preserve the body and attach continuous closed garments',async()=>{
 const approvedCount=MODEL_LIBRARY.length;
 for(const character of ['female','male']){
  assert.equal(OUTFITS[character].length,10);
  const fingerprints=new Set();
  const source=readFileSync(new URL('../../prototypes/trellis-passenger/passenger-b-walk-forward.glb',import.meta.url));
  const parsed=await new GLTFLoader().parseAsync(source.buffer.slice(source.byteOffset,source.byteOffset+source.byteLength),'');
  const rig=createFemaleVariant(parsed.scene,{male:character==='male'});rig.setBag(false);rig.setHairstyle(character==='female'?'bob':'original');
  const animations=createWalkClips(rig.model,WALK_PROFILES);
  for(const outfit of OUTFITS[character]){
   const gltf={scene:clone(rig.model),animations};
   gltf.scene.traverse(m=>{if(m.isMesh&&m.visible)m.geometry=m.geometry.clone()});
   let body;gltf.scene.traverse(m=>{if(m.isSkinnedMesh&&m.userData.coatInterior&&(!body||m.geometry.index.count>body.geometry.index.count))body=m});
   const originalIndex=body.geometry.index.array.slice(),lining={...body.userData.coatInterior};
   const pants=new Color().setRGB(character==='female'?.48:.53,character==='female'?.48:.53,character==='female'?.48:.53,SRGBColorSpace).r;
   const legs=[...new Set(originalIndex)].filter(i=>Math.abs(body.geometry.attributes.color.getX(i)-pants)<.001&&body.geometry.attributes.position.getY(i)<.83);
   const positions=body.geometry.attributes.position.array.slice(),boneCount=body.skeleton.bones.length;
   gltf.animations=animations.map(clip=>clip.clone());
   applyOutfit(gltf.scene,character,outfit.id,{animations:gltf.animations});
   const p=body.geometry.attributes.position;
   for(let i=0;i<p.count;i++)if(positions[i*3+1]>1.425||positions[i*3+1]<.14)for(let k=0;k<3;k++)assert.equal(p.array[i*3+k],positions[i*3+k],'accepted head and feet stay intact');
   assert.equal(body.skeleton.bones.length,boneCount,'the accepted gait skeleton remains intact');
   assert.deepEqual(body.geometry.index.array,originalIndex,'the continuous sleeve/underarm/torso surfaces are never cut away');
   assert.deepEqual(body.userData.coatInterior,lining,'the reviewed moving underarm closure stays active');
   assert(body.geometry.index.count>10000,'the actual body was selected, including when the male hair clone carries lining metadata');
   const oldCoat=new Color().setRGB(character==='female'?.74:.66,character==='female'?.74:.66,character==='female'?.74:.66,SRGBColorSpace).r;
   for(const i of new Set(body.geometry.index.array))assert(Math.abs(body.geometry.attributes.color.getX(i)-oldCoat)>.001,'no approved jacket-colour torso/sleeves survive the change');
   const top=gltf.scene.getObjectByName('Jacket-free top');assert(top);
   const skirt=gltf.scene.getObjectByName('Long_skirt');assert.equal(Boolean(skirt),outfit.shape!=='trousers');
   assert.equal(gltf.animations.length,3);
   const fingerprint=createHash('sha256');gltf.scene.traverse(m=>{if(m.isSkinnedMesh&&m.visible){fingerprint.update(Buffer.from(m.geometry.attributes.position.array.buffer));fingerprint.update(Buffer.from(m.geometry.attributes.color.array.buffer))}});const hash=fingerprint.digest('hex');assert(!fingerprints.has(hash),'each preset changes actual clothing geometry or grey tones');fingerprints.add(hash);
   gltf.scene.traverse(m=>{if(m.isSkinnedMesh&&m.visible){const c=m.geometry.attributes.color;for(let i=0;i<c.count;i++){assert.equal(c.getX(i),c.getY(i),'all colours remain greyscale');assert.equal(c.getY(i),c.getZ(i))}}});
   const waist=gltf.scene.getObjectByName('Trouser waist');assert.equal(Boolean(waist),outfit.shape==='trousers');
   const hem=gltf.scene.getObjectByName('Top hem closure');assert(hem,'the old jacket opening has a continuous new hem');
   for(const mesh of [hem,skirt,waist].filter(Boolean)){
    const a=mesh.geometry.attributes;
    for(let i=0;i<a.position.count;i++){
     assert(Number.isFinite(a.position.getX(i)+a.position.getY(i)+a.position.getZ(i)));
     assert(a.position.getY(i)>.17,'no new cloth reaches the floor');
     let total=0;for(let k=0;k<4;k++){total+=a.skinWeight.array[i*4+k];assert(a.skinIndex.array[i*4+k]<boneCount)}
     assert(Math.abs(total-1)<1e-6);
    }
    // Both garment rims join outer/inner shells; every welded edge has two
    // faces, including the closing edge around the longitudinal UV seam.
    const ids=new Map(),welded=[];for(let i=0;i<a.position.count;i++){const key=[a.position.getX(i),a.position.getY(i),a.position.getZ(i)].map(v=>Math.round(v*1e5)).join(',');if(!ids.has(key))ids.set(key,ids.size);welded.push(ids.get(key))}
    const edges=new Map(),index=mesh.geometry.index.array;
    for(let i=0;i<index.length;i+=3)for(let k=0;k<3;k++){const pair=[welded[index[i+k]],welded[index[i+(k+1)%3]]].sort((a,b)=>a-b),key=pair.join(',');edges.set(key,(edges.get(key)??0)+1)}
    for(const count of edges.values())assert.equal(count,2,'closed garment has no cracks or open hems');
   }
   if(skirt){
    assert.equal(skirt.geometry.morphAttributes.position.length,72,'all three gaits carry their actual skirt clearance into the GLB');
    for(const clip of gltf.animations)assert(clip.tracks.some(track=>track.name==='Long_skirt.morphTargetInfluences'));
    checkLegContainment(gltf.scene,body,skirt,legs,gltf.animations,`${character}/${outfit.id}`);
    if(outfit.id==='long-a-line')assert.throws(()=>checkLegContainment(gltf.scene,body,skirt,legs,gltf.animations,'disabled skirt motion',true),/escapes the posed skirt/,'the regression really rejects an unanimated skirt');
   }
   assert.throws(()=>applyOutfit(gltf.scene,character,outfit.id),/fresh model/);
  }
 }
 assert.equal(MODEL_LIBRARY.length,approvedCount,'applying an outfit cannot mutate the shared catalogue');
});

// Independent geometric regression: intersect each posed horizontal skirt ring
// with the leg's height, then use a 2D polygon test on the actual morphed surface.
// This would reject the old static skirt even though its vertices were finite.
function checkLegContainment(scene,body,skirt,legs,clips,label,disableMotion=false){
 const {segments,rows}=skirt.geometry.userData.skirt;
 const samples=legs.filter((_,i)=>i%Math.max(1,Math.floor(legs.length/256))===0);
 const mixer=new AnimationMixer(scene),point=new Vector3(),rings=Array.from({length:rows+1},()=>Array.from({length:segments},()=>new Vector3()));
 for(const clip of clips){
  mixer.clipAction(clip).play();
  for(let frame=0;frame<48;frame++){
   mixer.setTime(frame*clip.duration/48);scene.updateMatrixWorld(true);skirt.skeleton.update();
   if(disableMotion)skirt.morphTargetInfluences.fill(0);
   for(let row=0;row<=rows;row++)for(let j=0;j<segments;j++)skirt.getVertexPosition(row*(segments+1)+j,rings[row][j]);
   const low=rings[0][0].y,step=(rings[rows][0].y-low)/rows;
   for(const i of samples){
    body.getVertexPosition(i,point);const q=(point.y-low)/step;
    if(q<.15||q>rows-.15)continue;
    const row=Math.floor(q),t=q-row;let inside=false;
    for(let j=0,k=segments-1;j<segments;k=j++){
     const a=rings[row][j],b=rings[row+1][j],c=rings[row][k],d=rings[row+1][k];
     const x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t,u=c.x+(d.x-c.x)*t,v=c.z+(d.z-c.z)*t;
     if((z>point.z)!==(v>point.z)&&point.x<(u-x)*(point.z-z)/(v-z)+x)inside=!inside;
    }
    assert(inside,`${label}/${clip.name}/${frame}: leg vertex ${i} (${point.toArray()}) escapes the posed skirt at height ${point.y}`);
   }
  }
  mixer.stopAllAction();
 }
 mixer.uncacheRoot(scene);
}
