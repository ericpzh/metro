import {mkdirSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {writeAsset} from './write-asset.mjs';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createImportedSoftHuman,SOFT_BASE_URL} from '../src/soft-human/imported-base.js';
import {createWardrobe,OUTFITS,outfitsForSex} from '../src/soft-human/wardrobe.js';
globalThis.FileReader??=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(data=>{this.result=data;this.onloadend?.()})}};
const sourcePath=new URL('../public'+SOFT_BASE_URL,import.meta.url),sourceBytes=readFileSync(sourcePath);
const c=createImportedSoftHuman(sourceBytes.buffer.slice(sourceBytes.byteOffset,sourceBytes.byteOffset+sourceBytes.byteLength));
const age=process.argv.find(x=>x.startsWith('--age='))?.slice(6)??'adult';c.setAge(age);
const outfit=process.argv.find(x=>x.startsWith('--outfit='))?.slice(9);
const backpack=process.argv.find(x=>x.startsWith('--backpack='))?.slice(11)??'none';
const requestedSex=process.argv.find(x=>x.startsWith('--sex='))?.slice(6);
const sex=requestedSex??OUTFITS.find(o=>o.id===outfit)?.sexes?.[0]??'male';
outfitsForSex(sex);
if(outfit){if(outfit!=='plain'&&!outfitsForSex(sex).some(o=>o.id===outfit))throw Error('Outfit is not in the selected category');const w=createWardrobe(c);w.setSex(sex);w.set(outfit,backpack);w.update()}
else if(backpack!=='none')throw Error('Specify --outfit when exporting a backpack');
const bytes=await new GLTFExporter().parseAsync(c.body,{binary:true});
const loaded=await new GLTFLoader().parseAsync(bytes,'');let skinned=0;
loaded.scene.traverse(o=>{if(o.isSkinnedMesh){skinned++;if(o.skeleton.bones.length!==c.bones.length)throw Error('Skeleton lost in export')}});
if(!skinned)throw Error('Expected skinned body');
const out=new URL('../public/soft-human/',import.meta.url);mkdirSync(out,{recursive:true});
const baseName=outfit?`soft-human-${outfit}-${backpack}`:'soft-human';
const name=baseName+(requestedSex?'-'+sex:'')+(age==='child'?'-child':'');
const hash=data=>createHash('sha256').update(data).digest('hex');
await writeAsset(new URL(name+'.glb',out),Buffer.from(bytes));
await writeAsset(new URL(outfit||age==='child'?name+'.json':'manifest.json',out),JSON.stringify({
 generator:'model/scripts/export-soft-human.mjs',
 sources:[{path:'model/public'+SOFT_BASE_URL,sha256:hash(sourceBytes)},...['imported-base.js','character.js','wardrobe.js','skirt.js','mathematical-strap.js','strap-fit.js','torso-fit.js','carried-bags.js','bag-connectors.js','bag-shell.js'].map(file=>({path:'model/src/soft-human/'+file,sha256:hash(readFileSync(new URL('../src/soft-human/'+file,import.meta.url)))}))],
 sha256:hash(Buffer.from(bytes)),outfit:outfit??'plain',backpack,age,sex,
 provenance:'User-selected HumanBody_Alt.fbx base. Included source readme describes a cleaned Human: Fall Flat model ripped from Unity; no redistribution license is supplied. Clothing, accessories and animation adapter are locally authored.',
 geometry:'Source skin and authored weights, normalized to 1.7 metres and rebound in an A-pose with the 15 source bones plus a root Hips bone. Separate cap and torso-owned mathematical strap ribbons with fixed bag anchors; neckline and forearm-perpendicular cuffs split into the skin geometry.',
 animation:'Live preview uses damped angular springs for walking/studies and contact-targeted station activities. This file contains the bind-pose rig, without procedural motion or physics.'
},null,2)+'\n');
console.log(`Exported and round-tripped ${name}: ${bytes.byteLength} bytes`);





