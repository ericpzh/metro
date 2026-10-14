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
await exportSharedPassengerVariants();
const filenames=['passenger-female-walk.glb','passenger-female-shoulder-walk.glb',...['bob','shoulder','long'].map(style=>`passenger-female-no-bag-${style}-walk.glb`)];
for(const file of filenames)await writeAsset(new URL(file,assets),readFileSync(new URL('../../prototypes/passenger-female-shared/'+file,import.meta.url)));
const source=new URL('../../prototypes/trellis-passenger/passenger-b-walk-forward.glb',import.meta.url),bytes=readFileSync(source);
const male=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
smoothShoulders(male.scene);
const clips=createWalkClips(male.scene,WALK_PROFILES);
await writeAsset(new URL('passenger-male-walk.glb',assets),Buffer.from(await withTrimmedStrapSurface(male.scene,()=>new GLTFExporter().parseAsync(male.scene,{binary:true,animations:clips}))));
const variantSource=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const maleRig=createFemaleVariant(variantSource.scene,{male:true});
const maleClips=createWalkClips(maleRig.model,WALK_PROFILES),maleVariants=[];
for(const style of ['original','short','bald'])for(const bag of [true,false]){
 if(style==='original'&&bag)continue;
 maleRig.setBag(bag);maleRig.setHairstyle(style);
 const file=`passenger-male-${bag?'bag':'no-bag'}-${style}-walk.glb`;maleVariants.push(file);
 await writeAsset(new URL(file,assets),Buffer.from(await withTrimmedStrapSurface(maleRig.model,()=>new GLTFExporter().parseAsync(maleRig.model,{binary:true,animations:maleClips}))));
}
for(const character of ['male','female']){
 const parsed=character==='female'?await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),''):null;
 const rig=character==='male'?maleRig:createFemaleVariant(parsed.scene);
 const animations=character==='male'?maleClips:createWalkClips(rig.model,WALK_PROFILES);
 for(const entry of MODEL_LIBRARY.filter(m=>m.character===character&&m.bagStyle)){
  rig.setBag(entry.bagStyle);rig.setHairstyle(entry.hair);
  const variantAnimations=entry.bagType?createWalkClips(rig.model,WALK_PROFILES):animations;
  await writeAsset(new URL(entry.file,assets),Buffer.from(await withTrimmedStrapSurface(rig.model,()=>new GLTFExporter().parseAsync(rig.model,{binary:true,animations:variantAnimations}))));
  (character==='male'?maleVariants:filenames).push(entry.file);
 }
}
await writeAsset(new URL('walk-profiles.json',assets),JSON.stringify(WALK_PROFILES,null,2)+'\n');
await writeAsset(new URL('reference.png',assets),readFileSync(new URL('../../prototypes/trellis-passenger/reference.png',import.meta.url)));
await writeAsset(new URL('provenance.json',assets),JSON.stringify({male:{source:'prototypes/trellis-passenger/passenger-b-walk-forward.glb',sha256:createHash('sha256').update(bytes).digest('hex'),geometryPreservedOutsideCleanupRegions:true,silhouetteCleanup:'model/src/characters/shoulders.js',variants:maleVariants},female:{builder:'model/src/characters/female.js',variants:filenames},walkProfiles:WALK_PROFILES},null,2)+'\n');
await writeAsset(new URL('library.json',assets),JSON.stringify(MODEL_LIBRARY,null,2)+'\n');
console.log(`Model library ready: ${MODEL_LIBRARY.length} variants, including small and resized standard backpacks.`);
