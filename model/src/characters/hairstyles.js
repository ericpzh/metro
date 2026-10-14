// Shared by the builder, viewer, catalogue and export tools. Shape changes stay
// close to the reviewed head envelope; long shells stay behind the shoulders.
export const MALE_HAIRSTYLES = {
 original: {kind:'source'},
 short: {kind:'scalp'},
 bald: {kind:'scalp'},
 buzz: {kind:'source',crownScale:.58,tuftScale:.18,widthScale:.94,maxHeight:1.665},
 crew: {kind:'source',crownScale:.66,tuftScale:.5,widthScale:.91,maxHeight:1.68},
 crop: {kind:'source',crownScale:.63,tuftScale:.8,fringeLength:.027,maxHeight:1.68},
 'side-part': {kind:'source',crownScale:.7,tuftScale:.95,sweepX:.025,partX:-.025,partDepth:.02,maxHeight:1.69},
 swept: {kind:'source',crownScale:.7,tuftScale:1.1,sweepX:-.035,sweepZ:-.018,maxHeight:1.69},
 quiff: {kind:'source',crownScale:.64,tuftScale:1.18,widthScale:.94,frontLift:.024,maxHeight:1.695},
 rounded: {kind:'source',crownScale:.72,tuftScale:.1,widthScale:1.06,napeLift:-.006,maxHeight:1.685},
};
export const FEMALE_HAIRSTYLES = {
 bob: {kind:'bob',hem:1.435,width:.135,sweep:0},
 shoulder: {kind:'shoulder',hem:1.325,width:.135,sweep:0},
 long: {kind:'long',hem:1.105,width:.135,sweep:.035,backpack:false},
 'cropped-bob': {kind:'bob',hem:1.435,width:.135,sweep:.004,taper:.005},
 'rounded-bob': {kind:'bob',hem:1.415,width:.140,sweep:0,roundness:.007},
 'angled-bob': {kind:'bob',hem:1.415,width:.135,sweep:.004,angle:.020},
 'side-part-bob': {kind:'bob',hem:1.435,width:.135,sweep:0,fringe:.012,part:.008},
 lob: {kind:'shoulder',hem:1.365,width:.135,sweep:.005},
 'shoulder-swept': {kind:'shoulder',hem:1.325,width:.135,sweep:.008,angle:.012,fringe:.008},
 'long-swept': {kind:'long',hem:1.145,width:.135,sweep:.040,angle:.015,fringe:.010,backpack:false},
};
export const HAIR_CHOICES = {male:Object.keys(MALE_HAIRSTYLES),female:Object.keys(FEMALE_HAIRSTYLES)};
export const supportsBackpack = (character,hair) => (character==='male'?MALE_HAIRSTYLES:FEMALE_HAIRSTYLES)[hair]?.backpack!==false;
