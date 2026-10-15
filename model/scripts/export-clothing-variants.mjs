import {readFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {AnimationMixer} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {MODEL_LIBRARY} from '../src/characters/library.js';
import {applyOutfit} from '../src/characters/outfits.js';
import {writeAsset} from './write-asset.mjs';

globalThis.FileReader??=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.()})}};

/** Export reviewed clothing from closed bagless templates, including real morph clips. */
export async function exportClothingVariants({outputDirectory,character}={}){
 mkdirSync(outputDirectory,{recursive:true});
 const manifest={builder:'model/src/characters/outfits.js',models:[]};
 for(const entry of MODEL_LIBRARY.filter(m=>m.outfit&&(!character||m.character===character))){
  const source=MODEL_LIBRARY.find(m=>!m.outfit&&m.character===entry.character&&m.hair===entry.hair&&!m.bag).file;
  const bytes=readFileSync(new URL(`../public/models/${source}`,import.meta.url));
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  applyOutfit(gltf.scene,entry.character,entry.outfit,{swapTones:entry.swapTones,animations:gltf.animations});
  const binary=await new GLTFExporter().parseAsync(gltf.scene,{binary:true,animations:gltf.animations,onlyVisible:true});
  const roundTrip=await new GLTFLoader().parseAsync(binary,'');
  if(roundTrip.animations.length!==3||!roundTrip.scene.getObjectByName('Jacket-free_top'))throw Error(`Invalid clothing export: ${entry.id}`);
  if(entry.garmentShape!=='trousers'){
   const skirt=roundTrip.scene.getObjectByName('Long_skirt');
   if(skirt?.morphTargetInfluences.length!==72)throw Error(`Missing skirt morphs: ${entry.id}`);
   const mixer=new AnimationMixer(roundTrip.scene);
   for(const clip of roundTrip.animations){
    mixer.clipAction(clip).play();mixer.setTime(clip.duration*.37);
    if(Math.abs(skirt.morphTargetInfluences.reduce((a,b)=>a+b,0)-1)>1e-5)throw Error(`Skirt clip failed: ${entry.id}/${clip.name}`);
    mixer.stopAllAction();
   }
   mixer.uncacheRoot(roundTrip.scene);
  }
  await writeAsset(new URL(entry.file,outputDirectory),Buffer.from(binary));
  const hash=data=>createHash('sha256').update(data).digest('hex');
  manifest.models.push({...entry,bytes:binary.byteLength,sha256:hash(Buffer.from(binary)),source,sourceHash:hash(bytes)});
  console.log(`${entry.file}: ${(binary.byteLength/1024/1024).toFixed(1)} MiB`);
  for(const scene of [gltf.scene,roundTrip.scene])scene.traverse(mesh=>{if(mesh.isMesh){mesh.geometry.dispose();for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])material.dispose()}});
 }
 return manifest;
}
