import test from 'node:test'
import assert from 'node:assert/strict'
import {restorePassengerFrames} from '../src/render/passengerAtlas.ts'
import {deltaPassengerFrames} from '../../tools/passenger-bake-geometry.mjs'

test('temporal pose packing preserves every signed position/normal byte including overflow',()=>{
 for(const ArrayType of [Int16Array,Int8Array])for(const vertices of [1,3,29]){
  const high=2**(ArrayType.BYTES_PER_ELEMENT*8-1)-1,low=-high-1,stride=vertices*3
  const absolute=ArrayType.from({length:stride*7},(_,i)=>[low,high,-13,0,11,high-1][i%6]+Math.floor(i/stride)*19)
  const packed=deltaPassengerFrames(absolute,vertices)
  assert.deepEqual(packed.slice(0,stride),absolute.slice(0,stride),'the standing frame is absolute')
  assert.notDeepEqual(packed,absolute,'the fixture exercises differences and signed wrap')
  const restored=restorePassengerFrames(packed,vertices,'frame-delta')
  assert.equal(restored,packed,'restoration reuses the decoded buffer')
  assert.deepEqual(restored,absolute,'all walking positions/normals round trip exactly')
 }
})

test('absolute legacy poses stay unchanged and unknown or malformed formats fail closed',()=>{
 const values=Int16Array.from([1,2,3,4,5,6])
 assert.equal(restorePassengerFrames(values,1),values)
 assert.deepEqual([...values],[1,2,3,4,5,6])
 assert.throws(()=>restorePassengerFrames(values,1,'unknown'),/Unsupported passenger pose encoding/)
 for(const vertices of [0,2.5,3]){
  assert.throws(()=>restorePassengerFrames(values,vertices,'frame-delta'),/Invalid passenger frame dimensions/)
  assert.throws(()=>deltaPassengerFrames(values,vertices),/Invalid passenger frame dimensions/)
 }
})
