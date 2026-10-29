import test from 'node:test'
import assert from 'node:assert/strict'
import {prunePassengerSprites} from '../../tools/passenger-cards.mjs'

test('sheet pruning preserves referenced sprites and transitive aliases',()=>{
 const svg='<svg><defs><g id="human-0"><image href="data:kept"/></g><g id="human-1"><use href="#human-0"/></g><g id="human-2"><image href="data:unused"/></g></defs><use href="#human-1"/></svg>'
 const result=prunePassengerSprites(svg)
 assert.ok(result.includes('id="human-0"')&&result.includes('id="human-1"'))
 assert.ok(!result.includes('human-2')&&!result.includes('data:unused'))
 assert.equal(prunePassengerSprites(result),result)
 assert.equal(prunePassengerSprites('<svg><image href="data:other"/></svg>'),'<svg><image href="data:other"/></svg>')
})
