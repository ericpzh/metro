import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {writeAsset} from '../model/scripts/write-asset.mjs';
import * as THREE from '../model/node_modules/three/build/three.module.js';
import {GLTFLoader} from '../model/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import {GLTFExporter} from '../model/node_modules/three/examples/jsm/exporters/GLTFExporter.js';
import {createFemaleVariant} from '../prototypes/passenger-female-shared/variant.js';
import {createPassengerWalkPoser} from './passenger-walk-poses.mjs';
import {WALK_PROFILES} from '../game/src/sim/constants.ts';
import {withTrimmedStrapSurface} from '../model/src/characters/strap-surface.js';
import {MODEL_LIBRARY} from '../model/src/characters/library.js';

// GLTFExporter only needs FileReader for its binary Blob in this texture-free asset.
globalThis.FileReader??=class {
 readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.()})}
};

export async function exportSharedPassengerVariants({outputDirectory}={}){
 const bytes=readFileSync(new URL('../prototypes/trellis-passenger/passenger-b-walk-forward.glb',import.meta.url));
 const source=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const rig=createFemaleVariant(source.scene),bones=rig.skeleton.bones,pose=createPassengerWalkPoser(rig.model);
 const clips=WALK_PROFILES.map(profile=>{
  const times=[],quats=bones.map(()=>[]),positions=[];
  for(let i=0;i<=48;i++){times.push(i*profile.cycleSeconds/48);pose((i%48)/48,profile);bones.forEach((b,j)=>quats[j].push(...b.quaternion.toArray()));positions.push(...bones[0].position.toArray())}
  const tracks=bones.map((b,j)=>new THREE.QuaternionKeyframeTrack(b.name+'.quaternion',times,quats[j]));tracks.push(new THREE.VectorKeyframeTrack('Hips.position',times,positions));
  return new THREE.AnimationClip('Walk_'+profile.name[0].toUpperCase()+profile.name.slice(1),profile.cycleSeconds,tracks);
 });
 rig.skeleton.pose();rig.model.updateMatrixWorld(true);
 const variants=outputDirectory?MODEL_LIBRARY.filter(entry=>entry.character==='female'&&!entry.bagStyle):[
  ['bob',true],['shoulder',true],['bob',false],['shoulder',false],['long',false],
 ].map(([hair,bag])=>MODEL_LIBRARY.find(entry=>entry.character==='female'&&entry.hair===hair&&entry.bag===bag&&!entry.bagStyle));
 for(const {hair:style,bag,file:name} of variants){
  rig.setBag(bag);rig.setHairstyle(style);
  const binary=await withTrimmedStrapSurface(rig.model,()=>new GLTFExporter().parseAsync(rig.model,{binary:true,animations:clips}));
  const path=fileURLToPath(outputDirectory?new URL(name,outputDirectory):new URL('../prototypes/passenger-female-shared/'+name,import.meta.url));
  await writeAsset(path,Buffer.from(binary));
  console.log(`${name}: ${binary.byteLength} bytes`);
 }
 rig.setBag(true);rig.setHairstyle('bob');
 if(!outputDirectory){const flat=await new GLTFExporter().parseAsync(rig.model,{binary:true});await writeAsset(new URL('../prototypes/passenger-female-shared/passenger-female-flat.glb',import.meta.url),Buffer.from(flat))}
}
if(process.argv[1]===fileURLToPath(import.meta.url))await exportSharedPassengerVariants();
