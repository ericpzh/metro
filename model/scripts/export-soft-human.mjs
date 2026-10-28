import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createSoftHuman} from '../src/soft-human/character.js';
import {createWardrobe} from '../src/soft-human/wardrobe.js';
globalThis.FileReader??=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(data=>{this.result=data;this.onloadend?.()})}};
const c=createSoftHuman();
const age=process.argv.find(x=>x.startsWith('--age='))?.slice(6)??'adult';c.setAge(age);
const outfit=process.argv.find(x=>x.startsWith('--outfit='))?.slice(9);
const backpack=process.argv.find(x=>x.startsWith('--backpack='))?.slice(11)??'none';
if(outfit){const w=createWardrobe(c);w.set(outfit,backpack);w.update()}
else if(backpack!=='none')throw Error('Specify --outfit when exporting a backpack');
const bytes=await new GLTFExporter().parseAsync(c.body,{binary:true});
const loaded=await new GLTFLoader().parseAsync(bytes,'');let skinned=0;
loaded.scene.traverse(o=>{if(o.isSkinnedMesh){skinned++;if(o.skeleton.bones.length!==11)throw Error('Skeleton lost in export')}});
if(!skinned)throw Error('Expected skinned body');
const out=new URL('../public/soft-human/',import.meta.url);mkdirSync(out,{recursive:true});
const baseName=outfit?`soft-human-${outfit}-${backpack}`:'soft-human';
const name=baseName+(age==='child'?'-child':'');
const hash=data=>createHash('sha256').update(data).digest('hex');
writeFileSync(new URL(name+'.glb',out),Buffer.from(bytes));
writeFileSync(new URL(outfit||age==='child'?name+'.json':'manifest.json',out),JSON.stringify({
 generator:'model/scripts/export-soft-human.mjs',
 sources:['character.js','wardrobe.js','strap-fit.js','carried-bags.js','bag-connectors.js','bag-shell.js'].map(file=>({path:'model/src/soft-human/'+file,sha256:hash(readFileSync(new URL('../src/soft-human/'+file,import.meta.url)))})),
 sha256:hash(Buffer.from(bytes)),outfit:outfit??'plain',backpack,age,
 provenance:'Original procedural implicit sculpt and accessories inspired by user-provided Human: Fall Flat screenshots. No game assets copied.',
 geometry:'Continuous marching-cubes skin with blended skeletal weights; separate cap and pose-fitted accessories. Garment material boundaries are split into the skin geometry.',
 animation:'Live preview uses damped angular springs for walking/studies and contact-targeted station activities. This file contains the bind-pose rig, without procedural motion or physics.'
},null,2)+'\n');
console.log(`Exported and round-tripped ${name}: ${bytes.byteLength} bytes`);





