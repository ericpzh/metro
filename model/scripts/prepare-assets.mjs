import {MODEL_LIBRARY} from '../src/characters/library.js';
import {mkdirSync,readFileSync} from 'node:fs';
import {writeAsset} from './write-asset.mjs';
import {createHash} from 'node:crypto';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {exportSharedPassengerVariants} from '../../tools/export-shared-passenger-variants.mjs';
import {createWalkClips} from '../src/animation/walk-clips.js';
import {createFemaleVariant} from '../src/characters/female.js';
import {smoothShoulders} from '../src/characters/shoulders.js';
import {withTrimmedStrapSurface} from '../src/characters/strap-surface.js';
import {WALK_PROFILES} from '../../game/src/sim/constants.ts';
const assets=new URL('../public/models/',import.meta.url);mkdirSync(assets,{recursive:true});
const selectedCharacter=process.argv.find(arg=>arg.startsWith('--character='))?.slice(12);
if(selectedCharacter&&!['male','female'].includes(selectedCharacter))throw Error('Expected --character=male or --character=female');
const selected=character=>!selectedCharacter||selectedCharacter===character;
if(selected('female'))await exportSharedPassengerVariants({outputDirectory:assets});
const filenames=MODEL_LIBRARY.filter(entry=>entry.character==='female').map(entry=>entry.file);
const source=new URL('../../prototypes/trellis-passenger/passenger-b-walk-forward.glb',import.meta.url),bytes=readFileSync(source);
let maleRig,maleClips;
const maleVariants=MODEL_LIBRARY.filter(entry=>entry.character==='male'&&entry.id!=='male-original-bag').map(entry=>entry.file);
if(selected('male')){
const male=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
smoothShoulders(male.scene);
const clips=createWalkClips(male.scene,WALK_PROFILES);
await writeAsset(new URL('passenger-male-walk.glb',assets),Buffer.from(await withTrimmedStrapSurface(male.scene,()=>new GLTFExporter().parseAsync(male.scene,{binary:true,animations:clips}))));
const variantSource=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
maleRig=createFemaleVariant(variantSource.scene,{male:true});
maleClips=createWalkClips(maleRig.model,WALK_PROFILES);
for(const {hair:style,bag,file} of MODEL_LIBRARY.filter(entry=>entry.character==='male'&&!entry.bagStyle)){
 if(style==='original'&&bag)continue;
 maleRig.setBag(bag);maleRig.setHairstyle(style);
 await writeAsset(new URL(file,assets),Buffer.from(await withTrimmedStrapSurface(maleRig.model,()=>new GLTFExporter().parseAsync(maleRig.model,{binary:true,animations:maleClips}))));
}
}
for(const character of ['male','female'].filter(selected)){
 const parsed=character==='female'?await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),''):null;
 const rig=character==='male'?maleRig:createFemaleVariant(parsed.scene);
 const animations=character==='male'?maleClips:createWalkClips(rig.model,WALK_PROFILES);
 for(const entry of MODEL_LIBRARY.filter(m=>m.character===character&&m.bagStyle)){
  rig.setBag(entry.bagStyle);rig.setHairstyle(entry.hair);
  const variantAnimations=entry.bagType?createWalkClips(rig.model,WALK_PROFILES):animations;
  await writeAsset(new URL(entry.file,assets),Buffer.from(await withTrimmedStrapSurface(rig.model,()=>new GLTFExporter().parseAsync(rig.model,{binary:true,animations:variantAnimations}))));
 }
}
await writeAsset(new URL('walk-profiles.json',assets),JSON.stringify(WALK_PROFILES,null,2)+'\n');
await writeAsset(new URL('reference.png',assets),readFileSync(new URL('../../prototypes/trellis-passenger/reference.png',import.meta.url)));
await writeAsset(new URL('provenance.json',assets),JSON.stringify({male:{source:'prototypes/trellis-passenger/passenger-b-walk-forward.glb',sha256:createHash('sha256').update(bytes).digest('hex'),geometryPreservedOutsideCleanupRegions:true,silhouetteCleanup:'model/src/characters/shoulders.js',variants:maleVariants},female:{builder:'model/src/characters/female.js',variants:filenames},walkProfiles:WALK_PROFILES},null,2)+'\n');
await writeAsset(new URL('library.json',assets),JSON.stringify(MODEL_LIBRARY,null,2)+'\n');
console.log(`Model library ready: ${MODEL_LIBRARY.length} variants, including small and resized standard backpacks.`);
