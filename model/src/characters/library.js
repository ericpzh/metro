import {HAIR_CHOICES,supportsBackpack} from './hairstyles.js';
import {OUTFITS} from './outfit-presets.js';

const backpackHairs=character=>HAIR_CHOICES[character].filter(hair=>supportsBackpack(character,hair));
/** Approved downloadable variants; each entry has equal weight in the game. */
export const MODEL_LIBRARY = [
  ...HAIR_CHOICES.male.flatMap(hair => [true, false].map(bag => ({
    id: `male-${hair}-${bag ? 'bag' : 'no-bag'}`, character: 'male', hair, bag,
    file: hair === 'original' && bag ? 'passenger-male-walk.glb' : `passenger-male-${bag ? 'bag' : 'no-bag'}-${hair}-walk.glb`,
  }))),
  ...backpackHairs('female').flatMap(hair => [true, false].map(bag => ({
    id: `female-${hair}-${bag ? 'bag' : 'no-bag'}`, character: 'female', hair, bag,
    file: bag ? (hair === 'bob' ? 'passenger-female-walk.glb' : `passenger-female-${hair}-walk.glb`) : `passenger-female-no-bag-${hair}-walk.glb`,
  }))),
  ...HAIR_CHOICES.female.filter(hair=>!supportsBackpack('female',hair)).map(hair=>({id:`female-${hair}-no-bag`,character:'female',hair,bag:false,file:`passenger-female-no-bag-${hair}-walk.glb`})),
  ...['male','female'].flatMap(character=>backpackHairs(character).map(hair=>({
    id:`${character}-${hair}-small-bag`,character,hair,bag:true,bagStyle:'small',file:`passenger-${character}-small-bag-${hair}-walk.glb`,
  }))),
  ...[.875,.75].flatMap(bagScale=>['male','female'].flatMap(character=>backpackHairs(character).map(hair=>({
    id:`${character}-${hair}-standard-${bagScale*100}-bag`,character,hair,bag:true,bagStyle:`standard-${bagScale*100}`,bagScale,
    file:`passenger-${character}-standard-${bagScale*100}-bag-${hair}-walk.glb`,
  })))),
  ...['shoulder','crossbody','purse'].flatMap(type=>['left','right'].flatMap(side=>['male','female'].flatMap(character=>type==='purse'&&character==='male'?[]:HAIR_CHOICES[character].map(hair=>({
    id:`${character}-${hair}-${type}-${side}-bag`,character,hair,bag:true,bagStyle:`${type}-${side}`,bagType:type,bagSide:side,
    ...(type==='crossbody'&&character==='female'?{childOnly:true}:{}),file:`passenger-${character}-${type}-${side}-${hair}-walk.glb`,
  }))))),
  ...['female','male'].flatMap(character=>OUTFITS[character].flatMap(preset=>[false,true].map(swapTones=>({
    id:`${character}-${preset.id}${swapTones?'-swapped':''}-no-bag`,character,
    hair:character==='female'?'bob':'original',bag:false,outfit:preset.id,swapTones,garmentShape:preset.shape,
    top:swapTones?preset.bottom:preset.top,bottom:swapTones?preset.top:preset.bottom,
    file:`passenger-${character}-${preset.id}${swapTones?'-swapped':''}-walk.glb`,
  })))),
].map(model=>({...model,
 adultEligible:!model.childOnly,
 childEligible:model.hair!=='bald'&&(!model.bag||model.bagStyle==='small'||model.bagType==='crossbody'),
}));

export const isBackpack=style=>!style||['standard','small','standard-87.5','standard-75'].includes(style);
export const modelEligible=(model,age)=>age==='child'?(model.childEligible??(model.hair!=='bald'&&(!model.bag||model.bagStyle==='small'||model.bagType==='crossbody'))):(model.adultEligible??true);
export const BAG_CHOICES=[
 ['0','noBag'],['1','withBag'],['standard-87.5','mediumStandardBag'],['standard-75','compactStandardBag'],['small','smallBag'],
 ...['shoulder','crossbody','purse'].flatMap(type=>['left','right'].map(side=>[`${type}-${side}`,`${type}${side==='left'?'Left':'Right'}`])),
];
