import {SEXES,outfitsForSex,BACKPACKS} from './wardrobe.js';

// The preview and offline game bake share these recipes. Game runtime consumes
// only the generated atlases; it never loads the model app or FBX loader.
export const SOFT_MODEL_LIBRARY=SEXES.flatMap(({id:sex})=>outfitsForSex(sex).flatMap(outfit=>BACKPACKS.map(({id:bag})=>({
 id:`soft-${sex}-${outfit.id}-${bag}`,character:sex,hair:'cap',outfit:outfit.id,
 bag:bag!=='none',bagStyle:bag,bagType:bag.split('-')[0],bagSide:bag.endsWith('left')?'left':'right',
 adultEligible:true,childEligible:true,garmentShape:outfit.skirt?'skirt':'trousers',
 top:outfit.top,bottom:outfit.bottom,file:'human-candidates/human-fall-flat/HumanBody_Alt.fbx',
}))));
export const softModelEligible=(model,age)=>model[age==='child'?'childEligible':'adultEligible'];
