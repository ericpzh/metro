import assert from 'node:assert/strict';

/** Bound browser responses as the catalogue grows, without dropping any model. */
export function passengerCaptureBatches(variants, size = 4) {
 assert.ok(Number.isInteger(size) && size > 0);
 return Array.from({length: Math.ceil(variants.length / size)}, (_, batch) =>
  variants.slice(batch * size, (batch + 1) * size));
}

/** Reject stale builds, missing models, duplicate frames and incomplete strides. */
export function validatePassengerCaptures(index, cycles, library, walkFrames, includeChildren = false) {
 const files = new Set();
 for(const card of [...index, ...cycles]) {
  const model = library[card.variant];
  assert.ok(model && card.model === model.id, `unknown or stale model: ${card.model}`);
  assert.equal(card.sourceSha256, model.sourceSha256, `stale game build: ${model.id}`);
  if(card.age==='child')assert.ok(!model.bag&&model.hair!=='bald',`ineligible child model: ${model.id}`);
  assert.ok(!files.has(card.file), `duplicate captured file: ${card.file}`);files.add(card.file);
 }
 for(const age of includeChildren?['adult','child']:['adult']) for(const [variant, model] of library.entries()) {
  if(age==='child'&&(model.bag||model.hair==='bald'))continue;
  for(const view of ['iso', 'elevation', 'plan']) {
   const stills = index.filter(c=>c.variant===variant && c.view===view && (c.age??'adult')===age);
   assert.equal(stills.length, 4, `${model.id}: missing ${view} standing/walk samples`);
   assert.equal(stills.filter(c=>!c.walking).length, 1);
   const headings = view==='iso' ? 8 : view==='elevation' ? 2 : 1;
   const stride = cycles.filter(c=>c.variant===variant && c.view===view && (c.age??'adult')===age);
   const angles = [...new Set(stride.map(c=>c.heading))];
   assert.equal(angles.length, headings, `${model.id}: missing ${view} headings`);
   for(const angle of angles) {
    const samples = stride.filter(c=>c.heading===angle).map(c=>c.sample).sort((a,b)=>a-b);
    assert.deepEqual(samples, Array.from({length:walkFrames},(_,i)=>i), `${model.id}: incomplete ${view} stride`);
   }
  }
 }
}
