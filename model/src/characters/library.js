/** Approved downloadable variants; each entry has equal weight in the game. */
export const MODEL_LIBRARY = [
  ...['original', 'short', 'bald'].flatMap(hair => [true, false].map(bag => ({
    id: `male-${hair}-${bag ? 'bag' : 'no-bag'}`, character: 'male', hair, bag,
    file: hair === 'original' && bag ? 'passenger-male-walk.glb' : `passenger-male-${bag ? 'bag' : 'no-bag'}-${hair}-walk.glb`,
  }))),
  ...['bob', 'shoulder'].flatMap(hair => [true, false].map(bag => ({
    id: `female-${hair}-${bag ? 'bag' : 'no-bag'}`, character: 'female', hair, bag,
    file: bag ? (hair === 'bob' ? 'passenger-female-walk.glb' : 'passenger-female-shoulder-walk.glb') : `passenger-female-no-bag-${hair}-walk.glb`,
  }))),
  {id: 'female-long-no-bag', character: 'female', hair: 'long', bag: false, file: 'passenger-female-no-bag-long-walk.glb'},
  ...[['male',['original','short','bald']],['female',['bob','shoulder']]].flatMap(([character,hairs])=>hairs.map(hair=>({
    id:`${character}-${hair}-small-bag`,character,hair,bag:true,bagStyle:'small',file:`passenger-${character}-small-bag-${hair}-walk.glb`,
  }))),
];
